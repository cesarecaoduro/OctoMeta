import { v } from 'convex/values';
import { mutation } from './_generated/server';
import { chipBindingFields } from './schema';

/**
 * Chip-binding persistence (SCHEMA.md §8/§10). The debounced full save
 * (documents.save) also writes chips; these targeted upserts exist for
 * interactive chip edits between full saves (V1-5-3).
 */

/** Insert or update one chip binding, keyed by docId + engine chip id. */
export const upsert = mutation({
	args: chipBindingFields,
	handler: async (ctx, { docId, chipId, blockId, nodeId, format }) => {
		if (!(await ctx.db.get(docId))) throw new Error(`Unknown document "${docId}"`);
		const existing = await ctx.db
			.query('chipBindings')
			.withIndex('by_doc_chip', (q) => q.eq('docId', docId).eq('chipId', chipId))
			.unique();
		if (existing) {
			await ctx.db.patch(existing._id, { blockId, nodeId, format });
		} else {
			await ctx.db.insert('chipBindings', { docId, chipId, blockId, nodeId, format });
		}
	}
});

/** Delete one chip binding. Missing bindings are a no-op (delete is idempotent). */
export const remove = mutation({
	args: { docId: v.id('documents'), chipId: v.string() },
	handler: async (ctx, { docId, chipId }) => {
		const existing = await ctx.db
			.query('chipBindings')
			.withIndex('by_doc_chip', (q) => q.eq('docId', docId).eq('chipId', chipId))
			.unique();
		if (existing) await ctx.db.delete(existing._id);
	}
});
