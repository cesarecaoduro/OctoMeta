/**
 * V1-2-2/V1-2-3 groundwork — pure graph-traversal primitives over derived
 * edges (SCHEMA.md §4). No graph storage here: callers pass edge accessors,
 * so mutations (V1-2-1) and recalc (V1-2-2) share one implementation.
 */

import type { NodeId } from './types';

/**
 * The seeds plus every node reachable from them via `dependentsOf` — the
 * "dirty" set of SCHEMA.md §4 (`affected ∪ transitiveDescendants(affected)`).
 */
export function transitiveDescendants(
	seeds: Iterable<NodeId>,
	dependentsOf: (id: NodeId) => Iterable<NodeId>
): Set<NodeId> {
	const out = new Set<NodeId>(seeds);
	const stack = [...out];
	while (stack.length > 0) {
		const id = stack.pop() as NodeId;
		for (const dep of dependentsOf(id)) {
			if (!out.has(dep)) {
				out.add(dep);
				stack.push(dep);
			}
		}
	}
	return out;
}

/** Result of a topological sort: evaluation order plus any cycle members. */
export interface TopoResult {
	/** Members in dependency order (inputs before dependents). */
	order: NodeId[];
	/** Members left unsorted — each participates in (or depends on) a cycle. */
	cyclic: NodeId[];
}

/**
 * Kahn topological sort of the subgraph induced by `members`. Edges to nodes
 * outside `members` are ignored (their values are settled by definition).
 * Deterministic: ties resolve in `members` iteration order. Nodes that cannot
 * be ordered — cycle participants and their trapped descendants — come back
 * in `cyclic`, also in `members` order (SCHEMA.md §4: cycle found here).
 */
export function kahnTopoSort(
	members: ReadonlySet<NodeId>,
	inputsOf: (id: NodeId) => readonly NodeId[]
): TopoResult {
	const indegree = new Map<NodeId, number>();
	const dependents = new Map<NodeId, NodeId[]>();
	for (const id of members) {
		let n = 0;
		for (const input of inputsOf(id)) {
			if (!members.has(input)) continue;
			n++;
			let bucket = dependents.get(input);
			if (!bucket) dependents.set(input, (bucket = []));
			bucket.push(id);
		}
		indegree.set(id, n);
	}
	const order: NodeId[] = [];
	const queue: NodeId[] = [];
	for (const id of members) if (indegree.get(id) === 0) queue.push(id);
	for (let i = 0; i < queue.length; i++) {
		const id = queue[i];
		order.push(id);
		for (const dep of dependents.get(id) ?? []) {
			const n = (indegree.get(dep) as number) - 1;
			indegree.set(dep, n);
			if (n === 0) queue.push(dep);
		}
	}
	if (order.length === members.size) return { order, cyclic: [] };
	const sorted = new Set(order);
	const cyclic: NodeId[] = [];
	for (const id of members) if (!sorted.has(id)) cyclic.push(id);
	return { order, cyclic };
}

/**
 * Cycle pre-check for mutations (V1-2-1/V1-2-3): would giving `id` the inputs
 * `newInputs` close a dependency cycle? Walks `inputsOf` (the *current* graph)
 * from each new input looking for a path back to `id`. Returns the would-be
 * cycle as `[id, …path]` — meaning `id → path[0] → … → id` — or `null`.
 * A self-reference (`id ∈ newInputs`) returns `[id]`.
 */
export function wouldCycle(
	id: NodeId,
	newInputs: readonly NodeId[],
	inputsOf: (id: NodeId) => readonly NodeId[]
): NodeId[] | null {
	for (const start of newInputs) {
		if (start === id) return [id];
		// DFS with an explicit stack of [node, path-from-newInput].
		const visited = new Set<NodeId>([start]);
		const stack: { node: NodeId; path: NodeId[] }[] = [{ node: start, path: [start] }];
		while (stack.length > 0) {
			const { node, path } = stack.pop() as { node: NodeId; path: NodeId[] };
			for (const input of inputsOf(node)) {
				if (input === id) return [id, ...path];
				if (!visited.has(input)) {
					visited.add(input);
					stack.push({ node: input, path: [...path, input] });
				}
			}
		}
	}
	return null;
}
