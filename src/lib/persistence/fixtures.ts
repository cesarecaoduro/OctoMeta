/**
 * Reusable fixture documents for the reproducibility CI gate (V1-4-1) and the
 * V1 checkpoint demo (V1-5-6). Every fixture is built through the REAL engine
 * write path — `commit` (applyMutation + recalc) — never by poking graph
 * internals, so what gets persisted is exactly what a user session produces.
 */

import type {
	Actor,
	CommitResult,
	FormulaAST,
	FunctionRegistry,
	MutationError,
	NodeId,
	Result,
	TypedValue
} from '../engine';
import {
	DocumentGraph,
	commit,
	createBuiltinRegistry,
	dim,
	emptyProvenance,
	evaluateWithDerivations,
	parseFormula,
	quantity,
	scalar,
	stringValue
} from '../engine';

/** One buildable fixture document. */
export interface FixtureDocument {
	title: string;
	graph: DocumentGraph;
	registry: FunctionRegistry;
}

const HUMAN: Actor = { kind: 'human', id: 'fixture' };

/** Unwrap a commit result; fixtures must never build on a rejected mutation. */
function must(r: Result<CommitResult, MutationError>): CommitResult {
	if (!r.ok) throw new Error(`fixture mutation rejected: ${r.error.message}`);
	return r.value;
}

/** Parse formula source or throw — fixture formulas are static and must parse. */
function ast(src: string, sheetBlockId: string): FormulaAST {
	const parsed = parseFormula(src, { sheetBlockId });
	if (!parsed.ok) throw new Error(`fixture formula "${src}": ${parsed.message}`);
	return parsed.ast;
}

/**
 * Fixture 1 — a small beam calc: prose block + sheet block, two inputs, a
 * moment formula, published names (`beam.span`, `beam.moment`), a computed
 * utilization referencing a published name, and a chip bound to the moment.
 *
 * Sheet layout: A1 span = 6 · A2 w = 12 · A3 moment `=A2 * A1^2 / 8` (54) ·
 * A4 utilization `=beam.moment / 25`.
 */
