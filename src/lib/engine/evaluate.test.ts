import { describe, expect, it } from 'vitest';
import { type EvalEnv, evaluateFormula } from './evaluate';
import { parseFormula } from './formula';
import { createBuiltinRegistry } from './registry';
import {
	type Dimension,
	type ErrCode,
	type NodeId,
	type TypedValue,
	booleanValue,
	errorValue,
	scalar,
	stringValue
} from './types';
import { dim, dimEq, parseQuantity } from './units';

const NODE = 'node-under-eval';

/** Parse a quantity fixture, failing loudly on typos. */
function q(text: string): TypedValue {
	const v = parseQuantity(text);
	if (v.kind === 'error') throw new Error(`bad fixture: ${text}`);
	return v;
}

/** Map-backed fake environment: two cells, published names, one error input. */
function makeEnv(): EvalEnv {
	const names = new Map<string, NodeId>([
		['beam.span', 'id-span'],
		['beam.width', 'id-width'],
		['x', 'id-x'],
		['novalue', 'id-novalue'],
		['err', 'id-err'],
		['flag', 'id-flag'],
		['label', 'id-label']
	]);
	const cells = new Map<string, NodeId>([
		['A1', 'id-a1'],
		['B2', 'id-b2']
	]);
	const values = new Map<NodeId, TypedValue>([
		['id-span', q('6 m')],
		['id-width', q('2 m')],
		['id-x', scalar(4)],
		['id-a1', scalar(10)],
		['id-b2', q('5 kN')],
		['id-err', errorValue('#UNIT!', 'upstream unit clash', 'id-err-origin')],
		['id-flag', booleanValue(true)],
		['id-label', stringValue('hello')]
	]);
	return {
		nodeId: NODE,
		registry: createBuiltinRegistry(),
		resolveRef: (ref) => ('name' in ref ? names.get(ref.name) : cells.get(ref.a1)),
		valueOf: (id) => values.get(id)
	};
}

/** Parse `src` and evaluate it against the fake environment. */
function evalSrc(src: string, env: EvalEnv = makeEnv()): TypedValue {
	const parsed = parseFormula(src);
	if (!parsed.ok) throw new Error(`fixture parse failed: ${src} — ${parsed.message}`);
	return evaluateFormula(parsed.ast, env);
}

function expectQuantity(
	v: TypedValue,
	value: number,
	d: Partial<Dimension>,
	display?: string
): void {
	expect(v.kind).toBe('quantity');
	if (v.kind !== 'quantity') return;
	expect(v.value).toBeCloseTo(value, 9);
	expect(dimEq(v.unit, dim(d)), `dim of ${JSON.stringify(v.unit)}`).toBe(true);
	expect(v.unit.display).toBe(display);
}

function expectError(v: TypedValue, code: ErrCode, origin: NodeId, messagePart?: string): void {
	expect(v.kind).toBe('error');
	if (v.kind !== 'error') return;
	expect(v.code).toBe(code);
	expect(v.origin).toBe(origin);
	if (messagePart !== undefined) expect(v.message).toContain(messagePart);
}

describe('evaluateFormula — scalar arithmetic', () => {
	it.each([
		['1 + 2 * 3', 7],
		['(1 + 2) * 3', 9],
		['2 ^ 3 ^ 2', 512], // right-assoc: 2^(3^2)
		['-2 ^ 2', 4], // Excel: unary minus binds tighter than ^
		['-(2 ^ 2)', -4],
		['1 - 2 - 3', -4], // left-assoc
		['10 / 4', 2.5],
		['x + 1', 5] // single-segment published name
	])('%s → %d', (src, expected) => {
		expect(evalSrc(src)).toEqual(scalar(expected));
	});

	it('1 / 0 → #VALUE! with the evaluating node as origin', () => {
		expectError(evalSrc('1 / 0'), '#VALUE!', NODE, 'division by zero');
	});
});

describe('evaluateFormula — unit literals & quantity algebra', () => {
	it('2 km → canonical SI magnitude with display unit (parseQuantity semantics)', () => {
		expectQuantity(evalSrc('2 km'), 2000, { L: 1 }, 'km');
	});

	it('5 kN + 3 kN → 8000 N canonical, display kN', () => {
		expectQuantity(evalSrc('5 kN + 3 kN'), 8000, { M: 1, L: 1, T: -2 }, 'kN');
	});

	it('5 mm + 1 m → 1.005 m canonical, first display wins', () => {
		expectQuantity(evalSrc('5 mm + 1 m'), 1.005, { L: 1 }, 'mm');
	});

	it('5 kN + 3 m → #UNIT! stamped with env.nodeId', () => {
		expectError(evalSrc('5 kN + 3 m'), '#UNIT!', NODE, 'cannot add');
	});

	it('(5 m)^2 → 25 m²', () => {
		expectQuantity(evalSrc('(5 m)^2'), 25, { L: 2 });
	});

	it('2 m * 3 m → 6 m² with composed display', () => {
		expectQuantity(evalSrc('2 m * 3 m'), 6, { L: 2 }, 'm·m');
	});

	it('10 m / 5 m → dimensionless ratio collapses to scalar', () => {
		expect(evalSrc('10 m / 5 m')).toEqual(scalar(2));
	});

	it.each([
		['5 kN > 3 kN', true],
		['1 km = 1000 m', true], // compared canonically
		['2 m >= 3 m', false]
	])('quantity comparison %s → %s', (src, expected) => {
		expect(evalSrc(src)).toEqual(booleanValue(expected));
	});

	it('comparing mismatched dimensions → #UNIT!', () => {
		expectError(evalSrc('5 kN < 3 m'), '#UNIT!', NODE, 'cannot compare');
	});

	it('unknown unit on a literal AST → #UNIT! (defensive; parser prevents it)', () => {
		const v = evaluateFormula({ t: 'lit', value: 5, unit: 'flurbs' }, makeEnv());
		expectError(v, '#UNIT!', NODE, 'unknown unit "flurbs"');
	});
});

