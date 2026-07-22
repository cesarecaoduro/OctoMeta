/**
 * TipTap atom for report equations. The graph owns the exact discriminated
 * payload; this NodeView owns controls and renders TeX into an isolated DOM
 * element with KaTeX's trust and expansion limits.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import type { DocumentGraph, EquationPayload, GraphNode, NodeId } from '../engine';
import { equationToTex, resolvePublishedTarget } from '../engine';
import { EQUATION_NODE_NAME } from './blocks';
import 'katex/dist/katex.min.css';

/** Maximum authored or generated TeX accepted by the equation renderer. */
export const MAX_TEX_LENGTH = 10_000;

export interface EquationBlockOptions {
	/** Live graph used to resolve published bindings and formula modes. */
	graph: DocumentGraph;
	/** Subscribe to graph settlement so bound previews remain live. */
	subscribe: (callback: () => void) => () => void;
	/** Commit one exact equation payload through the engine mutation path. */
	commit: (blockId: string, equation: EquationPayload) => boolean;
}

type KatexModule = typeof import('katex');

let katexPromise: Promise<KatexModule> | null = null;

/** Lazy-load KaTeX once for the document route. */
function loadKatex(): Promise<KatexModule> {
	katexPromise ??= import('katex');
	return katexPromise;
}

function hasMalformedUnicode(text: string): boolean {
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = text.charCodeAt(index + 1);
			if (next < 0xdc00 || next > 0xdfff) return true;
			index++;
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			return true;
		}
	}
	return false;
}

function payloadFrom(value: unknown): EquationPayload {
	if (value && typeof value === 'object' && 'mode' in value) {
		if (
			value.mode === 'static' &&
			'tex' in value &&
			typeof value.tex === 'string'
		) {
			return { mode: 'static', tex: value.tex };
		}
		if (
			value.mode === 'bound' &&
			'nodeId' in value &&
			typeof value.nodeId === 'string' &&
			'display' in value &&
			['symbolic', 'substituted', 'result', 'steps'].includes(String(value.display))
		) {
			return {
				mode: 'bound',
				nodeId: value.nodeId,
				display: value.display as Extract<EquationPayload, { mode: 'bound' }>['display']
			};
		}
	}
	return { mode: 'static', tex: '' };
}

/** Published aliases available to bound equation controls. */
function publishedNodes(graph: DocumentGraph): GraphNode[] {
	return [...graph.nodes.values()]
		.filter((node) => node.kind === 'namedOutput' && node.name)
		.sort((left, right) => (left.name ?? '').localeCompare(right.name ?? ''));
}

/** Whether a display mode is supported by the resolved bound source. */
function supportsDisplay(
	graph: DocumentGraph,
	nodeId: NodeId,
	display: Extract<EquationPayload, { mode: 'bound' }>['display']
): boolean {
	if (display === 'result') return graph.nodes.has(nodeId);
	return resolvePublishedTarget(graph, nodeId)?.targetNode.formula !== undefined;
}

