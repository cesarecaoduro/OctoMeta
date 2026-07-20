/**
 * Editor ⇄ graph reconciliation (V1-5-1). After every TipTap update the doc's
 * top-level nodes are diffed against `graph.blocksOrder`, and every difference
 * becomes a `blockOp` through the single mutation write path — no side
 * channel, so block structure lands in the engine undo log (SCHEMA.md §9):
 *
 * - structural changes (add / remove / move / top-level type change) commit
 *   synchronously in the same reconcile pass;
 * - per-block content changes (prose keystrokes → PM JSON, image alt/caption)
 *   are debounced per block and commit as `blockOp update` after `delayMs` of
 *   quiet; `flush()` commits them immediately (called before undo/redo/save
 *   and before any structural commit, so undo boundaries stay sane).
 *
 * Sheet blocks (V1-5-2) reconcile structurally like any managed type — their
 * PM node is an empty atom, so they only ever add/remove/move here; cell
 * content flows through the Univer adapter and `sheetSnapshots`, never
 * through blockOp update. Types this editor does not manage (equation/viewer,
 * V2) are never touched by reconciliation.
 *
 * Trailing-paragraph rule (docs/v1-0-findings.md landmine 3): TipTap's
 * `trailingNode` keeps an empty paragraph after the last block as UI chrome —
 * including right after `renderFromGraph`, when no user edit happened. A
 * final empty, unassigned paragraph is therefore EPHEMERAL: reconcile ignores
 * it until it gains content, so it never plants stray `blockOp add`s between
 * a user's action and their undo (and undo/redo re-renders cannot truncate
 * the redo tail by re-adding it).
 *
 * Pure TS over JSON — unit-tested in node against a real DocumentGraph.
 */

import type { Block, GraphMutation } from '../engine';
import { ulid } from '../engine';
import type { BlockSpec, PMJson } from './blocks';
import { MANAGED_BLOCK_TYPES, blockIdOf, jsonEqual, specFromPmNode } from './blocks';

/** What the sync needs from its host page — a thin seam over `commit`. */
export interface SyncHost {
	/** The Convex document id, stamped into new blocks' `docId`. */
	docId: string;
	/** Canonical block order right now (graph.blocksOrder). */
	order(): readonly string[];
	/** Look up one block by id. */
	block(id: string): Block | undefined;
	/**
	 * Commit one mutation through the engine write path (`commit` =
	 * applyMutation + recalc). Returns false when the engine rejected it.
	 */
	commit(m: GraphMutation): boolean;
	/** Id factory for new blocks — injectable for deterministic tests. */
	newBlockId?: () => string;
}

export interface BlockSync {
	/**
	 * Reconcile the current editor doc against the graph. Commits structural
	 * blockOps now, schedules debounced content updates, and returns the ids
	 * assigned to previously-unidentified top-level nodes keyed by their child
	 * index — the editor stamps these back into the PM doc.
	 */
	reconcile(doc: PMJson): Map<number, string>;
	/** Commit every pending debounced content update now. */
	flush(): void;
	/** True while a debounced content update is waiting. */
	hasPending(): boolean;
	/** Cancel pending work permanently. */
	dispose(): void;
}

/** Default quiet period before per-block content updates commit. */
export const DEFAULT_SYNC_DELAY_MS = 300;

/** One desired top-level entry after id assignment. */
interface Desired {
	id: string;
	spec: BlockSpec;
	isNew: boolean;
}

