/**
 * V1-2-1 — `DocumentGraph`: the in-memory store and single source of truth for
 * one document (SCHEMA.md §3, §8, §9). Holds nodes, blocks, chip bindings, the
 * undo log, and the derived indexes (name → node, cellRef → node, reverse
 * edges, unresolved refs) that mutations (mutations.ts) and recalc (V1-2-2)
 * share. All writes flow through `applyMutation` — the store methods here are
 * low-level primitives that keep the indexes consistent, never policy.
 */

import type { CellRef, NodeId, SheetId, SheetMeta, WorkbookManifest } from './types';
import { contentHash, createDefaultWorkbook } from './types';
import type { GraphNode } from './node';
import type { Block, ChipBinding } from './block';
import type { FormulaAST } from './formula';
import { expandRange, isNameRef, isRangeRef, printFormula } from './formula';
import type { Actor, GraphMutation, UndoEntry } from './mutations';

/** The undo log keeps at most this many entries, pruned oldest-first (SCHEMA.md §9). */
export const UNDO_CAP = 200;

const KEY_SEP = '\u001f'; // unit separator: keeps composite keys unambiguous

/** Index key for a reference: distinct keyspaces for cell refs and names. */
export function refKey(ref: CellRef | { name: string }): string {
	return isNameRef(ref) ? `name:${ref.name}` : `cell:${ref.sheetId}${KEY_SEP}${ref.a1}`;
}

/**
 * Walk a formula and return every distinct reference in first-appearance
 * order. Unlike formula.ts `resolveInputs`, this does not stop at the first
 * unresolved ref — mutations need the complete list to derive inputs and to
 * record unresolved refs for later healing.
 */
export function collectRefs(ast: FormulaAST): (CellRef | { name: string })[] {
	const out: (CellRef | { name: string })[] = [];
	const seen = new Set<string>();
	const walk = (node: FormulaAST): void => {
		switch (node.t) {
			case 'lit':
				return;
			case 'ref': {
				// Ranges contribute their constituent cells (per-cell inputs and
				// healing). Malformed/oversized ranges keep the raw ref: it can
				// never resolve, so the node settles on the unresolved error.
				const expanded = isRangeRef(node.ref) ? expandRange(node.ref) : [node.ref];
				const refs = Array.isArray(expanded) ? expanded : [node.ref];
				for (const ref of refs) {
					const key = refKey(ref);
					if (!seen.has(key)) {
						seen.add(key);
						out.push(ref);
					}
				}
				return;
			}
			case 'un':
				return walk(node.arg);
			case 'bin':
				walk(node.left);
				walk(node.right);
				return;
			case 'call':
				for (const arg of node.args) walk(arg);
				return;
		}
	};
	walk(ast);
	return out;
}

/**
 * Deterministic JSON: object keys sorted, undefined-valued keys skipped
 * (JSON semantics). Shared by `nodeOpId` and any layer that hashes values.
 */
