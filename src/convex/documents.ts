import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import type { Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { blockFields, chipBindingFields, graphNodeFields, undoLogFields } from './schema';
import {
	BUNDLE_BYTE_LIMIT,
	SNAPSHOT_BYTE_LIMIT,
	canonicalBytes,
	documentBundleHash,
	workbookSnapshotHash
} from '../lib/persistence/canonical';
import { isEquationPayload } from '../lib/engine';

/** Server-enforced document and history limits. */
export const UNDO_CAP = 200;
const DOCUMENT_CAP = 500;
const NODE_CAP = 5_000;
const BLOCK_CAP = 1_000;
const CHIP_CAP = 2_000;
const TAB_CAP = 32;
const TITLE_CAP = 120;
const TAB_NAME_CAP = 64;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

const omitDocId = <T extends { docId: unknown }>(fields: T): Omit<T, 'docId'> => {
	const { docId: _docId, ...rest } = fields;
	return rest;
};
const nodeArg = v.object(omitDocId(graphNodeFields));
const blockArg = v.object(omitDocId(blockFields));
const undoArg = v.object(omitDocId(undoLogFields));
const chipArg = v.object(omitDocId(chipBindingFields));
const manifestArg = v.object({
	sheets: v.array(v.object({ id: v.string(), name: v.string(), position: v.number() }))
});
const graphArg = v.object({
	blocksOrder: v.array(v.string()),
	undoCursor: v.number(),
	nodes: v.array(nodeArg),
	blocks: v.array(blockArg),
	undoLog: v.array(undoArg),
	chips: v.array(chipArg)
});

type ProductCtx = Pick<QueryCtx, 'auth' | 'db'> | Pick<MutationCtx, 'auth' | 'db'>;

/** Return the authenticated Better Auth subject or throw. */
export async function requireOwnerId(ctx: ProductCtx): Promise<string> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity?.subject) throw new Error('UNAUTHENTICATED');
	return identity.subject;
}

/** Refuse product writes while an administrative maintenance operation owns the lock. */
export async function requireProductWritable(ctx: ProductCtx): Promise<void> {
	const lock = await ctx.db
		.query('maintenance')
		.withIndex('by_key', (q) => q.eq('key', 'product-write-lock'))
		.unique();
	if (lock?.locked) throw new Error('MAINTENANCE_MODE');
}

/** Require a live document belonging to the authenticated owner. */
export async function requireLiveOwnedDocument(ctx: ProductCtx, documentId: string) {
	const ownerId = await requireOwnerId(ctx);
	const document = await resolveProductDocument(ctx, documentId);
	if (!document) throw new Error('NOT_FOUND');
	if (document.ownerId !== ownerId) throw new Error('UNAUTHORIZED');
	if (document.deletedAt !== undefined) throw new Error('DOCUMENT_TRASHED');
	return document;
}

/** Resolve a stable product document ID, with legacy Convex IDs accepted during transition. */
export async function resolveProductDocument(ctx: Pick<ProductCtx, 'db'>, documentId: string) {
	const publicRow = await ctx.db
		.query('documents')
		.withIndex('by_document_id', (index) => index.eq('documentId', documentId))
		.unique();
	if (publicRow) return publicRow;
	const legacyId = ctx.db.normalizeId('documents', documentId);
	return legacyId ? await ctx.db.get(legacyId) : null;
}

