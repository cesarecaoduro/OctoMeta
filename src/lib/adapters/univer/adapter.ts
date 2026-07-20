/**
 * V1-3-1 — the sheet adapter: binds one live Univer instance to one sheet
 * block of a `DocumentGraph`. UI-framework-thin on purpose (no Svelte here) so
 * V1-5-2 can host it inside a TipTap NodeView unchanged.
 *
 * Data flow (the graph computes; Univer displays):
 *
 *   user edit -> Univer set-range-values -> classify -> `applyCellEdit`
 *     -> `session.commit` (applyMutation + recalc, the ONLY write path)
 *     -> settle listener -> `writeCellDisplay` into every affected cell
 *
 * Univer's own recalc is demoted to display structurally: the settled-value
 * write-back clears `f` from the cell, so no formula ever persists in the
 * Univer model and its engine has nothing to compute. The authored formula
 * lives in the graph as an AST (canonical text via `printFormula`); dotted
 * names like `beam.span` therefore work in any cell without Univer's parser
 * ever seeing them — interception after commit, before the next paint.
 *
 * Named ranges: Univer defined-name commands (insert/set/remove, from the UI
 * or the wrappers) are lifted into `publishName` / rename / `removeNode`
 * mutations. Renames follow Excel semantics: dependent formulas are rewritten
 * to the new name and keep resolving.
 */

import type { BlockId, TypedValue } from '../../engine';
import { booleanValue, scalar, stringValue } from '../../engine';
import type { IWorkbookData } from '@univerjs/presets';
import {
	DefinedNameBook,
	a1FromRowCol,
	classifyCellInput,
	formatCellDisplay,
	refStringToA1,
	type ClassifiedEdit
} from './cell-text';
import {
	applyCellEdit,
	ensureSheetBlock,
	nodesForSheet,
	publishCellName,
	renamePublishedName,
	unpublishName,
	type GraphSession
} from './graph-sync';
import {
	createUniverSheet,
	insertSheetDefinedName,
	onCellValuesChanged,
	onDefinedNameChanged,
	onSelectionChanged,
	onWorkbookMutated,
	readCellData,
	readCellValue,
	recalcAllFormulas,
	registerSheetFunctions,
	removeSheetDefinedName,
	renameSheetDefinedName,
	saveWorkbookSnapshot,
	writeCellDisplay,
	writeCellInput,
	type CellDisplayStyle,
	type ChangedCell,
	type Disposable,
	type UniverSheetHandle
} from './univer-api';
import { sheetStore } from './sheet-store';

/** Options for `attachSheetAdapter`. */
export interface SheetAdapterOptions {
	/** The shared graph session (one per document). */
	session: GraphSession;
	/** The sheet block this instance hosts (also the snapshot-store key). */
	blockId: BlockId;
	/** DOM element the grid mounts into. */
	container: HTMLElement;
	/** Workbook unit id; defaults to the block id. */
	unitId?: string;
	/** Workbook display name for a fresh sheet. */
	name?: string;
	/** Explicit snapshot; the block's `sheetStore` entry wins when present. */
	snapshot?: IWorkbookData | null;
}

/** A mounted sheet bound to the graph. All methods are display/projection-side. */
export interface SheetAdapter {
	/** The sheet block this adapter hosts. */
	readonly blockId: BlockId;
	/** Read a cell's displayed value (settled graph value). */
	getCell(a1: string): unknown;
	/** Read a cell's raw Univer payload (test hooks assert `f` was stripped). */
	getRawCell(a1: string): { v?: unknown; f?: unknown } | null;
	/** Programmatic user-style edit: `=...` is a formula, else a plain value. */
	setCellText(a1: string, input: number | string | boolean): void;
	/** Publish a dotted name on a cell through Univer's defined-name command. */
	publishName(a1: string, name: string): void;
	/** Rename a defined name owned by this workbook. False when unknown here. */
	renameName(oldName: string, newName: string): boolean;
	/** Delete a defined name owned by this workbook. False when unknown here. */
	deleteName(name: string): boolean;
	/** Serialize the workbook and stash it in `sheetStore` under the block id. */
	saveSnapshot(): IWorkbookData | null;
	/**
	 * Subscribe to workbook model mutations (anything a snapshot would change:
	 * cell writes, column widths, styles). The adapter's own display write-backs
	 * are excluded. V1-5-2 wires this to the document saver's dirty flag.
	 */
	onMutated(cb: () => void): () => void;
	/**
	 * Subscribe to USER cell-selection changes, read-only (V1-5-5 provenance
	 * inspector). Reports the anchor cell in A1 notation. Only selections made
	 * after the user first interacts with this grid fire — Univer's own
	 * mount-time A1 selection and other programmatic selections never do.
	 */
	onSelect(cb: (a1: string) => void): () => void;
	/** Flush the snapshot, detach every listener, dispose the Univer instance. */
	dispose(): void;
}