export function buildBeamFixture(): FixtureDocument {
	const registry = createBuiltinRegistry();
	const graph = new DocumentGraph();
	const opts = { registry };
	const SHEET = 'blk-beam-sheet';
	const INTRO = 'blk-beam-intro';

	must(
		commit(
			graph,
			{
				op: 'blockOp',
				action: 'add',
				blockId: INTRO,
				block: {
					docId: 'fixture:beam',
					type: 'text',
					pm: { type: 'doc', content: [{ type: 'paragraph', text: 'Simply supported beam check.' }] }
				}
			},
			HUMAN,
			opts
		)
	);
	must(
		commit(
			graph,
			{
				op: 'blockOp',
				action: 'add',
				blockId: SHEET,
				block: { docId: 'fixture:beam', type: 'sheet' }
			},
			HUMAN,
			opts
		)
	);

	const addInput = (id: NodeId, a1: string, value: number): void => {
		must(
			commit(
				graph,
				{
					op: 'addNode',
					node: {
						id,
						kind: 'input',
						cellRef: { sheetBlockId: SHEET, a1 },
						blockId: SHEET,
						provenance: emptyProvenance()
					}
				},
				HUMAN,
				opts
			)
		);
		must(commit(graph, { op: 'setInput', id, value: scalar(value) }, HUMAN, opts));
	};
	addInput('node-beam-span', 'A1', 6);
	addInput('node-beam-w', 'A2', 12);

	must(
		commit(
			graph,
			{
				op: 'addNode',
				node: {
					id: 'node-beam-moment',
					kind: 'computed',
					formula: ast('=A2 * A1^2 / 8', SHEET),
					cellRef: { sheetBlockId: SHEET, a1: 'A3' },
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
			{ op: 'publishName', cellRef: { sheetBlockId: SHEET, a1: 'A1' }, name: 'beam.span' },
			HUMAN,
			opts
		)
	);
	const momentNamedId = must(
		commit(
			graph,
			{ op: 'publishName', cellRef: { sheetBlockId: SHEET, a1: 'A3' }, name: 'beam.moment' },
			HUMAN,
			opts
		)
	).affected[0];

	must(
		commit(
			graph,
			{
				op: 'addNode',
				node: {
					id: 'node-beam-util',
					kind: 'computed',
					formula: ast('=beam.moment / 25', SHEET),
					cellRef: { sheetBlockId: SHEET, a1: 'A4' },
					blockId: SHEET,
					provenance: emptyProvenance()
				}
			},
			HUMAN,
			opts
		)
	);

	// Chips are projections seeded directly (their write path is V1-5-3's
	// blockOp update; rebinding goes through applyMutation).
	graph.chips.set('chip-beam-moment', {
		id: 'chip-beam-moment',
		blockId: INTRO,
		nodeId: momentNamedId,
		format: { digits: 1 }
	});

	return { title: 'Beam check', graph, registry };
}

/**
 * Fixture 2 — a multi-branch calc that keeps an error value and a quantity in
 * the persisted graph: scalar branch, string branch (`#VALUE!`), quantity
 * branch (exercises the `Θ` dimension-key codec end to end), and a published
 * name consumed by a second formula.
 *
 * Sheet layout: A1 x = 4 · A2 label = "four" · A3 q = 5 m · A4 `=A1 * 2` (8) ·
 * A5 `=A2 * 2` (#VALUE!) · A6 `=A3 * 2` (10 m) · B1 `=calc.x + 1` (5).
 */
export function buildBranchFixture(): FixtureDocument {
	const registry = createBuiltinRegistry();
	const graph = new DocumentGraph();
	const opts = { registry };
	const SHEET = 'blk-branch-sheet';

	must(
		commit(
			graph,
			{
				op: 'blockOp',
				action: 'add',
				blockId: SHEET,
				block: { docId: 'fixture:branch', type: 'sheet' }
			},
			HUMAN,
			opts
		)
	);

	const addInput = (id: NodeId, a1: string, value: TypedValue): void => {
		must(
			commit(
				graph,
				{
					op: 'addNode',
					node: {
						id,
						kind: 'input',
						cellRef: { sheetBlockId: SHEET, a1 },
						blockId: SHEET,
						provenance: emptyProvenance()
					}
				},
				HUMAN,
				opts
			)
		);
		must(commit(graph, { op: 'setInput', id, value }, HUMAN, opts));
	};
	addInput('node-branch-x', 'A1', scalar(4));
	addInput('node-branch-label', 'A2', stringValue('four'));
	addInput('node-branch-q', 'A3', quantity(5, dim({ L: 1, display: 'm' })));

	const addComputed = (id: NodeId, a1: string, src: string): void => {
		must(
			commit(
				graph,
				{
					op: 'addNode',
					node: {
						id,
						kind: 'computed',
						formula: ast(src, SHEET),
						cellRef: { sheetBlockId: SHEET, a1 },
						blockId: SHEET,
						provenance: emptyProvenance()
					}
				},
				HUMAN,
				opts
			)
		);
	};
	addComputed('node-branch-double', 'A4', '=A1 * 2');
	addComputed('node-branch-bad', 'A5', '=A2 * 2'); // string * number → #VALUE!
	addComputed('node-branch-qdouble', 'A6', '=A3 * 2');

	must(
		commit(
			graph,
			{ op: 'publishName', cellRef: { sheetBlockId: SHEET, a1: 'A1' }, name: 'calc.x' },
			HUMAN,
			opts
		)
	);
	addComputed('node-branch-plus', 'B1', '=calc.x + 1');

	return { title: 'Branch calc', graph, registry };
}

/**
 * Fixture 3 — the V1-5-6 scripted demo document: a short simply-supported
 * beam calc authored the way a template would author it (`actor: 'template'`).
 * Prose (heading + paragraphs with inline chips) + two sheets + published
 * names + cross-sheet dotted references + a `SHOWSTEPS` cell. Unit-free (V1):
 * every number is a plain scalar.
 *
 * Sheet 1 `blk-demo-inputs` (inputs + bending):
 *   A1 w = 15 (`beam.w`) · A2 L = 8 (`beam.span`) ·
 *   A3 `=A1 * A2^2 / 8` = 120 (`beam.moment`, M = w·L²/8) ·
 *   A4 EI = 800 · A5 `=5 * A1 * A2^4 / (384 * A4)` = 1 (`beam.defl`,
 *   δ = 5·w·L⁴/384EI).
 * Sheet 2 `blk-demo-checks` (cross-sheet checks):
 *   A1 capacity = 150 (`beam.capacity`) ·
 *   A2 `=beam.moment / beam.capacity` = 0.8 (`beam.util`) ·
 *   A3 `=SHOWSTEPS(A2)` — the show-steps surface.
 * Chips: `chip-demo-moment` (intro paragraph → beam.moment) and
 * `chip-demo-util` (summary paragraph → beam.util), created via `chipOp`.
 */
export function buildDemoFixture(): FixtureDocument {
	const registry = createBuiltinRegistry();
	const graph = new DocumentGraph();
	// The demo doc carries a SHOWSTEPS cell, so its commits (like the app's
	// GraphSession and hydrateGraph) use the derivation-capable evaluator.
	const opts = { registry, evaluate: evaluateWithDerivations(graph) };
	const TEMPLATE: Actor = { kind: 'template', id: 'octometa.beam-demo' };
	const DOC = 'fixture:demo';
	const INPUTS = 'blk-demo-inputs';
	const CHECKS = 'blk-demo-checks';

	const addBlock = (blockId: string, block: Record<string, unknown>): void => {
		must(
			commit(
				graph,
				{ op: 'blockOp', action: 'add', blockId, block: { docId: DOC, ...block } },
				TEMPLATE,
				opts
			)
		);
	};
	const text = (t: string) => ({ type: 'text', text: t });
	const chipNode = (chipId: string) => ({ type: 'valueChip', attrs: { chipId } });

	addBlock('blk-demo-title', {
		type: 'heading',
		pm: { type: 'heading', attrs: { level: 1 }, content: [text('Simply supported beam')] }
	});
	addBlock('blk-demo-intro', {
		type: 'text',
		pm: {
			type: 'paragraph',
			content: [
				text('A uniform load w over span L gives a midspan moment of '),
				chipNode('chip-demo-moment'),
				text('.')
			]
		}
	});
	addBlock(INPUTS, { type: 'sheet' });
	addBlock('blk-demo-summary', {
		type: 'text',
		pm: {
			type: 'paragraph',
			content: [text('The section works at a utilization of '), chipNode('chip-demo-util'), text('.')]
		}
	});
	addBlock(CHECKS, { type: 'sheet' });

	const addInput = (id: NodeId, sheet: string, a1: string, value: number): void => {
		must(
			commit(
				graph,
				{
					op: 'addNode',
					node: {
						id,
						kind: 'input',
						cellRef: { sheetBlockId: sheet, a1 },
						blockId: sheet,
						provenance: emptyProvenance()
					}
				},
				TEMPLATE,
				opts
			)
		);
		must(commit(graph, { op: 'setInput', id, value: scalar(value) }, TEMPLATE, opts));
	};
	const addComputed = (id: NodeId, sheet: string, a1: string, src: string): void => {
		must(
			commit(
				graph,
				{
					op: 'addNode',
					node: {
						id,
						kind: 'computed',
						formula: ast(src, sheet),
						cellRef: { sheetBlockId: sheet, a1 },
						blockId: sheet,
						provenance: emptyProvenance()
					}
				},
				TEMPLATE,
				opts
			)
		);
	};
	const publish = (sheet: string, a1: string, name: string): NodeId =>
		must(
			commit(graph, { op: 'publishName', cellRef: { sheetBlockId: sheet, a1 }, name }, TEMPLATE, opts)
		).affected[0];

	// Sheet 1: inputs and the bending chain.
	addInput('node-demo-w', INPUTS, 'A1', 15);
	addInput('node-demo-span', INPUTS, 'A2', 8);
	addComputed('node-demo-moment', INPUTS, 'A3', '=A1 * A2^2 / 8');
	addInput('node-demo-ei', INPUTS, 'A4', 800);
	addComputed('node-demo-defl', INPUTS, 'A5', '=5 * A1 * A2^4 / (384 * A4)');
	publish(INPUTS, 'A1', 'beam.w');
	publish(INPUTS, 'A2', 'beam.span');
	const momentNamedId = publish(INPUTS, 'A3', 'beam.moment');
	publish(INPUTS, 'A5', 'beam.defl');

	// Sheet 2: cross-sheet dotted references and the show-steps surface.
	addInput('node-demo-capacity', CHECKS, 'A1', 150);
	addComputed('node-demo-util', CHECKS, 'A2', '=beam.moment / beam.capacity');
	publish(CHECKS, 'A1', 'beam.capacity');
	const utilNamedId = publish(CHECKS, 'A2', 'beam.util');
	// SHOWSTEPS targets the computed cell (not the namedOutput alias) so the
	// cell settles to the full derivation, not the bare alias line.
	addComputed('node-demo-steps', CHECKS, 'A3', '=SHOWSTEPS(A2)');

	// Chips through their real lifecycle op (V1-5-3): bindings ride the undo log.
	must(
		commit(
			graph,
			{
				op: 'chipOp',
				action: 'create',
				chipId: 'chip-demo-moment',
				chip: { blockId: 'blk-demo-intro', nodeId: momentNamedId, format: { digits: 1 } }
			},
			TEMPLATE,
			opts
		)
	);
	must(
		commit(
			graph,
			{
				op: 'chipOp',
				action: 'create',
				chipId: 'chip-demo-util',
				chip: { blockId: 'blk-demo-summary', nodeId: utilNamedId, format: { digits: 2 } }
			},
			TEMPLATE,
			opts
		)
	);

	return { title: 'V1 demo · beam calc', graph, registry };
}

/** All fixture builders, for tests that sweep every fixture (V1-5-6 reuses this). */
export const FIXTURE_BUILDERS: readonly (() => FixtureDocument)[] = [
	buildBeamFixture,
	buildBranchFixture,
	buildDemoFixture
];
