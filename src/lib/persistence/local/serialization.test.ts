import { describe, expect, it } from 'vitest';
import { DocumentGraph } from '../../engine';
import { hydrateGraph } from '../serialize';
import { localGraphRows, serializeLocalGraph } from './serialization';

describe('local graph serialization', () => {
	it('round-trips product document identity independently from cloud row ids', () => {
		const graph = new DocumentGraph();
		graph.insertBlock({
			id: 'block-local',
			docId: 'product-document-01',
			type: 'text',
			position: 0,
			pm: { type: 'paragraph', content: [{ type: 'text', text: 'Stored locally' }] }
		});

		const snapshot = serializeLocalGraph(graph);
		expect(snapshot.authored.blocks[0]?.docId).toBe('product-document-01');

		const { graph: hydrated, mismatches } = hydrateGraph(localGraphRows(snapshot));
		expect(mismatches).toEqual([]);
		expect(hydrated.blocks.get('block-local')).toMatchObject({
			docId: 'product-document-01',
			pm: { type: 'paragraph', content: [{ type: 'text', text: 'Stored locally' }] }
		});
	});
});
