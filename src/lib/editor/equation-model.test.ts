import { describe, expect, it } from 'vitest';
import {
	applyMutation,
	DocumentGraph,
	emptyProvenance,
	scalar,
	type EquationPayload
} from '../engine';
import {
	equationMathfieldModel,
	equationPayloadFromMathfield,
	equationPayloadFromSource,
	equationSourceModel
} from './equation-model';

const HUMAN = { kind: 'human' } as const;

function publishedGraph(): { graph: DocumentGraph; publicationId: string } {
	const graph = new DocumentGraph({
		sheets: [{ id: 'sheet', name: 'Inputs', position: 0 }]
	});
	const add = applyMutation(
		graph,
		{
			op: 'addNode',
			node: {
				id: 'cell',
				kind: 'input',
				cellRef: { sheetId: 'sheet', a1: 'A1' },
				provenance: emptyProvenance()
			}
		},
		HUMAN
	);
	if (!add.ok) throw new Error(add.error.message);
	const set = applyMutation(graph, { op: 'setInput', id: 'cell', value: scalar(12) }, HUMAN);
	if (!set.ok) throw new Error(set.error.message);
	const publish = applyMutation(
		graph,
		{ op: 'publishName', cellRef: { sheetId: 'sheet', a1: 'A1' }, name: 'beam.load' },
		HUMAN
	);
	if (!publish.ok) throw new Error(publish.error.message);
	return { graph, publicationId: graph.resolveRef({ name: 'beam.load' })! };
}

describe('equation MathLive projection', () => {
	it('round-trips stable reference atoms while authored notation changes around them', () => {
		const { graph, publicationId } = publishedGraph();
		const payload: EquationPayload = {
			version: 1,
			segments: [
				{ kind: 'latex', latex: 'w=' },
				{
					kind: 'reference',
					nodeId: publicationId,
					fallback: { name: 'beam.load', sheetId: 'sheet', cell: 'A1' }
				},
				{ kind: 'latex', latex: '/L' }
			]
		};

		const model = equationMathfieldModel(payload, graph);
		expect(model.latex).toBe('w=\\octorefa{}/L');
		expect(equationPayloadFromMathfield(`2(${model.latex})`, model.references)).toEqual({
			version: 1,
			segments: [
				{ kind: 'latex', latex: '2(w=' },
				payload.segments[1],
				{ kind: 'latex', latex: '/L)' }
			]
		});
	});

	it('exposes readable source syntax without leaking MathLive projection macros', () => {
		const { graph, publicationId } = publishedGraph();
		const reference = {
			kind: 'reference' as const,
			nodeId: publicationId,
			fallback: { name: 'beam.load', sheetId: 'sheet', cell: 'A1' }
		};
		const payload: EquationPayload = {
			version: 1,
			segments: [
				{ kind: 'latex', latex: 'w=' },
				reference,
				{ kind: 'latex', latex: '/L' }
			]
		};

		const model = equationSourceModel(payload, graph);
		expect(model.source).toBe('w=\\value{beam.load}/L');
		expect(model.source).not.toContain('octoref');
		expect(equationPayloadFromSource(`2(${model.source})`, model.references, graph)).toEqual({
			version: 1,
			segments: [
				{ kind: 'latex', latex: '2(w=' },
				reference,
				{ kind: 'latex', latex: '/L)' }
			]
		});
	});

	it('updates presentation after rename without changing the stored reference', () => {
		const { graph, publicationId } = publishedGraph();
		const payload: EquationPayload = {
			version: 1,
			segments: [
				{
					kind: 'reference',
					nodeId: publicationId,
					fallback: { name: 'beam.load' }
				}
			]
		};
		const rename = applyMutation(
			graph,
			{ op: 'renameName', nodeId: publicationId, name: 'beam.designLoad' },
			HUMAN
		);
		if (!rename.ok) throw new Error(rename.error.message);
		const metadata = applyMutation(
			graph,
			{
				op: 'updatePublication',
				nodeId: publicationId,
				publication: { unit: 'kN' }
			},
			HUMAN
		);
		if (!metadata.ok) throw new Error(metadata.error.message);

		const model = equationMathfieldModel(payload, graph);
		expect(model.references[0]).toMatchObject({
			segment: payload.segments[0],
			label: 'beam.designLoad',
			broken: false
		});
		expect(model.macros.octorefa).toMatchObject({
			def: expect.stringContaining('12\\,kN')
		});
		expect(model.macros.octorefa).not.toMatchObject({
			def: expect.stringContaining('\\underbrace')
		});
	});
});
