import { describe, expect, it } from 'vitest';
import type { Actor, CommitResult, MutationError, NodeId, Result } from '../engine';
import {
	DocumentGraph,
	commit,
	createBuiltinRegistry,
	emptyProvenance,
	errorValue,
	parseFormula,
	scalar,
	stringValue
} from '../engine';
import { buildInspector, formatActor, formatTimestamp } from './inspector';

/**
 * V1-5-5 — the provenance inspector's pure view-model: node → panel mapping
 * (name/kind/formula/value), provenance formatting across all actor kinds
 * (human/template/agent), and inputs/dependents link resolution over a graph
 * built through the REAL write path (`commit`), never by poking internals.
 */

const HUMAN: Actor = { kind: 'human' };
const TEMPLATE: Actor = { kind: 'template', id: 'beam-template' };
const AGENT: Actor = { kind: 'agent', id: 'agent-7' };
const SHEET = 'blk-sheet';

function must(r: Result<CommitResult, MutationError>): CommitResult {
	if (!r.ok) throw new Error(`test mutation rejected: ${r.error.message}`);
	return r.value;
}

/**
 * The standard fixture: A1 span = 6 (template) · A2 w = 12 (human) ·
 * A3 `=A2 * A1^2 / 8` (agent) · publish `beam.span` on A1, `beam.moment` on
 * A3 · B1 `=beam.moment / 25`. Returns the graph plus the ids involved.
 */
function buildGraph() {
	const registry = createBuiltinRegistry();
	const graph = new DocumentGraph();
	const opts = { registry };
	const ast = (src: string) => {
		const parsed = parseFormula(src, { sheetId: SHEET });
		if (!parsed.ok) throw new Error(parsed.message);
		return parsed.ast;
	};
	const addInput = (id: NodeId, a1: string, value: number, actor: Actor): void => {
		must(
			commit(
				graph,
				{
					op: 'addNode',
					node: {
						id,
						kind: 'input',
						cellRef: { sheetId: SHEET, a1 },
						provenance: emptyProvenance()
					}
				},
				actor,
				opts
			)
		);
		must(commit(graph, { op: 'setInput', id, value: scalar(value) }, actor, opts));
	};
	addInput('n-span', 'A1', 6, TEMPLATE);
	addInput('n-w', 'A2', 12, HUMAN);
	must(
		commit(
			graph,
			{
				op: 'addNode',
				node: {
					id: 'n-moment',
					kind: 'computed',
					formula: ast('=A2 * A1^2 / 8'),
					cellRef: { sheetId: SHEET, a1: 'A3' },
					provenance: emptyProvenance()
				}
			},
			AGENT,
			opts
		)
	);
	must(
		commit(
			graph,
			{ op: 'publishName', cellRef: { sheetId: SHEET, a1: 'A1' }, name: 'beam.span' },
			HUMAN,
			opts
		)
	);
	const momentNameId = must(
		commit(
			graph,
			{ op: 'publishName', cellRef: { sheetId: SHEET, a1: 'A3' }, name: 'beam.moment' },
			HUMAN,
			opts
		)
	).affected[0];
	must(
		commit(
			graph,
			{
				op: 'addNode',
				node: {
					id: 'n-util',
					kind: 'computed',
					formula: ast('=beam.moment / 25'),
					cellRef: { sheetId: SHEET, a1: 'B1' },
					provenance: emptyProvenance()
				}
			},
			HUMAN,
			opts
		)
	);
	return { graph, registry, momentNameId };
}

describe('buildInspector · node mapping', () => {
	it('maps an input node: cell title, kind, value, no formula', () => {
		const { graph } = buildGraph();
		const vm = buildInspector(graph, 'n-w');
		expect(vm).not.toBeNull();
		expect(vm?.title).toBe('A2');
		expect(vm?.name).toBeUndefined();
		expect(vm?.kind).toBe('input');
		expect(vm?.formula).toBeUndefined();
		expect(vm?.value).toEqual({ text: '12', state: 'value' });
	});

	it('maps a computed node: kind `formula`, canonical formula text, settled value', () => {
		const { graph } = buildGraph();
		const vm = buildInspector(graph, 'n-moment');
		expect(vm?.kind).toBe('formula');
		expect(vm?.formula).toBe('= A2 * A1 ^ 2 / 8');
		expect(vm?.value).toEqual({ text: '54', state: 'value' });
	});

	it('maps a namedOutput: published name as title, alias formula', () => {
		const { graph, momentNameId } = buildGraph();
		const vm = buildInspector(graph, momentNameId);
		expect(vm?.title).toBe('beam.moment');
		expect(vm?.name).toBe('beam.moment');
		expect(vm?.kind).toBe('namedOutput');
		expect(vm?.formula).toBe('= A3');
	});

	it('renders error values as their code, as-is', () => {
		const { graph, registry } = buildGraph();
		const parsed = parseFormula('=missing.name', { sheetId: SHEET });
		if (!parsed.ok) throw new Error(parsed.message);
		must(
			commit(
				graph,
				{
					op: 'addNode',
					node: {
						id: 'n-bad',
						kind: 'computed',
						formula: parsed.ast,
						cellRef: { sheetId: SHEET, a1: 'C1' },
						provenance: emptyProvenance()
					}
				},
				HUMAN,
				{ registry }
			)
		);
		expect(buildInspector(graph, 'n-bad')?.value).toEqual({ text: '#NAME?', state: 'error' });
	});

	it('renders the pre-settle seed as busy, and strings/floats like chips', () => {
		const { graph, registry } = buildGraph();
		// addNode without setInput leaves the engine's `not yet evaluated` seed.
		must(
			commit(
				graph,
				{
					op: 'addNode',
					node: {
						id: 'n-seed',
						kind: 'input',
						cellRef: { sheetId: SHEET, a1: 'C2' },
						provenance: emptyProvenance()
					}
				},
				HUMAN,
				{ registry }
			)
		);
		expect(buildInspector(graph, 'n-seed')?.value).toEqual({ text: '…', state: 'busy' });

		must(commit(graph, { op: 'setInput', id: 'n-seed', value: scalar(0.1 + 0.2) }, HUMAN, {
			registry
		}));
		expect(buildInspector(graph, 'n-seed')?.value).toEqual({ text: '0.3', state: 'value' });

		must(commit(graph, { op: 'setInput', id: 'n-seed', value: stringValue('IPE 200') }, HUMAN, {
			registry
		}));
		expect(buildInspector(graph, 'n-seed')?.value).toEqual({ text: 'IPE 200', state: 'value' });
	});

	it('returns null for a missing node', () => {
		const { graph } = buildGraph();
		expect(buildInspector(graph, 'no-such-node')).toBeNull();
	});
});

