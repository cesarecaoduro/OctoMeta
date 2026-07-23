/**
 * V1-2-1 — the mutation API and undo log (SCHEMA.md §9, IMPLEMENTATION_PLAN.md
 * V1-2-1). `applyMutation` is the ONLY write path: every call validates first
 * (types, shapes, cycles), commits only if valid (an invalid mutation makes
 * zero partial writes), stamps provenance from the actor, and appends one
 * serializable `UndoEntry` whose inverses carry full prior state. It returns
 * the `AffectedSet` — recalc seeds for V1-2-2; no recalc happens here.
 *
 * Undo semantics (SCHEMA.md §9): one linear per-document history with a
 * cursor. `undo`/`redo` run through the same validated apply path but never
 * append entries; fresh mutations truncate the redo tail; the log caps at
 * `UNDO_CAP`, pruned oldest-first.
 */

import type {
	BlockId,
	CellRef,
	ErrorValue,
	NodeId,
	SheetId,
	SheetMeta,
	SheetProjection,
	TypedValue
} from './types';
import { ERR_CODES, errorValue, ulid } from './types';
import type { GraphNode, Provenance, PublicationMetadata } from './node';
import type { Block, ChipBinding } from './block';
import { BLOCK_TYPES } from './block';
import type { FormulaAST } from './formula';
import { isNameRef } from './formula';
import { wouldCycle } from './topo';
import type { DocumentGraph } from './graph';
import { collectRefs, refKey, stableStringify } from './graph';

// ---------------------------------------------------------------------------
// Types (SCHEMA.md §9)
// ---------------------------------------------------------------------------

/** Result object — the engine's boundary idiom: errors as values, never thrown. */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** Why a mutation was rejected. `cycle` lists the would-be cycle's members. */
export interface MutationError {
	message: string;
	cycle?: NodeId[];
}

/** Ids of nodes whose value/formula/inputs changed — the recalc seeds (V1-2-2). */
export type AffectedSet = NodeId[];

/** Who is mutating. Humans, templates, and (later) agents are all just actors. */
export type Actor = { kind: 'human' | 'template' | 'agent'; id?: string };

/** Undoable document-workbook operations. Univer mirrors these after commit. */
export type WorkbookMutation =
	| {
			op: 'workbookOp';
			action: 'add';
			sheet: SheetMeta;
			activate: boolean;
			projection?: SheetProjection;
	  }
	| {
			op: 'workbookOp';
			action: 'rename';
			sheetId: SheetId;
			name: string;
	  }
	| {
			op: 'workbookOp';
			action: 'remove';
			sheetId: SheetId;
			projection: SheetProjection;
	  };

/**
 * The mutation vocabulary (SCHEMA.md §9), plus two undo-internal ops:
 *
 * - `restoreNode` restores a node's full prior state verbatim (value, inputs,
 *   contentHash, provenance, pending) — §9's public ops cannot carry full
 *   prior state, and inverses are captured at apply time with exactly that.
 * - `restoreChip` is its chip-binding twin, used by `blockOp remove` inverses
 *   and by `chipOp remove` inverses (rebindChip is strict and cannot re-create
 *   a dropped binding).
 *
 * Projections NEVER issue either op; `applyMutation` rejects them — they are
 * reachable only through `undo`/`redo` replaying recorded inverses.
 *
 * `chipOp` (V1-5-3) is the chip *lifecycle* op: `create` registers a new
 * binding (chip id must be fresh; the bound node and hosting block must
 * exist), `remove` drops one. Rebinding an existing chip stays `rebindChip`.
 * Chips are projections, not nodes — chip ops never touch values, so their
 * AffectedSet is always empty and recalc has nothing to do.
 *
 * `publishName.nodeId` is stamped into the recorded entry at apply time when
 * a namedOutput node is created, so `redo` re-creates the identical node id.
 * Projections never set it.
 */
export type GraphMutation =
	| { op: 'setInput'; id: NodeId; value: TypedValue }
	| { op: 'setFormula'; id: NodeId; formula: FormulaAST }
	| { op: 'addNode'; node: Omit<GraphNode, 'value' | 'contentHash' | 'inputs'> }
	| { op: 'removeNode'; id: NodeId }
	| {
			op: 'publishName';
			cellRef: CellRef;
			name: string;
			nodeId?: NodeId;
			publication?: PublicationMetadata;
	  }
	| { op: 'renameName'; nodeId: NodeId; name: string }
	| { op: 'updatePublication'; nodeId: NodeId; publication: PublicationMetadata }
	| { op: 'rebindChip'; chipId: string; nodeId: NodeId }
	| WorkbookMutation
	| {
			op: 'chipOp';
			action: 'create' | 'remove';
			chipId: string;
			/** Required on `create`: the binding minus its id (id = `chipId`). */
			chip?: Omit<ChipBinding, 'id'>;
	  }
	| {
			op: 'blockOp';
			action: 'add' | 'remove' | 'move' | 'update';
			blockId: BlockId;
			block?: Partial<Block>;
			position?: number;
	  }
	| { op: 'restoreNode'; node: GraphNode }
	| { op: 'restoreChip'; chip: ChipBinding };

