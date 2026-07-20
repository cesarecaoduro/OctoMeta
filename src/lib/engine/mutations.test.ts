import { describe, expect, it } from 'vitest';
import { DocumentGraph, UNDO_CAP } from './graph';
import {
	applyMutation,
	redo,
	undo,
	type Actor,
	type GraphMutation,
	type MutationError
} from './mutations';
import { emptyProvenance, type GraphNode } from './node';
import { parseFormula, type FormulaAST } from './formula';
import { errorValue, scalar, type CellRef } from './types';
import type { Block } from './block';

const HUMAN: Actor = { kind: 'human', id: 'cesare' };
const TEMPLATE: Actor = { kind: 'template' };
const SHEET = 'blk-sheet';
const DOC = 'doc1';

type NewNode = Omit<GraphNode, 'value' | 'contentHash' | 'inputs'>;

function cell(a1: string, sheetBlockId = SHEET): CellRef {
	return { sheetBlockId, a1 };
}

function must<T>(r: { ok: true; value: T } | { ok: false; error: MutationError }): T {
	if (!r.ok) throw new Error(r.error.message);
	return r.value;
}

function ast(src: string): FormulaAST {
	const p = parseFormula(src, { sheetBlockId: SHEET });
	if (!p.ok) throw new Error(p.message);
	return p.ast;
}

function addInput(doc: DocumentGraph, id: string, a1: string, value = 5, actor: Actor = HUMAN) {
	const node: NewNode = {
		id,
		kind: 'input',
		cellRef: cell(a1),
		blockId: SHEET,
		provenance: emptyProvenance()
	};
	must(applyMutation(doc, { op: 'addNode', node }, actor));
	must(applyMutation(doc, { op: 'setInput', id, value: scalar(value) }, actor));
}

function addComputed(
	doc: DocumentGraph,
	id: string,
	a1: string | null,
	src: string,
	actor: Actor = HUMAN
) {
	const node: NewNode = {
		id,
		kind: 'computed',
		formula: ast(src),
		blockId: SHEET,
		provenance: emptyProvenance(),
		...(a1 ? { cellRef: cell(a1) } : {})
	};
	must(applyMutation(doc, { op: 'addNode', node }, actor));
}

function addBlock(
	doc: DocumentGraph,
	blockId: string,
	type: Block['type'] = 'text',
	position?: number
) {
	const m: GraphMutation = {
		op: 'blockOp',
		action: 'add',
		blockId,
		block: { docId: DOC, type },
		...(position !== undefined ? { position } : {})
	};
	must(applyMutation(doc, m, HUMAN));
}

/** Full-store snapshot for deep equality (nodes incl. contentHash + provenance). */
function snap(doc: DocumentGraph) {
	return structuredClone({
		nodes: doc.nodes,
		blocks: doc.blocks,
		blocksOrder: doc.blocksOrder,
		chips: doc.chips
	});
}

function assertOrderInvariant(doc: DocumentGraph) {
	expect(doc.blocksOrder.length).toBe(doc.blocks.size);
	doc.blocksOrder.forEach((id, i) => {
		expect(doc.blocks.get(id)?.position, `position of block ${id}`).toBe(i);
	});
}

/** Apply, undo back to the before-state, redo back to the after-state. */
function roundTrip(doc: DocumentGraph, m: GraphMutation, actor: Actor = HUMAN) {
	const before = snap(doc);
	must(applyMutation(doc, m, actor));
	const after = snap(doc);
	must(undo(doc));
	expect(snap(doc)).toEqual(before);
	must(redo(doc));
	expect(snap(doc)).toEqual(after);
}

