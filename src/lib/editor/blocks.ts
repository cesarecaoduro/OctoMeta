/**
 * Pure PM-JSON ⇄ Block mapping (V1-5-1). The graph is the source of truth for
 * block structure and content (SCHEMA.md §8); the TipTap doc is a projection.
 * Each top-level PM node carries a `blockId` attribute linking it to its
 * graph block; these helpers classify nodes, strip/stamp that attribute, and
 * render a whole TipTap doc from graph blocks. No TipTap runtime imports —
 * everything here works on plain JSON, so it unit-tests in node.
 */

import type { Block } from '../engine';
import { emptyEquation, normalizeEquationPayload, stableStringify } from '../engine';

/** Minimal PM node JSON — structurally identical to TipTap's JSONContent. */
export interface PMJson {
	type: string;
	attrs?: Record<string, unknown>;
	content?: PMJson[];
	marks?: unknown[];
	text?: string;
	[key: string]: unknown;
}

/** The name of the TipTap node type that renders image blocks (image-node.ts). */
export const IMAGE_NODE_NAME = 'imageBlock';

/** The name of the TipTap node type that renders equation blocks. */
export const EQUATION_NODE_NAME = 'equationBlock';

/**
 * Block types this editor owns. Sheet blocks joined in V1-5-2: their structure
 * (add/remove/move) reconciles like any other block, while their content lives
 * in the graph + `sheetSnapshots`, never in the PM doc.
 */
export const MANAGED_BLOCK_TYPES: readonly Block['type'][] = [
	'text',
	'heading',
	'image',
	'equation'
];

/** What a top-level PM node wants its graph block to look like. */
export interface BlockSpec {
	type: 'text' | 'heading' | 'image' | 'equation';
	/** Present on text/heading specs: the node's PM JSON without the blockId attr. */
	pm?: PMJson;
	/** Present on image specs (SCHEMA.md §8). */
	image?: { storageId: string; alt?: string; caption?: string };
	/** Present on equation specs. */
	equation?: Block['equation'];
}

/** A shallow clone of `node` without its top-level `blockId` attribute. */
export function stripBlockId(node: PMJson): PMJson {
	if (node.attrs === undefined || !('blockId' in node.attrs)) return node;
	const { blockId: _blockId, ...rest } = node.attrs;
	const clone: PMJson = { ...node };
	if (Object.keys(rest).length > 0) clone.attrs = rest;
	else delete clone.attrs;
	return clone;
}

/** The blockId attribute of a top-level PM node, or null when unassigned. */
export function blockIdOf(node: PMJson): string | null {
	const id = node.attrs?.blockId;
	return typeof id === 'string' && id !== '' ? id : null;
}

/**
 * Classify a top-level PM node into the block it projects (SCHEMA.md §8):
 * `heading` nodes → heading blocks, `imageBlock` nodes → image blocks,
 * every other top-level node (paragraph, lists, blockquote, code) → text.
 */
export function specFromPmNode(node: PMJson): BlockSpec {
	if (node.type === IMAGE_NODE_NAME) {
		const attrs = node.attrs ?? {};
		const image: NonNullable<BlockSpec['image']> = { storageId: String(attrs.storageId ?? '') };
		if (typeof attrs.alt === 'string' && attrs.alt !== '') image.alt = attrs.alt;
		if (typeof attrs.caption === 'string' && attrs.caption !== '') image.caption = attrs.caption;
		return { type: 'image', image };
	}
	if (node.type === EQUATION_NODE_NAME) {
		const payload = normalizeEquationPayload(node.attrs?.equation);
		if (payload) return { type: 'equation', equation: payload };
		return { type: 'equation', equation: emptyEquation() };
	}
	return { type: node.type === 'heading' ? 'heading' : 'text', pm: stripBlockId(node) };
}

/**
 * Render one graph block as a top-level PM node with its blockId stamped, or
 * null for a block type this editor does not render.
 */
export function pmNodeFromBlock(block: Block): PMJson | null {
	if (block.type === 'image') {
		return {
			type: IMAGE_NODE_NAME,
			attrs: {
				blockId: block.id,
				storageId: block.image?.storageId ?? '',
				alt: block.image?.alt ?? null,
				caption: block.image?.caption ?? null
			}
		};
	}
	if (block.type === 'equation') {
		return {
			type: EQUATION_NODE_NAME,
			attrs: {
				blockId: block.id,
				equation: normalizeEquationPayload(block.equation) ?? emptyEquation()
			}
		};
	}
	if (block.type !== 'text' && block.type !== 'heading') return null;
	const pm = (block.pm as PMJson | undefined) ?? { type: 'paragraph' };
	return { ...pm, attrs: { ...(pm.attrs ?? {}), blockId: block.id } };
}

/**
 * Render a whole TipTap doc from blocks in canonical order. An empty document
 * renders as one unassigned paragraph (reconciled into a block on first edit).
 */
export function pmDocFromBlocks(blocks: readonly Block[]): PMJson {
	const content = blocks
		.map((block) => pmNodeFromBlock(block))
		.filter((node): node is PMJson => node !== null);
	return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] };
}

/** Deterministic deep equality over PM/image JSON (engine `stableStringify`). */
export function jsonEqual(a: unknown, b: unknown): boolean {
	return stableStringify(a) === stableStringify(b);
}
