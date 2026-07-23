/**
 * SCHEMA.md §3 — the graph node model. Nodes are the single source of truth;
 * every projection (sheet cell, chip, viewer) renders a node. Edges are
 * derived from formula references (formula.ts), never authored.
 */

import type { BlockId, CellRef, NodeId, TypedValue } from './types';
import type { FormulaAST } from './formula';

/** Author-owned presentation metadata for one explicitly published scalar value. */
export interface PublicationMetadata {
	label?: string;
	unit?: string;
	description?: string;
}

/** Who authored/verified a node's current state. Stamped by the mutation API (V1-2-1). */
export interface Provenance {
	authoredBy: 'human' | 'agent' | 'template' | null;
	authorId?: string;
	authoredAt?: number;
	verifiedBy?: string;
	verifiedAt?: number;
}

/**
 * Reserved slot for V3 propose→validate→commit. Serialized and stamped from
 * day one, never interpreted by V1 code.
 */
export interface PendingChange {
	diffId: string;
	proposedBy: 'agent' | 'human';
	proposed: Partial<Pick<GraphNode, 'formula' | 'value' | 'name'>>;
	validation: { unit: boolean; type: boolean; geometry: boolean; messages: string[] };
	status: 'proposed' | 'accepted' | 'rejected';
}

/** One node of the document graph (SCHEMA.md §3). */
export interface GraphNode {
	id: NodeId;
	kind: 'input' | 'computed' | 'namedOutput' | 'geometry' | 'table' | 'error';
	/** Dotted path for published names: "footing.width". */
	name?: string;
	/** Present on computed/geometry/table cells. */
	formula?: FormulaAST;
	/** Last evaluated value (memoized). */
	value: TypedValue;
	/** DERIVED from formula refs by resolveInputs — never authored. */
	inputs: NodeId[];
	/** hash(opId + inputHashes) — the memo key (types.ts `contentHash`). */
	contentHash: string;
	/** Which document block hosts/renders it. */
	blockId?: BlockId;
	/** For Univer-hosted cells. */
	cellRef?: CellRef;
	/** Present only on an explicitly published `namedOutput`. */
	publication?: PublicationMetadata;
	provenance: Provenance;
	pending?: PendingChange | null;
}

/** Unauthored provenance, for nodes created before any actor stamps them. */
export function emptyProvenance(): Provenance {
	return { authoredBy: null };
}