describe('undo/redo round-trips (deep-equal incl. hashes and provenance)', () => {
	it('setInput', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'a', 'A1');
		roundTrip(doc, { op: 'setInput', id: 'a', value: scalar(9) });
	});

	it('setFormula', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'a', 'A1');
		addComputed(doc, 'c', 'C1', '=A1*2');
		roundTrip(doc, { op: 'setFormula', id: 'c', formula: ast('=A1+10') });
		expect(doc.nodes.get('c')?.inputs).toEqual(['a']);
	});

	it('addNode, including healing of #NAME? waiters', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'a', 'A1');
		addComputed(doc, 'w', 'B1', '=beam.span + 1');
		expect(doc.nodes.get('w')?.value).toMatchObject({ kind: 'error', code: '#NAME?' });
		const node: NewNode = {
			id: 'n',
			kind: 'computed',
			name: 'beam.span',
			formula: ast('=A1'),
			provenance: emptyProvenance()
		};
		roundTrip(doc, { op: 'addNode', node });
		expect(doc.nodes.get('w')?.inputs).toEqual(['n']);
	});

	it('removeNode with dependents', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'a', 'A1');
		addComputed(doc, 'c', 'C1', '=A1*2');
		roundTrip(doc, { op: 'removeNode', id: 'a' });
		expect(doc.nodes.has('a')).toBe(false);
		expect(doc.nodes.get('c')?.inputs).toEqual([]);
		expect(doc.nodes.get('c')?.value).toMatchObject({ kind: 'error', code: '#REF!' });
	});

	it('publishName (create) recreates the identical node id on redo', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'a', 'A1');
		roundTrip(doc, { op: 'publishName', cellRef: cell('A1'), name: 'beam.span' });
		const namedId = doc.resolveRef({ name: 'beam.span' });
		expect(namedId).toBeDefined();
		expect(doc.nodes.get(namedId as string)?.inputs).toEqual(['a']);
	});

	it('publishName (rebind)', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'a', 'A1');
		addInput(doc, 'b', 'B1', 7);
		must(applyMutation(doc, { op: 'publishName', cellRef: cell('A1'), name: 'beam.span' }, HUMAN));
		roundTrip(doc, { op: 'publishName', cellRef: cell('B1'), name: 'beam.span' });
		const namedId = doc.resolveRef({ name: 'beam.span' }) as string;
		expect(doc.nodes.get(namedId)?.inputs).toEqual(['b']);
	});

	it('rebindChip', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'a', 'A1');
		addInput(doc, 'b', 'B1');
		doc.chips.set('ch1', { id: 'ch1', blockId: 'blk-text', nodeId: 'a' });
		roundTrip(doc, { op: 'rebindChip', chipId: 'ch1', nodeId: 'b' });
		expect(doc.chips.get('ch1')?.nodeId).toBe('b');
	});

	it('chipOp create and remove (V1-5-3 chip lifecycle)', () => {
		const doc = new DocumentGraph();
		addBlock(doc, 'blk-text');
		addInput(doc, 'a', 'A1');
		roundTrip(doc, {
			op: 'chipOp',
			action: 'create',
			chipId: 'ch1',
			chip: { blockId: 'blk-text', nodeId: 'a', format: { digits: 2 } }
		});
		expect(doc.chips.get('ch1')).toEqual({
			id: 'ch1',
			blockId: 'blk-text',
			nodeId: 'a',
			format: { digits: 2 }
		});
		roundTrip(doc, { op: 'chipOp', action: 'remove', chipId: 'ch1' });
		expect(doc.chips.has('ch1')).toBe(false);
	});

	it('chipOp never touches values: AffectedSet is empty', () => {
		const doc = new DocumentGraph();
		addBlock(doc, 'blk-text');
		addInput(doc, 'a', 'A1');
		const created = must(
			applyMutation(
				doc,
				{ op: 'chipOp', action: 'create', chipId: 'ch1', chip: { blockId: 'blk-text', nodeId: 'a' } },
				HUMAN
			)
		);
		expect(created).toEqual([]);
		const removed = must(applyMutation(doc, { op: 'chipOp', action: 'remove', chipId: 'ch1' }, HUMAN));
		expect(removed).toEqual([]);
	});

	it('blockOp add / move / update', () => {
		const doc = new DocumentGraph();
		addBlock(doc, 'b1');
		addBlock(doc, 'b2');
		roundTrip(doc, {
			op: 'blockOp',
			action: 'add',
			blockId: 'b3',
			block: { docId: DOC, type: 'heading' },
			position: 1
		});
		roundTrip(doc, { op: 'blockOp', action: 'move', blockId: 'b3', position: 0 });
		roundTrip(doc, {
			op: 'blockOp',
			action: 'update',
			blockId: 'b1',
			block: { pm: { type: 'doc', content: [] } }
		});
		assertOrderInvariant(doc);
	});

	it('blockOp update round-trips a field being cleared (null) and added', () => {
		const doc = new DocumentGraph();
		addBlock(doc, 'b1');
		must(
			applyMutation(
				doc,
				{ op: 'blockOp', action: 'update', blockId: 'b1', block: { pm: { v: 1 } } },
				HUMAN
			)
		);
		// Clearing an existing field, and the inverse (null) surviving round-trip:
		roundTrip(doc, { op: 'blockOp', action: 'update', blockId: 'b1', block: { pm: null } });
		expect(doc.blocks.get('b1')).not.toHaveProperty('pm');
	});

	it('blockOp remove cascades hosted nodes and chips with full inverse', () => {
		const doc = new DocumentGraph();
		addBlock(doc, SHEET, 'sheet');
		addBlock(doc, 'blk-text');
		addInput(doc, 'a', 'A1');
		addComputed(doc, 'c', 'C1', '=A1*2'); // hosted by SHEET, removed in cascade
		// Outside dependent: hosted by another block, survives with #REF!.
		const outside: NewNode = {
			id: 'd',
			kind: 'computed',
			formula: ast('=A1+1'),
			blockId: 'blk-text',
			provenance: emptyProvenance()
		};
		must(applyMutation(doc, { op: 'addNode', node: outside }, HUMAN));
		doc.chips.set('ch1', { id: 'ch1', blockId: SHEET, nodeId: 'a' });
		roundTrip(doc, { op: 'blockOp', action: 'remove', blockId: SHEET });
		expect(doc.nodes.has('a')).toBe(false);
		expect(doc.nodes.has('c')).toBe(false);
		expect(doc.chips.has('ch1')).toBe(false);
		expect(doc.nodes.get('d')?.value).toMatchObject({ kind: 'error', code: '#REF!' });
		assertOrderInvariant(doc);
	});
});

