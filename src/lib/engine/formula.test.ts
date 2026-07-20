import { describe, expect, it } from 'vitest';
import {
	type FormulaAST,
	MAX_RANGE_CELLS,
	expandRange,
	parseFormula,
	printFormula,
	resolveInputs
} from './formula';
import type { CellRef, NodeId } from './types';

const SHEET = 'sheet-1';

function parse(src: string): FormulaAST {
	const r = parseFormula(src, { sheetBlockId: SHEET });
	if (!r.ok) throw new Error(`parse failed for "${src}": ${r.message} @ ${r.pos}`);
	return r.ast;
}

describe('parse/print round-trip corpus (V1-1-3)', () => {
	// [source, canonical print] — parsing the canonical text must reproduce
	// the identical AST, and printing is stable (idempotent).
	it.each([
		// literals & arithmetic
		['1 + 2', '1 + 2'],
		['1+2*3', '1 + 2 * 3'],
		['(1+2)*3', '(1 + 2) * 3'],
		['2 * (3 + 4)', '2 * (3 + 4)'],
		['1 - 2 - 3', '1 - 2 - 3'],
		['1 - (2 - 3)', '1 - (2 - 3)'],
		['2^3^2', '2 ^ 3 ^ 2'],
		['(2^3)^2', '(2 ^ 3) ^ 2'],
		['-2^2', '-2 ^ 2'],
		['--5', '--5'],
		['1.5e3 + .5', '1500 + 0.5'],
		// unit literals
		['5 kN * 2', '5 kN * 2'],
		['5 kN·m / 2', '5 kN·m / 2'],
		['3.2 m + 250 mm', '3.2 m + 250 mm'],
		['9.81 m/s^2', '9.81 m/s^2'],
		['10 m / s', '10 m/s'],
		['5 m2', '5 m2'],
		['4 m²', '4 m²'],
		['5 s^-1', '5 s^-1'],
		['90 deg', '90 deg'],
		['1e3 N + 1 kN', '1000 N + 1 kN'],
		// `*` is always arithmetic in formulas; compound units use `·` or `/`
		['5 kN * m', '5 kN * m'],
		// cell refs, ranges, names
		['A1', 'A1'],
		['a1', 'A1'],
		['A1:B2', 'A1:B2'],
		['beam.span', 'beam.span'],
		['footing.width.total', 'footing.width.total'],
		['span', 'span'],
		['A1 + B2 * C3', 'A1 + B2 * C3'],
		['5 * m2', '5 * M2'],
		['5 kN/m2', '5 kN / M2'],
		['-A1', '-A1'],
		// calls
		['SUM(A1:B2)', 'SUM(A1:B2)'],
		['sum(1, 2, 3)', 'SUM(1, 2, 3)'],
		['IF(A1 > 5 kN, 1, 0)', 'IF(A1 > 5 kN, 1, 0)'],
		['MAX(beam.span, 2 m)', 'MAX(beam.span, 2 m)'],
		['SQRT(A1)', 'SQRT(A1)'],
		['POW(2, 10)', 'POW(2, 10)'],
		['AVERAGE(A1, A2, A3)', 'AVERAGE(A1, A2, A3)'],
		['ROUND(beam.load / 3, 2)', 'ROUND(beam.load / 3, 2)'],
		// strings & booleans
		['"hello"', '"hello"'],
		['"say ""hi"""', '"say ""hi"""'],
		['true', 'TRUE'],
		['FALSE', 'FALSE'],
		['NOT TRUE', 'NOT TRUE'],
		['NOT A1 = 5', 'NOT A1 = 5'],
		['(NOT A1) = TRUE', '(NOT A1) = TRUE'],
		// comparisons
		['1 < 2', '1 < 2'],
		['1 <= 2', '1 <= 2'],
		['1 <> 2', '1 <> 2'],
		['1 >= 2', '1 >= 2'],
		['A1 = beam.span', 'A1 = beam.span'],
		// sheet convention
		['=A1 + 1', 'A1 + 1']
	])('%s → %s', (src, canonical) => {
		const ast = parse(src);
		const printed = printFormula(ast);
		expect(printed).toBe(canonical);
		expect(parse(printed)).toEqual(ast);
		expect(printFormula(parse(printed))).toBe(printed);
	});

	it('resolves cell refs against the parsing sheet context', () => {
		expect(parse('A1')).toEqual({ t: 'ref', ref: { sheetBlockId: SHEET, a1: 'A1' } });
		expect(parse('A1:B2')).toEqual({ t: 'ref', ref: { sheetBlockId: SHEET, a1: 'A1:B2' } });
	});

	it('builds unit literals with raw magnitude and source unit text', () => {
		expect(parse('5 kN')).toEqual({ t: 'lit', value: 5, unit: 'kN' });
		expect(parse('9.81 m/s^2')).toEqual({ t: 'lit', value: 9.81, unit: 'm/s^2' });
	});

	it('keeps unary minus tighter than ^ (Excel semantics)', () => {
		expect(parse('-2^2')).toEqual({
			t: 'bin',
			op: '^',
			left: { t: 'un', op: '-', arg: { t: 'lit', value: 2 } },
			right: { t: 'lit', value: 2 }
		});
	});

	it('treats a cell-ref lookalike denominator as a cell ref', () => {
		expect(parse('5 kN/m2')).toEqual({
			t: 'bin',
			op: '/',
			left: { t: 'lit', value: 5, unit: 'kN' },
			right: { t: 'ref', ref: { sheetBlockId: SHEET, a1: 'M2' } }
		});
	});

	it('survives JSON serialization (AST is plain data)', () => {
		const ast = parse('IF(A1 > 5 kN, beam.span * 2, SQRT(B2))');
		expect(JSON.parse(JSON.stringify(ast))).toEqual(ast);
	});
});

