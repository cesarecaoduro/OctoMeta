/**
 * `sheetBlock` — the TipTap node projecting a sheet block (V1-5-2). An atom
 * whose NodeView hosts a live Univer grid through an INJECTED `attach`
 * function, so this module stays free of `@univerjs` (IMPLEMENTATION_PLAN.md
 * §11 rule 2) and the editor layer never knows how a grid is mounted.
 *
 * Spike-proven NodeView contract (docs/v1-0-findings.md, V1-0-2):
 * - `stopEvent: () => true` + `contenteditable="false"`: grid keystrokes never
 *   reach ProseMirror; prose focus returns cleanly.
 * - `ignoreMutation: () => true`: Univer mutates its DOM constantly.
 * - `update()` returns true for attr-only changes with the same blockId
 *   (landmine 4) — otherwise every `renderFromGraph` would remount every grid.
 * - A block move destroys and recreates the view; the attach implementation
 *   rehydrates from the snapshot store (landmine 2/spike proof c).
 *
 * Undo inside the grid (V1-5-2 decision): Univer's internal undo stack is
 * SUPPRESSED. Univer's ShortcutService binds `keydown` on WINDOW with
 * `capture: true` (0.25.1, @univerjs/ui `fromGlobalEvent`), so a container
 * listener can never beat it. This extension therefore registers its own
 * window-capture keydown interceptor at editor creation — before any Univer
 * instance boots, so it fires first — and for undo/redo chords whose target
 * sits inside a sheet block it stops immediate propagation and routes to the
 * page's engine `commitUndo`/`commitRedo`: one linear history for cell edits
 * and block ops (SCHEMA.md §9), no split-brain. (Without this, Univer's undo
 * restores a stale display which the adapter re-commits as a fresh edit.)
 * Escape leaves the grid back to a node selection in prose; Enter on a
 * selected sheet node enters the grid.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { SHEET_NODE_NAME } from './blocks';

/** What the NodeView gets back from `attach`: enough to tear the grid down. */
export interface SheetHandle {
	/** Flush the snapshot and dispose the grid instance. */
	dispose(): void;
}

export interface SheetBlockOptions {
	/**
	 * Mount a live grid for `blockId` into `container`. The page supplies this
	 * (wrapping the Univer adapter); the NodeView only manages DOM + lifecycle.
	 */
	attach: (blockId: string, container: HTMLElement) => Promise<SheetHandle>;
	/** Route in-grid undo/redo chords to the page's engine history. */
	onUndo: () => void;
	onRedo: () => void;
}

/** True when the keydown is an undo/redo chord (Mod-z / Mod-Shift-z / Ctrl-y). */
export function isUndoRedoChord(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>): {
	undo: boolean;
	redo: boolean;
} {
	const mod = e.metaKey || e.ctrlKey;
	const key = e.key.toLowerCase();
	if (!mod) return { undo: false, redo: false };
	if (key === 'z') {
		// Shift arrives via the event's shiftKey; callers pass the full event.
		const shift = (e as KeyboardEvent).shiftKey === true;
		return { undo: !shift, redo: shift };
	}
	if (key === 'y' && e.ctrlKey) return { undo: false, redo: true };
	return { undo: false, redo: false };
}

/**
 * Focus the grid inside a sheet NodeView dom by replaying a pointer tap on its
 * main canvas (landmine 5: the doc/editor canvases intercept naïve selectors).
 * Univer's keyboard handling is pointer-driven, so a synthetic tap is the
 * reliable way in. Targets a spot just below the ~20 px headers.
 */
export function enterGrid(dom: HTMLElement): boolean {
	const canvas = dom.querySelector<HTMLCanvasElement>('canvas[id^="univer-sheet-main-canvas"]');
	if (!canvas) return false;
	const rect = canvas.getBoundingClientRect();
	const x = rect.left + 60;
	const y = rect.top + 40;
	const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
	canvas.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, isPrimary: true }));
	canvas.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, isPrimary: true }));
	canvas.dispatchEvent(new MouseEvent('click', opts));
	return true;
}

