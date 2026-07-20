/**
 * Sheet snapshot persistence wiring (V1-5-2). Each sheet block's Univer
 * snapshot (`IWorkbookData`) persists to the `sheetSnapshots` table on the
 * SAME debounced cadence as the document save: the page decorates its
 * `Persistence.saveDocument` with `flushChanged`, so snapshot writes ride the
 * saver's dirty/flush lifecycle (kill-the-tab safety included) and never need
 * their own timer.
 *
 * Change detection is content-based (engine `stableStringify`), so repeated
 * saves of an untouched sheet cost one string compare, not a Convex write.
 * Pure TypeScript — unit-tested in node without Univer or Convex.
 */

import { stableStringify } from '../engine';

/** One sheet block's current snapshot, as collected from the live grids. */
export interface SheetSnapshotEntry {
	blockId: string;
	snapshot: unknown;
}

export interface SheetSnapshotSaver {
	/**
	 * Upsert every entry whose snapshot content changed since its last
	 * successful flush. Rejects if any upsert fails (the document saver then
	 * keeps its dirty flag and retries); failed entries stay marked dirty.
	 */
	flushChanged(entries: SheetSnapshotEntry[]): Promise<void>;
	/** Forget change-tracking state (a re-load starts fresh). */
	reset(): void;
}

/**
 * Create a snapshot saver over one upsert function (the persistence facade's
 * `upsertSheetSnapshot`, bound to a document).
 */
export function createSheetSnapshotSaver(
	upsert: (blockId: string, snapshot: unknown) => Promise<void>
): SheetSnapshotSaver {
	/** blockId → stableStringify of the last successfully persisted snapshot. */
	const persisted = new Map<string, string>();
	return {
		async flushChanged(entries) {
			const changed = entries
				.map((entry) => ({ ...entry, key: stableStringify(entry.snapshot) }))
				.filter((entry) => persisted.get(entry.blockId) !== entry.key);
			await Promise.all(
				changed.map(async (entry) => {
					await upsert(entry.blockId, entry.snapshot);
					persisted.set(entry.blockId, entry.key);
				})
			);
		},
		reset() {
			persisted.clear();
		}
	};
}
