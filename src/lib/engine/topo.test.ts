import { describe, expect, it } from 'vitest';
import { kahnTopoSort, transitiveDescendants, wouldCycle } from './topo';
import type { NodeId } from './types';

/** Build edge accessors from an adjacency map of node → inputs. */
function graph(edges: Record<string, string[]>) {
	const inputsOf = (id: NodeId): readonly NodeId[] => edges[id] ?? [];
	const dependentsOf = (id: NodeId): NodeId[] =>
		Object.keys(edges).filter((n) => (edges[n] ?? []).includes(id));
	return { inputsOf, dependentsOf };
}

describe('transitiveDescendants', () => {
	it('includes the seeds themselves', () => {
		const { dependentsOf } = graph({});
		expect(transitiveDescendants(['a'], dependentsOf)).toEqual(new Set(['a']));
	});

	it('collects descendants transitively across branches', () => {
		// a → b → d, a → c, e isolated
		const { dependentsOf } = graph({ b: ['a'], c: ['a'], d: ['b'], e: [] });
		expect(transitiveDescendants(['a'], dependentsOf)).toEqual(new Set(['a', 'b', 'c', 'd']));
	});

	it('handles diamonds without duplication', () => {
		const { dependentsOf } = graph({ b: ['a'], c: ['a'], d: ['b', 'c'] });
		expect(transitiveDescendants(['a'], dependentsOf)).toEqual(new Set(['a', 'b', 'c', 'd']));
	});

	it('terminates on cyclic graphs', () => {
		const { dependentsOf } = graph({ a: ['b'], b: ['a'] });
		expect(transitiveDescendants(['a'], dependentsOf)).toEqual(new Set(['a', 'b']));
	});
});

describe('kahnTopoSort', () => {
	function assertTopological(order: NodeId[], edges: Record<string, string[]>) {
		const pos = new Map(order.map((id, i) => [id, i]));
		for (const [node, inputs] of Object.entries(edges)) {
			for (const input of inputs) {
				if (pos.has(node) && pos.has(input)) {
					expect(pos.get(input)!, `${input} must precede ${node}`).toBeLessThan(pos.get(node)!);
				}
			}
		}
	}

	it('orders inputs before dependents', () => {
		const edges = { c: ['a', 'b'], d: ['c'], b: ['a'] };
		const { inputsOf } = graph(edges);
		const { order, cyclic } = kahnTopoSort(new Set(['a', 'b', 'c', 'd']), inputsOf);
		expect(cyclic).toEqual([]);
		expect(order).toHaveLength(4);
		assertTopological(order, edges);
	});

	it('ignores edges leaving the member set', () => {
		const { inputsOf } = graph({ b: ['outside', 'a'] });
		const { order, cyclic } = kahnTopoSort(new Set(['a', 'b']), inputsOf);
		expect(cyclic).toEqual([]);
		expect(order).toEqual(['a', 'b']);
	});

	it('reports cycle members and still orders the acyclic rest', () => {
		// a → b → a cycle; c depends on nothing; d depends on c.
		const { inputsOf } = graph({ a: ['b'], b: ['a'], d: ['c'] });
		const { order, cyclic } = kahnTopoSort(new Set(['a', 'b', 'c', 'd']), inputsOf);
		expect(order).toEqual(['c', 'd']);
		expect(cyclic).toEqual(['a', 'b']);
	});

	it('traps descendants of a cycle in the cyclic set', () => {
		// a ↔ b, and c depends on a: c can never be ordered.
		const { inputsOf } = graph({ a: ['b'], b: ['a'], c: ['a'] });
		const { cyclic } = kahnTopoSort(new Set(['a', 'b', 'c']), inputsOf);
		expect(cyclic).toEqual(['a', 'b', 'c']);
	});

	it('flags a self-reference', () => {
		const { inputsOf } = graph({ a: ['a'] });
		expect(kahnTopoSort(new Set(['a']), inputsOf).cyclic).toEqual(['a']);
	});

	it('is deterministic in member iteration order', () => {
		const { inputsOf } = graph({});
		const members = new Set(['z', 'm', 'a']);
		expect(kahnTopoSort(members, inputsOf).order).toEqual(['z', 'm', 'a']);
	});
});

describe('wouldCycle', () => {
	it('returns null when no path leads back', () => {
		const { inputsOf } = graph({ b: ['a'] });
		expect(wouldCycle('c', ['b'], inputsOf)).toBeNull();
	});

	it('detects a self-reference', () => {
		const { inputsOf } = graph({});
		expect(wouldCycle('a', ['a'], inputsOf)).toEqual(['a']);
	});

	it('detects a direct cycle', () => {
		// b already depends on a; making a depend on b closes a ↔ b.
		const { inputsOf } = graph({ b: ['a'] });
		expect(wouldCycle('a', ['b'], inputsOf)).toEqual(['a', 'b']);
	});

	it('detects a transitive cycle and reports the path', () => {
		// c → b → a; making a depend on c closes a → c → b → a.
		const { inputsOf } = graph({ c: ['b'], b: ['a'] });
		expect(wouldCycle('a', ['c'], inputsOf)).toEqual(['a', 'c', 'b']);
	});

	it('ignores harmless shared ancestry', () => {
		// Diamond: b and c both feed from root; d = f(b, c) is not a cycle.
		const { inputsOf } = graph({ b: ['root'], c: ['root'] });
		expect(wouldCycle('d', ['b', 'c'], inputsOf)).toBeNull();
	});
});