/** The sheet block node. `blockId` arrives via the shared global attribute. */
export const SheetBlock = Node.create<SheetBlockOptions>({
	name: SHEET_NODE_NAME,
	group: 'block',
	atom: true,
	// Reorder goes through blockOp move (keyboard/toolbar), not PM drag-drop.
	draggable: false,

	addOptions() {
		return {
			attach: async () => ({ dispose: () => {} }),
			onUndo: () => {},
			onRedo: () => {}
		};
	},

	parseHTML() {
		return [{ tag: 'div[data-sheet-block]' }];
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', mergeAttributes(HTMLAttributes, { 'data-sheet-block': '' })];
	},

	addStorage() {
		return {
			offWindowKeys: null as null | (() => void)
		};
	},

	onCreate() {
		// One window-capture interceptor per editor, registered BEFORE any Univer
		// instance exists so it always runs first (window-capture listeners fire
		// in registration order; Univer's registers when a grid boots).
		const { onUndo, onRedo } = this.options;
		const handler = (e: KeyboardEvent): void => {
			const target = e.target;
			if (!(target instanceof Element) || !target.closest('[data-sheet-block]')) return;
			const chord = isUndoRedoChord(e);
			if (!chord.undo && !chord.redo) return;
			e.preventDefault();
			e.stopImmediatePropagation(); // Univer's window-capture listener never sees it
			if (chord.undo) onUndo();
			else onRedo();
		};
		window.addEventListener('keydown', handler, { capture: true });
		this.storage.offWindowKeys = () =>
			window.removeEventListener('keydown', handler, { capture: true });
	},

	onDestroy() {
		this.storage.offWindowKeys?.();
		this.storage.offWindowKeys = null;
	},

	addKeyboardShortcuts() {
		return {
			// Enter on a selected sheet node drops the keyboard into the grid.
			Enter: () => {
				const { selection } = this.editor.state;
				if (!(selection instanceof NodeSelection) || selection.node.type.name !== this.name) {
					return false;
				}
				const dom = this.editor.view.nodeDOM(selection.from);
				return dom instanceof HTMLElement ? enterGrid(dom) : false;
			}
		};
	},

	addNodeView() {
		const { attach } = this.options;
		return ({ node, editor, getPos }) => {
			const blockId = String(node.attrs.blockId ?? '');

			const dom = document.createElement('div');
			dom.dataset.sheetBlock = blockId;
			dom.contentEditable = 'false';

			// The label strip is the pointer path to node selection: grid events
			// never reach ProseMirror (stopEvent below), label clicks do.
			const label = document.createElement('div');
			label.className = 'octo-sheet-label';
			label.textContent = 'sheet';
			dom.appendChild(label);

			const container = document.createElement('div');
			container.className = 'octo-sheet-grid';
			dom.appendChild(container);

			let disposed = false;
			let handle: SheetHandle | null = null;
			// Deferred one microtask: on a block move ProseMirror may build the new
			// view before destroying the old one in the same update — the old
			// view's destroy() must flush its snapshot before we rehydrate.
			queueMicrotask(() => {
				if (disposed || blockId === '') return;
				void attach(blockId, container).then((h) => {
					if (disposed) h.dispose();
					else handle = h;
				});
			});

			/** Leave the grid: node-select this sheet block and refocus prose. */
			const leaveGrid = (): void => {
				const pos = getPos();
				if (typeof pos !== 'number') return;
				editor
					.chain()
					.setNodeSelection(pos)
					.focus(undefined, { scrollIntoView: true })
					.run();
			};

			// Escape hands focus back to prose (undo/redo chords are intercepted
			// earlier, by the extension's window-capture listener — see onCreate).
			const onKeydown = (e: KeyboardEvent): void => {
				if (e.key === 'Escape') {
					e.preventDefault();
					e.stopPropagation();
					leaveGrid();
				}
			};
			dom.addEventListener('keydown', onKeydown, { capture: true });

			return {
				dom,
				// Grid keystrokes/pointer events never reach ProseMirror (spike b);
				// events on the frame/label DO, so clicking them node-selects.
				stopEvent: (event: Event) =>
					event.target instanceof HTMLElement ? container.contains(event.target) : true,
				// Univer mutates its DOM constantly (spike b).
				ignoreMutation: () => true,
				// Attr-only changes (same blockId) keep the live grid (landmine 4).
				update: (updated) => {
					if (updated.type.name !== SHEET_NODE_NAME) return false;
					return String(updated.attrs.blockId ?? '') === blockId;
				},
				destroy: () => {
					disposed = true;
					dom.removeEventListener('keydown', onKeydown, { capture: true });
					handle?.dispose(); // flushes the snapshot into the store (spike c)
					handle = null;
				}
			};
		};
	}
});
