import { describe, expect, it } from 'vitest';
import {
	applyMutation,
	DocumentGraph,
	emptyProvenance,
	listPublishedValues,
	parseFormula,
	publishedValueUses,
	scalar,
	type GraphMutation
} from '.';

const HUMAN = { kind: 'human' } as const;
const SHEET = 'sheet-inputs';

function must(mutation: ReturnType<typeof applyMutation>): void {
	if (!mutation.ok) throw new Error(mutation.error.message);
}

function setup(): DocumentGraph {
	const graph = new DocumentGraph({
		sheets: [{ id: SHEET, name: 'Inputs', position: 0 }]
	});
	must(
		applyMutation(
			graph,
			{
				op: 'addNode',
				node: {
					id: 'cell-span',
					kind: 'input',
					cellRef: { sheetId: SHEET, a1: 'B4' },
					provenance: emptyProvenance()
				}
			},
			HUMAN
		)
	);
	must(applyMutation(graph, { op: 'setInput', id: 'cell-span', value: scalar(6) }, HUMAN));
	return graph;
}

describe('published values', () => {
	it('publishes searchable metadata for one scalar source cell', () => {
		const graph = setup();
		must(
			applyMutation(
				graph,
				{
					op: 'publishName',
					cellRef: { sheetId: SHEET, a1: 'B4' },
					name: 'beam.span',
					publication: {
						label: 'Beam span',
						unit: 'm',
						description: 'Clear distance between supports'
					}
				},
				HUMAN
			)
		);

		expect(listPublishedValues(graph, 'supports')).toEqual([
			expect.objectContaining({
				id: expect.any(String),
				name: 'beam.span',
				label: 'Beam span',
				unit: 'm',
				description: 'Clear distance between supports',
				value: scalar(6),
				sheetId: SHEET,
				sheet: 'Inputs',
				cell: 'B4'
			})
		]);
		expect(listPublishedValues(graph, 'unrelated')).toEqual([]);
	});

	it('accepts only canonical catalogue units at the publication boundary', () => {
		const graph = setup();
		expect(
			applyMutation(
				graph,
				{
					op: 'publishName',
					cellRef: { sheetId: SHEET, a1: 'B4' },
					name: 'beam.load',
					publication: { unit: 'kn' }
				},
				HUMAN
			)
		).toMatchObject({
			ok: false,
			error: { message: expect.stringContaining('canonical catalogue unit') }
		});

		must(
			applyMutation(
				graph,
				{
					op: 'publishName',
					cellRef: { sheetId: SHEET, a1: 'B4' },
					name: 'beam.load',
					publication: { unit: 'kN' }
				},
				HUMAN
			)
		);
		const publicationId = graph.resolveRef({ name: 'beam.load' })!;
		expect(
			applyMutation(
				graph,
				{ op: 'updatePublication', nodeId: publicationId, publication: { unit: 'kn' } },
				HUMAN
			)
		).toMatchObject({ ok: false });
		expect(graph.nodes.get(publicationId)?.publication?.unit).toBe('kN');
	});

	it('renames metadata without changing identity or existing references', () => {
		const graph = setup();
		must(
			applyMutation(
				graph,
				{
					op: 'publishName',
					cellRef: { sheetId: SHEET, a1: 'B4' },
					name: 'beam.span',
					publication: { label: 'Beam span' }
				},
				HUMAN
			)
		);
		const publicationId = graph.resolveRef({ name: 'beam.span' })!;
		graph.insertBlock({
			id: 'narrative',
			docId: 'doc',
			type: 'text',
			position: 0
		});
		graph.insertBlock({
			id: 'equation',
			docId: 'doc',
			type: 'equation',
			position: 1,
			equation: {
				version: 1,
				segments: [
					{
						kind: 'reference',
						nodeId: publicationId,
						fallback: { name: 'beam.span' }
					}
				]
			}
		});
		graph.chips.set('span-chip', {
			id: 'span-chip',
			blockId: 'narrative',
			nodeId: publicationId
		});

		must(
			applyMutation(
				graph,
				{ op: 'renameName', nodeId: publicationId, name: 'geometry.clearSpan' },
				HUMAN
			)
		);
		must(
			applyMutation(
				graph,
				{
					op: 'updatePublication',
					nodeId: publicationId,
					publication: { label: 'Clear span', unit: 'm' }
				},
				HUMAN
			)
		);

		expect(graph.resolveRef({ name: 'geometry.clearSpan' })).toBe(publicationId);
		expect(graph.chips.get('span-chip')?.nodeId).toBe(publicationId);
		expect(graph.blocks.get('equation')?.equation?.segments[0]).toMatchObject({
			kind: 'reference',
			nodeId: publicationId,
			fallback: { name: 'geometry.clearSpan' }
		});
		expect(listPublishedValues(graph)[0]).toMatchObject({
			id: publicationId,
			name: 'geometry.clearSpan',
			label: 'Clear span',
			unit: 'm'
		});
	});

	it('discloses every use before removal and leaves stable repair seams behind', () => {
		const graph = setup();
		must(
			applyMutation(
				graph,
				{
					op: 'publishName',
					cellRef: { sheetId: SHEET, a1: 'B4' },
					name: 'beam.span'
				},
				HUMAN
			)
		);
		const publicationId = graph.resolveRef({ name: 'beam.span' })!;
		graph.insertBlock({
			id: 'narrative',
			docId: 'doc',
			type: 'text',
			position: 0
		});
		graph.insertBlock({
			id: 'equation',
			docId: 'doc',
			type: 'equation',
			position: 1,
			equation: {
				version: 1,
				segments: [
					{
						kind: 'reference',
						nodeId: publicationId,
						fallback: { name: 'beam.span', sheetId: SHEET, cell: 'B4' }
					}
				]
			}
		});
		graph.chips.set('span-chip', {
			id: 'span-chip',
			blockId: 'narrative',
			nodeId: publicationId
		});
		const parsed = parseFormula('=beam.span * 2', { sheetId: SHEET });
		if (!parsed.ok) throw new Error(parsed.message);
		const computed: GraphMutation = {
			op: 'addNode',
			node: {
				id: 'cell-double-span',
				kind: 'computed',
				cellRef: { sheetId: SHEET, a1: 'C4' },
				formula: parsed.ast,
				provenance: emptyProvenance()
			}
		};
		must(applyMutation(graph, computed, HUMAN));
		const graphExpression: GraphMutation = {
			op: 'addNode',
			node: {
				id: 'graph-double-span',
				kind: 'computed',
				blockId: 'equation',
				formula: parsed.ast,
				provenance: emptyProvenance()
			}
		};
		must(applyMutation(graph, graphExpression, HUMAN));

		expect(publishedValueUses(graph, publicationId)).toEqual([
			{
				kind: 'document-reference',
				id: 'span-chip',
				label: 'Document block narrative'
			},
			{
				kind: 'equation-reference',
				id: 'equation',
				label: 'Equation block equation'
			},
			{
				kind: 'workbook-formula',
				id: 'cell-double-span',
				label: 'Inputs · C4'
			},
			{
				kind: 'graph-dependent',
				id: 'graph-double-span',
				label: 'Graph expression in block equation'
			}
		]);

		must(applyMutation(graph, { op: 'removeNode', id: publicationId }, HUMAN));
		expect(graph.chips.get('span-chip')?.nodeId).toBe(publicationId);
		expect(graph.blocks.get('equation')?.equation?.segments).toContainEqual(
			expect.objectContaining({ kind: 'reference', nodeId: publicationId })
		);
		expect(graph.nodes.get('cell-double-span')?.inputs).toEqual([]);
	});
});
