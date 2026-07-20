/**
 * Editor assembly (V1-5-1): TipTap wired so the graph is the source of truth.
 *
 * - StarterKit provides prose schema + markdown input rules (`#` headings,
 *   `**bold**`, `-`/`1.` lists). Its history is DISABLED — engine history is
 *   THE undo/redo (SCHEMA.md §9); Mod-z / Mod-Shift-z are routed to the
 *   page's `commitUndo`/`commitRedo` handlers, which re-render this editor
 *   from graph state afterwards.
 * - Every top-level node carries a hidden `blockId` attribute
 *   (`keepOnSplit: false` — Enter splits produce unidentified nodes that
 *   reconcile as fresh `blockOp add`s).
 * - On every content update the doc is reconciled against the graph
 *   (sync.ts); newly assigned ids are stamped back into the PM doc in a
 *   transaction tagged `octo-sync` so it is not re-reconciled.
 * - Alt-ArrowUp / Alt-ArrowDown move the block under the cursor via
 *   `blockOp move` — position is layout-only, so moving never recalculates.
 */

import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import type { Block, DocumentGraph, FunctionRegistry, NodeId } from '../engine';
import { ulid } from '../engine';
import type { PMJson } from './blocks';
import { pmDocFromBlocks } from './blocks';
import type { BlockSync, SyncHost } from './sync';
import { createBlockSync } from './sync';
import type { ImageBlockOptions } from './image-node';
import { ImageBlock } from './image-node';
import type { SheetBlockOptions } from './sheet-node';
import { SheetBlock } from './sheet-node';
import {
	CHIP_NODE_NAME,
	chipDerivation,
	planChipSync,
	type ChipOccurrence,
	type ChipPickItem
} from './chips';
import { ChipNode } from './chip-node';
import { ChipPicker } from './chip-picker';
import { InsertSlots, type InsertableBlockType } from './insert-slots';

/** Transaction meta flag marking editor writes made by the sync itself. */
const SYNC_META = 'octo-sync';

/** Node types that may appear at the top level and carry a blockId. */
const BLOCK_ID_TYPES = [
	'paragraph',
	'heading',
	'bulletList',
	'orderedList',
	'blockquote',
	'codeBlock',
	'imageBlock',
	'sheetBlock'
];

export interface DocEditorOptions {
	element: HTMLElement;
	graph: DocumentGraph;
	/** The Convex document id (block `docId`). */
	docId: string;
	/**
	 * The session's function registry — chip expansion (V1-5-4) reduces call
	 * expressions through it so derivation intermediates match recalc exactly.
	 */
	registry: FunctionRegistry;
	/** Resolve an image storageId to a serving URL (persistence `fileUrl`). */
	resolveImageUrl: ImageBlockOptions['resolveUrl'];
	/** Mount a live sheet grid for a sheet block (page wraps the Univer adapter). */
	attachSheet: SheetBlockOptions['attach'];
	/** Commit one mutation through the engine write path; returns ok. */
	commitMutation: SyncHost['commit'];
	/** Called after reconciliation committed anything — schedule a save. */
	onChanged: () => void;
	/** Undo/redo requests from the keyboard (page runs commitUndo/commitRedo). */
	onUndo: () => void;
	onRedo: () => void;
	/**
	 * Subscribe to the graph session's settle fan-out (V1-5-3): chips re-render
	 * and flash from here. Returns an unsubscriber.
	 */
	onSettle: (cb: () => void) => () => void;
	/**
	 * Open the provenance inspector on a node (V1-5-5) — Alt+click / Alt+Enter
	 * on a chip routes here. Omit to disable the affordance entirely.
	 */
	onInspect?: (nodeId: NodeId) => void;
	/**
	 * Notebook-style insertion slots: called with the block type and top-level
	 * position when a slot button is clicked. Omit to hide the slots entirely.
	 */
	onInsertBlockAt?: (type: InsertableBlockType, index: number) => void;
	/** Debounce override for tests. */
	syncDelayMs?: number;
}

export interface DocEditor {
	editor: Editor;
	/** Replace the editor doc with the graph's current blocks (undo/redo/load). */
	renderFromGraph(): void;
	/** Commit pending debounced prose updates now (before undo/redo/save). */
	flushProse(): void;
	/** Move the block containing the selection one slot up/down via blockOp. */
	moveSelectedBlock(dir: -1 | 1): boolean;
	/** Put the caret (or node selection) into the block and scroll it into view. */
	focusBlock(blockId: string): boolean;
	/** The block id under the selection, if the node has been assigned one. */
	selectedBlockId(): string | null;
	destroy(): void;
}

