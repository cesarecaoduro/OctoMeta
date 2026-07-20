import { describe, expect, it } from 'vitest';
import { DocumentGraph } from './graph';
import type { Actor, MutationError } from './mutations';
import { emptyProvenance, type GraphNode } from './node';
import { parseFormula, printFormula, type FormulaAST } from './formula';
import { scalar, stringValue, type CellRef, type NodeId } from './types';
import { createBuiltinRegistry } from './registry';
import { evaluateWithDerivations } from './evaluate';
import { commit, recalc, type RecalcOptions } from './recalc';
import { buildDerivation, renderStepsText, type Derivation } from './showsteps';
import { FIXTURE_BUILDERS } from '../persistence/fixtures';

const HUMAN: Actor = { kind: 'human', id: 'cesare' };
const SHEET = 'blk-sheet';
const REGISTRY = createBuiltinRegistry();
const OPTS: RecalcOptions = { registry: REGISTRY };

function cell(a1: string): CellRef {
	return { sheetBlockId: SHEET, a1 };
}

function must<T>(r: { ok: true; value: T } | { ok: false; error: MutationError }): T {
	if (!r.ok) throw new Error(r.error.message);
	return r.value;
}

function ast(src: string): FormulaAST {
	const p = parseFormula(src, { sheetBlockId: SHEET });
	if (!p.ok) throw new Error(p.message);
	return p.ast;
}

function addInput(doc: DocumentGraph, id: string, a1: string, value: number, opts = OPTS) {
	must(
		commit(
			doc,
			{
				op: 'addNode',
				node: { id, kind: 'input', cellRef: cell(a1), blockId: SHEET, provenance: emptyProvenance() }
			},
			HUMAN,
			opts
		)
	);
	must(commit(doc, { op: 'setInput', id, value: scalar(value) }, HUMAN, opts));
}

function addComputed(doc: DocumentGraph, id: string, a1: string, src: string, opts = OPTS) {
	must(
		commit(
			doc,
			{
				op: 'addNode',
				node: {
					id,
					kind: 'computed',
					cellRef: cell(a1),
					formula: ast(src),
					blockId: SHEET,
					provenance: emptyProvenance()
				}
			},
			HUMAN,
			opts
		)
	);
}

/** Step texts by kind, for compact assertions. */
function texts(d: Derivation, kind?: Derivation['steps'][number]['kind']): string[] {
	return d.steps.filter((s) => kind === undefined || s.kind === kind).map((s) => s.text);
}

// ---------------------------------------------------------------------------
// V1-5-4 acceptance: every node of every fixture derives well-formed steps
// ---------------------------------------------------------------------------

