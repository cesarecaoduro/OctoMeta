import { describe, expect, it } from 'vitest';
import {
	type TypedValue,
	errorValue,
	isError,
	isQuantity,
	isScalar,
	quantity,
	scalar,
	stringValue,
	booleanValue
} from './types';
import {
	DIMENSIONLESS,
	convert,
	dim,
	dimDiv,
	dimEq,
	dimMul,
	dimPow,
	format,
	isCanonicalUnit,
	isDimensionless,
	isUnitSymbol,
	parseQuantity,
	parseUnit,
	qAbs,
	qAdd,
	qCompare,
	qDiv,
	qMul,
	qNeg,
	qPow,
	qSub,
	searchUnitCatalog,
	siUnitString
} from './units';

const FORCE = dim({ M: 1, L: 1, T: -2 });
const MOMENT = dim({ M: 1, L: 2, T: -2 });
const PRESSURE = dim({ M: 1, L: -1, T: -2 });

function q(text: string): TypedValue {
	const v = parseQuantity(text);
	expect(v.kind, `parseQuantity(${text})`).not.toBe('error');
	return v;
}

function asQuantity(v: TypedValue): Extract<TypedValue, { kind: 'quantity' }> {
	if (!isQuantity(v)) throw new Error(`expected quantity, got ${v.kind}`);
	return v;
}

describe('parseQuantity (V1-1-2)', () => {
	it('round-trips the R1 imperial engineering vocabulary through SI storage', () => {
		expect(format(q('20 in'))).toBe('20 in');
		expect(format(q('50 ksi'))).toBe('50 ksi');
		expect(format(q('38 in²'))).toBe('38 in²');
		expect(asQuantity(q('20 in')).value).toBeCloseTo(0.508);
		expect(asQuantity(q('50 ksi')).value).toBeCloseTo(344_737_864.6584);
		expect(asQuantity(q('38 in²')).value).toBeCloseTo(0.02451608);
	});

	it.each([
		['5 kN', 5000, FORCE, 'kN'],
		['3.2 m', 3.2, dim({ L: 1 }), 'm'],
		['-2.5 mm', -0.0025, dim({ L: 1 }), 'mm'],
		['1e3 N', 1000, FORCE, 'N'],
		['.5 s', 0.5, dim({ T: 1 }), 's'],
		['2 min', 120, dim({ T: 1 }), 'min'],
		['1 h', 3600, dim({ T: 1 }), 'h'],
		['20 °C', 293.15, dim({ Θ: 1 }), '°C'],
		['5 MPa', 5e6, PRESSURE, 'MPa'],
		['1 kN·m', 1000, MOMENT, 'kN·m'],
		['1 kN*m', 1000, MOMENT, 'kN·m'],
		['9.81 m/s^2', 9.81, dim({ L: 1, T: -2 }), 'm/s^2'],
		['9.81 m/s²', 9.81, dim({ L: 1, T: -2 }), 'm/s²'],
		['2 m2', 2, dim({ L: 2 }), 'm2'],
		['4 m²', 4, dim({ L: 2 }), 'm²'],
		['1 kN/m^2', 1000, PRESSURE, 'kN/m^2'],
		['1.5 t', 1500, dim({ M: 1 }), 't'],
		['3 kg', 3, dim({ M: 1 }), 'kg'],
		['250 g', 0.25, dim({ M: 1 }), 'g'],
		['2 km', 2000, dim({ L: 1 }), 'km'],
		['30 GPa', 3e10, PRESSURE, 'GPa'],
		['50 Hz', 50, dim({ T: -1 }), 'Hz'],
		['2 kJ', 2000, MOMENT, 'kJ'],
		['1.2 kW', 1200, dim({ M: 1, L: 2, T: -3 }), 'kW']
	])('parses %s', (text, value, d, display) => {
		const v = asQuantity(q(text));
		expect(v.value).toBeCloseTo(value, 10);
		expect(dimEq(v.unit, d)).toBe(true);
		expect(v.unit.display).toBe(display);
	});

	it('parses a bare number as scalar (explicitly dimensionless)', () => {
		expect(q('5')).toEqual(scalar(5));
		expect(q('-1.25')).toEqual(scalar(-1.25));
	});

	it('parses angles as dimensionless quantities', () => {
		const v = asQuantity(q('90 deg'));
		expect(isDimensionless(v.unit)).toBe(true);
		expect(v.value).toBeCloseTo(Math.PI / 2, 12);
	});

	it('rejects garbage', () => {
		expect(parseQuantity('abc')).toMatchObject({ kind: 'error', code: '#VALUE!' });
		expect(parseQuantity('5 xyz')).toMatchObject({ kind: 'error', code: '#UNIT!' });
		expect(parseQuantity('5 kN·xyz')).toMatchObject({ kind: 'error', code: '#UNIT!' });
	});
});

