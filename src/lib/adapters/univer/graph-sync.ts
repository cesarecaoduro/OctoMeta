/**
 * V1-3-1 — the graph-facing half of the Univer adapter. Pure TypeScript over
 * the engine's public surface; no `@univerjs` imports, so every function here
 * unit-tests in node.
 *
 * Everything goes through `GraphSession.commit`, which wraps the engine's
 * `commit` (applyMutation + recalc). There is NO write path around
 * `applyMutation` (SCHEMA.md §9, cross-cutting rule 1) — the acceptance test
 * in graph-sync.test.ts replays the undo log onto a fresh graph and asserts
 * byte-identical state to prove it.
 *
 * Cell <-> node binding lives in the graph itself: the `DocumentGraph` cellRef
 * index (`resolveRef`) is the single binding source; the adapter keeps no
 * duplicate map.
 */

import type {
	Actor,
	CellRef,
	CommitResult,
	DocumentGraph as DocumentGraphType,
	FormulaAST,
	FunctionRegistry,
	GraphMutation,
	GraphNode,
	MutationError,
	NodeId,
	PublicationMetadata,
	Result,
	SheetId,
	TypedValue
} from '../../engine';
import {
	DocumentGraph,
	booleanValue,
	commit as engineCommit,
	commitRedo as engineCommitRedo,
	commitUndo as engineCommitUndo,
	createBuiltinRegistry,
	evaluateWithDerivations,
	emptyProvenance,
	parseFormula,
	scalar,
	stringValue,
	ulid
} from '../../engine';
import { cellRefFor, refersToCell, type ClassifiedEdit } from './cell-text';

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** Signature of the engine commit function (injectable for test spies). */
export type CommitFn = typeof engineCommit;

/**
 * One document graph plus everything the adapter needs to write to it. All
 * writes flow through `commit`; `onSettle` fans successful commit results out
 * to display projections (each mounted sheet listens and repaints its cells).
 */
export interface GraphSession {
	readonly doc: DocumentGraphType;
	readonly registry: FunctionRegistry;
	readonly docId: string;
	readonly actor: Actor;
	/** Apply one mutation and recalc (engine `commit`). The only write path. */
	commit(m: GraphMutation): Result<CommitResult, MutationError>;
	/**
	 * Engine-history undo/redo (SCHEMA.md §9) with the same settle fan-out as
	 * `commit`, so every mounted sheet repaints its affected cells. V1-5-2: the
	 * document page routes ALL undo/redo (page shortcut and in-grid chords)
	 * through these.
	 */
	undo(): Result<CommitResult, MutationError>;
	redo(): Result<CommitResult, MutationError>;
	/** Subscribe to successful commit results. Returns an unsubscriber. */
	onSettle(cb: (result: CommitResult) => void): () => void;
}

/** Options for `createGraphSession`; everything has a sensible default. */
export interface GraphSessionOptions {
	docId?: string;
	actor?: Actor;
	doc?: DocumentGraphType;
	registry?: FunctionRegistry;
	/** Injectable commit implementation (defaults to the engine's `commit`). */
	commitFn?: CommitFn;
}

/** Create a session around a (new or provided) DocumentGraph. */
export function createGraphSession(opts: GraphSessionOptions = {}): GraphSession {
	const doc = opts.doc ?? new DocumentGraph();
	const registry = opts.registry ?? createBuiltinRegistry();
	const actor = opts.actor ?? { kind: 'human' as const };
	const commitFn = opts.commitFn ?? engineCommit;
	const listeners = new Set<(result: CommitResult) => void>();
	const settle = (r: Result<CommitResult, MutationError>): Result<CommitResult, MutationError> => {
		if (r.ok) for (const cb of listeners) cb(r.value);
		return r;
	};
	// V1-5-4: every recalc through this session evaluates with the
	// derivation-capable evaluator, so `SHOWSTEPS(ref)` cells settle to real
	// derivation text instead of `#VALUE! 'SHOWSTEPS: derivation unavailable'`.
	const recalcOpts = { registry, evaluate: evaluateWithDerivations(doc) };
	return {
		doc,
		registry,
		docId: opts.docId ?? 'untitled',
		actor,
		commit(m) {
			return settle(commitFn(doc, m, actor, recalcOpts));
		},
		undo() {
			return settle(engineCommitUndo(doc, recalcOpts));
		},
		redo() {
			return settle(engineCommitRedo(doc, recalcOpts));
		},
		onSettle(cb) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		}
	};
}

/**
 * Make sure a workbook tab exists in the graph manifest (idempotent).
 * Workbook tabs are document state, never report blocks.
 */