/** One undo-log entry (SCHEMA.md §9). Serializable JSON end to end. */
export interface UndoEntry {
	/** Monotonic per document. */
	seq: number;
	/** The mutation as applied (publishName carries its assigned nodeId). */
	mutation: GraphMutation;
	/** Inverses captured at apply time with full prior state (may be several). */
	inverse: GraphMutation[];
	actor: Actor;
	at: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const PUBLIC_OPS: ReadonlySet<string> = new Set([
	'setInput',
	'setFormula',
	'addNode',
	'removeNode',
	'publishName',
	'renameName',
	'updatePublication',
	'rebindChip',
	'chipOp',
	'blockOp',
	'workbookOp'
]);

/**
 * Apply one mutation — the sole write path (SCHEMA.md §9). Validates first;
 * an invalid mutation leaves the graph byte-identical. On success the entry
 * is appended to the undo log (truncating any redo tail, capping at 200) and
 * the AffectedSet is returned for recalc (V1-2-2) to seed from. Mutations do
 * NOT notify subscribers — recalc does, after values settle.
 */
export function applyMutation(
	doc: DocumentGraph,
	m: GraphMutation,
	actor: Actor
): Result<AffectedSet, MutationError> {
	if (!PUBLIC_OPS.has(m.op)) {
		return fail(`"${m.op}" is undo-internal; projections cannot issue it`);
	}
	const at = Date.now();
	const r = applyInternal(doc, m, actor, at);
	if (!r.ok) return r;
	doc.pushUndoEntry(structuredClone(r.value.recorded ?? m), r.value.inverse, actor, at);
	return { ok: true, value: r.value.affected };
}

/**
 * Undo the entry at the cursor: apply its inverses (in order) through the
 * same validated path, move the cursor down. Never appends entries. Errors
 * when nothing is undoable.
 */
export function undo(doc: DocumentGraph): Result<AffectedSet, MutationError> {
	if (doc.undoCursor === 0) return fail('nothing to undo');
	const entry = doc.undoLog[doc.undoCursor - 1];
	const affected: AffectedSet = [];
	for (const inverse of entry.inverse) {
		const r = applyInternal(doc, inverse, entry.actor, entry.at);
		if (!r.ok) return r;
		for (const id of r.value.affected) if (!affected.includes(id)) affected.push(id);
	}
	doc.undoCursor--;
	return { ok: true, value: affected };
}

/**
 * Redo the entry above the cursor: re-apply its recorded mutation through the
 * same validated path (with the entry's original timestamp, so provenance and
 * created ids reproduce exactly), move the cursor up. Never appends entries.
 */
export function redo(doc: DocumentGraph): Result<AffectedSet, MutationError> {
	if (doc.undoCursor >= doc.undoLog.length) return fail('nothing to redo');
	const entry = doc.undoLog[doc.undoCursor];
	const r = applyInternal(doc, entry.mutation, entry.actor, entry.at);
	if (!r.ok) return r;
	doc.undoCursor++;
	return { ok: true, value: r.value.affected };
}

// ---------------------------------------------------------------------------
// Internal apply (shared by fresh mutations, undo, and redo)
// ---------------------------------------------------------------------------

interface Applied {
	affected: AffectedSet;
	inverse: GraphMutation[];
	/** When set, this (not the caller's object) is recorded in the log. */
	recorded?: GraphMutation;
}

type ApplyResult = Result<Applied, MutationError>;

function fail(message: string): { ok: false; error: MutationError } {
	return { ok: false, error: { message } };
}

function failCycle(op: string, cycle: NodeId[]): { ok: false; error: MutationError } {
	const loop = [...cycle, cycle[0]].join(' -> ');
	return { ok: false, error: { message: `${op} would create a cycle: ${loop}`, cycle } };
}

function ok(value: Applied): ApplyResult {
	return { ok: true, value };
}

function applyInternal(
	doc: DocumentGraph,
	m: GraphMutation,
	actor: Actor,
	at: number
): ApplyResult {
	switch (m.op) {
		case 'setInput':
			return applySetInput(doc, m, actor, at);
		case 'setFormula':
			return applySetFormula(doc, m, actor, at);
		case 'addNode':
			return applyAddNode(doc, m, actor, at);
		case 'removeNode':
			return applyRemoveNode(doc, m);
		case 'publishName':
			return applyPublishName(doc, m, actor, at);
		case 'renameName':
			return applyRenameName(doc, m, actor, at);
		case 'updatePublication':
			return applyUpdatePublication(doc, m, actor, at);
		case 'rebindChip':
			return applyRebindChip(doc, m);
		case 'chipOp':
			return applyChipOp(doc, m);
		case 'blockOp':
			return applyBlockOp(doc, m, actor, at);
		case 'workbookOp':
			return applyWorkbookOp(doc, m, actor, at);
		case 'restoreNode': {
			// Verbatim restore; re-creates the node when absent. Only reachable
			// from undo/redo, whose callers discard inverses — so none returned.
			const node = structuredClone(m.node);
			doc.replaceNode(node);
			return ok({ affected: [node.id], inverse: [] });
		}
		case 'restoreChip': {
			doc.chips.set(m.chip.id, structuredClone(m.chip));
			return ok({ affected: [], inverse: [] });
		}
	}
}

// ---------------------------------------------------------------------------
// Per-op semantics
// ---------------------------------------------------------------------------

/** Node kinds allowed to carry a formula. */
const FORMULA_KINDS: readonly GraphNode['kind'][] = ['computed', 'namedOutput', 'table', 'geometry'];
const NODE_KINDS: readonly GraphNode['kind'][] = [
	'input',
	'computed',
	'namedOutput',
	'geometry',
	'table',
	'error'
];
/** Valid published names: dotted identifier path, e.g. "beam.span". */
const DOTTED_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const MAX_SHEETS = 32;
const MAX_TAB_PROJECTION_BYTES = 700 * 1024;

function applySetInput(
	doc: DocumentGraph,
	m: Extract<GraphMutation, { op: 'setInput' }>,
	actor: Actor,
	at: number
): ApplyResult {
	const node = doc.nodes.get(m.id);
	if (!node) return fail(`setInput: unknown node "${m.id}"`);
	if (node.kind !== 'input') {
		return fail(`setInput: node "${m.id}" is kind "${node.kind}", not "input"`);
	}
	const problem = valueProblem(m.value);
	if (problem) return fail(`setInput: malformed value (${problem})`);
	if (m.value.kind === 'error') return fail('setInput: error values cannot be authored');
	const prior = structuredClone(node);
	node.value = structuredClone(m.value);
	stamp(node, actor, at);
	doc.refreshHash(m.id);
	return ok({ affected: [m.id], inverse: [{ op: 'restoreNode', node: prior }] });
}

function applySetFormula(
	doc: DocumentGraph,
	m: Extract<GraphMutation, { op: 'setFormula' }>,
	actor: Actor,
	at: number
): ApplyResult {
	const node = doc.nodes.get(m.id);
	if (!node) return fail(`setFormula: unknown node "${m.id}"`);
	if (!FORMULA_KINDS.includes(node.kind)) {
		return fail(`setFormula: node "${m.id}" is kind "${node.kind}", which cannot hold a formula`);
	}
	const { inputs, firstUnresolved } = deriveRefs(doc, m.formula);
	const cycle = wouldCycle(m.id, inputs, doc.inputsOf);
	if (cycle) return failCycle('setFormula', cycle);
	const prior = structuredClone(node);
	const updated = structuredClone(node);
	updated.formula = structuredClone(m.formula);
	updated.inputs = inputs;
	if (firstUnresolved) updated.value = unresolvedError(firstUnresolved, m.id);
	stamp(updated, actor, at);
	doc.replaceNode(updated);
	doc.refreshHash(m.id);
	return ok({ affected: [m.id], inverse: [{ op: 'restoreNode', node: prior }] });
}

function applyAddNode(
	doc: DocumentGraph,
	m: Extract<GraphMutation, { op: 'addNode' }>,
	actor: Actor,
	at: number
): ApplyResult {
	const n = m.node;
	if (!n || typeof n.id !== 'string' || n.id === '') return fail('addNode: node id required');
	if (doc.nodes.has(n.id)) return fail(`addNode: id "${n.id}" already exists`);
	if (!NODE_KINDS.includes(n.kind)) return fail(`addNode: unknown kind "${String(n.kind)}"`);
	if (n.name !== undefined) {
		if (!DOTTED_NAME_RE.test(n.name)) return fail(`addNode: invalid name "${n.name}"`);
		if (doc.resolveRef({ name: n.name }) !== undefined) {
			return fail(`addNode: name "${n.name}" is already published`);
		}
	}
	if (n.cellRef !== undefined && doc.resolveRef(n.cellRef) !== undefined) {
		return fail(`addNode: cell ${n.cellRef.a1} is already bound to a node`);
	}
	if (n.formula !== undefined && !FORMULA_KINDS.includes(n.kind)) {
		return fail(`addNode: kind "${n.kind}" cannot hold a formula`);
	}
	// Seed value: '#VALUE! not yet evaluated' placeholder — the mutation layer
	// never evaluates; recalc (V1-2-2) settles real values from the AffectedSet.
	const node: GraphNode = {
		...structuredClone(n),
		value: errorValue('#VALUE!', 'not yet evaluated', n.id),
		inputs: [],
		contentHash: ''
	};
	if (node.formula) {
		const { inputs, firstUnresolved } = deriveRefs(doc, node.formula);
		const cycle = wouldCycle(node.id, inputs, doc.inputsOf);
		if (cycle) return failCycle('addNode', cycle);
		node.inputs = inputs;
		if (firstUnresolved) node.value = unresolvedError(firstUnresolved, node.id);
	}
	stamp(node, actor, at);
	doc.insertNode(node);
	doc.refreshHash(node.id);
	const inverse: GraphMutation[] = [{ op: 'removeNode', id: node.id }];
	const affected: AffectedSet = [node.id];
	healWaiters(doc, node, inverse, affected);
	return ok({ affected, inverse });
}

function applyRemoveNode(
	doc: DocumentGraph,
	m: Extract<GraphMutation, { op: 'removeNode' }>
): ApplyResult {
	const node = doc.nodes.get(m.id);
	if (!node) return fail(`removeNode: unknown node "${m.id}"`);
	const inverse: GraphMutation[] = [{ op: 'restoreNode', node: structuredClone(node) }];
	const affected: AffectedSet = [];
	const dependentIds = doc.dependentsOf(m.id);
	doc.deleteNode(m.id);
	// Marimo semantics (SCHEMA.md §5): dependents' refs become #REF! NOW.
	// Error origin is the dependent's own id — the removed node no longer
	// exists, so it is the first *surviving* failing node to deep-link to.
	for (const depId of dependentIds) {
		const dep = doc.nodes.get(depId);
		if (!dep) continue;
		inverse.push({ op: 'restoreNode', node: structuredClone(dep) });
		const updated = structuredClone(dep);
		updated.inputs = dep.inputs.filter((input) => input !== m.id);
		updated.value = errorValue('#REF!', `input "${m.id}" was removed`, depId);
		// replaceNode re-derives the unresolved-ref index from the formula, so
		// the dangling refs are recorded and a later re-add heals them.
		doc.replaceNode(updated);
		doc.refreshHash(depId);
		affected.push(depId);
	}
	return ok({ affected, inverse });
}

function applyPublishName(
	doc: DocumentGraph,
	m: Extract<GraphMutation, { op: 'publishName' }>,
	actor: Actor,
	at: number
): ApplyResult {
	if (typeof m.name !== 'string' || !DOTTED_NAME_RE.test(m.name)) {
		return fail(`publishName: invalid name "${String(m.name)}"`);
	}
	const cellId = doc.resolveRef(m.cellRef);
	if (cellId === undefined) {
		return fail(`publishName: cell ${m.cellRef.a1} is not bound to a node`);
	}
	const publicationProblem = validatePublicationMetadata(m.publication);
	if (publicationProblem) return fail(`publishName: ${publicationProblem}`);
	const existingId = doc.resolveRef({ name: m.name });
	if (existingId !== undefined) {
		// Rebind: the existing namedOutput now aliases the new cell.
		const named = doc.nodes.get(existingId) as GraphNode;
		if (named.kind !== 'namedOutput') {
			return fail(`publishName: name "${m.name}" belongs to a ${named.kind} node`);
		}
		const cycle = wouldCycle(existingId, [cellId], doc.inputsOf);
		if (cycle) return failCycle('publishName', cycle);
		const prior = structuredClone(named);
		const updated = structuredClone(named);
		updated.formula = { t: 'ref', ref: structuredClone(m.cellRef) };
		updated.inputs = [cellId];
		if (m.publication !== undefined) updated.publication = structuredClone(m.publication);
		stamp(updated, actor, at);
		doc.replaceNode(updated);
		doc.refreshHash(existingId);
		return ok({ affected: [existingId], inverse: [{ op: 'restoreNode', node: prior }] });
	}
	// Create a namedOutput aliasing the cell. `m.nodeId` is only ever present
	// on redo (stamped below), keeping the recreated node id identical.
	const id = m.nodeId ?? ulid();
	if (doc.nodes.has(id)) return fail(`publishName: id "${id}" already exists`);
	const cellNode = doc.nodes.get(cellId) as GraphNode;
	const node: GraphNode = {
		id,
		kind: 'namedOutput',
		name: m.name,
		formula: { t: 'ref', ref: structuredClone(m.cellRef) },
		// Seeded from the cell's current value so chips render immediately;
		// recalc re-evaluates from the AffectedSet either way.
		value: structuredClone(cellNode.value),
		inputs: [cellId],
		contentHash: '',
		...(m.publication !== undefined && { publication: structuredClone(m.publication) }),
		provenance: { authoredBy: null }
	};
	stamp(node, actor, at);
	doc.insertNode(node);
	doc.refreshHash(id);
	const inverse: GraphMutation[] = [{ op: 'removeNode', id }];
	const affected: AffectedSet = [id];
	healWaiters(doc, node, inverse, affected);
	return ok({ affected, inverse, recorded: { ...m, nodeId: id } });
}

function applyUpdatePublication(
	doc: DocumentGraph,
	m: Extract<GraphMutation, { op: 'updatePublication' }>,
	actor: Actor,
	at: number
): ApplyResult {
	const node = doc.nodes.get(m.nodeId);
	if (node?.kind !== 'namedOutput') {
		return fail(`updatePublication: node "${m.nodeId}" is not a published value`);
	}
	const problem = validatePublicationMetadata(m.publication);
	if (problem) return fail(`updatePublication: ${problem}`);
	const prior = structuredClone(node);
	const updated = structuredClone(node);
	updated.publication = structuredClone(m.publication);
	stamp(updated, actor, at);
	doc.replaceNode(updated);
	return ok({
		affected: [],
		inverse: [{ op: 'restoreNode', node: prior }]
	});
}

function applyRenameName(
	doc: DocumentGraph,
	m: Extract<GraphMutation, { op: 'renameName' }>,
	actor: Actor,
	at: number
): ApplyResult {
	const named = doc.nodes.get(m.nodeId);
	if (!named) return fail(`renameName: unknown node "${m.nodeId}"`);
	if (named.kind !== 'namedOutput' || named.name === undefined) {
		return fail(`renameName: node "${m.nodeId}" is not a published name`);
	}
	if (!DOTTED_NAME_RE.test(m.name)) {
		return fail(`renameName: invalid name "${String(m.name)}"`);
	}
	if (m.name === named.name) return fail(`renameName: name is already "${m.name}"`);
	const owner = doc.resolveRef({ name: m.name });
	if (owner !== undefined && owner !== named.id) {
		return fail(`renameName: name "${m.name}" is already published`);
	}

	const oldName = named.name;
	const inverse: GraphMutation[] = [{ op: 'restoreNode', node: structuredClone(named) }];
	const affected: AffectedSet = [named.id];
	const renamed = structuredClone(named);
	renamed.name = m.name;
	stamp(renamed, actor, at);
	doc.replaceNode(renamed);
	doc.refreshHash(renamed.id);

	for (const node of [...doc.nodes.values()]) {
		if (!node.formula || node.id === renamed.id) continue;
		const rewritten = rewritePublishedName(node.formula, oldName, m.name);
		if (!rewritten.changed) continue;
		inverse.push({ op: 'restoreNode', node: structuredClone(node) });
		const updated = structuredClone(node);
		updated.formula = rewritten.formula;
		doc.replaceNode(updated);
		doc.refreshHash(updated.id);
		affected.push(updated.id);
	}

	healWaiters(doc, renamed, inverse, affected);
	return ok({ affected: [...new Set(affected)], inverse });
}

function validatePublicationMetadata(metadata: PublicationMetadata | undefined): string | null {
	if (metadata === undefined) return null;
	if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
		return 'publication metadata must be an object';
	}
	for (const [field, limit] of [
		['label', 120],
		['unit', 32],
		['description', 500]
	] as const) {
		const value = metadata[field];
		if (value === undefined) continue;
		if (typeof value !== 'string') return `${field} must be a string`;
		if (value !== value.trim()) return `${field} must not have surrounding whitespace`;
		if (value.length === 0 || value.length > limit) {
			return `${field} must contain 1–${limit} characters`;
		}
	}
	return null;
}

