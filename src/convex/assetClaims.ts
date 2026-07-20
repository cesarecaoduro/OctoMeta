import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import { requireProductWritable } from './documents';

/** Complete a byte-validated asset claim inside one database transaction. */
export const claimValidated = internalMutation({
	args: {
		ownerId: v.string(),
		docId: v.id('documents'),
		storageId: v.id('_storage'),
		contentType: v.string(),
		size: v.number()
	},
	handler: async (ctx, { ownerId, docId, storageId, contentType, size }) => {
		await requireProductWritable(ctx);
		const document = await ctx.db.get(docId);
		if (!document) throw new Error('NOT_FOUND');
		if (document.ownerId !== ownerId) throw new Error('UNAUTHORIZED');
		if (document.deletedAt !== undefined) throw new Error('DOCUMENT_TRASHED');
		const metadata = await ctx.db.system.get('_storage', storageId);
		if (!metadata || metadata.size !== size) throw new Error('UPLOAD_METADATA_CHANGED');
		const existing = await ctx.db
			.query('assets')
			.withIndex('by_storage', (q) => q.eq('storageId', storageId))
			.unique();
		if (existing) {
			if (existing.ownerId !== ownerId || existing.docId !== docId) {
				throw new Error('ASSET_ALREADY_CLAIMED');
			}
			return existing._id;
		}
		const now = Date.now();
		return await ctx.db.insert('assets', {
			storageId,
			ownerId,
			docId,
			contentType,
			size,
			state: 'claimed',
			createdAt: now,
			claimedAt: now,
			deleteAttempts: 0
		});
	}
});
