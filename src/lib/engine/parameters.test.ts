import { describe, expect, it } from 'vitest';
import { parseParameterInput } from './parameters';
import { parseQuantity } from './units';

describe('parseParameterInput', () => {
	it('inherits an existing authored unit for a bare number', () => {
		expect(parseParameterInput('21', parseQuantity('20 in'))).toEqual({
			ok: true,
			value: parseQuantity('21 in')
		});
	});

	it('accepts compatible authored units and rejects unknown or incompatible units', () => {
		expect(parseParameterInput('500 mm', parseQuantity('20 in')).ok).toBe(true);
		expect(parseParameterInput('10 flurbs', parseQuantity('20 in'))).toMatchObject({
			ok: false
		});
		expect(parseParameterInput('10 ksi', parseQuantity('20 in'))).toMatchObject({
			ok: false
		});
	});

	it('keeps scalar parameters unitless', () => {
		expect(parseParameterInput('4.5', parseQuantity('2'))).toEqual({
			ok: true,
			value: parseQuantity('4.5')
		});
		expect(parseParameterInput('4.5 in', parseQuantity('2')).ok).toBe(false);
	});
});
