/**
 * V1-2-2 groundwork — the pure FormulaAST evaluator (SCHEMA.md §2–§4, §6, §11).
 *
 * `evaluateFormula` turns an AST into a TypedValue given an environment that
 * supplies reference resolution and memoized input values; recalc (V1-2-2)
 * wires that environment from the graph. The evaluator is total: it never
 * throws across the API — every failure is an error value (SCHEMA.md §2).
 * Fresh errors are stamped with the evaluating node as `origin`; propagated
 * error arguments keep their original `origin` so downstream chips can
 * deep-link to the root cause (SCHEMA.md §11).
 *
 * Semantics notes (deliberate, documented choices):
 * - Evaluation is eager everywhere, **including IF**: all call arguments
 *   evaluate left-to-right before dispatch, so an error in the untaken branch
 *   still surfaces. Lazy branches are a possible future refinement, not v1.
 * - Unit literals mirror `parseQuantity` (units.ts): the stored magnitude is
 *   canonical SI (`value × factor + offset`) and the Dimension carries the
 *   normalized display unit. An unknown unit yields `#UNIT!` (defensive — the
 *   parser only emits units that `parseUnit` accepts).
 * - Unresolved-reference wording matches formula.ts `resolveInputs`, so recalc
 *   and edge derivation report identical messages for the same failure.
 */

import {
	type NodeId,
	type TypedValue,
	booleanValue,
	errorValue,
	quantity,
	scalar,
	stringValue
} from './types';
import { normalizeUnitText, parseUnit } from './units';
import { type FormulaAST, type RefResolver, isNameRef } from './formula';
import { type FunctionRegistry, applyBinary, applyUnary } from './registry';

/** Everything evaluation needs from the outside world; recalc (V1-2-2) supplies it. */
export interface EvalEnv {
	/** The node being evaluated — stamped as `origin` on fresh errors. */
	nodeId: NodeId;
	/** Function registry used for `call` nodes (unknown function → `#NAME?`). */
	registry: FunctionRegistry;
	/** Maps a formula ref to the NodeId it designates (formula.ts RefResolver). */
	resolveRef: RefResolver;
	/** Current memoized value of an input node. */
	valueOf: (id: NodeId) => TypedValue | undefined;
}

/**
 * Evaluate a FormulaAST to a TypedValue. Total: never throws; errors are
 * values. Input error values flow through operators and calls unchanged
 * (keeping their original `origin`); fresh errors carry `env.nodeId`.
 */
export function evaluateFormula(ast: FormulaAST, env: EvalEnv): TypedValue {
	switch (ast.t) {
		case 'lit':
			return evaluateLiteral(ast.value, ast.unit, env);
		case 'ref': {
			const id = env.resolveRef(ast.ref);
			if (id === undefined) {
				return isNameRef(ast.ref)
					? errorValue('#NAME?', `unknown name "${ast.ref.name}"`, env.nodeId)
					: errorValue('#REF!', `unresolved cell ${ast.ref.a1}`, env.nodeId);
			}
			const value = env.valueOf(id);
			if (value === undefined) {
				return errorValue('#REF!', `node ${id} has no value`, env.nodeId);
			}
			// As-is, including error values — they flow through (SCHEMA.md §2).
			return value;
		}
		case 'un':
			return applyUnary(ast.op, evaluateFormula(ast.arg, env), { nodeId: env.nodeId });
		case 'bin': {
			const left = evaluateFormula(ast.left, env);
			const right = evaluateFormula(ast.right, env);
			return applyBinary(ast.op, left, right, { nodeId: env.nodeId });
		}
		case 'call': {
			// Eager, left-to-right — IF branches included (see header note).
			const args = ast.args.map((arg) => evaluateFormula(arg, env));
			return env.registry.call(ast.fn, args, { nodeId: env.nodeId });
		}
		default:
			// Defensive: a well-typed AST cannot reach here, but the evaluator
			// must stay total even on malformed runtime input.
			return errorValue('#VALUE!', 'malformed formula AST', env.nodeId);
	}
}

/**
 * A literal to a value. Numbers without a unit are dimensionless scalars; with
 * a unit they become canonical-SI quantities exactly as `parseQuantity` would
 * produce (units.ts). Strings and booleans map directly.
 */
function evaluateLiteral(
	value: number | string | boolean,
	unit: string | undefined,
	env: EvalEnv
): TypedValue {
	if (typeof value === 'string') return stringValue(value);
	if (typeof value === 'boolean') return booleanValue(value);
	if (unit === undefined) return scalar(value);
	const parsed = parseUnit(unit);
	if (!parsed) return errorValue('#UNIT!', `unknown unit "${unit}"`, env.nodeId);
	return quantity(value * parsed.factor + parsed.offset, {
		...parsed.dim,
		display: normalizeUnitText(unit)
	});
}