/** The equation block node. `blockId` arrives through the global block attribute. */
export const EquationBlock = Node.create<EquationBlockOptions>({
	name: EQUATION_NODE_NAME,
	group: 'block',
	atom: true,
	draggable: false,

	addOptions() {
		return {
			graph: null as unknown as DocumentGraph,
			subscribe: () => () => {},
			commit: () => false
		};
	},

	addAttributes() {
		return {
			equation: { default: { mode: 'static', tex: '' } satisfies EquationPayload }
		};
	},

	parseHTML() {
		return [{ tag: 'figure[data-equation-block]' }];
	},

	renderHTML({ HTMLAttributes }) {
		return [
			'figure',
			mergeAttributes(HTMLAttributes, {
				'data-equation-block': '',
				class: 'equation-block'
			})
		];
	},

	addNodeView() {
		const { graph, subscribe, commit } = this.options;
		return ({ node, editor: tiptapEditor, getPos }) => {
			const dom = document.createElement('figure');
			dom.className = 'equation-block';
			dom.dataset.equationBlock = '';
			dom.contentEditable = 'false';

			const controls = document.createElement('div');
			controls.className = 'equation-controls';
			const mode = document.createElement('select');
			mode.setAttribute('aria-label', 'Equation source');
			mode.append(new Option('Static TeX', 'static'), new Option('Published value', 'bound'));
			const binding = document.createElement('select');
			binding.setAttribute('aria-label', 'Published value');
			const display = document.createElement('select');
			display.setAttribute('aria-label', 'Equation display');
			for (const value of ['symbolic', 'substituted', 'result', 'steps'] as const) {
				display.append(new Option(value[0].toUpperCase() + value.slice(1), value));
			}
			controls.append(mode, binding, display);

			const editor = document.createElement('textarea');
			editor.className = 'equation-source';
			editor.rows = 3;
			editor.maxLength = MAX_TEX_LENGTH;
			editor.setAttribute('aria-label', 'TeX source');
			const blockId = String(node.attrs.blockId ?? '');
			const helpId = `equation-help-${blockId || crypto.randomUUID()}`;
			editor.setAttribute('aria-describedby', helpId);
			editor.spellcheck = false;

			const help = document.createElement('p');
			help.id = helpId;
			help.className = 'equation-help';
			help.textContent = '⌘/Ctrl + Enter to apply · Escape to cancel';

			const preview = document.createElement('div');
			preview.className = 'equation-preview';
			preview.setAttribute('aria-live', 'polite');
			const status = document.createElement('p');
			status.className = 'equation-error';
			status.setAttribute('role', 'alert');
			status.hidden = true;
			dom.append(controls, editor, help, preview, status);

			let current = payloadFrom(node.attrs.equation);
			let currentAttrs = node.attrs;
			let lastValidTex = current.mode === 'static' ? current.tex : '';
			let renderVersion = 0;

			const showError = (message: string): void => {
				status.textContent = message;
				status.hidden = false;
				editor.setAttribute('aria-invalid', 'true');
			};

			const clearError = (): void => {
				status.textContent = '';
				status.hidden = true;
				editor.removeAttribute('aria-invalid');
			};

			/**
			 * Render in a scratch node first. An invalid render never destroys
			 * the last valid preview, and only KaTeX-created nodes cross over.
			 */
			const renderTex = async (tex: string): Promise<boolean> => {
				const version = ++renderVersion;
				if (tex.length > MAX_TEX_LENGTH) {
					showError(`Equation exceeds ${MAX_TEX_LENGTH.toLocaleString()} characters.`);
					return false;
				}
				if (hasMalformedUnicode(tex)) {
					showError('Equation contains malformed Unicode.');
					return false;
				}
				try {
					const katex = await loadKatex();
					if (version !== renderVersion) return false;
					const scratch = document.createElement('div');
					katex.render(tex, scratch, {
						trust: false,
						throwOnError: false,
						strict: 'warn',
						maxSize: 100,
						maxExpand: 1000,
						output: 'htmlAndMathml',
						macros: {}
					});
					const parseError = scratch.querySelector('.katex-error');
					if (parseError) {
						showError(parseError.textContent || 'Invalid TeX.');
						return false;
					}
					preview.replaceChildren(...Array.from(scratch.childNodes));
					lastValidTex = tex;
					clearError();
					return true;
				} catch (error) {
					showError(error instanceof Error ? error.message : 'Unable to render equation.');
					return false;
				}
			};

			const syncBindingOptions = (): void => {
				const selected = current.mode === 'bound' ? current.nodeId : '';
				binding.replaceChildren(new Option('Choose a published value…', ''));
				for (const published of publishedNodes(graph)) {
					binding.append(new Option(published.name ?? published.id, published.id));
				}
				binding.value = selected;
			};

			const syncDisplayOptions = (): void => {
				const nodeId = current.mode === 'bound' ? current.nodeId : '';
				for (const option of Array.from(display.options)) {
					option.disabled =
						option.value !== 'result' &&
						(!nodeId ||
							!supportsDisplay(
								graph,
								nodeId,
								option.value as Extract<EquationPayload, { mode: 'bound' }>['display']
							));
				}
			};

			const paint = (): void => {
				mode.value = current.mode;
				const isStatic = current.mode === 'static';
				editor.hidden = !isStatic;
				help.hidden = !isStatic;
				binding.hidden = isStatic;
				display.hidden = isStatic;
				syncBindingOptions();
				syncDisplayOptions();
				if (current.mode === 'static') {
					if (document.activeElement !== editor) editor.value = current.tex;
					void renderTex(current.tex);
					return;
				}
				display.value = current.display;
				void renderTex(equationToTex(current, graph));
			};

			const applyPayload = (next: EquationPayload): boolean => {
				if (!blockId || !commit(blockId, next)) return false;
				current = next;
				const position = getPos();
				if (typeof position === 'number') {
					const transaction = tiptapEditor.state.tr.setNodeMarkup(position, undefined, {
						...currentAttrs,
						equation: next
					});
					transaction.setMeta('octo-sync', true);
					transaction.setMeta('addToHistory', false);
					tiptapEditor.view.dispatch(transaction);
				}
				paint();
				return true;
			};

			mode.addEventListener('change', () => {
				if (mode.value === 'static') {
					applyPayload({ mode: 'static', tex: lastValidTex });
					queueMicrotask(() => editor.focus());
					return;
				}
				const first = publishedNodes(graph)[0];
				if (!first) {
					mode.value = 'static';
					showError('Publish a workbook value before binding an equation.');
					return;
				}
				applyPayload({ mode: 'bound', nodeId: first.id, display: 'result' });
			});

			binding.addEventListener('change', () => {
				if (!binding.value) return;
				const nextDisplay =
					current.mode === 'bound' &&
					supportsDisplay(graph, binding.value, current.display)
						? current.display
						: 'result';
				applyPayload({ mode: 'bound', nodeId: binding.value, display: nextDisplay });
			});

			display.addEventListener('change', () => {
				if (current.mode !== 'bound') return;
				const next = display.value as Extract<
					EquationPayload,
					{ mode: 'bound' }
				>['display'];
				if (!supportsDisplay(graph, current.nodeId, next)) return;
				applyPayload({ ...current, display: next });
			});

			editor.addEventListener('keydown', (event) => {
				if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
					event.preventDefault();
					const tex = editor.value;
					void renderTex(tex).then((valid) => {
						if (valid) applyPayload({ mode: 'static', tex });
					});
				} else if (event.key === 'Escape') {
					event.preventDefault();
					editor.value = current.mode === 'static' ? current.tex : lastValidTex;
					clearError();
					editor.blur();
				}
			});

			const unsubscribe = subscribe(paint);
			paint();

			return {
				dom,
				update: (updated) => {
					if (updated.type.name !== EQUATION_NODE_NAME) return false;
					currentAttrs = updated.attrs;
					current = payloadFrom(updated.attrs.equation);
					paint();
					return true;
				},
				destroy: () => {
					renderVersion++;
					unsubscribe();
				}
			};
		};
	}
});