describe('removeNode healing (Marimo semantics)', () => {
	it('undo restores dependents inputs and values', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'a', 'A1');
		addComputed(doc, 'c', 'C1', '=A1*2');
		const priorC = structuredClone(doc.nodes.get('c'));
		must(applyMutation(doc, { op: 'removeNode', id: 'a' }, HUMAN));
		expect(doc.nodes.get('c')?.value).toMatchObject({ kind: 'error', code: '#REF!', origin: 'c' });
		must(undo(doc));
		expect(doc.nodes.get('c')).toEqual(priorC);
	});

	it('re-adding a node at the same cellRef heals dependents via the unresolved index', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'a', 'A1');
		addComputed(doc, 'c', 'C1', '=A1*2');
		must(applyMutation(doc, { op: 'removeNode', id: 'a' }, HUMAN));
		expect(doc.nodes.get('c')?.inputs).toEqual([]);
		const replacement: NewNode = {
			id: 'a2',
			kind: 'input',
			cellRef: cell('A1'),
			provenance: emptyProvenance()
		};
		const affected = must(applyMutation(doc, { op: 'addNode', node: replacement }, HUMAN));
		expect(affected).toContain('a2');
		expect(affected).toContain('c');
		expect(doc.nodes.get('c')?.inputs).toEqual(['a2']);
	});
});

describe('undo log serialization', () => {
	it('entries survive JSON.stringify/parse and still undo/redo in a replica', () => {
		const doc = new DocumentGraph();
		addBlock(doc, SHEET, 'sheet');
		addInput(doc, 'a', 'A1');
		addComputed(doc, 'c', 'C1', '=A1*2');
		must(applyMutation(doc, { op: 'publishName', cellRef: cell('A1'), name: 'beam.span' }, HUMAN));
		must(applyMutation(doc, { op: 'setInput', id: 'a', value: scalar(42) }, HUMAN));

		// Replica: clone store state via the public store methods, restore the
		// undo log through a JSON round-trip.
		const replica = new DocumentGraph();
		for (const id of doc.blocksOrder) {
			replica.insertBlock(JSON.parse(JSON.stringify(doc.blocks.get(id))));
		}
		for (const node of doc.nodes.values()) {
			replica.insertNode(JSON.parse(JSON.stringify(node)));
		}
		for (const chip of doc.chips.values()) {
			replica.chips.set(chip.id, JSON.parse(JSON.stringify(chip)));
		}
		replica.undoLog = JSON.parse(JSON.stringify(doc.undoLog));
		replica.undoCursor = doc.undoCursor;
		expect(snap(replica)).toEqual(snap(doc));

		must(undo(doc));
		must(undo(doc));
		must(undo(replica));
		must(undo(replica));
		expect(snap(replica)).toEqual(snap(doc));

		must(redo(doc));
		must(redo(replica));
		expect(snap(replica)).toEqual(snap(doc));
	});
});