describe('parse errors (V1-1-3)', () => {
	it.each([
		['1 +'],
		['((1)'],
		['"unterminated'],
		['5 @'],
		['SUM(1,'],
		['beam.'],
		['1 2'],
		['* 3'],
		['·'],
		['']
	])('rejects %j', (src) => {
		const r = parseFormula(src, { sheetBlockId: SHEET });
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.message.length).toBeGreaterThan(0);
			expect(r.pos).toBeGreaterThanOrEqual(0);
		}
	});
});

describe('resolveInputs — edges are derived (V1-1-3)', () => {
	const nodes = new Map<string, NodeId>([
		[`${SHEET}!A1`, 'node-a1'],
		[`${SHEET}!A2`, 'node-a2'],
		[`${SHEET}!B1`, 'node-b1'],
		[`${SHEET}!B2`, 'node-b2'],
		['beam.span', 'node-span']
	]);
	const resolver = (ref: CellRef | { name: string }): NodeId | undefined =>
		'name' in ref ? nodes.get(ref.name) : nodes.get(`${ref.sheetBlockId}!${ref.a1}`);

	it('collects referenced nodes in first-appearance order, deduplicated', () => {
		expect(resolveInputs(parse('A1 + beam.span * A1 - B2'), resolver)).toEqual([
			'node-a1',
			'node-span',
			'node-b2'
		]);
	});

	it('expands ranges into their constituent cells, row-major', () => {
		expect(resolveInputs(parse('SUM(A1:B2, beam.span)'), resolver)).toEqual([
			'node-a1',
			'node-b1',
			'node-a2',
			'node-b2',
			'node-span'
		]);
	});

	it('a range with a missing constituent cell → #REF! naming that cell', () => {
		const err = resolveInputs(parse('SUM(A1:A3)'), resolver);
		expect(err).toMatchObject({ kind: 'error', code: '#REF!' });
		if ('kind' in err) expect(err.message).toContain('A3');
	});

	it('a formula with no refs has no inputs', () => {
		expect(resolveInputs(parse('1 + 2 * 3'), resolver)).toEqual([]);
	});

	it('unresolved published name → #NAME? as a value', () => {
		const err = resolveInputs(parse('beam.missing + 1'), resolver);
		expect(err).toMatchObject({ kind: 'error', code: '#NAME?' });
		if ('kind' in err) expect(err.message).toContain('beam.missing');
	});

	it('dangling cell ref → #REF! as a value', () => {
		const err = resolveInputs(parse('Z99 * 2'), resolver);
		expect(err).toMatchObject({ kind: 'error', code: '#REF!' });
		if ('kind' in err) expect(err.message).toContain('Z99');
	});

	it('walks unary, binary, and nested call structure', () => {
		expect(resolveInputs(parse('-A1 + NOT (B2 = 1)'), resolver)).toEqual([
			'node-a1',
			'node-b2'
		]);
	});
});

describe('expandRange — ranges are call-argument sugar', () => {
	const a1s = (ref: { a1: string }): ReturnType<typeof expandRange> | string[] => {
		const r = expandRange({ sheetBlockId: SHEET, ...ref });
		return Array.isArray(r) ? r.map((c) => c.a1) : r;
	};

	it('expands a column range', () => {
		expect(a1s({ a1: 'A1:A3' })).toEqual(['A1', 'A2', 'A3']);
	});

	it('expands a rectangle row-major', () => {
		expect(a1s({ a1: 'A1:B2' })).toEqual(['A1', 'B1', 'A2', 'B2']);
	});

	it('normalizes reversed corners', () => {
		expect(a1s({ a1: 'B2:A1' })).toEqual(['A1', 'B1', 'A2', 'B2']);
	});

	it('carries the sheet through to every cell', () => {
		const cells = expandRange({ sheetBlockId: SHEET, a1: 'A1:A2' });
		expect(cells).toEqual([
			{ sheetBlockId: SHEET, a1: 'A1' },
			{ sheetBlockId: SHEET, a1: 'A2' }
		]);
	});

	it('crosses the Z→AA column boundary', () => {
		expect(a1s({ a1: 'Z1:AB1' })).toEqual(['Z1', 'AA1', 'AB1']);
	});

	it(`caps expansion at ${MAX_RANGE_CELLS} cells with a #VALUE!`, () => {
		expect(expandRange({ sheetBlockId: SHEET, a1: 'A1:A2000' })).toMatchObject({
			kind: 'error',
			code: '#VALUE!'
		});
	});

	it('rejects malformed ranges with a #REF!', () => {
		expect(expandRange({ sheetBlockId: SHEET, a1: 'A1:' })).toMatchObject({
			kind: 'error',
			code: '#REF!'
		});
	});
});
