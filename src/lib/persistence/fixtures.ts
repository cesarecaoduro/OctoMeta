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
	parseQuantity,
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
function ast(src: string, sheetId: string): FormulaAST {
	const parsed = parseFormula(src, { sheetId });
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
	const SHEET = 'blk-beam-sheet';
	const INTRO = 'blk-beam-intro';
	const graph = new DocumentGraph({
		sheets: [{ id: SHEET, name: 'Calculation', position: 0 }]
	});
	const opts = { registry };

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
	const addInput = (id: NodeId, a1: string, value: number): void => {
		must(
			commit(
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
					cellRef: { sheetId: SHEET, a1: 'A3' },
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
			{ op: 'publishName', cellRef: { sheetId: SHEET, a1: 'A1' }, name: 'beam.span' },
			HUMAN,
			opts
		)
	);
	const momentNamedId = must(
		commit(
			graph,
			{ op: 'publishName', cellRef: { sheetId: SHEET, a1: 'A3' }, name: 'beam.moment' },
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
					cellRef: { sheetId: SHEET, a1: 'A4' },
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
	const SHEET = 'blk-branch-sheet';
	const graph = new DocumentGraph({
		sheets: [{ id: SHEET, name: 'Calculation', position: 0 }]
	});
	const opts = { registry };

	const addInput = (id: NodeId, a1: string, value: TypedValue): void => {
		must(
			commit(
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
						cellRef: { sheetId: SHEET, a1 },
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
			{ op: 'publishName', cellRef: { sheetId: SHEET, a1: 'A1' }, name: 'calc.x' },
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
	const TEMPLATE: Actor = { kind: 'template', id: 'octometa.beam-demo' };
	const DOC = 'fixture:demo';
	const INPUTS = 'blk-demo-inputs';
	const CHECKS = 'blk-demo-checks';
	const graph = new DocumentGraph({
		sheets: [
			{ id: INPUTS, name: 'Inputs', position: 0 },
			{ id: CHECKS, name: 'Checks', position: 1 }
		]
	});
	// The demo doc carries a SHOWSTEPS cell, so its commits (like the app's
	// GraphSession and hydrateGraph) use the derivation-capable evaluator.
	const opts = { registry, evaluate: evaluateWithDerivations(graph) };

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
	addBlock('blk-demo-summary', {
		type: 'text',
		pm: {
			type: 'paragraph',
			content: [text('The section works at a utilization of '), chipNode('chip-demo-util'), text('.')]
		}
	});

	const addInput = (id: NodeId, sheet: string, a1: string, value: number): void => {
		must(
			commit(
				graph,
				{
					op: 'addNode',
					node: {
						id,
						kind: 'input',
						cellRef: { sheetId: sheet, a1 },
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
						cellRef: { sheetId: sheet, a1 },
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
			commit(graph, { op: 'publishName', cellRef: { sheetId: sheet, a1 }, name }, TEMPLATE, opts)
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

/**
 * Release-one steel workbench fixture used by the user-facing “Load demo”
 * action. It deliberately uses the same mutation, recalculation, published
 * name, block, chip, and equation paths as an authored document.
 *
 * Workbook:
 * - Input: five editable imperial inputs.
 * - Calculation: cross-tab formulae consuming published names.
 * - Output: report-facing projections of the calculated values.
 */
export function buildSteelDemoFixture(): FixtureDocument {
	const registry = createBuiltinRegistry();
	const TEMPLATE: Actor = { kind: 'template', id: 'octometa.steel-beam-check' };
	const DOC = 'fixture:steel-beam-check';
	const INPUT = 'sheet-steel-input';
	const CALCULATION = 'sheet-steel-calculation';
	const OUTPUT = 'sheet-steel-output';
	const graph = new DocumentGraph({
		sheets: [
			{ id: INPUT, name: 'Input', position: 0 },
			{ id: CALCULATION, name: 'Calculation', position: 1 },
			{ id: OUTPUT, name: 'Output', position: 2 }
		]
	});
	const opts = { registry, evaluate: evaluateWithDerivations(graph) };

	const addInput = (id: NodeId, a1: string, source: string): void => {
		must(
			commit(
				graph,
				{
					op: 'addNode',
					node: {
						id,
						kind: 'input',
						cellRef: { sheetId: INPUT, a1 },
						provenance: emptyProvenance()
					}
				},
				TEMPLATE,
				opts
			)
		);
		const parsedValue = parseQuantity(source);
		if (parsedValue.kind === 'error') {
			throw new Error(`steel fixture input "${source}": ${parsedValue.message}`);
		}
		must(commit(graph, { op: 'setInput', id, value: parsedValue }, TEMPLATE, opts));
	};
	const addComputed = (id: NodeId, sheetId: string, a1: string, source: string): void => {
		must(
			commit(
				graph,
				{
					op: 'addNode',
					node: {
						id,
						kind: 'computed',
						formula: ast(source, sheetId),
						cellRef: { sheetId, a1 },
						provenance: emptyProvenance()
					}
				},
				TEMPLATE,
				opts
			)
		);
	};
	const publish = (sheetId: string, a1: string, name: string): NodeId =>
		must(
			commit(graph, { op: 'publishName', cellRef: { sheetId, a1 }, name }, TEMPLATE, opts)
		).affected[0];

	addInput('node-steel-fy', 'A1', '50 ksi');
	addInput('node-steel-d', 'A2', '20 in');
	addInput('node-steel-tw', 'A3', '2 in');
	addInput('node-steel-bf', 'A4', '14.5 in');
	addInput('node-steel-tf', 'A5', '0.5 in');
	const fyId = publish(INPUT, 'A1', 'steel.Fy');
	const dId = publish(INPUT, 'A2', 'steel.d');
	const twId = publish(INPUT, 'A3', 'steel.tw');
	const bfId = publish(INPUT, 'A4', 'steel.bf');
	const tfId = publish(INPUT, 'A5', 'steel.tf');

	// These compact illustrative formulae produce the locked demo outputs and
	// exercise cross-tab published-name resolution with real dimensions.
	addComputed(
		'node-steel-area-calculation',
		CALCULATION,
		'A1',
		'=steel.d * steel.tw - steel.tw^2 / 2'
	);
	addComputed('node-steel-rt-calculation', CALCULATION, 'A2', '=steel.d * 0.10575');
	const areaCalculationId = publish(CALCULATION, 'A1', 'section.area.calculated');
	publish(CALCULATION, 'A2', 'section.rt.calculated');

	addComputed('node-steel-area-output', OUTPUT, 'A1', '=section.area.calculated');
	addComputed('node-steel-rt-output', OUTPUT, 'A2', '=section.rt.calculated');
	const areaOutputId = publish(OUTPUT, 'A1', 'section.A');
	const rtOutputId = publish(OUTPUT, 'A2', 'section.rt');

	const text = (value: string) => ({ type: 'text', text: value });
	const chipNode = (chipId: string) => ({ type: 'valueChip', attrs: { chipId } });
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
	addBlock('block-steel-title', {
		type: 'heading',
		pm: { type: 'heading', attrs: { level: 1 }, content: [text('Steel beam check')] }
	});
	addBlock('block-steel-intro', {
		type: 'text',
		pm: {
			type: 'paragraph',
			content: [
				text(
					'Review the section inputs, follow the bound calculation, and inspect the published results.'
				)
			]
		}
	});
	addBlock('block-steel-inputs-title', {
		type: 'heading',
		pm: { type: 'heading', attrs: { level: 2 }, content: [text('Inputs')] }
	});
	addBlock('block-steel-inputs', {
		type: 'text',
		pm: {
			type: 'paragraph',
			content: [
				text('Fy = '),
				chipNode('chip-steel-fy'),
				text(', d = '),
				chipNode('chip-steel-d'),
				text(', tw = '),
				chipNode('chip-steel-tw'),
				text(', bf = '),
				chipNode('chip-steel-bf'),
				text(', tf = '),
				chipNode('chip-steel-tf'),
				text('.')
			]
		}
	});
	addBlock('block-steel-area-equation', {
		type: 'equation',
		equation: {
			mode: 'bound',
			nodeId: areaCalculationId,
			display: 'substituted'
		}
	});
	addBlock('block-steel-results-title', {
		type: 'heading',
		pm: { type: 'heading', attrs: { level: 2 }, content: [text('Results')] }
	});
	addBlock('block-steel-results', {
		type: 'text',
		pm: {
			type: 'paragraph',
			content: [
				text('A = '),
				chipNode('chip-steel-area'),
				text(' and rt = '),
				chipNode('chip-steel-rt'),
				text('.')
			]
		}
	});

	const chips: Array<{
		id: string;
		blockId: string;
		nodeId: NodeId;
		format: { digits: number; unit: string };
	}> = [
		{ id: 'chip-steel-area', blockId: 'block-steel-results', nodeId: areaOutputId, format: { digits: 2, unit: 'in²' } },
		{ id: 'chip-steel-bf', blockId: 'block-steel-inputs', nodeId: bfId, format: { digits: 1, unit: 'in' } },
		{ id: 'chip-steel-d', blockId: 'block-steel-inputs', nodeId: dId, format: { digits: 0, unit: 'in' } },
		{ id: 'chip-steel-fy', blockId: 'block-steel-inputs', nodeId: fyId, format: { digits: 0, unit: 'ksi' } },
		{ id: 'chip-steel-rt', blockId: 'block-steel-results', nodeId: rtOutputId, format: { digits: 3, unit: 'in' } },
		{ id: 'chip-steel-tf', blockId: 'block-steel-inputs', nodeId: tfId, format: { digits: 1, unit: 'in' } },
		{ id: 'chip-steel-tw', blockId: 'block-steel-inputs', nodeId: twId, format: { digits: 0, unit: 'in' } }
	];
	for (const chip of chips) {
		must(
			commit(
				graph,
				{
					op: 'chipOp',
					action: 'create',
					chipId: chip.id,
					chip: { blockId: chip.blockId, nodeId: chip.nodeId, format: chip.format }
				},
				TEMPLATE,
				opts
			)
		);
	}

	return { title: 'Steel beam check', graph, registry };
}

/** All fixture builders, for tests that sweep every fixture (V1-5-6 reuses this). */
export const FIXTURE_BUILDERS: readonly (() => FixtureDocument)[] = [
	buildBeamFixture,
	buildBranchFixture,
	buildDemoFixture,
	buildSteelDemoFixture
];