/** Create one owned document with an atomic default workbook at revision zero. */
export const create = mutation({
	args: { title: v.string() },
	handler: async (ctx, { title: rawTitle }) => {
		await requireProductWritable(ctx);
		const ownerId = await requireOwnerId(ctx);
		const title = validTitle(rawTitle);
		const owned = await ctx.db
			.query('documents')
			.withIndex('by_owner_deleted_updated', (q) => q.eq('ownerId', ownerId))
			.collect();
		if (owned.length >= DOCUMENT_CAP) throw new Error('DOCUMENT_LIMIT');
		const workbookManifest = {
			sheets: [{ id: 'sheet-1', name: 'Sheet 1', position: 0 }]
		};
		const graph = {
			blocksOrder: [],
			undoCursor: 0,
			nodes: [],
			blocks: [],
			undoLog: [],
			chips: []
		};
		const now = Date.now();
		const docId = await ctx.db.insert('documents', {
			ownerId,
			title,
			blocksOrder: [],
			undoCursor: 0,
			revision: 0,
			bundleHash: '',
			workbookManifest,
			stats: { blocks: 0, tabs: 1, nodes: 0, bytes: 0 },
			createdAt: now,
			updatedAt: now
		});
		const snapshot = {
			id: String(docId),
			name: title,
			sheetOrder: ['sheet-1'],
			sheets: { 'sheet-1': { id: 'sheet-1', name: 'Sheet 1' } }
		};
		const snapshotHash = workbookSnapshotHash(snapshot);
		const bundleHash = documentBundleHash(graph, workbookManifest, snapshotHash);
		const bytes = canonicalBytes(graph) + canonicalBytes(snapshot);
		await ctx.db.patch(docId, {
			documentId: String(docId),
			bundleHash,
			stats: { blocks: 0, tabs: 1, nodes: 0, bytes }
		});
		await ctx.db.insert('workbookSnapshots', {
			docId,
			revision: 0,
			snapshotHash,
			snapshot,
			updatedAt: now
		});
		return docId;
	}
});

/** List every live owned document, newest first. */
export const list = query({
	args: {},
	handler: async (ctx) => {
		const ownerId = await requireOwnerId(ctx);
		const documents = await ctx.db
			.query('documents')
			.withIndex('by_owner_deleted_updated', (q) =>
				q.eq('ownerId', ownerId).eq('deletedAt', undefined)
			)
			.order('desc')
			.take(DOCUMENT_CAP);
		return documents.map((document) => ({
			...document,
			_id: document.documentId ?? document._id,
			revision: document.mainVersionNumber ?? document.revision ?? 0,
			bundleHash: document.mainHash ?? document.bundleHash ?? ''
		}));
	}
});

/** List every trashed owned document, newest first. */
export const listTrash = query({
	args: {},
	handler: async (ctx) => {
		const ownerId = await requireOwnerId(ctx);
		const documents = await ctx.db
			.query('documents')
			.withIndex('by_owner_deleted_updated', (q) => q.eq('ownerId', ownerId))
			.take(DOCUMENT_CAP);
		return documents
			.filter((document) => document.deletedAt !== undefined)
			.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
			.map((document) => ({
				...document,
				_id: document.documentId ?? document._id,
				revision: document.mainVersionNumber ?? document.revision ?? 0,
				bundleHash: document.mainHash ?? document.bundleHash ?? ''
			}));
	}
});

/** Rename a live owned document. */
export const rename = mutation({
	args: { docId: v.string(), title: v.string() },
	handler: async (ctx, { docId, title }) => {
		await requireProductWritable(ctx);
		const document = await requireLiveOwnedDocument(ctx, docId);
		await ctx.db.patch(document._id, { title: validTitle(title), updatedAt: Date.now() });
	}
});

/** Move a live document to recoverable trash. */
export const trash = mutation({
	args: { docId: v.string() },
	handler: async (ctx, { docId }) => {
		await requireProductWritable(ctx);
		const document = await requireLiveOwnedDocument(ctx, docId);
		const now = Date.now();
		await ctx.db.patch(document._id, { deletedAt: now, updatedAt: now });
	}
});

/** Restore an owned trashed document without touching its content bundle. */
export const restore = mutation({
	args: { docId: v.string() },
	handler: async (ctx, { docId }) => {
		await requireProductWritable(ctx);
		const ownerId = await requireOwnerId(ctx);
		const document = await resolveProductDocument(ctx, docId);
		if (!document) throw new Error('NOT_FOUND');
		if (document.ownerId !== ownerId) throw new Error('UNAUTHORIZED');
		if (document.deletedAt === undefined) return;
		await ctx.db.patch(document._id, { deletedAt: undefined, updatedAt: Date.now() });
	}
});

/** Permanently remove an owned trashed document and all child rows. */
export const remove = mutation({
	args: { docId: v.string() },
	handler: async (ctx, { docId }) => {
		await requireProductWritable(ctx);
		const ownerId = await requireOwnerId(ctx);
		const document = await resolveProductDocument(ctx, docId);
		if (!document) return;
		if (document.ownerId !== ownerId) throw new Error('UNAUTHORIZED');
		if (document.deletedAt === undefined) throw new Error('TRASH_REQUIRED');
		await purgeDocument(ctx, document._id);
	}
});

