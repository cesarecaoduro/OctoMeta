import { describe, expect, it } from 'vitest';
import { DocumentGraph } from './graph';
import { applyMutation, type Actor, type MutationError } from './mutations';
import { emptyProvenance, type GraphNode } from './node';
import { parseFormula, type FormulaAST } from './formula';
import { scalar, type CellRef, type NodeId, type TypedValue } from './types';
import { createBuiltinRegistry } from './registry';
import { evaluateFormula } from './evaluate';
import { commit, commitRedo, commitUndo, recalc, type RecalcOptions } from './recalc';

const HUMAN: Actor = { kind: 'human', id: 'cesare' };
const SHEET = 'blk-sheet';
const REGISTRY = createBuiltinRegistry();
const OPTS: RecalcOptions = { registry: REGISTRY };

type NewNode = Omit<GraphNode, 'value' | 'contentHash' | 'inputs'>;

function cell(a1: string): CellRef {
	return { sheetId: SHEET, a1 };
}

function must<T>(r: { ok: true; value: T } | { ok: false; error: MutationError }): T {
	if (!r.ok) throw new Error(r.error.message);
	return r.value;
}

function ast(src: string): FormulaAST {
	const p = parseFormula(src, { sheetId: SHEET });
	if (!p.ok) throw new Error(p.message);
	return p.ast;
}

/** Add an input node bound to a cell and author its value, recalcing each step. */
function addInput(doc: DocumentGraph, id: string, a1: string, value: number) {
	const node: NewNode = {
		id,
		kind: 'input',
		cellRef: cell(a1),
		blockId: SHEET,
		provenance: emptyProvenance()
	};
	must(commit(doc, { op: 'addNode', node }, HUMAN, OPTS));
	must(commit(doc, { op: 'setInput', id, value: scalar(value) }, HUMAN, OPTS));
}

/** Add a computed node bound to a cell, recalcing through `commit`. */
function addComputed(doc: DocumentGraph, id: string, a1: string, src: string) {
	const node: NewNode = {
		id,
		kind: 'computed',
		cellRef: cell(a1),
		formula: ast(src),
		blockId: SHEET,
		provenance: emptyProvenance()
	};
	must(commit(doc, { op: 'addNode', node }, HUMAN, OPTS));
}

function num(doc: DocumentGraph, id: NodeId): number {
	const v = doc.nodes.get(id)?.value;
	if (v?.kind !== 'scalar') throw new Error(`node ${id} is not a scalar: ${JSON.stringify(v)}`);
	return v.value;
}

/** RecalcOptions whose injected evaluator counts evaluations per node id. */
function evalSpy(): { counts: Map<NodeId, number>; opts: RecalcOptions } {
	const counts = new Map<NodeId, number>();
	return {
		counts,
		opts: {
			registry: REGISTRY,
			evaluate: (formula, env) => {
				counts.set(env.nodeId, (counts.get(env.nodeId) ?? 0) + 1);
				return evaluateFormula(formula, env);
			}
		}
	};
}

