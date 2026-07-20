/**
 * `imageBlock` — the TipTap node projecting an image block (SCHEMA.md §8:
 * `image: { storageId, alt?, caption? }`). An atom: no editable inner
 * content. The NodeView is plain DOM (figure > img [+ figcaption]); the
 * Convex storageId is resolved to a serving URL through an injected resolver,
 * so this module never touches the persistence layer directly.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { IMAGE_NODE_NAME } from './blocks';

export interface ImageBlockOptions {
	/** Resolve a storageId to a serving URL (null when the file is gone). */
	resolveUrl: (storageId: string) => Promise<string | null>;
}

/** The image block node. `blockId` arrives via the shared global attribute. */
export const ImageBlock = Node.create<ImageBlockOptions>({
	name: IMAGE_NODE_NAME,
	group: 'block',
	atom: true,
	// Reorder goes through blockOp move (keyboard/toolbar), not PM drag-drop.
	draggable: false,

	addOptions() {
		return {
			resolveUrl: async () => null
		};
	},

	addAttributes() {
		return {
			storageId: { default: '' },
			alt: { default: null },
			caption: { default: null }
		};
	},

	parseHTML() {
		return [{ tag: 'figure[data-image-block]' }];
	},

	renderHTML({ HTMLAttributes }) {
		return ['figure', mergeAttributes(HTMLAttributes, { 'data-image-block': '' })];
	},

	addNodeView() {
		const { resolveUrl } = this.options;
		return ({ node }) => {
			const dom = document.createElement('figure');
			dom.dataset.imageBlock = node.attrs.storageId ?? '';
			dom.contentEditable = 'false';

			const img = document.createElement('img');
			img.alt = node.attrs.alt ?? '';
			dom.appendChild(img);

			const caption = document.createElement('figcaption');
			dom.appendChild(caption);

			const apply = (attrs: Record<string, unknown>): void => {
				img.alt = typeof attrs.alt === 'string' ? attrs.alt : '';
				const text = typeof attrs.caption === 'string' ? attrs.caption : '';
				caption.textContent = text;
				caption.style.display = text === '' ? 'none' : '';
			};
			apply(node.attrs);

			let disposed = false;
			const storageId = String(node.attrs.storageId ?? '');
			if (storageId !== '') {
				void resolveUrl(storageId).then((url) => {
					if (!disposed && url) img.src = url;
				});
			}

			return {
				dom,
				// Attr-only changes (alt/caption edits) must not remount the view
				// (docs/v1-0-findings.md landmine 4): re-apply and keep the DOM.
				update: (updated) => {
					if (updated.type.name !== IMAGE_NODE_NAME) return false;
					if (String(updated.attrs.storageId ?? '') !== storageId) return false;
					apply(updated.attrs);
					return true;
				},
				destroy: () => {
					disposed = true;
				}
			};
		};
	}
});
