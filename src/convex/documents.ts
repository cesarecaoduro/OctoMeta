import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { blockFields, chipBindingFields, graphNodeFields, undoLogFields } from './schema';

/**
 * Document persistence (SCHEMA.md §10) — single-user V1: no auth, no conflict
 * handling. Save is a full wipe-and-replace of every per-document row plus a
 * patch of the document header; the client debounces (src/lib/persistence),
 * so this stays simple until it hurts (V2-6 optimizes).
 */

/** The undo log keeps at most this many entries per document (SCHEMA.md §9). */
export const UNDO_CAP = 200;

/** Payload field validators shared by `save` (rows arrive without `docId`; it is injected server-side). */
const omitDocId = <T extends { docId: unknown }>(fields: T): Omit<T, 'docId'> => {
	const { docId: _docId, ...rest } = fields;
	return rest;
};

const nodeArg = v.object(omitDocId(graphNodeFields));
const blockArg = v.object(omitDocId(blockFields));
const undoArg = v.object(omitDocId(undoLogFields));
const chipArg = v.object(omitDocId(chipBindingFields));

/** Create an empty document. Returns its id. */
export const create = mutation({
	args: { title: v.string() },
	handler: async (ctx, { title }) => {
		const now = Date.now();
		return await ctx.db.insert('documents', {
			title,
			blocksOrder: [],
			undoCursor: 0,
			createdAt: now,
			updatedAt: now
		});
	}
});

/** List all documents, most recently updated first. */
export const list = query({
	args: {},
	handler: async (ctx) => {
		const docs = await ctx.db.query('documents').collect();
		return docs.sort((a, b) => b.updatedAt - a.updatedAt);
	}
});

/** Rename a document. */
export const rename = mutation({
	args: { docId: v.id('documents'), title: v.string() },
	handler: async (ctx, { docId, title }) => {
		await requireDoc(ctx, docId);
		await ctx.db.patch(docId, { title, updatedAt: Date.now() });
	}
});

/** Delete a document and every row that belongs to it, including stored image files. */
export const remove = mutation({
	args: { docId: v.id('documents') },
	handler: async (ctx, { docId }) => {
		await requireDoc(ctx, docId);
		// Free image-block files before their rows disappear (V1-5-1). Missing
		// files (already deleted, foreign ids) must not block document deletion.
		for (const block of await ctx.db
			.query('blocks')
			.withIndex('by_doc', (q) => q.eq('docId', docId))
			.collect()) {
			if (block.image?.storageId) {
				try {
					await ctx.storage.delete(block.image.storageId as Id<'_storage'>);
				} catch {
					// tolerated: the file may already be gone
				}
			}
		}
		await deleteDocRows(ctx, docId);
		for (const row of await ctx.db
			.query('sheetSnapshots')
			.withIndex('by_doc', (q) => q.eq('docId', docId))
			.collect()) {
			await ctx.db.delete(row._id);
		}
		await ctx.db.delete(docId);
	}
});

/**
 * Full save: replace the document's graph nodes, blocks, chip bindings, and
 * undo log wholesale, and patch the header (blocksOrder, undoCursor,
 * updatedAt). The undo log is pruned server-side to the last `UNDO_CAP`
 * entries by `seq` (the engine caps client-side too — this is the backstop).
 * Sheet snapshots are saved separately (`sheets.upsertSnapshot`).
 */
export const save = mutation({
	args: {
		docId: v.id('documents'),
		blocksOrder: v.array(v.string()),
		undoCursor: v.number(),
		nodes: v.array(nodeArg),
		blocks: v.array(blockArg),
		undoLog: v.array(undoArg),
		chips: v.array(chipArg)
	},
	handler: async (ctx, { docId, blocksOrder, undoCursor, nodes, blocks, undoLog, chips }) => {
		await requireDoc(ctx, docId);
		await deleteDocRows(ctx, docId);
		for (const node of nodes) await ctx.db.insert('graphNodes', { docId, ...node });
		for (const block of blocks) await ctx.db.insert('blocks', { docId, ...block });
		const kept = [...undoLog].sort((a, b) => a.seq - b.seq).slice(-UNDO_CAP);
		for (const entry of kept) await ctx.db.insert('undoLog', { docId, ...entry });
		for (const chip of chips) await ctx.db.insert('chipBindings', { docId, ...chip });
		await ctx.db.patch(docId, { blocksOrder, undoCursor, updatedAt: Date.now() });
	}
});

/** Load every row of a document: header, nodes, blocks, undo log (seq order), chips, sheet snapshots. */
export const load = query({
	args: { docId: v.id('documents') },
	handler: async (ctx, { docId }) => {
		const document = await ctx.db.get(docId);
		if (!document) return null;
		return {
			document,
			nodes: await ctx.db
				.query('graphNodes')
				.withIndex('by_doc', (q) => q.eq('docId', docId))
				.collect(),
			blocks: await ctx.db
				.query('blocks')
				.withIndex('by_doc', (q) => q.eq('docId', docId))
				.collect(),
			undoLog: await ctx.db
				.query('undoLog')
				.withIndex('by_doc_seq', (q) => q.eq('docId', docId))
				.collect(),
			chips: await ctx.db
				.query('chipBindings')
				.withIndex('by_doc', (q) => q.eq('docId', docId))
				.collect(),
			sheetSnapshots: await ctx.db
				.query('sheetSnapshots')
				.withIndex('by_doc', (q) => q.eq('docId', docId))
				.collect()
		};
	}
});

/** Throw if the document does not exist (mutations should not silently no-op). */
async function requireDoc(ctx: MutationCtx, docId: Id<'documents'>): Promise<void> {
	if (!(await ctx.db.get(docId))) throw new Error(`Unknown document "${docId}"`);
}

/** Delete every graphNodes/blocks/undoLog/chipBindings row of a document. */
async function deleteDocRows(ctx: MutationCtx, docId: Id<'documents'>): Promise<void> {
	for (const table of ['graphNodes', 'blocks', 'chipBindings'] as const) {
		for (const row of await ctx.db
			.query(table)
			.withIndex('by_doc', (q) => q.eq('docId', docId))
			.collect()) {
			await ctx.db.delete(row._id);
		}
	}
	for (const row of await ctx.db
		.query('undoLog')
		.withIndex('by_doc_seq', (q) => q.eq('docId', docId))
		.collect()) {
		await ctx.db.delete(row._id);
	}
}