/** Empty owned trash; each call is bounded and idempotent. */
export const emptyTrash = mutation({
	args: {},
	handler: async (ctx) => {
		await requireProductWritable(ctx);
		const ownerId = await requireOwnerId(ctx);
		const documents = await ctx.db
			.query('documents')
			.withIndex('by_owner_deleted_updated', (q) => q.eq('ownerId', ownerId))
			.collect();
		const allTrashed = documents.filter((document) => document.deletedAt !== undefined);
		const trashed = allTrashed.slice(0, 25);
		for (const document of trashed) await purgeDocument(ctx, document._id);
		return { deleted: trashed.length, hasMore: allTrashed.length > trashed.length };
	}
});

/** Purge expired trash in bounded batches; safe to invoke from a cron. */
export const purgeExpired = internalMutation({
	args: {},
	handler: async (ctx) => {
		await requireProductWritable(ctx);
		const cutoff = Date.now() - RETENTION_MS;
		const expired = await ctx.db
			.query('documents')
			.withIndex('by_deleted_at', (q) => q.gte('deletedAt', 0).lt('deletedAt', cutoff))
			.take(25);
		let deleted = 0;
		for (const document of expired) {
			if (document.deletedAt !== undefined && document.deletedAt < cutoff) {
				await purgeDocument(ctx, document._id);
				deleted += 1;
			}
		}
		return deleted;
	}
});

/**
 * Atomically replace graph rows and the single workbook snapshot using
 * compare-and-swap revision control.
 */
export const save = mutation({
	args: {
		docId: v.id('documents'),
		expectedRevision: v.number(),
		graph: graphArg,
		workbookManifest: manifestArg,
		workbookSnapshot: v.any(),
		snapshotHash: v.string(),
		bundleHash: v.string()
	},
	handler: async (
		ctx,
		{
			docId,
			expectedRevision,
			graph,
			workbookManifest,
			workbookSnapshot,
			snapshotHash,
			bundleHash
		}
	) => {
		await requireProductWritable(ctx);
		const document = await requireLiveOwnedDocument(ctx, docId);
		const revision = document.revision ?? 0;
		if (revision !== expectedRevision) throw new Error(`REVISION_CONFLICT:${revision}`);
		validateBundle(graph, workbookManifest, workbookSnapshot);
		const actualSnapshotHash = workbookSnapshotHash(workbookSnapshot);
		if (actualSnapshotHash !== snapshotHash) throw new Error('SNAPSHOT_HASH_MISMATCH');
		const actualBundleHash = documentBundleHash(graph, workbookManifest, snapshotHash);
		if (actualBundleHash !== bundleHash) throw new Error('BUNDLE_HASH_MISMATCH');
		await reconcileDocumentAssets(ctx, docId, document.ownerId!, graph);

		await deleteDocRows(ctx, docId);
		for (const node of graph.nodes) await ctx.db.insert('graphNodes', { docId, ...node });
		for (const block of graph.blocks) await ctx.db.insert('blocks', { docId, ...block });
		for (const entry of graph.undoLog) await ctx.db.insert('undoLog', { docId, ...entry });
		for (const chip of graph.chips) await ctx.db.insert('chipBindings', { docId, ...chip });

		const existingSnapshots = await ctx.db
			.query('workbookSnapshots')
			.withIndex('by_doc', (q) => q.eq('docId', docId))
			.collect();
		if (existingSnapshots.length > 1) throw new Error('WORKBOOK_SNAPSHOT_INVARIANT');
		const nextRevision = revision + 1;
		const updatedAt = Date.now();
		const snapshotFields = {
			revision: nextRevision,
			snapshotHash,
			snapshot: workbookSnapshot,
			updatedAt
		};
		if (existingSnapshots[0]) {
			await ctx.db.patch(existingSnapshots[0]._id, snapshotFields);
		} else {
			await ctx.db.insert('workbookSnapshots', { docId, ...snapshotFields });
		}
		const bytes = canonicalBytes(graph) + canonicalBytes(workbookSnapshot);
		await ctx.db.patch(docId, {
			blocksOrder: graph.blocksOrder,
			undoCursor: graph.undoCursor,
			revision: nextRevision,
			bundleHash,
			workbookManifest,
			stats: {
				blocks: graph.blocks.length,
				tabs: workbookManifest.sheets.length,
				nodes: graph.nodes.length,
				bytes
			},
			updatedAt
		});
		return { revision: nextRevision, bundleHash };
	}
});

