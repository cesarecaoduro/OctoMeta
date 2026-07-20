/**
 * Graph ⇄ rows (SCHEMA.md §10). `serializeGraph` turns a live DocumentGraph
 * into the wire payload `documents.save` accepts; `hydrateGraph` rebuilds a
 * DocumentGraph from `documents.load` rows and verifies reproducibility by
 * re-deriving every contentHash from inputs (SCHEMA.md §5: "restart & run all
 * is a no-op"). Both the app (src/lib/persistence/client.ts) and the CI
 * reproducibility test go through these two functions — one code path.
 *
 * Codec note: all deep engine JSON (values, formulas, provenance, undo
 * mutations) passes through codec.ts on the way in and out (`Θ` key renaming,
 * undefined stripping). Engine `Block.docId` is NOT persisted per row — the
 * Convex parent id is; hydrated blocks carry the Convex document id as their
 * `docId`, which the engine treats as an opaque string.
 */

import type {
	Actor,
	Block,
	CellRef,
	ChipBinding,
	FormulaAST,
	FunctionRegistry,
	GraphMutation,
	GraphNode,
	NodeId,
	Provenance,
	TypedValue,
	UndoEntry
} from '../engine';
import { DocumentGraph, createBuiltinRegistry, evaluateWithDerivations, recalc } from '../engine';
import { fromConvexJson, toConvexJson } from './codec';

// ---------------------------------------------------------------------------
// Wire shapes (rows without Convex system fields; deep parts codec-encoded)
// ---------------------------------------------------------------------------

/** One graphNodes row as sent to / returned from Convex (minus `docId`/system fields). */
export interface PersistedNode {
	nodeId: NodeId;
	kind: string;
	name?: string;
	formula?: unknown;
	value: unknown;
	inputs: NodeId[];
	contentHash: string;
	blockId?: string;
	cellRef?: CellRef;
	provenance: unknown;
	pending?: unknown;
}

/** One blocks row (engine `Block` minus `docId`, keyed by engine blockId). */
export interface PersistedBlock {
	blockId: string;
	type: string;
	position: number;
	pm?: unknown;
	image?: { storageId: string; alt?: string; caption?: string };
	viewer?: unknown;
}

/** One undoLog row (mutation/inverse codec-encoded; actor widened to wire strings). */
export interface PersistedUndoEntry {
	seq: number;
	mutation: unknown;
	inverse: unknown[];
	actor: { kind: string; id?: string };
	at: number;
}

/** One chipBindings row. */
export interface PersistedChip {
	chipId: string;
	blockId: string;
	nodeId: NodeId;
	format?: { digits?: number; unit?: string };
}

/** The full-save payload — exactly the `documents.save` args minus `docId`. */
export interface SavePayload {
	blocksOrder: string[];
	undoCursor: number;
	nodes: PersistedNode[];
	blocks: PersistedBlock[];
	undoLog: PersistedUndoEntry[];
	chips: PersistedChip[];
}

/** What `hydrateGraph` needs from a `documents.load` result. Extra row fields (`_id`, …) are ignored. */
export interface LoadedRows {
	document: { blocksOrder: string[]; undoCursor: number };
	nodes: PersistedNode[];
	blocks: (PersistedBlock & { docId?: string })[];
	undoLog: PersistedUndoEntry[];
	chips: PersistedChip[];
}

/** Outcome of hydration: the rebuilt graph plus the reproducibility verdict. */
export interface HydrateResult {
	graph: DocumentGraph;
	/**
	 * Nodes whose re-derived contentHash differs from the stored one — empty
	 * on a healthy document (SCHEMA.md §5). Non-empty means the stored rows
	 * and the engine disagree; the caller decides how loudly to complain.
	 */
	mismatches: { nodeId: NodeId; stored: string; derived: string }[];
}

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

/** Snapshot a live graph into the `documents.save` wire payload (codec-encoded). */
export function serializeGraph(graph: DocumentGraph): SavePayload {
	const nodes: PersistedNode[] = [...graph.nodes.values()].map((node) =>
		toConvexJson<PersistedNode>({
			nodeId: node.id,
			kind: node.kind,
			name: node.name,
			formula: node.formula,
			value: node.value,
			inputs: node.inputs,
			contentHash: node.contentHash,
			blockId: node.blockId,
			cellRef: node.cellRef,
			provenance: node.provenance,
			pending: node.pending
		})
	);
	const blocks: PersistedBlock[] = [...graph.blocks.values()].map((block) =>
		toConvexJson<PersistedBlock>({
			blockId: block.id,
			type: block.type,
			position: block.position,
			pm: block.pm,
			image: block.image,
			viewer: block.viewer
		})
	);
	const undoLog: PersistedUndoEntry[] = graph.undoLog.map((entry) =>
		toConvexJson<PersistedUndoEntry>({
			seq: entry.seq,
			mutation: entry.mutation,
			inverse: entry.inverse,
			actor: entry.actor,
			at: entry.at
		})
	);
	const chips: PersistedChip[] = [...graph.chips.values()].map((chip) =>
		toConvexJson<PersistedChip>({
			chipId: chip.id,
			blockId: chip.blockId,
			nodeId: chip.nodeId,
			format: chip.format
		})
	);
	return {
		blocksOrder: [...graph.blocksOrder],
		undoCursor: graph.undoCursor,
		nodes,
		blocks,
		undoLog,
		chips
	};
}

