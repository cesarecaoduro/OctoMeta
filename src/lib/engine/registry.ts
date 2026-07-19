/**
 * V1-1-4 — the function registry (SCHEMA.md §6, IMPLEMENTATION_PLAN.md V1-1-4).
 *
 * One seam for built-ins and future user code: `origin: 'user'` functions run
 * through the same signatures, validation, and registration — only `impl`
 * dispatch changes when the V3 sandbox arrives. All v1 functions are pure.
 * Error values propagate: any error argument becomes the result, keeping its
 * `origin` so downstream chips can deep-link to the root cause (SCHEMA.md §11).
 */

import {
	type Dimension,
	type NodeId,
	type TypedValue,
	errorValue,
	isBoolean,
	isError,
	isNumeric,
	isQuantity,
	isScalar,
	quantity,
	scalar
} from './types';
import type { BinOp } from './formula';
import {
	type CompareOp,
	dimEq,
	dimLabel,
	parseUnit,
	qAbs,
	qAdd,
	qCompare,
	qDiv,
	qMul,
	qNeg,
	qPow,
	qSub
} from './units';

/** Evaluation context passed to every `impl`; geometry access arrives in V2. */
export interface FnCtx {
	/** The node being evaluated — stamped as `origin` on fresh errors. */
	nodeId: NodeId;
}

/** SCHEMA.md §6, with `variadic` marking a trailing repeatable parameter. */
export interface FnSignature {
	name: string;
	params: { name: string; type: TypedValue['kind'] | 'any'; dim?: Partial<Dimension> }[];
	returns: TypedValue['kind'];
	pure: true;
	impl: (args: TypedValue[], ctx: FnCtx) => TypedValue;
	origin: 'builtin' | 'user';
	/** When true, the last parameter repeats (≥1 argument in its position). */
	variadic?: boolean;
}

/**
 * Case-insensitive function registry. `call` validates arguments against the
 * declared params (wrong kind → `#VALUE!`, wrong dimension → `#UNIT!`) and
 * propagates error arguments before dispatching to `impl`.
 */
export class FunctionRegistry {
	private fns = new Map<string, FnSignature>();

	/** Register a signature. Duplicate names (case-insensitive) throw. */
	register(sig: FnSignature): void {
		const key = sig.name.toUpperCase();
		if (this.fns.has(key)) {
			throw new Error(`function already registered: ${sig.name}`);
		}
		this.fns.set(key, sig);
	}

	/** Look up a signature by name (case-insensitive). */
	get(name: string): FnSignature | undefined {
		return this.fns.get(name.toUpperCase());
	}

	/** True when a function with this name exists. */
	has(name: string): boolean {
		return this.fns.has(name.toUpperCase());
	}

	/** All registered signatures, for adapter registration (V1-3-1). */
	list(): FnSignature[] {
		return [...this.fns.values()];
	}

	/** Validate arguments and dispatch. Unknown function → `#NAME?`. */
	call(name: string, args: TypedValue[], ctx: FnCtx): TypedValue {
		const sig = this.get(name);
		if (!sig) return errorValue('#NAME?', `unknown function ${name.toUpperCase()}`, ctx.nodeId);
		const firstError = args.find(isError);
		if (firstError) return firstError;
		const min = sig.params.length;
		const arityOk = sig.variadic ? args.length >= min : args.length === min;
		if (!arityOk) {
			return errorValue(
				'#VALUE!',
				`${sig.name} expects ${sig.variadic ? `≥${min}` : min} argument(s), got ${args.length}`,
				ctx.nodeId
			);
		}
		for (let i = 0; i < args.length; i++) {
			const param = sig.params[Math.min(i, sig.params.length - 1)];
			const arg = args[i];
			if (param.type !== 'any' && arg.kind !== param.type) {
				// A scalar satisfies a dimensionless-quantity parameter and vice versa.
				const numericOk = param.type === 'quantity' && isNumeric(arg);
				if (!numericOk) {
					return errorValue(
						'#VALUE!',
						`${sig.name}: ${param.name} expects ${param.type}, got ${arg.kind}`,
						ctx.nodeId
					);
				}
			}
			if (param.dim) {
				const want: Dimension = {
					L: 0, M: 0, T: 0, I: 0, Θ: 0, N: 0, J: 0,
					...param.dim
				};
				const got = isQuantity(arg) ? arg.unit : isScalar(arg) ? { ...want, ...ZERO } : null;
				if (!got || !dimEq(got, want)) {
					return errorValue(
						'#UNIT!',
						`${sig.name}: ${param.name} expects [${dimLabel(want)}]`,
						ctx.nodeId
					);
				}
			}
		}
		try {
			return stampOrigin(sig.impl(args, ctx), ctx.nodeId);
		} catch (e) {
			return errorValue('#VALUE!', `${sig.name}: ${(e as Error).message}`, ctx.nodeId);
		}
	}
}

