import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor, GraphMutation } from '../engine';
import { DocumentGraph, commit, commitUndo, createBuiltinRegistry } from '../engine';
import { buildBeamFixture } from '../persistence/fixtures';
import type { PMJson } from './blocks';
import type { SyncHost } from './sync';
import { createBlockSync } from './sync';

const HUMAN: Actor = { kind: 'human' };

/** A real-engine host with an injectable evaluate spy and deterministic ids. */
function makeHost(graph = new DocumentGraph()) {
	const registry = createBuiltinRegistry();
	const evaluate = vi.fn(() => ({ kind: 'scalar', value: 0 }) as const);
	let n = 0;
	const host: SyncHost = {
		docId: 'doc1',
		order: () => graph.blocksOrder,
		block: (id) => graph.blocks.get(id),
		commit: (m: GraphMutation) => commit(graph, m, HUMAN, { registry, evaluate }).ok,
		newBlockId: () => `blk-${++n}`
	};
	return { graph, host, evaluate };
}

const para = (text: string, blockId?: string | null): PMJson => ({
	type: 'paragraph',
	...(blockId !== undefined ? { attrs: { blockId } } : {}),
	...(text === '' ? {} : { content: [{ type: 'text', text }] })
});

const doc = (...content: PMJson[]): PMJson => ({ type: 'doc', content });

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

describe('reconcile: structure', () => {
	it('assigns ids to fresh nodes and commits blockOp add', () => {
		const { graph, host } = makeHost();
		const sync = createBlockSync(host);
		const assigned = sync.reconcile(doc(para('hello', null)));
		expect([...assigned]).toEqual([[0, 'blk-1']]);
		expect(graph.blocksOrder).toEqual(['blk-1']);
		expect(graph.blocks.get('blk-1')).toMatchObject({
			type: 'text',
			docId: 'doc1',
			pm: { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }
		});
		// The add went through applyMutation: it is in the undo log.
		expect(graph.undoLog.at(-1)?.mutation).toMatchObject({ op: 'blockOp', action: 'add' });
	});

	it('treats an Enter split (second node unassigned) as one new block', () => {
		const { graph, host } = makeHost();
		const sync = createBlockSync(host);
		sync.reconcile(doc(para('one', null)));
		sync.reconcile(doc(para('one', 'blk-1'), para('two', null)));
		expect(graph.blocksOrder).toEqual(['blk-1', 'blk-2']);
		expect(graph.blocks.get('blk-2')?.pm).toMatchObject({
			content: [{ type: 'text', text: 'two' }]
		});
	});

	it('mints a fresh id for a duplicated blockId (copy/paste)', () => {
		const { graph, host } = makeHost();
		const sync = createBlockSync(host);
		sync.reconcile(doc(para('one', null)));
		const assigned = sync.reconcile(doc(para('one', 'blk-1'), para('one', 'blk-1')));
		expect(assigned.get(1)).toBe('blk-2');
		expect(graph.blocksOrder).toEqual(['blk-1', 'blk-2']);
	});

	it('removes blocks that vanished from the doc; engine undo restores them', () => {
		const { graph, host } = makeHost();
		const registry = createBuiltinRegistry();
		const sync = createBlockSync(host);
		sync.reconcile(doc(para('one', null), para('two', null)));
		sync.flush();
		sync.reconcile(doc(para('one', 'blk-1')));
		expect(graph.blocksOrder).toEqual(['blk-1']);
		// Undo spans block ops: the remove is one engine history entry.
		const r = commitUndo(graph, { registry });
		expect(r.ok).toBe(true);
		expect(graph.blocksOrder).toEqual(['blk-1', 'blk-2']);
		expect(graph.blocks.get('blk-2')?.pm).toMatchObject({
			content: [{ type: 'text', text: 'two' }]
		});
	});

	it('moves equations and prose with absolute blocksOrder positions', () => {
		const { graph, host } = makeHost();
		host.commit({
			op: 'blockOp',
			action: 'add',
			blockId: 'blk-equation',
			block: {
				docId: 'doc1',
				type: 'equation',
				equation: { mode: 'static', tex: 'x = 1' }
			}
		});
		const sync = createBlockSync(host);
		const equation = (blockId: string): PMJson => ({
			type: 'equationBlock',
			attrs: {
				blockId,
				equation: { mode: 'static', tex: 'x = 1' }
			}
		});
		sync.reconcile(doc(equation('blk-equation'), para('a', null), para('b', null)));
		expect(graph.blocksOrder).toEqual(['blk-equation', 'blk-1', 'blk-2']);
		sync.reconcile(doc(para('a', 'blk-1'), equation('blk-equation'), para('b', 'blk-2')));
		expect(graph.blocksOrder).toEqual(['blk-1', 'blk-equation', 'blk-2']);
		expect(graph.blocksOrder.map((id) => graph.blocks.get(id)?.position)).toEqual([0, 1, 2]);
	});

	it('reorders via blockOp move and renumbers positions', () => {
		const { graph, host } = makeHost();
		const sync = createBlockSync(host);
		sync.reconcile(doc(para('a', null), para('b', null), para('c', null)));
		sync.reconcile(doc(para('c', 'blk-3'), para('a', 'blk-1'), para('b', 'blk-2')));
		expect(graph.blocksOrder).toEqual(['blk-3', 'blk-1', 'blk-2']);
		expect(graph.blocksOrder.map((id) => graph.blocks.get(id)?.position)).toEqual([0, 1, 2]);
	});

	it('commits a top-level type change as remove + add under the same id', () => {
		const { graph, host } = makeHost();
		const sync = createBlockSync(host);
		sync.reconcile(doc(para('title', null), para('body', null)));
		sync.reconcile(
			doc(
				{
					type: 'heading',
					attrs: { level: 1, blockId: 'blk-1' },
					content: [{ type: 'text', text: 'title' }]
				},
				para('body', 'blk-2')
			)
		);
		expect(graph.blocksOrder).toEqual(['blk-1', 'blk-2']);
		expect(graph.blocks.get('blk-1')).toMatchObject({
			type: 'heading',
			pm: { type: 'heading', attrs: { level: 1 } }
		});
	});
});