/** Load a typed state and fail closed when any persisted checksum disagrees. */
export const load = query({
	args: { docId: v.string() },
	handler: async (ctx, { docId }) => {
		const ownerId = await requireOwnerId(ctx);
		const document = await resolveProductDocument(ctx, docId);
		if (!document) return { state: 'missing' as const };
		if (document.ownerId !== ownerId) return { state: 'unauthorized' as const };
		if (document.deletedAt !== undefined) {
			return { state: 'trashed' as const, document };
		}
		const rows = await loadRows(ctx, document._id);
		const snapshots = await ctx.db
			.query('workbookSnapshots')
			.withIndex('by_doc', (q) => q.eq('docId', document._id))
			.collect();
		if (snapshots.length !== 1 || !document.workbookManifest || document.revision === undefined) {
			return { state: 'integrity-error' as const, reason: 'missing workbook bundle' };
		}
		const workbook = snapshots[0];
		const graph = graphFromRows(document, rows);
		const snapshotHash = workbookSnapshotHash(workbook.snapshot);
		const bundleHash = documentBundleHash(graph, document.workbookManifest, snapshotHash);
		if (
			workbook.revision !== document.revision ||
			workbook.snapshotHash !== snapshotHash ||
			document.bundleHash !== bundleHash
		) {
			return { state: 'integrity-error' as const, reason: 'bundle checksum mismatch' };
		}
		try {
			validateBundle(graph, document.workbookManifest, workbook.snapshot, {
				allowLegacyEquations: true
			});
		} catch (error) {
			return {
				state: 'integrity-error' as const,
				reason: error instanceof Error ? error.message : 'invalid bundle'
			};
		}
		return {
			state: 'live' as const,
			document,
			...rows,
			workbookSnapshot: workbook
		};
	}
});

function validTitle(raw: string): string {
	const title = raw.trim();
	if (title.length === 0 || title.length > TITLE_CAP) throw new Error('INVALID_TITLE');
	return title;
}