const ZERO: Dimension = { L: 0, M: 0, T: 0, I: 0, Θ: 0, N: 0, J: 0 };

/** Give a fresh (origin-less) error the evaluating node as its origin. */
function stampOrigin(v: TypedValue, nodeId: NodeId): TypedValue {
	if (isError(v) && v.origin === '') return { ...v, origin: nodeId };
	return v;
}

// ---------------------------------------------------------------------------
// Quantity-lifted operators (consumed by the evaluator, V1-2-2)
// ---------------------------------------------------------------------------

const COMPARE_OPS: readonly CompareOp[] = ['=', '<', '>', '<=', '>=', '<>'];

/**
 * Apply a binary formula operator to typed values, lifted over quantities.
 * Error arguments propagate unchanged; fresh errors carry `ctx.nodeId`.
 */
export function applyBinary(op: BinOp, a: TypedValue, b: TypedValue, ctx: FnCtx): TypedValue {
	if (isError(a)) return a;
	if (isError(b)) return b;
	let result: TypedValue;
	switch (op) {
		case '+':
			result = qAdd(a, b);
			break;
		case '-':
			result = qSub(a, b);
			break;
		case '*':
			result = qMul(a, b);
			break;
		case '/':
			result = qDiv(a, b);
			break;
		case '^':
			result = qPow(a, b);
			break;
		default:
			result = COMPARE_OPS.includes(op)
				? qCompare(op, a, b)
				: errorValue('#VALUE!', `unknown operator ${op}`);
	}
	return stampOrigin(result, ctx.nodeId);
}

/** Apply a unary formula operator (`-` on numerics, `not` on booleans). */
export function applyUnary(op: '-' | 'not', a: TypedValue, ctx: FnCtx): TypedValue {
	if (isError(a)) return a;
	if (op === '-') return stampOrigin(qNeg(a), ctx.nodeId);
	if (!isBoolean(a)) {
		return errorValue('#VALUE!', `NOT expects a boolean, got ${a.kind}`, ctx.nodeId);
	}
	return { kind: 'boolean', value: !a.value };
}

// ---------------------------------------------------------------------------
// Built-ins (SCHEMA.md §6: the V1 set)
// ---------------------------------------------------------------------------

function foldNumeric(
	args: TypedValue[],
	combine: (acc: TypedValue, next: TypedValue) => TypedValue
): TypedValue {
	let acc = args[0];
	for (let i = 1; i < args.length; i++) {
		acc = combine(acc, args[i]);
		if (isError(acc)) return acc;
	}
	return acc;
}

function pickExtreme(op: '<' | '>') {
	return (args: TypedValue[]): TypedValue =>
		foldNumeric(args, (acc, next) => {
			const cmp = qCompare(op, next, acc);
			if (isError(cmp)) return cmp;
			return isBoolean(cmp) && cmp.value ? next : acc;
		});
}

