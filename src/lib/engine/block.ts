/**
 * SCHEMA.md §8 — the document & block model as pure data types. Blocks are
 * layout containers: `position` is layout ONLY (evaluation never reads it,
 * SCHEMA.md §5). The document workbook is separate from report blocks; chips
 * bind prose to graph nodes by stable NodeId so bindings survive reordering.
 */

import type { BlockId, NodeId } from './types';

/** Final R1 report block union. Workbook tabs are not report blocks. */
export type BlockType = 'text' | 'heading' | 'image' | 'equation';

/** Every block type, for validation and iteration. */
export const BLOCK_TYPES: readonly BlockType[] = ['text', 'heading', 'image', 'equation'];

/** Persisted payload for a report equation block. */
export type EquationPayload =
	| {
			mode: 'bound';
			nodeId: NodeId;
			display: 'symbolic' | 'substituted' | 'result' | 'steps';
	  }
	| {
			mode: 'static';
			tex: string;
	  };

/** One document block (SCHEMA.md §8). Type-specific payloads are optional. */
export interface Block {
	id: BlockId;
	docId: string;
	type: BlockType;
	/** Layout ONLY (SCHEMA.md §5) — denormalized copy of the blocksOrder index. */
	position: number;
	/** text/heading content (ProseMirror JSON; markdown is an input convention). */
	pm?: unknown;
	/** Image blocks: Convex file storage reference. */
	image?: { storageId: string; alt?: string; caption?: string };
	/** Equation blocks: exactly one static or graph-bound representation. */
	equation?: EquationPayload;
}

/** An inline value chip: binds a spot in prose to a graph node (SCHEMA.md §8). */
export interface ChipBinding {
	id: string;
	blockId: BlockId;
	nodeId: NodeId;
	format?: { digits?: number; unit?: string };
}
