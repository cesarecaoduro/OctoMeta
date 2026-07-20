import { describe, expect, it } from 'vitest';
import type { TypedValue } from '../engine';
import {
	DocumentGraph,
	commit,
	commitRedo,
	commitUndo,
	createBuiltinRegistry,
	emptyProvenance,
	evaluateWithDerivations,
	parseFormula,
	scalar
} from '../engine';
import { FIXTURE_BUILDERS, buildBeamFixture, buildBranchFixture } from './fixtures';
import type { LoadedRows, SavePayload } from './serialize';
import { hydrateGraph, serializeGraph } from './serialize';

const HUMAN = { kind: 'human' } as const;

/** Simulate the Convex wire: what save sends is what load returns (JSON-clean). */
function toRows(payload: SavePayload): LoadedRows {
	return JSON.parse(
		JSON.stringify({
			document: { blocksOrder: payload.blocksOrder, undoCursor: payload.undoCursor },
			nodes: payload.nodes,
			blocks: payload.blocks,
			undoLog: payload.undoLog,
			chips: payload.chips
		})
	);
}

function valueOf(graph: ReturnType<typeof buildBeamFixture>['graph'], id: string): TypedValue {
	const node = graph.nodes.get(id);
	if (!node) throw new Error(`missing node ${id}`);
	return node.value;
}

describe('serializeGraph → hydrateGraph round trip', () => {
	it.each(FIXTURE_BUILDERS.map((build) => [build().title, build] as const))(
		'%s: reproduces every contentHash and value from inputs',
		(_title, build) => {
			const { graph, registry } = build();
			const { graph: hydrated, mismatches } = hydrateGraph(toRows(serializeGraph(graph)), {
				registry
			});
			expect(mismatches).toEqual([]);
			expect(hydrated.nodes.size).toBe(graph.nodes.size);
			for (const [id, node] of graph.nodes) {
				const back = hydrated.nodes.get(id);
				expect(back, id).toBeDefined();
				// Byte-for-byte hash reproduction (SCHEMA.md §5) and identical state.
				expect(back!.contentHash, id).toBe(node.contentHash);
				expect(JSON.parse(JSON.stringify(back)), id).toEqual(JSON.parse(JSON.stringify(node)));
			}
			expect(hydrated.blocksOrder).toEqual(graph.blocksOrder);
			for (const [id, block] of graph.blocks) {
				const back = hydrated.blocks.get(id);
				expect(back?.type).toBe(block.type);
				expect(back?.position).toBe(block.position);
			}
			expect([...hydrated.chips.values()]).toEqual([...graph.chips.values()]);
			expect(hydrated.undoCursor).toBe(graph.undoCursor);
			expect(JSON.parse(JSON.stringify(hydrated.undoLog))).toEqual(
				JSON.parse(JSON.stringify(graph.undoLog))
			);
		}
	);

	it('keeps error values and quantities (Θ key) intact through the wire', () => {
		const { graph, registry } = buildBranchFixture();
		const { graph: hydrated } = hydrateGraph(toRows(serializeGraph(graph)), { registry });
		expect(valueOf(hydrated, 'node-branch-bad')).toMatchObject({ kind: 'error', code: '#VALUE!' });
		expect(valueOf(hydrated, 'node-branch-q')).toEqual({
			kind: 'quantity',
			value: 5,
			unit: { L: 1, M: 0, T: 0, I: 0, Θ: 0, N: 0, J: 0, display: 'm' }
		});
		expect(valueOf(hydrated, 'node-branch-qdouble')).toMatchObject({ kind: 'quantity', value: 10 });
	});

	it('hydration is row-order independent', () => {
		const { graph, registry } = buildBeamFixture();
		const rows = toRows(serializeGraph(graph));
		rows.nodes.reverse();
		rows.blocks.reverse();
		rows.undoLog.reverse(); // hydrate must sort by seq
		const { graph: hydrated, mismatches } = hydrateGraph(rows, { registry });
		expect(mismatches).toEqual([]);
		expect(hydrated.blocksOrder).toEqual(graph.blocksOrder);
		expect(hydrated.undoLog.map((e) => e.seq)).toEqual(graph.undoLog.map((e) => e.seq));
		for (const [id, node] of graph.nodes) {
			expect(hydrated.nodes.get(id)?.contentHash, id).toBe(node.contentHash);
		}
	});

	it('undo after rehydration reverts the last pre-save edit; the redo tail survives', () => {
		const { graph, registry } = buildBeamFixture();
		const opts = { registry };
		// E1: span 6 → 7, E2: w 12 → 15, then undo E2 so a redo tail exists.
		expect(
			commit(graph, { op: 'setInput', id: 'node-beam-span', value: scalar(7) }, HUMAN, opts).ok
		).toBe(true);
		expect(
			commit(graph, { op: 'setInput', id: 'node-beam-w', value: scalar(15) }, HUMAN, opts).ok
		).toBe(true);
		expect(commitUndo(graph, opts).ok).toBe(true);
		expect(valueOf(graph, 'node-beam-moment')).toEqual(scalar((12 * 49) / 8));

		const { graph: hydrated, mismatches } = hydrateGraph(toRows(serializeGraph(graph)), { registry });
		expect(mismatches).toEqual([]);
		expect(valueOf(hydrated, 'node-beam-moment')).toEqual(scalar((12 * 49) / 8));

		// Undo reverts E1 (the last pre-save edit still below the cursor).
		expect(commitUndo(hydrated, opts).ok).toBe(true);
		expect(valueOf(hydrated, 'node-beam-span')).toEqual(scalar(6));
		expect(valueOf(hydrated, 'node-beam-moment')).toEqual(scalar(54));

		// The redo tail survived the round trip: redo E1, then redo E2.
		expect(commitRedo(hydrated, opts).ok).toBe(true);
		expect(valueOf(hydrated, 'node-beam-moment')).toEqual(scalar((12 * 49) / 8));
		expect(commitRedo(hydrated, opts).ok).toBe(true);
		expect(valueOf(hydrated, 'node-beam-moment')).toEqual(scalar((15 * 49) / 8));
		expect(commitRedo(hydrated, opts).ok).toBe(false);
	});

	it('reports mismatches when stored hashes disagree with re-derivation', () => {
		const { graph, registry } = buildBeamFixture();
		const rows = toRows(serializeGraph(graph));
		const tampered = rows.nodes.find((n) => n.nodeId === 'node-beam-moment');
		tampered!.contentHash = 'deadbeefdeadbeef';
		const { mismatches } = hydrateGraph(rows, { registry });
		expect(mismatches).toHaveLength(1);
		expect(mismatches[0]).toMatchObject({ nodeId: 'node-beam-moment', stored: 'deadbeefdeadbeef' });
	});
});

