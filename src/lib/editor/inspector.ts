/**
 * V1-5-5 — the provenance inspector's pure view-model. The inspector is the
 * reviewability surface (PRD §2): for any graph node it answers "what is this
 * value, where did it come from, who authored it, and what depends on it" —
 * which is WHY the product has no node-graph canvas. Everything here is plain
 * TypeScript over the engine's public surface (read-only; no writes, no DOM),
 * so it unit-tests in node. The Svelte panel in `src/routes/app/[docId]/`
 * renders this shape verbatim.
 *
 * Navigation is data too: `inputs` and `dependents` are links carrying the
 * target `nodeId`, resolved through the graph's derived indexes (`inputs` on
 * the node, `dependentsOf` reverse edges) — the panel re-targets itself when a
 * link is activated, so a reviewer walks the dependency chain without leaving
 * the panel.
 */

import type { GraphNode, NodeId, Provenance, TypedValue } from '../engine';
import { format, printFormula } from '../engine';
import { isPendingValue } from './chips';

/**
 * Display kind of a node. The engine's `computed` renders as `formula` —
 * reviewers read formulas, not evaluator internals; other kinds pass through.
 */
export type InspectorKind = 'input' | 'formula' | 'namedOutput' | 'geometry' | 'table' | 'error';

/** One navigable link to a direct input or dependent of the inspected node. */
export interface InspectorLink {
	nodeId: NodeId;
	/** Published name, cell address, or (last resort) the node id. */
	label: string;
	kind: InspectorKind;
}

/** How the inspected node's current value renders (mirrors chip states). */
export interface InspectorValue {
	/** Mono text: number, string, TRUE/FALSE, error code, or `…` while busy. */
	text: string;
	state: 'value' | 'busy' | 'error';
}

/** An authorship stamp: actor text plus (when recorded) an absolute time. */
export interface InspectorAttribution {
	/** Actor kind plus id, e.g. `human`, `template · beam-template`. */
	actor: string;
	/** Human-readable absolute time, e.g. `20 Jul 2026, 14:32`. */
	at?: string;
}

/** Everything the inspector panel shows for one selected node. */
export interface InspectorViewModel {
	nodeId: NodeId;
	/** Heading: published name, cell address, or the node id. */
	title: string;
	/** Published dotted name, when the node has one. */
	name?: string;
	kind: InspectorKind;
	/** Canonical formula text (`= ` + engine printer), formula nodes only. */
	formula?: string;
	value: InspectorValue;
	/** Who authored the node's current state; absent while unauthored. */
	authored?: InspectorAttribution;
	/** Verification stamp, when present (SCHEMA.md §3 `verifiedBy/At`). */
	verified?: { by: string; at?: string };
	/** Direct inputs, in formula reference order. */
	inputs: InspectorLink[];
	/** Direct dependents (reverse edges), sorted by label. */
	dependents: InspectorLink[];
}

/**
 * The read-only slice of `DocumentGraph` the inspector consumes.
 * `DocumentGraph` satisfies it structurally; tests can pass a stub.
 */
export interface InspectorSource {
	nodes: ReadonlyMap<NodeId, GraphNode>;
	dependentsOf(id: NodeId): readonly NodeId[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Absolute, human-readable local time: `20 Jul 2026, 14:32`. */
export function formatTimestamp(ms: number): string {
	const d = new Date(ms);
	const pad = (n: number): string => String(n).padStart(2, '0');
	return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Actor display text from provenance: the kind alone (`human`) or kind plus
 * id (`template · beam-template`). Undefined while the node is unauthored.
 */
export function formatActor(p: Provenance): string | undefined {
	if (p.authoredBy === null) return undefined;
	return p.authorId !== undefined && p.authorId !== ''
		? `${p.authoredBy} · ${p.authorId}`
		: p.authoredBy;
}

/** The human name of a node: published name, cell address, or its id. */
function nodeLabel(node: GraphNode): string {
	return node.name ?? node.cellRef?.a1 ?? node.id;
}

function kindLabel(kind: GraphNode['kind']): InspectorKind {
	return kind === 'computed' ? 'formula' : kind;
}

/**
 * Render a node's value the way chips do (chips.ts `chipDisplay`): plain
 * scalars via 13-digit precision (kills binary float noise), error codes
 * as-is, the engine's pre-settle seed as busy. Duplicated rather than shared
 * because chips format through a `ChipBinding` (with per-chip `digits`) while
 * the inspector renders bare nodes — the V1-5-3 chip surface stays untouched.
 */
function valueDisplay(v: TypedValue): InspectorValue {
	if (isPendingValue(v)) return { text: '…', state: 'busy' };
	switch (v.kind) {
		case 'error':
			return { text: v.code, state: 'error' };
		case 'scalar':
		case 'quantity':
			return { text: format(v), state: 'value' };
		case 'string':
			return { text: v.value, state: 'value' };
		case 'boolean':
			return { text: v.value ? 'TRUE' : 'FALSE', state: 'value' };
		case 'table':
			return { text: '[table]', state: 'value' };
		case 'geometry':
			return { text: v.handle, state: 'value' };
	}
}

/**
 * Build the inspector view-model for `id`, or null when the node does not
 * exist (deleted while inspected — the panel closes). Read-only: derives
 * everything from the node, its provenance, and the graph's derived indexes.
 */
export function buildInspector(source: InspectorSource, id: NodeId): InspectorViewModel | null {
	const node = source.nodes.get(id);
	if (!node) return null;

	// Links resolve through the store; ids without a live node are skipped
	// (transient states around removals — nothing navigable to show).
	const links = (ids: readonly NodeId[]): InspectorLink[] => {
		const out: InspectorLink[] = [];
		for (const nid of ids) {
			const n = source.nodes.get(nid);
			if (n) out.push({ nodeId: nid, label: nodeLabel(n), kind: kindLabel(n.kind) });
		}
		return out;
	};

	const p = node.provenance;
	const actor = formatActor(p);
	return {
		nodeId: id,
		title: nodeLabel(node),
		...(node.name !== undefined ? { name: node.name } : {}),
		kind: kindLabel(node.kind),
		...(node.formula ? { formula: `= ${printFormula(node.formula)}` } : {}),
		value: valueDisplay(node.value),
		...(actor !== undefined
			? {
					authored: {
						actor,
						...(p.authoredAt !== undefined ? { at: formatTimestamp(p.authoredAt) } : {})
					}
				}
			: {}),
		...(p.verifiedBy !== undefined
			? {
					verified: {
						by: p.verifiedBy,
						...(p.verifiedAt !== undefined ? { at: formatTimestamp(p.verifiedAt) } : {})
					}
				}
			: {}),
		inputs: links(node.inputs),
		dependents: links(source.dependentsOf(id)).sort((a, b) => a.label.localeCompare(b.label))
	};
}
