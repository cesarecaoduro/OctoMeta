import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentGraph } from '../engine';
import type { DocumentId } from './client';
import type { SaveState } from './saver';
import { createDocumentSaver } from './saver';

const DOC_ID = 'doc123' as DocumentId;

function makeFake(impl?: () => Promise<void>) {
	const calls: DocumentGraph[] = [];
	return {
		calls,
		persistence: {
			saveDocument: vi.fn(async (_id: DocumentId, graph: DocumentGraph) => {
				calls.push(graph);
				await (impl?.() ?? Promise.resolve());
			})
		}
	};
}

describe('createDocumentSaver', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('debounces: many scheduleSave calls coalesce into one save after the delay', async () => {
		const graph = new DocumentGraph();
		const { persistence } = makeFake();
		const saver = createDocumentSaver(persistence, DOC_ID, graph, { delayMs: 100 });
		saver.scheduleSave();
		saver.scheduleSave();
		await vi.advanceTimersByTimeAsync(50);
		expect(persistence.saveDocument).not.toHaveBeenCalled();
		saver.scheduleSave(); // resets the quiet period
		await vi.advanceTimersByTimeAsync(99);
		expect(persistence.saveDocument).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(persistence.saveDocument).toHaveBeenCalledTimes(1);
		expect(persistence.saveDocument).toHaveBeenCalledWith(DOC_ID, graph);
		expect(saver.state).toBe('idle');
	});

	it('flush saves immediately without waiting for the debounce', async () => {
		const graph = new DocumentGraph();
		const { persistence } = makeFake();
		const saver = createDocumentSaver(persistence, DOC_ID, graph, { delayMs: 10_000 });
		saver.scheduleSave();
		await saver.flush();
		expect(persistence.saveDocument).toHaveBeenCalledTimes(1);
		// The cancelled timer must not fire a second save.
		await vi.advanceTimersByTimeAsync(20_000);
		expect(persistence.saveDocument).toHaveBeenCalledTimes(1);
	});

	it('flush with nothing pending is a no-op', async () => {
		const { persistence } = makeFake();
		const saver = createDocumentSaver(persistence, DOC_ID, new DocumentGraph(), { delayMs: 100 });
		await saver.flush();
		expect(persistence.saveDocument).not.toHaveBeenCalled();
	});

	it('edits during an in-flight save trigger a follow-up save', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const { persistence } = makeFake(() => gate);
		const saver = createDocumentSaver(persistence, DOC_ID, new DocumentGraph(), { delayMs: 100 });
		saver.scheduleSave();
		await vi.advanceTimersByTimeAsync(100);
		expect(persistence.saveDocument).toHaveBeenCalledTimes(1);
		expect(saver.state).toBe('saving');
		saver.scheduleSave(); // edit arrives mid-save
		release();
		await saver.flush();
		expect(persistence.saveDocument).toHaveBeenCalledTimes(2);
		expect(saver.state).toBe('idle');
	});

	it('reports states in order pending → saving → idle', async () => {
		const states: SaveState[] = [];
		const { persistence } = makeFake();
		const saver = createDocumentSaver(persistence, DOC_ID, new DocumentGraph(), {
			delayMs: 100,
			onState: (s) => states.push(s)
		});
		saver.scheduleSave();
		await vi.advanceTimersByTimeAsync(100);
		expect(states).toEqual(['pending', 'saving', 'idle']);
	});

	it('a failed save surfaces error state, keeps the work dirty, and retries', async () => {
		let fail = true;
		const persistence = {
			saveDocument: vi.fn(async () => {
				if (fail) throw new Error('offline');
			})
		};
		const saver = createDocumentSaver(persistence, DOC_ID, new DocumentGraph(), { delayMs: 100 });
		saver.scheduleSave();
		await vi.advanceTimersByTimeAsync(100);
		expect(saver.state).toBe('error');
		expect(saver.lastError).toBeInstanceOf(Error);
		fail = false;
		await saver.flush(); // retry succeeds
		expect(persistence.saveDocument).toHaveBeenCalledTimes(2);
		expect(saver.state).toBe('idle');
		expect(saver.lastError).toBeNull();
	});

	it('dispose cancels pending saves for good', async () => {
		const { persistence } = makeFake();
		const saver = createDocumentSaver(persistence, DOC_ID, new DocumentGraph(), { delayMs: 100 });
		saver.scheduleSave();
		saver.dispose();
		await vi.advanceTimersByTimeAsync(1_000);
		saver.scheduleSave();
		await vi.advanceTimersByTimeAsync(1_000);
		await saver.flush();
		expect(persistence.saveDocument).not.toHaveBeenCalled();
	});
});
