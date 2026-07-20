import { describe, expect, it } from 'vitest';
import type { Block } from '../engine';
import {
	blockIdOf,
	jsonEqual,
	pmDocFromBlocks,
	pmNodeFromBlock,
	specFromPmNode,
	stripBlockId
} from './blocks';

const block = (partial: Partial<Block> & Pick<Block, 'id' | 'type'>): Block => ({
	docId: 'doc1',
	position: 0,
	...partial
});

describe('stripBlockId / blockIdOf', () => {
	it('removes only the blockId attribute, dropping attrs when empty', () => {
		expect(stripBlockId({ type: 'paragraph', attrs: { blockId: 'b1' } })).toEqual({
			type: 'paragraph'
		});
		expect(stripBlockId({ type: 'heading', attrs: { blockId: 'b1', level: 2 } })).toEqual({
			type: 'heading',
			attrs: { level: 2 }
		});
	});

	it('leaves nodes without a blockId untouched', () => {
		const node = { type: 'paragraph', attrs: { textAlign: 'left' } };
		expect(stripBlockId(node)).toBe(node);
	});

	it('blockIdOf reads only non-empty string ids', () => {
		expect(blockIdOf({ type: 'paragraph', attrs: { blockId: 'b1' } })).toBe('b1');
		expect(blockIdOf({ type: 'paragraph', attrs: { blockId: null } })).toBeNull();
		expect(blockIdOf({ type: 'paragraph' })).toBeNull();
	});
});

describe('specFromPmNode', () => {
	it('classifies paragraphs and lists as text with blockId stripped', () => {
		const spec = specFromPmNode({
			type: 'bulletList',
			attrs: { blockId: 'b1' },
			content: [{ type: 'listItem' }]
		});
		expect(spec.type).toBe('text');
		expect(spec.pm).toEqual({ type: 'bulletList', content: [{ type: 'listItem' }] });
	});

	it('classifies headings as heading blocks', () => {
		const spec = specFromPmNode({ type: 'heading', attrs: { level: 1, blockId: 'b1' } });
		expect(spec.type).toBe('heading');
		expect(spec.pm).toEqual({ type: 'heading', attrs: { level: 1 } });
	});

	it('classifies imageBlock nodes into SCHEMA §8 image payloads', () => {
		const spec = specFromPmNode({
			type: 'imageBlock',
			attrs: { blockId: 'b1', storageId: 'st1', alt: 'a beam', caption: null }
		});
		expect(spec).toEqual({ type: 'image', image: { storageId: 'st1', alt: 'a beam' } });
	});

	it('classifies sheetBlock nodes as structure-only sheet specs (no pm payload)', () => {
		const spec = specFromPmNode({ type: 'sheetBlock', attrs: { blockId: 'b1' } });
		expect(spec).toEqual({ type: 'sheet' });
	});
});

describe('pmNodeFromBlock / pmDocFromBlocks', () => {
	it('stamps the block id onto prose nodes', () => {
		const node = pmNodeFromBlock(
			block({ id: 'b1', type: 'heading', pm: { type: 'heading', attrs: { level: 2 } } })
		);
		expect(node).toEqual({ type: 'heading', attrs: { level: 2, blockId: 'b1' } });
	});

	it('renders image blocks as imageBlock nodes', () => {
		const node = pmNodeFromBlock(
			block({ id: 'b2', type: 'image', image: { storageId: 'st1', caption: 'fig 1' } })
		);
		expect(node).toEqual({
			type: 'imageBlock',
			attrs: { blockId: 'b2', storageId: 'st1', alt: null, caption: 'fig 1' }
		});
	});

	it('renders sheet blocks as empty sheetBlock atoms (content lives in the graph)', () => {
		expect(pmNodeFromBlock(block({ id: 'b3', type: 'sheet' }))).toEqual({
			type: 'sheetBlock',
			attrs: { blockId: 'b3' }
		});
	});

	it('skips unmanaged block types (viewer, V2) and defaults empty docs to a paragraph', () => {
		expect(pmNodeFromBlock(block({ id: 'b4', type: 'viewer' }))).toBeNull();
		expect(pmDocFromBlocks([block({ id: 'b4', type: 'viewer' })])).toEqual({
			type: 'doc',
			content: [{ type: 'paragraph' }]
		});
		expect(pmDocFromBlocks([])).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
	});

	it('round-trips: render → classify reproduces the stored pm', () => {
		const stored = {
			type: 'paragraph',
			content: [{ type: 'text', text: 'hello', marks: [{ type: 'bold' }] }]
		};
		const rendered = pmNodeFromBlock(block({ id: 'b1', type: 'text', pm: stored }));
		const spec = specFromPmNode(rendered!);
		expect(jsonEqual(spec.pm, stored)).toBe(true);
	});
});