/** Create a registry pre-loaded with the V1 built-ins. */
export function createBuiltinRegistry(): FunctionRegistry {
	const r = new FunctionRegistry();
	const num = { name: 'value', type: 'any' as const };

	r.register({
		name: 'SUM',
		params: [{ ...num, name: 'values' }],
		returns: 'quantity',
		pure: true,
		origin: 'builtin',
		variadic: true,
		impl: (args) => foldNumeric(args, qAdd)
	});
	r.register({
		name: 'MIN',
		params: [{ ...num, name: 'values' }],
		returns: 'quantity',
		pure: true,
		origin: 'builtin',
		variadic: true,
		impl: pickExtreme('<')
	});
	r.register({
		name: 'MAX',
		params: [{ ...num, name: 'values' }],
		returns: 'quantity',
		pure: true,
		origin: 'builtin',
		variadic: true,
		impl: pickExtreme('>')
	});
	r.register({
		name: 'AVERAGE',
		params: [{ ...num, name: 'values' }],
		returns: 'quantity',
		pure: true,
		origin: 'builtin',
		variadic: true,
		impl: (args) => {
			const total = foldNumeric(args, qAdd);
			return qDiv(total, scalar(args.length));
		}
	});
	r.register({
		name: 'COUNT',
		params: [{ ...num, name: 'values' }],
		returns: 'scalar',
		pure: true,
		origin: 'builtin',
		variadic: true,
		impl: (args) => scalar(args.filter(isNumeric).length)
	});
	r.register({
		name: 'IF',
		params: [
			{ name: 'condition', type: 'boolean' },
			{ name: 'then', type: 'any' },
			{ name: 'else', type: 'any' }
		],
		returns: 'quantity',
		pure: true,
		origin: 'builtin',
		impl: (args) => {
			const cond = args[0];
			return isBoolean(cond) && cond.value ? args[1] : args[2];
		}
	});
	r.register({
		name: 'ROUND',
		params: [
			{ name: 'value', type: 'quantity' },
			{ name: 'digits', type: 'scalar' }
		],
		returns: 'quantity',
		pure: true,
		origin: 'builtin',
		impl: (args) => {
			const [v, digits] = args;
			if (!isNumeric(v) || !isScalar(digits)) {
				return errorValue('#VALUE!', 'ROUND expects (number, digits)');
			}
			const f = 10 ** digits.value;
			// Round in the display unit when one is set, so ROUND(5.44 kN, 1) → 5.4 kN.
			if (isQuantity(v)) {
				const d = displayMagnitude(v);
				if (d === null) return errorValue('#UNIT!', `unknown display unit "${v.unit.display}"`);
				const rounded = Math.round(d.magnitude * f) / f;
				return quantity(rounded * d.factor + d.offset, v.unit);
			}
			return scalar(Math.round(v.value * f) / f);
		}
	});
	r.register({
		name: 'ABS',
		params: [{ name: 'value', type: 'quantity' }],
		returns: 'quantity',
		pure: true,
		origin: 'builtin',
		impl: (args) => qAbs(args[0])
	});
	r.register({
		name: 'SQRT',
		params: [{ name: 'value', type: 'quantity' }],
		returns: 'quantity',
		pure: true,
		origin: 'builtin',
		impl: (args) => qPow(args[0], scalar(0.5))
	});
	r.register({
		name: 'POW',
		params: [
			{ name: 'base', type: 'quantity' },
			{ name: 'exponent', type: 'scalar' }
		],
		returns: 'quantity',
		pure: true,
		origin: 'builtin',
		impl: (args) => qPow(args[0], args[1])
	});
	r.register({
		name: 'SHOWSTEPS',
		params: [{ name: 'ref', type: 'any' }],
		returns: 'string',
		pure: true,
		origin: 'builtin',
		// Un-stubbed in V1-5-4: renders the substituted derivation of `ref`.
		impl: () => errorValue('#VALUE!', 'SHOWSTEPS is not available yet')
	});
	return r;
}

/** Magnitude of a quantity in its display unit, plus the map back to canonical. */
function displayMagnitude(
	v: Extract<TypedValue, { kind: 'quantity' }>
): { magnitude: number; factor: number; offset: number } | null {
	if (!v.unit.display) return { magnitude: v.value, factor: 1, offset: 0 };
	const parsed = parseUnit(v.unit.display);
	if (!parsed || !dimEq(parsed.dim, v.unit)) return null;
	return {
		magnitude: (v.value - parsed.offset) / parsed.factor,
		factor: parsed.factor,
		offset: parsed.offset
	};
}
