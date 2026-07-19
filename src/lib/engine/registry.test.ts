import { describe, expect, it } from 'vitest';
import {
	type FnCtx,
	FunctionRegistry,
	applyBinary,
	applyUnary,
	createBuiltinRegistry
} from './registry';
import {
	type TypedValue,
	booleanValue,
	errorValue,
	isQuantity,
	quantity,
	scalar,
	stringValue
} from './types';
import { dim, dimEq, format, parseQuantity } from './units';

const ctx: FnCtx = { nodeId: 'node-under-eval' };

function q(text: string): TypedValue {
	const v = parseQuantity(text);
	if (v.kind === 'error') throw new Error(`bad fixture: ${text}`);
	return v;
}

describe('FunctionRegistry (V1-1-4)', () => {
	it('registers the full V1 built-in set', () => {
		const r = createBuiltinRegistry();
		for (const name of [
			'SUM',
			'MIN',
			'MAX',
			'AVERAGE',
			'COUNT',
			'IF',
			'ROUND',
			'ABS',
			'SQRT',
			'POW',
			'SHOWSTEPS'
		]) {
			expect(r.has(name), name).toBe(true);
			expect(r.get(name)?.origin).toBe('builtin');
			expect(r.get(name)?.pure).toBe(true);
		}
		expect(r.list()).toHaveLength(11);
	});

	it('rejects duplicate registration, case-insensitively', () => {
		const r = createBuiltinRegistry();
		expect(() =>
			r.register({
				name: 'sum',
				params: [],
				returns: 'scalar',
				pure: true,
				origin: 'user',
				impl: () => scalar(0)
			})
		).toThrow(/already registered/);
	});

	it('accepts user-origin functions through the same seam (V3 hook)', () => {
		const r = new FunctionRegistry();
		r.register({
			name: 'DOUBLE',
			params: [{ name: 'x', type: 'scalar' }],
			returns: 'scalar',
			pure: true,
			origin: 'user',
			impl: ([x]) => scalar((x as { value: number }).value * 2)
		});
		expect(r.get('double')?.origin).toBe('user');
		expect(r.call('DOUBLE', [scalar(21)], ctx)).toEqual(scalar(42));
	});

	it('unknown function → #NAME? with origin', () => {
		const r = createBuiltinRegistry();
		expect(r.call('NOPE', [], ctx)).toMatchObject({
			kind: 'error',
			code: '#NAME?',
			origin: ctx.nodeId
		});
	});

	it('propagates error arguments unchanged (origin preserved)', () => {
		const r = createBuiltinRegistry();
		const upstream = errorValue('#REF!', 'deleted node', 'origin-node');
		expect(r.call('SUM', [scalar(1), upstream, scalar(2)], ctx)).toBe(upstream);
	});

	it('wrong arity → #VALUE!', () => {
		const r = createBuiltinRegistry();
		expect(r.call('IF', [booleanValue(true), scalar(1)], ctx)).toMatchObject({
			kind: 'error',
			code: '#VALUE!'
		});
		expect(r.call('SUM', [], ctx)).toMatchObject({ kind: 'error', code: '#VALUE!' });
	});

	it('validates declared param dims → #UNIT!', () => {
		const r = new FunctionRegistry();
		r.register({
			name: 'SPAN_CHECK',
			params: [{ name: 'span', type: 'quantity', dim: { L: 1 } }],
			returns: 'boolean',
			pure: true,
			origin: 'builtin',
			impl: () => booleanValue(true)
		});
		expect(r.call('SPAN_CHECK', [q('5 m')], ctx)).toEqual(booleanValue(true));
		expect(r.call('SPAN_CHECK', [q('5 kN')], ctx)).toMatchObject({
			kind: 'error',
			code: '#UNIT!',
			origin: ctx.nodeId
		});
	});

	it('an impl that throws becomes #VALUE!, never an exception', () => {
		const r = new FunctionRegistry();
		r.register({
			name: 'BOOM',
			params: [],
			returns: 'scalar',
			pure: true,
			origin: 'builtin',
			impl: () => {
				throw new Error('kaput');
			}
		});
		expect(r.call('BOOM', [], ctx)).toMatchObject({
			kind: 'error',
			code: '#VALUE!',
			origin: ctx.nodeId
		});
	});
});