/** Deterministic seeded Fisher–Yates shuffle (mulberry32 PRNG). */
function shuffled<T>(items: readonly T[], seed: number): T[] {
	let s = seed >>> 0;
	const rand = () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

type NodeSpec = { id: string; a1: string; input?: number; src?: string };

/** a,b inputs; c = a+b; d = c*2; e = c+a; f = d+e — a diamond over a diamond. */
const GRAPH_SPEC: readonly NodeSpec[] = [
	{ id: 'a', a1: 'A1', input: 3 },
	{ id: 'b', a1: 'B1', input: 4 },
	{ id: 'c', a1: 'C1', src: '=A1 + B1' },
	{ id: 'd', a1: 'D1', src: '=C1 * 2' },
	{ id: 'e', a1: 'E1', src: '=C1 + A1' },
	{ id: 'f', a1: 'F1', src: '=D1 + E1' }
];

function buildSpec(spec: readonly NodeSpec[]): DocumentGraph {
	const doc = new DocumentGraph();
	for (const n of spec) {
		if (n.input !== undefined) addInput(doc, n.id, n.a1, n.input);
		else addComputed(doc, n.id, n.a1, n.src as string);
	}
	return doc;
}

/** Every node's value + contentHash, for bit-for-bit comparisons. */
function stateOf(doc: DocumentGraph): Record<string, { value: TypedValue; hash: string }> {
	const out: Record<string, { value: TypedValue; hash: string }> = {};
	for (const [id, node] of doc.nodes) {
		out[id] = structuredClone({ value: node.value, hash: node.contentHash });
	}
	return out;
}

/** Hand-built computed node for constructing cycles insertNode-style. */
function rawComputed(
	id: string,
	a1: string,
	src: string,
	inputs: string[],
	name?: string
): GraphNode {
	return {
		id,
		kind: 'computed',
		...(name !== undefined ? { name } : {}),
		formula: ast(src),
		value: scalar(0),
		inputs,
		contentHash: '',
		cellRef: cell(a1),
		provenance: emptyProvenance()
	};
}

function rawInput(id: string, a1: string, value: number): GraphNode {
	return {
		id,
		kind: 'input',
		value: scalar(value),
		inputs: [],
		contentHash: '',
		cellRef: cell(a1),
		provenance: emptyProvenance()
	};
}

// ---------------------------------------------------------------------------
// Propagation
// ---------------------------------------------------------------------------

describe('propagation', () => {
	it('settles a chain as it is built through commit', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'a', 'A1', 2);
		addComputed(doc, 'b', 'B1', '=A1 * 2');
		addComputed(doc, 'c', 'C1', '=B1 + 1');
		expect(num(doc, 'b')).toBe(4);
		expect(num(doc, 'c')).toBe(5);
	});

	it('editing the input recomputes dependents in dependency order', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'a', 'A1', 2);
		addComputed(doc, 'b', 'B1', '=A1 * 2');
		addComputed(doc, 'c', 'C1', '=B1 + 1');
		const notified: number[] = [];
		doc.subscribe('c', (node) => {
			if (node.value.kind === 'scalar') notified.push(node.value.value);
		});
		const r = must(commit(doc, { op: 'setInput', id: 'a', value: scalar(10) }, HUMAN, OPTS));
		expect(r.affected).toEqual(['a']);
		expect(r.evaluated).toEqual(['a', 'b', 'c']); // topo order
		expect(r.skipped).toEqual([]);
		expect(r.cyclic).toEqual([]);
		expect(num(doc, 'b')).toBe(20);
		expect(num(doc, 'c')).toBe(21);
		expect(notified).toEqual([21]); // notify fired with the settled value
	});

	it('a diamond evaluates each node exactly once', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'a', 'A1', 1);
		addComputed(doc, 'l', 'B1', '=A1 + 1');
		addComputed(doc, 'r', 'C1', '=A1 * 2');
		addComputed(doc, 't', 'D1', '=B1 + C1');
		const { counts, opts } = evalSpy();
		const result = must(commit(doc, { op: 'setInput', id: 'a', value: scalar(3) }, HUMAN, opts));
		expect(counts.get('l')).toBe(1);
		expect(counts.get('r')).toBe(1);
		expect(counts.get('t')).toBe(1); // once, despite two paths from a
		expect(result.evaluated.filter((id) => id === 't')).toHaveLength(1);
		expect(num(doc, 't')).toBe(3 + 1 + 3 * 2);
	});
});

// ---------------------------------------------------------------------------
// Order-independence
// ---------------------------------------------------------------------------

describe('order-independence', () => {
	it('shuffled insertion orders yield identical values AND contentHashes', () => {
		const baseline = stateOf(buildSpec(GRAPH_SPEC));
		expect(baseline.f.value).toEqual(scalar(24)); // (7*2) + (7+3)
		for (const seed of [1, 2, 42]) {
			const doc = buildSpec(shuffled(GRAPH_SPEC, seed));
			expect(stateOf(doc), `insertion order seed ${seed}`).toEqual(baseline);
		}
	});
});

// ---------------------------------------------------------------------------
// Memo hits
// ---------------------------------------------------------------------------

