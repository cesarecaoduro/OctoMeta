import { v } from 'convex/values';
import { internal } from './_generated/api';
import { action, internalMutation, mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireOwnerId, requireProductWritable } from './documents';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ABANDONED_AFTER_MS = 60 * 60 * 1_000;
const DELETE_BATCH = 50;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** Generate a short-lived upload URL for an authenticated user. */
export const generateUploadUrl = mutation({
	args: {},
	handler: async (ctx) => {
		await requireProductWritable(ctx);
		await requireOwnerId(ctx);
		return await ctx.storage.generateUploadUrl();
	}
});

/**
 * Validate uploaded bytes from Convex's system metadata and claim them for
 * exactly one live owned document. Unsupported bytes are deleted immediately.
 */
export const claimUpload = action({
	args: { docId: v.id('documents'), storageId: v.id('_storage') },
	handler: async (ctx, { docId, storageId }): Promise<string> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity?.subject) throw new Error('UNAUTHENTICATED');
		const bytes = await ctx.storage.get(storageId);
		if (!bytes) throw new Error('UPLOAD_NOT_FOUND');
		if (bytes.size > MAX_IMAGE_BYTES) {
			await ctx.storage.delete(storageId);
			throw new Error('IMAGE_TOO_LARGE');
		}
		const detectedType = await detectImageType(bytes);
		const declaredType = bytes.type || detectedType || '';
		if (
			!detectedType ||
			!IMAGE_TYPES.has(declaredType) ||
			(bytes.type !== '' && bytes.type !== detectedType)
		) {
			await ctx.storage.delete(storageId);
			throw new Error('UNSUPPORTED_IMAGE_TYPE');
		}
		return await ctx.runMutation(internal.assetClaims.claimValidated, {
			ownerId: identity.subject,
			docId,
			storageId,
			contentType: detectedType,
			size: bytes.size
		});
	}
});

async function detectImageType(blob: Blob): Promise<string | null> {
	const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
	const starts = (...signature: number[]): boolean =>
		signature.every((byte, index) => bytes[index] === byte);
	if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
	if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
	const text = String.fromCharCode(...bytes);
	if (text.startsWith('GIF87a') || text.startsWith('GIF89a')) return 'image/gif';
	if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') return 'image/webp';
	return null;
}

/** Resolve a claimed asset only for its live document owner. */
export const getUrl = query({
	args: { storageId: v.id('_storage') },
	handler: async (ctx, { storageId }) => {
		const ownerId = await requireOwnerId(ctx);
		const asset = await ctx.db
			.query('assets')
			.withIndex('by_storage', (q) => q.eq('storageId', storageId))
			.unique();
		if (!asset || asset.ownerId !== ownerId || asset.state !== 'claimed' || !asset.docId) {
			return null;
		}
		const document = await ctx.db.get(asset.docId);
		if (!document || document.ownerId !== ownerId || document.deletedAt !== undefined) return null;
		return await ctx.storage.getUrl(storageId);
	}
});

/**
 * Retry pending storage deletion and discover uploads claimed but never
 * referenced by a persisted active/undo block. Every pass is bounded.
 */
export const cleanupAssets = internalMutation({
	args: {},
	handler: async (ctx) => {
		await requireProductWritable(ctx);
		const now = Date.now();
		const pending = await ctx.db
			.query('assets')
			.withIndex('by_state_next', (q) =>
				q.eq('state', 'pendingDeletion').lte('nextAttemptAt', now)
			)
			.take(DELETE_BATCH);
		for (const asset of pending) {
			try {
				await ctx.storage.delete(asset.storageId);
				await ctx.db.delete(asset._id);
			} catch (cause) {
				const attempts = asset.deleteAttempts + 1;
				await ctx.db.patch(asset._id, {
					deleteAttempts: attempts,
					lastError: String(cause).slice(0, 500),
					nextAttemptAt: now + Math.min(24 * 60 * 60 * 1_000, 2 ** attempts * 60_000)
				});
			}
		}

		const abandoned = await ctx.db
			.query('assets')
			.withIndex('by_state_created', (q) =>
				q.eq('state', 'claimed').lt('createdAt', now - ABANDONED_AFTER_MS)
			)
			.take(DELETE_BATCH);
		for (const asset of abandoned) {
			if (!asset.docId || !(await assetIsReachable(ctx, asset.docId, asset.storageId))) {
				await ctx.db.patch(asset._id, {
					state: 'pendingDeletion',
					pendingDeletionAt: now,
					nextAttemptAt: now
				});
			}
		}

		if (pending.length === DELETE_BATCH || abandoned.length === DELETE_BATCH) {
			await ctx.scheduler.runAfter(0, internal.files.cleanupAssets, {});
		}
		return { retried: pending.length, inspected: abandoned.length };
	}
});

async function assetIsReachable(
	ctx: MutationCtx,
	docId: Id<'documents'>,
	storageId: string
): Promise<boolean> {
	const blocks = await ctx.db
		.query('blocks')
		.withIndex('by_doc', (q) => q.eq('docId', docId))
		.collect();
	if (blocks.some((block) => block.image?.storageId === storageId)) return true;
	const undo = await ctx.db
		.query('undoLog')
		.withIndex('by_doc_seq', (q) => q.eq('docId', docId))
		.collect();
	return undo.some((entry) => containsStorageId(entry, storageId));
}

function containsStorageId(value: unknown, storageId: string): boolean {
	if (!value || typeof value !== 'object') return false;
	if (Array.isArray(value)) return value.some((item) => containsStorageId(item, storageId));
	const record = value as Record<string, unknown>;
	if (record.storageId === storageId) return true;
	return Object.values(record).some((item) => containsStorageId(item, storageId));
}
