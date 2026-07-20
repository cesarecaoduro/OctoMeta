import { describe, expect, it } from 'vitest';
import type {
	ChipBinding,
	CommitResult,
	GraphNode,
	MutationError,
	NodeId,
	Result,
	TypedValue
} from '../engine';
import {
	DocumentGraph,
	booleanValue,
	buildDerivation,
	commit,
	createBuiltinRegistry,
	emptyProvenance,
	errorValue,
	parseFormula,
	renderStepsText,
	scalar,
	stringValue
} from '../engine';
import {
	canExpandSteps,
	chipDerivation,
	chipDisplay,
	derivationLines,
	filterPickItems,
	isPendingValue,
	planChipSync,
	sameDisplay,
	type ChipOccurrence
} from './chips';
import { matchChipQuery } from './chip-picker';

/**
 * V1-5-3 — pure chip logic: display mapping (values, formats, errors, busy,
 * dangling), the doc ⇄ bindings sync plan (deletes, duplicates, host drift),
 * and the `@` picker's filtering + trigger detection.
 */

function node(value: TypedValue, extra: Partial<GraphNode> = {}): GraphNode {
	return {
		id: 'n1',
		kind: 'input',
		value,
		inputs: [],
		contentHash: '',
		provenance: emptyProvenance(),
		...extra
	};
}

const binding: ChipBinding = { id: 'ch1', blockId: 'blk1', nodeId: 'n1' };

describe('chipDisplay', () => {
	it('renders scalars with float-noise cleanup and no accent on labels', () => {
		const d = chipDisplay(binding, node(scalar(0.1 + 0.2), { name: 'beam.span' }));
		expect(d).toEqual({ state: 'value', text: '0.3', label: 'beam.span: 0.3' });
	});

	it('respects format.digits', () => {
		const withDigits: ChipBinding = { ...binding, format: { digits: 2 } };
		expect(chipDisplay(withDigits, node(scalar(12))).text).toBe('12.00');
		expect(chipDisplay(withDigits, node(scalar(1.005))).text).toBe((1.005).toFixed(2));
	});

	it('renders quantities through the shared formatter', () => {
		const q: TypedValue = {
			kind: 'quantity',
			value: 2.5,
			unit: { L: 1, M: 0, T: 0, I: 0, Θ: 0, N: 0, J: 0, display: 'm' }
		};
		expect(chipDisplay(binding, node(q)).text).toBe('2.5 m');
	});

	it('renders strings and booleans sensibly', () => {
		expect(chipDisplay(binding, node(stringValue('S355'))).text).toBe('S355');
		expect(chipDisplay(binding, node(booleanValue(true))).text).toBe('TRUE');
		expect(chipDisplay(binding, node(booleanValue(false))).text).toBe('FALSE');
	});

	it('labels by published name, then cell address, then id', () => {
		expect(chipDisplay(binding, node(scalar(1), { name: 'a.b' })).label).toBe('a.b: 1');
		expect(
			chipDisplay(binding, node(scalar(1), { cellRef: { sheetId: 's', a1: 'B2' } })).label
		).toBe('B2: 1');
		expect(chipDisplay(binding, node(scalar(1))).label).toBe('n1: 1');
	});

	it('errors render the code and carry the origin for deep-linking', () => {
		const d = chipDisplay(binding, node(errorValue('#CYCLE!', 'cycle members: a, b', 'origin-id')));
		expect(d.state).toBe('error');
		expect(d.text).toBe('#CYCLE!');
		expect(d.origin).toBe('origin-id');
		expect(d.label).toContain('#CYCLE!');
	});

	it('errors with no origin have none to deep-link to', () => {
		const d = chipDisplay(binding, node(errorValue('#REF!', 'gone')));
		expect(d.state).toBe('error');
		expect(d.origin).toBeUndefined();
	});

	it('the pre-settle placeholder renders busy', () => {
		const pending = errorValue('#VALUE!', 'not yet evaluated', 'n1');
		expect(isPendingValue(pending)).toBe(true);
		const d = chipDisplay(binding, node(pending));
		expect(d).toMatchObject({ state: 'busy', text: '…' });
	});

	it('missing binding or deleted node renders #REF! (dangling)', () => {
		expect(chipDisplay(undefined, node(scalar(1)))).toMatchObject({
			state: 'dangling',
			text: '#REF!'
		});
		expect(chipDisplay(binding, undefined)).toMatchObject({ state: 'dangling', text: '#REF!' });
	});

	it('sameDisplay compares everything that paints', () => {
		const a = chipDisplay(binding, node(scalar(1)));
		expect(sameDisplay(a, chipDisplay(binding, node(scalar(1))))).toBe(true);
		expect(sameDisplay(a, chipDisplay(binding, node(scalar(2))))).toBe(false);
	});
});

