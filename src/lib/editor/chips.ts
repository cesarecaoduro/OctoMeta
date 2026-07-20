/**
 * Pure chip logic (V1-5-3). Inline value chips project graph nodes into
 * prose: the PM node carries ONLY a `chipId` attribute; the authoritative
 * binding (`chipId → nodeId + format`) is the graph's `ChipBinding`
 * (SCHEMA.md §8). Everything here is plain TypeScript over JSON — the DOM
 * NodeView (chip-node.ts) and the editor assembly consume these helpers, and
 * they unit-test in node.
 *
 * Lifecycle (documented decisions, mirrored in the editor assembly):
 * - Insert: `chipOp create` commits BEFORE the PM node lands, so the chip
 *   renders live from its first paint (log order [create][blockOp update]).
 * - Delete from prose: the hosting block's `blockOp update` (pm without the
 *   chip) commits FIRST, then `chipOp remove` — undo replays newest-first,
 *   so the binding is restored before the chip node reappears and no
 *   intermediate `#REF!` is ever visible. One user action spans two undo
 *   entries; the binding entry is invisible on its own.
 * - Copy/paste within the doc duplicates the PM node: the duplicate gets a
 *   FRESH chipId bound to the SAME nodeId (format cloned). Paste from
 *   another document has no source binding and renders `#REF!`.
 */

import type {
	ChipBinding,
	Derivation,
	DerivationSource,
	DerivationStepKind,
	FunctionRegistry,
	GraphNode,
	NodeId,
	TypedValue
} from '../engine';
import { buildDerivation, format } from '../engine';

/** The name of the TipTap inline node that renders value chips (chip-node.ts). */
export const CHIP_NODE_NAME = 'valueChip';

/** The engine's pre-settle placeholder (mutations.ts seeds it on addNode). */
const PENDING_MESSAGE = 'not yet evaluated';

/**
 * True for the mutation layer's "not yet evaluated" placeholder — the only
 * observable between-mutation-and-settle state (commits settle synchronously
 * in V1, so this is what "busy" means here).
 */
export function isPendingValue(v: TypedValue): boolean {
	return v.kind === 'error' && v.code === '#VALUE!' && v.message === PENDING_MESSAGE;
}

/** How a chip renders right now. */
export interface ChipDisplay {
	/**
	 * value: settled non-error value · busy: awaiting settle · error: the bound
	 * node settled to an error · dangling: binding or bound node missing
	 * (deleted node → `#REF!`).
	 */
	state: 'value' | 'busy' | 'error' | 'dangling';
	/** Mono text content (number, string, or error code). */
	text: string;
	/** Screen-reader label (PRD §10). */
	label: string;
	/** Deep-link target: the error's origin node (error state only). */
	origin?: NodeId;
}

/** The human name of a bound node: published name, cell address, or its id. */
function nodeLabel(node: GraphNode): string {
	return node.name ?? node.cellRef?.a1 ?? node.id;
}

/**
 * Map a chip's current binding + bound node to its rendered display.
 * Quantities render bare magnitude (units dormant in V1, decision 19 Jul 2026);
 * numbers respect `format.digits`; errors render their code and carry the
 * origin for deep-linking; a missing binding or deleted node renders `#REF!`.
 */
export function chipDisplay(
	binding: ChipBinding | undefined,
	node: GraphNode | undefined
): ChipDisplay {
	if (!binding || !node) {
		return { state: 'dangling', text: '#REF!', label: 'value chip: reference removed' };
	}
	const name = nodeLabel(node);
	const v = node.value;
	if (isPendingValue(v)) {
		return { state: 'busy', text: '…', label: `${name}: computing` };
	}
	switch (v.kind) {
		case 'error':
			return {
				state: 'error',
				text: v.code,
				label: `${name}: ${v.code}. Press Enter to go to the source`,
				...(v.origin !== '' ? { origin: v.origin } : {})
			};
		case 'scalar':
		case 'quantity': {
			const text = format(v, binding.format);
			return { state: 'value', text, label: `${name}: ${text}` };
		}
		case 'string':
			return { state: 'value', text: v.value, label: `${name}: ${v.value}` };
		case 'boolean': {
			const text = v.value ? 'TRUE' : 'FALSE';
			return { state: 'value', text, label: `${name}: ${text}` };
		}
		case 'table':
			return { state: 'value', text: '[table]', label: `${name}: table` };
		case 'geometry':
			return { state: 'value', text: v.handle, label: `${name}: geometry ${v.handle}` };
	}
}

/** Two displays that would paint identically. */
export function sameDisplay(a: ChipDisplay, b: ChipDisplay): boolean {
	return a.state === b.state && a.text === b.text && a.label === b.label && a.origin === b.origin;
}

// ---------------------------------------------------------------------------
// Doc ⇄ bindings reconciliation plan (executed by create-editor after sync)
// ---------------------------------------------------------------------------

/** One chip node found in the editor doc. `pos` is opaque to the planner. */
export interface ChipOccurrence<P = number> {
	chipId: string;
	pos: P;
	/** blockId of the hosting top-level node, when assigned. */
	hostBlockId: string | null;
}

