<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/state';
	import { beforeNavigate } from '$app/navigation';
	import {
		createBuiltinRegistry,
		printFormula,
		ulid,
		type Actor,
		type DocumentGraph,
		type FunctionRegistry,
		type GraphMutation,
		type NodeId
	} from '$lib/engine';
	import {
		hydrateGraph,
		createDocumentSaver,
		createSheetSnapshotSaver,
		usePersistence,
		type DocumentId,
		type DocumentSaver,
		type SaveState,
		type SheetSnapshotEntry
	} from '$lib/persistence';
	import {
		createDocEditor,
		type DocEditor,
		type InsertableBlockType,
		type SheetHandle
	} from '$lib/editor';
	import {
		attachSheetAdapter,
		createGraphSession,
		formatCellDisplay,
		nodeForCell,
		seedSheetStore,
		sheetStore,
		type GraphSession,
		type SheetAdapter
	} from '$lib/adapters/univer';
	import Inspector from './Inspector.svelte';

	// V1-5-1/V1-5-2 · /app/[docId] — the document canvas. Block structure lives
	// in the graph: every add/move/remove/update is a `commit(blockOp …)`,
	// engine history is THE undo/redo, and the TipTap doc re-renders from graph
	// state after undo/redo/load. Sheet blocks host live Univer grids through
	// the V1-3-1 adapter, all bound to the ONE graph session; their snapshots
	// persist to `sheetSnapshots` on the document saver's cadence.

	const persistence = usePersistence();
	const docId = page.params.docId as DocumentId;
	const HUMAN: Actor = { kind: 'human' };

	let phase = $state<'loading' | 'ready' | 'missing' | 'failed'>('loading');
	let title = $state('');
	let saveState = $state<SaveState>('idle');
	let editorEl: HTMLDivElement;
	let imageInputEl: HTMLInputElement | undefined;
	/** Insertion-slot position for the next picked image (null = after selection). */
	let pendingImageAt: number | null = null;

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

	/** Escape closes the panel — except inside a grid, where Escape leaves the
	 * grid (the sheet NodeView stops propagation for that case anyway). */
	function onWindowKeydown(e: KeyboardEvent): void {
		if (e.key !== 'Escape' || inspectorTarget === null) return;
		if (e.target instanceof Element && e.target.closest('[data-sheet-block]')) return;
		closeInspector();
	}

	let graph: DocumentGraph;
	let registry: FunctionRegistry;
	let session: GraphSession;
	let saver: DocumentSaver | null = null;
	let docEditor: DocEditor | null = null;

	/** Live sheet adapters by block id (one per mounted sheet NodeView). */
	const sheets = new Map<string, SheetAdapter>();
	/** Mount metrics (landmine 2): per-grid attach wall time, mount order. */
	const mountMetrics: { blockId: string; ms: number }[] = [];

	const SAVE_LABEL: Record<SaveState, string> = {
		idle: 'saved',
		pending: 'unsaved',
		saving: 'saving…',
		error: 'save failed'
	};

	/** The single write path: commit (applyMutation + recalc), then schedule a save. */
	function commitMutation(m: GraphMutation): boolean {
		const r = session.commit(m);
		if (!r.ok) {
			console.warn('mutation rejected:', r.error.message);
			return false;
		}
		saver?.scheduleSave();
		return true;
	}

	/**
	 * Engine-history undo/redo — the ONE stack spanning prose blockOps, cell
	 * edits, and name publishes. Runs through the session so every mounted
	 * sheet repaints its affected cells; in-grid Cmd/Ctrl+Z chords land here
	 * too (Univer's internal undo is suppressed by the sheet NodeView).
	 */
	function handleUndo(): void {
		if (!docEditor) return;
		// Pending prose edits become the entry being undone otherwise.
		docEditor.flushProse();
		const r = session.undo();
		if (!r.ok) return;
		docEditor.renderFromGraph();
		saver?.scheduleSave();
	}

	function handleRedo(): void {
		if (!docEditor) return;
		docEditor.flushProse();
		const r = session.redo();
		if (!r.ok) return;
		docEditor.renderFromGraph();
		saver?.scheduleSave();
	}

	/**
	 * Mount a live grid for a sheet NodeView (V1-5-2, eager strategy — see
	 * ARCHITECTURE.md mount measurements). Rehydrates from `sheetStore` (seeded
	 * from `sheetSnapshots` on load, refreshed on every NodeView destroy).
	 */
	async function attachSheet(blockId: string, container: HTMLElement): Promise<SheetHandle> {
		const t0 = performance.now();
		const adapter = await attachSheetAdapter({ session, blockId, container, name: 'Sheet' });
		mountMetrics.push({ blockId, ms: Math.round(performance.now() - t0) });
		sheets.set(blockId, adapter);
		// Any workbook model mutation (cell edit, column width…) dirties the doc;
		// the debounced saver then flushes changed snapshots alongside the graph.
		const offMutated = adapter.onMutated(() => saver?.scheduleSave());
		// V1-5-5: selecting a graph-bound cell targets the inspector at its
		// node. Unbound cells do nothing, and focus stays in the grid.
		const offSelect = adapter.onSelect((a1) => {
			const node = nodeForCell(session, blockId, a1);
			if (node) openInspector(node.id, { focus: false });
		});
		return {
			dispose: () => {
				offMutated();
				offSelect();
				sheets.delete(blockId);
				adapter.dispose(); // flushes the latest snapshot into sheetStore
			}
		};
	}

	/** Current snapshots of every sheet block, for the saver's snapshot flush. */
	function collectSheetSnapshots(): SheetSnapshotEntry[] {
		for (const adapter of sheets.values()) adapter.saveSnapshot();
		const entries: SheetSnapshotEntry[] = [];
		for (const [id, block] of graph.blocks) {
			if (block.type !== 'sheet') continue;
			const snapshot = sheetStore.get(id);
			if (snapshot) entries.push({ blockId: id, snapshot });
		}
		return entries;
	}

	/** Toolbar: add a sheet block after the current one (blockOp add → commit). */
	function insertSheet(): void {
		if (!docEditor) return;
		docEditor.flushProse();
		const selected = docEditor.selectedBlockId();
		const at = selected ? graph.blocksOrder.indexOf(selected) + 1 : graph.blocksOrder.length;
		const ok = commitMutation({
			op: 'blockOp',
			action: 'add',
			blockId: ulid(),
			block: { docId, type: 'sheet' },
			position: at
		});
		if (ok) docEditor.renderFromGraph();
	}

	/** Upload the picked file, then add an image block — at the pending slot
	 * position when a slot initiated the pick, else after the current block. */
	async function insertImage(input: HTMLInputElement): Promise<void> {
		const file = input.files?.[0];
		input.value = '';
		const slotAt = pendingImageAt;
		pendingImageAt = null;
		if (!file || !docEditor) return;
		const storageId = await persistence.uploadFile(file);
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
			block: { docId, type: type === 'sheet' ? 'sheet' : 'text' },
			position: at
		});
		if (!ok) return;
		docEditor.renderFromGraph();
		if (type === 'text') docEditor.focusBlock(blockId);
	}

	function flushAll(): void {
		docEditor?.flushProse();
		void saver?.flush().catch(() => {});
	}

	/**
	 * Deterministic e2e hooks (canvas-sheets.spec.ts): cell/name access through
	 * the adapter facade, block ops through the single commit path, and mount
	 * metrics for the landmine-2 measurement. Sheets are keyed by block id;
	 * `sheetIds()` lists them in canonical blocksOrder.
	 */
	function exposeCanvasHooks(): void {
		const sheetIds = (): string[] =>
			graph.blocksOrder.filter((id) => graph.blocks.get(id)?.type === 'sheet');
		Object.assign(window as object, {
			__canvas: {
				sheetIds,
				sheetsMounted: () => sheetIds().every((id) => sheets.has(id)),
				blocksOrder: () => [...graph.blocksOrder],
				getCell: (blockId: string, a1: string) => sheets.get(blockId)?.getCell(a1) ?? null,
				getRawCell: (blockId: string, a1: string) => sheets.get(blockId)?.getRawCell(a1) ?? null,
				setCell: (blockId: string, a1: string, input: number | string | boolean) =>
					sheets.get(blockId)?.setCellText(a1, input),
				publish: (blockId: string, a1: string, name: string) =>
					sheets.get(blockId)?.publishName(a1, name),
				deleteName: (blockId: string, name: string) =>
					sheets.get(blockId)?.deleteName(name) ?? false,
				chipIds: () => [...graph.chips.keys()],
				chipBinding: (chipId: string) => graph.chips.get(chipId) ?? null,
				graphDisplay: (blockId: string, a1: string) => {
					const node = nodeForCell(session, blockId, a1);
					return node ? formatCellDisplay(node.value) : null;
				},
				formulaOf: (blockId: string, a1: string) => {
					const node = nodeForCell(session, blockId, a1);
					return node?.formula ? printFormula(node.formula) : null;
				},
				insertSheet: () => insertSheet(),
				moveBlock: (blockId: string, position: number) => {
					const ok = commitMutation({ op: 'blockOp', action: 'move', blockId, position });
					if (ok) docEditor?.renderFromGraph();
					return ok;
				},
				mountMetrics: () => [...mountMetrics],
				heapBytes: () =>
					(performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
						?.usedJSHeapSize ?? null
			}
		});
	}

	onMount(() => {
		let cancelled = false;
		void (async () => {
			try {
				const loaded = await persistence.loadDocument(docId);
				if (cancelled) return;
				if (!loaded) {
					phase = 'missing';
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
				// Snapshots restore BEFORE the editor mounts its sheet NodeViews:
				// each grid rehydrates from the store, the graph repaints its cells.
				seedSheetStore(
					loaded.sheetSnapshots.map((row) => ({
						blockId: row.blockId,
						snapshot: row.univerSnapshot
					}))
				);
				// Snapshot writes ride the document saver's debounce/flush cadence.
				const snapshotSaver = createSheetSnapshotSaver((blockId, snapshot) =>
					persistence.upsertSheetSnapshot(docId, blockId, snapshot)
				);
				saver = createDocumentSaver(
					{
						saveDocument: async (id, g) => {
							const entries = collectSheetSnapshots();
							await Promise.all([
								persistence.saveDocument(id, g),
								snapshotSaver.flushChanged(entries)
							]);
						}
					},
					docId,
					graph,
					{ onState: (s) => (saveState = s) }
				);
				docEditor = createDocEditor({
					element: editorEl,
					graph,
					docId,
					registry,
					resolveImageUrl: (storageId) => persistence.fileUrl(storageId),
					attachSheet,
					commitMutation,
					onChanged: () => saver?.scheduleSave(),
					onUndo: handleUndo,
					onRedo: handleRedo,
					// Chips re-render + flash on every settle (commit/undo/redo).
					onSettle: (cb) => session.onSettle(() => cb()),
					// Alt+click / Alt+Enter on a chip opens the inspector (V1-5-5).
					onInspect: (nodeId) => openInspector(nodeId, { focus: true }),
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
			document.removeEventListener('visibilitychange', onHide);
			window.removeEventListener('pagehide', flushAll);
		};
	});

	beforeNavigate(() => flushAll());

	onDestroy(() => {
		flushAll();
		docEditor?.destroy();
		docEditor = null;
		saver?.dispose();
		saver = null;
	});
</script>

<svelte:window onkeydown={onWindowKeydown} />

<svelte:head>
	<title>{title || 'Document'} · OctoMeta</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="wrap">
	<div class="toolbar">
		<a class="back mono" href="/app" data-testid="back">← documents</a>
		<span class="title" data-testid="doc-title">{title}</span>
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
		<span
			class="save mono"
			data-testid="save-state"
			data-save-state={saveState}
			class:error={saveState === 'error'}>{SAVE_LABEL[saveState]}</span
		>
	</div>

	{#if phase === 'missing'}
		<p class="notice">This document does not exist. <a href="/app">Back to documents.</a></p>
	{:else if phase === 'failed'}
		<p class="notice err" role="alert">Could not load the document.</p>
	{/if}

	<div
		class="editor"
		data-testid="editor"
		data-ready={phase === 'ready' ? 'true' : 'false'}
		bind:this={editorEl}
	></div>

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
	}
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
		color: var(--grey-2);
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
	.editor :global(.tiptap .ProseMirror-selectednode) {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
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
</style>