function applyWorkbookOp(
	doc: DocumentGraph,
	m: WorkbookMutation,
	actor: Actor,
	at: number
): ApplyResult {
	switch (m.action) {
		case 'add': {
			const problem = sheetProblem(doc, m.sheet);
			if (problem) return fail(`workbookOp add: ${problem}`);
			if (doc.workbook.sheets.length >= MAX_SHEETS) {
				return fail(`workbookOp add: workbook cannot exceed ${MAX_SHEETS} tabs`);
			}
			if (m.projection) {
				const projectionProblem = sheetProjectionProblem(m.projection, m.sheet.id);
				if (projectionProblem) return fail(`workbookOp add: ${projectionProblem}`);
			}
			doc.insertSheet(m.sheet);
			return ok({
				affected: [],
				inverse: [
					{
						op: 'workbookOp',
						action: 'remove',
						sheetId: m.sheet.id,
						projection:
							m.projection ??
							({
								version: 1,
								sheetId: m.sheet.id,
								wasActive: m.activate,
								snapshot: null
							} satisfies SheetProjection)
					}
				]
			});
		}
		case 'rename': {
			const sheet = doc.sheet(m.sheetId);
			if (!sheet) return fail(`workbookOp rename: unknown tab "${m.sheetId}"`);
			const nameProblem = sheetNameProblem(doc, m.name, m.sheetId);
			if (nameProblem) return fail(`workbookOp rename: ${nameProblem}`);
			const priorName = sheet.name;
			doc.renameSheet(m.sheetId, m.name);
			return ok({
				affected: [],
				inverse: [
					{ op: 'workbookOp', action: 'rename', sheetId: m.sheetId, name: priorName }
				]
			});
		}
		case 'remove': {
			const sheet = doc.sheet(m.sheetId);
			if (!sheet) return fail(`workbookOp remove: unknown tab "${m.sheetId}"`);
			if (doc.workbook.sheets.length === 1) {
				return fail('workbookOp remove: the last tab cannot be deleted');
			}
			const projectionProblem = sheetProjectionProblem(m.projection, m.sheetId);
			if (projectionProblem) return fail(`workbookOp remove: ${projectionProblem}`);

			const hostedIds = [...doc.nodes.values()]
				.filter((node) => isHostedBySheet(node, m.sheetId))
				.map((node) => node.id);
			let nodeInverses: GraphMutation[] = [];
			const affected: AffectedSet = [];
			for (const id of hostedIds) {
				if (!doc.nodes.has(id)) continue;
				const result = applyInternal(doc, { op: 'removeNode', id }, actor, at);
				if (!result.ok) return result;
				nodeInverses = [...result.value.inverse, ...nodeInverses];
				for (const nodeId of result.value.affected) {
					if (!affected.includes(nodeId)) affected.push(nodeId);
				}
			}
			doc.deleteSheet(m.sheetId);
			return ok({
				affected: affected.filter((id) => doc.nodes.has(id)),
				inverse: [
					{
						op: 'workbookOp',
						action: 'add',
						sheet: structuredClone(sheet),
						activate: m.projection.wasActive,
						projection: structuredClone(m.projection)
					},
					...nodeInverses
				]
			});
		}
	}
}

