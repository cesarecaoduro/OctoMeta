import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// ---------------------------------------------------------------------------
// Shared field validators (SCHEMA.md §10). Deep engine-owned structures
// (formula ASTs, TypedValues, mutations, provenance) are stored as `v.any()`:
// their shapes are owned and validated by src/lib/engine, and the persistence
// layer (src/lib/persistence/codec.ts) encodes them to Convex-safe JSON
// (non-ASCII `Θ` dimension key, undefined stripping) before they get here.
// ---------------------------------------------------------------------------

/** One persisted GraphNode (SCHEMA.md §3), keyed by docId + engine nodeId. */
export const graphNodeFields = {
	docId: v.id('documents'),
	/** Engine NodeId (ULID) — distinct from the Convex row _id. */
	nodeId: v.string(),
	kind: v.string(),
	name: v.optional(v.string()),
	publication: v.optional(
		v.object({
			label: v.optional(v.string()),
			unit: v.optional(v.string()),
			description: v.optional(v.string())
		})
	),
	/** FormulaAST, codec-encoded. */
	formula: v.optional(v.any()),
	/** TypedValue, codec-encoded. */
	value: v.any(),
	inputs: v.array(v.string()),
	contentHash: v.string(),
	blockId: v.optional(v.string()),
	cellRef: v.optional(v.object({ sheetId: v.string(), a1: v.string() })),
	/** Provenance object (SCHEMA.md §3). */
	provenance: v.any(),
	/** Reserved V3 slot; stored verbatim, never interpreted. */
	pending: v.optional(v.union(v.any(), v.null()))
};

/** One persisted document block (SCHEMA.md §8/§10). Sheet snapshots live in `sheetSnapshots`. */
export const blockFields = {
	docId: v.id('documents'),
	/** Engine BlockId — distinct from the Convex row _id. */
	blockId: v.string(),
	type: v.string(),
	/** Layout ONLY — denormalized copy of `documents.blocksOrder` index (SCHEMA.md §5, §10). */
	position: v.number(),
	/** ProseMirror JSON for text/heading blocks. */
	pm: v.optional(v.any()),
	image: v.optional(
		v.object({ storageId: v.string(), alt: v.optional(v.string()), caption: v.optional(v.string()) })
	),
	/**
	 * Engine-owned, versioned equation JSON. Kept schema-open until the guarded
	 * prototype reset removes legacy rows; every new save is strictly checked
	 * by validateBundle and the engine mutation boundary.
	 */
	equation: v.optional(v.any())
};

/** One undo-log entry (SCHEMA.md §9), codec-encoded mutation/inverse payloads. */
export const undoLogFields = {
	docId: v.id('documents'),
	/** Monotonic per document. */
	seq: v.number(),
	mutation: v.any(),
	inverse: v.array(v.any()),
	actor: v.object({ kind: v.string(), id: v.optional(v.string()) }),
	at: v.number()
};

/** One inline value chip binding (SCHEMA.md §8). */
export const chipBindingFields = {
	docId: v.id('documents'),
	/** Engine chip id — distinct from the Convex row _id. */
	chipId: v.string(),
	blockId: v.string(),
	nodeId: v.string(),
	format: v.optional(v.object({ digits: v.optional(v.number()), unit: v.optional(v.string()) }))
};

