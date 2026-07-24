import { describe, expect, it } from 'vitest';
import {
	applyMutation,
	beginEquationSessionHistory,
	cancelEquationSession,
	DocumentGraph,
	emptyProvenance,
	equationToTex,
	normalizeEquationPayload,
	redo,
	scalar,
	UNDO_CAP,
	undo,
	type EquationPayload
} from '.';

const HUMAN = { kind: 'human' } as const;
const SHEET = 'sheet-inputs';

function must(result: ReturnType<typeof applyMutation>): void {
	if (!result.ok) throw new Error(result.error.message);
}

function publishedGraph(): { graph: DocumentGraph; spanId: string; loadId: string } {
	const graph = new DocumentGraph({
		sheets: [{ id: SHEET, name: 'Inputs', position: 0 }]
	});
	for (const [id, a1, value, name] of [
		['cell-span', 'A1', 6, 'beam.span'],
		['cell-load', 'A2', 12, 'beam.load']
	] as const) {
		must(
			applyMutation(
				graph,
				{
					op: 'addNode',
					node: {
						id,
						kind: 'input',
						cellRef: { sheetId: SHEET, a1 },
						provenance: emptyProvenance()
					}
				},
				HUMAN
			)
		);
		must(applyMutation(graph, { op: 'setInput', id, value: scalar(value) }, HUMAN));
		must(applyMutation(graph, { op: 'publishName', cellRef: { sheetId: SHEET, a1 }, name }, HUMAN));
	}
	return {
		graph,
		spanId: graph.resolveRef({ name: 'beam.span' })!,
		loadId: graph.resolveRef({ name: 'beam.load' })!
	};
}

function composedEquation(spanId: string, loadId: string): EquationPayload {
	return {
		version: 1,
		segments: [
			{ kind: 'latex', latex: 'w=' },
			{
				kind: 'reference',
				nodeId: loadId,
				fallback: { name: 'beam.load', sheetId: SHEET, cell: 'A2' }
			},
			{ kind: 'latex', latex: '/' },
			{
				kind: 'reference',
				nodeId: spanId,
				fallback: { name: 'beam.span', sheetId: SHEET, cell: 'A1' }
			}
		]
	};
}

