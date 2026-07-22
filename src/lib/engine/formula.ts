/**
 * V1-1-3 — FormulaAST, parser, canonical printer, and reference resolution
 * (SCHEMA.md §3, IMPLEMENTATION_PLAN.md V1-1-3).
 *
 * The v1 grammar: numbers with unit literals (`5 kN`, `3.2 m`), arithmetic and
 * comparison operators, function calls, cell refs (`A1`, `A1:B2`), and dotted
 * published names (`beam.span`). Edges are derived: `resolveInputs` turns a
 * formula's references into the node's `inputs` array. Univer syntax quirks
 * are mapped in the adapter (V1-3-1), never here.
 *
 * Grammar notes (deliberate, documented choices):
 * - Juxtaposition after a number always means a unit literal: `5 m2` is 5 m²,
 *   never 5×cell M2 (write `5 * M2` for that).
 * - `^` immediately after a unit extends the unit (`5 m^2` is 5 m²); write
 *   `(5 m)^2` to square a quantity.
 * - In a unit denominator, idents that look like cell refs stay cell refs:
 *   `5 kN/m2` divides by cell M2 — write `5 kN/m^2` or `5 kN/m²`.
 */

import type { BlockId, CellRef, ErrorValue, NodeId } from './types';
import { errorValue } from './types';
import { normalizeUnitText, parseUnit } from './units';

// ---------------------------------------------------------------------------
// AST (SCHEMA.md §3, verbatim)
// ---------------------------------------------------------------------------

export type BinOp = '+' | '-' | '*' | '/' | '^' | '=' | '<' | '>' | '<=' | '>=' | '<>';

export type FormulaAST =
	| { t: 'lit'; value: number | string | boolean; unit?: string }
	| { t: 'ref'; ref: CellRef | { name: string } }
	| { t: 'un'; op: '-' | 'not'; arg: FormulaAST }
	| { t: 'bin'; op: BinOp; left: FormulaAST; right: FormulaAST }
	| { t: 'call'; fn: string; args: FormulaAST[] };

