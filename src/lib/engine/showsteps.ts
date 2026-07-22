/**
 * V1-5-4 (engine half) — show-steps derivations (PRD §4, IMPLEMENTATION_PLAN.md
 * V1-5-4). `buildDerivation` turns any node into a structured, serializable
 * derivation: the formula with names as written (via the canonical printer),
 * the same expression with every reference substituted by its current value,
 * intermediate results, and the final settled value. `renderStepsText` is the
 * plain-text projection (accessibility, PRD §10).
 *
 * What "intermediate" means (deliberate, documented): the substituted
 * expression is reduced in passes. Each pass collapses every innermost
 * *ready* sub-expression — a unary/binary/call node whose operands are all
 * already values — into its evaluated value, and the resulting expression is
 * one intermediate step. Passes repeat until the whole expression is a single
 * value; that last collapse is the result step, never an intermediate.
 * Consecutive steps that print identically are merged, so a formula of pure
 * literals contributes no redundant substitution line and a bare-reference
 * formula goes straight from formula to result.
 *
 * Semantics notes:
 * - Total: never throws. A missing node yields a one-step `#REF!` derivation;
 *   error inputs substitute as their code and propagate, so derivations of
 *   failing nodes are well-formed and end in the error code.
 * - Non-computed nodes (inputs) yield a trivial one-step derivation (the
 *   value) — every node can answer "where did this come from" (PRD §4).
 * - The final step always shows the node's SETTLED value (the graph's truth),
 *   not the reducer's re-computation — they agree for pure formulas.
 * - Reduction reuses the registry/operator layer the evaluator uses, so
 *   intermediate values match recalc exactly. Without a registry, call
 *   nodes cannot reduce; the chain stops early and jumps to the final value.
 *   Nested `SHOWSTEPS` calls are not expanded inside a derivation.
 * - Substituted values render via units.ts `format` (errors → code, strings
 *   quoted like the printer, negatives parenthesized so the expression
 *   remains faithfully readable). Units arrive with V2; V1 values are plain
 *   scalars and format accordingly.
 */

import type { ErrCode, NodeId, TypedValue } from './types';
import { booleanValue, errorValue, isError, quantity, scalar, stringValue } from './types';
import { format, normalizeUnitText, parseUnit } from './units';
import type { BinOp, FormulaAST, RefResolver } from './formula';
import { expandRange, isNameRef, isRangeRef, printFormula } from './formula';
import type { GraphNode } from './node';
import type { FunctionRegistry } from './registry';
import { applyBinary, applyUnary } from './registry';

// ---------------------------------------------------------------------------
// The derivation structure (serializable JSON end to end)
// ---------------------------------------------------------------------------

/** What one derivation line shows. */
export type DerivationStepKind = 'formula' | 'substitution' | 'intermediate' | 'result';

/** One line of a derivation: a kind tag plus canonical expression text. */
export interface DerivationStep {
	kind: DerivationStepKind;
	/** Canonical expression text (printer contract) or the formatted value. */
	text: string;
	/** Original formula tree for a symbolic formula line. */
	formula?: FormulaAST;
	/** Structured substituted/reduced tree for substitution and intermediate lines. */
	expression?: DerivationExpression;
	/** Typed result for a result line. */
	value?: TypedValue;
}

/**
 * A complete derivation for one node. Steps run formula → substitution →
 * intermediates → result; the last step is always `result` and always shows
 * the node's settled value. `steps.length ≥ 1` (inputs are result-only).
 */
export interface Derivation {
	/** The node the derivation explains. */
	nodeId: NodeId;
	/** The node's published name, when it has one. */
	name?: string;
	/** Ordered steps; the final entry is always the `result` step. */
	steps: DerivationStep[];
	/** Present when the settled value is an error — the code the chain ends in. */
	error?: ErrCode;
}

/**
 * Read access a derivation needs — structurally satisfied by `DocumentGraph`
 * (graph.ts), declared locally so this module depends only on leaf modules.
 */
export interface DerivationSource {
	/** Maps a formula reference to the node it currently designates, if any. */
	resolveRef: RefResolver;
	/** Node lookup by id. */
	nodes: { get(id: NodeId): GraphNode | undefined };
}

// ---------------------------------------------------------------------------
// Work tree: the substituted expression being reduced pass by pass
// ---------------------------------------------------------------------------

