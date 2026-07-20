import { v } from 'convex/values';
import { mutation } from './_generated/server';

/**
 * Sheet snapshot persistence (SCHEMA.md §10). One row per sheet block, keyed
 * by the engine BlockId; the Univer adapter saves through
 * src/lib/persistence on its own cadence, separate from the graph save.
 */

/** Insert or update the Univer snapshot for a sheet block. */
export const upsertSnapshot = mutation({
	args: {
		docId: v.id('documents'),
		blockId: v.string(),
		univerSnapshot: v.any()
	},
	handler: async (ctx, { docId, blockId, univerSnapshot }) => {
		if (!(await ctx.db.get(docId))) throw new Error(`Unknown document "${docId}"`);
		const existing = await ctx.db
			.query('sheetSnapshots')
			.withIndex('by_block', (q) => q.eq('blockId', blockId))
			.unique();
		const updatedAt = Date.now();
		if (existing) {
			await ctx.db.patch(existing._id, { univerSnapshot, updatedAt });
		} else {
			await ctx.db.insert('sheetSnapshots', { docId, blockId, univerSnapshot, updatedAt });
		}
	}
});