describe('memo hits', () => {
	it('an idempotent edit memo-skips all descendants without notifying them', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'a', 'A1', 2);
		addComputed(doc, 'b', 'B1', '=A1 * 2');
		addComputed(doc, 'c', 'C1', '=B1 + 1');
		let bNotified = 0;
		let cNotified = 0;
		doc.subscribe('b', () => bNotified++);
		doc.subscribe('c', () => cNotified++);
		const { counts, opts } = evalSpy();
		// Same value again: the seed re-settles (its hash was refreshed by the
		// mutation), but every descendant's hash is unchanged → memo hit.
		const r = must(commit(doc, { op: 'setInput', id: 'a', value: scalar(2) }, HUMAN, opts));
		expect(r.evaluated).toEqual(['a']);
		expect(r.skipped.sort()).toEqual(['b', 'c']);
		expect(counts.size).toBe(0); // zero formula evaluations
		expect(bNotified).toBe(0);
		expect(cNotified).toBe(0);
	});

	it('editing one branch of a diamond re-evaluates only that branch', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'x', 'A1', 1);
		addInput(doc, 'y', 'B1', 2);
		addComputed(doc, 'l', 'C1', '=A1 + 1');
		addComputed(doc, 'r', 'D1', '=B1 + 1');
		addComputed(doc, 't', 'E1', '=C1 + D1');
		let rNotified = 0;
		const tValues: number[] = [];
		doc.subscribe('r', () => rNotified++);
		doc.subscribe('t', (node) => {
			if (node.value.kind === 'scalar') tValues.push(node.value.value);
		});
		const { counts, opts } = evalSpy();
		const result = must(commit(doc, { op: 'setInput', id: 'x', value: scalar(5) }, HUMAN, opts));
		expect(result.evaluated).toEqual(['x', 'l', 't']);
		expect(counts.get('l')).toBe(1);
		expect(counts.get('t')).toBe(1);
		expect(counts.has('r')).toBe(false); // untouched sibling never re-evaluates
		expect(rNotified).toBe(0);
		expect(num(doc, 'r')).toBe(3);
		expect(tValues).toEqual([9]); // (5+1) + (2+1)
	});
});

// ---------------------------------------------------------------------------
// Perf gate (CI-enforced, PRD §4): < 50 ms scalar propagation @ 500 nodes
// ---------------------------------------------------------------------------

describe('perf gate', () => {
	it('recalcs a 500-node scalar chain in under 50 ms', () => {
		const nid = (i: number) => `n${String(i).padStart(3, '0')}`;
		const doc = new DocumentGraph();
		// Build outside the timer, via applyMutation (no recalc per step).
		const head: NewNode = {
			id: nid(0),
			kind: 'input',
			cellRef: cell('A1'),
			blockId: SHEET,
			provenance: emptyProvenance()
		};
		must(applyMutation(doc, { op: 'addNode', node: head }, HUMAN));
		for (let i = 1; i < 500; i++) {
			const node: NewNode = {
				id: nid(i),
				kind: 'computed',
				cellRef: cell(`A${i + 1}`),
				formula: ast(`=A${i} + 1`),
				blockId: SHEET,
				provenance: emptyProvenance()
			};
			must(applyMutation(doc, { op: 'addNode', node }, HUMAN));
		}
		const affected = must(
			applyMutation(doc, { op: 'setInput', id: nid(0), value: scalar(1) }, HUMAN)
		);
		const t0 = performance.now();
		const result = recalc(doc, affected, OPTS);
		const elapsed = performance.now() - t0;
		expect(result.evaluated).toHaveLength(500);
		expect(result.cyclic).toEqual([]);
		expect(num(doc, nid(499))).toBe(500); // 1 + 499
		expect(elapsed, `recalc took ${elapsed.toFixed(1)} ms`).toBeLessThan(50);
	});
});

// ---------------------------------------------------------------------------
// Reproducibility (SCHEMA.md §5: "restart & run all" is a no-op)
// ---------------------------------------------------------------------------

describe('reproducibility', () => {
	/** A deterministic session: build, edit values and formulas, undo, redo. */
	function session(): DocumentGraph {
		const doc = buildSpec(GRAPH_SPEC);
		must(commit(doc, { op: 'setInput', id: 'a', value: scalar(5) }, HUMAN, OPTS));
		must(commit(doc, { op: 'setFormula', id: 'd', formula: ast('=C1 * 3') }, HUMAN, OPTS));
		must(commitUndo(doc, OPTS));
		must(commitRedo(doc, OPTS));
		must(commit(doc, { op: 'setInput', id: 'b', value: scalar(10) }, HUMAN, OPTS));
		return doc;
	}

	it('replaying the same mutations reproduces every value and contentHash', () => {
		expect(stateOf(session())).toEqual(stateOf(session()));
	});

	it('clearing every contentHash and recalcing all reproduces hashes bit-for-bit', () => {
		const doc = session();
		const settled = stateOf(doc);
		for (const node of doc.nodes.values()) node.contentHash = '';
		const result = recalc(doc, [...doc.nodes.keys()], OPTS);
		expect(result.evaluated).toHaveLength(doc.nodes.size);
		expect(result.cyclic).toEqual([]);
		expect(stateOf(doc)).toEqual(settled);
	});
});