/** Blocks of the graph in canonical order (sheet blocks filtered by the mapper). */
function orderedBlocks(graph: DocumentGraph): Block[] {
	return graph.blocksOrder
		.map((id) => graph.blocks.get(id))
		.filter((block): block is Block => block !== undefined);
}

/** Build the document editor. Call from onMount — TipTap needs the DOM. */
export function createDocEditor(opts: DocEditorOptions): DocEditor {
	let sync: BlockSync;

	const BlockIdAttribute = Extension.create({
		name: 'octoBlockId',
		addGlobalAttributes() {
			return [
				{
					types: BLOCK_ID_TYPES,
					attributes: {
						blockId: { default: null, keepOnSplit: false, rendered: false }
					}
				}
			];
		}
	});

	const OctoKeymap = Extension.create({
		name: 'octoKeymap',
		addKeyboardShortcuts() {
			return {
				'Mod-z': () => {
					opts.onUndo();
					return true;
				},
				'Mod-Shift-z': () => {
					opts.onRedo();
					return true;
				},
				'Mod-y': () => {
					opts.onRedo();
					return true;
				},
				'Alt-ArrowUp': () => api.moveSelectedBlock(-1),
				'Alt-ArrowDown': () => api.moveSelectedBlock(1)
			};
		}
	});

	const editor = new Editor({
		element: opts.element,
		extensions: [
			// Engine history is THE undo/redo; links are out of V1-5-1 scope.
			StarterKit.configure({ undoRedo: false, link: false }),
			BlockIdAttribute,
			ImageBlock.configure({ resolveUrl: opts.resolveImageUrl }),
			SheetBlock.configure({
				attach: opts.attachSheet,
				onUndo: opts.onUndo,
				onRedo: opts.onRedo
			}),
			ChipNode.configure({
				resolve: (chipId) => {
					const binding = opts.graph.chips.get(chipId);
					const node = binding ? opts.graph.nodes.get(binding.nodeId) : undefined;
					return { binding, node };
				},
				subscribe: opts.onSettle,
				navigate: (origin) => navigateToNode(origin),
				// Show-steps expansion (V1-5-4): derive at render time from live
				// graph state; the alias hop for published names lives in chips.ts.
				derive: (nodeId) => chipDerivation(nodeId, opts.graph, opts.registry),
				// Provenance inspector (V1-5-5): Alt+click / Alt+Enter on a chip.
				...(opts.onInspect !== undefined ? { inspect: opts.onInspect } : {})
			}),
			ChipPicker.configure({
				items: chipItems,
				pick: (item, range) => pickChip(item, range)
			}),
			...(opts.onInsertBlockAt !== undefined
				? [InsertSlots.configure({ insert: opts.onInsertBlockAt })]
				: []),
			OctoKeymap
		],
		content: pmDocFromBlocks(orderedBlocks(opts.graph)) as object,
		onUpdate: ({ editor: e, transaction }) => {
			if (transaction.getMeta(SYNC_META)) return;
			const assigned = sync.reconcile(e.getJSON() as PMJson);
			if (assigned.size > 0) stampBlockIds(e, assigned);
			syncChips();
			opts.onChanged();
		}
	});

	sync = createBlockSync(
		{
			docId: opts.docId,
			order: () => opts.graph.blocksOrder,
			block: (id) => opts.graph.blocks.get(id),
			commit: opts.commitMutation
		},
		{ delayMs: opts.syncDelayMs }
	);

	/** Write freshly assigned block ids into the PM doc without re-reconciling. */
	function stampBlockIds(e: Editor, assigned: Map<number, string>): void {
		const tr = e.state.tr;
		const doc = e.state.doc;
		for (let index = 0, pos = 0; index < doc.childCount; index++) {
			const child = doc.child(index);
			const id = assigned.get(index);
			if (id !== undefined) {
				tr.setNodeMarkup(pos, undefined, { ...child.attrs, blockId: id });
			}
			pos += child.nodeSize;
		}
		tr.setMeta(SYNC_META, true);
		tr.setMeta('addToHistory', false);
		e.view.dispatch(tr);
	}

	/** Top-level child index containing the selection. */
	function selectedIndex(): number {
		return editor.state.selection.$from.index(0);
	}

	// -----------------------------------------------------------------------
	// Value chips (V1-5-3)
	// -----------------------------------------------------------------------

	/** Published names, for the `@` picker. */
	function chipItems(): ChipPickItem[] {
		const items: ChipPickItem[] = [];
		for (const node of opts.graph.nodes.values()) {
			if (node.name !== undefined) items.push({ name: node.name, nodeId: node.id });
		}
		return items;
	}

	/** Every chip node in the current doc, with its hosting top-level block. */
	function chipOccurrences(): ChipOccurrence<number>[] {
		const occ: ChipOccurrence<number>[] = [];
		const doc = editor.state.doc;
		doc.descendants((node, pos) => {
			if (node.type.name !== CHIP_NODE_NAME) return true;
			const top = doc.resolve(pos).node(1);
			const raw = top?.attrs?.blockId;
			occ.push({
				chipId: String(node.attrs.chipId ?? ''),
				pos,
				hostBlockId: typeof raw === 'string' && raw !== '' ? raw : null
			});
			return false;
		});
		return occ;
	}

	/**
	 * Reconcile chip bindings with the doc after every user update:
	 *
	 * - Vanished chips (deleted from prose): the hosting block's `blockOp
	 *   update` is flushed FIRST, then `chipOp remove` — undo replays
	 *   newest-first, restoring the binding before the chip node reappears
	 *   (no intermediate `#REF!`; one user action = two undo entries, the
	 *   binding one invisible on its own).
	 * - Host drift (chip moved between blocks via cut/paste): remove+create
	 *   under the SAME chipId with the new hosting block.
	 * - Duplicates (copy/paste in-doc): each duplicate gets a FRESH chipId
	 *   bound to the same node (format cloned) — binding committed before the
	 *   reminted attr lands, so the pasted chip renders live immediately.
	 *   Duplicates with no source binding (cross-doc paste) are left as-is
	 *   and render `#REF!`.
	 */
	function syncChips(): void {
		const plan = planChipSync(chipOccurrences(), opts.graph.chips, (id) =>
			opts.graph.blocks.has(id)
		);
		if (plan.removals.length > 0) {
			sync.flush();
			for (const chipId of plan.removals) {
				opts.commitMutation({ op: 'chipOp', action: 'remove', chipId });
			}
		}
		for (const drift of plan.drifts) {
			const binding = opts.graph.chips.get(drift.chipId);
			if (!binding) continue;
			const removed = opts.commitMutation({ op: 'chipOp', action: 'remove', chipId: drift.chipId });
			if (!removed) continue;
			opts.commitMutation({
				op: 'chipOp',
				action: 'create',
				chipId: drift.chipId,
				chip: {
					blockId: drift.hostBlockId,
					nodeId: binding.nodeId,
					...(binding.format !== undefined ? { format: binding.format } : {})
				}
			});
		}
		if (plan.remints.length > 0) {
			const tr = editor.state.tr;
			for (const remint of plan.remints) {
				const source = opts.graph.chips.get(remint.sourceChipId);
				if (!source || remint.hostBlockId === null || !opts.graph.blocks.has(remint.hostBlockId)) {
					continue; // no source binding — leave it; it renders #REF!
				}
				const chipId = ulid();
				const ok = opts.commitMutation({
					op: 'chipOp',
					action: 'create',
					chipId,
					chip: {
						blockId: remint.hostBlockId,
						nodeId: source.nodeId,
						...(source.format !== undefined ? { format: source.format } : {})
					}
				});
				if (ok) tr.setNodeMarkup(remint.pos, undefined, { chipId });
			}
			if (tr.docChanged) {
				tr.setMeta(SYNC_META, true);
				tr.setMeta('addToHistory', false);
				editor.view.dispatch(tr);
				// The remint never re-reconciles on its own (SYNC_META): schedule the
				// rewritten pm explicitly so the fresh chipIds persist.
				sync.reconcile(editor.getJSON() as PMJson);
			}
		}
	}

	/** blockId of the top-level node containing `pos`, if assigned. */
	function hostBlockIdAt(pos: number): string | null {
		const top = editor.state.doc.resolve(pos).node(1);
		const raw = top?.attrs?.blockId;
		return typeof raw === 'string' && raw !== '' ? raw : null;
	}

	/**
	 * Picker selection: bind first (`chipOp create` — the only write path),
	 * then replace the `@query` trigger with the chip node, so the chip
	 * renders live from its first paint. Log order: [create][blockOp update].
	 */
	function pickChip(item: ChipPickItem, range: { from: number; to: number }): boolean {
		let host = hostBlockIdAt(range.from);
		if (host === null || !opts.graph.blocks.has(host)) {
			// Fresh paragraph not yet reconciled: force ids to exist, then re-read.
			const assigned = sync.reconcile(editor.getJSON() as PMJson);
			if (assigned.size > 0) stampBlockIds(editor, assigned);
			sync.flush();
			host = hostBlockIdAt(range.from);
		}
		if (host === null || !opts.graph.blocks.has(host)) return false;
		if (!opts.graph.nodes.has(item.nodeId)) return false;
		const chipId = ulid();
		const ok = opts.commitMutation({
			op: 'chipOp',
			action: 'create',
			chipId,
			chip: { blockId: host, nodeId: item.nodeId }
		});
		if (!ok) return false;
		editor
			.chain()
			.focus()
			.insertContentAt(range, [
				{ type: CHIP_NODE_NAME, attrs: { chipId } },
				{ type: 'text', text: ' ' }
			])
			.run();
		opts.onChanged();
		return true;
	}

	/**
	 * Deep-link to an error origin (SCHEMA.md §11): scroll the origin node's
	 * hosting block into view and highlight it briefly. Returns false when the
	 * origin cannot be located (deleted node, no hosting block, or block not
	 * in this doc) — the chip then pulses in place (documented fallback).
	 */
	function navigateToNode(origin: NodeId): boolean {
		const node = opts.graph.nodes.get(origin);
		const hostId = node?.blockId;
		if (hostId === undefined) return false;
		const doc = editor.state.doc;
		let pos = 0;
		for (let index = 0; index < doc.childCount; index++) {
			const child = doc.child(index);
			if (child.attrs.blockId === hostId) {
				const dom = editor.view.nodeDOM(pos);
				if (!(dom instanceof HTMLElement)) return false;
				const reduced =
					typeof window.matchMedia === 'function' &&
					window.matchMedia('(prefers-reduced-motion: reduce)').matches;
				dom.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
				dom.classList.add('octo-deeplink');
				setTimeout(() => dom.classList.remove('octo-deeplink'), 1400);
				return true;
			}
			pos += child.nodeSize;
		}
		return false;
	}

	const api: DocEditor = {
		editor,

		renderFromGraph(): void {
			editor.commands.setContent(pmDocFromBlocks(orderedBlocks(opts.graph)) as object, {
				emitUpdate: false
			});
		},

		flushProse(): void {
			sync.flush();
		},

		selectedBlockId(): string | null {
			const doc = editor.state.doc;
			const index = selectedIndex();
			if (index >= doc.childCount) return null;
			const id = doc.child(index).attrs.blockId;
			return typeof id === 'string' && id !== '' ? id : null;
		},

		moveSelectedBlock(dir: -1 | 1): boolean {
			// Make sure the block exists in the graph (an untouched fresh node may
			// not have reconciled yet), and flush prose so undo order stays linear.
			sync.reconcile(editor.getJSON() as PMJson);
			sync.flush();
			const id = api.selectedBlockId();
			if (id === null) return false;
			const from = opts.graph.blocksOrder.indexOf(id);
			const to = from + dir;
			if (from < 0 || to < 0 || to >= opts.graph.blocksOrder.length) return false;
			const ok = opts.commitMutation({ op: 'blockOp', action: 'move', blockId: id, position: to });
			if (!ok) return false;
			api.renderFromGraph();
			// Put the caret back into the moved block so repeated moves chain.
			api.focusBlock(id);
			opts.onChanged();
			return true;
		},

		focusBlock(blockId: string): boolean {
			const doc = editor.state.doc;
			let pos = 0;
			for (let index = 0; index < doc.childCount; index++) {
				const child = doc.child(index);
				if (child.attrs.blockId === blockId) {
					if (child.isAtom) editor.commands.setNodeSelection(pos);
					else editor.commands.setTextSelection(pos + 1);
					editor.commands.focus(undefined, { scrollIntoView: true });
					return true;
				}
				pos += child.nodeSize;
			}
			return false;
		},

		destroy(): void {
			sync.dispose();
			editor.destroy();
		}
	};

	return api;
}
