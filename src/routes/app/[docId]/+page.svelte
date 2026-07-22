<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/state';
	import { beforeNavigate } from '$app/navigation';
	import {
		createBuiltinRegistry,
		parseParameterInput,
		resolvePublishedTarget,
		ulid,
		type Actor,
		type DocumentGraph,
		type FunctionRegistry,
		type GraphMutation,
		type NodeId
	} from '$lib/engine';
	import {
		createPersistenceActivityLog,
		hydrateGraph,
		usePersistence,
		type DocumentId,
		type SaveState
	} from '$lib/persistence';
	import { createWorkspaceController, type WorkspaceController } from '$lib/workspace';
	import { createDocEditor, type DocEditor, type InsertableBlockType } from '$lib/editor';
	import {
		createGraphSession,
		formatCellDisplay,
		nodeForCell,
		type GraphSession,
		type WorkbookAdapter
	} from '$lib/adapters/univer';
	import Inspector from './Inspector.svelte';
	import WorkbookDrawer from './WorkbookDrawer.svelte';
	import ParametersRail from './ParametersRail.svelte';

	// V1-5-1/V1-5-2 · /app/[docId] — the document canvas. Block structure lives
	// in the graph: every add/move/remove/update is a `commit(blockOp …)`,
	// engine history is THE undo/redo, and the TipTap doc re-renders from graph
	// state after undo/redo/load. Sheet blocks host live Univer grids through
	// the V1-3-1 adapter, all bound to the ONE graph session; their snapshots
	// persist through the workspace controller on the existing cloud cadence.

	const persistenceActivity = createPersistenceActivityLog();
	const persistence = usePersistence(persistenceActivity.observe);
	const docId = page.params.docId as DocumentId;
	const HUMAN: Actor = { kind: 'human' };

	let phase = $state<
		'loading' | 'ready' | 'missing' | 'trashed' | 'unauthorized' | 'integrity' | 'failed'
	>('loading');
	let title = $state('');
	let titleEditing = $state(false);
	let titleDraft = $state('');
	let titleError = $state('');
	let saveState = $state<SaveState>('idle');
	let online = $state(true);
	let editorEl: HTMLDivElement;
	let imageInputEl: HTMLInputElement | undefined;
	/** Insertion-slot position for the next picked image (null = after selection). */
	let pendingImageAt: number | null = null;
	let parametersOpen = $state(false);
	let workbookOpen = $state(false);
	let pendingWorkbookCell: { sheetId: string; a1: string } | null = null;
	let parametersButton: HTMLButtonElement;
	let blockAnnouncement = $state('');

	// V1-5-5 · provenance inspector (read-only). Opens on chip Alt+click /
	// Alt+Enter (focus moves to the panel) and on selecting a graph-bound
	// sheet cell (focus stays in the grid); its own links re-target it.
	let inspectorTarget = $state<NodeId | null>(null);
	/** Re-derives the panel's view-model on every settle (live values). */
	let inspectorRevision = $state(0);
	/** Bumped only by focus-bearing opens (chips); see Inspector.svelte. */
	let inspectorFocusTick = $state(0);

	function openInspector(nodeId: NodeId, opts: { focus: boolean }): void {
		inspectorTarget = nodeId;
		if (opts.focus) inspectorFocusTick += 1;
	}

	/** Stable read-only slice of the graph for the panel (never reassigned;
	 * `graph` itself is set once during load, before phase turns ready). */
	const inspectorSource = {
		get nodes() {
			return graph.nodes;
		},
		dependentsOf: (id: NodeId) => graph.dependentsOf(id)
	};

	function closeInspector(): void {
		inspectorTarget = null;
		inspectorFocusTick = 0;
	}

	function startTitleEdit(): void {
		titleDraft = title;
		titleError = '';
		titleEditing = true;
	}

	async function commitTitle(): Promise<void> {
		if (!titleEditing) return;
		const next = titleDraft.trim();
		if (!next) {
			titleError = 'Title is required.';
			return;
		}
		if (next.length > 120) {
			titleError = 'Title must be 120 characters or fewer.';
			return;
		}
		titleEditing = false;
		if (next === title) return;
		try {
			await persistence.renameDocument(docId, next);
			title = next;
		} catch (cause) {
			titleError = cause instanceof Error ? cause.message : String(cause);
			titleEditing = true;
		}
	}

	/** Escape closes the panel — except inside a grid, where Escape leaves the
	 * grid (the sheet NodeView stops propagation for that case anyway). */
	function onWindowKeydown(e: KeyboardEvent): void {
		if (e.key !== 'Escape' || inspectorTarget === null) return;
		if (e.target instanceof Element && e.target.closest('[data-sheet-block]')) return;
		closeInspector();
	}

	let graph: DocumentGraph;
	let registry: FunctionRegistry;
	let session: GraphSession = $state()!;
	let workspace: WorkspaceController | null = null;
	let docEditor: DocEditor | null = null;

	let workbookAdapter: WorkbookAdapter | null = $state(null);
	let restoredWorkbookSnapshot: unknown = $state(null);

	const SAVE_LABEL: Record<SaveState, string> = {
		idle: 'saved',
		pending: 'unsaved',
		saving: 'saving…',
		error: 'save failed'
	};

	/** The single write path through the framework-neutral workspace controller. */
	function commitMutation(m: GraphMutation): boolean {
		const result = workspace?.commit(m);
		if (!result?.ok) {
			const message = result && !result.ok ? result.error.message : 'workspace not ready';
			console.warn('mutation rejected:', message);
			return false;
		}
		return true;
	}

	/**
	 * Engine-history undo/redo — the ONE stack spanning prose blockOps, cell
	 * edits, and name publishes. Runs through the session so every mounted
	 * sheet repaints its affected cells; in-grid Cmd/Ctrl+Z chords land here
	 * too (Univer's internal undo is suppressed by the sheet NodeView).
	 */
	function handleUndo(): void {
		workspace?.undo();
	}

	function handleRedo(): void {
		workspace?.redo();
	}

	/** Add a workbook tab; workbook tabs are not report blocks. */
	function insertSheet(): void {
		const result = workbookAdapter?.addSheet();
		if (result?.ok) workspace?.markChanged();
	}

	/** Upload the picked file, then add an image block — at the pending slot
	 * position when a slot initiated the pick, else after the current block. */
	async function insertImage(input: HTMLInputElement): Promise<void> {
		const file = input.files?.[0];
		input.value = '';
		const slotAt = pendingImageAt;
		pendingImageAt = null;
		if (!file || !docEditor) return;
		const storageId = await persistence.uploadFile(docId, file);
		docEditor.flushProse();
		const selected = docEditor.selectedBlockId();
		const at =
			slotAt !== null
				? Math.min(slotAt, graph.blocksOrder.length)
				: selected
					? graph.blocksOrder.indexOf(selected) + 1
					: graph.blocksOrder.length;
		const ok = commitMutation({
			op: 'blockOp',
			action: 'add',
			blockId: ulid(),
			block: { docId, type: 'image', image: { storageId, alt: file.name } },
			position: at
		});
		if (ok) docEditor.renderFromGraph();
	}

	/** Insertion slots (notebook-style): add a block exactly at the slot's gap. */
	function insertBlockAt(type: InsertableBlockType, index: number): void {
		if (!docEditor) return;
		if (type === 'image') {
			// The block lands once the file is picked (insertImage above).
			pendingImageAt = index;
			imageInputEl?.click();
			return;
		}
		docEditor.flushProse();
		const at = Math.min(index, graph.blocksOrder.length);
		const blockId = ulid();
		const ok = commitMutation({
			op: 'blockOp',
			action: 'add',
			blockId,
			block:
				type === 'equation'
					? { docId, type: 'equation', equation: { mode: 'static', tex: '' } }
					: { docId, type: 'text' },
			position: at
		});
		if (!ok) return;
		docEditor.renderFromGraph();
		if (type === 'equation') docEditor.focusEquationEditor(blockId);
		else docEditor.focusBlock(blockId);
	}

	function flushAll(): void {
		void workspace?.flush().catch(() => {});
	}

	/**
	 * Deterministic e2e hooks (canvas-sheets.spec.ts): cell/name access through
	 * the adapter facade, block ops through the single commit path, and mount
	 * metrics for the landmine-2 measurement. Sheets are keyed by block id;
	 * `sheetIds()` lists them in canonical blocksOrder.
	 */
	function exposeCanvasHooks(): void {
		const sheetIds = (): string[] => graph.workbook.sheets.map((sheet) => sheet.id);
		Object.assign(window as object, {
			__canvas: {
				sheetIds,
				sheets: () => graph.workbook.sheets.map((sheet) => ({ ...sheet })),
				sheetsMounted: () => workbookAdapter !== null,
				blocksOrder: () => [...graph.blocksOrder],
				getCell: (sheetId: string, a1: string) =>
					workbookAdapter?.getCell(sheetId, a1) ?? null,
				getRawCell: (sheetId: string, a1: string) =>
					workbookAdapter?.getRawCell(sheetId, a1) ?? null,
				setCell: (sheetId: string, a1: string, input: number | string | boolean) =>
					workbookAdapter?.setCellText(sheetId, a1, input),
				publish: (sheetId: string, a1: string, name: string) =>
					workbookAdapter?.publishName(sheetId, a1, name),
				deleteName: (_sheetId: string, name: string) =>
					workbookAdapter?.deleteName(name) ?? false,
				renameName: (oldName: string, newName: string) =>
					workbookAdapter?.renameName(oldName, newName) ?? false,
				selection: () => workbookAdapter?.selection() ?? null,
				chipIds: () => [...graph.chips.keys()],
				chipBinding: (chipId: string) => graph.chips.get(chipId) ?? null,
				graphDisplay: (sheetId: string, a1: string) => {
					const node = nodeForCell(session, sheetId, a1);
					return node ? formatCellDisplay(node.value) : null;
				},
				formulaOf: (sheetId: string, a1: string) => {
					const node = nodeForCell(session, sheetId, a1);
					return node?.formula ?? null;
				},
				insertSheet: () => insertSheet(),
				renameSheet: (sheetId: string, name: string) =>
					workbookAdapter?.renameSheet(sheetId, name) ?? { ok: false, message: 'not ready' },
				moveBlock: (blockId: string, position: number) => {
					const ok = commitMutation({ op: 'blockOp', action: 'move', blockId, position });
					if (ok) docEditor?.renderFromGraph();
					return ok;
				},
				mountMetrics: () => [],
				persistenceActivity: () => workspace?.persistenceActivity() ?? [],
				clearPersistenceActivity: () => workspace?.clearPersistenceActivity(),
				heapBytes: () =>
					(performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
						?.usedJSHeapSize ?? null
			}
		});
	}

	onMount(() => {
		let cancelled = false;
		online = navigator.onLine;
		const setOnline = (): void => {
			online = navigator.onLine;
		};
		window.addEventListener('online', setOnline);
		window.addEventListener('offline', setOnline);
		void (async () => {
			try {
				const loaded = await persistence.loadDocument(docId);
				if (cancelled) return;
				if (loaded.state !== 'live') {
					phase =
						loaded.state === 'integrity-error'
							? 'integrity'
							: loaded.state;
					return;
				}
				title = loaded.document.title;
				registry = createBuiltinRegistry();
				const { graph: hydrated, mismatches } = hydrateGraph(loaded, { registry });
				if (mismatches.length > 0) {
					console.warn('reproducibility mismatches on load:', mismatches);
				}
				graph = hydrated;
				session = createGraphSession({ doc: graph, registry, docId, actor: HUMAN });
				restoredWorkbookSnapshot = loaded.workbookSnapshot.snapshot;
				workspace = createWorkspaceController({
					docId,
					graph: session,
					cloud: persistence,
					projection: {
						flushPendingChanges: () => docEditor?.flushProse(),
						renderSettledState: () => docEditor?.renderFromGraph()
					},
					workbookSnapshot: () =>
						workbookAdapter?.saveSnapshot() ?? restoredWorkbookSnapshot,
					activity: persistenceActivity,
					onSaveState: (state) => (saveState = state)
				});
				docEditor = createDocEditor({
					element: editorEl,
					graph,
					docId,
					registry,
					resolveImageUrl: (storageId) => persistence.fileUrl(storageId),
					commitMutation,
					onChanged: () => workspace?.markChanged(),
					onUndo: handleUndo,
					onRedo: handleRedo,
					onAnnounce: (message) => {
						blockAnnouncement = '';
						queueMicrotask(() => (blockAnnouncement = message));
					},
					// Chips re-render + flash on every settle (commit/undo/redo).
					onSettle: (cb) => session.onSettle(() => cb()),
					// Alt+click / Alt+Enter on a chip opens the inspector (V1-5-5).
					onInspect: (nodeId) => openInspector(nodeId, { focus: true }),
					onNavigateCell: (cellRef) => {
						if (!graph.sheet(cellRef.sheetId)) return false;
						workbookOpen = true;
						pendingWorkbookCell = cellRef;
						queueMicrotask(() => {
							if (workbookAdapter?.activateCell(cellRef.sheetId, cellRef.a1)) {
								pendingWorkbookCell = null;
							}
						});
						return true;
					},
					editParameter: (publishedNodeId, text) => {
						const resolved = resolvePublishedTarget(graph, publishedNodeId);
						if (!resolved || resolved.targetNode.kind !== 'input') {
							return { ok: false, message: 'This parameter is read-only.' };
						}
						const parsed = parseParameterInput(text, resolved.targetNode.value);
						if (!parsed.ok) return parsed;
						const result = workspace?.commit({
							op: 'setInput',
							id: resolved.targetNode.id,
							value: parsed.value
						});
						if (!result?.ok) {
							return {
								ok: false,
								message: result && !result.ok ? result.error.message : 'Workspace not ready.'
							};
						}
						return { ok: true };
					},
					// Notebook-style insertion slots between blocks and at the end.
					onInsertBlockAt: insertBlockAt
				});
				// The open inspector re-derives its view-model on every settle.
				session.onSettle(() => (inspectorRevision += 1));
				exposeCanvasHooks();
				phase = 'ready';
			} catch (e) {
				console.error('failed to load document', e);
				if (!cancelled) phase = 'failed';
			}
		})();

		const onHide = (): void => {
			if (document.visibilityState === 'hidden') flushAll();
		};
		document.addEventListener('visibilitychange', onHide);
		window.addEventListener('pagehide', flushAll);
		return () => {
			cancelled = true;
			window.removeEventListener('online', setOnline);
			window.removeEventListener('offline', setOnline);
			document.removeEventListener('visibilitychange', onHide);
			window.removeEventListener('pagehide', flushAll);
		};
	});

	beforeNavigate((navigation) => {
		flushAll();
		if (
			!navigator.onLine &&
			saveState !== 'idle' &&
			!window.confirm('This document has unsaved offline changes. Leave anyway?')
		) {
			navigation.cancel();
		}
	});

	onDestroy(() => {
		flushAll();
		docEditor?.destroy();
		docEditor = null;
		workspace?.dispose();
		workspace = null;
	});
</script>

<svelte:window onkeydown={onWindowKeydown} />

<svelte:head>
	<title>{title || 'Document'} · OctoMeta</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="wrap">
	<p class="visually-hidden" role="status" aria-live="polite">{blockAnnouncement}</p>
	<div class="toolbar">
		<a class="back mono" href="/app" data-testid="back">← documents</a>
		{#if titleEditing}
			<div class="title-edit">
				<input
					bind:value={titleDraft}
					maxlength="120"
					aria-label="Document title"
					aria-invalid={titleError ? 'true' : undefined}
					aria-describedby={titleError ? 'document-title-error' : undefined}
					onkeydown={(event) => {
						if (event.key === 'Enter') void commitTitle();
						if (event.key === 'Escape') {
							titleEditing = false;
							titleError = '';
						}
					}}
					onblur={() => void commitTitle()}
				/>
				{#if titleError}<span id="document-title-error" role="alert">{titleError}</span>{/if}
			</div>
		{:else}
			<button class="title" data-testid="doc-title" type="button" onclick={startTitleEdit}>{title}</button>
		{/if}
		<span class="grow"></span>
		<button
			class="tool"
			data-testid="undo"
			disabled={phase !== 'ready'}
			onclick={handleUndo}
			title="Undo (⌘Z)">Undo</button
		>
		<button
			class="tool"
			data-testid="redo"
			disabled={phase !== 'ready'}
			onclick={handleRedo}
			title="Redo (⇧⌘Z)">Redo</button
		>
		<button
			class="tool"
			data-testid="move-up"
			disabled={phase !== 'ready'}
			onclick={() => docEditor?.moveSelectedBlock(-1)}
			title="Move block up (⌥↑)">Move ↑</button
		>
		<button
			class="tool"
			data-testid="move-down"
			disabled={phase !== 'ready'}
			onclick={() => docEditor?.moveSelectedBlock(1)}
			title="Move block down (⌥↓)">Move ↓</button
		>
		<label class="tool" data-testid="insert-image-label">
			Image
			<input
				type="file"
				accept="image/*"
				data-testid="image-input"
				bind:this={imageInputEl}
				onchange={(e) => void insertImage(e.currentTarget)}
			/>
		</label>
		<button
			class="tool"
			data-testid="insert-sheet"
			disabled={phase !== 'ready'}
			onclick={insertSheet}
			title="Insert a calculation sheet">Sheet</button
		>
		<button
			class="tool"
			type="button"
			bind:this={parametersButton}
			aria-expanded={parametersOpen}
			onclick={() => (parametersOpen = !parametersOpen)}>Parameters</button
		>
		<span
			class="save mono"
			data-testid="save-state"
			data-save-state={saveState}
			class:error={saveState === 'error'}>{SAVE_LABEL[saveState]}</span
		>
	</div>
	{#if !online}
		<p class="offline" role="status">
			Offline. {saveState === 'idle' ? 'Changes will save after reconnecting.' : 'Unsaved changes are waiting to sync.'}
		</p>
	{/if}

	{#if phase === 'missing'}
		<p class="notice">This document does not exist. <a href="/app">Back to documents.</a></p>
	{:else if phase === 'trashed'}
		<section class="notice" aria-labelledby="trashed-title">
			<h1 id="trashed-title">This document is in trash.</h1>
			<button
				class="tool"
				type="button"
				onclick={() =>
					void persistence.restoreDocument(docId).then(() => location.reload())}
				>Restore</button
			>
			<a href="/app">Back to documents</a>
		</section>
	{:else if phase === 'unauthorized'}
		<p class="notice err" role="alert">You do not have access to this document.</p>
	{:else if phase === 'integrity'}
		<p class="notice err" role="alert">
			This document failed its integrity check and has been opened read-only. No writes were sent.
		</p>
	{:else if phase === 'failed'}
		<p class="notice err" role="alert">Could not load the document.</p>
	{/if}

	<div
		class="editor"
		data-testid="editor"
		data-ready={phase === 'ready' ? 'true' : 'false'}
		bind:this={editorEl}
	></div>

	{#if phase === 'ready'}
		<ParametersRail
			{session}
			open={parametersOpen}
			onclose={() => {
				parametersOpen = false;
				queueMicrotask(() => parametersButton?.focus());
			}}
			onchanged={() => workspace?.markChanged()}
			oninsert={(nodeId) => docEditor?.insertChip(nodeId) ?? false}
		/>
		<WorkbookDrawer
			{session}
			snapshot={restoredWorkbookSnapshot}
			bind:expanded={workbookOpen}
			ondirty={() => workspace?.markChanged()}
			onready={(adapter) => {
				workbookAdapter = adapter;
				if (adapter) {
					exposeCanvasHooks();
					if (
						pendingWorkbookCell &&
						adapter.activateCell(pendingWorkbookCell.sheetId, pendingWorkbookCell.a1)
					) {
						pendingWorkbookCell = null;
					}
				}
			}}
		/>
	{/if}

	{#if inspectorTarget !== null && phase === 'ready'}
		<Inspector
			graph={inspectorSource}
			nodeId={inspectorTarget}
			revision={inspectorRevision}
			focusTick={inspectorFocusTick}
			onnavigate={(nodeId) => openInspector(nodeId, { focus: false })}
			onclose={closeInspector}
		/>
	{/if}
</main>

<style>
	/* The canvas is full-page (notebook-style): sheets and images get the whole
	   viewport; `.wrap`'s side padding is all that frames it. */
	main {
		max-width: none;
		padding-top: var(--s3);
		padding-bottom: var(--s6);
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: var(--s1);
		padding-bottom: var(--s2);
		margin-bottom: var(--s3);
		border-bottom: 1px solid var(--grey-3);
	}
	.back {
		font-size: var(--fs-caption);
		color: var(--grey-1);
		text-decoration: none;
	}
	.back:hover {
		color: var(--ink);
	}
	.title {
		font-family: var(--font-display);
		font-weight: 600;
		letter-spacing: -0.02em;
		margin-left: var(--s1);
		min-height: 32px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--ink);
		cursor: text;
	}
	.title:focus-visible, .title-edit input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
	.title-edit { position: relative; min-width: min(34vw, 360px); }
	.title-edit input { width: 100%; min-height: 32px; box-sizing: border-box; border: 1px solid var(--grey-3); border-radius: var(--radius-chip); background: var(--surface); color: var(--ink); font: 600 1rem var(--font-display); padding: 0 8px; }
	.title-edit span { position: absolute; top: 100%; left: 0; z-index: 5; color: var(--error); font-size: .72rem; white-space: nowrap; }
	.grow {
		flex: 1;
	}
	.tool {
		font: 500 0.8rem var(--font-body);
		color: var(--grey-1);
		background: var(--surface);
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-chip);
		padding: 4px 10px;
		cursor: pointer;
		transition:
			color var(--t-fast) var(--ease),
			border-color var(--t-fast) var(--ease);
	}
	.tool:hover:not(:disabled) {
		color: var(--ink);
		border-color: var(--ink);
	}
	.tool:disabled {
		color: var(--grey-2);
		cursor: default;
	}
	.tool input[type='file'] {
		display: none;
	}
	.save {
		font-size: var(--fs-caption);
		color: var(--grey-1);
		min-width: 72px;
		text-align: right;
	}
	.save.error {
		color: var(--error);
	}
	.notice {
		color: var(--grey-1);
		margin-bottom: var(--s3);
	}
	.offline { margin: calc(-1 * var(--s2)) 0 var(--s2); padding: 7px 10px; border: 1px solid var(--warning, #9a6b00); border-radius: var(--radius-chip); color: var(--grey-1); font-size: .82rem; }

	/* The document itself — DESIGN.md: paper, hairlines, no shadows. */
	.editor :global(.tiptap) {
		min-height: 420px;
		outline: none;
	}
	.editor :global(.tiptap > * + *) {
		margin-top: var(--s2);
	}
	.editor :global(.tiptap h1) {
		font-size: var(--fs-h2);
	}
	.editor :global(.tiptap h2) {
		font-size: 1.5rem;
	}
	.editor :global(.tiptap h3) {
		font-size: 1.2rem;
	}
	.editor :global(.tiptap ul),
	.editor :global(.tiptap ol) {
		padding-left: var(--s3);
	}
	.editor :global(.tiptap code) {
		font-family: var(--font-mono);
		font-size: 0.85em;
		background: var(--grey-4);
		padding: 1px 5px;
		border-radius: var(--radius-chip);
	}
	.editor :global(.tiptap pre) {
		font-family: var(--font-mono);
		font-size: 0.85em;
		background: var(--grey-4);
		padding: var(--s2);
		border-radius: var(--radius-chip);
		overflow-x: auto;
	}
	.editor :global(.tiptap blockquote) {
		border-left: 2px solid var(--grey-3);
		padding-left: var(--s2);
		color: var(--grey-1);
	}
	.editor :global(.tiptap figure[data-image-block]) {
		margin: var(--s3) 0;
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-card);
		overflow: hidden;
		background: var(--surface);
	}
	.editor :global(.tiptap figure[data-image-block] img) {
		display: block;
		max-width: 100%;
	}
	.editor :global(.tiptap figure[data-image-block] figcaption) {
		font-family: var(--font-mono);
		font-size: var(--fs-caption);
		color: var(--grey-1);
		padding: var(--s1) var(--s2);
		border-top: 1px solid var(--grey-3);
	}
	.editor :global(.tiptap figure[data-equation-block]) {
		margin: var(--s3) 0;
		padding: var(--s2);
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-card);
		background: var(--surface);
		overflow: hidden;
	}
	@media (max-width: 800px) {
		main { padding-inline: var(--s2); }
		.toolbar { flex-wrap: wrap; gap: 6px; }
		.toolbar .title {
			max-width: 145px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.toolbar .grow { min-width: 12px; }
		.toolbar .tool { min-height: 44px; }
		.editor { min-width: 0; overflow-wrap: anywhere; }
		.editor :global(.equation-controls) { flex-wrap: wrap; }
		.editor :global(.equation-controls select) { max-width: 100%; }
	}
	.editor :global(.equation-controls) {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s1);
		margin-bottom: var(--s2);
	}
	.editor :global(.equation-controls select),
	.editor :global(.equation-source) {
		min-height: 36px;
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-chip);
		background: var(--paper);
		color: var(--ink);
		font: 0.78rem var(--font-mono);
	}
	.editor :global(.equation-controls select) {
		padding: 0 var(--s1);
	}
	.editor :global(.equation-source) {
		display: block;
		width: 100%;
		resize: vertical;
		padding: var(--s1);
		box-sizing: border-box;
	}
	.editor :global(.equation-source:focus),
	.editor :global(.equation-controls select:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.editor :global(.equation-preview) {
		min-height: 72px;
		display: grid;
		align-items: center;
		overflow-x: auto;
		padding: var(--s2);
	}
	.editor :global(.equation-help),
	.editor :global(.equation-error) {
		margin: 5px 0 0;
		font: var(--fs-caption) var(--font-mono);
		color: var(--grey-2);
	}
	.editor :global(.equation-error) {
		color: var(--error);
		overflow-wrap: anywhere;
	}
	.editor :global(.tiptap .ProseMirror-selectednode) {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.editor :global(.octo-report-block) {
		border-radius: var(--radius-chip);
		transition: box-shadow var(--t-fast) var(--ease);
	}
	.editor :global(.octo-report-block:hover),
	.editor :global(.octo-report-block:focus-within),
	.editor :global(.octo-report-block.ProseMirror-selectednode) {
		box-shadow: 0 0 0 1px var(--grey-3);
	}
	.editor :global(.octo-block-chrome) {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 4px;
		min-height: 28px;
		margin: 2px 0 -4px;
		opacity: 1;
	}
	.editor :global(.octo-block-type) {
		margin-right: auto;
		color: var(--grey-1);
		font: 500 var(--fs-caption) var(--font-mono);
		letter-spacing: .08em;
		text-transform: uppercase;
	}
	.editor :global(.octo-block-control) {
		min-height: 28px;
		padding: 2px 8px;
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-chip);
		background: var(--surface);
		color: var(--grey-1);
		font: var(--fs-caption) var(--font-mono);
		cursor: pointer;
	}
	.editor :global(.octo-block-control:disabled) {
		opacity: .35;
		cursor: default;
	}
	.editor :global(.octo-block-control:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.editor :global(.tiptap div[data-sheet-block]) {
		margin: var(--s3) 0;
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-panel);
		overflow: hidden;
		background: var(--surface);
	}
	.editor :global(.tiptap div[data-sheet-block] .octo-sheet-label) {
		font-family: var(--font-mono);
		font-size: var(--fs-caption);
		color: var(--grey-2);
		padding: var(--s1) var(--s2);
		border-bottom: 1px solid var(--grey-3);
		cursor: default;
		user-select: none;
	}
	.editor :global(.tiptap div[data-sheet-block] .octo-sheet-grid) {
		height: 340px;
	}

	/* Insertion slots (notebook-style): a quiet hairline gap that reveals
	   "+ text · + sheet · + image" on hover; the end slot is always visible. */
	.editor :global(.tiptap > .octo-insert-slot) {
		margin-top: 4px;
	}
	.editor :global(.tiptap > .octo-insert-slot + *) {
		margin-top: 4px;
	}
	.editor :global(.octo-insert-slot) {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 22px;
		user-select: none;
	}
	.editor :global(.octo-insert-slot .octo-insert-rule) {
		position: absolute;
		left: 0;
		right: 0;
		top: 50%;
		border-top: 1px solid var(--grey-3);
		opacity: 0;
		transition: opacity var(--t-fast) var(--ease);
	}
	.editor :global(.octo-insert-slot .octo-insert-actions) {
		position: relative;
		display: inline-flex;
		gap: var(--s1);
		padding: 0 var(--s1);
		background: var(--paper);
		opacity: 0;
		transition: opacity var(--t-fast) var(--ease);
	}
	.editor :global(.octo-insert-slot:hover .octo-insert-rule),
	.editor :global(.octo-insert-slot:focus-within .octo-insert-rule),
	.editor :global(.octo-insert-slot.is-end .octo-insert-rule) {
		opacity: 1;
	}
	.editor :global(.octo-insert-slot:hover .octo-insert-actions),
	.editor :global(.octo-insert-slot:focus-within .octo-insert-actions),
	.editor :global(.octo-insert-slot.is-end .octo-insert-actions) {
		opacity: 1;
	}
	.editor :global(.octo-insert-slot.is-end) {
		margin-top: var(--s3);
	}
	.editor :global(.octo-insert-btn) {
		font: 500 0.72rem var(--font-mono);
		letter-spacing: 0.02em;
		color: var(--grey-1);
		background: var(--surface);
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-pill);
		padding: 3px 12px;
		cursor: pointer;
		transition:
			color var(--t-fast) var(--ease),
			border-color var(--t-fast) var(--ease);
	}
	.editor :global(.octo-insert-btn:hover) {
		color: var(--ink);
		border-color: var(--ink);
	}
	.editor :global(.octo-insert-btn:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}

	/* Value chips (V1-5-3): .chip/.err/.pulse come from base.css — identical
	   to marketing. Only inline-flow adjustments live here. */
	.editor :global(.tiptap span[data-chip-id]) {
		cursor: default;
		white-space: nowrap;
		user-select: none;
	}
	.editor :global(.tiptap span[data-chip-id].chip-error) {
		cursor: pointer;
	}
	/* Value chips expand to show-steps (V1-5-4), so they are clickable too. */
	.editor :global(.tiptap span[data-chip-id].chip-expandable) {
		cursor: pointer;
	}

	/* Error deep-link target highlight: accent ring per DESIGN.md §3 (focus
	   rings / dependency signals are allowed accent surfaces). */
	.editor :global(.octo-deeplink) {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		border-radius: var(--radius-chip);
	}

	/* The @ picker listbox (appended to <body> so it escapes editor overflow). */
	:global(.octo-chip-picker) {
		position: fixed;
		z-index: 50;
		min-width: 180px;
		max-width: 320px;
		background: var(--surface);
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-chip);
		padding: 4px;
	}
	:global(.octo-chip-picker-item) {
		font-family: var(--font-mono);
		font-size: 0.82rem;
		color: var(--ink);
		padding: 5px 8px;
		border-radius: var(--radius-chip);
		cursor: pointer;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	:global(.octo-chip-picker-item.is-active) {
		background: var(--accent-dim);
		color: var(--accent);
	}
	:global(.octo-chip-picker-empty) {
		font-family: var(--font-mono);
		font-size: 0.78rem;
		color: var(--grey-2);
		padding: 5px 8px;
	}
	@media (max-width: 800px) {
		.editor :global(.octo-block-chrome) {
			min-height: 44px;
			opacity: 1;
		}
		.editor :global(.octo-block-control) {
			min-width: 44px;
			min-height: 44px;
		}
	}
</style>
