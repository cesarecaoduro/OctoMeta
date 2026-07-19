/**
 * SCHEMA.md §8 — the document & block model as pure data types. Blocks are
 * layout containers: `position` is layout ONLY (evaluation never reads it,
 * SCHEMA.md §5). Sheet blocks host Univer snapshots; chips bind prose to graph
 * nodes by stable NodeId so bindings survive reordering.
 */

import type { BlockId, NodeId } from './types';

/** Block types. V1 ships the first four; 'equation' and 'viewer' are V2. */
export type BlockType = 'text' | 'heading' | 'image' | 'sheet' | 'equation' | 'viewer';

/** Every block type, for validation and iteration. */
export const BLOCK_TYPES: readonly BlockType[] = [
	'text',
	'heading',
	'image',
	'sheet',
	'equation',
	'viewer'
];

/** One document block (SCHEMA.md §8). Type-specific payloads are optional. */
export interface Block {
	id: BlockId;
	docId: string;
	type: BlockType;
	/** Layout ONLY (SCHEMA.md §5) — denormalized copy of the blocksOrder index. */
	position: number;
	/** text/heading/equation content (ProseMirror JSON; markdown is an input convention). */
	pm?: unknown;
	/** Image blocks: Convex file storage reference. */
	image?: { storageId: string; alt?: string; caption?: string };
	/** Sheet blocks: opaque Univer workbook snapshot. */
	univerSnapshot?: unknown;
	/** Viewer blocks (V2): bound geometry nodes + opaque camera state. */
	viewer?: { boundHandles: 'auto' | NodeId[]; camera?: unknown };
}

/** An inline value chip: binds a spot in prose to a graph node (SCHEMA.md §8). */
export interface ChipBinding {
	id: string;
	blockId: BlockId;
	nodeId: NodeId;
	format?: { digits?: number; unit?: string };
}
