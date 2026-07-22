/**
 * V1-3-1 — pure text/value mapping between Univer cells and the engine.
 * No `@univerjs` imports here: everything is plain data in, plain data out,
 * so the whole module unit-tests in node without a Univer instance.
 *
 * Responsibilities:
 * - classify a raw cell payload into value / formula / clear (`classifyCellInput`)
 * - A1 <-> row/col conversion and defined-name ref-string parsing
 * - `TypedValue` -> cell display mapping (scalars as numbers, error codes as text;
 *   units stay dormant in V1, decision 19 Jul 2026)
 * - published-name rewrites in formula ASTs (rename support)
 * - defined-name bookkeeping keyed by Univer's stable defined-name id
 */

import type { CellRef, FormulaAST, SheetId, TypedValue } from '../../engine';
import { format, isNameRef, parseQuantity } from '../../engine';

// ---------------------------------------------------------------------------
// Cell input classification
// ---------------------------------------------------------------------------

/** What a raw cell edit means to the graph. */
export type ClassifiedEdit =
	| { kind: 'clear' }
	| { kind: 'formula'; text: string }
	| { kind: 'value'; value: number | string | boolean | TypedValue }
	| { kind: 'invalid'; message: string };

const QUANTITY_LIKE_RE =
	/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*[A-Za-z°]/;

/**
 * The slice of Univer's `ICellData` the adapter reads. `t` follows Univer's
 * `CellValueType` (1 string, 2 number, 3 boolean, 4 force-string).
 */
export interface RawCellInput {
	v?: unknown;
	f?: unknown;
	t?: unknown;
}

/**
 * Classify a raw cell payload. A formula (`f` or a `v` string starting with
 * `=`) wins over a plain value; empty/nullish content means clear. Univer
 * types real edits for us (numbers arrive as numbers), so strings stay strings.
 */
export function classifyCellInput(data: RawCellInput | null | undefined): ClassifiedEdit {
	if (!data) return { kind: 'clear' };
	if (typeof data.f === 'string' && data.f.startsWith('=')) {
		return { kind: 'formula', text: data.f };
	}
	const v = data.v;
	if (v === undefined || v === null || v === '') return { kind: 'clear' };
	if (typeof v === 'string') {
		if (v.startsWith('=')) return { kind: 'formula', text: v };
		if (QUANTITY_LIKE_RE.test(v.trim())) {
			const parsed = parseQuantity(v);
			return parsed.kind === 'error'
				? { kind: 'invalid', message: parsed.message }
				: { kind: 'value', value: parsed };
		}
		return { kind: 'value', value: v };
	}
	if (typeof v === 'number') {
		// Univer stores booleans as 0/1 with t = 3.
		if (data.t === 3) return { kind: 'value', value: v !== 0 };
		return { kind: 'value', value: v };
	}
	if (typeof v === 'boolean') return { kind: 'value', value: v };
	return { kind: 'clear' };
}

// ---------------------------------------------------------------------------
// A1 addressing
// ---------------------------------------------------------------------------

const A1_RE = /^\$?([A-Za-z]{1,3})\$?(\d+)$/;

/** 0-based column index to spreadsheet letters (0 -> A, 26 -> AA). */
export function colToLetters(col: number): string {
	let out = '';
	let n = Math.trunc(col);
	for (;;) {
		out = String.fromCharCode(65 + (n % 26)) + out;
		n = Math.trunc(n / 26) - 1;
		if (n < 0) return out;
	}
}

/** Spreadsheet letters to 0-based column index (A -> 0, AA -> 26). */
export function lettersToCol(letters: string): number {
	let n = 0;
	for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
	return n - 1;
}

/** 0-based row/col to an A1 cell address. */
export function a1FromRowCol(row: number, col: number): string {
	return `${colToLetters(col)}${row + 1}`;
}

/** Parse a single-cell A1 address (ranges rejected). Returns 0-based indexes. */
export function parseA1(a1: string): { row: number; col: number } | null {
	const m = A1_RE.exec(a1.trim());
	if (!m) return null;
	return { row: Number(m[2]) - 1, col: lettersToCol(m[1]) };
}

/**
 * Normalize a Univer defined-name ref string (`Sheet1!$A$1`, `'My Sheet'!B2`,
 * `$C$10`) to a bare uppercase A1 address. Multi-cell ranges and formula
 * strings return null: V1 publishes single cells only (tables are V1-5+).
 */
export function refStringToA1(ref: string): string | null {
	let body = ref.trim();
	if (body.startsWith('=')) return null;
	const bang = body.lastIndexOf('!');
	if (bang >= 0) body = body.slice(bang + 1);
	const m = A1_RE.exec(body.trim());
	if (!m) return null;
	return `${m[1].toUpperCase()}${m[2]}`;
}

/**
 * Parse a single-cell Univer reference into an immutable sheet id and A1.
 * Univer serializes references with sheet names, so callers provide the
 * manifest lookup rather than relying on whichever tab happens to be active.
 */