/** What the editor must do to bring bindings and PM doc back in agreement. */
export interface ChipSyncPlan<P = number> {
	/**
	 * Duplicate occurrences (copy/paste): each needs a fresh chipId bound to
	 * the source binding's node. Occurrences whose source has no binding are
	 * included too — the executor skips them (they render `#REF!`).
	 */
	remints: { pos: P; sourceChipId: string; hostBlockId: string | null }[];
	/** Bindings whose hosting block no longer matches the doc (cut/paste moves). */
	drifts: { chipId: string; hostBlockId: string }[];
	/** Bindings whose chip node vanished from the doc (delete from prose). */
	removals: string[];
}

/**
 * Diff the chip nodes present in the doc against the graph's bindings.
 * Removals are only planned while the binding's hosting block still exists —
 * when a whole block is deleted, `blockOp remove` already cascaded its chips
 * (with inverses) in the same undo entry.
 */
export function planChipSync<P>(
	occurrences: readonly ChipOccurrence<P>[],
	chips: ReadonlyMap<string, ChipBinding>,
	blockExists: (blockId: string) => boolean
): ChipSyncPlan<P> {
	const plan: ChipSyncPlan<P> = { remints: [], drifts: [], removals: [] };
	const seen = new Set<string>();
	for (const occ of occurrences) {
		if (occ.chipId === '' || seen.has(occ.chipId)) {
			plan.remints.push({ pos: occ.pos, sourceChipId: occ.chipId, hostBlockId: occ.hostBlockId });
			continue;
		}
		seen.add(occ.chipId);
		const binding = chips.get(occ.chipId);
		if (
			binding &&
			occ.hostBlockId !== null &&
			binding.blockId !== occ.hostBlockId &&
			blockExists(occ.hostBlockId)
		) {
			plan.drifts.push({ chipId: occ.chipId, hostBlockId: occ.hostBlockId });
		}
	}
	for (const [chipId, binding] of chips) {
		if (!seen.has(chipId) && blockExists(binding.blockId)) plan.removals.push(chipId);
	}
	return plan;
}

// ---------------------------------------------------------------------------
// Show-steps expansion (V1-5-4)
// ---------------------------------------------------------------------------

/**
 * True when a chip's current display supports in-canvas show-steps expansion.
 * Only settled non-error values expand: error and dangling chips keep their
 * V1-5-3 click/Enter affordance (deep-link to the error origin), and busy
 * chips have nothing settled to derive yet.
 */
export function canExpandSteps(display: ChipDisplay): boolean {
	return display.state === 'value';
}

/**
 * The derivation a chip shows when expanded. Chips bind to published names,
 * and a `namedOutput` node is a bare alias of its cell (`beam.load = B1`),
 * whose own derivation is a two-line alias. That answers nothing, so this
 * helper follows ONE alias hop: when the bound node is a `namedOutput` whose
 * formula is a bare reference that resolves, the derivation of the referenced
 * node is shown instead, headed by the published name. Everything else (and
 * the derivation itself) is the engine's `buildDerivation` verbatim.
 */
export function chipDerivation(
	nodeId: NodeId,
	source: DerivationSource,
	registry?: FunctionRegistry
): Derivation {
	const node = source.nodes.get(nodeId);
	if (node?.kind === 'namedOutput' && node.formula?.t === 'ref') {
		const target = source.resolveRef(node.formula.ref);
		if (target !== undefined && target !== nodeId) {
			const aliased = buildDerivation(target, source, registry);
			const name = node.name ?? aliased.name;
			return { ...aliased, nodeId, ...(name !== undefined ? { name } : {}) };
		}
	}
	return buildDerivation(nodeId, source, registry);
}

/** One rendered derivation line: the step kind plus its display text. */
export interface DerivationLine {
	kind: DerivationStepKind;
	text: string;
}

/**
 * A derivation as display lines, mirroring the engine's `renderStepsText`
 * shape: the head line is `name = <formula>` (bare step text when the node has
 * no name), every following line is `= <step>`.
 */
export function derivationLines(derivation: Derivation): DerivationLine[] {
	const [first, ...rest] = derivation.steps;
	const head = derivation.name !== undefined ? `${derivation.name} = ${first.text}` : first.text;
	return [
		{ kind: first.kind, text: head },
		...rest.map((step) => ({ kind: step.kind, text: `= ${step.text}` }))
	];
}

// ---------------------------------------------------------------------------
// Picker items (insert-by-name)
// ---------------------------------------------------------------------------

/** One insertable published value. */
export interface ChipPickItem {
	name: string;
	nodeId: NodeId;
}

/**
 * Published names matching `query` (case-insensitive substring), prefix
 * matches first, then alphabetical, capped at `limit`. An empty query lists
 * everything (discoverability when typing a bare `@`).
 */
export function filterPickItems(
	items: readonly ChipPickItem[],
	query: string,
	limit = 8
): ChipPickItem[] {
	const q = query.toLowerCase();
	return items
		.filter((item) => item.name.toLowerCase().includes(q))
		.sort((a, b) => {
			const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
			const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
			return ap !== bp ? ap - bp : a.name.localeCompare(b.name);
		})
		.slice(0, limit);
}