describe('reconcile: debounced content updates', () => {
	it('debounces prose keystrokes into one blockOp update', () => {
		const { graph, host } = makeHost();
		const sync = createBlockSync(host, { delayMs: 300 });
		sync.reconcile(doc(para('h', null)));
		const entries = () => graph.undoLog.length;
		const afterAdd = entries();
		sync.reconcile(doc(para('he', 'blk-1')));
		sync.reconcile(doc(para('hel', 'blk-1')));
		sync.reconcile(doc(para('hello', 'blk-1')));
		expect(entries()).toBe(afterAdd); // nothing committed yet
		expect(sync.hasPending()).toBe(true);
		vi.advanceTimersByTime(300);
		expect(entries()).toBe(afterAdd + 1); // one coalesced update
		expect(graph.blocks.get('blk-1')?.pm).toMatchObject({
			content: [{ type: 'text', text: 'hello' }]
		});
		expect(graph.undoLog.at(-1)?.mutation).toMatchObject({ op: 'blockOp', action: 'update' });
	});

	it('flush commits pending updates immediately', () => {
		const { graph, host } = makeHost();
		const sync = createBlockSync(host);
		sync.reconcile(doc(para('a', null)));
		sync.reconcile(doc(para('ab', 'blk-1')));
		sync.flush();
		expect(sync.hasPending()).toBe(false);
		expect(graph.blocks.get('blk-1')?.pm).toMatchObject({
			content: [{ type: 'text', text: 'ab' }]
		});
	});

	it('a structural change flushes pending content first (undo stays ordered)', () => {
		const { graph, host } = makeHost();
		const sync = createBlockSync(host);
		sync.reconcile(doc(para('a', null)));
		sync.reconcile(doc(para('ab', 'blk-1')));
		sync.reconcile(doc(para('ab', 'blk-1'), para('new', null)));
		const ops = graph.undoLog.map(
			(e) => `${(e.mutation as { action?: string }).action}:${(e.mutation as { blockId?: string }).blockId}`
		);
		expect(ops).toEqual(['add:blk-1', 'update:blk-1', 'add:blk-2']);
	});

	it('ignores the ephemeral trailing empty paragraph (landmine 3)', () => {
		const { graph, host } = makeHost();
		const sync = createBlockSync(host);
		// trailingNode appends an empty, unassigned paragraph after an atom block.
		sync.reconcile(doc(para('prose', null), para('', null)));
		expect(graph.blocksOrder).toEqual(['blk-1']);
		// Once it gains content it reconciles like any other block.
		sync.reconcile(doc(para('prose', 'blk-1'), para('now real', null)));
		expect(graph.blocksOrder).toEqual(['blk-1', 'blk-2']);
		// An empty unassigned paragraph in the MIDDLE is a real (empty) block.
		sync.reconcile(doc(para('prose', 'blk-1'), para('', null), para('now real', 'blk-2')));
		expect(graph.blocksOrder).toEqual(['blk-1', 'blk-3', 'blk-2']);
	});

	it('skips no-op updates (identical pm never commits)', () => {
		const { graph, host } = makeHost();
		const sync = createBlockSync(host);
		sync.reconcile(doc(para('same', null)));
		const before = graph.undoLog.length;
		sync.reconcile(doc(para('same', 'blk-1')));
		vi.advanceTimersByTime(1000);
		expect(graph.undoLog.length).toBe(before);
	});
});

describe('moves never trigger recalc (SCHEMA.md §5: position is layout-only)', () => {
	it('blockOp move on a live computed graph evaluates nothing', () => {
		// The beam fixture has inputs, computed cells, and published names.
		const { graph, registry } = buildBeamFixture();
		const evaluate = vi.fn(() => ({ kind: 'scalar', value: 0 }) as const);
		const r = commit(
			graph,
			{ op: 'blockOp', action: 'move', blockId: 'blk-beam-intro', position: 0 },
			HUMAN,
			{ registry, evaluate }
		);
		expect(r.ok && r.value.affected).toEqual([]);
		expect(r.ok && r.value.evaluated).toEqual([]);
		expect(evaluate).not.toHaveBeenCalled();
	});

	it('reordering through reconcile evaluates nothing either', () => {
		const { graph, host, evaluate } = makeHost();
		const sync = createBlockSync(host);
		sync.reconcile(doc(para('a', null), para('b', null)));
		evaluate.mockClear();
		sync.reconcile(doc(para('b', 'blk-2'), para('a', 'blk-1')));
		expect(evaluate).not.toHaveBeenCalled();
		expect(graph.blocksOrder).toEqual(['blk-2', 'blk-1']);
	});
});