describe('derivation corpus over persistence fixtures (PRD §4: 100% of computed nodes)', () => {
	it.each(FIXTURE_BUILDERS.map((build) => [build().title, build] as const))(
		'%s: every node yields a well-formed derivation',
		(_title, build) => {
			const { graph, registry } = build();
			expect(graph.nodes.size).toBeGreaterThan(0);
			for (const node of graph.nodes.values()) {
				// DocumentGraph satisfies DerivationSource structurally.
				const d = buildDerivation(node.id, graph, registry);
				expect(d.nodeId).toBe(node.id);
				expect(d.name).toBe(node.name);
				expect(d.steps.length).toBeGreaterThanOrEqual(1);
				for (const step of d.steps) expect(step.text.length).toBeGreaterThan(0);
				// The last step is always the settled result.
				const last = d.steps[d.steps.length - 1];
				expect(last.kind).toBe('result');
				// Computed nodes (any formula) open with the canonical formula text.
				if (node.formula) {
					expect(d.steps[0]).toEqual({ kind: 'formula', text: printFormula(node.formula) });
					expect(d.steps.length).toBeGreaterThanOrEqual(2);
				} else {
					expect(d.steps).toHaveLength(1);
				}
				// Error nodes surface their code and end in it.
				if (node.value.kind === 'error') {
					expect(d.error).toBe(node.value.code);
					expect(last.text).toBe(node.value.code);
				} else {
					expect(d.error).toBeUndefined();
				}
				// The plain-text rendering carries every step (PRD §10).
				const text = renderStepsText(d);
				for (const step of d.steps) expect(text).toContain(step.text);
				// Serializable end to end.
				expect(JSON.parse(JSON.stringify(d))).toEqual(d);
			}
		}
	);

	it('derives the beam moment with substitution and intermediates (canonical example)', () => {
		const { graph, registry } = FIXTURE_BUILDERS[0]();
		const d = buildDerivation('node-beam-moment', graph, registry);
		expect(texts(d)).toEqual(['A2 * A1 ^ 2 / 8', '12 * 6 ^ 2 / 8', '12 * 36 / 8', '432 / 8', '54']);
		expect(d.steps.map((s) => s.kind)).toEqual([
			'formula',
			'substitution',
			'intermediate',
			'intermediate',
			'result'
		]);
	});

	it('renders a named node as plain text with the name on the head line', () => {
		const { graph, registry } = FIXTURE_BUILDERS[0]();
		const namedId = graph.resolveRef({ name: 'beam.moment' });
		expect(namedId).toBeDefined();
		const d = buildDerivation(namedId as NodeId, graph, registry);
		// A namedOutput aliases its cell: formula `A3`, then straight to the value.
		expect(renderStepsText(d)).toBe('beam.moment = A3\n  = 54');
	});

	it('substitutes strings quoted and quantities with their display unit', () => {
		const { graph, registry } = FIXTURE_BUILDERS[1]();
		const bad = buildDerivation('node-branch-bad', graph, registry); // ="four" * 2
		expect(texts(bad, 'substitution')).toEqual(['"four" * 2']);
		expect(texts(bad, 'result')).toEqual(['#VALUE!']);
		expect(bad.error).toBe('#VALUE!');
		const q = buildDerivation('node-branch-qdouble', graph, registry); // =5m * 2
		expect(texts(q, 'substitution')).toEqual(['5 m * 2']);
		expect(texts(q, 'result')).toEqual(['10 m']);
	});
});

// ---------------------------------------------------------------------------
// Targeted derivations
// ---------------------------------------------------------------------------