function applyRebindChip(
	doc: DocumentGraph,
	m: Extract<GraphMutation, { op: 'rebindChip' }>
): ApplyResult {
	// Strict: rebind never creates. Chip bindings arrive via `chipOp create`
	// (V1-5-3) or direct doc.chips seeding in tests.
	const chip = doc.chips.get(m.chipId);
	if (!chip) return fail(`rebindChip: unknown chip "${m.chipId}"`);
	if (!doc.nodes.has(m.nodeId)) return fail(`rebindChip: unknown node "${m.nodeId}"`);
	const priorNodeId = chip.nodeId;
	chip.nodeId = m.nodeId;
	// Chips are projections, not nodes — nothing to recalc.
	return ok({
		affected: [],
		inverse: [{ op: 'rebindChip', chipId: m.chipId, nodeId: priorNodeId }]
	});
}

/**
 * Chip lifecycle (V1-5-3). `create` requires a fresh chip id, an existing
 * bound node, and an existing hosting block; its inverse is `chipOp remove`.
 * `remove` drops the binding; its inverse is the undo-internal `restoreChip`
 * carrying the full prior binding. Chips are projections — AffectedSet is
 * always empty (nothing to recalc).
 */
function applyChipOp(doc: DocumentGraph, m: Extract<GraphMutation, { op: 'chipOp' }>): ApplyResult {
	if (typeof m.chipId !== 'string' || m.chipId === '') return fail('chipOp: chipId is required');
	switch (m.action) {
		case 'create': {
			if (doc.chips.has(m.chipId)) return fail(`chipOp create: chip "${m.chipId}" already exists`);
			const c = m.chip;
			if (!c) return fail('chipOp create: a chip payload is required');
			if (typeof c.blockId !== 'string' || !doc.blocks.has(c.blockId)) {
				return fail(`chipOp create: unknown block "${String(c.blockId)}"`);
			}
			if (typeof c.nodeId !== 'string' || !doc.nodes.has(c.nodeId)) {
				return fail(`chipOp create: unknown node "${String(c.nodeId)}"`);
			}
			const chip: ChipBinding = {
				id: m.chipId,
				blockId: c.blockId,
				nodeId: c.nodeId,
				...(c.format !== undefined ? { format: structuredClone(c.format) } : {})
			};
			doc.chips.set(chip.id, chip);
			return ok({
				affected: [],
				inverse: [{ op: 'chipOp', action: 'remove', chipId: m.chipId }]
			});
		}
		case 'remove': {
			const chip = doc.chips.get(m.chipId);
			if (!chip) return fail(`chipOp remove: unknown chip "${m.chipId}"`);
			doc.chips.delete(m.chipId);
			return ok({
				affected: [],
				inverse: [{ op: 'restoreChip', chip: structuredClone(chip) }]
			});
		}
	}
}

