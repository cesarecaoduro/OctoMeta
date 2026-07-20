/**
 * V1-3-1 — the graph-facing adapter half: cell edit routing, published-name
 * lift/rename/unpublish, binding via the graph's cellRef index, and the
 * acceptance proof that cell edits reach the graph ONLY through
 * `applyMutation` (spy + undo-log replay).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	applyMutation,
	printFormula,
	recalc,
	scalar,
	DocumentGraph,
	createBuiltinRegistry
} from '../../engine';
import type { CommitResult, GraphMutation } from '../../engine';
import {
	applyCellEdit,
	createGraphSession,
	ensureSheetBlock,
	nodeForCell,
	nodesForSheet,
	publishCellName,
	renamePublishedName,
	unpublishName,
	type GraphSession
} from './graph-sync';
import { classifyCellInput, formatCellDisplay } from './cell-text';

const A = 'sheet-a';
const B = 'sheet-b';

function newSession(): GraphSession {
	const session = createGraphSession({ docId: 'test-doc' });
	ensureSheetBlock(session, A);
	ensureSheetBlock(session, B);
	return session;
}

/** Route raw cell text the way the adapter does (classify, then apply). */
function edit(session: GraphSession, blockId: string, a1: string, text: unknown) {
	const data = text === null ? null : typeof text === 'string' && text.startsWith('=')
		? { f: text }
		: { v: text };
	return applyCellEdit(session, blockId, a1, classifyCellInput(data));
}

function display(session: GraphSession, blockId: string, a1: string): unknown {
	const node = nodeForCell(session, blockId, a1);
	return node ? formatCellDisplay(node.value) : null;
}