describe('buildDerivation', () => {
	function calcDoc(): DocumentGraph {
		const doc = new DocumentGraph();
		addInput(doc, 'a', 'A1', 6);
		addInput(doc, 'b', 'A2', 2);
		return doc;
	}

	it('an input node yields the trivial one-step derivation', () => {
		const doc = calcDoc();
		const d = buildDerivation('a', doc, REGISTRY);
		expect(d.steps).toEqual([{ kind: 'result', text: '6' }]);
		expect(renderStepsText(d)).toBe('6');
	});

	it('an unknown node id yields a well-formed #REF! derivation, never a throw', () => {
		const d = buildDerivation('ghost', new DocumentGraph(), REGISTRY);
		expect(d).toEqual({
			nodeId: 'ghost',
			steps: [{ kind: 'result', text: '#REF!' }],
			error: '#REF!'
		});
	});

	it('collapses nested calls innermost-first', () => {
		const doc = calcDoc();
		addComputed(doc, 'n', 'B1', '=MAX(SUM(A1, A2), 10)');
		const d = buildDerivation('n', doc, REGISTRY);
		expect(texts(d)).toEqual([
			'MAX(SUM(A1, A2), 10)',
			'MAX(SUM(6, 2), 10)',
			'MAX(8, 10)',
			'10'
		]);
	});

	it('collapses sibling sub-expressions in the same pass', () => {
		const doc = calcDoc();
		addComputed(doc, 'n', 'B1', '=(A1 + A2) * (A1 - A2)');
		const d = buildDerivation('n', doc, REGISTRY);
		expect(texts(d)).toEqual([
			'(A1 + A2) * (A1 - A2)',
			'(6 + 2) * (6 - 2)',
			'8 * 4',
			'32'
		]);
	});

	it('walks IF through its condition eagerly, like the evaluator', () => {
		const doc = calcDoc();
		addComputed(doc, 'n', 'B1', '=IF(A1 > 4, A1, 0)');
		const d = buildDerivation('n', doc, REGISTRY);
		expect(texts(d)).toEqual(['IF(A1 > 4, A1, 0)', 'IF(6 > 4, 6, 0)', 'IF(TRUE, 6, 0)', '6']);
	});

	it('keeps unary minus faithful and parenthesizes substituted negatives', () => {
		const doc = calcDoc();
		addComputed(doc, 'n', 'B1', '=-A1 ^ 2'); // unary minus binds tighter: (-6)^2
		const d = buildDerivation('n', doc, REGISTRY);
		expect(texts(d)).toEqual(['-A1 ^ 2', '-6 ^ 2', '(-6) ^ 2', '36']);
	});

	it('honors the printer contract for authored parentheses', () => {
		const doc = calcDoc();
		addComputed(doc, 'n', 'B1', '=(A1 + A2) * 2');
		const d = buildDerivation('n', doc, REGISTRY);
		expect(texts(d, 'formula')).toEqual(['(A1 + A2) * 2']);
		expect(texts(d, 'substitution')).toEqual(['(6 + 2) * 2']);
	});

	it('merges redundant lines: pure-literal formulas skip the substitution step', () => {
		const doc = new DocumentGraph();
		addComputed(doc, 'n', 'B1', '=2 * 3 + 1');
		const d = buildDerivation('n', doc, REGISTRY);
		expect(texts(d)).toEqual(['2 * 3 + 1', '6 + 1', '7']);
		expect(d.steps[0].kind).toBe('formula');
	});

	it('a deleted input substitutes as #REF! and the chain ends in #REF!', () => {
		const doc = calcDoc();
		addComputed(doc, 'n', 'B1', '=A1 * 2');
		must(commit(doc, { op: 'removeNode', id: 'a' }, HUMAN, OPTS));
		const d = buildDerivation('n', doc, REGISTRY);
		expect(texts(d)).toEqual(['A1 * 2', '#REF! * 2', '#REF!']);
		expect(d.error).toBe('#REF!');
	});

	it('an unknown published name substitutes as #NAME?', () => {
		const doc = new DocumentGraph();
		addComputed(doc, 'n', 'B1', '=beam.gone + 1');
		const d = buildDerivation('n', doc, REGISTRY);
		expect(texts(d, 'substitution')).toEqual(['#NAME? + 1']);
		expect(texts(d, 'result')).toEqual(['#NAME?']);
	});

	it('a #CYCLE! member derives well-formed steps ending in #CYCLE!', () => {
		// Cycles cannot be authored through applyMutation; build directly.
		const doc = new DocumentGraph();
		const raw = (id: string, a1: string, src: string, inputs: string[]): GraphNode => ({
			id,
			kind: 'computed',
			formula: ast(src),
			value: scalar(0),
			inputs,
			contentHash: '',
			cellRef: cell(a1),
			provenance: emptyProvenance()
		});
		doc.insertNode(raw('a', 'A1', '=B1 + 1', ['b']));
		doc.insertNode(raw('b', 'B1', '=A1', ['a']));
		recalc(doc, [...doc.nodes.keys()], OPTS);
		const d = buildDerivation('a', doc, REGISTRY);
		expect(texts(d)).toEqual(['B1 + 1', '#CYCLE! + 1', '#CYCLE!']);
		expect(d.error).toBe('#CYCLE!');
	});

	it('without a registry, call chains stop gracefully at the settled value', () => {
		const doc = calcDoc();
		addComputed(doc, 'n', 'B1', '=SUM(A1, A2) * 2');
		const d = buildDerivation('n', doc);
		// SUM cannot reduce without a registry: substitution, then the result.
		expect(texts(d)).toEqual(['SUM(A1, A2) * 2', 'SUM(6, 2) * 2', '16']);
	});
});

// ---------------------------------------------------------------------------
// SHOWSTEPS(ref) — the un-stubbed built-in, end to end through commit/recalc
// ---------------------------------------------------------------------------