// ---------------------------------------------------------------------------
// V1-2-3 — cycle detection → #CYCLE!
// ---------------------------------------------------------------------------

describe('cycle detection (#CYCLE!)', () => {
	// Cycles cannot be authored through applyMutation (it rightly rejects
	// them), so these docs are constructed by direct insertNode with
	// hand-built `inputs`.

	it('a direct cycle marks both members; non-cycle branches still evaluate', () => {
		const doc = new DocumentGraph();
		doc.insertNode(rawInput('x', 'X1', 1));
		doc.insertNode(rawComputed('y', 'Y1', '=X1 * 2', ['x']));
		doc.insertNode(rawComputed('a', 'A1', '=B1', ['b'], 'beam.span'));
		doc.insertNode(rawComputed('b', 'B1', '=A1', ['a']));
		const result = recalc(doc, [...doc.nodes.keys()], OPTS);
		expect([...result.cyclic].sort()).toEqual(['a', 'b']);
		for (const id of ['a', 'b']) {
			const node = doc.nodes.get(id) as GraphNode;
			expect(node.value).toEqual({
				kind: 'error',
				code: '#CYCLE!',
				message: 'cycle members: beam.span, b', // names-or-ids of the group
				origin: id // each member is its own deep-linkable root cause
			});
			expect(node.contentHash).toBe(''); // sentinel: never memo-matches
		}
		expect(result.evaluated).toContain('y');
		expect(num(doc, 'y')).toBe(2); // rest of the graph unaffected
	});

	it('a transitive cycle traps its descendants too', () => {
		const doc = new DocumentGraph();
		doc.insertNode(rawComputed('a', 'A1', '=B1', ['b']));
		doc.insertNode(rawComputed('b', 'B1', '=C1', ['c']));
		doc.insertNode(rawComputed('c', 'C1', '=A1', ['a']));
		doc.insertNode(rawComputed('d', 'D1', '=A1 + 1', ['a']));
		const result = recalc(doc, [...doc.nodes.keys()], OPTS);
		expect([...result.cyclic].sort()).toEqual(['a', 'b', 'c', 'd']);
		expect(doc.nodes.get('d')?.value).toMatchObject({ kind: 'error', code: '#CYCLE!' });
	});

	it('a self-reference is a cycle of one', () => {
		const doc = new DocumentGraph();
		doc.insertNode(rawComputed('s', 'A1', '=A1', ['s']));
		const result = recalc(doc, ['s'], OPTS);
		expect(result.cyclic).toEqual(['s']);
		expect(doc.nodes.get('s')?.value).toMatchObject({
			kind: 'error',
			code: '#CYCLE!',
			message: 'cycle members: s',
			origin: 's'
		});
	});

	it('breaking the cycle clears #CYCLE! from all former members', () => {
		const doc = new DocumentGraph();
		doc.insertNode(rawInput('x', 'X1', 1));
		doc.insertNode(rawComputed('a', 'A1', '=B1', ['b']));
		doc.insertNode(rawComputed('b', 'B1', '=A1', ['a']));
		recalc(doc, [...doc.nodes.keys()], OPTS);
		expect(doc.nodes.get('b')?.value).toMatchObject({ kind: 'error', code: '#CYCLE!' });
		// Fix a member through the normal mutation path: applyMutation's cycle
		// pre-check inspects only the node's NEW edge set against the current
		// graph, so operating on an already-cyclic graph is permitted — direct
		// insertNode was needed only to construct the cycle.
		const r = must(
			commit(doc, { op: 'setFormula', id: 'a', formula: ast('=X1 * 10') }, HUMAN, OPTS)
		);
		expect(r.cyclic).toEqual([]);
		expect(r.evaluated).toEqual(['a', 'b']); // the '' hash sentinel forced b's re-eval
		expect(num(doc, 'a')).toBe(10);
		expect(num(doc, 'b')).toBe(10);
	});
});