describe('composable equations', () => {
	it('stores authored notation and multiple stable references as one undoable block payload', () => {
		const { graph, spanId, loadId } = publishedGraph();
		const equation = composedEquation(spanId, loadId);

		must(
			applyMutation(
				graph,
				{
					op: 'blockOp',
					action: 'add',
					blockId: 'equation',
					block: { docId: 'doc', type: 'equation', equation }
				},
				HUMAN
			)
		);

		expect(graph.blocks.get('equation')?.equation).toEqual(equation);
		expect(undo(graph)).toMatchObject({ ok: true });
		expect(graph.blocks.has('equation')).toBe(false);
		expect(redo(graph)).toMatchObject({ ok: true });
		expect(graph.blocks.get('equation')?.equation).toEqual(equation);
	});

	it('substitutes current values without annotations and retains intent after removal', () => {
		const { graph, spanId, loadId } = publishedGraph();
		const equation = composedEquation(spanId, loadId);

		expect(equationToTex(equation, graph)).toContain('12');
		expect(equationToTex(equation, graph)).toContain('6');
		expect(equationToTex(equation, graph)).not.toContain('beam.load');
		expect(equationToTex(equation, graph)).not.toContain('beam.span');
		expect(equationToTex(equation, graph)).not.toContain('\\underbrace');
		must(
			applyMutation(
				graph,
				{ op: 'updatePublication', nodeId: loadId, publication: { unit: 'kN' } },
				HUMAN
			)
		);
		expect(equationToTex(equation, graph)).toContain('12\\,kN');

		must(applyMutation(graph, { op: 'renameName', nodeId: spanId, name: 'geometry.clearSpan' }, HUMAN));
		expect(equationToTex(equation, graph)).toContain('6');

		must(applyMutation(graph, { op: 'removeNode', id: spanId }, HUMAN));
		expect(equationToTex(equation, graph)).toContain('Missing: beam.span');
		expect(equation.segments[3]).toEqual({
			kind: 'reference',
			nodeId: spanId,
			fallback: { name: 'beam.span', sheetId: SHEET, cell: 'A1' }
		});
	});

	it('rejects legacy, malformed, and over-complex equation payloads', () => {
		const graph = new DocumentGraph();
		const add = (blockId: string, equation: unknown) =>
			applyMutation(
				graph,
				{
					op: 'blockOp',
					action: 'add',
					blockId,
					block: { docId: 'doc', type: 'equation', equation } as never
				},
				HUMAN
			);

		expect(add('legacy', { mode: 'static', tex: 'x' })).toMatchObject({ ok: false });
		expect(
			add('malformed', {
				version: 1,
				segments: [{ kind: 'reference', nodeId: '', fallback: { name: '' } }]
			})
		).toMatchObject({ ok: false });
		expect(
			add('oversized', {
				version: 1,
				segments: [{ kind: 'latex', latex: 'x'.repeat(10_001) }]
			})
		).toMatchObject({ ok: false });
		expect(
			add('too-many-references', {
				version: 1,
				segments: Array.from({ length: 65 }, (_, index) => ({
					kind: 'reference',
					nodeId: `published-${index}`,
					fallback: { name: `published.${index}` }
				}))
			})
		).toMatchObject({ ok: false });
	});

	it('migrates legacy persisted equations without flattening or blanking them', () => {
		expect(normalizeEquationPayload({ mode: 'static', tex: 'E=mc^2' })).toEqual({
			version: 1,
			segments: [{ kind: 'latex', latex: 'E=mc^2' }]
		});
		expect(
			normalizeEquationPayload(
				{ mode: 'bound', nodeId: 'published-span', display: 'result' },
				() => 'bridge.span'
			)
		).toEqual({
			version: 1,
			segments: [
				{
					kind: 'reference',
					nodeId: 'published-span',
					fallback: { name: 'bridge.span' }
				}
			]
		});
	});

	it('discards canceled live edits without disturbing earlier document history', () => {
		const graph = new DocumentGraph();
		const initial: EquationPayload = {
			version: 1,
			segments: [{ kind: 'latex', latex: 'x' }]
		};
		graph.insertBlock({
			id: 'equation',
			docId: 'doc',
			type: 'equation',
			position: 0,
			equation: initial
		});
		must(
			applyMutation(
				graph,
				{
					op: 'addNode',
					node: { id: 'earlier-edit', kind: 'input', provenance: emptyProvenance() }
				},
				HUMAN
			)
		);
		const session = beginEquationSessionHistory(graph);

		for (const latex of ['x+1', 'x+2', 'x']) {
			must(
				applyMutation(
					graph,
					{
						op: 'blockOp',
						action: 'update',
						blockId: 'equation',
						block: {
							equation: { version: 1, segments: [{ kind: 'latex', latex }] }
						}
					},
					HUMAN
				)
			);
		}

		expect(cancelEquationSession(graph, 'equation', initial, session)).toMatchObject({ ok: true });

		expect(graph.blocks.get('equation')?.equation).toEqual(initial);
		expect(graph.undoLog.map((entry) => entry.mutation.op)).toEqual(['addNode']);
		expect(graph.undoCursor).toBe(1);
	});

	it('preserves an existing redo tail when a live edit is canceled', () => {
		const graph = new DocumentGraph();
		const initial: EquationPayload = {
			version: 1,
			segments: [{ kind: 'latex', latex: 'x' }]
		};
		graph.insertBlock({
			id: 'equation',
			docId: 'doc',
			type: 'equation',
			position: 0,
			equation: initial
		});
		for (const id of ['first-edit', 'second-edit']) {
			must(
				applyMutation(
					graph,
					{ op: 'addNode', node: { id, kind: 'input', provenance: emptyProvenance() } },
					HUMAN
				)
			);
		}
		expect(undo(graph)).toMatchObject({ ok: true });
		const session = beginEquationSessionHistory(graph);
		must(
			applyMutation(
				graph,
				{
					op: 'blockOp',
					action: 'update',
					blockId: 'equation',
					block: {
						equation: { version: 1, segments: [{ kind: 'latex', latex: 'x+1' }] }
					}
				},
				HUMAN
			)
		);

		expect(cancelEquationSession(graph, 'equation', initial, session)).toMatchObject({ ok: true });

		expect(graph.undoCursor).toBe(1);
		expect(graph.undoLog).toHaveLength(2);
		expect(redo(graph)).toMatchObject({ ok: true });
		expect(graph.nodes.has('second-edit')).toBe(true);
	});

	it('restores history evicted by a live edit session that crosses the undo cap', () => {
		const graph = new DocumentGraph();
		const initial: EquationPayload = {
			version: 1,
			segments: [{ kind: 'latex', latex: 'x' }]
		};
		graph.insertBlock({
			id: 'equation',
			docId: 'doc',
			type: 'equation',
			position: 0,
			equation: initial
		});
		must(
			applyMutation(
				graph,
				{
					op: 'addNode',
					node: { id: 'earlier-edit', kind: 'input', provenance: emptyProvenance() }
				},
				HUMAN
			)
		);
		const expectedHistory = structuredClone(graph.undoLog);
		const session = beginEquationSessionHistory(graph);

		for (let index = 0; index <= UNDO_CAP; index++) {
			must(
				applyMutation(
					graph,
					{
						op: 'blockOp',
						action: 'update',
						blockId: 'equation',
						block: {
							equation: {
								version: 1,
								segments: [{ kind: 'latex', latex: `x+${index}` }]
							}
						}
					},
					HUMAN
				)
			);
		}
		expect(graph.undoLog.some((entry) => entry.mutation.op === 'addNode')).toBe(false);

		expect(cancelEquationSession(graph, 'equation', initial, session)).toMatchObject({ ok: true });

		expect(graph.undoLog).toEqual(expectedHistory);
		expect(graph.undoCursor).toBe(1);
	});
});