export default defineSchema({
	// ---- product tables (SCHEMA.md §10; `versions` is V2) --------------------
	documents: defineTable({
		/** Stable product identity used by local-only documents before a Convex row exists. */
		documentId: v.optional(v.string()),
		/** Optional only while pre-R1 development rows are migrated; all writes require it. */
		ownerId: v.optional(v.string()),
		title: v.string(),
		/** Canonical block order; `blocks.position` is the denormalized copy. */
		blocksOrder: v.array(v.string()),
		/** Undo-log cursor (SCHEMA.md §9): entries with seq ≤ cursor boundary are undoable. */
		undoCursor: v.number(),
		revision: v.optional(v.number()),
		bundleHash: v.optional(v.string()),
		mainVersionId: v.optional(v.id('documentVersions')),
		mainVersionNumber: v.optional(v.number()),
		mainHash: v.optional(v.string()),
		versionCount: v.optional(v.number()),
		versionBytes: v.optional(v.number()),
		workbookManifest: v.optional(
			v.object({
				sheets: v.array(
					v.object({ id: v.string(), name: v.string(), position: v.number() })
				)
			})
		),
		deletedAt: v.optional(v.number()),
		stats: v.optional(
			v.object({
				blocks: v.number(),
				tabs: v.number(),
				nodes: v.number(),
				bytes: v.number()
			})
		),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_document_id', ['documentId'])
		.index('by_owner_deleted_updated', ['ownerId', 'deletedAt', 'updatedAt'])
		.index('by_deleted_at', ['deletedAt']),
	documentVersions: defineTable({
		versionId: v.string(),
		documentRowId: v.id('documents'),
		versionNumber: v.number(),
		parentVersionId: v.optional(v.id('documentVersions')),
		operationId: v.string(),
		operationInputHash: v.string(),
		createdBy: v.string(),
		message: v.optional(v.string()),
		schemaVersion: v.number(),
		bundleHash: v.string(),
		byteLength: v.number(),
		chunkCount: v.number(),
		stats: v.object({
			blocks: v.number(),
			tabs: v.number(),
			nodes: v.number(),
			bytes: v.number()
		}),
		createdAt: v.number()
	})
		.index('by_version_id', ['versionId'])
		.index('by_document_number', ['documentRowId', 'versionNumber'])
		.index('by_document_operation', ['documentRowId', 'operationId']),
	snapshotChunks: defineTable({
		versionId: v.id('documentVersions'),
		index: v.number(),
		bytes: v.bytes(),
		byteLength: v.number(),
		chunkHash: v.string()
	}).index('by_version_index', ['versionId', 'index']),
	graphNodes: defineTable(graphNodeFields)
		.index('by_doc', ['docId'])
		.index('by_doc_node', ['docId', 'nodeId']),
	blocks: defineTable(blockFields)
		.index('by_doc', ['docId'])
		.index('by_doc_block', ['docId', 'blockId']),
	undoLog: defineTable(undoLogFields).index('by_doc_seq', ['docId', 'seq']),
	workbookSnapshots: defineTable({
		docId: v.id('documents'),
		revision: v.number(),
		snapshotHash: v.string(),
		snapshot: v.any(),
		updatedAt: v.number()
	}).index('by_doc', ['docId']),
	chipBindings: defineTable(chipBindingFields)
		.index('by_doc', ['docId'])
		.index('by_doc_chip', ['docId', 'chipId']),
	assets: defineTable({
		storageId: v.id('_storage'),
		ownerId: v.string(),
		docId: v.optional(v.id('documents')),
		contentType: v.string(),
		size: v.number(),
		state: v.union(
			v.literal('claimed'),
			v.literal('pendingDeletion')
		),
		createdAt: v.number(),
		claimedAt: v.optional(v.number()),
		lastReachabilityCheckedAt: v.optional(v.number()),
		pendingDeletionAt: v.optional(v.number()),
		deleteAttempts: v.number(),
		nextAttemptAt: v.optional(v.number()),
		lastError: v.optional(v.string())
	})
		.index('by_storage', ['storageId'])
		.index('by_doc', ['docId'])
		.index('by_state_next', ['state', 'nextAttemptAt'])
		.index('by_state_reachability_checked', ['state', 'lastReachabilityCheckedAt'])
		.index('by_state_created', ['state', 'createdAt']),
	maintenance: defineTable({
		key: v.string(),
		locked: v.boolean(),
		operation: v.optional(v.string()),
		startedAt: v.optional(v.number()),
		updatedAt: v.number()
	}).index('by_key', ['key']),

	// ---- marketing (live) ----------------------------------------------------
	waitlist: defineTable({
		email: v.string(),
		name: v.optional(v.string()),
		role: v.optional(v.string()),
		firm: v.optional(v.string()),
		tool: v.optional(v.string()),
		source: v.string(),
		// EmailId returned by the Resend component for the confirmation email,
		// and the latest delivery status reported by the webhook.
		confirmationEmailId: v.optional(v.string()),
		confirmationStatus: v.optional(v.string())
	})
		.index('by_email', ['email'])
		.index('by_confirmation_email_id', ['confirmationEmailId'])
});