/** Block fields `blockOp update` may never touch (order is owned by add/move/remove). */
const PROTECTED_BLOCK_KEYS: readonly string[] = ['docId', 'type', 'position'];
const MAX_TEX_LENGTH = 10_000;

/** Validate the exact equation payload accepted by the R1 engine contract. */
function validEquationPayload(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	const payload = value as Record<string, unknown>;
	if (payload.mode === 'static') {
		return (
			Object.keys(payload).length === 2 &&
			typeof payload.tex === 'string' &&
			payload.tex.length <= MAX_TEX_LENGTH
		);
	}
	return (
		payload.mode === 'bound' &&
		Object.keys(payload).length === 3 &&
		typeof payload.nodeId === 'string' &&
		payload.nodeId.length > 0 &&
		['symbolic', 'substituted', 'result', 'steps'].includes(String(payload.display))
	);
}

function applyBlockOp(
	doc: DocumentGraph,
	m: Extract<GraphMutation, { op: 'blockOp' }>,
	actor: Actor,
	at: number
): ApplyResult {
	switch (m.action) {
		case 'add': {
			if (doc.blocks.has(m.blockId)) return fail(`blockOp add: block "${m.blockId}" exists`);
			const b = m.block;
			if (!b) return fail('blockOp add: a full block is required');
			if (typeof b.docId !== 'string' || b.docId === '') {
				return fail('blockOp add: block.docId is required');
			}
			if (b.type === undefined || !BLOCK_TYPES.includes(b.type)) {
				return fail(`blockOp add: invalid block type "${String(b.type)}"`);
			}
			if (b.id !== undefined && b.id !== m.blockId) {
				return fail(`blockOp add: block.id "${b.id}" does not match blockId "${m.blockId}"`);
			}
			if (b.type === 'equation' && !validEquationPayload(b.equation)) {
				return fail('blockOp add: equation payload is required and must be valid');
			}
			if (b.type !== 'equation' && b.equation !== undefined) {
				return fail('blockOp add: equation payload is only valid on equation blocks');
			}
			const block = { ...structuredClone(b), id: m.blockId, position: 0 } as Block;
			doc.insertBlock(block, m.position);
			return ok({
				affected: [],
				inverse: [{ op: 'blockOp', action: 'remove', blockId: m.blockId }]
			});
		}
		case 'remove': {
			const block = doc.blocks.get(m.blockId);
			if (!block) return fail(`blockOp remove: unknown block "${m.blockId}"`);
			const priorIndex = doc.blocksOrder.indexOf(m.blockId);
			const priorBlock = structuredClone(block);
			const chipInverses: GraphMutation[] = [];
			for (const chip of doc.chips.values()) {
				if (chip.blockId === m.blockId) {
					chipInverses.push({ op: 'restoreChip', chip: structuredClone(chip) });
				}
			}
			// Cascade: remove every node hosted by this block, with full inverse
			// capture. Later sub-removals see earlier ones' #REF! conversions, so
			// inverse groups are PREPENDED — undo replays them newest-first.
			const hostedIds = [...doc.nodes.values()]
				.filter((node) => node.blockId === m.blockId)
				.map((node) => node.id);
			let nodeInverses: GraphMutation[] = [];
			const affected: AffectedSet = [];
			for (const id of hostedIds) {
				if (!doc.nodes.has(id)) continue;
				const r = applyInternal(doc, { op: 'removeNode', id }, actor, at);
				if (!r.ok) return r;
				nodeInverses = [...r.value.inverse, ...nodeInverses];
				for (const a of r.value.affected) if (!affected.includes(a)) affected.push(a);
			}
			for (const [chipId, chip] of [...doc.chips]) {
				if (chip.blockId === m.blockId) doc.chips.delete(chipId);
			}
			doc.deleteBlock(m.blockId);
			return ok({
				// Only surviving nodes seed recalc — in-block dependents that were
				// themselves removed later in the cascade are filtered out.
				affected: affected.filter((id) => doc.nodes.has(id)),
				inverse: [
					{
						op: 'blockOp',
						action: 'add',
						blockId: m.blockId,
						block: priorBlock,
						position: priorIndex
					},
					...chipInverses,
					...nodeInverses
				]
			});
		}
		case 'move': {
			if (!doc.blocks.has(m.blockId)) return fail(`blockOp move: unknown block "${m.blockId}"`);
			if (typeof m.position !== 'number') return fail('blockOp move: position is required');
			const priorIndex = doc.blocksOrder.indexOf(m.blockId);
			doc.moveBlock(m.blockId, m.position);
			return ok({
				affected: [],
				inverse: [{ op: 'blockOp', action: 'move', blockId: m.blockId, position: priorIndex }]
			});
		}
		case 'update': {
			const block = doc.blocks.get(m.blockId);
			if (!block) return fail(`blockOp update: unknown block "${m.blockId}"`);
			if (!m.block) return fail('blockOp update: block fields are required');
			// Shallow merge; identity and layout fields are off limits. A null
			// field value CLEARS the field (JSON-safe inverse for added fields).
			const entries = Object.entries(m.block).filter(([key, value]) => {
				if (key === 'id') {
					if (value !== undefined && value !== m.blockId) return true;
					return false;
				}
				return value !== undefined;
			});
			for (const [key] of entries) {
				if (key === 'id') return fail('blockOp update: cannot change block id');
				if (PROTECTED_BLOCK_KEYS.includes(key)) {
					return fail(`blockOp update: cannot change "${key}"`);
				}
			}
			const equationUpdate = entries.find(([key]) => key === 'equation');
			if (equationUpdate) {
				if (block.type !== 'equation') {
					return fail('blockOp update: equation payload is only valid on equation blocks');
				}
				if (!validEquationPayload(equationUpdate[1])) {
					return fail('blockOp update: equation payload must be valid');
				}
			}
			const target = block as unknown as Record<string, unknown>;
			const priorPartial: Record<string, unknown> = {};
			for (const [key, value] of entries) {
				priorPartial[key] = target[key] !== undefined ? structuredClone(target[key]) : null;
				if (value === null) delete target[key];
				else target[key] = structuredClone(value);
			}
			return ok({
				affected: [],
				inverse: [
					{
						op: 'blockOp',
						action: 'update',
						blockId: m.blockId,
						block: priorPartial as unknown as Partial<Block>
					}
				]
			});
		}
	}
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function sheetProblem(doc: DocumentGraph, sheet: SheetMeta): string | null {
	if (typeof sheet.id !== 'string' || sheet.id === '') return 'tab id is required';
	if (doc.sheet(sheet.id)) return `tab id "${sheet.id}" already exists`;
	if (!Number.isInteger(sheet.position) || sheet.position < 0) {
		return 'tab position must be a non-negative integer';
	}
	return sheetNameProblem(doc, sheet.name);
}

function sheetNameProblem(doc: DocumentGraph, name: string, exceptId?: SheetId): string | null {
	if (typeof name !== 'string') return 'tab name must be a string';
	if (name !== name.trim()) return 'tab name must not have surrounding whitespace';
	if (name.length < 1 || name.length > 64) return 'tab name must contain 1–64 characters';
	const duplicate = doc.workbook.sheets.find(
		(sheet) => sheet.id !== exceptId && sheet.name.toLowerCase() === name.toLowerCase()
	);
	return duplicate ? `tab name "${name}" already exists` : null;
}

function sheetProjectionProblem(projection: SheetProjection, sheetId: SheetId): string | null {
	if (projection.version !== 1) return 'unsupported tab projection version';
	if (projection.sheetId !== sheetId) return 'tab projection id does not match the mutation';
	try {
		const bytes = new TextEncoder().encode(stableStringify(projection.snapshot)).byteLength;
		return bytes <= MAX_TAB_PROJECTION_BYTES
			? null
			: `tab projection exceeds ${MAX_TAB_PROJECTION_BYTES} bytes`;
	} catch {
		return 'tab projection must be serializable';
	}
}

function isHostedBySheet(node: GraphNode, sheetId: SheetId): boolean {
	if (node.cellRef?.sheetId === sheetId) return true;
	return (
		node.kind === 'namedOutput' &&
		node.formula !== undefined &&
		collectRefs(node.formula).some((ref) => !isNameRef(ref) && ref.sheetId === sheetId)
	);
}

function rewritePublishedName(
	formula: FormulaAST,
	from: string,
	to: string
): { formula: FormulaAST; changed: boolean } {
	switch (formula.t) {
		case 'lit':
			return { formula: structuredClone(formula), changed: false };
		case 'ref':
			if (isNameRef(formula.ref) && formula.ref.name === from) {
				return { formula: { t: 'ref', ref: { name: to } }, changed: true };
			}
			return { formula: structuredClone(formula), changed: false };
		case 'un': {
			const arg = rewritePublishedName(formula.arg, from, to);
			return {
				formula: arg.changed ? { ...structuredClone(formula), arg: arg.formula } : structuredClone(formula),
				changed: arg.changed
			};
		}
		case 'bin': {
			const left = rewritePublishedName(formula.left, from, to);
			const right = rewritePublishedName(formula.right, from, to);
			const changed = left.changed || right.changed;
			return {
				formula: changed
					? { ...structuredClone(formula), left: left.formula, right: right.formula }
					: structuredClone(formula),
				changed
			};
		}
		case 'call': {
			const rewritten = formula.args.map((arg) => rewritePublishedName(arg, from, to));
			const changed = rewritten.some((arg) => arg.changed);
			return {
				formula: changed
					? { ...structuredClone(formula), args: rewritten.map((arg) => arg.formula) }
					: structuredClone(formula),
				changed
			};
		}
	}
}

/** Provenance stamp for every node a mutation authors (SCHEMA.md §9). Re-authoring clears verification. */
function stamp(node: GraphNode, actor: Actor, at: number): void {
	const provenance: Provenance = { authoredBy: actor.kind, authoredAt: at };
	if (actor.id !== undefined) provenance.authorId = actor.id;
	node.provenance = provenance;
}

interface DerivedRefs {
	/** Resolved input node ids, first-appearance order, deduplicated. */
	inputs: NodeId[];
	/** The first unresolved reference, if any (matches resolveInputs semantics). */
	firstUnresolved: CellRef | { name: string } | null;
}

/**
 * Derive a formula's inputs by walking ALL refs (unlike resolveInputs, which
 * stops at the first unresolved one). Unresolved refs are recorded into the
 * graph's healing index later, by insertNode/replaceNode.
 */
function deriveRefs(doc: DocumentGraph, ast: FormulaAST): DerivedRefs {
	const inputs: NodeId[] = [];
	let firstUnresolved: DerivedRefs['firstUnresolved'] = null;
	for (const ref of collectRefs(ast)) {
		const id = doc.resolveRef(ref);
		if (id === undefined) {
			if (!firstUnresolved) firstUnresolved = ref;
		} else if (!inputs.includes(id)) {
			inputs.push(id);
		}
	}
	return { inputs, firstUnresolved };
}

/** The error value an unresolved ref produces, per resolveInputs semantics. */
function unresolvedError(ref: CellRef | { name: string }, origin: NodeId): ErrorValue {
	return isNameRef(ref)
		? errorValue('#NAME?', `unknown name "${ref.name}"`, origin)
		: errorValue('#REF!', `unresolved cell ${ref.a1}`, origin);
}

/**
 * Healing: a freshly available node (by name or cellRef) re-resolves every
 * waiter recorded in the unresolved-ref index. Waiters keep their current
 * (error) value — recalc re-evaluates them from the AffectedSet — unless a
 * ref is still unresolved (fresh error) or the new edge would close a cycle
 * (the edge is skipped and the waiter becomes #CYCLE!). Waiters' provenance
 * is preserved: healing is mechanical, not authorship.
 */
function healWaiters(
	doc: DocumentGraph,
	node: GraphNode,
	inverse: GraphMutation[],
	affected: AffectedSet
): void {
	const keys: string[] = [];
	if (node.name !== undefined) keys.push(refKey({ name: node.name }));
	if (node.cellRef !== undefined) keys.push(refKey(node.cellRef));
	const waiterIds = new Set<NodeId>();
	for (const key of keys) for (const id of doc.waitersFor(key)) waiterIds.add(id);
	waiterIds.delete(node.id);
	for (const waiterId of waiterIds) {
		const waiter = doc.nodes.get(waiterId);
		if (!waiter?.formula) continue;
		inverse.push({ op: 'restoreNode', node: structuredClone(waiter) });
		const { inputs, firstUnresolved } = deriveRefs(doc, waiter.formula);
		const updated = structuredClone(waiter);
		const cycle = wouldCycle(waiterId, inputs, doc.inputsOf);
		if (cycle) {
			updated.inputs = inputs.filter((input) => input !== node.id);
			updated.value = errorValue(
				'#CYCLE!',
				`cycle: ${[...cycle, cycle[0]].join(' -> ')}`,
				waiterId
			);
		} else {
			updated.inputs = inputs;
			if (firstUnresolved) updated.value = unresolvedError(firstUnresolved, waiterId);
		}
		doc.replaceNode(updated);
		doc.refreshHash(waiterId);
		affected.push(waiterId);
	}
}

/**
 * Structural well-formedness check for authored values. Returns a problem
 * description, or null when the value is sound. Numbers must be finite.
 */
function valueProblem(v: unknown): string | null {
	if (v === null || typeof v !== 'object') return 'not a TypedValue object';
	const t = v as TypedValue;
	switch (t.kind) {
		case 'scalar':
			return Number.isFinite(t.value) ? null : 'scalar value must be a finite number';
		case 'quantity': {
			if (!Number.isFinite(t.value)) return 'quantity value must be a finite number';
			return dimensionProblem(t.unit);
		}
		case 'string':
			return typeof t.value === 'string' ? null : 'string value must be a string';
		case 'boolean':
			return typeof t.value === 'boolean' ? null : 'boolean value must be a boolean';
		case 'table': {
			if (!Array.isArray(t.columns) || !Array.isArray(t.rows)) return 'malformed table';
			for (const col of t.columns) {
				if (col === null || typeof col !== 'object' || typeof col.name !== 'string') {
					return 'malformed table column';
				}
			}
			for (const row of t.rows) {
				if (!Array.isArray(row)) return 'malformed table row';
				for (const cell of row) {
					const problem = valueProblem(cell);
					if (problem) return problem;
				}
			}
			return null;
		}
		case 'geometry':
			return typeof t.handle === 'string' && t.handle.startsWith('geom:')
				? null
				: 'malformed geometry handle';
		case 'error':
			return typeof t.message === 'string' && ERR_CODES.includes(t.code)
				? null
				: 'malformed error value';
		default:
			return `unknown value kind "${String((t as { kind?: unknown }).kind)}"`;
	}
}

const DIM_AXES = ['L', 'M', 'T', 'I', 'Θ', 'N', 'J'] as const;

function dimensionProblem(unit: unknown): string | null {
	if (unit === null || typeof unit !== 'object') return 'quantity unit must be a Dimension';
	const d = unit as Record<string, unknown>;
	for (const axis of DIM_AXES) {
		if (typeof d[axis] !== 'number') return `dimension axis "${axis}" must be a number`;
	}
	return null;
}