describe('cell edits through the graph', () => {
	it('creates an input node for a fresh value edit, bound via the cellRef index', () => {
		const session = newSession();
		const outcome = edit(session, A, 'A1', 12);
		expect(outcome.kind).toBe('applied');
		const node = nodeForCell(session, A, 'A1');
		expect(node?.kind).toBe('input');
		expect(node?.cellRef).toEqual({ sheetId: A, a1: 'A1' });
		expect(node?.blockId).toBeUndefined();
		expect(display(session, A, 'A1')).toBe(12);
	});

	it('evaluates formulas through the engine: =5 * 2 shows 10', () => {
		const session = newSession();
		edit(session, A, 'A1', '=5 * 2');
		expect(nodeForCell(session, A, 'A1')?.kind).toBe('computed');
		expect(display(session, A, 'A1')).toBe(10);
	});

	it('stores authored quantities canonically and rejects unknown units without mutation', () => {
		const session = newSession();
		expect(edit(session, A, 'A1', '20 in')).toMatchObject({ kind: 'applied' });
		expect(nodeForCell(session, A, 'A1')?.value).toMatchObject({
			kind: 'quantity',
			value: 0.508,
			unit: { display: 'in' }
		});
		expect(display(session, A, 'A1')).toBe('20 in');
		const before = session.doc.undoLog.length;
		expect(edit(session, A, 'A2', '20 mystery')).toMatchObject({ kind: 'rejected' });
		expect(nodeForCell(session, A, 'A2')).toBeUndefined();
		expect(session.doc.undoLog).toHaveLength(before);
	});

	it('recomputes dependents when an input changes', () => {
		const session = newSession();
		edit(session, A, 'A1', 12);
		edit(session, A, 'B1', '=A1 * 2');
		expect(display(session, A, 'B1')).toBe(24);
		edit(session, A, 'A1', 20);
		expect(display(session, A, 'B1')).toBe(40);
	});

	it('handles kind changes: value -> formula -> value', () => {
		const session = newSession();
		edit(session, A, 'A1', 7);
		expect(nodeForCell(session, A, 'A1')?.kind).toBe('input');
		edit(session, A, 'A1', '=3 + 4');
		expect(nodeForCell(session, A, 'A1')?.kind).toBe('computed');
		expect(display(session, A, 'A1')).toBe(7);
		edit(session, A, 'A1', 9);
		expect(nodeForCell(session, A, 'A1')?.kind).toBe('input');
		expect(display(session, A, 'A1')).toBe(9);
	});

	it('dependents survive a kind change (heal through the cellRef index)', () => {
		const session = newSession();
		edit(session, A, 'A1', 12);
		edit(session, A, 'B1', '=A1 * 2');
		edit(session, A, 'A1', '=6 * 3'); // input -> computed: remove + re-add
		expect(display(session, A, 'B1')).toBe(36);
	});

	it('clearing a cell removes its node and turns dependents #REF!', () => {
		const session = newSession();
		edit(session, A, 'A1', 12);
		edit(session, A, 'B1', '=A1 * 2');
		const outcome = edit(session, A, 'A1', null);
		expect(outcome.kind).toBe('cleared');
		expect(nodeForCell(session, A, 'A1')).toBeUndefined();
		expect(display(session, A, 'B1')).toBe('#REF!');
	});

	it('stores unparseable formula text verbatim as a string input', () => {
		const session = newSession();
		const outcome = edit(session, A, 'A1', '=5 +');
		expect(outcome.kind).toBe('applied');
		const node = nodeForCell(session, A, 'A1');
		expect(node?.kind).toBe('input');
		expect(node?.value).toEqual({ kind: 'string', value: '=5 +' });
	});

	it('rejects a self-referencing formula on a fresh cell with #CYCLE!', () => {
		const session = newSession();
		const outcome = edit(session, A, 'C3', '=C3 + 1');
		expect(outcome).toMatchObject({ kind: 'rejected', display: '#CYCLE!' });
		expect(nodeForCell(session, A, 'C3')).toBeUndefined(); // graph untouched
	});

	it('rejects a self-referencing rewrite of an existing formula cell', () => {
		const session = newSession();
		edit(session, A, 'C3', '=1 + 1');
		const outcome = edit(session, A, 'C3', '=C3 + 1');
		expect(outcome).toMatchObject({ kind: 'rejected', display: '#CYCLE!' });
		expect(display(session, A, 'C3')).toBe(2); // last valid state kept
	});

	it('rejects transitive cycles with #CYCLE!', () => {
		const session = newSession();
		edit(session, A, 'A1', '=5');
		edit(session, A, 'B1', '=A1 * 2');
		const outcome = edit(session, A, 'A1', '=B1');
		expect(outcome).toMatchObject({ kind: 'rejected', display: '#CYCLE!' });
		expect(display(session, A, 'B1')).toBe(10);
	});

	it('reports unknown functions and names as error values in the cell', () => {
		const session = newSession();
		edit(session, A, 'A1', '=NOSUCHFN(1)');
		expect(display(session, A, 'A1')).toBe('#NAME?');
		edit(session, A, 'A2', '=ghost.name');
		expect(display(session, A, 'A2')).toBe('#NAME?');
	});
});