describe('parseUnit (V1-1-2)', () => {
	it('knows its symbols', () => {
		expect(isUnitSymbol('kN')).toBe(true);
		expect(isUnitSymbol('KN')).toBe(false);
		expect(isUnitSymbol('beam')).toBe(false);
	});

	it.each([
		['kN', 1e3, FORCE],
		['kN·m', 1e3, MOMENT],
		['kN/m', 1e3, dim({ M: 1, T: -2 })],
		['m/s', 1, dim({ L: 1, T: -1 })],
		['m^3', 1, dim({ L: 3 })],
		['s^-1', 1, dim({ T: -1 })],
		['m⁻¹', 1, dim({ L: -1 })],
		['MPa·m', 1e6, dim({ M: 1, T: -2 })]
	])('parses %s', (text, factor, d) => {
		const parsed = parseUnit(text);
		expect(parsed).not.toBeNull();
		expect(parsed!.factor).toBeCloseTo(factor, 10);
		expect(dimEq(parsed!.dim, d)).toBe(true);
	});

	it('applies °C offset only when the unit stands alone', () => {
		expect(parseUnit('°C')!.offset).toBe(273.15);
		expect(parseUnit('degC')!.offset).toBe(273.15);
		expect(parseUnit('°C·s')!.offset).toBe(0);
		expect(parseUnit('°C^2')!.offset).toBe(0);
	});

	it('returns null for invalid expressions', () => {
		expect(parseUnit('')).toBeNull();
		expect(parseUnit('xyz')).toBeNull();
		expect(parseUnit('kN·')).toBeNull();
		expect(parseUnit('5m')).toBeNull();
	});
});

describe('publication unit catalogue', () => {
	it('finds the canonical symbol with forgiving case-insensitive search', () => {
		expect(searchUnitCatalog('kn')[0]).toEqual({
			symbol: 'kN',
			name: 'Kilonewton',
			category: 'Force',
			keywords: ['load']
		});
	});

	it('accepts catalogue symbols exactly and covers common engineering dimensions', () => {
		expect(isCanonicalUnit('kN')).toBe(true);
		expect(isCanonicalUnit('kn')).toBe(false);
		expect(isCanonicalUnit('degC')).toBe(false);
		expect(isCanonicalUnit('°C')).toBe(true);
		expect(searchUnitCatalog('area').map((unit) => unit.symbol)).toContain('m²');
		expect(searchUnitCatalog('line load').map((unit) => unit.symbol)).toContain('kN/m');
		expect(searchUnitCatalog('stress').map((unit) => unit.symbol)).toContain('MPa');
	});
});