// ---------------------------------------------------------------------------
// Hydrate
// ---------------------------------------------------------------------------

/**
 * Rebuild a DocumentGraph from loaded rows and verify reproducibility:
 * decode rows, insert blocks in canonical order and nodes with their stored
 * inputs, restore the undo log and cursor, then re-evaluate the entire graph
 * from inputs and compare every re-derived contentHash against the stored
 * one. Pure — no Convex client involved — so tests and CI exercise exactly
 * the code path the app loads through.
 */
export function hydrateGraph(
	rows: LoadedRows,
	opts?: { registry?: FunctionRegistry }
): HydrateResult {
	const graph = new DocumentGraph();

	// Blocks, in canonical blocksOrder (insertBlock renumbers positions to match).
	const blockRows = new Map(rows.blocks.map((row) => [row.blockId, row]));
	const orderedIds = [
		...rows.document.blocksOrder.filter((id) => blockRows.has(id)),
		// Stray rows missing from blocksOrder (should not happen — keep them anyway).
		...rows.blocks.map((row) => row.blockId).filter((id) => !rows.document.blocksOrder.includes(id))
	];
	for (const blockId of orderedIds) {
		const row = blockRows.get(blockId);
		if (!row) continue;
		const decoded = fromConvexJson<PersistedBlock & { docId?: string }>(row);
		const block: Block = {
			id: decoded.blockId,
			docId: decoded.docId ?? '',
			type: decoded.type as Block['type'],
			position: 0,
			...(decoded.pm !== undefined && { pm: decoded.pm }),
			...(decoded.image !== undefined && { image: decoded.image }),
			...(decoded.viewer !== undefined && { viewer: decoded.viewer as Block['viewer'] })
		};
		graph.insertBlock(block);
	}

	// Nodes: first pass inserts everything with stored inputs verbatim; second
	// pass re-registers formula nodes so the unresolved-ref healing index is
	// derived against the COMPLETE graph (insertion order must not matter).
	for (const row of rows.nodes) {
		const decoded = fromConvexJson<PersistedNode>(row);
		const node: GraphNode = {
			id: decoded.nodeId,
			kind: decoded.kind as GraphNode['kind'],
			value: decoded.value as TypedValue,
			inputs: decoded.inputs,
			contentHash: decoded.contentHash,
			provenance: decoded.provenance as Provenance,
			...(decoded.name !== undefined && { name: decoded.name }),
			...(decoded.formula !== undefined && { formula: decoded.formula as FormulaAST }),
			...(decoded.blockId !== undefined && { blockId: decoded.blockId }),
			...(decoded.cellRef !== undefined && { cellRef: decoded.cellRef }),
			...(decoded.pending !== undefined && { pending: decoded.pending as GraphNode['pending'] })
		};
		graph.insertNode(node);
	}
	for (const node of [...graph.nodes.values()]) {
		if (node.formula) graph.replaceNode(node); // snapshot: replaceNode mutates the map
	}

	// Chips + undo history.
	for (const row of rows.chips) {
		const decoded = fromConvexJson<PersistedChip>(row);
		const chip: ChipBinding = {
			id: decoded.chipId,
			blockId: decoded.blockId,
			nodeId: decoded.nodeId,
			...(decoded.format !== undefined && { format: decoded.format })
		};
		graph.chips.set(chip.id, chip);
	}
	graph.undoLog = [...rows.undoLog]
		.sort((a, b) => a.seq - b.seq)
		.map((row) => {
			const decoded = fromConvexJson<PersistedUndoEntry>(row);
			return {
				seq: decoded.seq,
				mutation: decoded.mutation as GraphMutation,
				inverse: decoded.inverse as GraphMutation[],
				actor: decoded.actor as Actor,
				at: decoded.at
			} satisfies UndoEntry;
		});
	graph.undoCursor = rows.document.undoCursor;

	// Reproducibility check (SCHEMA.md §5): re-evaluate the whole graph from
	// inputs — seeding every node bypasses the memo — and compare re-derived
	// hashes against what was stored.
	const stored = new Map<NodeId, string>();
	for (const node of graph.nodes.values()) stored.set(node.id, node.contentHash);
	// V1-5-4: verify with the derivation-capable evaluator — live sessions
	// settle `SHOWSTEPS(ref)` cells to derivation text, so the verification
	// recalc must reproduce that text or every saved SHOWSTEPS node would
	// report a contentHash mismatch on reload.
	recalc(graph, [...graph.nodes.keys()], {
		registry: opts?.registry ?? createBuiltinRegistry(),
		evaluate: evaluateWithDerivations(graph)
	});
	const mismatches: HydrateResult['mismatches'] = [];
	for (const node of graph.nodes.values()) {
		const before = stored.get(node.id) ?? '';
		if (node.contentHash !== before) {
			mismatches.push({ nodeId: node.id, stored: before, derived: node.contentHash });
		}
	}
	return { graph, mismatches };
}
