/**
 * V1-3-1 — pure adapter logic: cell input classification, A1 addressing,
 * defined-name ref parsing, TypedValue display mapping, AST name rewrites,
 * and defined-name bookkeeping. No Univer, no DOM.
 */

import { describe, expect, it } from 'vitest';
import { ERR_CODES, errorValue, parseFormula, printFormula, scalar } from '../../engine';
import type { TypedValue } from '../../engine';
import {
	DefinedNameBook,
	a1FromRowCol,
	classifyCellInput,
	colToLetters,
	formatCellDisplay,
	lettersToCol,
	parseA1,
	refStringToA1,
	refersToCell,
	renameNameRefs
} from './cell-text';

describe('classifyCellInput', () => {
	it('classifies formula payloads (f field)', () => {
		expect(classifyCellInput({ f: '=5 * 2' })).toEqual({ kind: 'formula', text: '=5 * 2' });
	});

	it('classifies formula-looking string values', () => {
		expect(classifyCellInput({ v: '=beam.span' })).toEqual({
			kind: 'formula',
			text: '=beam.span'
		});
	});

	it('classifies numbers, strings, booleans', () => {
		expect(classifyCellInput({ v: 42 })).toEqual({ kind: 'value', value: 42 });
		expect(classifyCellInput({ v: 'hello' })).toEqual({ kind: 'value', value: 'hello' });
		expect(classifyCellInput({ v: true })).toEqual({ kind: 'value', value: true });
	});

	it('lifts strict numeric unit text and rejects malformed intended units', () => {
		expect(classifyCellInput({ v: '20 in' })).toMatchObject({
			kind: 'value',
			value: { kind: 'quantity', value: 0.508, unit: { L: 1, display: 'in' } }
		});
		expect(classifyCellInput({ v: '50 ksi' })).toMatchObject({
			kind: 'value',
			value: { kind: 'quantity', value: 344_737_864.6584, unit: { display: 'ksi' } }
		});
		expect(classifyCellInput({ v: '20 mystery' })).toMatchObject({ kind: 'invalid' });
	});

	it('maps Univer boolean cells (v: 0/1, t: 3) to booleans', () => {
		expect(classifyCellInput({ v: 1, t: 3 })).toEqual({ kind: 'value', value: true });
		expect(classifyCellInput({ v: 0, t: 3 })).toEqual({ kind: 'value', value: false });
	});

	it('classifies empty payloads as clear', () => {
		expect(classifyCellInput(null)).toEqual({ kind: 'clear' });
		expect(classifyCellInput({})).toEqual({ kind: 'clear' });
		expect(classifyCellInput({ v: null })).toEqual({ kind: 'clear' });
		expect(classifyCellInput({ v: '' })).toEqual({ kind: 'clear' });
	});

	it('prefers the formula over a stale computed v', () => {
		expect(classifyCellInput({ v: 10, f: '=5 * 2' })).toEqual({
			kind: 'formula',
			text: '=5 * 2'
		});
	});
});

describe('A1 addressing', () => {
	it('round-trips columns through letters', () => {
		expect(colToLetters(0)).toBe('A');
		expect(colToLetters(25)).toBe('Z');
		expect(colToLetters(26)).toBe('AA');
		expect(colToLetters(27)).toBe('AB');
		expect(colToLetters(701)).toBe('ZZ');
		expect(colToLetters(702)).toBe('AAA');
		for (const col of [0, 1, 25, 26, 27, 700, 701, 702, 18277]) {
			expect(lettersToCol(colToLetters(col))).toBe(col);
		}
	});

	it('builds and parses A1 addresses', () => {
		expect(a1FromRowCol(0, 0)).toBe('A1');
		expect(a1FromRowCol(9, 27)).toBe('AB10');
		expect(parseA1('A1')).toEqual({ row: 0, col: 0 });
		expect(parseA1('$AB$10')).toEqual({ row: 9, col: 27 });
	});

	it('rejects ranges and garbage', () => {
		expect(parseA1('A1:B2')).toBeNull();
		expect(parseA1('beam.span')).toBeNull();
		expect(parseA1('')).toBeNull();
	});
});

describe('refStringToA1', () => {
	it('strips sheet prefixes and absolute markers', () => {
		expect(refStringToA1('Sheet1!$A$1')).toBe('A1');
		expect(refStringToA1("'My Sheet'!B2")).toBe('B2');
		expect(refStringToA1('$C$10')).toBe('C10');
		expect(refStringToA1('d4')).toBe('D4');
	});

	it('rejects ranges and formula refs (V1 publishes single cells only)', () => {
		expect(refStringToA1('Sheet1!$A$1:$B$2')).toBeNull();
		expect(refStringToA1('=SUM(A1)')).toBeNull();
		expect(refStringToA1('')).toBeNull();
	});
});

