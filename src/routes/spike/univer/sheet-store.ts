import type { IWorkbookData } from '@univerjs/presets';

/**
 * In-memory snapshot store keyed by sheet id (`sid`).
 *
 * A TipTap NodeView is destroyed and recreated whenever its block moves, so the
 * live Univer workbook cannot survive a move. The view saves its snapshot here
 * on destroy and rehydrates from here on create; serialization flushes this map
 * into node attrs. This is the spike-scale stand-in for the `sheetSnapshots`
 * table planned in V1-4-1.
 */
export const sheetStore = new Map<string, IWorkbookData>();