export function refStringToCellRef(
	ref: string,
	sheetIdForName: (name: string) => SheetId | undefined,
	defaultSheetId?: SheetId
): CellRef | null {
	let body = ref.trim();
	if (body.startsWith('=')) return null;
	let sheetId = defaultSheetId;
	const bang = body.lastIndexOf('!');
	if (bang >= 0) {
		let sheetName = body.slice(0, bang).trim();
		if (sheetName.startsWith("'") && sheetName.endsWith("'")) {
			sheetName = sheetName.slice(1, -1).replaceAll("''", "'");
		}
		sheetId = sheetIdForName(sheetName);
		body = body.slice(bang + 1);
	}
	const match = A1_RE.exec(body.trim());
	if (!match || !sheetId) return null;
	return { sheetId, a1: `${match[1].toUpperCase()}${match[2]}` };
}

/** Build the engine `CellRef` for a cell in a sheet block (uppercase A1). */
export function cellRefFor(sheetId: SheetId, a1: string): CellRef {
	return { sheetId, a1: a1.toUpperCase() };
}

// ---------------------------------------------------------------------------
// TypedValue -> cell display
// ---------------------------------------------------------------------------

/**
 * Kill binary float noise for display (0.1 + 0.2 renders as 0.3) without
 * touching the stored value: the graph keeps full precision.
 */
function displayNumber(value: number): number {
	return Number(value.toPrecision(13));
}

/**
 * Map a settled `TypedValue` to what its cell displays: scalars as numbers,
 * strings verbatim, booleans as TRUE/FALSE, error values as their code text
 * (`#CYCLE!`, `#REF!`, ...). Quantities render their magnitude only: units are
 * dormant in V1 (decision 19 Jul 2026, surfaced by V2-U). Tables and geometry
 * have no single-cell rendering yet and show placeholders.
 */
export function formatCellDisplay(value: TypedValue): number | string {
	if (value.kind === 'scalar') return displayNumber(value.value);
	return format(value);
}

// ---------------------------------------------------------------------------
// Formula AST rewrites
// ---------------------------------------------------------------------------

/**
 * Return a copy of `ast` with every published-name reference to `oldName`
 * rewritten to `newName`. Everything else is preserved. Used when a defined
 * name is renamed so dependents keep resolving (Excel rename semantics).
 */
export function renameNameRefs(ast: FormulaAST, oldName: string, newName: string): FormulaAST {
	switch (ast.t) {
		case 'lit':
			return ast;
		case 'ref':
			if (isNameRef(ast.ref) && ast.ref.name === oldName) {
				return { t: 'ref', ref: { name: newName } };
			}
			return ast;
		case 'un':
			return { ...ast, arg: renameNameRefs(ast.arg, oldName, newName) };
		case 'bin':
			return {
				...ast,
				left: renameNameRefs(ast.left, oldName, newName),
				right: renameNameRefs(ast.right, oldName, newName)
			};
		case 'call':
			return { ...ast, args: ast.args.map((a) => renameNameRefs(a, oldName, newName)) };
	}
}

/** True when the formula references the given cell directly (self-reference check). */
export function refersToCell(ast: FormulaAST, sheetId: SheetId, a1: string): boolean {
	const target = a1.toUpperCase();
	switch (ast.t) {
		case 'lit':
			return false;
		case 'ref':
			return (
				!isNameRef(ast.ref) &&
				ast.ref.sheetId === sheetId &&
				ast.ref.a1.toUpperCase() === target
			);
		case 'un':
			return refersToCell(ast.arg, sheetId, a1);
		case 'bin':
			return refersToCell(ast.left, sheetId, a1) || refersToCell(ast.right, sheetId, a1);
		case 'call':
			return ast.args.some((a) => refersToCell(a, sheetId, a1));
	}
}

// ---------------------------------------------------------------------------
// Defined-name bookkeeping
// ---------------------------------------------------------------------------

/** The adapter's record of one Univer defined name. */
export interface DefinedNameRecord {
	/** The published dotted name (as Univer knows it). */
	name: string;
	/** Stable tab and A1 target, or null for an unsupported range/formula. */
	cellRef: CellRef | null;
}

/**
 * Bookkeeping for Univer defined names, keyed by Univer's stable defined-name
 * id. Univer's rename command carries only the NEW state, so the adapter needs
 * the previous name/ref to translate a `set-defined-name` into the right graph
 * mutations. Pure data: unit-tested without Univer.
 */
export class DefinedNameBook {
	private byId = new Map<string, DefinedNameRecord>();

	/** Record an inserted defined name. */
	recordInsert(id: string, name: string, cellRef: CellRef | null): void {
		this.byId.set(id, { name, cellRef });
	}

	/**
	 * Record an update (rename and/or re-ref) and return the previous record,
	 * or null when the id was never seen (treated as an insert by callers).
	 */
	recordUpdate(id: string, name: string, cellRef: CellRef | null): DefinedNameRecord | null {
		const prev = this.byId.get(id) ?? null;
		this.byId.set(id, { name, cellRef });
		return prev;
	}

	/** Record a removal and return the removed record, if known. */
	recordRemove(id: string): DefinedNameRecord | null {
		const prev = this.byId.get(id) ?? null;
		this.byId.delete(id);
		return prev;
	}

	/** Look up a record by defined-name id. */
	get(id: string): DefinedNameRecord | null {
		return this.byId.get(id) ?? null;
	}
}
