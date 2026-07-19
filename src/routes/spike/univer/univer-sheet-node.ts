import { Node } from '@tiptap/core';
import { mount, unmount } from 'svelte';
import type { FUniver, IWorkbookData } from '@univerjs/presets';
import UniverSheetView from './UniverSheetView.svelte';
import { sheetStore } from './sheet-store';

/** Spike page registry: sid → live Univer facade, for buttons and test hooks. */
export const liveSheets = new Map<string, FUniver>();

/**
 * TipTap block node hosting a Univer sheet through a Svelte 5 NodeView.
 *
 * - `atom`: the node has no editable ProseMirror content; Univer owns everything inside.
 * - `stopEvent` returns true for all events originating inside the view, so
 *   TipTap/ProseMirror never steal keyboard or pointer input from the grid.
 * - `ignoreMutation` returns true because Univer mutates its own DOM constantly.
 * - `snapshot` attr holds the serialized workbook (`IWorkbookData`); the live
 *   truth while mounted is `sheetStore` (see sheet-store.ts).
 */
export const UniverSheet = Node.create({
	name: 'univerSheet',
	group: 'block',
	atom: true,

	addAttributes() {
		return {
			sid: { default: null },
			snapshot: { default: null }
		};
	},

	parseHTML() {
		return [{ tag: 'div[data-univer-sheet]' }];
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', { 'data-univer-sheet': HTMLAttributes.sid ?? '' }];
	},

	addNodeView() {
		return ({ node }) => {
			const sid: string = node.attrs.sid;
			const dom = document.createElement('div');
			dom.dataset.univerSheet = sid;
			dom.contentEditable = 'false';

			const component = mount(UniverSheetView, {
				target: dom,
				props: {
					sid,
					initialSnapshot: (sheetStore.get(sid) ?? node.attrs.snapshot) as IWorkbookData | null,
					onReady: (api: FUniver) => liveSheets.set(sid, api)
				}
			});

			return {
				dom,
				// Attr changes (e.g. snapshot flush before serialization) must not
				// remount the live grid; only a node-type change invalidates the view.
				update: (updated) => updated.type.name === 'univerSheet' && updated.attrs.sid === sid,
				stopEvent: () => true,
				ignoreMutation: () => true,
				destroy: () => {
					liveSheets.delete(sid);
					unmount(component);
				}
			};
		};
	}
});