export type DerivationExpression =
	| { t: 'val'; value: TypedValue }
	| { t: 'un'; op: '-' | 'not'; arg: DerivationExpression }
	| { t: 'bin'; op: BinOp; left: DerivationExpression; right: DerivationExpression }
	| { t: 'call'; fn: string; args: DerivationExpression[] };

type Work = DerivationExpression;

/** Seed the work tree: literals and references become values, structure stays. */
function seed(ast: FormulaAST, source: DerivationSource): Work {
	switch (ast.t) {
		case 'lit':
			return { t: 'val', value: literalValue(ast.value, ast.unit) };
		case 'ref':
			return { t: 'val', value: refValue(ast.ref, source) };
		case 'un':
			return { t: 'un', op: ast.op, arg: seed(ast.arg, source) };
		case 'bin':
			return { t: 'bin', op: ast.op, left: seed(ast.left, source), right: seed(ast.right, source) };
		case 'call':
			// Range args substitute one value per constituent cell, mirroring the
			// evaluator's flattening — so SUM(A1:A3) shows SUM(10, 20, 30).
			return {
				t: 'call',
				fn: ast.fn,
				args: ast.args.flatMap((a): Work[] => {
					if (a.t !== 'ref' || !isRangeRef(a.ref)) return [seed(a, source)];
					const cells = expandRange(a.ref);
					if (!Array.isArray(cells)) return [{ t: 'val', value: cells }];
					return cells.map((cell) => ({ t: 'val', value: refValue(cell, source) }));
				})
			};
	}
}

/** A literal to a value — mirrors evaluate.ts so substitutions match recalc. */
function literalValue(value: number | string | boolean, unit: string | undefined): TypedValue {
	if (typeof value === 'string') return stringValue(value);
	if (typeof value === 'boolean') return booleanValue(value);
	if (unit === undefined) return scalar(value);
	const parsed = parseUnit(unit);
	if (!parsed) return errorValue('#UNIT!', `unknown unit "${unit}"`);
	return quantity(value * parsed.factor + parsed.offset, {
		...parsed.dim,
		display: normalizeUnitText(unit)
	});
}

/** A reference's current value — unresolved refs mirror the evaluator's errors. */
function refValue(ref: Parameters<RefResolver>[0], source: DerivationSource): TypedValue {
	if (isRangeRef(ref)) {
		return errorValue('#VALUE!', `range ${ref.a1} is only valid as a function argument`);
	}
	const id = source.resolveRef(ref);
	if (id === undefined) {
		return isNameRef(ref)
			? errorValue('#NAME?', `unknown name "${ref.name}"`)
			: errorValue('#REF!', `unresolved cell ${ref.a1}`);
	}
	const node = source.nodes.get(id);
	if (!node) return errorValue('#REF!', `node ${id} has no value`);
	return node.value;
}

/**
 * One reduction pass: collapse every innermost ready sub-expression (all
 * operands already values) through the same operator/registry layer the
 * evaluator uses. A `call` without a registry cannot reduce (`changed: false`).
 */
function collapseOnce(
	w: Work,
	nodeId: NodeId,
	registry?: FunctionRegistry
): { next: Work; changed: boolean } {
	if (w.t === 'val') return { next: w, changed: false };
	const kids = w.t === 'un' ? [w.arg] : w.t === 'bin' ? [w.left, w.right] : w.args;
	if (kids.every((k) => k.t === 'val')) {
		const vals = kids.map((k) => (k as Extract<Work, { t: 'val' }>).value);
		let value: TypedValue | undefined;
		if (w.t === 'un') value = applyUnary(w.op, vals[0], { nodeId });
		else if (w.t === 'bin') value = applyBinary(w.op, vals[0], vals[1], { nodeId });
		else value = registry?.call(w.fn, vals, { nodeId });
		if (value === undefined) return { next: w, changed: false };
		return { next: { t: 'val', value }, changed: true };
	}
	// Not ready: reduce children this pass; this node collapses a later pass.
	let changed = false;
	const step = (k: Work): Work => {
		const r = collapseOnce(k, nodeId, registry);
		changed ||= r.changed;
		return r.next;
	};
	const next: Work =
		w.t === 'un'
			? { t: 'un', op: w.op, arg: step(w.arg) }
			: w.t === 'bin'
				? { t: 'bin', op: w.op, left: step(w.left), right: step(w.right) }
				: { t: 'call', fn: w.fn, args: w.args.map(step) };
	return { next, changed };
}