describe('quantity arithmetic (V1-1-2)', () => {
	it('composes kN·m from a product', () => {
		const v = asQuantity(qMul(q('5 kN'), q('2 m')));
		expect(v.value).toBe(10000);
		expect(dimEq(v.unit, MOMENT)).toBe(true);
		expect(format(v)).toBe('10 kN·m');
	});

	it('kN + m → #UNIT!', () => {
		const v = qAdd(q('1 kN'), q('1 m'));
		expect(v).toMatchObject({ kind: 'error', code: '#UNIT!' });
	});

	it('adds compatible units through canonical values', () => {
		expect(format(qAdd(q('5 kN'), q('5000 N')))).toBe('10 kN');
		expect(format(qSub(q('1 m'), q('250 mm')))).toBe('0.75 m');
	});

	it('a ratio of like dimensions is a bare scalar', () => {
		expect(qDiv(q('10 kN'), q('5 kN'))).toEqual(scalar(2));
	});

	it('divides into rate units', () => {
		expect(format(qDiv(q('10 m'), q('2 s')))).toBe('5 m/s');
	});

	it('sqrt(m²) → m', () => {
		const v = asQuantity(qPow(quantity(4, dim({ L: 2 })), scalar(0.5)));
		expect(v.value).toBe(2);
		expect(format(v)).toBe('2 m');
	});

	it('squares into m²', () => {
		const v = asQuantity(qPow(q('3 m'), scalar(2)));
		expect(v.value).toBe(9);
		expect(dimEq(v.unit, dim({ L: 2 }))).toBe(true);
	});

	it('rejects a dimensioned exponent', () => {
		expect(qPow(q('2 m'), q('2 s'))).toMatchObject({ kind: 'error', code: '#UNIT!' });
	});

	it('rejects fractional powers of negatives', () => {
		expect(qPow(scalar(-4), scalar(0.5))).toMatchObject({ kind: 'error', code: '#VALUE!' });
	});

	it('rejects division by zero', () => {
		expect(qDiv(q('1 m'), scalar(0))).toMatchObject({ kind: 'error', code: '#VALUE!' });
	});

	it('keeps scalars scalar', () => {
		expect(qMul(scalar(2), scalar(3))).toEqual(scalar(6));
		expect(qAdd(scalar(2), scalar(3))).toEqual(scalar(5));
	});

	it('negates and takes absolute values', () => {
		expect(asQuantity(qNeg(q('5 kN'))).value).toBe(-5000);
		expect(asQuantity(qAbs(qNeg(q('5 kN')))).value).toBe(5000);
		expect(qNeg(scalar(2))).toEqual(scalar(-2));
	});

	it('rejects non-numeric operands with #VALUE!', () => {
		expect(qAdd(stringValue('x'), scalar(1))).toMatchObject({ kind: 'error', code: '#VALUE!' });
		expect(qMul(scalar(1), booleanValue(true))).toMatchObject({
			kind: 'error',
			code: '#VALUE!'
		});
	});
});

describe('comparisons (V1-1-2)', () => {
	it('compares across display units through canonical values', () => {
		expect(qCompare('>', q('5 kN'), q('4000 N'))).toEqual(booleanValue(true));
		expect(qCompare('=', q('5 kN'), q('5000 N'))).toEqual(booleanValue(true));
		expect(qCompare('<=', q('1 mm'), q('1 m'))).toEqual(booleanValue(true));
		expect(qCompare('<>', scalar(1), scalar(2))).toEqual(booleanValue(true));
	});

	it('rejects dimension mismatches', () => {
		expect(qCompare('<', q('1 kN'), q('1 m'))).toMatchObject({
			kind: 'error',
			code: '#UNIT!'
		});
	});

	it('handles strings and booleans for equality', () => {
		expect(qCompare('=', stringValue('a'), stringValue('a'))).toEqual(booleanValue(true));
		expect(qCompare('<>', booleanValue(true), booleanValue(false))).toEqual(booleanValue(true));
	});

	it('rejects mixed kinds', () => {
		expect(qCompare('=', scalar(1), stringValue('1'))).toMatchObject({
			kind: 'error',
			code: '#VALUE!'
		});
	});

	it('propagates error operands', () => {
		const boom = errorValue('#REF!', 'gone', 'n1');
		expect(qCompare('=', boom, scalar(1))).toBe(boom);
	});
});