describe('SHOWSTEPS(ref) (V1-5-4 un-stub)', () => {
	/** A doc whose recalc is wired for derivations (the one line the UI adds). */
	function wiredDoc(): { doc: DocumentGraph; opts: RecalcOptions } {
		const doc = new DocumentGraph();
		const opts: RecalcOptions = { registry: REGISTRY, evaluate: evaluateWithDerivations(doc) };
		addInput(doc, 'span', 'A1', 6, opts);
		addInput(doc, 'w', 'A2', 12, opts);
		addComputed(doc, 'moment', 'A3', '=A2 * A1^2 / 8', opts);
		return { doc, opts };
	}

	function stringOf(doc: DocumentGraph, id: NodeId): string {
		const v = doc.nodes.get(id)?.value;
		if (v?.kind !== 'string') throw new Error(`node ${id} is not a string: ${JSON.stringify(v)}`);
		return v.value;
	}

	it('renders the referenced node’s derivation as the plain-text string', () => {
		const { doc, opts } = wiredDoc();
		addComputed(doc, 'steps', 'B1', '=SHOWSTEPS(A3)', opts);
		expect(stringOf(doc, 'steps')).toBe(
			'A2 * A1 ^ 2 / 8\n  = 12 * 6 ^ 2 / 8\n  = 12 * 36 / 8\n  = 432 / 8\n  = 54'
		);
	});

	it('resolves published names and lists the referenced node as an input', () => {
		const { doc, opts } = wiredDoc();
		must(
			commit(doc, { op: 'publishName', cellRef: cell('A3'), name: 'beam.moment' }, HUMAN, opts)
		);
		addComputed(doc, 'steps', 'B1', '=SHOWSTEPS(beam.moment)', opts);
		const namedId = doc.resolveRef({ name: 'beam.moment' }) as NodeId;
		// resolveInputs walks the ref argument, so recomputes propagate.
		expect(doc.nodes.get('steps')?.inputs).toEqual([namedId]);
		expect(stringOf(doc, 'steps')).toContain('beam.moment = A3');
	});

	it('recomputes when the derived-from chain changes (dependency propagation)', () => {
		const { doc, opts } = wiredDoc();
		addComputed(doc, 'steps', 'B1', '=SHOWSTEPS(A3)', opts);
		const r = must(commit(doc, { op: 'setInput', id: 'span', value: scalar(4) }, HUMAN, opts));
		expect(r.evaluated).toContain('steps');
		expect(stringOf(doc, 'steps')).toBe(
			'A2 * A1 ^ 2 / 8\n  = 12 * 4 ^ 2 / 8\n  = 12 * 16 / 8\n  = 192 / 8\n  = 24'
		);
	});

	it('derives an error node instead of propagating the error (a QAQC answer)', () => {
		const { doc, opts } = wiredDoc();
		addComputed(doc, 'bad', 'A4', '=A5 * 2', opts); // A5 unresolved → #REF!
		addComputed(doc, 'steps', 'B1', '=SHOWSTEPS(A4)', opts);
		expect(stringOf(doc, 'steps')).toBe('A5 * 2\n  = #REF! * 2\n  = #REF!');
	});

	it('a non-reference argument yields #VALUE!', () => {
		const { doc, opts } = wiredDoc();
		addComputed(doc, 'steps', 'B1', '=SHOWSTEPS(1 + 2)', opts);
		expect(doc.nodes.get('steps')?.value).toMatchObject({
			kind: 'error',
			code: '#VALUE!',
			origin: 'steps'
		});
	});

	it('an unresolved reference argument yields #REF!', () => {
		const { doc, opts } = wiredDoc();
		addComputed(doc, 'steps', 'B1', '=SHOWSTEPS(Z9)', opts);
		expect(doc.nodes.get('steps')?.value).toMatchObject({ kind: 'error', code: '#REF!' });
	});

	it('without the evaluateWithDerivations wiring, recalc degrades gracefully', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'x', 'A1', 1);
		addComputed(doc, 'steps', 'B1', '=SHOWSTEPS(A1)'); // plain OPTS: no nodeById
		expect(doc.nodes.get('steps')?.value).toMatchObject({
			kind: 'error',
			code: '#VALUE!',
			message: 'SHOWSTEPS: derivation unavailable'
		});
	});
});

describe('range substitution (SUM(A1:A3) shows each cell value)', () => {
	it('substitutes one value per constituent cell', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'a1', 'A1', 10);
		addInput(doc, 'a2', 'A2', 20);
		addInput(doc, 'a3', 'A3', 30);
		addComputed(doc, 'total', 'B1', '=SUM(A1:A3)');
		const d = buildDerivation('total', doc, REGISTRY);
		expect(d.error).toBeUndefined();
		expect(texts(d, 'formula')).toEqual(['SUM(A1:A3)']);
		expect(texts(d, 'substitution')).toEqual(['SUM(10, 20, 30)']);
		expect(texts(d, 'result')).toEqual(['60']);
	});
});
