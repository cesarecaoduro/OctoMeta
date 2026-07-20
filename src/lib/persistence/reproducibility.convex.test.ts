import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import { commit, commitRedo, commitUndo, scalar } from '../engine';
import { FIXTURE_BUILDERS, buildBeamFixture, buildBranchFixture, buildDemoFixture } from './fixtures';
import { hydrateGraph, serializeGraph } from './serialize';

/**
 * V1-4-1 CI reproducibility gate (IMPLEMENTATION_PLAN.md §11 rule 6 —
 * cumulative, never disabled): every fixture document saved through the real
 * Convex functions and loaded back must re-evaluate from inputs to the exact
 * stored contentHashes (SCHEMA.md §5: "restart & run all is a no-op"), and
 * the undo history must survive the reload.
 */

// convex.json points functions at src/convex/ — hand convex-test the modules
// (including _generated, which it uses to locate the functions root).
const modules = import.meta.glob(['../../convex/**/*.ts', '../../convex/**/_generated/*.js']);
const newBackend = () => convexTest(schema, modules);

const HUMAN = { kind: 'human' } as const;

async function saveFixture(
	t: ReturnType<typeof newBackend>,
	fixture: { title: string; graph: Parameters<typeof serializeGraph>[0] }
) {
	const docId = await t.mutation(api.documents.create, { title: fixture.title });
	await t.mutation(api.documents.save, { docId, ...serializeGraph(fixture.graph) });
	return docId;
}

describe('document CRUD', () => {
	it('create / list / rename / delete', async () => {
		const t = newBackend();
		const docId = await t.mutation(api.documents.create, { title: 'Doc A' });
		expect((await t.query(api.documents.list, {})).map((d) => d.title)).toEqual(['Doc A']);
		await t.mutation(api.documents.rename, { docId, title: 'Doc B' });
		expect((await t.query(api.documents.list, {})).map((d) => d.title)).toEqual(['Doc B']);
		await t.mutation(api.documents.remove, { docId });
		expect(await t.query(api.documents.list, {})).toEqual([]);
		expect(await t.query(api.documents.load, { docId })).toBeNull();
	});

	it('delete cascades to every per-document row', async () => {
		const t = newBackend();
		const docId = await saveFixture(t, buildBeamFixture());
		await t.mutation(api.sheets.upsertSnapshot, {
			docId,
			blockId: 'blk-beam-sheet',
			univerSnapshot: { rows: 3 }
		});
		await t.mutation(api.documents.remove, { docId });
		await t.run(async (ctx) => {
			for (const table of [
				'graphNodes',
				'blocks',
				'undoLog',
				'chipBindings',
				'sheetSnapshots'
			] as const) {
				expect(await ctx.db.query(table).collect(), table).toEqual([]);
			}
		});
	});
});