// ---------------------------------------------------------------------------
// SHOWSTEPS cells (V1-5-4): hydration must re-derive their stored text
// ---------------------------------------------------------------------------

describe('SHOWSTEPS cells rehydrate reproducibly (V1-5-4)', () => {
	/**
	 * A doc built the way a live session builds one: recalc wired with the
	 * derivation-capable evaluator, so `=SHOWSTEPS(beam.load)` settles to the
	 * plain-text derivation string. Hydration's verification recalc uses the
	 * same evaluator; a plain one would flag every SHOWSTEPS node as a
	 * contentHash mismatch.
	 */
	function buildShowStepsDoc() {
		const graph = new DocumentGraph();
		const registry = createBuiltinRegistry();
		const opts = { registry, evaluate: evaluateWithDerivations(graph) };
		const SHEET = 'blk-steps-sheet';
		const must = (r: { ok: boolean; error?: { message: string } }): void => {
			if (!r.ok) throw new Error(`fixture mutation rejected: ${r.error?.message}`);
		};
		const ast = (src: string) => {
			const parsed = parseFormula(src, { sheetBlockId: SHEET });
			if (!parsed.ok) throw new Error(parsed.message);
			return parsed.ast;
		};
		must(
			commit(
				graph,
				{ op: 'blockOp', action: 'add', blockId: SHEET, block: { docId: 'doc', type: 'sheet' } },
				HUMAN,
				opts
			)
		);
		must(
			commit(
				graph,
				{
					op: 'addNode',
					node: {
						id: 'n-a1',
						kind: 'input',
						cellRef: { sheetBlockId: SHEET, a1: 'A1' },
						blockId: SHEET,
						provenance: emptyProvenance()
					}
				},
				HUMAN,
				opts
			)
		);
		must(commit(graph, { op: 'setInput', id: 'n-a1', value: scalar(12) }, HUMAN, opts));
		must(
			commit(
				graph,
				{
					op: 'addNode',
					node: {
						id: 'n-b1',
						kind: 'computed',
						formula: ast('=A1 * 2 + 1'),
						cellRef: { sheetBlockId: SHEET, a1: 'B1' },
						blockId: SHEET,
						provenance: emptyProvenance()
					}
				},
				HUMAN,
				opts
			)
		);
		must(
			commit(
				graph,
				{ op: 'publishName', cellRef: { sheetBlockId: SHEET, a1: 'B1' }, name: 'beam.load' },
				HUMAN,
				opts
			)
		);
		must(
			commit(
				graph,
				{
					op: 'addNode',
					node: {
						id: 'n-steps',
						kind: 'computed',
						formula: ast('=SHOWSTEPS(beam.load)'),
						cellRef: { sheetBlockId: SHEET, a1: 'C1' },
						blockId: SHEET,
						provenance: emptyProvenance()
					}
				},
				HUMAN,
				opts
			)
		);
		return { graph, registry };
	}

	it('round-trips the derivation string with zero mismatches', () => {
		const { graph, registry } = buildShowStepsDoc();
		const live = valueOf(graph, 'n-steps');
		expect(live).toEqual({
			kind: 'string',
			value: 'beam.load = B1\n  = 25'
		});

		const { graph: hydrated, mismatches } = hydrateGraph(toRows(serializeGraph(graph)), {
			registry
		});
		expect(mismatches).toEqual([]);
		expect(valueOf(hydrated, 'n-steps')).toEqual(live);
		expect(hydrated.nodes.get('n-steps')?.contentHash).toBe(
			graph.nodes.get('n-steps')?.contentHash
		);
	});
});
