<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import {
		ArrowDown,
		ArrowLeft,
		ArrowUp,
		Ellipsis,
		FileText,
		ImagePlus,
		PanelBottomClose,
		PanelBottomOpen,
		Redo2,
		Save,
		Sigma,
		Table2,
		Undo2
	} from '@lucide/svelte';
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
		createLocalWorkspaceRepository,
		createPersistenceActivityLog,
		createWorkspaceLease,
		describeLocalStorageFailure,
		hydrateGraph,
		localGraphRows,
		serializeLocalGraph,
		usePersistence,
		type DocumentId,
		type LocalWorkingCopyContent,
		type LocalStorageFailure,
		type SaveState,
		type WorkspaceLease,
		type WorkspaceLeaseState
	} from '$lib/persistence';
	import { authClient } from '$lib/auth-client';
	import {
		createWorkspaceController,
		resolveOwnerAccount,
		type WorkspaceController
	} from '$lib/workspace';
	import { createDocEditor, type DocEditor, type InsertableBlockType } from '$lib/editor';
	import {
		AdaptiveContainer,
		AppearanceControl,
		ComputationTrace,
		Icon,
		IconButton,
		SegmentedControl,
		Status
	} from '$lib/ui';
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
	// persist through the workspace controller as fenced local generations.

	const persistenceActivity = createPersistenceActivityLog();
	const persistence = usePersistence(persistenceActivity.observe);
	const localRepository = createLocalWorkspaceRepository({
		observe: persistenceActivity.observe
	});
	const authSession = authClient.useSession();
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
	let storageFailure = $state<LocalStorageFailure | null>(null);
	let online = $state(true);
	let leaseState = $state<WorkspaceLeaseState>('acquiring');
	let leaseMessage = $state('');
	let activeLeaseTab = $state('');
	let editorEl: HTMLDivElement;
	let imageInputEl: HTMLInputElement | undefined;
	/** Insertion-slot position for the next picked image (null = after selection). */
	let pendingImageAt: number | null = null;
	let parametersOpen = $state(false);
	let workbookOpen = $state(false);
	let workspaceFocus = $state<'document' | 'workbook'>('document');
	let moreOpen = $state(false);
	let moreRoot = $state<HTMLDivElement>();
	let moreButton = $state<HTMLButtonElement>();
	let versionNotice = $state('');
	let traceActive = $state(false);
	let traceTimer: ReturnType<typeof setTimeout> | null = null;
	let currentLayoutMode = $state<'compact' | 'regular' | 'expanded'>('compact');
	let layoutInitialized = false;
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

	/** Focus one workspace in compact mode while preserving the same surfaces. */
	function focusWorkspace(value: string): void {
		workspaceFocus = value === 'workbook' ? 'workbook' : 'document';
		workbookOpen = workspaceFocus === 'workbook';
	}

	/** Set the initial desktop composition without overriding later user choices. */
	function handleLayoutMode(next: 'compact' | 'regular' | 'expanded'): void {
		if (layoutInitialized && next === currentLayoutMode) return;
		currentLayoutMode = next;
		if (!layoutInitialized) {
			layoutInitialized = true;
			workbookOpen = next === 'expanded';
			workspaceFocus = 'document';
		} else if (!workbookOpen) {
			workspaceFocus = 'document';
		}
	}

	/** Explicitly reveal or dismiss the Workbook without changing its state. */
	function toggleWorkbook(): void {
		workbookOpen = !workbookOpen;
		if (currentLayoutMode === 'compact') {
			workspaceFocus = workbookOpen ? 'workbook' : 'document';
		}
	}

	$effect(() => {
		if (currentLayoutMode === 'compact') {
			workspaceFocus = workbookOpen ? 'workbook' : 'document';
		}
	});

	/** Preview the issue #10 entry point without creating a cloud version. */
	function previewSaveNewVersion(): void {
		versionNotice = 'Version review is not available yet. Your working copy remains on this device.';
	}

	function startTitleEdit(): void {
		if (leaseState !== 'owner') return;
		titleDraft = title;
		titleError = '';
		titleEditing = true;
	}

	function commitTitle(): void {
		if (!titleEditing) return;
		if (leaseState !== 'owner') {
			titleEditing = false;
			return;
		}
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
		title = next;
		workspace?.markChanged();
	}

	/** Escape closes the panel — except inside a grid, where Escape leaves the
	 * grid (the sheet NodeView stops propagation for that case anyway). */
	function onWindowKeydown(e: KeyboardEvent): void {
		if (e.key !== 'Escape') return;
		if (moreOpen) {
			moreOpen = false;
			queueMicrotask(() => moreButton?.focus());
			return;
		}
		if (inspectorTarget === null) return;
		if (e.target instanceof Element && e.target.closest('[data-sheet-block]')) return;
		closeInspector();
	}

	/** Toggle the labelled workbench popover and move focus into its content. */
	function toggleMore(): void {
		moreOpen = !moreOpen;
		if (!moreOpen) return;
		queueMicrotask(() =>
			moreRoot?.querySelector<HTMLElement>('.more-menu button, .more-menu a')?.focus()
		);
	}

	function dismissMoreFromPointer(event: PointerEvent): void {
		if (moreOpen && !moreRoot?.contains(event.target as Node)) moreOpen = false;
	}

	let graph: DocumentGraph;
	let registry: FunctionRegistry;
	let session: GraphSession = $state()!;
	let workspace: WorkspaceController | null = null;
	let lease: WorkspaceLease | null = null;
	let docEditor: DocEditor | null = null;
	let ownerAccountId = '';
	let loadedGeneration = 0;
	let pendingPeerGeneration = 0;
	let readonlyRefreshInFlight = false;
	let projectionRevision = $state(0);
	const canEdit = $derived(leaseState === 'owner');

	let workbookAdapter: WorkbookAdapter | null = $state(null);
	let restoredWorkbookSnapshot: unknown = $state(null);

	const SAVE_LABEL: Record<SaveState, string> = {
		idle: 'Stored on this device',
		pending: 'Saving locally…',
		saving: 'Saving locally…',
		error: 'Device save failed'
	};
	const COMPACT_SAVE_LABEL: Record<SaveState, string> = {
		idle: 'Stored',
		pending: 'Saving…',
		saving: 'Saving…',
		error: 'Save failed'
	};

	/** Refresh a read-only projection from a generation already stored by its owner. */
	async function refreshReadonlyIfStale(): Promise<void> {
		if (
			readonlyRefreshInFlight ||
			phase !== 'ready' ||
			leaseState !== 'readonly' ||
			pendingPeerGeneration <= loadedGeneration ||
			!ownerAccountId
		) {
			return;
		}
		readonlyRefreshInFlight = true;
		try {
			const local = await localRepository.load(ownerAccountId, String(docId), 'main');
			if (leaseState !== 'readonly') return;
			if (!local || local.generation <= loadedGeneration) {
				pendingPeerGeneration = loadedGeneration;
				return;
			}
			installWorkingCopy(ownerAccountId, local.content, local.generation);
			projectionRevision += 1;
		} catch (error) {
			pendingPeerGeneration = loadedGeneration;
			console.warn('read-only projection refresh failed:', error);
		} finally {
			readonlyRefreshInFlight = false;
			if (pendingPeerGeneration > loadedGeneration) void refreshReadonlyIfStale();
		}
	}

	/** The single write path through the framework-neutral workspace controller. */
	function commitMutation(m: GraphMutation): boolean {
		if (!canEdit) return false;
		const result = workspace?.commit(m);
		if (!result?.ok) {
			const message = result && !result.ok ? result.error.message : 'workspace not ready';
			console.warn('mutation rejected:', message);
			return false;
		}
		return true;
	}

	/** Editor projection writes are scheduled by the editor's `onChanged` signal. */
	function commitProjectionMutation(m: GraphMutation): boolean {
		if (!canEdit) return false;
		const result = workspace?.commitProjection(m);
		if (!result?.ok) {
			const message = result && !result.ok ? result.error.message : 'workspace not ready';
			console.warn('projection mutation rejected:', message);
			return false;
		}
		return true;
	}

	/** Install one durable working-copy generation into the current route. */
	function installWorkingCopy(
		accountId: string,
		content: LocalWorkingCopyContent,
		generation: number
	): void {
		const { graph: hydrated, mismatches } = hydrateGraph(localGraphRows(content.graph), {
			registry
		});
		if (mismatches.length > 0) {
			console.warn('reproducibility mismatches on load:', mismatches);
		}

		docEditor?.destroy();
		workspace?.dispose();
		workbookAdapter = null;
		title = content.title;
		graph = hydrated;
		session = createGraphSession({ doc: graph, registry, docId, actor: HUMAN });
		restoredWorkbookSnapshot = content.workbookSnapshot;
		loadedGeneration = generation;
		saveState = 'idle';
		storageFailure = null;

		workspace = createWorkspaceController({
			graph: session,
			title: () => title,
			local: {
				initialGeneration: generation,
				commit: async (expectedGeneration, captured) => {
					const committed = await localRepository.commit({
						accountId,
						documentId: String(docId),
						workspaceId: 'main',
						expectedGeneration,
						content: captured
					});
					loadedGeneration = committed.generation;
					lease?.announceStoredGeneration(committed.generation);
					return committed.generation;
				}
			},
			projection: {
				flushPendingChanges: () => docEditor?.flushProse(),
				renderSettledState: () => docEditor?.renderFromGraph()
			},
			workbookSnapshot: () =>
				workbookAdapter?.saveSnapshot() ?? $state.snapshot(restoredWorkbookSnapshot),
			activity: persistenceActivity,
			onSaveState: (state) => (saveState = state),
			onLocalSaveError: (error) => {
				storageFailure = error === null ? null : describeLocalStorageFailure(error);
			}
		});
		docEditor = createDocEditor({
			element: editorEl,
			editable: canEdit,
			graph,
			docId,
			registry,
			resolveImageUrl: (storageId) => persistence.fileUrl(storageId),
			commitMutation: commitProjectionMutation,
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
				if (!canEdit) {
					return { ok: false, message: 'This working copy is read-only.' };
				}
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
		session.onSettle((result) => {
			inspectorRevision += 1;
			if (result.affected.length === 0) return;
			traceActive = true;
			if (traceTimer !== null) clearTimeout(traceTimer);
			traceTimer = setTimeout(() => (traceActive = false), 700);
		});
		exposeCanvasHooks();
	}

	/**
	 * Engine-history undo/redo — the ONE stack spanning prose blockOps, cell
	 * edits, and name publishes. Runs through the session so every mounted
	 * sheet repaints its affected cells; in-grid Cmd/Ctrl+Z chords land here
	 * too (Univer's internal undo is suppressed by the sheet NodeView).
	 */
	function handleUndo(): void {
		if (!canEdit) return;
		workspace?.undo();
	}

	function handleRedo(): void {
		if (!canEdit) return;
		workspace?.redo();
	}

	/** Add a workbook tab; workbook tabs are not report blocks. */
	function insertSheet(): void {
		if (!canEdit) return;
		const result = workbookAdapter?.addSheet();
		if (result?.ok) workspace?.markChanged();
	}

	/** Upload the picked file, then add an image block — at the pending slot
	 * position when a slot initiated the pick, else after the current block. */
	async function insertImage(input: HTMLInputElement): Promise<void> {
		if (!canEdit) return;
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
		if (!docEditor || !canEdit) return;
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

	async function requestTakeover(): Promise<void> {
		leaseMessage = '';
		if (await lease?.requestTakeover()) location.reload();
	}

	async function retryLocalSave(): Promise<void> {
		try {
			await workspace?.flush();
		} catch {
			// The persistent recovery panel remains until a transaction succeeds.
		}
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
				undoCursor: () => graph.undoCursor,
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
				const accountId = resolveOwnerAccount(
					$authSession.data?.user.id,
					!navigator.onLine
				);
				if (!accountId) throw new Error('Authenticated account is unavailable.');
				ownerAccountId = accountId;
				lease = createWorkspaceLease({
					accountId,
					documentId: String(docId),
					workspaceId: 'main',
					flush: async () => {
						await workspace?.flush();
					},
					onStatus: (status) => {
						leaseState = status.state;
						leaseMessage = status.message ?? '';
						activeLeaseTab = status.activeTabId?.slice(0, 8) ?? '';
						const editable = status.state === 'owner';
						docEditor?.setEditable(editable);
						if (!editable) {
							titleEditing = false;
							parametersOpen = false;
						}
						void refreshReadonlyIfStale();
					},
					onStoredGeneration: (generation) => {
						pendingPeerGeneration = Math.max(pendingPeerGeneration, generation);
						void refreshReadonlyIfStale();
					}
				});
				await lease.start();
				if (cancelled) return;
				registry = createBuiltinRegistry();
				let local = await localRepository.load(accountId, String(docId), 'main');
				let content: LocalWorkingCopyContent;
				let initialGeneration: number;
				if (local) {
					content = local.content;
					initialGeneration = local.generation;
				} else {
					const loaded = await persistence.loadDocument(docId);
					if (cancelled) return;
					if (loaded.state !== 'live') {
						phase =
							loaded.state === 'integrity-error'
								? 'integrity'
								: loaded.state;
						return;
					}
					const hydratedCloud = hydrateGraph(loaded, { registry });
					if (hydratedCloud.mismatches.length > 0) {
						console.warn('reproducibility mismatches on load:', hydratedCloud.mismatches);
					}
					content = {
						title: loaded.document.title,
						graph: serializeLocalGraph(hydratedCloud.graph),
						workbookSnapshot: loaded.workbookSnapshot.snapshot
					};
					local = await localRepository.commit({
						accountId,
						documentId: String(docId),
						workspaceId: 'main',
						expectedGeneration: 0,
						cloudBase: {
							version: loaded.document.revision,
							bundleHash: loaded.document.bundleHash
						},
						content
					});
					initialGeneration = local.generation;
				}
				if (cancelled) return;
				installWorkingCopy(accountId, content, initialGeneration);
				phase = 'ready';
				void refreshReadonlyIfStale();
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
		if (traceTimer !== null) clearTimeout(traceTimer);
		const finalController = workspace;
		const finalFlush = finalController?.flush() ?? Promise.resolve();
		docEditor?.destroy();
		docEditor = null;
		workspace = null;
		void finalFlush.catch(() => {}).finally(() => {
			finalController?.dispose();
			lease?.dispose();
			lease = null;
			localRepository.close();
		});
	});
</script>

<svelte:window onkeydown={onWindowKeydown} />
<svelte:document onpointerdown={dismissMoreFromPointer} />

<svelte:head>
	<title>{title || 'Document'} · OctoMeta</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<AdaptiveContainer
	testId="workbench"
	class="workbench"
	onmodechange={handleLayoutMode}
>
	{#snippet children(layoutMode)}
<main
	class="wrap workbench-main"
	data-layout-mode={layoutMode}
	data-workspace-focus={workspaceFocus}
	data-workbook-open={workbookOpen}
>
	<p class="visually-hidden" role="status" aria-live="polite">{blockAnnouncement}</p>
	<header class="workbench-shell">
		<div class="shell-primary">
			<a class="back" href="/app" data-testid="back" aria-label="Back to Documents">
				<Icon glyph={ArrowLeft} size={18} />
				<span>Documents</span>
			</a>
			<div class="document-identity">
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
					<button
						class="title"
						data-testid="doc-title"
						type="button"
						disabled={!canEdit}
						onclick={startTitleEdit}>{title}</button
					>
				{/if}
				<span class="working-copy mono">Working copy</span>
			</div>
			<span class="grow"></span>
			<Status
				kind={saveState === 'error' || phase === 'failed' ? 'error' : 'neutral'}
				live="polite"
				testId="save-state"
				dataState={phase === 'ready' ? saveState : 'loading'}
			>
				{phase === 'ready'
					? layoutMode === 'compact'
						? COMPACT_SAVE_LABEL[saveState]
						: SAVE_LABEL[saveState]
					: phase === 'failed'
						? layoutMode === 'compact'
							? 'Storage unavailable'
							: 'Device storage unavailable'
						: layoutMode === 'compact'
							? 'Opening…'
							: 'Opening local copy…'}
			</Status>
			<button
				class="save-version"
				type="button"
				disabled={phase !== 'ready'}
				onclick={previewSaveNewVersion}
			>
				<Icon glyph={Save} size={18} />
				<span>Save new version</span>
			</button>
			<div class="more" bind:this={moreRoot}>
				<IconButton
					bind:element={moreButton}
					glyph={Ellipsis}
					label="More workbench actions"
					expanded={moreOpen}
					hasPopup="dialog"
					onclick={toggleMore}
				/>
				{#if moreOpen}
					<div
						class="more-menu ui-surface"
						data-surface="menu"
						role="dialog"
						aria-labelledby="workbench-popover-label"
					>
						<p class="menu-label" id="workbench-popover-label">Workbench actions</p>
						<AppearanceControl />
						<a href="/app">Back to Documents</a>
					</div>
				{/if}
			</div>
		</div>

		<div class="shell-context">
			{#if layoutMode === 'compact'}
				<SegmentedControl
					label="Workspace"
					options={[
						{ value: 'document', label: 'Document', glyph: FileText },
						{ value: 'workbook', label: 'Workbook', glyph: Table2 }
					]}
					value={workspaceFocus}
					onchange={focusWorkspace}
				/>
			{:else}
				<IconButton
					glyph={workbookOpen ? PanelBottomClose : PanelBottomOpen}
					label={workbookOpen ? 'Hide Workbook' : 'Show Workbook'}
					tooltip={workbookOpen ? 'Hide Workbook' : 'Show Workbook'}
					pressed={workbookOpen}
					onclick={toggleWorkbook}
				/>
			{/if}
			<div class="contextual-tools" aria-label="Contextual editing controls">
				<IconButton
					glyph={Undo2}
					label="Undo"
					tooltip="Undo (⌘Z)"
					testId="undo"
					disabled={phase !== 'ready' || !canEdit}
					onclick={handleUndo}
				/>
				<IconButton
					glyph={Redo2}
					label="Redo"
					tooltip="Redo (⇧⌘Z)"
					testId="redo"
					disabled={phase !== 'ready' || !canEdit}
					onclick={handleRedo}
				/>
				<IconButton
					glyph={ArrowUp}
					label="Move block up"
					tooltip="Move block up (⌥↑)"
					testId="move-up"
					disabled={phase !== 'ready' || !canEdit}
					onclick={() => docEditor?.moveSelectedBlock(-1)}
				/>
				<IconButton
					glyph={ArrowDown}
					label="Move block down"
					tooltip="Move block down (⌥↓)"
					testId="move-down"
					disabled={phase !== 'ready' || !canEdit}
					onclick={() => docEditor?.moveSelectedBlock(1)}
				/>
				<IconButton
					glyph={ImagePlus}
					label="Insert image"
					testId="insert-image-label"
					disabled={!canEdit}
					onclick={() => imageInputEl?.click()}
				/>
				<input
					class="visually-hidden"
					type="file"
					aria-label="Choose image file"
					accept="image/*"
					data-testid="image-input"
					disabled={!canEdit}
					bind:this={imageInputEl}
					onchange={(event) => void insertImage(event.currentTarget)}
				/>
				<IconButton
					glyph={Table2}
					label="Add Workbook sheet"
					testId="insert-sheet"
					disabled={phase !== 'ready' || !canEdit}
					onclick={insertSheet}
				/>
				<button
					class="tool labelled-tool"
					type="button"
					bind:this={parametersButton}
					aria-expanded={parametersOpen}
					disabled={phase !== 'ready' || !canEdit}
					onclick={() => (parametersOpen = !parametersOpen)}
				>
					<Icon glyph={Sigma} size={18} />
					<span>Parameters</span>
				</button>
			</div>
			<ComputationTrace
				active={traceActive}
				message="Computation complete. Dependent values updated."
				oninterrupt={() => (traceActive = false)}
			/>
		</div>
	</header>
	{#if versionNotice}
		<p class="version-notice" role="status">
			{versionNotice}
			<button type="button" onclick={() => (versionNotice = '')}>Dismiss</button>
		</p>
	{/if}
	{#if leaseState === 'unsupported'}
		<p class="lease-state err" data-testid="lease-status" role="alert">
			<strong>Read-only.</strong> {leaseMessage}
		</p>
	{:else if leaseState === 'readonly' || leaseState === 'taking-over'}
		<div class="lease-state" data-testid="lease-status" role="status">
			<p>
				<strong>Read-only.</strong>
				{leaseMessage ||
					`This working copy is open for editing in another tab${activeLeaseTab ? ` (${activeLeaseTab})` : ''}.`}
			</p>
			<button
				class="tool"
				type="button"
				disabled={leaseState === 'taking-over'}
				onclick={() => void requestTakeover()}
				>{leaseState === 'taking-over' ? 'Waiting for active tab…' : 'Take over editing'}</button
			>
		</div>
	{/if}
	{#if !online}
		<p class="offline" role="status">
			Offline. Changes continue to save on this device.
		</p>
	{/if}
	{#if storageFailure}
		<section
			class="storage-recovery"
			data-testid="storage-recovery"
			role="alert"
			aria-labelledby="storage-recovery-title"
		>
			<div>
				<strong id="storage-recovery-title">{storageFailure.title}.</strong>
				{storageFailure.guidance}
			</div>
			<button class="tool" type="button" onclick={() => void retryLocalSave()}>
				Retry local save
			</button>
		</section>
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
		class:read-only={!canEdit}
		data-testid="editor"
		data-ready={phase === 'ready' ? 'true' : 'false'}
		data-editable={phase === 'ready' && canEdit ? 'true' : 'false'}
		inert={phase === 'ready' && !canEdit}
		bind:this={editorEl}
	></div>

	{#if phase === 'ready'}
		{#key projectionRevision}
			<ParametersRail
				{session}
				mode={layoutMode}
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
				mode={layoutMode}
				snapshot={restoredWorkbookSnapshot}
				readonly={!canEdit}
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
		{/key}
	{/if}

	{#if inspectorTarget !== null && phase === 'ready'}
		<Inspector
			graph={inspectorSource}
			mode={layoutMode}
			nodeId={inspectorTarget}
			revision={inspectorRevision}
			focusTick={inspectorFocusTick}
			onnavigate={(nodeId) => openInspector(nodeId, { focus: false })}
			onclose={closeInspector}
		/>
	{/if}
</main>
	{/snippet}
</AdaptiveContainer>

<style>
	/* The canvas is full-page (notebook-style): sheets and images get the whole
	   viewport; `.wrap`'s side padding is all that frames it. */
	main {
		--workbook-panel-height: clamp(280px, 42dvh, 440px);
		max-width: none;
		height: 100dvh;
		min-height: 0;
		overflow-y: auto;
		padding-top: max(var(--s2), env(safe-area-inset-top));
		padding-bottom: calc(var(--s6) + env(safe-area-inset-bottom));
	}
	.workbench-main:is(
		[data-layout-mode='regular'],
		[data-layout-mode='expanded']
	)[data-workbook-open='true'] {
		height: calc(100dvh - var(--workbook-panel-height) - 44px);
	}
	.workbench-shell {
		position: sticky;
		top: 0;
		z-index: 35;
		margin: calc(-1 * max(var(--s2), env(safe-area-inset-top))) calc(-1 * var(--s3)) var(--s3);
		padding:
			max(var(--s1), env(safe-area-inset-top))
			max(var(--s3), env(safe-area-inset-right))
			var(--s1)
			max(var(--s3), env(safe-area-inset-left));
		border-bottom: 1px solid var(--border);
		background: var(--material);
		backdrop-filter: blur(var(--material-blur)) saturate(112%);
	}
	.shell-primary,
	.shell-context {
		display: flex;
		align-items: center;
		gap: var(--s1);
		min-width: 0;
	}
	.shell-context {
		margin-top: var(--s1);
	}
	.document-identity {
		display: grid;
		min-width: 0;
		margin-left: var(--s1);
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: var(--s1);
		min-height: 44px;
		color: var(--text-secondary);
		text-decoration: none;
	}
	.back:hover {
		color: var(--text);
	}
	.working-copy {
		color: var(--text-tertiary);
		font-size: .68rem;
		line-height: 1.1;
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
	.contextual-tools {
		display: flex;
		align-items: center;
		gap: var(--s1);
		margin-left: auto;
	}
	.labelled-tool {
		display: inline-flex;
		align-items: center;
		gap: var(--s1);
		min-height: 44px;
	}
	.save-version {
		display: inline-flex;
		align-items: center;
		gap: var(--s1);
		min-height: 40px;
		padding: 0 var(--s2);
		border: 1px solid var(--text);
		border-radius: var(--radius-control);
		background: var(--text);
		color: var(--canvas);
		font: 650 .82rem var(--font-body);
		cursor: pointer;
	}
	.save-version:disabled {
		opacity: .45;
		cursor: default;
	}
	.more { position: relative; }
	.more-menu {
		position: absolute;
		top: calc(100% + var(--s1));
		right: 0;
		display: grid;
		gap: var(--s1);
		width: 230px;
		padding: var(--s2);
	}
	.more-menu a {
		min-height: 36px;
		display: flex;
		align-items: center;
		color: var(--text);
		text-decoration: none;
	}
	.menu-label {
		margin: 0;
		color: var(--text-tertiary);
		font: 500 var(--fs-caption) var(--font-mono);
		text-transform: uppercase;
		letter-spacing: .08em;
	}
	.version-notice {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s2);
		margin: calc(-1 * var(--s2)) 0 var(--s2);
		padding: var(--s1) var(--s2);
		border: 1px solid var(--status-info);
		border-radius: var(--radius-control);
		background: var(--status-info-muted);
		color: var(--text);
		font-size: .82rem;
	}
	.version-notice button {
		min-height: 36px;
		border: 0;
		background: transparent;
		color: var(--status-info);
		cursor: pointer;
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
	.notice {
		color: var(--grey-1);
		margin-bottom: var(--s3);
	}
	.lease-state {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s2);
		margin: calc(-1 * var(--s2)) 0 var(--s2);
		padding: 7px 10px;
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-chip);
		color: var(--grey-1);
		font-size: .82rem;
	}
	.lease-state p { margin: 0; }
	.lease-state.err { border-color: var(--ink); }
	.storage-recovery {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s2);
		margin-bottom: var(--s2);
		padding: 10px;
		border: 1px solid var(--ink);
		border-radius: var(--radius-chip);
		background: var(--grey-4);
		color: var(--ink);
		font-size: .84rem;
	}
	.offline { margin: calc(-1 * var(--s2)) 0 var(--s2); padding: 7px 10px; border: 1px solid var(--warning, #9a6b00); border-radius: var(--radius-chip); color: var(--grey-1); font-size: .82rem; }

	/* The document itself — DESIGN.md: paper, hairlines, no shadows. */
	.editor :global(.tiptap) {
		min-height: 420px;
		outline: none;
	}
	.editor.read-only :global(.octo-insert-slot),
	.editor.read-only :global(.octo-block-chrome),
	.editor.read-only :global(.equation-controls) {
		pointer-events: none;
		opacity: .55;
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
	main[data-layout-mode='compact'] {
		padding-inline: var(--s2);
		padding-bottom: calc(var(--s6) + 72px + env(safe-area-inset-bottom));
	}
	main[data-layout-mode='compact'] .workbench-shell {
		margin-inline: calc(-1 * var(--s2));
		padding-inline: max(var(--s2), env(safe-area-inset-left));
		background: var(--surface);
		backdrop-filter: none;
	}
	main[data-layout-mode='compact'] .shell-primary {
		display: grid;
		grid-template-columns: 44px minmax(0, 1fr) auto 44px;
		gap: var(--s1);
	}
	main[data-layout-mode='compact'] .back {
		grid-column: 1;
		grid-row: 1;
	}
	main[data-layout-mode='compact'] .back span,
	main[data-layout-mode='compact'] .grow {
		display: none;
	}
	main[data-layout-mode='compact'] .document-identity {
		grid-column: 2;
		grid-row: 1;
		max-width: 100%;
		margin-left: 0;
	}
	main[data-layout-mode='compact'] .title {
		width: 100%;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: left;
	}
	main[data-layout-mode='compact'] .shell-primary :global(.status) {
		grid-column: 3;
		grid-row: 1;
		white-space: nowrap;
	}
	main[data-layout-mode='compact'] .more {
		grid-column: 4;
		grid-row: 1;
	}
	main[data-layout-mode='compact'] .save-version {
		grid-column: 1 / -1;
		grid-row: 2;
		justify-content: center;
		width: 100%;
	}
	main[data-layout-mode='compact'] .shell-context {
		position: fixed;
		z-index: 50;
		right: 0;
		bottom: 0;
		left: 0;
		margin: 0;
		padding:
			var(--s1)
			max(var(--s2), env(safe-area-inset-right))
			calc(var(--s1) + env(safe-area-inset-bottom))
			max(var(--s2), env(safe-area-inset-left));
		overflow-x: auto;
		border-top: 1px solid var(--border);
		background: var(--material);
		backdrop-filter: blur(var(--material-blur)) saturate(112%);
		scrollbar-width: none;
	}
	main[data-layout-mode='compact'] .contextual-tools {
		margin-left: var(--s1);
	}
	main[data-layout-mode='compact'] .contextual-tools .tool {
		min-height: 44px;
	}
	main[data-layout-mode='compact'] .shell-context :global(.trace) {
		display: none;
	}
	main[data-layout-mode='compact'] .editor {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	main[data-layout-mode='compact'] .editor :global(.equation-controls) {
		flex-wrap: wrap;
	}
	main[data-layout-mode='compact'] .editor :global(.equation-controls select) {
		max-width: 100%;
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
		/* These controls are keyboard/touch capability, so they cannot exist
		   only behind pointer hover. Their hairline remains the quiet layer. */
		opacity: 1;
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
		color: var(--tint-text);
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
