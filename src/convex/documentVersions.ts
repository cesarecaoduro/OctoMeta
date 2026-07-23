import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import {
	requireOwnerId,
	requireProductWritable,
	resolveProductDocument,
	validateBundle
} from './documents';
import {
	BUNDLE_BYTE_LIMIT,
	canonicalJson
} from '../lib/persistence/canonical';
import {
	cloudVersionOperationInputHash,
	type CloudVersionBundle
} from '../lib/persistence/cloud-version';
import { sha256Hex } from '../lib/persistence/cloud-integrity';

/** Target size that keeps every snapshot chunk safely below Convex's row limit. */
export const SNAPSHOT_CHUNK_TARGET_BYTES = 700 * 1024;
const VERSION_LIMIT = 200;
const VERSION_BYTES_LIMIT = 256 * 1024 * 1024;
const EMPTY_STATS = { blocks: 0, tabs: 1, nodes: 0, bytes: 0 };

const saveArgs = {
	publicDocumentId: v.string(),
	expectedHeadNumber: v.number(),
	expectedHeadHash: v.union(v.string(), v.null()),
	operationId: v.string(),
	operationInputHash: v.string(),
	message: v.union(v.string(), v.null()),
	bundleHash: v.string(),
	bundle: v.any()
};

type ProductWriteCtx = Pick<MutationCtx, 'db'>;