describe('built-ins (V1-1-4)', () => {
	const r = createBuiltinRegistry();

	it('SUM over quantities keeps the dimension', () => {
		expect(format(r.call('SUM', [q('5 kN'), q('5000 N'), q('2 kN')], ctx))).toBe('12 kN');
		expect(r.call('SUM', [scalar(1), scalar(2), scalar(3)], ctx)).toEqual(scalar(6));
	});

	it('SUM across dimensions → #UNIT!', () => {
		expect(r.call('SUM', [q('1 kN'), q('1 m')], ctx)).toMatchObject({
			kind: 'error',
			code: '#UNIT!',
			origin: ctx.nodeId
		});
	});

	it('MIN/MAX compare through canonical values and return the original', () => {
		expect(r.call('MIN', [q('5 kN'), q('4000 N')], ctx)).toEqual(q('4000 N'));
		expect(r.call('MAX', [q('5 kN'), q('4000 N')], ctx)).toEqual(q('5 kN'));
		expect(r.call('MAX', [scalar(3), scalar(7), scalar(5)], ctx)).toEqual(scalar(7));
	});

	it('AVERAGE divides by the count', () => {
		expect(format(r.call('AVERAGE', [q('1 m'), q('3 m')], ctx))).toBe('2 m');
	});

	it('COUNT counts numeric arguments', () => {
		expect(r.call('COUNT', [scalar(1), stringValue('x'), q('2 m')], ctx)).toEqual(scalar(2));
	});

	it('IF selects by boolean condition, any value kinds', () => {
		expect(r.call('IF', [booleanValue(true), q('1 kN'), q('2 kN')], ctx)).toEqual(q('1 kN'));
		expect(r.call('IF', [booleanValue(false), q('1 kN'), stringValue('no')], ctx)).toEqual(
			stringValue('no')
		);
	});

	it('IF with a non-boolean condition → #VALUE!', () => {
		expect(r.call('IF', [scalar(1), scalar(2), scalar(3)], ctx)).toMatchObject({
			kind: 'error',
			code: '#VALUE!'
		});
	});

	it('ROUND works in the display unit', () => {
		expect(format(r.call('ROUND', [q('5.44 kN'), scalar(1)], ctx))).toBe('5.4 kN');
		expect(r.call('ROUND', [scalar(2.567), scalar(2)], ctx)).toEqual(scalar(2.57));
	});

	it('ABS on scalars and quantities', () => {
		expect(r.call('ABS', [scalar(-3)], ctx)).toEqual(scalar(3));
		expect(format(r.call('ABS', [q('-5 kN')], ctx))).toBe('5 kN');
	});

	it('SQRT halves dimensions: sqrt(m²) → m', () => {
		const v = r.call('SQRT', [quantity(4, dim({ L: 2 }))], ctx);
		expect(isQuantity(v) && v.value === 2).toBe(true);
		if (isQuantity(v)) expect(dimEq(v.unit, dim({ L: 1 }))).toBe(true);
		expect(r.call('SQRT', [scalar(9)], ctx)).toEqual(scalar(3));
	});

	it('SQRT of a string → #VALUE!', () => {
		expect(r.call('SQRT', [stringValue('x')], ctx)).toMatchObject({
			kind: 'error',
			code: '#VALUE!'
		});
	});

	it('POW raises quantities to scalar powers', () => {
		const v = r.call('POW', [q('3 m'), scalar(2)], ctx);
		expect(isQuantity(v) && v.value === 9).toBe(true);
		if (isQuantity(v)) expect(dimEq(v.unit, dim({ L: 2 }))).toBe(true);
		expect(r.call('POW', [q('3 m'), q('2 s')], ctx)).toMatchObject({
			kind: 'error',
			code: '#VALUE!'
		});
	});

	it('SHOWSTEPS stays stubbed until V1-5-4', () => {
		expect(r.call('SHOWSTEPS', [scalar(1)], ctx)).toMatchObject({
			kind: 'error',
			code: '#VALUE!',
			origin: ctx.nodeId
		});
	});
});

describe('quantity-lifted operators (V1-1-4)', () => {
	it('applies arithmetic through the units layer', () => {
		expect(format(applyBinary('*', q('5 kN'), scalar(2), ctx))).toBe('10 kN');
		expect(format(applyBinary('+', q('5 kN'), q('5000 N'), ctx))).toBe('10 kN');
		expect(applyBinary('/', q('10 kN'), q('5 kN'), ctx)).toEqual(scalar(2));
		expect(applyBinary('^', scalar(2), scalar(10), ctx)).toEqual(scalar(1024));
	});

	it('kN + m → #UNIT! stamped with the evaluating node', () => {
		expect(applyBinary('+', q('1 kN'), q('1 m'), ctx)).toMatchObject({
			kind: 'error',
			code: '#UNIT!',
			origin: ctx.nodeId
		});
	});

	it('comparisons return booleans', () => {
		expect(applyBinary('>', q('5 kN'), q('4000 N'), ctx)).toEqual(booleanValue(true));
		expect(applyBinary('<>', scalar(1), scalar(1), ctx)).toEqual(booleanValue(false));
	});

	it('propagates upstream errors without restamping', () => {
		const upstream = errorValue('#CYCLE!', 'loop', 'origin-node');
		expect(applyBinary('+', upstream, scalar(1), ctx)).toBe(upstream);
		expect(applyUnary('-', upstream, ctx)).toBe(upstream);
	});

	it('unary minus and NOT', () => {
		expect(applyUnary('-', scalar(5), ctx)).toEqual(scalar(-5));
		expect(format(applyUnary('-', q('5 kN'), ctx))).toBe('-5 kN');
		expect(applyUnary('not', booleanValue(true), ctx)).toEqual(booleanValue(false));
		expect(applyUnary('not', scalar(1), ctx)).toMatchObject({
			kind: 'error',
			code: '#VALUE!',
			origin: ctx.nodeId
		});
	});
});
