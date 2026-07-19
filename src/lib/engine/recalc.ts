/**
 * V1-2-2/V1-2-3 — topological + content-hash incremental recalc, cycle
 * marking, and the commit facade (SCHEMA.md §4, §5, §11; IMPLEMENTATION_PLAN.md
 * V1-2-2/V1-2-3). This is what makes edits propagate reactively: a mutation
 * yields an `AffectedSet`, `recalc` settles the dirty subgraph in dependency
 * order, and subscribers (chips, cells, viewer bindings) are notified only
 * when a node actually re-settles.
 *
 * Memo contract with the mutation layer (deliberate, documented): mutations
 * refresh the `contentHash` of every node they touch so undo/redo round-trips
 * deep-equal *including hashes* (V1-2-1). A seed's stored hash therefore
 * already matches its recomputed hash even though its VALUE may be stale —
 * `setFormula` never evaluates. Seeds (the AffectedSet) always re-settle,
 * bypassing the hash check; the memo skip applies to downstream dirty nodes,
 * whose stored hashes still reflect their previous settle. After every recalc
 * the invariant "stored hash current ⟹ value current" holds document-wide.
 */

import type { NodeId, TypedValue } from './types';
import { contentHash, errorValue } from './types';
import type { GraphNode } from './node';
import type { FormulaAST } from './formula';
import type { FunctionRegistry } from './registry';
import { kahnTopoSort, transitiveDescendants } from './topo';
import type { DocumentGraph } from './graph';
import { nodeOpId } from './graph';
import type { Actor, AffectedSet, GraphMutation, MutationError, Result } from './mutations';
import { applyMutation, redo, undo } from './mutations';
import type { EvalEnv } from './evaluate';
import { evaluateFormula } from './evaluate';

/** What `recalc` needs beyond the graph itself. */
export interface RecalcOptions {
	/** Function registry used to evaluate `call` nodes (SCHEMA.md §6). */
	registry: FunctionRegistry;
	/** Injectable for eval-count spies in tests; defaults to `evaluateFormula`. */
	evaluate?: (ast: FormulaAST, env: EvalEnv) => TypedValue;
}

/** Outcome of one recalc pass over a mutation's AffectedSet. */
export interface RecalcResult {
	/** Nodes re-settled this pass (mutation seeds + hash mismatches), in topo order. */
	evaluated: NodeId[];
	/** Dirty nodes skipped as memo hits (hash match) — never notified. */
	skipped: NodeId[];
	/** Nodes marked `#CYCLE!` this pass: cycle members and trapped descendants. */
	cyclic: NodeId[];
}

/**
 * V2 seam for SCHEMA.md §4's `geomQueue`/`geometryStore` lines. Recalc hands
 * every `kind === 'geometry'` node it settled in a pass to `enqueue`. V1 has
 * no geometry pipeline, so the hook is a documented no-op (IMPLEMENTATION_PLAN.md
 * V1-2-2); V2 replaces the body with the GeometryStore rebuild (preview mesh
 * sync, exact B-Rep async) and the mandatory WASM sweep.
 */
export const geometryHook = {
	/** Receive the geometry nodes settled this pass. V1: intentionally dormant. */
	enqueue(nodes: readonly GraphNode[]): void {
		void nodes; // no-op until V2 (SCHEMA.md §7)
	}
};

/**
 * Settle the graph after a mutation (SCHEMA.md §4): dirty = affected ∪
 * transitive descendants; Kahn topo-sort of the dirty subgraph; memo skip on
 * `contentHash` match (seeds excepted — see module header); evaluation through
 * the function registry; subscriber notification per settled node. Cycle
 * members are marked `#CYCLE!` (V1-2-3) and the acyclic rest still evaluates.
 * Dead ids passed as seeds simply have no node and are skipped. Total: never
 * throws across the API — every failure is an error *value* on a node.
 */
export function recalc(
	doc: DocumentGraph,
	affected: AffectedSet,
	opts: RecalcOptions
): RecalcResult {
	const evaluate = opts.evaluate ?? evaluateFormula;
	const seeds = new Set<NodeId>(affected);
	const dirty = transitiveDescendants(seeds, (id) => doc.dependentsOf(id));
	const { order, cyclic } = kahnTopoSort(dirty, doc.inputsOf);

	// V1-2-3: every unsortable node — cycle member or descendant trapped behind
	// one — gets #CYCLE! listing the whole group by name-or-id (SCHEMA.md §11).
	// `origin` is the node's own id: each member is a root cause a chip can
	// deep-link to. The '' contentHash sentinel never memo-matches, so members
	// re-evaluate the moment the cycle is broken.
	if (cyclic.length > 0) {
		const members = cyclic.map((id) => doc.nodes.get(id)?.name ?? id).join(', ');
		for (const id of cyclic) {
			const node = doc.nodes.get(id);
			if (!node) continue;
			node.value = errorValue('#CYCLE!', `cycle members: ${members}`, id);
			node.contentHash = '';
			doc.notify(id);
		}
	}

	const evaluated: NodeId[] = [];
	const skipped: NodeId[] = [];
	const geomQueue: GraphNode[] = [];
	for (const id of order) {
		const node = doc.nodes.get(id);
		if (!node) continue; // dead seed id — nothing to settle
		const h = contentHash(
			nodeOpId(node),
			node.inputs.map((input) => doc.nodes.get(input)?.contentHash ?? '')
		);
		if (h === node.contentHash && !seeds.has(id)) {
			// Memo hit (salsa-style): value already current, no notify.
			skipped.push(id);
			continue;
		}
		if (node.formula) {
			node.value = evaluate(node.formula, {
				nodeId: id,
				registry: opts.registry,
				resolveRef: doc.resolveRef,
				valueOf: (inputId) => doc.nodes.get(inputId)?.value
			});
		}
		// Formula-less nodes (kind 'input') keep their authored value.
		node.contentHash = h;
		evaluated.push(id);
		if (node.kind === 'geometry') geomQueue.push(node);
		doc.notify(id);
	}
	geometryHook.enqueue(geomQueue);
	return { evaluated, skipped, cyclic };
}

/** What a commit returns: the mutation's AffectedSet plus the recalc outcome. */
export type CommitResult = { affected: AffectedSet } & RecalcResult;

/**
 * Apply one mutation and settle its consequences — the end-to-end write path
 * projections use (mutate, then recalc, SCHEMA.md §4 `onMutation`). A rejected
 * mutation (including one that would introduce a cycle) returns the error and
 * leaves the graph — values included — untouched; no recalc runs.
 */
export function commit(
	doc: DocumentGraph,
	m: GraphMutation,
	actor: Actor,
	opts: RecalcOptions
): Result<CommitResult, MutationError> {
	const r = applyMutation(doc, m, actor);
	if (!r.ok) return r;
	return { ok: true, value: { affected: r.value, ...recalc(doc, r.value, opts) } };
}

/** Undo the entry at the cursor and re-settle its dependents (see `commit`). */
export function commitUndo(
	doc: DocumentGraph,
	opts: RecalcOptions
): Result<CommitResult, MutationError> {
	const r = undo(doc);
	if (!r.ok) return r;
	return { ok: true, value: { affected: r.value, ...recalc(doc, r.value, opts) } };
}

/** Redo the entry above the cursor and re-settle its dependents (see `commit`). */
export function commitRedo(
	doc: DocumentGraph,
	opts: RecalcOptions
): Result<CommitResult, MutationError> {
	const r = redo(doc);
	if (!r.ok) return r;
	return { ok: true, value: { affected: r.value, ...recalc(doc, r.value, opts) } };
}
