import type { EquationPayload } from './block';
import type { FormulaAST } from './formula';
import { isNameRef, isRangeRef } from './formula';
import type { DocumentGraph } from './graph';
import { resolvePublishedTarget } from './graph';
import type { DerivationExpression } from './showsteps';
import { buildDerivation } from './showsteps';
import { format } from './units';
import type { TypedValue } from './types';

const PRECEDENCE: Record<string, number> = {
	'=': 0,
	'<': 0,
	'<=': 0,
	'>': 0,
	'>=': 0,
	'<>': 0,
	'+': 1,
	'-': 1,
	'*': 2,
	'/': 2,
	'^': 3
};

/** Escape untrusted text before placing it in a TeX text command. */
export function escapeTexText(text: string): string {
	return text.replace(/[\\{}#$%&_~^]/g, (character) => {
		const replacements: Record<string, string> = {
			'\\': '\\textbackslash{}',
			'{': '\\{',
			'}': '\\}',
			'#': '\\#',
			'$': '\\$',
			'%': '\\%',
			'&': '\\&',
			'_': '\\_',
			'~': '\\textasciitilde{}',
			'^': '\\textasciicircum{}'
		};
		return replacements[character];
	});
}

/** Print a formula AST as safe TeX while preserving operator precedence. */
export function formulaToTex(ast: FormulaAST): string {
	const print = (node: FormulaAST, parent = -1): string => {
		switch (node.t) {
			case 'lit':
				if (typeof node.value === 'string') {
					return `\\text{${escapeTexText(node.value)}}`;
				}
				if (typeof node.value === 'boolean') return node.value ? '\\mathrm{TRUE}' : '\\mathrm{FALSE}';
				return node.unit
					? `${node.value}\\,\\mathrm{${escapeTexText(node.unit)}}`
					: String(node.value);
			case 'ref': {
				if (isNameRef(node.ref)) return `\\mathrm{${escapeTexText(node.ref.name)}}`;
				if (isRangeRef(node.ref)) {
					return `\\mathrm{${escapeTexText(node.ref.a1)}}`;
				}
				return `\\mathrm{${escapeTexText(node.ref.a1)}}`;
			}
			case 'un':
				return `${node.op === 'not' ? '\\lnot ' : '-'}${print(node.arg, 4)}`;
			case 'call':
				return `\\operatorname{${escapeTexText(node.fn)}}\\!\\left(${node.args
					.map((arg) => print(arg))
					.join(', ')}\\right)`;
			case 'bin': {
				const precedence = PRECEDENCE[node.op] ?? 0;
				let body: string;
				if (node.op === '/') {
					body = `\\frac{${print(node.left)}}{${print(node.right)}}`;
				} else if (node.op === '^') {
					body = `{${print(node.left, precedence)}}^{${print(node.right)}}`;
				} else {
					const operator =
						node.op === '*'
							? '\\cdot'
							: node.op === '<='
								? '\\le'
								: node.op === '>='
									? '\\ge'
									: node.op === '<>'
										? '\\ne'
										: node.op;
					body = `${print(node.left, precedence)} ${operator} ${print(
						node.right,
						precedence + (node.op === '-' ? 1 : 0)
					)}`;
				}
				return precedence < parent ? `\\left(${body}\\right)` : body;
			}
		}
	};
	return print(ast);
}

/** Print a settled typed value without allowing it to become TeX source. */
export function valueToTex(value: TypedValue): string {
	switch (value.kind) {
		case 'error':
			return `\\text{${escapeTexText(value.code)}}`;
		case 'string':
			return `\\text{${escapeTexText(value.value)}}`;
		case 'boolean':
			return value.value ? '\\mathrm{TRUE}' : '\\mathrm{FALSE}';
		case 'scalar':
		case 'quantity':
			return `\\mathrm{${escapeTexText(format(value))}}`;
		default:
			return `\\text{${escapeTexText(format(value))}}`;
	}
}

/** Print one structured substitution/intermediate tree as TeX. */
export function derivationExpressionToTex(expression: DerivationExpression): string {
	const print = (node: DerivationExpression, parent = -1): string => {
		if (node.t === 'val') return valueToTex(node.value);
		if (node.t === 'un') {
			return `${node.op === 'not' ? '\\lnot ' : '-'}${print(node.arg, 4)}`;
		}
		if (node.t === 'call') {
			return `\\operatorname{${escapeTexText(node.fn)}}\\!\\left(${node.args
				.map((arg) => print(arg))
				.join(', ')}\\right)`;
		}
		const precedence = PRECEDENCE[node.op] ?? 0;
		const body =
			node.op === '/'
				? `\\frac{${print(node.left)}}{${print(node.right)}}`
				: node.op === '^'
					? `{${print(node.left, precedence)}}^{${print(node.right)}}`
					: `${print(node.left, precedence)} ${
							node.op === '*'
								? '\\cdot'
								: node.op === '<='
									? '\\le'
									: node.op === '>='
										? '\\ge'
										: node.op === '<>'
											? '\\ne'
											: node.op
						} ${print(node.right, precedence + (node.op === '-' ? 1 : 0))}`;
		return precedence < parent ? `\\left(${body}\\right)` : body;
	};
	return print(expression);
}

/**
 * Render a static or graph-bound equation payload to safe TeX source.
 * Static source is returned exactly; bound modes follow one alias hop.
 */
export function equationToTex(payload: EquationPayload, graph: DocumentGraph): string {
	if (payload.mode === 'static') return payload.tex;
	const resolved = resolvePublishedTarget(graph, payload.nodeId);
	const published = resolved?.publishedNode ?? graph.nodes.get(payload.nodeId);
	const target = resolved?.targetNode ?? published;
	if (!published || !target) return '\\text{Reference removed}';
	const name = escapeTexText(published.name ?? target.name ?? target.cellRef?.a1 ?? target.id);
	const value = valueToTex(target.value);
	switch (payload.display) {
		case 'result':
			return `\\mathrm{${name}} = ${value}`;
		case 'symbolic':
			return target.formula
				? `\\mathrm{${name}} = ${formulaToTex(target.formula)}`
				: `\\mathrm{${name}} = ${value}`;
		case 'substituted': {
			if (!target.formula) return `\\mathrm{${name}} = ${value}`;
			const substitute = (ast: FormulaAST): FormulaAST => {
				if (ast.t === 'ref') {
					const id = graph.resolveRef(ast.ref);
					const node = id ? graph.nodes.get(id) : undefined;
					if (node?.value.kind === 'scalar') return { t: 'lit', value: node.value.value };
					return ast;
				}
				if (ast.t === 'un') return { ...ast, arg: substitute(ast.arg) };
				if (ast.t === 'bin') {
					return { ...ast, left: substitute(ast.left), right: substitute(ast.right) };
				}
				if (ast.t === 'call') return { ...ast, args: ast.args.map(substitute) };
				return ast;
			};
			return `\\mathrm{${name}} = ${formulaToTex(substitute(target.formula))}`;
		}
		case 'steps': {
			const derivation = buildDerivation(target.id, graph);
			const lines = derivation.steps.map((step) => {
				if (step.formula) return formulaToTex(step.formula);
				if (step.expression) return derivationExpressionToTex(step.expression);
				if (step.value) return valueToTex(step.value);
				return `\\text{${escapeTexText(step.text)}}`;
			});
			return `\\begin{aligned}${lines.join('\\\\')}\\end{aligned}`;
		}
	}
}