export function ensureSheetBlock(session: GraphSession, sheetId: SheetId): void {
	if (!session.doc.sheet(sheetId)) {
		session.commit({
			op: 'workbookOp',
			action: 'add',
			sheet: {
				id: sheetId,
				name: `Sheet ${session.doc.workbook.sheets.length + 1}`,
				position: session.doc.workbook.sheets.length
			},
			activate: false
		});
	}
}

// ---------------------------------------------------------------------------
// Cell edits
// ---------------------------------------------------------------------------

/** What became of a cell edit routed through the graph. */
export type CellEditOutcome =
	/** The edit landed; `nodeId` is the cell's (possibly new) node. */
	| { kind: 'applied'; nodeId: NodeId }
	/** The cell's node was removed (cell cleared). */
	| { kind: 'cleared' }
	/** Nothing to do (clearing an unbound cell). */
	| { kind: 'noop' }
	/**
	 * The mutation was rejected; the graph kept its last valid state. `display`
	 * is what the cell should render (`#CYCLE!` for cycle rejections).
	 */
	| { kind: 'rejected'; display: string; message: string };

const FORMULA_KIND: GraphNode['kind'] = 'computed';

/**
 * Route one classified cell edit into the graph, creating/mutating/removing
 * the cell's node as needed:
 *
 * - value into an `input` node -> `setInput`
 * - formula into a `computed` node -> `setFormula` (engine parse, cycles
 *   rejected with `#CYCLE!`)
 * - kind changes (value <-> formula) -> `removeNode` + `addNode`; dependents
 *   heal through the graph's unresolved-ref index
 * - clear -> `removeNode` (dependents turn `#REF!`, SCHEMA.md §5)
 * - unparseable formula text -> stored verbatim as a string input (the user
 *   sees their typo; the inspector shows the truth)
 *
 * Every path is `session.commit` — nothing touches the graph directly.
 */
export function applyCellEdit(
	session: GraphSession,
	sheetId: SheetId,
	a1: string,
	edit: ClassifiedEdit
): CellEditOutcome {
	const ref = cellRefFor(sheetId, a1);
	const existingId = session.doc.resolveRef(ref);
	const existing = existingId !== undefined ? session.doc.nodes.get(existingId) : undefined;

	switch (edit.kind) {
		case 'invalid':
			return rejected(edit.message);
		case 'clear': {
			if (existingId === undefined) return { kind: 'noop' };
			const r = session.commit({ op: 'removeNode', id: existingId });
			return r.ok
				? { kind: 'cleared' }
				: { kind: 'rejected', display: '#VALUE!', message: r.error.message };
		}
		case 'value':
			return applyValueEdit(session, ref, existing, toTypedValue(edit.value));
		case 'formula': {
			const parsed = parseFormula(edit.text, { sheetId });
			if (!parsed.ok) {
				// Unparseable formula text: keep it visible as a string input.
				return applyValueEdit(session, ref, existing, stringValue(edit.text));
			}
			return applyFormulaEdit(session, ref, existing, parsed.ast);
		}
	}
}

function toTypedValue(value: number | string | boolean | TypedValue): TypedValue {
	if (typeof value === 'object') return value;
	if (typeof value === 'number') return scalar(value);
	if (typeof value === 'boolean') return booleanValue(value);
	return stringValue(value);
}

function rejected(message: string, display = '#VALUE!'): CellEditOutcome {
	return { kind: 'rejected', display, message };
}

function applyValueEdit(
	session: GraphSession,
	ref: CellRef,
	existing: GraphNode | undefined,
	value: TypedValue
): CellEditOutcome {
	let nodeId = existing?.id;
	if (existing && existing.kind !== 'input') {
		// Kind change (formula -> value): replace the node, dependents heal on re-add.
		const removed = session.commit({ op: 'removeNode', id: existing.id });
		if (!removed.ok) return rejected(removed.error.message);
		nodeId = undefined;
	}
	if (nodeId === undefined) {
		nodeId = ulid();
		const added = session.commit({
			op: 'addNode',
			node: {
				id: nodeId,
				kind: 'input',
				cellRef: ref,
				provenance: emptyProvenance()
			}
		});
		if (!added.ok) return rejected(added.error.message);
	}
	const set = session.commit({ op: 'setInput', id: nodeId, value });
	return set.ok ? { kind: 'applied', nodeId } : rejected(set.error.message);
}

