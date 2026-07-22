/**
 * Uniform report-block chrome rendered as ProseMirror decorations. Every R1
 * block gets a visible type label plus keyboard/touch-safe move and remove
 * controls; callbacks retain the engine as the single structural owner.
 */

import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface BlockChromeOptions {
	/** Move a stable block one position. */
	move: (blockId: string, direction: -1 | 1) => void;
	/** Remove a stable block and restore focus deterministically. */
	remove: (blockId: string) => void;
}

/** Human-readable label for one managed top-level ProseMirror node. */
export function blockTypeLabel(node: PMNode): string {
	if (node.type.name === 'heading') return `Heading ${node.attrs.level ?? 1}`;
	if (node.type.name === 'imageBlock') return 'Image';
	if (node.type.name === 'equationBlock') return 'Equation';
	return 'Text';
}

function control(
	label: string,
	text: string,
	action: () => void,
	disabled = false
): HTMLButtonElement {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'octo-block-control';
	button.setAttribute('aria-label', label);
	button.title = label;
	button.textContent = text;
	button.disabled = disabled;
	button.addEventListener('mousedown', (event) => event.preventDefault());
	button.addEventListener('click', (event) => {
		event.preventDefault();
		action();
	});
	return button;
}

function chromeWidget(
	node: PMNode,
	index: number,
	count: number,
	options: BlockChromeOptions
): HTMLElement {
	const blockId = String(node.attrs.blockId ?? '');
	const chrome = document.createElement('div');
	chrome.className = 'octo-block-chrome';
	chrome.contentEditable = 'false';
	chrome.dataset.blockChrome = blockId;

	const label = document.createElement('span');
	label.className = 'octo-block-type';
	label.textContent = blockTypeLabel(node);
	chrome.append(
		label,
		control('Move block up', '↑', () => options.move(blockId, -1), index === 0),
		control('Move block down', '↓', () => options.move(blockId, 1), index === count - 1),
		control('Remove block', 'Remove', () => options.remove(blockId))
	);
	return chrome;
}

export const BlockChrome = Extension.create<BlockChromeOptions>({
	name: 'octoBlockChrome',

	addOptions() {
		return { move: () => {}, remove: () => {} };
	},

	addProseMirrorPlugins() {
		const options = this.options;
		return [
			new Plugin({
				key: new PluginKey('octoBlockChrome'),
				props: {
					decorations(state) {
						const decorations: Decoration[] = [];
						let position = 0;
						const managed: Array<{ node: PMNode; position: number }> = [];
						for (let index = 0; index < state.doc.childCount; index++) {
							const node = state.doc.child(index);
							if (typeof node.attrs.blockId === 'string' && node.attrs.blockId !== '') {
								managed.push({ node, position });
								decorations.push(
									Decoration.node(position, position + node.nodeSize, {
										class: 'octo-report-block',
										'data-block-type': blockTypeLabel(node)
									})
								);
							}
							position += node.nodeSize;
						}
						managed.forEach(({ node, position: at }, index) => {
							decorations.push(
								Decoration.widget(
									at,
									() => chromeWidget(node, index, managed.length, options),
									{ side: -2, key: `octo-chrome-${String(node.attrs.blockId)}` }
								)
							);
						});
						return DecorationSet.create(state.doc, decorations);
					}
				}
			})
		];
	}
});