describe('planChipSync', () => {
	const chips = (...list: ChipBinding[]): Map<string, ChipBinding> =>
		new Map(list.map((c) => [c.id, c]));
	const occ = (chipId: string, pos: number, hostBlockId: string | null): ChipOccurrence<number> => ({
		chipId,
		pos,
		hostBlockId
	});
	const blocks = (...ids: string[]) => {
		const set = new Set(ids);
		return (id: string) => set.has(id);
	};

	it('is a no-op when doc and bindings agree', () => {
		const plan = planChipSync([occ('ch1', 5, 'blk1')], chips(binding), blocks('blk1'));
		expect(plan).toEqual({ remints: [], drifts: [], removals: [] });
	});

	it('plans removal when a chip node vanished and its block still exists', () => {
		const plan = planChipSync([], chips(binding), blocks('blk1'));
		expect(plan.removals).toEqual(['ch1']);
	});

	it('skips removal when the hosting block is gone (blockOp remove cascaded)', () => {
		const plan = planChipSync([], chips(binding), blocks());
		expect(plan.removals).toEqual([]);
	});

	it('plans a remint for each duplicate occurrence, keeping the first', () => {
		const plan = planChipSync(
			[occ('ch1', 5, 'blk1'), occ('ch1', 20, 'blk2'), occ('ch1', 30, 'blk1')],
			chips(binding),
			blocks('blk1', 'blk2')
		);
		expect(plan.remints).toEqual([
			{ pos: 20, sourceChipId: 'ch1', hostBlockId: 'blk2' },
			{ pos: 30, sourceChipId: 'ch1', hostBlockId: 'blk1' }
		]);
		expect(plan.removals).toEqual([]);
	});

	it('plans host drift as the binding following the chip to its new block', () => {
		const plan = planChipSync([occ('ch1', 5, 'blk2')], chips(binding), blocks('blk1', 'blk2'));
		expect(plan.drifts).toEqual([{ chipId: 'ch1', hostBlockId: 'blk2' }]);
	});

	it('unknown chip nodes (cross-doc paste) plan nothing on their own', () => {
		const plan = planChipSync([occ('ghost', 5, 'blk1')], chips(), blocks('blk1'));
		expect(plan).toEqual({ remints: [], drifts: [], removals: [] });
	});
});

