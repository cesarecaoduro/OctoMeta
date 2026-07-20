import { describe, expect, it } from 'vitest';
import { dim, quantity } from '../engine';
import { fromConvexJson, toConvexJson } from './codec';

describe('convex value codec', () => {
	it('renames the Θ dimension key to THETA and back', () => {
		const value = quantity(293.15, dim({ Θ: 1, display: 'K' }));
		const encoded = toConvexJson(value) as unknown as { unit: Record<string, unknown> };
		expect(encoded.unit['Θ']).toBeUndefined();
		expect(encoded.unit['THETA']).toBe(1);
		expect(fromConvexJson(encoded)).toEqual(value);
	});

	it('round-trips nested structures (arrays, tables, formulas)', () => {
		const value = {
			kind: 'table',
			columns: [{ name: 'q', kind: 'quantity' }],
			rows: [[quantity(5, dim({ L: 1 }))], [quantity(-2, dim({ L: 1 }))]]
		};
		expect(fromConvexJson(toConvexJson(value))).toEqual(value);
	});

	it('drops undefined-valued fields (JSON semantics)', () => {
		const encoded = toConvexJson({ a: 1, b: undefined, c: { d: undefined, e: null } }) as Record<
			string,
			unknown
		>;
		expect(encoded).toEqual({ a: 1, c: { e: null } });
		expect('b' in encoded).toBe(false);
	});

	it('leaves primitives and arrays structurally unchanged', () => {
		expect(toConvexJson(42)).toBe(42);
		expect(toConvexJson('Θ as a VALUE is fine')).toBe('Θ as a VALUE is fine');
		expect(toConvexJson(null)).toBe(null);
		expect(toConvexJson([1, 'two', true])).toEqual([1, 'two', true]);
	});

	it('rejects values that already contain the reserved key', () => {
		expect(() => toConvexJson({ THETA: 1 })).toThrow(/reserved key/);
		expect(() => fromConvexJson({ Θ: 1 })).toThrow(/reserved key/);
	});
});
