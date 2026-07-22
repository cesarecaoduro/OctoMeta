import { describe, expect, it } from 'vitest';
import {
	DocumentGraph,
	collectRefs,
	nodeOpId,
	refKey,
	resolvePublishedTarget,
	stableStringify
} from './graph';
import { emptyProvenance, type GraphNode } from './node';
import { parseFormula } from './formula';
import { scalar, errorValue } from './types';

function node(partial: Partial<GraphNode> & { id: string }): GraphNode {
	return {
		kind: 'input',
		value: scalar(1),
		inputs: [],
		contentHash: '',
		provenance: emptyProvenance(),
		...partial
	};
}

describe('stableStringify', () => {
	it('sorts object keys and skips undefined values', () => {
		expect(stableStringify({ b: 1, a: 2, c: undefined })).toBe('{"a":2,"b":1}');
		expect(stableStringify([1, { z: 0, a: [true, null] }])).toBe('[1,{"a":[true,null],"z":0}]');
		expect(stableStringify('x')).toBe('"x"');
	});
});

describe('nodeOpId', () => {
	it('uses the canonical formula text when present, else the stable value JSON', () => {
		const p = parseFormula('=A1 + 2', { sheetId: 's' });
		if (!p.ok) throw new Error(p.message);
		expect(nodeOpId(node({ id: 'a', kind: 'computed', formula: p.ast }))).toBe('computed:A1 + 2');
		expect(nodeOpId(node({ id: 'b', value: scalar(3) }))).toBe('input:{"kind":"scalar","value":3}');
	});
});

describe('refKey / collectRefs', () => {
	it('keeps cell and name keyspaces distinct and collects all refs', () => {
		expect(refKey({ name: 'beam.span' })).not.toBe(refKey({ sheetId: 'beam', a1: 'span' }));
		const p = parseFormula('=A1 + beam.span + SUM(B1, A1)', { sheetId: 's' });
		if (!p.ok) throw new Error(p.message);
		const refs = collectRefs(p.ast);
		expect(refs).toHaveLength(3); // A1, beam.span, B1 — A1 deduplicated
	});
});

describe('DocumentGraph store', () => {
	it('owns a normalized, non-empty workbook manifest', () => {
		const doc = new DocumentGraph({
			sheets: [
				{ id: 'b', name: 'Output', position: 9 },
				{ id: 'a', name: 'Input', position: 3 }
			]
		});
		expect(doc.workbook.sheets).toEqual([
			{ id: 'b', name: 'Output', position: 0 },
			{ id: 'a', name: 'Input', position: 1 }
		]);
	});

	it('resolves exactly one published alias hop', () => {
		const doc = new DocumentGraph();
		doc.insertNode(node({ id: 'input', kind: 'input' }));
		doc.insertNode(node({ id: 'alias', kind: 'namedOutput', name: 'beam.depth', inputs: ['input'] }));
		expect(resolvePublishedTarget(doc, 'alias')).toEqual({
			publishedNode: doc.nodes.get('alias'),
			targetNode: doc.nodes.get('input')
		});
		expect(resolvePublishedTarget(doc, 'input')).toBeNull();
	});

	it('indexes names, cellRefs, reverse edges, and unresolved refs incrementally', () => {
		const doc = new DocumentGraph();
		doc.insertNode(node({ id: 'a', cellRef: { sheetId: 's', a1: 'A1' } }));
		const p = parseFormula('=A1 + beam.span', { sheetId: 's' });
		if (!p.ok) throw new Error(p.message);
		doc.insertNode(
			node({
				id: 'c',
				kind: 'computed',
				formula: p.ast,
				inputs: ['a'],
				value: errorValue('#NAME?', 'unknown name "beam.span"', 'c')
			})
		);
		expect(doc.resolveRef({ sheetId: 's', a1: 'A1' })).toBe('a');
		expect(doc.resolveRef({ name: 'beam.span' })).toBeUndefined();
		expect(doc.dependentsOf('a')).toEqual(['c']);
		expect(doc.waitersFor(refKey({ name: 'beam.span' }))).toEqual(['c']);
		doc.deleteNode('c');
		expect(doc.dependentsOf('a')).toEqual([]);
		expect(doc.waitersFor(refKey({ name: 'beam.span' }))).toEqual([]);
	});

	it('block store keeps blocksOrder and positions in lockstep', () => {
		const doc = new DocumentGraph();
		doc.insertBlock({ id: 'b1', docId: 'd', type: 'text', position: 0 });
		doc.insertBlock({ id: 'b2', docId: 'd', type: 'text', position: 0 }, 0);
		doc.moveBlock('b2', 5); // clamped to end
		expect(doc.blocksOrder).toEqual(['b1', 'b2']);
		doc.blocksOrder.forEach((id, i) => expect(doc.blocks.get(id)?.position).toBe(i));
		doc.deleteBlock('b1');
		expect(doc.blocksOrder).toEqual(['b2']);
		expect(doc.blocks.get('b2')?.position).toBe(0);
	});

	it('subscribe/notify targets one node; unsubscribe stops delivery', () => {
		const doc = new DocumentGraph();
		doc.insertNode(node({ id: 'a' }));
		doc.insertNode(node({ id: 'b' }));
		const seen: string[] = [];
		const off = doc.subscribe('a', (n) => seen.push(n.id));
		doc.notify('a');
		doc.notify('b'); // no subscriber — no delivery
		expect(seen).toEqual(['a']);
		off();
		doc.notify('a');
		expect(seen).toEqual(['a']);
	});

	it('refreshHash hashes opId with input hashes in order', () => {
		const doc = new DocumentGraph();
		doc.insertNode(node({ id: 'a' }));
		doc.refreshHash('a');
		const h1 = doc.nodes.get('a')?.contentHash;
		expect(h1).toBeTruthy();
		doc.nodes.get('a')!.value = scalar(9);
		doc.refreshHash('a');
		expect(doc.nodes.get('a')?.contentHash).not.toBe(h1);
	});
});