describe('history shape', () => {
	it('a fresh mutation after undo() truncates the redo tail', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'a', 'A1');
		must(applyMutation(doc, { op: 'setInput', id: 'a', value: scalar(1) }, HUMAN));
		must(applyMutation(doc, { op: 'setInput', id: 'a', value: scalar(2) }, HUMAN));
		must(undo(doc));
		const before = doc.undoLog.length;
		must(applyMutation(doc, { op: 'setInput', id: 'a', value: scalar(3) }, HUMAN));
		expect(doc.undoLog.length).toBe(before); // tail dropped, fresh entry appended
		expect(doc.undoCursor).toBe(doc.undoLog.length);
		const r = redo(doc);
		expect(r.ok).toBe(false);
		expect((doc.nodes.get('a')?.value as { value: number }).value).toBe(3);
	});

	it('caps at 200 entries, pruned oldest-first, seq stays monotonic', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'a', 'A1'); // 2 entries
		for (let i = 0; i < 210; i++) {
			must(applyMutation(doc, { op: 'setInput', id: 'a', value: scalar(i) }, HUMAN));
		}
		expect(doc.undoLog.length).toBe(UNDO_CAP);
		expect(doc.undoCursor).toBe(UNDO_CAP);
		expect(doc.undoLog[0].seq).toBe(13); // 212 total, oldest 12 pruned
		expect(doc.undoLog[UNDO_CAP - 1].seq).toBe(212);
		for (let i = 1; i < doc.undoLog.length; i++) {
			expect(doc.undoLog[i].seq).toBe(doc.undoLog[i - 1].seq + 1);
		}
		must(undo(doc)); // pruned history still undoes from the top
		expect(doc.undoCursor).toBe(UNDO_CAP - 1);
	});
});