/** Create the reconciler bound to one host (one document/editor pair). */
export function createBlockSync(host: SyncHost, opts?: { delayMs?: number }): BlockSync {
	const delayMs = opts?.delayMs ?? DEFAULT_SYNC_DELAY_MS;
	const newId = host.newBlockId ?? (() => ulid());
	/** blockId → latest desired content payload, waiting for the debounce. */
	const pending = new Map<string, Pick<BlockSpec, 'pm' | 'image' | 'equation'>>();
	let timer: ReturnType<typeof setTimeout> | null = null;
	let disposed = false;

	const clearTimer = (): void => {
		if (timer !== null) clearTimeout(timer);
		timer = null;
	};

	/** Commit one pending update if the block still exists and still differs. */
	const commitUpdate = (
		id: string,
		payload: Pick<BlockSpec, 'pm' | 'image' | 'equation'>
	): void => {
		const block = host.block(id);
		if (!block) return;
		const fields: Partial<Block> = {};
		if (payload.pm !== undefined && !jsonEqual(block.pm, payload.pm)) fields.pm = payload.pm;
		if (payload.image !== undefined && !jsonEqual(block.image, payload.image)) {
			fields.image = payload.image;
		}
		if (payload.equation !== undefined && !jsonEqual(block.equation, payload.equation)) {
			fields.equation = payload.equation;
		}
		if (Object.keys(fields).length === 0) return;
		host.commit({ op: 'blockOp', action: 'update', blockId: id, block: fields });
	};

	const flush = (): void => {
		clearTimer();
		if (pending.size === 0) return;
		const batch = [...pending];
		pending.clear();
		for (const [id, payload] of batch) commitUpdate(id, payload);
	};

	const scheduleUpdate = (
		id: string,
		payload: Pick<BlockSpec, 'pm' | 'image' | 'equation'>
	): void => {
		pending.set(id, payload);
		clearTimer();
		timer = setTimeout(() => {
			timer = null;
			flush();
		}, delayMs);
	};

	/**
	 * Assign an id to every top-level node: keep a valid, unseen attribute id;
	 * mint fresh ids for unassigned nodes and for duplicates (Enter splits use
	 * `keepOnSplit: false`, but copy/paste can still duplicate an id).
	 */
	const assignIds = (
		nodes: readonly PMJson[]
	): { desired: Desired[]; assigned: Map<number, string> } => {
		const desired: Desired[] = [];
		const assigned = new Map<number, string>();
		const seen = new Set<string>();
		nodes.forEach((node, index) => {
			const spec = specFromPmNode(node);
			let id = blockIdOf(node);
			let isNew = false;
			if (id === null || seen.has(id)) {
				id = newId();
				assigned.set(index, id);
				isNew = true;
			} else if (host.block(id) === undefined) {
				// Known-looking id the graph has never seen (e.g. cross-doc paste):
				// keep it and add the block under it.
				isNew = true;
			}
			seen.add(id);
			desired.push({ id, spec, isNew });
		});
		return { desired, assigned };
	};

	/** The ephemeral trailing node: an empty, unassigned paragraph at the end. */
	const isEphemeralTrailing = (node: PMJson): boolean =>
		node.type === 'paragraph' &&
		blockIdOf(node) === null &&
		(node.content === undefined || node.content.length === 0);

	const reconcile = (doc: PMJson): Map<number, string> => {
		if (disposed) return new Map();
		const nodes = [...(doc.content ?? [])];
		if (nodes.length > 0 && isEphemeralTrailing(nodes[nodes.length - 1])) nodes.pop();
		const { desired, assigned } = assignIds(nodes);
		const desiredIds = new Set(desired.map((d) => d.id));

		/** Structural ops flush queued content first so undo replays in order. */
		const flushBefore = (): void => {
			if (pending.size > 0) flush();
		};

		// Removes: managed blocks that vanished from the doc. Unmanaged types
		// (equation/viewer, V2) are left alone.
		for (const id of [...host.order()]) {
			const block = host.block(id);
			if (!block || !MANAGED_BLOCK_TYPES.includes(block.type)) continue;
			if (desiredIds.has(id)) continue;
			flushBefore();
			pending.delete(id);
			host.commit({ op: 'blockOp', action: 'remove', blockId: id });
		}

		// Adds and type changes (blockOp update protects `type`, so a top-level
		// node-type change is remove + add under the same id, same position).
		desired.forEach(({ id, spec, isNew }, index) => {
			const existing = host.block(id);
			if (!isNew && existing && existing.type !== spec.type) {
				flushBefore();
				pending.delete(id);
				if (host.commit({ op: 'blockOp', action: 'remove', blockId: id })) isNew = true;
			}
			if (isNew || host.block(id) === undefined) {
				flushBefore();
				const block: Partial<Block> = { docId: host.docId, type: spec.type };
				if (spec.pm !== undefined) block.pm = spec.pm;
				if (spec.image !== undefined) block.image = spec.image;
				if (spec.equation !== undefined) block.equation = spec.equation;
				host.commit({ op: 'blockOp', action: 'add', blockId: id, block, position: index });
			}
		});

		// Moves: bring the managed slice of blocksOrder into doc order. Every R1
		// block type (text/heading/image/equation) is managed, so indices in the PM
		// doc are absolute positions in blocksOrder.
		const target = desired.map((d) => d.id);
		const current = [...host.order()].filter((id) => desiredIds.has(id));
		for (let i = 0; i < target.length; i++) {
			if (current[i] === target[i]) continue;
			flushBefore();
			if (host.commit({ op: 'blockOp', action: 'move', blockId: target[i], position: i })) {
				const from = current.indexOf(target[i]);
				if (from >= 0) current.splice(from, 1);
				current.splice(i, 0, target[i]);
			}
		}

		// Content updates: debounced per block.
		for (const { id, spec, isNew } of desired) {
			if (isNew) continue;
			const block = host.block(id);
			if (!block) continue;
			const changed =
				(spec.pm !== undefined && !jsonEqual(block.pm, spec.pm)) ||
				(spec.image !== undefined && !jsonEqual(block.image, spec.image)) ||
				(spec.equation !== undefined && !jsonEqual(block.equation, spec.equation));
			if (changed) {
				scheduleUpdate(id, {
					pm: spec.pm,
					image: spec.image,
					equation: spec.equation
				});
			}
			else pending.delete(id);
		}

		return assigned;
	};

	return {
		reconcile,
		flush,
		hasPending: () => pending.size > 0,
		dispose: () => {
			disposed = true;
			clearTimer();
			pending.clear();
		}
	};
}