describe('formatCellDisplay', () => {
	it('renders scalars as numbers, without binary float noise', () => {
		expect(formatCellDisplay(scalar(10))).toBe(10);
		expect(formatCellDisplay(scalar(0.1 + 0.2))).toBe(0.3);
	});

	it('renders strings and booleans', () => {
		expect(formatCellDisplay({ kind: 'string', value: 'hi' })).toBe('hi');
		expect(formatCellDisplay({ kind: 'boolean', value: true })).toBe('TRUE');
		expect(formatCellDisplay({ kind: 'boolean', value: false })).toBe('FALSE');
	});

	it('renders every error code as its code text', () => {
		for (const code of ERR_CODES) {
			expect(formatCellDisplay(errorValue(code, 'boom', 'n1'))).toBe(code);
		}
	});

	it('renders quantities through the shared formatter', () => {
		const q: TypedValue = {
			kind: 'quantity',
			value: 5,
			unit: { L: 1, M: 0, T: 0, I: 0, Θ: 0, N: 0, J: 0, display: 'm' }
		};
		expect(formatCellDisplay(q)).toBe('5 m');
	});

	it('renders placeholders for kinds with no single-cell rendering', () => {
		expect(formatCellDisplay({ kind: 'table', columns: [], rows: [] })).toBe('[table 0×0]');
		expect(formatCellDisplay({ kind: 'geometry', handle: 'geom:extrude:9f3a' })).toBe(
			'geom:extrude:9f3a'
		);
	});
});

describe('renameNameRefs', () => {
	function ast(src: string) {
		const parsed = parseFormula(src, { sheetId: 'blk' });
		if (!parsed.ok) throw new Error(parsed.message);
		return parsed.ast;
	}

	it('rewrites only the target name, everywhere it appears', () => {
		const rewritten = renameNameRefs(
			ast('=beam.span * 2 + MAX(beam.span, beam.depth) - A1'),
			'beam.span',
			'beam.length'
		);
		expect(printFormula(rewritten)).toBe('beam.length * 2 + MAX(beam.length, beam.depth) - A1');
	});

	it('returns an equivalent AST when the name does not appear', () => {
		const source = ast('=A1 + beam.depth');
		expect(renameNameRefs(source, 'beam.span', 'beam.length')).toEqual(source);
	});
});

describe('refersToCell', () => {
	function ast(src: string) {
		const parsed = parseFormula(src, { sheetId: 'blk' });
		if (!parsed.ok) throw new Error(parsed.message);
		return parsed.ast;
	}

	it('detects direct and nested self-references, case-insensitively', () => {
		expect(refersToCell(ast('=C3 + 1'), 'blk', 'C3')).toBe(true);
		expect(refersToCell(ast('=SUM(1, -(c3))'), 'blk', 'C3')).toBe(true);
		expect(refersToCell(ast('=B3 + 1'), 'blk', 'C3')).toBe(false);
	});

	it('scopes the check to the sheet block', () => {
		expect(refersToCell(ast('=C3'), 'other-blk', 'C3')).toBe(false);
	});
});

describe('DefinedNameBook', () => {
	it('tracks insert, update, and remove by stable id', () => {
		const book = new DefinedNameBook();
		book.recordInsert('dn1', 'beam.span', { sheetId: 'sheet-a', a1: 'A1' });
		expect(book.get('dn1')).toEqual({
			name: 'beam.span',
			cellRef: { sheetId: 'sheet-a', a1: 'A1' }
		});

		const prev = book.recordUpdate('dn1', 'beam.length', { sheetId: 'sheet-a', a1: 'A1' });
		expect(prev).toEqual({
			name: 'beam.span',
			cellRef: { sheetId: 'sheet-a', a1: 'A1' }
		});
		expect(book.get('dn1')).toEqual({
			name: 'beam.length',
			cellRef: { sheetId: 'sheet-a', a1: 'A1' }
		});

		const removed = book.recordRemove('dn1');
		expect(removed).toEqual({
			name: 'beam.length',
			cellRef: { sheetId: 'sheet-a', a1: 'A1' }
		});
		expect(book.get('dn1')).toBeNull();
	});

	it('returns null for unknown ids (update treated as insert by callers)', () => {
		const book = new DefinedNameBook();
		expect(
			book.recordUpdate('ghost', 'x', { sheetId: 'sheet-b', a1: 'B2' })
		).toBeNull();
		expect(book.recordRemove('ghost2')).toBeNull();
	});
});