/** Narrow a ref payload to the published-name variant. */
export function isNameRef(ref: CellRef | { name: string }): ref is { name: string } {
	return 'name' in ref;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Token =
	| { type: 'num'; value: number; pos: number }
	| { type: 'str'; value: string; pos: number }
	| { type: 'ident'; text: string; pos: number }
	| { type: 'punct'; text: string; pos: number }
	| { type: 'eof'; pos: number };

const IDENT_START = /[A-Za-z_°]/;
const IDENT_CHAR = /[A-Za-z0-9_°⁰¹²³⁴⁵⁶⁷⁸⁹⁻]/;
const NUM_RE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

function tokenize(src: string): Token[] | { error: string; pos: number } {
	const tokens: Token[] = [];
	let i = 0;
	while (i < src.length) {
		const ch = src[i];
		if (/\s/.test(ch)) {
			i++;
			continue;
		}
		if (/[\d.]/.test(ch) && NUM_RE.test(src.slice(i))) {
			const m = NUM_RE.exec(src.slice(i));
			if (m) {
				tokens.push({ type: 'num', value: Number(m[0]), pos: i });
				i += m[0].length;
				continue;
			}
		}
		if (ch === '"') {
			let j = i + 1;
			let out = '';
			while (j < src.length) {
				if (src[j] === '"') {
					if (src[j + 1] === '"') {
						out += '"';
						j += 2;
						continue;
					}
					break;
				}
				out += src[j];
				j++;
			}
			if (j >= src.length) return { error: 'unterminated string', pos: i };
			tokens.push({ type: 'str', value: out, pos: i });
			i = j + 1;
			continue;
		}
		if (IDENT_START.test(ch)) {
			let j = i + 1;
			while (j < src.length && IDENT_CHAR.test(src[j])) j++;
			tokens.push({ type: 'ident', text: src.slice(i, j), pos: i });
			i = j;
			continue;
		}
		if (ch === '<' && (src[i + 1] === '=' || src[i + 1] === '>')) {
			tokens.push({ type: 'punct', text: src.slice(i, i + 2), pos: i });
			i += 2;
			continue;
		}
		if (ch === '>' && src[i + 1] === '=') {
			tokens.push({ type: 'punct', text: '>=', pos: i });
			i += 2;
			continue;
		}
		if ('+-*/^()=<>,:.·'.includes(ch)) {
			tokens.push({ type: 'punct', text: ch, pos: i });
			i++;
			continue;
		}
		return { error: `unexpected character "${ch}"`, pos: i };
	}
	tokens.push({ type: 'eof', pos: src.length });
	return tokens;
}

// ---------------------------------------------------------------------------
// Parser (Pratt)
// ---------------------------------------------------------------------------

export type ParseResult =
	| { ok: true; ast: FormulaAST }
	| { ok: false; message: string; pos: number };

/** Binding powers. Left-assoc: rbp = lbp + 1; `^` right-assoc: rbp = lbp. */
const BIN_BP: Record<BinOp, { lbp: number; rbp: number }> = {
	'=': { lbp: 3, rbp: 4 },
	'<': { lbp: 3, rbp: 4 },
	'>': { lbp: 3, rbp: 4 },
	'<=': { lbp: 3, rbp: 4 },
	'>=': { lbp: 3, rbp: 4 },
	'<>': { lbp: 3, rbp: 4 },
	'+': { lbp: 5, rbp: 6 },
	'-': { lbp: 5, rbp: 6 },
	'*': { lbp: 7, rbp: 8 },
	'/': { lbp: 7, rbp: 8 },
	'^': { lbp: 10, rbp: 10 }
};
const NOT_BP = 2;
/** Unary minus binds tighter than `^` (Excel semantics: -2^2 = 4). */
const NEG_BP = 11;

const CELL_RE = /^[A-Za-z]{1,3}\d+$/;

class Parser {
	private i = 0;
	constructor(
		private tokens: Token[],
		private sheetId: BlockId
	) {}

	private peek(k = 0): Token {
		return this.tokens[Math.min(this.i + k, this.tokens.length - 1)];
	}
	private next(): Token {
		return this.tokens[this.i++];
	}
	private fail(message: string, pos: number): never {
		throw new ParseError(message, pos);
	}

	parse(): FormulaAST {
		const ast = this.expr(0);
		const t = this.peek();
		if (t.type !== 'eof') this.fail(`unexpected input`, t.pos);
		return ast;
	}

	private expr(minBp: number): FormulaAST {
		let left = this.prefix();
		for (;;) {
			const t = this.peek();
			if (t.type !== 'punct') break;
			const op = t.text as BinOp;
			const bp = BIN_BP[op];
			if (!bp || bp.lbp < minBp) break;
			this.next();
			const right = this.expr(bp.rbp);
			left = { t: 'bin', op, left, right };
		}
		return left;
	}

	private prefix(): FormulaAST {
		const t = this.next();
		if (t.type === 'num') return this.numberLiteral(t.value);
		if (t.type === 'str') return { t: 'lit', value: t.value };
		if (t.type === 'punct' && t.text === '(') {
			const inner = this.expr(0);
			this.expect(')');
			return inner;
		}
		if (t.type === 'punct' && t.text === '-') {
			return { t: 'un', op: '-', arg: this.expr(NEG_BP) };
		}
		if (t.type === 'ident') {
			const upper = t.text.toUpperCase();
			if (upper === 'TRUE') return { t: 'lit', value: true };
			if (upper === 'FALSE') return { t: 'lit', value: false };
			if (upper === 'NOT') return { t: 'un', op: 'not', arg: this.expr(NOT_BP) };
			return this.identExpr(t.text);
		}
		this.fail('unexpected input', t.pos);
	}

	/** Function call, dotted name, cell ref/range, or bare published name. */
	private identExpr(text: string): FormulaAST {
		if (this.peek().type === 'punct' && (this.peek() as { text: string }).text === '(') {
			this.next();
			const args: FormulaAST[] = [];
			if (!(this.peek().type === 'punct' && (this.peek() as { text: string }).text === ')')) {
				for (;;) {
					args.push(this.expr(0));
					const t = this.peek();
					if (t.type === 'punct' && t.text === ',') {
						this.next();
						continue;
					}
					break;
				}
			}
			this.expect(')');
			return { t: 'call', fn: text.toUpperCase(), args };
		}
		if (this.peek().type === 'punct' && (this.peek() as { text: string }).text === '.') {
			let name = text;
			while (this.peek().type === 'punct' && (this.peek() as { text: string }).text === '.') {
				this.next();
				const seg = this.next();
				if (seg.type !== 'ident') this.fail('expected name segment after "."', seg.pos);
				name += '.' + seg.text;
			}
			return { t: 'ref', ref: { name } };
		}
		if (CELL_RE.test(text)) {
			const start = text.toUpperCase();
			const colon = this.peek();
			if (colon.type === 'punct' && colon.text === ':') {
				const end = this.peek(1);
				if (end.type === 'ident' && CELL_RE.test(end.text)) {
					this.next();
					this.next();
					return {
						t: 'ref',
						ref: { sheetId: this.sheetId, a1: `${start}:${end.text.toUpperCase()}` }
					};
				}
			}
			return { t: 'ref', ref: { sheetId: this.sheetId, a1: start } };
		}
		// bare published name (single segment)
		return { t: 'ref', ref: { name: text } };
	}

	/** A number, greedily extended into a unit literal when a unit follows. */
	private numberLiteral(value: number): FormulaAST {
		const t = this.peek();
		if (t.type !== 'ident') return { t: 'lit', value };
		const after = this.peek(1);
		const isCallOrName =
			after.type === 'punct' && (after.text === '(' || after.text === '.');
		if (isCallOrName || parseUnit(t.text) === null) return { t: 'lit', value };
		this.next();
		let unit = t.text;
		for (;;) {
			const sep = this.peek();
			if (sep.type !== 'punct') break;
			if (sep.text === '·' || sep.text === '/') {
				const id = this.peek(1);
				if (id.type !== 'ident') break;
				// In a denominator, cell-ref lookalikes stay cell refs (see header note).
				if (sep.text === '/' && CELL_RE.test(id.text)) break;
				const idAfter = this.peek(2);
				if (idAfter.type === 'punct' && (idAfter.text === '(' || idAfter.text === '.')) break;
				const candidate = `${unit}${sep.text}${id.text}`;
				if (parseUnit(candidate) === null) break;
				this.next();
				this.next();
				unit = candidate;
				continue;
			}
			if (sep.text === '^') {
				const sign = this.peek(1);
				const negated = sign.type === 'punct' && sign.text === '-';
				const num = this.peek(negated ? 2 : 1);
				if (num.type !== 'num' || !Number.isInteger(num.value)) break;
				const candidate = `${unit}^${negated ? '-' : ''}${num.value}`;
				if (parseUnit(candidate) === null) break;
				this.next();
				if (negated) this.next();
				this.next();
				unit = candidate;
				continue;
			}
			break;
		}
		return { t: 'lit', value, unit: normalizeUnitText(unit) };
	}

	private expect(text: string): void {
		const t = this.next();
		if (t.type !== 'punct' || t.text !== text) this.fail(`expected "${text}"`, t.pos);
	}
}

class ParseError extends Error {
	constructor(
		message: string,
		public pos: number
	) {
		super(message);
	}
}

/**
 * Parse formula source into a FormulaAST. A single leading `=` is accepted and
 * ignored (sheet convention). Returns a result, never throws.
 */
export function parseFormula(
	src: string,
	opts?: { sheetId?: BlockId }
): ParseResult {
	const body = src.startsWith('=') ? src.slice(1) : src;
	const offset = src.length - body.length;
	const tokens = tokenize(body);
	if (!Array.isArray(tokens)) {
		return { ok: false, message: tokens.error, pos: tokens.pos + offset };
	}
	try {
		const ast = new Parser(tokens, opts?.sheetId ?? '').parse();
		return { ok: true, ast };
	} catch (e) {
		if (e instanceof ParseError) return { ok: false, message: e.message, pos: e.pos + offset };
		throw e;
	}
}

// ---------------------------------------------------------------------------
// Canonical printer (AST → source text)
// ---------------------------------------------------------------------------

function precOf(ast: FormulaAST): number {
	switch (ast.t) {
		case 'bin':
			return BIN_BP[ast.op].lbp;
		case 'un':
			return ast.op === '-' ? NEG_BP : NOT_BP;
		default:
			return 100;
	}
}

function printAt(ast: FormulaAST, minBp: number): string {
	const text = printNode(ast);
	return precOf(ast) < minBp ? `(${text})` : text;
}

function printNode(ast: FormulaAST): string {
	switch (ast.t) {
		case 'lit': {
			if (typeof ast.value === 'boolean') return ast.value ? 'TRUE' : 'FALSE';
			if (typeof ast.value === 'string') return `"${ast.value.replace(/"/g, '""')}"`;
			const num = String(ast.value);
			return ast.unit ? `${num} ${ast.unit}` : num;
		}
		case 'ref':
			return isNameRef(ast.ref) ? ast.ref.name : ast.ref.a1;
		case 'un':
			return ast.op === '-'
				? `-${printAt(ast.arg, NEG_BP)}`
				: `NOT ${printAt(ast.arg, NOT_BP)}`;
		case 'bin': {
			const bp = BIN_BP[ast.op];
			// Right-assoc (^): a left child at the same precedence needs parens.
			const leftMin = bp.rbp === bp.lbp ? bp.lbp + 1 : bp.lbp;
			return `${printAt(ast.left, leftMin)} ${ast.op} ${printAt(ast.right, bp.rbp)}`;
		}
		case 'call':
			return `${ast.fn}(${ast.args.map((a) => printAt(a, 0)).join(', ')})`;
	}
}

/**
 * Print an AST as canonical source text. `parseFormula(printFormula(ast))`
 * yields a deep-equal AST (given the same sheetId context) — the
 * round-trip contract show-steps (V1-5-4) and the inspector rely on.
 */
export function printFormula(ast: FormulaAST): string {
	return printNode(ast);
}

// ---------------------------------------------------------------------------
// Range expansion (ranges are call-argument sugar: SUM(A1:A3) = SUM(A1,A2,A3))
// ---------------------------------------------------------------------------

/** A range's `a1` text (`A1:B2`) — keeps the guard below from swallowing
 * plain cell refs out of the narrowed-else branch. */
type RangeA1 = `${string}:${string}`;

/** Narrow a ref payload to a cell range (`A1:B2`). */
export function isRangeRef(ref: CellRef | { name: string }): ref is CellRef & { a1: RangeA1 } {
	return !isNameRef(ref) && ref.a1.includes(':');
}

/** Ranges expand to at most this many cells (bounds inputs and the healing index). */
export const MAX_RANGE_CELLS = 1024;

const CORNER_RE = /^([A-Z]{1,3})(\d+)$/;

function colIndex(letters: string): number {
	let n = 0;
	for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
	return n;
}

function colLetters(index: number): string {
	let out = '';
	for (let n = index; n > 0; ) {
		const rem = (n - 1) % 26;
		out = String.fromCharCode(65 + rem) + out;
		n = (n - 1 - rem) / 26;
	}
	return out;
}

/**
 * Expand a range ref into its constituent cell refs, row-major, corners
 * normalized (`B2:A1` covers the same rectangle as `A1:B2`). Malformed or
 * oversized ranges yield an error *value* (SCHEMA.md §2), never a throw.
 */
export function expandRange(ref: CellRef): CellRef[] | ErrorValue {
	const [start, end] = ref.a1.split(':');
	const s = CORNER_RE.exec(start);
	const e = CORNER_RE.exec(end ?? '');
	if (!s || !e) return errorValue('#REF!', `malformed range ${ref.a1}`);
	const [colLo, colHi] = [colIndex(s[1]), colIndex(e[1])].sort((a, b) => a - b);
	const [rowLo, rowHi] = [Number(s[2]), Number(e[2])].sort((a, b) => a - b);
	const count = (colHi - colLo + 1) * (rowHi - rowLo + 1);
	if (count > MAX_RANGE_CELLS) {
		return errorValue('#VALUE!', `range ${ref.a1} has ${count} cells (max ${MAX_RANGE_CELLS})`);
	}
	const cells: CellRef[] = [];
	for (let row = rowLo; row <= rowHi; row++) {
		for (let col = colLo; col <= colHi; col++) {
			cells.push({ sheetId: ref.sheetId, a1: `${colLetters(col)}${row}` });
		}
	}
	return cells;
}

// ---------------------------------------------------------------------------
// Reference resolution (edges are derived — SCHEMA.md §3)
// ---------------------------------------------------------------------------

/** Maps a formula reference to the NodeId it currently designates, if any. */
export type RefResolver = (ref: CellRef | { name: string }) => NodeId | undefined;

/**
 * Derive a formula's `inputs` from its references, in first-appearance order,
 * deduplicated. An unresolved cell ref yields `#REF!`, an unresolved published
 * name `#NAME?` — returned as error *values* (SCHEMA.md §2), never thrown.
 */
export function resolveInputs(ast: FormulaAST, resolve: RefResolver): NodeId[] | ErrorValue {
	const inputs: NodeId[] = [];
	const seen = new Set<NodeId>();
	const walk = (node: FormulaAST): ErrorValue | null => {
		switch (node.t) {
			case 'lit':
				return null;
			case 'ref': {
				const refs = isRangeRef(node.ref) ? expandRange(node.ref) : [node.ref];
				if (!Array.isArray(refs)) return refs;
				for (const ref of refs) {
					const id = resolve(ref);
					if (id === undefined) {
						return isNameRef(ref)
							? errorValue('#NAME?', `unknown name "${ref.name}"`)
							: errorValue('#REF!', `unresolved cell ${ref.a1}`);
					}
					if (!seen.has(id)) {
						seen.add(id);
						inputs.push(id);
					}
				}
				return null;
			}
			case 'un':
				return walk(node.arg);
			case 'bin':
				return walk(node.left) ?? walk(node.right);
			case 'call': {
				for (const arg of node.args) {
					const err = walk(arg);
					if (err) return err;
				}
				return null;
			}
		}
	};
	const err = walk(ast);
	return err ?? inputs;
}