/** Validate one complete authored graph/workbook bundle before any product rows change. */
export function validateBundle(
	graph: {
		blocksOrder: string[];
		undoCursor: number;
		nodes: Array<{ nodeId: string; cellRef?: { sheetId: string; a1: string } }>;
		blocks: Array<{
			blockId: string;
			type: string;
			position: number;
			equation?: unknown;
		}>;
		undoLog: Array<{ seq: number }>;
		chips: Array<{ chipId: string }>;
	},
	manifest: { sheets: Array<{ id: string; name: string; position: number }> },
	snapshot: unknown,
	options: { allowLegacyEquations?: boolean } = {}
): void {
	if (graph.nodes.length > NODE_CAP) throw new Error('NODE_LIMIT');
	if (graph.blocks.length > BLOCK_CAP) throw new Error('BLOCK_LIMIT');
	if (graph.chips.length > CHIP_CAP) throw new Error('CHIP_LIMIT');
	if (graph.undoLog.length > UNDO_CAP) throw new Error('UNDO_LIMIT');
	if (manifest.sheets.length < 1 || manifest.sheets.length > TAB_CAP) {
		throw new Error('TAB_LIMIT');
	}
	unique(graph.nodes.map((node) => node.nodeId), 'node ids');
	unique(graph.blocks.map((block) => block.blockId), 'block ids');
	unique(graph.chips.map((chip) => chip.chipId), 'chip ids');
	unique(graph.undoLog.map((entry) => String(entry.seq)), 'undo sequences');
	unique(manifest.sheets.map((sheet) => sheet.id), 'sheet ids');
	unique(manifest.sheets.map((sheet) => sheet.name.trim().toLocaleLowerCase()), 'sheet names');
	for (const [position, sheet] of manifest.sheets.entries()) {
		if (sheet.position !== position) throw new Error('NONCONTIGUOUS_SHEETS');
		if (
			sheet.name !== sheet.name.trim() ||
			sheet.name.length === 0 ||
			sheet.name.length > TAB_NAME_CAP
		) {
			throw new Error('INVALID_SHEET_NAME');
		}
	}
	const sheetIds = new Set(manifest.sheets.map((sheet) => sheet.id));
	for (const node of graph.nodes) {
		if (node.cellRef) {
			if (!sheetIds.has(node.cellRef.sheetId)) throw new Error('UNKNOWN_CELL_SHEET');
			if (!/^[A-Z]{1,3}[1-9]\d*$/.test(node.cellRef.a1)) throw new Error('INVALID_A1');
		}
	}
	for (const block of graph.blocks) {
		if (!['text', 'heading', 'image', 'equation'].includes(block.type)) {
			throw new Error('INVALID_BLOCK_TYPE');
		}
		if (block.type === 'equation') {
			if (!block.equation) throw new Error('MISSING_EQUATION_PAYLOAD');
			const equation = block.equation as Record<string, unknown>;
			if (
				options.allowLegacyEquations &&
				((equation.mode === 'static' &&
					Object.keys(equation).length === 2 &&
					typeof equation.tex === 'string' &&
					equation.tex.length <= 10_000) ||
					(equation.mode === 'bound' &&
						Object.keys(equation).length === 3 &&
						typeof equation.nodeId === 'string' &&
						equation.nodeId.length > 0 &&
						['symbolic', 'substituted', 'result', 'steps'].includes(
							String(equation.display)
						)))
			) {
				continue;
			}
			if (!isEquationPayload(block.equation)) {
				throw new Error('INVALID_EQUATION_PAYLOAD');
			}
		} else if (block.equation !== undefined) {
			throw new Error('UNEXPECTED_EQUATION_PAYLOAD');
		}
	}
	const ordered = [...graph.blocks]
		.sort((a, b) => a.position - b.position)
		.map((block) => block.blockId);
	if (JSON.stringify(ordered) !== JSON.stringify(graph.blocksOrder)) {
		throw new Error('INVALID_BLOCK_ORDER');
	}
	if (
		!Number.isInteger(graph.undoCursor) ||
		graph.undoCursor < 0 ||
		graph.undoCursor > graph.undoLog.length
	) {
		throw new Error('INVALID_UNDO_CURSOR');
	}
	const snapshotRecord = snapshot as {
		sheetOrder?: unknown;
		sheets?: Record<string, { name?: unknown; cellData?: unknown }>;
	};
	if (!Array.isArray(snapshotRecord?.sheetOrder) || !snapshotRecord.sheets) {
		throw new Error('INVALID_WORKBOOK_SNAPSHOT');
	}
	if (JSON.stringify(snapshotRecord.sheetOrder) !== JSON.stringify([...sheetIds])) {
		throw new Error('WORKBOOK_MANIFEST_MISMATCH');
	}
	for (const sheet of manifest.sheets) {
		const stored = snapshotRecord.sheets[sheet.id];
		if (!stored || stored.name !== sheet.name) throw new Error('WORKBOOK_MANIFEST_MISMATCH');
		if (containsFormula(stored.cellData)) throw new Error('AUTHORITATIVE_SNAPSHOT_FORMULA');
	}
	if (canonicalBytes(snapshot) > SNAPSHOT_BYTE_LIMIT) throw new Error('SNAPSHOT_TOO_LARGE');
	if (canonicalBytes({ graph, manifest, snapshot }) > BUNDLE_BYTE_LIMIT) {
		throw new Error('BUNDLE_TOO_LARGE');
	}
}

function containsFormula(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	if (Array.isArray(value)) return value.some(containsFormula);
	const record = value as Record<string, unknown>;
	if (typeof record.f === 'string' && record.f.length > 0) return true;
	return Object.values(record).some(containsFormula);
}

function unique(values: string[], label: string): void {
	if (new Set(values).size !== values.length) throw new Error(`DUPLICATE_${label.toUpperCase()}`);
}

async function loadRows(ctx: QueryCtx, docId: Id<'documents'>) {
	return {
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
			.collect()
	};
}