describe('invalid mutations reject with zero partial writes', () => {
	function rejects(doc: DocumentGraph, m: GraphMutation, actor: Actor = HUMAN) {
		const before = snap(doc);
		const logLen = doc.undoLog.length;
		const cursor = doc.undoCursor;
		const r = applyMutation(doc, m, actor);
		expect(r.ok).toBe(false);
		expect(snap(doc)).toEqual(before);
		expect(doc.undoLog.length).toBe(logLen);
		expect(doc.undoCursor).toBe(cursor);
		return r.ok ? undefined : r.error;
	}

	function seeded(): DocumentGraph {
		const doc = new DocumentGraph();
		addBlock(doc, SHEET, 'sheet');
		addInput(doc, 'a', 'A1');
		addComputed(doc, 'c', 'C1', '=A1*2');
		return doc;
	}

	it('unknown nodes', () => {
		const doc = seeded();
		rejects(doc, { op: 'setInput', id: 'nope', value: scalar(1) });
		rejects(doc, { op: 'setFormula', id: 'nope', formula: ast('=1') });
		rejects(doc, { op: 'removeNode', id: 'nope' });
		rejects(doc, { op: 'rebindChip', chipId: 'nope', nodeId: 'a' });
	});

	it('wrong kinds', () => {
		const doc = seeded();
		rejects(doc, { op: 'setInput', id: 'c', value: scalar(1) });
		rejects(doc, { op: 'setFormula', id: 'a', formula: ast('=1') });
	});

	it('malformed values', () => {
		const doc = seeded();
		rejects(doc, { op: 'setInput', id: 'a', value: scalar(Number.NaN) });
		rejects(doc, { op: 'setInput', id: 'a', value: errorValue('#VALUE!', 'nope') });
		rejects(doc, {
			op: 'setInput',
			id: 'a',
			value: { kind: 'string', value: 5 } as unknown as ReturnType<typeof scalar>
		});
	});

	it('duplicate ids, names, and cell bindings', () => {
		const doc = seeded();
		const dup: NewNode = { id: 'a', kind: 'input', provenance: emptyProvenance() };
		rejects(doc, { op: 'addNode', node: dup });
		const dupCell: NewNode = {
			id: 'x',
			kind: 'input',
			cellRef: cell('A1'),
			provenance: emptyProvenance()
		};
		rejects(doc, { op: 'addNode', node: dupCell });
	});

	it('publishName validation', () => {
		const doc = seeded();
		rejects(doc, { op: 'publishName', cellRef: cell('Z9'), name: 'beam.span' });
		rejects(doc, { op: 'publishName', cellRef: cell('A1'), name: '3bad.name' });
	});

	it('chipOp validation', () => {
		const doc = seeded();
		addBlock(doc, 'blk-text');
		must(
			applyMutation(
				doc,
				{ op: 'chipOp', action: 'create', chipId: 'ch1', chip: { blockId: 'blk-text', nodeId: 'a' } },
				HUMAN
			)
		);
		// create is strict: fresh id, existing node, existing block, payload required.
		rejects(doc, {
			op: 'chipOp',
			action: 'create',
			chipId: 'ch1',
			chip: { blockId: 'blk-text', nodeId: 'a' }
		});
		rejects(doc, {
			op: 'chipOp',
			action: 'create',
			chipId: 'ch2',
			chip: { blockId: 'blk-text', nodeId: 'nope' }
		});
		rejects(doc, {
			op: 'chipOp',
			action: 'create',
			chipId: 'ch2',
			chip: { blockId: 'no-such-block', nodeId: 'a' }
		});
		rejects(doc, { op: 'chipOp', action: 'create', chipId: 'ch2' });
		rejects(doc, { op: 'chipOp', action: 'create', chipId: '', chip: { blockId: 'blk-text', nodeId: 'a' } });
		rejects(doc, { op: 'chipOp', action: 'remove', chipId: 'nope' });
	});

	it('blockOp validation', () => {
		const doc = seeded();
		rejects(doc, { op: 'blockOp', action: 'move', blockId: SHEET }); // no position
		rejects(doc, { op: 'blockOp', action: 'update', blockId: SHEET, block: { type: 'text' } });
		rejects(doc, { op: 'blockOp', action: 'update', blockId: SHEET, block: { position: 3 } });
		rejects(doc, { op: 'blockOp', action: 'add', blockId: 'nb', block: { docId: DOC, type: 'text', id: 'other' } });
		rejects(doc, { op: 'blockOp', action: 'remove', blockId: 'nope' });
	});

	it('undo-internal ops are rejected at the public boundary', () => {
		const doc = seeded();
		const node = structuredClone(doc.nodes.get('a')) as GraphNode;
		rejects(doc, { op: 'restoreNode', node });
		rejects(doc, {
			op: 'restoreChip',
			chip: { id: 'ch', blockId: SHEET, nodeId: 'a' }
		});
	});
});

describe('provenance stamping', () => {
	it('human actor with id', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'a', 'A1');
		must(applyMutation(doc, { op: 'setInput', id: 'a', value: scalar(8) }, HUMAN));
		const at = doc.undoLog[doc.undoLog.length - 1].at;
		expect(doc.nodes.get('a')?.provenance).toEqual({
			authoredBy: 'human',
			authorId: 'cesare',
			authoredAt: at
		});
	});

	it('template actor without id', () => {
		const doc = new DocumentGraph();
		const node: NewNode = {
			id: 't',
			kind: 'input',
			cellRef: cell('A1'),
			provenance: emptyProvenance()
		};
		must(applyMutation(doc, { op: 'addNode', node }, TEMPLATE));
		const at = doc.undoLog[doc.undoLog.length - 1].at;
		expect(doc.nodes.get('t')?.provenance).toEqual({ authoredBy: 'template', authoredAt: at });
	});
});

