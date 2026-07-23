import type {
	Block,
	ChipBinding,
	DocumentGraph,
	GraphNode,
	UndoEntry,
	WorkbookManifest
} from '../../engine';
import { toConvexJson } from '../codec';
import type {
	LoadedRows,
	PersistedBlock,
	PersistedChip,
	PersistedNode,
	PersistedUndoEntry
} from '../serialize';

/** Authored state stored locally with product identities intact. */
export interface LocalAuthoredSnapshot {
	blocksOrder: string[];
	workbookManifest: WorkbookManifest;
	nodes: GraphNode[];
	blocks: Block[];
	chips: ChipBinding[];
}

/** Browser-only chronological history for one working copy. */
export interface LocalUndoSnapshot {
	undoCursor: number;
	undoLog: UndoEntry[];
}

/** Structurally local graph generation; cloud persistence cannot accept this shape. */
export interface LocalGraphSnapshot {
	authored: LocalAuthoredSnapshot;
	history: LocalUndoSnapshot;
}

/** Capture authored graph state and unified undo state into one local snapshot. */
export function serializeLocalGraph(graph: DocumentGraph): LocalGraphSnapshot {
	return {
		authored: {
			blocksOrder: [...graph.blocksOrder],
			workbookManifest: structuredClone(graph.workbook),
			nodes: structuredClone([...graph.nodes.values()].sort((a, b) => a.id.localeCompare(b.id))),
			blocks: structuredClone(
				[...graph.blocks.values()].sort(
					(a, b) => a.position - b.position || a.id.localeCompare(b.id)
				)
			),
			chips: structuredClone([...graph.chips.values()].sort((a, b) => a.id.localeCompare(b.id)))
		},
		history: {
			undoCursor: graph.undoCursor,
			undoLog: structuredClone([...graph.undoLog].sort((a, b) => a.seq - b.seq))
		}
	};
}

/**
 * Adapt a local snapshot to the existing graph hydrator. Encoding happens at
 * this compatibility edge; the IndexedDB record itself uses local engine
 * shapes and retains each block's product document id.
 */
export function localGraphRows(snapshot: LocalGraphSnapshot): LoadedRows {
	return {
		document: {
			blocksOrder: snapshot.authored.blocksOrder,
			undoCursor: snapshot.history.undoCursor,
			workbookManifest: snapshot.authored.workbookManifest
		},
		nodes: snapshot.authored.nodes.map((node) =>
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
		),
		blocks: snapshot.authored.blocks.map((block) =>
			toConvexJson<PersistedBlock & { docId: string }>({
				blockId: block.id,
				docId: block.docId,
				type: block.type,
				position: block.position,
				pm: block.pm,
				image: block.image,
				equation: block.equation
			})
		),
		undoLog: snapshot.history.undoLog.map((entry) =>
			toConvexJson<PersistedUndoEntry>({
				seq: entry.seq,
				mutation: entry.mutation,
				inverse: entry.inverse,
				actor: entry.actor,
				at: entry.at
			})
		),
		chips: snapshot.authored.chips.map((chip) =>
			toConvexJson<PersistedChip>({
				chipId: chip.id,
				blockId: chip.blockId,
				nodeId: chip.nodeId,
				format: chip.format
			})
		)
	};
}