// ---------------------------------------------------------------------------
// Printing the work tree (delegates precedence to the canonical printer)
// ---------------------------------------------------------------------------

const SENTINEL = '\u0000';

/**
 * Print a work tree by swapping each value for a sentinel string literal,
 * running the canonical printer (so parenthesization is exactly the printer
 * contract), then splicing the value texts back in.
 */
function printWork(w: Work): string {
	const texts: string[] = [];
	const toAst = (node: Work): FormulaAST => {
		if (node.t === 'val') {
			const i = texts.push(valueText(node.value)) - 1;
			return { t: 'lit', value: `${SENTINEL}${i}${SENTINEL}` };
		}
		if (node.t === 'un') return { t: 'un', op: node.op, arg: toAst(node.arg) };
		if (node.t === 'bin') {
			return { t: 'bin', op: node.op, left: toAst(node.left), right: toAst(node.right) };
		}
		return { t: 'call', fn: node.fn, args: node.args.map(toAst) };
	};
	let out = printFormula(toAst(w));
	texts.forEach((text, i) => {
		out = out.replace(`"${SENTINEL}${i}${SENTINEL}"`, () => text);
	});
	return out;
}

/** A value as substitution text: errors as codes, strings quoted, negatives parenthesized. */
function valueText(v: TypedValue): string {
	switch (v.kind) {
		case 'error':
			return v.code;
		case 'string':
			return `"${v.value.replace(/"/g, '""')}"`;
		case 'scalar':
		case 'quantity': {
			const text = format(v);
			return text.startsWith('-') ? `(${text})` : text;
		}
		default:
			return format(v);
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Defensive bound; each pass shrinks the tree, so real chains end far sooner. */
const MAX_PASSES = 1000;

/**
 * Build the derivation for `id`. Computed nodes (any node holding a formula)
 * yield formula → substitution → intermediates → result; formula-less nodes
 * yield the trivial result-only derivation; an unknown id yields a one-step
 * `#REF!` derivation. Pass the function registry to reduce call expressions
 * stepwise (recommended — evaluate.ts and the UI both have one in scope).
 */
export function buildDerivation(
	id: NodeId,
	source: DerivationSource,
	registry?: FunctionRegistry
): Derivation {
	const node = source.nodes.get(id);
	if (!node) {
		const value = errorValue('#REF!', `unknown node "${id}"`);
		return {
			nodeId: id,
			steps: [{ kind: 'result', text: '#REF!', value }],
			error: '#REF!'
		};
	}
	const steps: DerivationStep[] = [];
	const push = (s: DerivationStep): void => {
		const prev = steps[steps.length - 1];
		if (prev && prev.text === s.text) {
			// Merge identical consecutive lines; the closing result line wins.
			if (s.kind === 'result') steps[steps.length - 1] = s;
			return;
		}
		steps.push(s);
	};
	if (node.formula) {
		push({ kind: 'formula', text: printFormula(node.formula), formula: node.formula });
		let work = seed(node.formula, source);
		push({ kind: 'substitution', text: printWork(work), expression: work });
		for (let pass = 0; pass < MAX_PASSES && work.t !== 'val'; pass++) {
			const r = collapseOnce(work, id, registry);
			if (!r.changed) break; // unreducible (call without a registry)
			work = r.next;
			if (work.t !== 'val') {
				push({ kind: 'intermediate', text: printWork(work), expression: work });
			}
		}
	}
	push({ kind: 'result', text: format(node.value), value: node.value });
	return {
		nodeId: id,
		...(node.name !== undefined ? { name: node.name } : {}),
		steps,
		...(isError(node.value) ? { error: node.value.code } : {})
	};
}

/**
 * The plain-text representation of a derivation (accessibility, PRD §10):
 * `name = <formula>` on the first line (name omitted when the node has none),
 * then one `  = <step>` line per remaining step.
 */
export function renderStepsText(derivation: Derivation): string {
	const [first, ...rest] = derivation.steps;
	const head = derivation.name !== undefined ? `${derivation.name} = ${first.text}` : first.text;
	return [head, ...rest.map((s) => `  = ${s.text}`)].join('\n');
}