/**
 * Mount a Univer sheet for `blockId`, register the engine registry's functions
 * at lifecycle `Steady` (with `NO_CALCULATION` initial computing and one
 * explicit recalc after registration — docs/v1-0-findings.md landmine 1), wire
 * cell edits and defined names into the graph, and repaint cells from graph
 * settles. Existing graph nodes for the block are painted immediately, which
 * is also the snapshot-restore path: the graph is authoritative, the snapshot
 * only carries grid chrome.
 */
export async function attachSheetAdapter(opts: SheetAdapterOptions): Promise<SheetAdapter> {
	const { session, blockId, container } = opts;
	ensureSheetBlock(session, blockId);

	const handle: UniverSheetHandle = await createUniverSheet({
		container,
		unitId: opts.unitId ?? blockId,
		name: opts.name,
		snapshot: sheetStore.get(blockId) ?? opts.snapshot ?? null
	});
	const api = handle.api;
	const disposables: Disposable[] = [];

	// (a) Engine registry -> Univer custom functions, post-Steady, then one
	// explicit recalc. Errors bridge to their code text; scalars to numbers.
	disposables.push(
		...registerSheetFunctions(
			api,
			session.registry.list().map((sig) => ({
				name: sig.name,
				description: `OctoMeta ${sig.origin} function ${sig.name}`,
				fn: (...args: unknown[]) =>
					formatCellDisplay(session.registry.call(sig.name, bridgeArgs(args), { nodeId: '' }))
			}))
		)
	);
	recalcAllFormulas(api);

	// True while this adapter writes displays; its own change events are echoes.
	let applying = false;
	const writeDisplays = (writes: [string, number | string | null, CellDisplayStyle][]): void => {
		applying = true;
		try {
			for (const [a1, value, style] of writes) writeCellDisplay(api, a1, value, style);
		} finally {
			applying = false;
		}
	};

	// Calculated values render accent, error values render error red, typed
	// inputs plain ink — so a formula cell is visibly not "just a number".
	const displayStyle = (node: { formula?: unknown; value: TypedValue }): CellDisplayStyle =>
		node.value.kind === 'error' ? 'error' : node.formula ? 'computed' : null;

	// Cells this adapter has painted, by node id. When a settle reports an
	// affected node that no longer exists (undo of an add, blockOp cascades),
	// the map is the only way back to the cell that must be cleared.
	const boundCells = new Map<string, string>();

	// Paint the graph's current state for this block (fresh mount or restore).
	const initial: [string, number | string, CellDisplayStyle][] = [];
	for (const node of nodesForSheet(session, blockId)) {
		if (node.cellRef) {
			boundCells.set(node.id, node.cellRef.a1);
			initial.push([node.cellRef.a1, formatCellDisplay(node.value), displayStyle(node)]);
		}
	}
	if (initial.length > 0) writeDisplays(initial);

	// (b) Graph settle -> cell displays, for every affected cell of this block.
	// Handles undo/redo too: session.undo/redo fan out through the same path.
	const offSettle = session.onSettle((result) => {
		const ids = new Set([...result.affected, ...result.evaluated, ...result.cyclic]);
		const writes: [string, number | string | null, CellDisplayStyle][] = [];
		for (const id of ids) {
			const node = session.doc.nodes.get(id);
			if (node?.cellRef?.sheetBlockId === blockId) {
				boundCells.set(id, node.cellRef.a1);
				writes.push([node.cellRef.a1, formatCellDisplay(node.value), displayStyle(node)]);
			}
		}
		// Nodes that vanished since the last paint (undone adds, removeNode
		// cascades — the removed id is never in the affected set, SCHEMA.md §9
		// inverses restore, they do not re-report): clear their cells.
		for (const [id, a1] of boundCells) {
			if (!session.doc.nodes.has(id)) {
				boundCells.delete(id);
				writes.push([a1, null, null]);
			}
		}
		if (writes.length > 0) writeDisplays(writes);
	});

	// (b) User cell edits -> graph mutations. Deferred to a microtask so graph
	// commits and display write-backs run outside Univer's command execution.
	disposables.push(
		onCellValuesChanged(api, (cells) => {
			if (applying) return;
			queueMicrotask(() => processEdits(cells));
		})
	);

	function processEdits(cells: ChangedCell[]): void {
		for (const cell of cells) {
			// Style-only writes (no v/f/p key) never touch the graph.
			const touchesContent =
				cell.data === null || 'v' in cell.data || 'f' in cell.data || 'p' in cell.data;
			if (!touchesContent) continue;
			const a1 = a1FromRowCol(cell.row, cell.col);
			const edit = classifyCellInput(cell.data);
			const outcome = applyCellEdit(session, blockId, a1, edit);
			if (outcome.kind === 'rejected') {
				// The graph kept its last valid state; the cell renders the error
				// code (display only — no graph write happened).
				writeDisplays([[a1, outcome.display, 'error']]);
			} else if (outcome.kind === 'applied') {
				// The settle listener already painted dependents; repaint the edited
				// cell unconditionally so the authored `f` text is always replaced
				// by the settled value (Univer recalc demotion).
				const node = session.doc.nodes.get(outcome.nodeId);
				if (node) writeDisplays([[a1, formatCellDisplay(node.value), displayStyle(node)]]);
			}
		}
	}

	// (c) Defined-name lift: Univer command stream -> publishName / rename /
	// unpublish. The book keeps prior state by Univer's stable id, because the
	// rename command only carries the new name.
	const book = new DefinedNameBook();
	disposables.push(
		onDefinedNameChanged(api, (change) => {
			queueMicrotask(() => {
				const a1 = refStringToA1(change.ref);
				switch (change.type) {
					case 'insert': {
						book.recordInsert(change.id, change.name, a1);
						// Multi-cell/formula refs are unsupported in V1 (single-cell
						// publishes only); the graph is left untouched for those.
						if (a1) publishCellName(session, blockId, a1, change.name, seedFromCell(a1));
						return;
					}
					case 'update': {
						const prev = book.recordUpdate(change.id, change.name, a1);
						if (!prev) {
							if (a1) publishCellName(session, blockId, a1, change.name, seedFromCell(a1));
							return;
						}
						if (prev.name !== change.name) {
							renamePublishedName(session, prev.name, change.name);
						}
						if (a1 && a1 !== prev.a1) {
							// Re-pointed at a different cell: publishName rebinds the
							// existing NamedOutputNode to the new cell's node.
							publishCellName(session, blockId, a1, change.name, seedFromCell(a1));
						}
						return;
					}
					case 'remove': {
						const prev = book.recordRemove(change.id);
						unpublishName(session, prev?.name ?? change.name);
						return;
					}
				}
			});
		})
	);

	/** Seed for publishing a cell that has no node yet: its current content. */
	function seedFromCell(a1: string): TypedValue | undefined {
		const edit: ClassifiedEdit = classifyCellInput(readCellData(api, a1));
		if (edit.kind !== 'value') return undefined;
		if (typeof edit.value === 'number') return scalar(edit.value);
		if (typeof edit.value === 'boolean') return booleanValue(edit.value);
		return stringValue(edit.value);
	}

	// (d) V1-5-5: selection events are only meaningful once the USER touched
	// the grid — Univer seeds a programmatic A1 selection during mount, which
	// must never fire `onSelect` (it would open the inspector uninvited). Any
	// real interaction starts with a pointerdown inside the container
	// (keyboard selection moves require prior pointer focus, see sheet-node's
	// `enterGrid`), so that is the intent gate.
	let userTouched = false;
	const markTouched = (): void => {
		userTouched = true;
	};
	container.addEventListener('pointerdown', markTouched, { capture: true });

	const saveSnapshot = (): IWorkbookData | null => {
		const snapshot = saveWorkbookSnapshot(api);
		if (snapshot) sheetStore.set(blockId, snapshot);
		return snapshot;
	};

	return {
		blockId,
		getCell: (a1) => readCellValue(api, a1),
		getRawCell: (a1) => readCellData(api, a1),
		setCellText: (a1, input) => writeCellInput(api, a1, input),
		publishName: (a1, name) => insertSheetDefinedName(api, name, a1),
		renameName: (oldName, newName) => renameSheetDefinedName(api, oldName, newName),
		deleteName: (name) => removeSheetDefinedName(api, name),
		saveSnapshot,
		onMutated: (cb) => {
			// Skip echoes of this adapter's own display write-backs.
			const d = onWorkbookMutated(api, () => {
				if (!applying) cb();
			});
			disposables.push(d);
			return () => d.dispose();
		},
		onSelect: (cb) => {
			const d = onSelectionChanged(api, (anchor) => {
				if (!userTouched || applying || !anchor) return;
				cb(a1FromRowCol(anchor.row, anchor.col));
			});
			disposables.push(d);
			return () => d.dispose();
		},
		dispose: () => {
			saveSnapshot();
			container.removeEventListener('pointerdown', markTouched, { capture: true });
			offSettle();
			for (const d of disposables) d.dispose();
			handle.dispose();
		}
	};
}

/**
 * Coerce Univer formula arguments (primitives, 2D range arrays, defensive
 * fallbacks for boxed values) into engine `TypedValue`s. Ranges flatten into
 * individual arguments, matching the variadic built-ins.
 */
function bridgeArgs(args: unknown[]): TypedValue[] {
	const out: TypedValue[] = [];
	const push = (value: unknown): void => {
		if (Array.isArray(value)) {
			for (const item of value) push(item);
			return;
		}
		if (typeof value === 'number') out.push(scalar(value));
		else if (typeof value === 'boolean') out.push(booleanValue(value));
		else if (typeof value === 'string') out.push(stringValue(value));
		else if (value === null || value === undefined) out.push(scalar(0));
		else out.push(stringValue(String(value))); // boxed/lambda args: defensive
	};
	for (const arg of args) push(arg);
	return out;
}