export function stableStringify(v: unknown): string {
	if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
	if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x)).join(',')}]`;
	const obj = v as Record<string, unknown>;
	const keys = Object.keys(obj)
		.filter((k) => obj[k] !== undefined)
		.sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/**
 * A node's operation identity for hashing (SCHEMA.md §3): its kind plus the
 * canonical formula text, or — for formula-less nodes — its stable value JSON.
 */
export function nodeOpId(node: GraphNode): string {
	return `${node.kind}:${node.formula ? printFormula(node.formula) : stableStringify(node.value)}`;
}

/** Change subscriber — invoked by `notify` after recalc settles a node (V1-2-2). */
export type NodeSubscriber = (node: GraphNode) => void;

/** A published alias together with the one source node it directly targets. */
export interface ResolvedPublishedTarget {
	publishedNode: GraphNode;
	targetNode: GraphNode;
}

/**
 * Resolve exactly one `namedOutput` alias hop.
 *
 * The published node remains the stable binding identity for chips and
 * equations; callers use the target kind/value to decide whether it is an
 * editable input or a read-only output. Alias chains are returned as a
 * `namedOutput` target and therefore remain read-only in R1.
 */
export function resolvePublishedTarget(
	doc: DocumentGraph,
	publishedNodeId: NodeId
): ResolvedPublishedTarget | null {
	const publishedNode = doc.nodes.get(publishedNodeId);
	if (publishedNode?.kind !== 'namedOutput' || publishedNode.inputs.length !== 1) return null;
	const targetNode = doc.nodes.get(publishedNode.inputs[0]);
	return targetNode ? { publishedNode, targetNode } : null;
}

/**
 * The in-memory document graph. Owns the invariants:
 * - `blocksOrder` is canonical; every `block.position` equals its index
 *   (SCHEMA.md §10 — maintained by the block store methods, asserted in tests).
 * - Derived indexes (name, cellRef, reverse edges, unresolved refs) are
 *   maintained incrementally by `insertNode`/`deleteNode`/`replaceNode`.
 * - The undo log truncates the redo tail on push and caps at `UNDO_CAP`.
 */
export class DocumentGraph {
	/** Canonical workbook-tab identity, display names, and order. */
	readonly workbook: WorkbookManifest;
	/** All graph nodes by id — the single source of truth (SCHEMA.md §3). */
	readonly nodes = new Map<NodeId, GraphNode>();
	/** All document blocks by id (SCHEMA.md §8). */
	readonly blocks = new Map<string, Block>();
	/** Canonical block order; `block.position` is a denormalized copy (SCHEMA.md §10). */
	blocksOrder: string[] = [];
	/** Inline value chip bindings by chip id (SCHEMA.md §8). */
	readonly chips = new Map<string, ChipBinding>();

	/** Linear per-document history (SCHEMA.md §9). Entries below the cursor are undoable. */
	undoLog: UndoEntry[] = [];
	/** Boundary between undoable entries (below) and the redo tail (above). */
	undoCursor = 0;

	private byName = new Map<string, NodeId>();
	private byCellRef = new Map<string, NodeId>();
	/** target id → ids of nodes listing it in `inputs` (reverse edges). */
	private dependents = new Map<NodeId, Set<NodeId>>();
	/** refKey → ids of nodes whose formula holds that unresolved ref (healing index). */
	private unresolved = new Map<string, Set<NodeId>>();
	/** waiter id → its registered unresolved refKeys (for cleanup). */
	private unresolvedByNode = new Map<NodeId, Set<string>>();
	private subscribers = new Map<NodeId, Set<NodeSubscriber>>();

	/**
	 * Create a document graph with an owned workbook manifest.
	 * Callers may provide restored metadata; the input is cloned and normalized.
	 */
	constructor(workbook: WorkbookManifest = createDefaultWorkbook()) {
		this.workbook = structuredClone(workbook);
		if (this.workbook.sheets.length === 0) {
			this.workbook.sheets.push(...createDefaultWorkbook().sheets);
		}
		this.renumberSheets();
	}

	// -----------------------------------------------------------------------
	// Workbook manifest (policy and history live in mutations.ts)
	// -----------------------------------------------------------------------

	/** Return one tab's canonical metadata. */
	sheet(sheetId: SheetId): SheetMeta | undefined {
		return this.workbook.sheets.find((sheet) => sheet.id === sheetId);
	}

	/** Insert a tab at its requested position and normalize all positions. */
	insertSheet(sheet: SheetMeta): void {
		const at = clampIndex(sheet.position, this.workbook.sheets.length);
		this.workbook.sheets.splice(at, 0, structuredClone(sheet));
		this.renumberSheets();
	}

	/** Rename a tab without changing its stable identity or order. */
	renameSheet(sheetId: SheetId, name: string): void {
		const sheet = this.sheet(sheetId);
		if (sheet) sheet.name = name;
	}

	/** Remove a tab and normalize the surviving tab positions. */
	deleteSheet(sheetId: SheetId): void {
		const at = this.workbook.sheets.findIndex((sheet) => sheet.id === sheetId);
		if (at >= 0) this.workbook.sheets.splice(at, 1);
		this.renumberSheets();
	}

	private renumberSheets(): void {
		for (let i = 0; i < this.workbook.sheets.length; i++) {
			this.workbook.sheets[i].position = i;
		}
	}

	// -----------------------------------------------------------------------
	// Reference resolution
	// -----------------------------------------------------------------------

	/** Resolve a formula reference to the node it currently designates, if any. */
	resolveRef = (ref: CellRef | { name: string }): NodeId | undefined => {
		return isNameRef(ref) ? this.byName.get(ref.name) : this.byCellRef.get(refKey(ref));
	};

	/** Ids of the nodes that list `id` in their `inputs` (reverse edges). */
	dependentsOf(id: NodeId): readonly NodeId[] {
		return [...(this.dependents.get(id) ?? [])];
	}

	/** Ids of the nodes waiting on an unresolved reference key (see `refKey`). */
	waitersFor(key: string): readonly NodeId[] {
		return [...(this.unresolved.get(key) ?? [])];
	}

	/** `inputs` accessor in the shape topo.ts expects; missing nodes have none. */
	inputsOf = (id: NodeId): readonly NodeId[] => {
		return this.nodes.get(id)?.inputs ?? [];
	};

	// -----------------------------------------------------------------------
	// Node store (low-level; policy lives in mutations.ts)
	// -----------------------------------------------------------------------

	/**
	 * Insert a node and index it: name, cellRef, reverse edges from its stored
	 * `inputs`, and — when it has a formula — every currently-unresolved ref
	 * into the healing index. Inputs are taken verbatim, never re-derived.
	 */
	insertNode(node: GraphNode): void {
		this.nodes.set(node.id, node);
		if (node.name !== undefined) this.byName.set(node.name, node.id);
		if (node.cellRef !== undefined) this.byCellRef.set(refKey(node.cellRef), node.id);
		for (const input of node.inputs) {
			let bucket = this.dependents.get(input);
			if (!bucket) this.dependents.set(input, (bucket = new Set()));
			bucket.add(node.id);
		}
		if (node.formula) {
			for (const ref of collectRefs(node.formula)) {
				if (this.resolveRef(ref) !== undefined) continue;
				const key = refKey(ref);
				let waiters = this.unresolved.get(key);
				if (!waiters) this.unresolved.set(key, (waiters = new Set()));
				waiters.add(node.id);
				let keys = this.unresolvedByNode.get(node.id);
				if (!keys) this.unresolvedByNode.set(node.id, (keys = new Set()));
				keys.add(key);
			}
		}
	}

	/**
	 * Remove a node from the store and every index it participates in as a
	 * source. Reverse-edge entries *pointing at* it survive — they are derived
	 * from other nodes' `inputs`, which mutations update separately (Marimo
	 * `#REF!` semantics live in mutations.ts, not here).
	 */
	deleteNode(id: NodeId): void {
		const node = this.nodes.get(id);
		if (!node) return;
		this.nodes.delete(id);
		if (node.name !== undefined && this.byName.get(node.name) === id) this.byName.delete(node.name);
		if (node.cellRef !== undefined) {
			const key = refKey(node.cellRef);
			if (this.byCellRef.get(key) === id) this.byCellRef.delete(key);
		}
		for (const input of node.inputs) this.dependents.get(input)?.delete(id);
		const keys = this.unresolvedByNode.get(id);
		if (keys) {
			for (const key of keys) {
				const waiters = this.unresolved.get(key);
				waiters?.delete(id);
				if (waiters && waiters.size === 0) this.unresolved.delete(key);
			}
			this.unresolvedByNode.delete(id);
		}
	}

	/** Replace a node's stored state wholesale, reindexing everything. */
	replaceNode(node: GraphNode): void {
		this.deleteNode(node.id);
		this.insertNode(node);
	}

	/**
	 * Recompute a node's `contentHash` from its opId and its inputs' hashes in
	 * order (types.ts `contentHash`). Inputs missing from the store hash as ''.
	 */
	refreshHash(id: NodeId): void {
		const node = this.nodes.get(id);
		if (!node) return;
		const inputHashes = node.inputs.map((input) => this.nodes.get(input)?.contentHash ?? '');
		node.contentHash = contentHash(nodeOpId(node), inputHashes);
	}

	// -----------------------------------------------------------------------
	// Block store (blocksOrder is canonical; positions renormalized every op)
	// -----------------------------------------------------------------------

	/** Insert a block at `index` (clamped; end when omitted) and renumber positions. */
	insertBlock(block: Block, index?: number): void {
		this.blocks.set(block.id, block);
		const at = clampIndex(index ?? this.blocksOrder.length, this.blocksOrder.length);
		this.blocksOrder.splice(at, 0, block.id);
		this.renumberBlocks();
	}

	/** Remove a block from the store and order, renumbering positions. */
	deleteBlock(id: string): void {
		this.blocks.delete(id);
		const at = this.blocksOrder.indexOf(id);
		if (at >= 0) this.blocksOrder.splice(at, 1);
		this.renumberBlocks();
	}

	/** Move a block to `index` (clamped) and renumber positions. */
	moveBlock(id: string, index: number): void {
		const from = this.blocksOrder.indexOf(id);
		if (from < 0) return;
		this.blocksOrder.splice(from, 1);
		this.blocksOrder.splice(clampIndex(index, this.blocksOrder.length), 0, id);
		this.renumberBlocks();
	}

	private renumberBlocks(): void {
		for (let i = 0; i < this.blocksOrder.length; i++) {
			const block = this.blocks.get(this.blocksOrder[i]);
			if (block) block.position = i;
		}
	}

	// -----------------------------------------------------------------------
	// Undo log (SCHEMA.md §9)
	// -----------------------------------------------------------------------

	/**
	 * Append a fresh mutation's entry: truncates any redo tail above the
	 * cursor, assigns the next monotonic `seq`, then prunes oldest-first to
	 * `UNDO_CAP`, adjusting the cursor. Only fresh mutations call this —
	 * undo/redo never append (SCHEMA.md §9).
	 */
	pushUndoEntry(mutation: GraphMutation, inverse: GraphMutation[], actor: Actor, at: number): UndoEntry {
		this.undoLog.length = this.undoCursor;
		const seq = (this.undoLog[this.undoLog.length - 1]?.seq ?? 0) + 1;
		const entry: UndoEntry = { seq, mutation, inverse, actor, at };
		this.undoLog.push(entry);
		this.undoCursor = this.undoLog.length;
		while (this.undoLog.length > UNDO_CAP) {
			this.undoLog.shift();
			this.undoCursor--;
		}
		return entry;
	}

	// -----------------------------------------------------------------------
	// Subscribers (recalc notifies; mutations never do — V1-2-2 wiring)
	// -----------------------------------------------------------------------

	/** Subscribe to a node's settled-value notifications. Returns an unsubscriber. */
	subscribe(nodeId: NodeId, cb: NodeSubscriber): () => void {
		let set = this.subscribers.get(nodeId);
		if (!set) this.subscribers.set(nodeId, (set = new Set()));
		set.add(cb);
		return () => {
			set.delete(cb);
			if (set.size === 0) this.subscribers.delete(nodeId);
		};
	}

	/** Notify a node's subscribers. Recalc (V1-2-2) calls this after settling. */
	notify(nodeId: NodeId): void {
		const node = this.nodes.get(nodeId);
		if (!node) return;
		for (const cb of this.subscribers.get(nodeId) ?? []) cb(node);
	}
}

function clampIndex(index: number, max: number): number {
	return Math.max(0, Math.min(Math.trunc(index), max));
}