describe('buildInspector · provenance attribution', () => {
	it('attributes human authorship without an id as the bare kind', () => {
		const { graph } = buildGraph();
		const vm = buildInspector(graph, 'n-w');
		expect(vm?.authored?.actor).toBe('human');
		expect(vm?.authored?.at).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}$/);
	});

	it('attributes template authorship as kind · id', () => {
		const { graph } = buildGraph();
		expect(buildInspector(graph, 'n-span')?.authored?.actor).toBe('template · beam-template');
	});

	it('attributes agent authorship as kind · id', () => {
		const { graph } = buildGraph();
		expect(buildInspector(graph, 'n-moment')?.authored?.actor).toBe('agent · agent-7');
	});

	it('omits authorship while unauthored and surfaces verification when present', () => {
		const { graph } = buildGraph();
		const node = graph.nodes.get('n-util');
		if (!node) throw new Error('fixture node missing');
		// Unauthored provenance (never produced by commit, but serialized state
		// can carry it): no attribution shown.
		node.provenance = emptyProvenance();
		expect(buildInspector(graph, 'n-util')?.authored).toBeUndefined();

		// Verification stamps (SCHEMA.md §3) render when present.
		node.provenance = {
			authoredBy: 'human',
			authoredAt: Date.UTC(2026, 6, 20, 10, 30),
			verifiedBy: 'reviewer-1',
			verifiedAt: Date.UTC(2026, 6, 21, 8, 0)
		};
		const vm = buildInspector(graph, 'n-util');
		expect(vm?.verified?.by).toBe('reviewer-1');
		expect(vm?.verified?.at).toBe(formatTimestamp(Date.UTC(2026, 6, 21, 8, 0)));
	});
});

describe('buildInspector · inputs and dependents links', () => {
	it('lists direct inputs in formula reference order with labels and kinds', () => {
		const { graph } = buildGraph();
		const vm = buildInspector(graph, 'n-moment');
		expect(vm?.inputs.map((l) => [l.label, l.kind, l.nodeId])).toEqual([
			['A2', 'input', 'n-w'],
			['A1', 'input', 'n-span']
		]);
	});

	it('lists direct dependents (reverse edges) sorted by label', () => {
		const { graph } = buildGraph();
		const vm = buildInspector(graph, 'n-span');
		// A1 feeds the moment formula (A3) and the published name beam.span.
		expect(vm?.dependents.map((l) => [l.label, l.kind])).toEqual([
			['A3', 'formula'],
			['beam.span', 'namedOutput']
		]);
	});

	it('walks the chain end to end through link nodeIds: util → name → cell → input', () => {
		const { graph, momentNameId } = buildGraph();
		const util = buildInspector(graph, 'n-util');
		expect(util?.inputs.map((l) => l.nodeId)).toEqual([momentNameId]);
		const named = buildInspector(graph, momentNameId);
		expect(named?.inputs.map((l) => l.nodeId)).toEqual(['n-moment']);
		const moment = buildInspector(graph, 'n-moment');
		expect(moment?.inputs.map((l) => l.nodeId)).toContain('n-span');
		const span = buildInspector(graph, 'n-span');
		expect(span?.inputs).toEqual([]); // a source input: the walk terminates
		expect(named?.dependents.map((l) => l.nodeId)).toEqual(['n-util']); // and back down
	});

	it('skips link ids without a live node instead of rendering dead ends', () => {
		const source = {
			nodes: new Map([
				[
					'n1',
					{
						id: 'n1',
						kind: 'computed' as const,
						value: errorValue('#REF!', 'gone', 'n1'),
						inputs: ['ghost'],
						contentHash: '',
						provenance: emptyProvenance()
					}
				]
			]),
			dependentsOf: () => ['ghost'] as const
		};
		const vm = buildInspector(source, 'n1');
		expect(vm?.inputs).toEqual([]);
		expect(vm?.dependents).toEqual([]);
	});
});

describe('formatting helpers', () => {
	it('formatTimestamp renders an absolute local date-time', () => {
		const ts = Date.UTC(2026, 6, 20, 12, 5);
		const d = new Date(ts);
		const pad = (n: number) => String(n).padStart(2, '0');
		const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		expect(formatTimestamp(ts)).toBe(
			`${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
		);
	});

	it('formatActor covers all actor kinds and the unauthored state', () => {
		expect(formatActor({ authoredBy: null })).toBeUndefined();
		expect(formatActor({ authoredBy: 'human' })).toBe('human');
		expect(formatActor({ authoredBy: 'human', authorId: 'cesare' })).toBe('human · cesare');
		expect(formatActor({ authoredBy: 'template', authorId: 'beam-template' })).toBe(
			'template · beam-template'
		);
		expect(formatActor({ authoredBy: 'agent', authorId: '' })).toBe('agent');
	});
});