function applyFormulaEdit(
	session: GraphSession,
	ref: CellRef,
	existing: GraphNode | undefined,
	ast: FormulaAST
): CellEditOutcome {
	if (existing && existing.kind === FORMULA_KIND) {
		const r = session.commit({ op: 'setFormula', id: existing.id, formula: ast });
		if (!r.ok) {
			return r.error.cycle
				? rejected(r.error.message, '#CYCLE!')
				: rejected(r.error.message);
		}
		return { kind: 'applied', nodeId: existing.id };
	}
	// Fresh cell or kind change. The engine's cycle pre-check runs against
	// resolved inputs, but a brand-new node's own-cell reference cannot resolve
	// yet — catch the direct self-reference here, before any structural change.
	if (refersToCell(ast, ref.sheetId, ref.a1)) {
		return rejected(`formula references its own cell ${ref.a1}`, '#CYCLE!');
	}
	if (existing) {
		const removed = session.commit({ op: 'removeNode', id: existing.id });
		if (!removed.ok) return rejected(removed.error.message);
	}
	const nodeId = ulid();
	const added = session.commit({
		op: 'addNode',
		node: {
			id: nodeId,
			kind: FORMULA_KIND,
			formula: ast,
			cellRef: ref,
			provenance: emptyProvenance()
		}
	});
	if (!added.ok) {
		return added.error.cycle
			? rejected(added.error.message, '#CYCLE!')
			: rejected(added.error.message);
	}
	return { kind: 'applied', nodeId };
}

// ---------------------------------------------------------------------------
// Published names (Univer defined names -> NamedOutputNodes)
// ---------------------------------------------------------------------------

/** Outcome of a name operation. */
export type NameOutcome = { ok: true; nodeId: NodeId } | { ok: false; message: string };

/**
 * Publish a dotted name on a cell (`publishName` mutation). When the cell has
 * no node yet (publishing an empty cell), an input node is created first,
 * seeded with `seed` (default scalar 0) so the name resolves immediately.
 */
export function publishCellName(
	session: GraphSession,
	sheetId: SheetId,
	a1: string,
	name: string,
	seed?: TypedValue,
	publication?: PublicationMetadata
): NameOutcome {
	const ref = cellRefFor(sheetId, a1);
	if (session.doc.resolveRef(ref) === undefined) {
		const created = applyValueEdit(session, ref, undefined, seed ?? scalar(0));
		if (created.kind === 'rejected') return { ok: false, message: created.message };
	}
	const r = session.commit({
		op: 'publishName',
		cellRef: ref,
		name,
		...(publication !== undefined && { publication })
	});
	if (!r.ok) return { ok: false, message: r.error.message };
	const nodeId = session.doc.resolveRef({ name });
	return nodeId !== undefined
		? { ok: true, nodeId }
		: { ok: false, message: `name "${name}" did not resolve after publish` };
}

/**
 * Rename a published name in one engine mutation. The alias NodeId is stable,
 * dependent formulas are rewritten atomically, and undo sees one user action.
 */
export function renamePublishedName(
	session: GraphSession,
	oldName: string,
	newName: string
): NameOutcome {
	const doc = session.doc;
	const oldId = doc.resolveRef({ name: oldName });
	if (oldId === undefined) return { ok: false, message: `unknown name "${oldName}"` };
	const oldNode = doc.nodes.get(oldId);
	if (!oldNode || oldNode.kind !== 'namedOutput') {
		return { ok: false, message: `"${oldName}" is not a published name` };
	}
	const renamed = session.commit({ op: 'renameName', nodeId: oldId, name: newName });
	return renamed.ok ? { ok: true, nodeId: oldId } : { ok: false, message: renamed.error.message };
}

/**
 * Unpublish a name (`removeNode` on its NamedOutputNode). Dependents settle
 * as `#NAME?` (unresolved published name) and heal if the name is ever
 * republished — the graph's unresolved-ref index keeps them registered.
 */
export function unpublishName(session: GraphSession, name: string): NameOutcome {
	const id = session.doc.resolveRef({ name });
	if (id === undefined) return { ok: false, message: `unknown name "${name}"` };
	const r = session.commit({ op: 'removeNode', id });
	return r.ok ? { ok: true, nodeId: id } : { ok: false, message: r.error.message };
}

// ---------------------------------------------------------------------------
// Read-side helpers (projection queries; no writes)
// ---------------------------------------------------------------------------

/** The graph node currently bound to a cell, via the graph's cellRef index. */
export function nodeForCell(
	session: GraphSession,
	sheetId: SheetId,
	a1: string
): GraphNode | undefined {
	const id = session.doc.resolveRef(cellRefFor(sheetId, a1));
	return id !== undefined ? session.doc.nodes.get(id) : undefined;
}

/** Every graph node hosted by (bound to a cell of) the given sheet block. */
export function nodesForSheet(session: GraphSession, sheetId: SheetId): GraphNode[] {
	const out: GraphNode[] = [];
	for (const node of session.doc.nodes.values()) {
		if (node.cellRef?.sheetId === sheetId) out.push(node);
	}
	return out;
}