describe('blocksOrder vs position invariant', () => {
	it('never disagrees across add/move/remove/update and their undos', () => {
		const doc = new DocumentGraph();
		addBlock(doc, 'b1');
		assertOrderInvariant(doc);
		addBlock(doc, 'b2', 'heading', 0);
		assertOrderInvariant(doc);
		addBlock(doc, 'b3', 'sheet', 1);
		assertOrderInvariant(doc);
		must(applyMutation(doc, { op: 'blockOp', action: 'move', blockId: 'b1', position: 0 }, HUMAN));
		assertOrderInvariant(doc);
		must(applyMutation(doc, { op: 'blockOp', action: 'remove', blockId: 'b2' }, HUMAN));
		assertOrderInvariant(doc);
		must(
			applyMutation(
				doc,
				{ op: 'blockOp', action: 'update', blockId: 'b3', block: { univerSnapshot: { v: 2 } } },
				HUMAN
			)
		);
		assertOrderInvariant(doc);
		while (doc.undoCursor > 0) {
			must(undo(doc));
			assertOrderInvariant(doc);
		}
		while (doc.undoCursor < doc.undoLog.length) {
			must(redo(doc));
			assertOrderInvariant(doc);
		}
	});
});

describe('cycle rejection at mutation time', () => {
	it('self-reference', () => {
		const doc = new DocumentGraph();
		addComputed(doc, 'x', 'A1', '=1');
		const before = snap(doc);
		const r = applyMutation(doc, { op: 'setFormula', id: 'x', formula: ast('=A1') }, HUMAN);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error.cycle).toEqual(['x']);
			expect(r.error.message).toContain('x');
		}
		expect(snap(doc)).toEqual(before);
	});

	it('direct cycle lists both members', () => {
		const doc = new DocumentGraph();
		addComputed(doc, 'x', 'A1', '=1');
		addComputed(doc, 'y', 'B1', '=A1+1');
		const r = applyMutation(doc, { op: 'setFormula', id: 'x', formula: ast('=B1') }, HUMAN);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(new Set(r.error.cycle)).toEqual(new Set(['x', 'y']));
			expect(r.error.message).toContain('x');
			expect(r.error.message).toContain('y');
		}
	});

	it('transitive cycle lists all members', () => {
		const doc = new DocumentGraph();
		addComputed(doc, 'x', 'A1', '=1');
		addComputed(doc, 'y', 'B1', '=A1+1');
		addComputed(doc, 'z', 'C1', '=B1*2');
		const r = applyMutation(doc, { op: 'setFormula', id: 'x', formula: ast('=C1') }, HUMAN);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(new Set(r.error.cycle)).toEqual(new Set(['x', 'y', 'z']));
	});
});

describe('publishName + dotted-name resolution', () => {
	it('a formula referencing beam.span gains the edge when published; re-publish rebinds', () => {
		const doc = new DocumentGraph();
		addInput(doc, 'a', 'A1');
		addInput(doc, 'b', 'B1', 7);
		addComputed(doc, 'w', 'C1', '=beam.span * 2');
		expect(doc.nodes.get('w')?.value).toMatchObject({ kind: 'error', code: '#NAME?' });
		expect(doc.nodes.get('w')?.inputs).toEqual([]);

		const affected = must(
			applyMutation(doc, { op: 'publishName', cellRef: cell('A1'), name: 'beam.span' }, HUMAN)
		);
		const namedId = doc.resolveRef({ name: 'beam.span' }) as string;
		expect(affected).toContain(namedId);
		expect(affected).toContain('w');
		expect(doc.nodes.get(namedId)?.kind).toBe('namedOutput');
		expect(doc.nodes.get(namedId)?.inputs).toEqual(['a']);
		expect(doc.nodes.get('w')?.inputs).toEqual([namedId]);

		const rebound = must(
			applyMutation(doc, { op: 'publishName', cellRef: cell('B1'), name: 'beam.span' }, HUMAN)
		);
		expect(rebound).toEqual([namedId]);
		expect(doc.nodes.get(namedId)?.inputs).toEqual(['b']);
		expect(doc.nodes.get('w')?.inputs).toEqual([namedId]); // edge unchanged
	});
});