describe('reproducibility gate (SCHEMA.md §5)', () => {
	it.each(FIXTURE_BUILDERS.map((build) => [build().title, build] as const))(
		'%s: reload + re-evaluate reproduces every stored contentHash byte-for-byte',
		async (_title, build) => {
			const t = newBackend();
			const fixture = build();
			const docId = await saveFixture(t, fixture);

			const loaded = await t.query(api.documents.load, { docId });
			expect(loaded).not.toBeNull();
			const { graph: hydrated, mismatches } = hydrateGraph(loaded!, {
				registry: fixture.registry
			});

			// Re-evaluating everything from inputs is a no-op on the hashes.
			expect(mismatches).toEqual([]);
			expect(hydrated.nodes.size).toBe(fixture.graph.nodes.size);
			for (const row of loaded!.nodes) {
				expect(hydrated.nodes.get(row.nodeId)?.contentHash, row.nodeId).toBe(row.contentHash);
			}
			// And the full node state matches the pre-save session exactly.
			for (const [id, node] of fixture.graph.nodes) {
				expect(JSON.parse(JSON.stringify(hydrated.nodes.get(id))), id).toEqual(
					JSON.parse(JSON.stringify(node))
				);
			}
			expect(hydrated.blocksOrder).toEqual(fixture.graph.blocksOrder);
			expect([...hydrated.chips.values()]).toEqual([...fixture.graph.chips.values()]);
		}
	);

	it('error values and quantities (Θ dimension key) survive Convex storage', async () => {
		const t = newBackend();
		const fixture = buildBranchFixture();
		const docId = await saveFixture(t, fixture);
		const loaded = await t.query(api.documents.load, { docId });
		const { graph: hydrated } = hydrateGraph(loaded!, { registry: fixture.registry });
		expect(hydrated.nodes.get('node-branch-bad')?.value).toMatchObject({
			kind: 'error',
			code: '#VALUE!'
		});
		expect(hydrated.nodes.get('node-branch-q')?.value).toEqual({
			kind: 'quantity',
			value: 5,
			unit: { L: 1, M: 0, T: 0, I: 0, Θ: 0, N: 0, J: 0, display: 'm' }
		});
	});

	it('V1-5-6 demo fixture: template attribution, cross-sheet values, chips, and SHOWSTEPS survive the round-trip', async () => {
		const t = newBackend();
		const fixture = buildDemoFixture();
		const docId = await saveFixture(t, fixture);
		const loaded = await t.query(api.documents.load, { docId });
		const { graph: hydrated, mismatches } = hydrateGraph(loaded!, { registry: fixture.registry });
		expect(mismatches).toEqual([]);

		// Template authorship survives persistence (V1-5-5 attribution story).
		const momentId = hydrated.resolveRef({ name: 'beam.moment' });
		expect(momentId).toBeDefined();
		expect(hydrated.nodes.get(momentId!)?.provenance).toMatchObject({
			authoredBy: 'template',
			authorId: 'octometa.beam-demo'
		});

		// The calculation chain: M = w·L²/8 = 120, cross-sheet util = 0.8, δ = 1.
		expect(hydrated.nodes.get('node-demo-moment')?.value).toEqual(scalar(120));
		expect(hydrated.nodes.get('node-demo-util')?.value).toEqual(scalar(0.8));
		expect(hydrated.nodes.get('node-demo-defl')?.value).toEqual(scalar(1));

		// The SHOWSTEPS cell re-derived to the same multi-line text on hydration
		// (hydrateGraph carries the derivation-capable evaluator).
		const steps = hydrated.nodes.get('node-demo-steps')?.value;
		expect(steps).toMatchObject({ kind: 'string' });
		expect((steps as { value: string }).value).toContain('beam.moment / beam.capacity');
		expect((steps as { value: string }).value).toContain('= 0.8');

		// Both prose chips came back bound to the published nodes.
		expect(hydrated.chips.get('chip-demo-moment')).toMatchObject({
			blockId: 'blk-demo-intro',
			nodeId: momentId
		});
		expect(hydrated.chips.get('chip-demo-util')).toMatchObject({
			blockId: 'blk-demo-summary',
			nodeId: hydrated.resolveRef({ name: 'beam.util' })
		});
	});

	it('undo() after reload reverts the last pre-reload edit; redo tail survives', async () => {
		const t = newBackend();
		const fixture = buildBeamFixture();
		const opts = { registry: fixture.registry };
		// E1: span 6 → 7 · E2: w 12 → 15 · undo E2 → redo tail = [E2].
		commit(fixture.graph, { op: 'setInput', id: 'node-beam-span', value: scalar(7) }, HUMAN, opts);
		commit(fixture.graph, { op: 'setInput', id: 'node-beam-w', value: scalar(15) }, HUMAN, opts);
		commitUndo(fixture.graph, opts);
		const docId = await saveFixture(t, fixture);

		const loaded = await t.query(api.documents.load, { docId });
		const { graph: hydrated, mismatches } = hydrateGraph(loaded!, opts);
		expect(mismatches).toEqual([]);
		expect(hydrated.nodes.get('node-beam-moment')?.value).toEqual(scalar((12 * 49) / 8));

		// Undo the last pre-reload edit (E1).
		expect(commitUndo(hydrated, opts).ok).toBe(true);
		expect(hydrated.nodes.get('node-beam-span')?.value).toEqual(scalar(6));
		expect(hydrated.nodes.get('node-beam-moment')?.value).toEqual(scalar(54));
		// The redo tail survived the reload: E1, then E2.
		expect(commitRedo(hydrated, opts).ok).toBe(true);
		expect(commitRedo(hydrated, opts).ok).toBe(true);
		expect(hydrated.nodes.get('node-beam-moment')?.value).toEqual(scalar((15 * 49) / 8));
		expect(commitRedo(hydrated, opts).ok).toBe(false);
	});

	it('server prunes the undo log to the 200-entry cap', async () => {
		const t = newBackend();
		const docId = await t.mutation(api.documents.create, { title: 'Cap check' });
		const entries = Array.from({ length: 250 }, (_, i) => ({
			seq: i + 1,
			mutation: { op: 'setInput', id: 'n', value: { kind: 'scalar', value: i } },
			inverse: [],
			actor: { kind: 'human' },
			at: i
		}));
		await t.mutation(api.documents.save, {
			docId,
			blocksOrder: [],
			undoCursor: 250,
			nodes: [],
			blocks: [],
			undoLog: entries,
			chips: []
		});
		const loaded = await t.query(api.documents.load, { docId });
		expect(loaded!.undoLog).toHaveLength(200);
		const seqs = loaded!.undoLog.map((e) => e.seq).sort((a, b) => a - b);
		expect(seqs[0]).toBe(51); // oldest-first pruning (SCHEMA.md §9)
		expect(seqs[199]).toBe(250);
	});
});

describe('sheet snapshots and chips', () => {
	it('upsertSnapshot inserts then updates in place', async () => {
		const t = newBackend();
		const docId = await saveFixture(t, buildBeamFixture());
		await t.mutation(api.sheets.upsertSnapshot, {
			docId,
			blockId: 'blk-beam-sheet',
			univerSnapshot: { v: 1 }
		});
		await t.mutation(api.sheets.upsertSnapshot, {
			docId,
			blockId: 'blk-beam-sheet',
			univerSnapshot: { v: 2 }
		});
		const loaded = await t.query(api.documents.load, { docId });
		expect(loaded!.sheetSnapshots).toHaveLength(1);
		expect(loaded!.sheetSnapshots[0].univerSnapshot).toEqual({ v: 2 });
	});

	it('chip upsert inserts then updates; remove is idempotent', async () => {
		const t = newBackend();
		const docId = await saveFixture(t, buildBeamFixture());
		await t.mutation(api.chips.upsert, {
			docId,
			chipId: 'chip-x',
			blockId: 'blk-beam-intro',
			nodeId: 'node-beam-util'
		});
		await t.mutation(api.chips.upsert, {
			docId,
			chipId: 'chip-x',
			blockId: 'blk-beam-intro',
			nodeId: 'node-beam-moment',
			format: { digits: 2 }
		});
		let loaded = await t.query(api.documents.load, { docId });
		const chip = loaded!.chips.find((c) => c.chipId === 'chip-x');
		expect(chip).toMatchObject({ nodeId: 'node-beam-moment', format: { digits: 2 } });
		await t.mutation(api.chips.remove, { docId, chipId: 'chip-x' });
		await t.mutation(api.chips.remove, { docId, chipId: 'chip-x' }); // idempotent
		loaded = await t.query(api.documents.load, { docId });
		expect(loaded!.chips.some((c) => c.chipId === 'chip-x')).toBe(false);
	});
});