describe('published names across sheets', () => {
	it('publishes a cell, resolves the dotted name from another sheet block', () => {
		const session = newSession();
		edit(session, A, 'A1', 12);
		const published = publishCellName(session, A, 'A1', 'beam.span');
		expect(published.ok).toBe(true);
		edit(session, B, 'A1', '=beam.span * 2');
		expect(display(session, B, 'A1')).toBe(24);
		// Reactive across sheets: edit the source, the consumer follows.
		edit(session, A, 'A1', 20);
		expect(display(session, B, 'A1')).toBe(40);
	});

	it('heals a formula that referenced the name before it was published', () => {
		const session = newSession();
		edit(session, B, 'A1', '=beam.span * 2');
		expect(display(session, B, 'A1')).toBe('#NAME?');
		edit(session, A, 'A1', 12);
		publishCellName(session, A, 'A1', 'beam.span');
		expect(display(session, B, 'A1')).toBe(24);
	});

	it('publishing an empty cell seeds an input node', () => {
		const session = newSession();
		const published = publishCellName(session, A, 'D4', 'pad.width', scalar(3));
		expect(published.ok).toBe(true);
		expect(nodeForCell(session, A, 'D4')?.kind).toBe('input');
		expect(display(session, A, 'D4')).toBe(3);
	});

	it('rename rewrites dependents to the new name and keeps values (Excel semantics)', () => {
		const session = newSession();
		edit(session, A, 'A1', 12);
		publishCellName(session, A, 'A1', 'beam.span');
		edit(session, B, 'A1', '=beam.span * 2');

		const renamed = renamePublishedName(session, 'beam.span', 'beam.length');
		expect(renamed.ok).toBe(true);
		expect(session.doc.resolveRef({ name: 'beam.span' })).toBeUndefined();
		expect(session.doc.resolveRef({ name: 'beam.length' })).toBeDefined();

		const dep = nodeForCell(session, B, 'A1');
		expect(dep?.formula && printFormula(dep.formula)).toBe('beam.length * 2');
		expect(display(session, B, 'A1')).toBe(24);
		// Still live after the rename.
		edit(session, A, 'A1', 20);
		expect(display(session, B, 'A1')).toBe(40);
	});

	it('unpublish turns dependents into name errors and a republish heals them', () => {
		const session = newSession();
		edit(session, A, 'A1', 12);
		publishCellName(session, A, 'A1', 'beam.span');
		edit(session, B, 'A1', '=beam.span * 2');

		expect(unpublishName(session, 'beam.span').ok).toBe(true);
		// removeNode marks dependents #REF!; recalc then re-evaluates them and
		// the unresolved published name settles as #NAME? (SCHEMA.md §11).
		expect(display(session, B, 'A1')).toBe('#NAME?');

		publishCellName(session, A, 'A1', 'beam.span');
		expect(display(session, B, 'A1')).toBe(24);
	});
});

describe('settle notifications', () => {
	it('notifies listeners with every affected node so displays can repaint', () => {
		const session = newSession();
		edit(session, A, 'A1', 12);
		edit(session, B, 'A1', '=1'); // unrelated cell on sheet B
		publishCellName(session, A, 'A1', 'beam.span');
		edit(session, B, 'B1', '=beam.span * 2');

		const settled: CommitResult[] = [];
		const off = session.onSettle((r) => settled.push(r));
		edit(session, A, 'A1', 20);
		off();

		const touched = new Set(settled.flatMap((r) => [...r.affected, ...r.evaluated]));
		const bDep = nodeForCell(session, B, 'B1');
		expect(bDep && touched.has(bDep.id)).toBe(true); // cross-sheet repaint
		const bOther = nodeForCell(session, B, 'A1');
		expect(bOther && touched.has(bOther.id)).toBe(false); // untouched cell not repainted
	});

	it('session.undo/redo run engine history and fan out settles like commit (V1-5-2)', () => {
		const session = newSession();
		edit(session, A, 'A1', 12);
		edit(session, A, 'A2', '=A1 * 2');
		expect(display(session, A, 'A2')).toBe(24);

		edit(session, A, 'A1', 20);
		expect(display(session, A, 'A2')).toBe(40);

		const settled: CommitResult[] = [];
		const off = session.onSettle((r) => settled.push(r));

		// Undo the A1=20 edit: the dependent reverts and listeners hear about it.
		const undone = session.undo();
		expect(undone.ok).toBe(true);
		expect(display(session, A, 'A1')).toBe(12);
		expect(display(session, A, 'A2')).toBe(24);
		const dep = nodeForCell(session, A, 'A2');
		const touched = new Set(settled.flatMap((r) => [...r.affected, ...r.evaluated]));
		expect(dep && touched.has(dep.id)).toBe(true);

		// Redo re-applies and fans out again.
		settled.length = 0;
		const redone = session.redo();
		expect(redone.ok).toBe(true);
		expect(display(session, A, 'A1')).toBe(20);
		expect(display(session, A, 'A2')).toBe(40);
		expect(settled.length).toBeGreaterThan(0);
		off();
	});

	it('undoing a cell add removes the node and still notifies listeners', () => {
		const session = newSession();
		const outcome = edit(session, A, 'C1', 7);
		expect(outcome.kind).toBe('applied');

		const settled: CommitResult[] = [];
		const off = session.onSettle((r) => settled.push(r));
		// Two entries: addNode + setInput — undo both to remove the node.
		expect(session.undo().ok).toBe(true);
		expect(session.undo().ok).toBe(true);
		off();

		// The removed id is NOT in any affected set (removeNode reports only
		// dependents) — adapters detect the vanish by sweeping their bound-cell
		// map on each settle notification, so the notification itself matters.
		expect(nodeForCell(session, A, 'C1')).toBeUndefined();
		expect(settled.length).toBe(2);
	});
});

