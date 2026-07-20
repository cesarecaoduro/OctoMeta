import type { IWorkbookData } from '@univerjs/presets';

/**
 * In-memory workbook snapshot store keyed by sheet block id. Promoted from the
 * V1-0-2 spike (docs/v1-0-findings.md): a host that unmounts a sheet (block
 * move, teardown) saves its snapshot here and the next mount rehydrates from
 * it, because a live Univer instance cannot survive a DOM remount.
 *
 * This is the in-session stand-in for the `sheetSnapshots` table (SCHEMA.md
 * §10); V1-4-1 persistence flushes it to Convex, V1-5-2 wires it into canvas
 * NodeViews.
 */
export const sheetStore = new Map<string, IWorkbookData>();

/**
 * Seed the store from persisted `sheetSnapshots` rows before sheet NodeViews
 * mount (V1-5-2 load path). Takes `unknown` snapshots so callers outside this
 * directory never need `@univerjs` types (IMPLEMENTATION_PLAN.md §11 rule 2).
 */
export function seedSheetStore(entries: { blockId: string; snapshot: unknown }[]): void {
	for (const { blockId, snapshot } of entries) {
		if (snapshot) sheetStore.set(blockId, snapshot as IWorkbookData);
	}
}
