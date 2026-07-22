import type { TypedValue } from './types';
import { dimEq, dimLabel, parseQuantity } from './units';

/** Result of validating authored text for an existing numeric input node. */
export type ParameterParseResult =
	| { ok: true; value: Extract<TypedValue, { kind: 'scalar' | 'quantity' }> }
	| { ok: false; message: string };

/**
 * Parse an editable parameter without losing its authored unit contract.
 * A bare number inherits the current quantity display unit; unknown or
 * dimensionally incompatible input is rejected without a graph mutation.
 */
export function parseParameterInput(
	text: string,
	current: TypedValue
): ParameterParseResult {
	if (current.kind !== 'scalar' && current.kind !== 'quantity') {
		return { ok: false, message: 'Only numeric inputs are editable here.' };
	}
	const trimmed = text.trim();
	if (trimmed === '') return { ok: false, message: 'Enter a value.' };
	const hasUnit = /[A-Za-z°]/.test(trimmed);
	const inherited =
		!hasUnit && current.kind === 'quantity'
			? `${trimmed} ${current.unit.display ?? dimLabel(current.unit)}`
			: trimmed;
	const parsed = parseQuantity(inherited);
	if (parsed.kind === 'error') return { ok: false, message: parsed.message };
	if (parsed.kind !== 'scalar' && parsed.kind !== 'quantity') {
		return { ok: false, message: 'Enter a number or quantity.' };
	}
	if (current.kind === 'scalar' && parsed.kind !== 'scalar') {
		return { ok: false, message: 'This parameter is unitless.' };
	}
	if (
		current.kind === 'quantity' &&
		(parsed.kind !== 'quantity' || !dimEq(current.unit, parsed.unit))
	) {
		return {
			ok: false,
			message: `Expected a value compatible with ${dimLabel(current.unit)}.`
		};
	}
	return { ok: true, value: parsed };
}