describe('convert & format (V1-1-2)', () => {
	it('round-trips 5 kN ↔ 5000 N without touching the stored value', () => {
		const kn = asQuantity(q('5 kN'));
		const n = asQuantity(convert(kn, 'N'));
		expect(n.value).toBe(kn.value);
		expect(format(n)).toBe('5000 N');
		const back = asQuantity(convert(n, 'kN'));
		expect(back.value).toBe(kn.value);
		expect(format(back)).toBe('5 kN');
	});

	it('round-trips m ↔ mm', () => {
		expect(format(convert(q('1.5 m'), 'mm'))).toBe('1500 mm');
		expect(format(convert(q('1500 mm'), 'm'))).toBe('1.5 m');
	});

	it('switches compound displays kN·m ↔ N·m', () => {
		const knm = asQuantity(q('2 kN·m'));
		const nm = asQuantity(convert(knm, 'N·m'));
		expect(nm.value).toBe(knm.value);
		expect(format(nm)).toBe('2000 N·m');
		expect(format(convert(nm, 'kN·m'))).toBe('2 kN·m');
	});

	it('converts temperatures with offsets', () => {
		expect(format(q('20 °C'))).toBe('20 °C');
		expect(format(convert(q('20 °C'), 'K'))).toBe('293.15 K');
		expect(format(convert(q('293.15 K'), '°C'))).toBe('20 °C');
	});

	it('rejects dimension mismatches and unknown units', () => {
		expect(convert(q('5 kN'), 'm')).toMatchObject({ kind: 'error', code: '#UNIT!' });
		expect(convert(q('5 kN'), 'zorks')).toMatchObject({ kind: 'error', code: '#UNIT!' });
		expect(format(q('5 kN'), { unit: 'm' })).toBe('#UNIT!');
	});

	it('formats with fixed digits', () => {
		expect(format(q('5 kN'), { digits: 2 })).toBe('5.00 kN');
		expect(format(q('1 m'), { unit: 'mm', digits: 0 })).toBe('1000 mm');
		expect(format(scalar(2.5), { digits: 1 })).toBe('2.5');
	});

	it('formats scalars, errors, strings, booleans', () => {
		expect(format(scalar(42))).toBe('42');
		expect(format(errorValue('#CYCLE!', 'loop'))).toBe('#CYCLE!');
		expect(format(stringValue('hi'))).toBe('hi');
		expect(format(booleanValue(true))).toBe('TRUE');
	});

	it('falls back to SI labels when no display unit is set', () => {
		expect(format(quantity(3, dim({ L: 1, T: -1 })))).toBe('3 m/s');
		expect(format(quantity(2, dim({ L: 2 })))).toBe('2 m²');
		expect(format(quantity(1000, PRESSURE))).toBe('1000 kg·m⁻¹·s⁻²');
	});

	it('errors passed to convert pass through', () => {
		const boom = errorValue('#REF!', 'gone', 'n1');
		expect(convert(boom, 'kN')).toBe(boom);
	});
});

describe('siUnitString (V1-1-2)', () => {
	it.each([
		[dim({ L: 1 }), 'm'],
		[dim({ L: 2 }), 'm²'],
		[dim({ L: 1, T: -2 }), 'm/s²'],
		[FORCE, 'kg·m/s²'],
		[PRESSURE, 'kg·m⁻¹·s⁻²'],
		[DIMENSIONLESS, '']
	])('labels %o as %s', (d, label) => {
		expect(siUnitString(d)).toBe(label);
	});
});

// ---------------------------------------------------------------------------
// Property test: dimension algebra obeys the algebra it models
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe('dimension algebra properties (V1-1-2)', () => {
	const rand = mulberry32(0x0c70);
	const randomDim = () =>
		dim({
			L: Math.floor(rand() * 7) - 3,
			M: Math.floor(rand() * 7) - 3,
			T: Math.floor(rand() * 7) - 3,
			I: Math.floor(rand() * 7) - 3,
			Θ: Math.floor(rand() * 7) - 3,
			N: Math.floor(rand() * 7) - 3,
			J: Math.floor(rand() * 7) - 3
		});

	it('multiplication is commutative and associative; division inverts; powers distribute', () => {
		for (let i = 0; i < 200; i++) {
			const a = randomDim();
			const b = randomDim();
			const c = randomDim();
			expect(dimEq(dimMul(a, b), dimMul(b, a))).toBe(true);
			expect(dimEq(dimMul(dimMul(a, b), c), dimMul(a, dimMul(b, c)))).toBe(true);
			expect(isDimensionless(dimDiv(a, a))).toBe(true);
			expect(dimEq(dimMul(a, DIMENSIONLESS), a)).toBe(true);
			expect(dimEq(dimDiv(a, b), dimMul(a, dimPow(b, -1)))).toBe(true);
			expect(dimEq(dimPow(dimMul(a, b), 2), dimMul(dimPow(a, 2), dimPow(b, 2)))).toBe(true);
			expect(dimEq(dimPow(a, 2), dimMul(a, a))).toBe(true);
		}
	});

	it('scalar collapse only happens at dimensionless', () => {
		for (let i = 0; i < 50; i++) {
			const a = randomDim();
			const qa = quantity(2, a);
			const inv = qDiv(scalar(1), qa);
			const product = qMul(qa, inv);
			expect(isScalar(product) || isError(product)).toBe(true);
		}
	});
});