describe('evaluateFormula — references', () => {
	it('cell ref resolves to its stored value', () => {
		expect(evalSrc('A1 + 1')).toEqual(scalar(11));
	});

	it('cell ref holding a quantity participates in unit algebra', () => {
		expectQuantity(evalSrc('B2 + 5 kN'), 10000, { M: 1, L: 1, T: -2 }, 'kN');
	});

	it('dotted published names resolve and compose', () => {
		expectQuantity(evalSrc('beam.span * beam.width'), 12, { L: 2 }, 'm·m');
	});

	it('non-numeric stored values flow through as-is', () => {
		expect(evalSrc('flag')).toEqual(booleanValue(true));
	});

	it('unresolved name → #NAME? with resolveInputs wording', () => {
		expectError(evalSrc('mystery + 1'), '#NAME?', NODE, 'unknown name "mystery"');
	});

	it('unresolved cell → #REF! with resolveInputs wording', () => {
		expectError(evalSrc('Z9'), '#REF!', NODE, 'unresolved cell Z9');
	});

	it('resolved node without a memoized value → #REF!', () => {
		expectError(evalSrc('novalue + 1'), '#REF!', NODE, 'id-novalue');
	});
});

describe('evaluateFormula — function calls', () => {
	it('SUM is variadic over scalars', () => {
		expect(evalSrc('SUM(1, 2, 3, 4)')).toEqual(scalar(10));
	});

	it('SUM lifts over quantities', () => {
		expectQuantity(evalSrc('SUM(1 kN, 2 kN)'), 3000, { M: 1, L: 1, T: -2 }, 'kN');
	});

	it.each([
		['IF(1 < 2, 10, 20)', 10],
		['IF(1 > 2, 10, 20)', 20],
		['MAX(1, 5, 3)', 5],
		['ROUND(3.14159, 2)', 3.14],
		['ABS(-3)', 3],
		['SUM(MAX(1, 2), MIN(3, 4))', 5] // nested calls
	])('%s → %d', (src, expected) => {
		expect(evalSrc(src)).toEqual(scalar(expected));
	});

	it('ROUND rounds in the display unit for quantities', () => {
		expectQuantity(evalSrc('ROUND(5.44 kN, 1)'), 5400, { M: 1, L: 1, T: -2 }, 'kN');
	});

	it('SQRT halves dimension exponents', () => {
		expectQuantity(evalSrc('SQRT(9 m^2)'), 3, { L: 1 });
	});

	it('unknown function → #NAME? from registry.call', () => {
		expectError(evalSrc('FOO(1)'), '#NAME?', NODE, 'unknown function FOO');
	});

	it('wrong argument kind → #VALUE!', () => {
		expectError(evalSrc('ROUND("x", 1)'), '#VALUE!', NODE, 'expects');
	});

	it('non-boolean IF condition → #VALUE!', () => {
		expectError(evalSrc('IF(5, 1, 2)'), '#VALUE!', NODE, 'condition');
	});
});

describe('evaluateFormula — error propagation (SCHEMA.md §11)', () => {
	it('an error input propagates through + keeping its ORIGINAL origin', () => {
		expectError(evalSrc('err + 1'), '#UNIT!', 'id-err-origin', 'upstream unit clash');
	});

	it('an error argument propagates through calls keeping its ORIGINAL origin', () => {
		expectError(evalSrc('SUM(1, err, 3)'), '#UNIT!', 'id-err-origin', 'upstream unit clash');
	});

	it('IF is eager: an error in the untaken branch still surfaces', () => {
		expectError(evalSrc('IF(TRUE, 1, err)'), '#UNIT!', 'id-err-origin');
	});

	it('an error propagates through unary minus unchanged', () => {
		expectError(evalSrc('-err'), '#UNIT!', 'id-err-origin');
	});
});

describe('evaluateFormula — strings & booleans', () => {
	it.each([
		['"hello"', stringValue('hello')],
		['TRUE', booleanValue(true)],
		['FALSE', booleanValue(false)],
		['NOT TRUE', booleanValue(false)],
		['1 = 1', booleanValue(true)],
		['1 <> 2', booleanValue(true)],
		['"a" <> "b"', booleanValue(true)],
		['label = "hello"', booleanValue(true)]
	])('%s', (src, expected) => {
		expect(evalSrc(src)).toEqual(expected);
	});

	it('NOT on a non-boolean → #VALUE!', () => {
		expectError(evalSrc('NOT 1'), '#VALUE!', NODE, 'NOT expects a boolean');
	});
});
