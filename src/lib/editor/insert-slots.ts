/**
 * Notebook-style insertion slots: a slim affordance in every gap between
 * top-level blocks — and always visible at the document end — offering
 * Text / Sheet / Image, like Jupyter's between-cell strips. Rendered as
 * ProseMirror widget decorations so the slots ride document layout for free.
 *
 * A slot's index is its top-level gap index, which is also the graph position
 * for a `blockOp add` (sync.ts invariant: top-level PM index = blocksOrder
 * position; the ephemeral trailing paragraph sits at the end and is skipped).
 * The host page owns the actual insert (commit + render + upload flow).
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

/** Block types a slot can insert. */
export type InsertableBlockType = 'text' | 'image' | 'equation';

export interface InsertSlotsOptions {
	/** Insert a new block of `type` at top-level position `index`. */
	insert: (type: InsertableBlockType, index: number) => void;
}

const SLOT_TYPES: InsertableBlockType[] = ['text', 'image', 'equation'];

/** Build one slot's DOM: hairline rule + the three insert buttons. */
function slotWidget(
	index: number,
	isEnd: boolean,
	insert: InsertSlotsOptions['insert']
): HTMLElement {
	const slot = document.createElement('div');
	slot.className = `octo-insert-slot${isEnd ? ' is-end' : ''}`;
	slot.contentEditable = 'false';
	slot.dataset.testid = 'insert-slot';
	slot.dataset.slotIndex = String(index);
	const rule = document.createElement('span');
	rule.className = 'octo-insert-rule';
	rule.setAttribute('aria-hidden', 'true');
	slot.appendChild(rule);
	const actions = document.createElement('span');
	actions.className = 'octo-insert-actions';
	for (const type of SLOT_TYPES) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'octo-insert-btn';
		btn.textContent = `+ ${type}`;
		btn.dataset.testid = `slot-insert-${type}`;
		btn.setAttribute('aria-label', `Insert ${type} block here`);
		// Keep the editor selection where it is; the insert re-renders anyway.
		btn.addEventListener('mousedown', (e) => e.preventDefault());
		btn.addEventListener('click', (e) => {
			e.preventDefault();
			insert(type, index);
		});
		actions.appendChild(btn);
	}
	slot.appendChild(actions);
	return slot;
}

/** The trailing-paragraph rule (sync.ts): empty, unassigned, at the end. */
function isEphemeralTrailing(node: PMNode): boolean {
	return node.type.name === 'paragraph' && node.childCount === 0 && !node.attrs.blockId;
}

export const InsertSlots = Extension.create<InsertSlotsOptions>({
	name: 'octoInsertSlots',

	addOptions() {
		return { insert: () => {} };
	},

	addProseMirrorPlugins() {
		const insert = this.options.insert;
		return [
			new Plugin({
				key: new PluginKey('octoInsertSlots'),
				props: {
					decorations(state) {
						const doc = state.doc;
						const gaps: number[] = [0];
						let pos = 0;
						for (let i = 0; i < doc.childCount; i++) {
							pos += doc.child(i).nodeSize;
							gaps.push(pos);
						}
						// The gap after the ephemeral trailing paragraph duplicates the
						// one before it — drop it so exactly one end slot renders.
						const skipFinal =
							doc.childCount > 0 && isEphemeralTrailing(doc.child(doc.childCount - 1));
						const usable = skipFinal ? gaps.slice(0, -1) : gaps;
						const decos = usable.map((gapPos, index) => {
							const isEnd = index === usable.length - 1;
							return Decoration.widget(gapPos, () => slotWidget(index, isEnd, insert), {
								side: -1,
								key: `octo-slot-${index}${isEnd ? '-end' : ''}`
							});
						});
						return DecorationSet.create(doc, decos);
					}
				}
			})
		];
	}
});