describe('picker: filterPickItems + matchChipQuery', () => {
	const items = [
		{ name: 'beam.span', nodeId: 'n1' },
		{ name: 'beam.load', nodeId: 'n2' },
		{ name: 'span.total', nodeId: 'n3' },
		{ name: 'col.height', nodeId: 'n4' }
	];

	it('filters case-insensitively, prefix matches first, alphabetical within', () => {
		expect(filterPickItems(items, 'beam').map((i) => i.name)).toEqual(['beam.load', 'beam.span']);
		expect(filterPickItems(items, 'span').map((i) => i.name)).toEqual(['span.total', 'beam.span']);
		expect(filterPickItems(items, 'SPAN').map((i) => i.name)).toEqual(['span.total', 'beam.span']);
	});

	it('empty query lists everything (capped)', () => {
		expect(filterPickItems(items, '').length).toBe(4);
		expect(filterPickItems(items, '', 2).length).toBe(2);
	});

	it('matchChipQuery finds an open @trigger at start or after whitespace', () => {
		expect(matchChipQuery('@')).toEqual({ query: '', length: 1 });
		expect(matchChipQuery('see @beam.sp')).toEqual({ query: 'beam.sp', length: 8 });
		expect(matchChipQuery('(@x')).toEqual({ query: 'x', length: 2 });
	});

	it('matchChipQuery never fires mid-word or after the trigger closes', () => {
		expect(matchChipQuery('mail@example')).toBeNull();
		expect(matchChipQuery('see @beam.span done')).toBeNull();
		expect(matchChipQuery('no trigger')).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Show-steps expansion (V1-5-4)
// ---------------------------------------------------------------------------

describe('show-steps expansion helpers', () => {
	const HUMAN = { kind: 'human' } as const;

	function must(r: Result<CommitResult, MutationError>): CommitResult {
		if (!r.ok) throw new Error(`test mutation rejected: ${r.error.message}`);
		return r.value;
	}

	/**
	 * A real graph built through the engine write path: A1 = 12 published as
	 * `beam.span`, B1 `=A1 * 2 + 1` published as `beam.load`.
	 */
	function calcGraph() {
		const graph = new DocumentGraph();
		const registry = createBuiltinRegistry();
		const opts = { registry };
		const SHEET = 'blk-sheet';
		const ast = (src: string) => {
			const parsed = parseFormula(src, { sheetId: SHEET });
			if (!parsed.ok) throw new Error(parsed.message);
			return parsed.ast;
		};
		must(
			commit(
				graph,
				{
					op: 'addNode',
					node: {
						id: 'na1',
						kind: 'input',
						cellRef: { sheetId: SHEET, a1: 'A1' },
						provenance: emptyProvenance()
					}
				},
				HUMAN,
				opts
			)
		);
		must(commit(graph, { op: 'setInput', id: 'na1', value: scalar(12) }, HUMAN, opts));
		must(
			commit(
				graph,
				{
					op: 'addNode',
					node: {
						id: 'nb1',
						kind: 'computed',
						formula: ast('=A1 * 2 + 1'),
						cellRef: { sheetId: SHEET, a1: 'B1' },
						provenance: emptyProvenance()
					}
				},
				HUMAN,
				opts
			)
		);
		const spanId = must(
			commit(
				graph,
				{ op: 'publishName', cellRef: { sheetId: SHEET, a1: 'A1' }, name: 'beam.span' },
				HUMAN,
				opts
			)
		).affected[0] as NodeId;
		const loadId = must(
			commit(
				graph,
				{ op: 'publishName', cellRef: { sheetId: SHEET, a1: 'B1' }, name: 'beam.load' },
				HUMAN,
				opts
			)
		).affected[0] as NodeId;
		return { graph, registry, spanId, loadId };
	}

	it('canExpandSteps: only settled non-error values expand', () => {
		const b: ChipBinding = { id: 'c', blockId: 'blk', nodeId: 'n1' };
		expect(canExpandSteps(chipDisplay(b, node(scalar(25))))).toBe(true);
		expect(canExpandSteps(chipDisplay(b, node(stringValue('S355'))))).toBe(true);
		expect(canExpandSteps(chipDisplay(b, node(errorValue('#REF!', 'gone'))))).toBe(false);
		expect(canExpandSteps(chipDisplay(b, undefined))).toBe(false); // dangling
		expect(canExpandSteps(chipDisplay(b, node(errorValue('#VALUE!', 'not yet evaluated'))))).toBe(
			false
		); // busy
	});

	it('chipDerivation follows the published-name alias one hop to the cell formula', () => {
		const { graph, registry, loadId } = calcGraph();
		const d = chipDerivation(loadId, graph, registry);
		expect(d.nodeId).toBe(loadId);
		expect(d.name).toBe('beam.load');
		expect(d.steps.map((s) => s.kind)).toEqual([
			'formula',
			'substitution',
			'intermediate',
			'result'
		]);
		expect(renderStepsText(d)).toBe(
			'beam.load = A1 * 2 + 1\n  = 12 * 2 + 1\n  = 24 + 1\n  = 25'
		);
	});

	it('chipDerivation on a name aliasing an input still heads with the name', () => {
		const { graph, registry, spanId } = calcGraph();
		const d = chipDerivation(spanId, graph, registry);
		expect(d.name).toBe('beam.span');
		expect(renderStepsText(d)).toBe('beam.span = 12');
	});

	it('chipDerivation on a plain node is buildDerivation verbatim', () => {
		const { graph, registry } = calcGraph();
		expect(chipDerivation('nb1', graph, registry)).toEqual(
			buildDerivation('nb1', graph, registry)
		);
		expect(chipDerivation('na1', graph, registry)).toEqual(
			buildDerivation('na1', graph, registry)
		);
	});

	it('derivationLines mirrors renderStepsText: named head, `=`-prefixed rest', () => {
		const { graph, registry, loadId } = calcGraph();
		const lines = derivationLines(chipDerivation(loadId, graph, registry));
		expect(lines).toEqual([
			{ kind: 'formula', text: 'beam.load = A1 * 2 + 1' },
			{ kind: 'substitution', text: '= 12 * 2 + 1' },
			{ kind: 'intermediate', text: '= 24 + 1' },
			{ kind: 'result', text: '= 25' }
		]);
	});

	it('derivationLines without a name heads with the bare step text', () => {
		const { graph, registry } = calcGraph();
		const lines = derivationLines(buildDerivation('nb1', graph, registry));
		expect(lines[0]).toEqual({ kind: 'formula', text: 'A1 * 2 + 1' });
		expect(lines[lines.length - 1]).toEqual({ kind: 'result', text: '= 25' });
	});
});
