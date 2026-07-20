import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

/**
 * Convex file storage for image blocks (SCHEMA.md §8: `image.storageId`).
 * Upload flow (standard Convex pattern): the client asks for a short-lived
 * upload URL, POSTs the file bytes to it, and stores the returned storageId in
 * the block's `image` payload. Serving goes through `getUrl`. Files are
 * deleted with their document (`documents.remove`).
 */

/** Generate a short-lived URL the client POSTs file bytes to. */
export const generateUploadUrl = mutation({
	args: {},
	handler: async (ctx) => {
		return await ctx.storage.generateUploadUrl();
	}
});

/** Resolve a stored file to a serving URL, or null when it no longer exists. */
export const getUrl = query({
	args: { storageId: v.id('_storage') },
	handler: async (ctx, { storageId }) => {
		return await ctx.storage.getUrl(storageId);
	}
});