describe('acceptance: no write path around applyMutation', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-19T12:00:00Z'));
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('every graph write happens inside commit, and the undo log replays to identical state', () => {
		const session = newSession();
		const doc = session.doc;

		// Spy 1: low-level store writes must only ever run inside session.commit.
		let inCommit = false;
		const committed: GraphMutation[] = [];
		const rawCommit = session.commit;
		(session as { commit: GraphSession['commit'] }).commit = (m) => {
			committed.push(structuredClone(m));
			inCommit = true;
			try {
				return rawCommit(m);
			} finally {
				inCommit = false;
			}
		};
		const guard = <K extends 'insertNode' | 'deleteNode' | 'replaceNode' | 'pushUndoEntry'>(
			method: K
		) => {
			const original = doc[method].bind(doc) as (...args: unknown[]) => unknown;
			(doc as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
				if (!inCommit) throw new Error(`${method} called outside applyMutation/commit`);
				return original(...args);
			};
		};
		guard('insertNode');
		guard('deleteNode');
		guard('replaceNode');
		guard('pushUndoEntry');

		// A representative battery: values, formulas, kind changes, clears,
		// publishes, renames, cross-sheet references.
		edit(session, A, 'A1', 12);
		edit(session, A, 'B1', '=A1 * 2');
		publishCellName(session, A, 'A1', 'beam.span');
		edit(session, B, 'A1', '=beam.span + B2');
		edit(session, B, 'B2', 5);
		edit(session, A, 'B1', 99); // computed -> input kind change
		renamePublishedName(session, 'beam.span', 'beam.length');
		edit(session, B, 'B2', null); // clear with dependents
		edit(session, A, 'A1', 20);

		expect(committed.length).toBeGreaterThan(0);

		// Spy 2 (the strong form): the undo log's recorded mutations fully
		// reproduce the graph on a fresh document through applyMutation alone.
		// Any write that bypassed applyMutation could not be in the log and the
		// replayed graph would differ.
		const registry = createBuiltinRegistry();
		const fresh = new DocumentGraph();
		for (const entry of doc.undoLog) {
			const r = applyMutation(fresh, structuredClone(entry.mutation), entry.actor);
			expect(r.ok).toBe(true);
			if (r.ok) recalc(fresh, r.value, { registry });
		}

		expect(Object.fromEntries(fresh.nodes)).toEqual(Object.fromEntries(doc.nodes));
		expect(Object.fromEntries(fresh.blocks)).toEqual(Object.fromEntries(doc.blocks));
		expect(fresh.blocksOrder).toEqual(doc.blocksOrder);
		// Binding indexes agree too: every cell node resolves identically.
		for (const node of nodesForSheet(session, A).concat(nodesForSheet(session, B))) {
			expect(fresh.resolveRef(node.cellRef as { sheetId: string; a1: string })).toBe(
				node.id
			);
		}
	});
});
