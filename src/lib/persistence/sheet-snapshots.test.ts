import { describe, expect, it, vi } from 'vitest';
import { createSheetSnapshotSaver } from './sheet-snapshots';

/**
 * V1-5-2 — snapshot⇄saver wiring (pure logic). The saver upserts only content
 * that actually changed since its last successful flush, and failures leave
 * the entry dirty so the document saver's retry picks it up.
 */

describe('createSheetSnapshotSaver', () => {
	it('upserts every entry on first flush', async () => {
		const upsert = vi.fn(async () => {});
		const saver = createSheetSnapshotSaver(upsert);
		await saver.flushChanged([
			{ blockId: 'a', snapshot: { id: 'a', v: 1 } },
			{ blockId: 'b', snapshot: { id: 'b', v: 2 } }
		]);
		expect(upsert).toHaveBeenCalledTimes(2);
		expect(upsert).toHaveBeenCalledWith('a', { id: 'a', v: 1 });
		expect(upsert).toHaveBeenCalledWith('b', { id: 'b', v: 2 });
	});

	it('skips unchanged snapshots on later flushes (content-based, key order irrelevant)', async () => {
		const upsert = vi.fn(async () => {});
		const saver = createSheetSnapshotSaver(upsert);
		await saver.flushChanged([{ blockId: 'a', snapshot: { x: 1, y: 2 } }]);
		// Same content, different key order: stableStringify makes them equal.
		await saver.flushChanged([{ blockId: 'a', snapshot: { y: 2, x: 1 } }]);
		expect(upsert).toHaveBeenCalledTimes(1);
	});

	it('re-upserts when the snapshot content changed', async () => {
		const upsert = vi.fn(async () => {});
		const saver = createSheetSnapshotSaver(upsert);
		await saver.flushChanged([{ blockId: 'a', snapshot: { v: 1 } }]);
		await saver.flushChanged([{ blockId: 'a', snapshot: { v: 2 } }]);
		expect(upsert).toHaveBeenCalledTimes(2);
		expect(upsert).toHaveBeenLastCalledWith('a', { v: 2 });
	});

	it('rejects on upsert failure and keeps the failed entry dirty for retry', async () => {
		const upsert = vi
			.fn<(blockId: string, snapshot: unknown) => Promise<void>>()
			.mockRejectedValueOnce(new Error('offline'))
			.mockResolvedValue(undefined);
		const saver = createSheetSnapshotSaver(upsert);
		await expect(saver.flushChanged([{ blockId: 'a', snapshot: { v: 1 } }])).rejects.toThrow(
			'offline'
		);
		// Retry (document saver keeps its dirty flag): the entry flushes now.
		await saver.flushChanged([{ blockId: 'a', snapshot: { v: 1 } }]);
		expect(upsert).toHaveBeenCalledTimes(2);
	});

	it('a failed sibling does not mark successful entries dirty again', async () => {
		const upsert = vi
			.fn<(blockId: string, snapshot: unknown) => Promise<void>>()
			.mockImplementation(async (blockId) => {
				if (blockId === 'bad') throw new Error('boom');
			});
		const saver = createSheetSnapshotSaver(upsert);
		const entries = [
			{ blockId: 'good', snapshot: { v: 1 } },
			{ blockId: 'bad', snapshot: { v: 1 } }
		];
		await expect(saver.flushChanged(entries)).rejects.toThrow('boom');
		upsert.mockClear();
		upsert.mockResolvedValue(undefined);
		await saver.flushChanged(entries);
		// Only the failed one retries; the successful one was recorded.
		expect(upsert).toHaveBeenCalledTimes(1);
		expect(upsert).toHaveBeenCalledWith('bad', { v: 1 });
	});

	it('reset forgets change tracking (a re-load starts fresh)', async () => {
		const upsert = vi.fn(async () => {});
		const saver = createSheetSnapshotSaver(upsert);
		await saver.flushChanged([{ blockId: 'a', snapshot: { v: 1 } }]);
		saver.reset();
		await saver.flushChanged([{ blockId: 'a', snapshot: { v: 1 } }]);
		expect(upsert).toHaveBeenCalledTimes(2);
	});
});
