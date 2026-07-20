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
	/** FormulaAST, codec-encoded. */
	formula: v.optional(v.any()),
	/** TypedValue, codec-encoded. */
	value: v.any(),
	inputs: v.array(v.string()),
	contentHash: v.string(),
	blockId: v.optional(v.string()),
	cellRef: v.optional(v.object({ sheetBlockId: v.string(), a1: v.string() })),
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
	viewer: v.optional(v.any())
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
		title: v.string(),
		/** Canonical block order; `blocks.position` is the denormalized copy. */
		blocksOrder: v.array(v.string()),
		/** Undo-log cursor (SCHEMA.md §9): entries with seq ≤ cursor boundary are undoable. */
		undoCursor: v.number(),
		createdAt: v.number(),
		updatedAt: v.number()
	}),
	graphNodes: defineTable(graphNodeFields)
		.index('by_doc', ['docId'])
		.index('by_doc_node', ['docId', 'nodeId']),
	blocks: defineTable(blockFields)
		.index('by_doc', ['docId'])
		.index('by_doc_block', ['docId', 'blockId']),
	undoLog: defineTable(undoLogFields).index('by_doc_seq', ['docId', 'seq']),
	sheetSnapshots: defineTable({
		docId: v.id('documents'),
		blockId: v.string(),
		univerSnapshot: v.any(),
		updatedAt: v.number()
	})
		.index('by_doc', ['docId'])
		.index('by_block', ['blockId']),
	chipBindings: defineTable(chipBindingFields)
		.index('by_doc', ['docId'])
		.index('by_doc_chip', ['docId', 'chipId']),

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