// ---------------------------------------------------------------------------
// Commit-level contract: cycle-introducing mutations are rejected
// ---------------------------------------------------------------------------

describe('commit', () => {
	it('rejects a setFormula that would close a cycle, leaving values untouched', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'a', 'A1', 1);
		addComputed(doc, 'c', 'C1', '=A1');
		addComputed(doc, 'd', 'D1', '=C1');
		const r = commit(doc, { op: 'setFormula', id: 'c', formula: ast('=D1') }, HUMAN, OPTS);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error.message).toMatch(/cycle/);
			expect(r.error.cycle).toContain('c');
			expect(r.error.cycle).toContain('d');
		}
		expect(num(doc, 'c')).toBe(1);
		expect(num(doc, 'd')).toBe(1);
		expect(doc.nodes.get('c')?.formula).toEqual(ast('=A1')); // no partial writes
	});

	it('errors when there is nothing to undo or redo', () => {
		const doc = new DocumentGraph();
		expect(commitUndo(doc, OPTS).ok).toBe(false);
		expect(commitRedo(doc, OPTS).ok).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Undo/redo recompute
// ---------------------------------------------------------------------------

describe('undo/redo recompute', () => {
	it('commitUndo and commitRedo re-settle dependents', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'a', 'A1', 2);
		addComputed(doc, 'b', 'B1', '=A1 * 2');
		must(commit(doc, { op: 'setInput', id: 'a', value: scalar(10) }, HUMAN, OPTS));
		expect(num(doc, 'b')).toBe(20);
		const bValues: number[] = [];
		doc.subscribe('b', (node) => {
			if (node.value.kind === 'scalar') bValues.push(node.value.value);
		});
		const u = must(commitUndo(doc, OPTS));
		expect(u.affected).toEqual(['a']);
		expect(u.evaluated).toContain('b');
		expect(num(doc, 'a')).toBe(2);
		expect(num(doc, 'b')).toBe(4); // dependents back to prior values
		const r = must(commitRedo(doc, OPTS));
		expect(r.evaluated).toContain('b');
		expect(num(doc, 'b')).toBe(20);
		expect(bValues).toEqual([4, 20]);
	});
});

describe('range formulas — SUM(A1:A3) and friends', () => {
	it('a range call sums its constituent cells and recalcs reactively', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'a1', 'A1', 10);
		addInput(doc, 'a2', 'A2', 20);
		addInput(doc, 'a3', 'A3', 30);
		addComputed(doc, 'total', 'B1', '=SUM(A1:A3)');
		expect(num(doc, 'total')).toBe(60);
		expect(doc.nodes.get('total')?.inputs).toEqual(['a1', 'a2', 'a3']);

		must(commit(doc, { op: 'setInput', id: 'a2', value: scalar(200) }, HUMAN, OPTS));
		expect(num(doc, 'total')).toBe(240);
	});

	it('a range over a missing cell is #REF! until the cell heals it', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'a1', 'A1', 1);
		addInput(doc, 'a2', 'A2', 2);
		addComputed(doc, 'total', 'B1', '=SUM(A1:A3)');
		const before = doc.nodes.get('total')?.value;
		expect(before).toMatchObject({ kind: 'error', code: '#REF!' });
		if (before?.kind === 'error') expect(before.message).toContain('A3');

		addInput(doc, 'a3', 'A3', 4);
		expect(num(doc, 'total')).toBe(7);
		expect(doc.nodes.get('total')?.inputs).toEqual(['a1', 'a2', 'a3']);
	});

	it('MIN/MAX/AVERAGE accept ranges alongside plain args', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'a1', 'A1', 5);
		addInput(doc, 'a2', 'A2', 9);
		addComputed(doc, 'best', 'B1', '=MAX(A1:A2, 7)');
		expect(num(doc, 'best')).toBe(9);
	});

	it('a range outside a function call is #VALUE!', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'a1', 'A1', 1);
		addInput(doc, 'a2', 'A2', 2);
		addComputed(doc, 'bad', 'B1', '=A1:A2 + 1');
		expect(doc.nodes.get('bad')?.value).toMatchObject({ kind: 'error', code: '#VALUE!' });
	});
});