function assertBundleShape(bundle: CloudVersionBundle): void {
	if (bundle.schemaVersion !== 1) throw new Error('UNSUPPORTED_BUNDLE_SCHEMA');
	if (bundle.title.trim() !== bundle.title || bundle.title.length < 1 || bundle.title.length > 120) {
		throw new Error('INVALID_TITLE');
	}
	if (!bundle.graph?.workbookManifest || !Array.isArray(bundle.graph.blocksOrder)) {
		throw new Error('CORRUPT_BUNDLE');
	}
	validateBundle(
		{
			blocksOrder: bundle.graph.blocksOrder,
			undoCursor: 0,
			nodes: bundle.graph.nodes,
			blocks: bundle.graph.blocks,
			undoLog: [],
			chips: bundle.graph.chips
		},
		bundle.graph.workbookManifest,
		bundle.workbookSnapshot
	);
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

async function chunksFor(bytes: Uint8Array) {
	const chunks: Array<{ index: number; bytes: ArrayBuffer; byteLength: number; chunkHash: string }> =
		[];
	for (let offset = 0, index = 0; offset < bytes.byteLength; offset += SNAPSHOT_CHUNK_TARGET_BYTES, index += 1) {
		const chunk = bytes.subarray(
			offset,
			Math.min(offset + SNAPSHOT_CHUNK_TARGET_BYTES, bytes.byteLength)
		);
		chunks.push({
			index,
			bytes: copyBuffer(chunk),
			byteLength: chunk.byteLength,
			chunkHash: await sha256Hex(chunk)
		});
	}
	return chunks;
}

async function validateReferencedAssets(
	ctx: ProductWriteCtx,
	documentRowId: Id<'documents'> | null,
	ownerId: string,
	bundle: CloudVersionBundle
): Promise<void> {
	const storageIds = new Set(
		bundle.graph.blocks
			.map((block) => block.image?.storageId)
			.filter((storageId): storageId is string => Boolean(storageId))
	);
	if (storageIds.size > 100) throw new Error('ASSET_LIMIT');
	if (!documentRowId && storageIds.size > 0) throw new Error('MISSING_ASSET');
	for (const storageId of storageIds) {
		const normalized = ctx.db.system.normalizeId('_storage', storageId);
		if (!normalized) throw new Error('MISSING_ASSET');
		const asset = await ctx.db
			.query('assets')
			.withIndex('by_storage', (index) => index.eq('storageId', normalized))
			.unique();
		if (
			!asset ||
			asset.ownerId !== ownerId ||
			asset.docId !== documentRowId ||
			asset.state !== 'claimed'
		) {
			throw new Error('MISSING_ASSET');
		}
	}
}

/** Create version 1 or the next immutable Main version with idempotent expected-head fencing. */
export const save = mutation({
	args: saveArgs,
	handler: async (ctx, args) => {
		await requireProductWritable(ctx);
		const ownerId = await requireOwnerId(ctx);
		let document = await resolveProductDocument(ctx, args.publicDocumentId);
		if (document && document.ownerId !== ownerId) throw new Error('NOT_FOUND');
		if (document?.deletedAt !== undefined) throw new Error('DOCUMENT_TRASHED');

		if (document) {
			const receipt = await ctx.db
				.query('documentVersions')
				.withIndex('by_document_operation', (index) =>
					index.eq('documentRowId', document!._id).eq('operationId', args.operationId)
				)
				.unique();
			if (receipt) {
				if (receipt.operationInputHash !== args.operationInputHash) {
					throw new Error('OPERATION_INPUT_MISMATCH');
				}
				return {
					status: 'created' as const,
					version: receipt.versionNumber,
					versionId: receipt.versionId,
					bundleHash: receipt.bundleHash
				};
			}
		}

		const operationInputHash = await cloudVersionOperationInputHash({
			publicDocumentId: args.publicDocumentId,
			expectedHeadNumber: args.expectedHeadNumber,
			expectedHeadHash: args.expectedHeadHash,
			operationId: args.operationId,
			message: args.message,
			bundleHash: args.bundleHash
		});
		if (operationInputHash !== args.operationInputHash) throw new Error('OPERATION_INPUT_HASH_MISMATCH');

		const bundle = args.bundle as CloudVersionBundle;
		const bundleJson = canonicalJson(bundle);
		const bundleBytes = new TextEncoder().encode(bundleJson);
		if (bundleBytes.byteLength > BUNDLE_BYTE_LIMIT) throw new Error('BUNDLE_TOO_LARGE');
		if ((await sha256Hex(bundleBytes)) !== args.bundleHash) throw new Error('BUNDLE_HASH_MISMATCH');
		assertBundleShape(bundle);

		const currentVersion = document?.mainVersionNumber ?? 0;
		const currentHash = document?.mainHash ?? null;
		if (
			currentVersion !== args.expectedHeadNumber ||
			currentHash !== args.expectedHeadHash
		) {
			throw new Error(`HEAD_CONFLICT:${currentVersion}:${currentHash ?? ''}`);
		}
		if (!document && args.expectedHeadNumber !== 0) throw new Error('HEAD_CONFLICT:0:');
		if (document && currentHash === args.bundleHash) {
			return {
				status: 'unchanged' as const,
				version: currentVersion,
				versionId: document.mainVersionId
					? (await ctx.db.get(document.mainVersionId))?.versionId
					: undefined,
				bundleHash: currentHash
			};
		}
		if ((document?.versionCount ?? 0) >= VERSION_LIMIT) throw new Error('HISTORY_LIMIT');
		if ((document?.versionBytes ?? 0) + bundleBytes.byteLength > VERSION_BYTES_LIMIT) {
			throw new Error('HISTORY_SIZE_LIMIT');
		}
		await validateReferencedAssets(ctx, document?._id ?? null, ownerId, bundle);
		const chunks = await chunksFor(bundleBytes);
		if (chunks.length < 1 || chunks.length > 6) throw new Error('INVALID_CHUNK_COUNT');

		const now = Date.now();
		const stats = {
			blocks: bundle.graph.blocks.length,
			tabs: bundle.graph.workbookManifest.sheets.length,
			nodes: bundle.graph.nodes.length,
			bytes: bundleBytes.byteLength
		};
		let documentRowId: Id<'documents'>;
		if (document) {
			documentRowId = document._id;
		} else {
			documentRowId = await ctx.db.insert('documents', {
				documentId: args.publicDocumentId,
				ownerId,
				title: bundle.title,
				blocksOrder: [],
				undoCursor: 0,
				revision: 0,
				bundleHash: '',
				versionCount: 0,
				versionBytes: 0,
				stats,
				createdAt: now,
				updatedAt: now
			});
			document = await ctx.db.get(documentRowId);
		}
		const nextVersion = currentVersion + 1;
		const versionId = `${args.publicDocumentId}:v${nextVersion}`;
		const versionRowId = await ctx.db.insert('documentVersions', {
			versionId,
			documentRowId,
			versionNumber: nextVersion,
			...(document?.mainVersionId ? { parentVersionId: document.mainVersionId } : {}),
			operationId: args.operationId,
			operationInputHash: args.operationInputHash,
			createdBy: ownerId,
			...(args.message ? { message: args.message } : {}),
			schemaVersion: bundle.schemaVersion,
			bundleHash: args.bundleHash,
			byteLength: bundleBytes.byteLength,
			chunkCount: chunks.length,
			stats,
			createdAt: now
		});
		for (const chunk of chunks) {
			await ctx.db.insert('snapshotChunks', { versionId: versionRowId, ...chunk });
		}
		await ctx.db.patch(documentRowId, {
			documentId: args.publicDocumentId,
			title: bundle.title,
			blocksOrder: [],
			undoCursor: 0,
			revision: nextVersion,
			bundleHash: args.bundleHash,
			workbookManifest: bundle.graph.workbookManifest,
			mainVersionId: versionRowId,
			mainVersionNumber: nextVersion,
			mainHash: args.bundleHash,
			versionCount: (document?.versionCount ?? 0) + 1,
			versionBytes: (document?.versionBytes ?? 0) + bundleBytes.byteLength,
			stats,
			updatedAt: now
		});
		return {
			status: 'created' as const,
			version: nextVersion,
			versionId,
			bundleHash: args.bundleHash
		};
	}
});

/** Load and verify the complete immutable Main snapshot for one owner. */
export const loadHead = query({
	args: { publicDocumentId: v.string() },
	handler: async (ctx, { publicDocumentId }) => {
		const ownerId = await requireOwnerId(ctx);
		const document = await resolveProductDocument(ctx, publicDocumentId);
		if (!document || document.ownerId !== ownerId) return { state: 'missing' as const };
		if (document.deletedAt !== undefined) {
			return {
				state: 'trashed' as const,
				document: {
					documentId: document.documentId ?? String(document._id),
					title: document.title,
					mainVersionNumber: document.mainVersionNumber ?? document.revision ?? 0,
					mainHash: document.mainHash ?? document.bundleHash ?? '',
					stats: document.stats ?? EMPTY_STATS,
					deletedAt: document.deletedAt,
					createdAt: document.createdAt,
					updatedAt: document.updatedAt
				}
			};
		}
		if (!document.mainVersionId || !document.mainVersionNumber || !document.mainHash) {
			return { state: 'legacy' as const };
		}
		const version = await ctx.db.get(document.mainVersionId);
		if (!version || version.documentRowId !== document._id) {
			return { state: 'integrity-error' as const, reason: 'missing head version' };
		}
		const chunks = await ctx.db
			.query('snapshotChunks')
			.withIndex('by_version_index', (index) => index.eq('versionId', version._id))
			.collect();
		chunks.sort((left, right) => left.index - right.index);
		if (
			chunks.length !== version.chunkCount ||
			chunks.some((chunk, index) => chunk.index !== index)
		) {
			return { state: 'integrity-error' as const, reason: 'noncontiguous snapshot chunks' };
		}
		const complete = new Uint8Array(version.byteLength);
		let offset = 0;
		for (const chunk of chunks) {
			const bytes = new Uint8Array(chunk.bytes);
			if (
				bytes.byteLength !== chunk.byteLength ||
				(await sha256Hex(bytes)) !== chunk.chunkHash
			) {
				return { state: 'integrity-error' as const, reason: 'snapshot chunk mismatch' };
			}
			complete.set(bytes, offset);
			offset += bytes.byteLength;
		}
		if (offset !== version.byteLength || (await sha256Hex(complete)) !== version.bundleHash) {
			return { state: 'integrity-error' as const, reason: 'snapshot bundle mismatch' };
		}
		try {
			const bundle = JSON.parse(new TextDecoder().decode(complete)) as CloudVersionBundle;
			if (canonicalJson(bundle) !== new TextDecoder().decode(complete)) {
				throw new Error('snapshot is not canonical');
			}
			assertBundleShape(bundle);
			return {
				state: 'live' as const,
				document: {
					documentId: document.documentId ?? String(document._id),
					title: document.title,
					mainVersionNumber: document.mainVersionNumber,
					mainHash: document.mainHash,
					stats: document.stats ?? version.stats,
					createdAt: document.createdAt,
					updatedAt: document.updatedAt
				},
				version: {
					versionId: version.versionId,
					versionNumber: version.versionNumber,
					message: version.message,
					bundleHash: version.bundleHash,
					byteLength: version.byteLength,
					chunkCount: version.chunkCount,
					createdAt: version.createdAt
				},
				bundle
			};
		} catch (error) {
			return {
				state: 'integrity-error' as const,
				reason: error instanceof Error ? error.message : 'invalid snapshot'
			};
		}
	}
});