function graphFromRows(
	document: { blocksOrder: string[]; undoCursor: number },
	rows: Awaited<ReturnType<typeof loadRows>>
) {
	return {
		blocksOrder: document.blocksOrder,
		undoCursor: document.undoCursor,
		nodes: rows.nodes
			.map(({ docId: _docId, _id: _id, _creationTime: _creationTime, ...node }) => node)
			.sort((a, b) => a.nodeId.localeCompare(b.nodeId)),
		blocks: rows.blocks
			.map(({ docId: _docId, _id: _id, _creationTime: _creationTime, ...block }) => block)
			.sort((a, b) => a.position - b.position || a.blockId.localeCompare(b.blockId)),
		undoLog: rows.undoLog
			.map(({ docId: _docId, _id: _id, _creationTime: _creationTime, ...entry }) => entry)
			.sort((a, b) => a.seq - b.seq),
		chips: rows.chips
			.map(({ docId: _docId, _id: _id, _creationTime: _creationTime, ...chip }) => chip)
			.sort((a, b) => a.chipId.localeCompare(b.chipId))
	};
}

async function purgeDocument(ctx: MutationCtx, docId: Id<'documents'>): Promise<void> {
	const now = Date.now();
	for (const asset of await ctx.db
		.query('assets')
		.withIndex('by_doc', (q) => q.eq('docId', docId))
		.collect()) {
		await ctx.db.patch(asset._id, {
			state: 'pendingDeletion',
			pendingDeletionAt: now,
			nextAttemptAt: now
		});
	}
	await deleteDocRows(ctx, docId);
	for (const version of await ctx.db
		.query('documentVersions')
		.withIndex('by_document_number', (q) => q.eq('documentRowId', docId))
		.collect()) {
		for (const chunk of await ctx.db
			.query('snapshotChunks')
			.withIndex('by_version_index', (q) => q.eq('versionId', version._id))
			.collect()) {
			await ctx.db.delete(chunk._id);
		}
		await ctx.db.delete(version._id);
	}
	for (const row of await ctx.db
		.query('workbookSnapshots')
		.withIndex('by_doc', (q) => q.eq('docId', docId))
		.collect()) {
		await ctx.db.delete(row._id);
	}
	await ctx.db.delete(docId);
}

/**
 * Validate every active and undo-retained image reference before a save
 * mutates rows, then mark newly unreachable assets for durable cleanup.
 */
async function reconcileDocumentAssets(
	ctx: MutationCtx,
	docId: Id<'documents'>,
	ownerId: string,
	graph: {
		blocks: Array<{ image?: { storageId: string } }>;
		undoLog: Array<unknown>;
	}
): Promise<void> {
	const referenced = new Set<string>();
	for (const block of graph.blocks) {
		if (block.image?.storageId) referenced.add(block.image.storageId);
	}
	for (const entry of graph.undoLog) collectStorageIds(entry, referenced);

	const assets = await ctx.db
		.query('assets')
		.withIndex('by_doc', (q) => q.eq('docId', docId))
		.collect();
	const byStorage = new Map(assets.map((asset) => [String(asset.storageId), asset]));
	for (const storageId of referenced) {
		const normalized = ctx.db.system.normalizeId('_storage', storageId);
		if (!normalized) throw new Error('INVALID_ASSET_ID');
		const asset =
			byStorage.get(storageId) ??
			(await ctx.db
				.query('assets')
				.withIndex('by_storage', (q) => q.eq('storageId', normalized))
				.unique());
		if (!asset || asset.ownerId !== ownerId || asset.docId !== docId) {
			throw new Error('UNCLAIMED_OR_FOREIGN_ASSET');
		}
		if (asset.state === 'pendingDeletion') {
			await ctx.db.patch(asset._id, {
				state: 'claimed',
				pendingDeletionAt: undefined,
				nextAttemptAt: undefined,
				lastError: undefined
			});
		}
	}
	const now = Date.now();
	for (const asset of assets) {
		if (referenced.has(String(asset.storageId))) continue;
		if (asset.state !== 'pendingDeletion') {
			await ctx.db.patch(asset._id, {
				state: 'pendingDeletion',
				pendingDeletionAt: now,
				nextAttemptAt: now
			});
		}
	}
}

function collectStorageIds(value: unknown, output: Set<string>): void {
	if (!value || typeof value !== 'object') return;
	if (Array.isArray(value)) {
		for (const item of value) collectStorageIds(item, output);
		return;
	}
	const record = value as Record<string, unknown>;
	if (typeof record.storageId === 'string') output.add(record.storageId);
	for (const item of Object.values(record)) collectStorageIds(item, output);
}

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
