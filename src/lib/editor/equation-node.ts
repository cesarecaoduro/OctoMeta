/**
 * Focus-safe TipTap NodeView for direct visual equations.
 *
 * The engine owns versioned authored/reference segments. MathLive is an
 * editable projection whose immutable macros preserve stable reference IDs;
 * KaTeX remains the trust-disabled last-known-good read projection.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import type { MacroDictionary, MathfieldElement } from 'mathlive';
import {
	MAX_EQUATION_LATEX_LENGTH,
	MAX_EQUATION_REFERENCES,
	emptyEquation,
	equationToTex,
	formatPublishedValue,
	isEquationPayload,
	listPublishedValues,
	normalizeEquationPayload,
	resolvePublishedTarget,
	type DocumentGraph,
	type EquationPayload,
	type EquationSegment,
	type EquationSessionHistory,
	type PublishedValue
} from '../engine';
import { EQUATION_NODE_NAME } from './blocks';
import {
	equationMathfieldModel,
	equationPayloadFromMathfield,
	equationPayloadFromSource,
	equationReferenceFromPublishedValue,
	equationReferenceMacroName,
	equationReferencePresentation,
	equationSourceModel,
	type EquationReferenceMacro,
	type EquationSourceReference
} from './equation-model';
import 'katex/dist/katex.min.css';
import 'mathlive/fonts.css';

/** Maximum authored or generated TeX accepted by the equation renderer. */
export const MAX_TEX_LENGTH = MAX_EQUATION_LATEX_LENGTH;

export interface EquationBlockOptions {
	/** Live graph used to resolve published references. */
	graph: DocumentGraph;
	/** Subscribe to graph settlement so reference projections remain live. */
	subscribe: (callback: () => void) => () => void;
	/** Commit one exact equation payload through the engine mutation path. */
	commit: (blockId: string, equation: EquationPayload) => boolean;
	/** Whether this editor currently owns the writable document lease. */
	editable: () => boolean;
	/** Capture the unified-history boundary at the start of an edit session. */
	beginSession: () => EquationSessionHistory;
	/** Restore the starting payload and remove canceled live updates. */
	cancelSession: (
		blockId: string,
		equation: EquationPayload,
		session: EquationSessionHistory
	) => boolean;
	/** Open the Workbook publication action when no reference is available. */
	onPublishValue?: () => void;
}

type KatexModule = typeof import('katex');
type MathliveModule = typeof import('mathlive');

let katexPromise: Promise<KatexModule> | null = null;
let mathlivePromise: Promise<MathliveModule> | null = null;

function loadKatex(): Promise<KatexModule> {
	katexPromise ??= import('katex');
	return katexPromise;
}

function loadMathlive(): Promise<MathliveModule> {
	mathlivePromise ??= import('mathlive').then((module) => {
		module.MathfieldElement.fontsDirectory = null;
		module.MathfieldElement.soundsDirectory = null;
		module.MathfieldElement.openUrl = () => {};
		return module;
	});
	return mathlivePromise;
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

function payloadFrom(value: unknown, graph: DocumentGraph): EquationPayload {
	return (
		normalizeEquationPayload(value, (nodeId) => graph.nodes.get(nodeId)?.name) ?? emptyEquation()
	);
}

function authoredLatex(payload: EquationPayload): string {
	return payload.segments
		.filter((segment): segment is Extract<EquationSegment, { kind: 'latex' }> => segment.kind === 'latex')
		.map((segment) => segment.latex)
		.join('');
}

function validationLatex(payload: EquationPayload): string {
	return payload.segments
		.map((segment) => (segment.kind === 'latex' ? segment.latex : '\\mathrm{x}'))
		.join('');
}

function intermediateProblem(latex: string, field: MathfieldElement | null): string | null {
	if (latex.length > MAX_TEX_LENGTH) {
		return `Equation exceeds ${MAX_TEX_LENGTH.toLocaleString()} authored characters.`;
	}
	if (hasMalformedUnicode(latex)) return 'Equation contains malformed Unicode.';
	if (field?.errors.length) return 'Equation contains incomplete or invalid notation.';
	if (/(?:[=+\-*/^_]|\\(?:frac|sqrt))\s*$/.test(latex)) {
		return 'Equation is incomplete. Continue editing or press Escape to restore it.';
	}
	return null;
}

function clonePayload(payload: EquationPayload): EquationPayload {
	return structuredClone(payload);
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
			commit: () => false,
			editable: () => true,
			beginSession: () => ({ afterSequence: 0, undoLog: [], undoCursor: 0 }),
			cancelSession: () => false,
			onPublishValue: undefined
		};
	},

	addAttributes() {
		return {
			equation: { default: emptyEquation() satisfies EquationPayload }
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
				'data-equation-version': '1',
				class: 'equation-block'
			})
		];
	},

	addNodeView() {
		const {
			graph,
			subscribe,
			commit,
			editable,
			beginSession,
			cancelSession,
			onPublishValue
		} = this.options;
		return ({ node, editor: tiptapEditor, getPos }) => {
			const dom = document.createElement('figure');
			dom.className = 'equation-block';
			dom.dataset.equationBlock = '';
			dom.dataset.equationVersion = '1';
			dom.contentEditable = 'false';
			dom.tabIndex = -1;

			const toolbar = document.createElement('div');
			toolbar.className = 'equation-controls';
			const insertReferenceButton = document.createElement('button');
			insertReferenceButton.type = 'button';
			insertReferenceButton.textContent = 'Insert value';
			const rawButton = document.createElement('button');
			rawButton.type = 'button';
			rawButton.textContent = 'Edit source';
			toolbar.append(insertReferenceButton, rawButton);

			const mathfield = document.createElement('math-field') as MathfieldElement;
			mathfield.className = 'equation-mathfield';
			mathfield.setAttribute('role', 'textbox');
			mathfield.setAttribute('aria-label', 'Equation');
			mathfield.setAttribute('aria-multiline', 'false');

			const raw = document.createElement('textarea');
			raw.className = 'equation-raw-source';
			raw.rows = 3;
			raw.maxLength = MAX_TEX_LENGTH * 2;
			raw.hidden = true;
			raw.setAttribute('aria-label', 'Equation source');
			raw.spellcheck = false;

			const referenceTokens = document.createElement('div');
			referenceTokens.className = 'equation-reference-tokens';
			referenceTokens.setAttribute('aria-label', 'Linked published values');

			const help = document.createElement('p');
			help.className = 'equation-help';
			help.textContent =
				'Type @ or use Insert value · ⌘/Ctrl + Enter finishes · Escape restores';

			const preview = document.createElement('div');
			preview.className = 'equation-preview';
			preview.setAttribute('role', 'img');
			preview.setAttribute('aria-label', 'Safe equation preview');
			preview.hidden = true;
			const status = document.createElement('p');
			status.className = 'equation-error';
			status.setAttribute('role', 'alert');
			status.hidden = true;

			const picker = document.createElement('div');
			picker.className = 'equation-reference-picker';
			picker.hidden = true;
			picker.setAttribute('role', 'dialog');
			picker.setAttribute('aria-label', 'Insert published value');
			const pickerHeader = document.createElement('div');
			pickerHeader.className = 'equation-picker-header';
			const pickerTitle = document.createElement('strong');
			pickerTitle.textContent = 'Insert published value';
			const closePickerButton = document.createElement('button');
			closePickerButton.type = 'button';
			closePickerButton.textContent = 'Close';
			closePickerButton.setAttribute('aria-label', 'Close reference picker');
			pickerHeader.append(pickerTitle, closePickerButton);
			const search = document.createElement('input');
			search.type = 'search';
			search.placeholder = 'Search published values';
			search.setAttribute('aria-label', 'Search published values');
			const pickerOptions = document.createElement('div');
			pickerOptions.className = 'equation-picker-options';
			pickerOptions.setAttribute('role', 'listbox');
			picker.append(pickerHeader, search, pickerOptions);

			dom.append(
				toolbar,
				mathfield,
				raw,
				referenceTokens,
				help,
				preview,
				status,
				picker
			);

			const blockId = String(node.attrs.blockId ?? '');
			let current = payloadFrom(node.attrs.equation, graph);
			let currentAttrs = node.attrs;
			let sessionStart: EquationPayload | null = null;
			let sessionHistory: EquationSessionHistory | null = null;
			let rawMode = false;
			let pickerOpen = false;
			let pickerReturnFocus: HTMLElement | null = null;
			let repairSegmentIndex: number | null = null;
			let fieldReady = false;
			let baseMacros: MacroDictionary = {};
			let editingReferences: EquationReferenceMacro[] = [];
			let sourceReferences: EquationSourceReference[] = [];
			let referenceCounter = 0;
			let renderVersion = 0;
			let suppressInput = false;

			const showError = (message: string): void => {
				status.textContent = message;
				status.hidden = false;
				preview.hidden = false;
				mathfield.setAttribute('aria-invalid', 'true');
				raw.setAttribute('aria-invalid', 'true');
			};

			const clearError = (): void => {
				status.textContent = '';
				status.hidden = true;
				preview.hidden = true;
				mathfield.removeAttribute('aria-invalid');
				raw.removeAttribute('aria-invalid');
			};

			const activeWithinEditor = (): boolean =>
				document.activeElement === mathfield || document.activeElement === raw;

			const ensureSession = (): void => {
				if (sessionStart !== null) return;
				sessionStart = clonePayload(current);
				sessionHistory = beginSession();
			};

			const syncEditableState = (): void => {
				const enabled = editable();
				mathfield.readOnly = !enabled;
				raw.readOnly = !enabled;
				insertReferenceButton.disabled = !enabled;
				rawButton.disabled = !enabled;
				dom.toggleAttribute('data-readonly', !enabled);
				for (const control of referenceTokens.querySelectorAll('button')) {
					control.disabled = !enabled;
				}
				if (!enabled) {
					pickerOpen = false;
					picker.hidden = true;
				}
			};

			const refreshMacros = (): void => {
				if (!fieldReady) return;
				const macros: MacroDictionary = {};
				for (const reference of editingReferences) {
					const presentation = equationReferencePresentation(reference.segment, graph);
					reference.broken = presentation.broken;
					reference.label = presentation.label;
					macros[reference.name] = {
						def: presentation.definition,
						captureSelection: true
					};
				}
				mathfield.macros = { ...baseMacros, ...macros };
			};

			const resetEditingProjection = (focus = false): void => {
				if (!fieldReady) return;
				const model = equationMathfieldModel(current, graph);
				editingReferences = model.references;
				referenceCounter = editingReferences.length;
				mathfield.macros = { ...baseMacros, ...model.macros };
				suppressInput = true;
				mathfield.setValue(model.latex, {
					silenceNotifications: true,
					selectionMode: focus ? 'after' : 'before'
				});
				suppressInput = false;
				const sourceModel = equationSourceModel(current, graph);
				sourceReferences = sourceModel.references;
				if (!rawMode) raw.value = sourceModel.source;
				if (focus) mathfield.focus();
			};

			const renderSafePreview = async (): Promise<void> => {
				const version = ++renderVersion;
				const tex = equationToTex(current, graph);
				const problem = intermediateProblem(
					validationLatex(current),
					fieldReady && !rawMode ? mathfield : null
				);
				if (problem) {
					showError(problem);
					return;
				}
				try {
					const katex = await loadKatex();
					if (version !== renderVersion) return;
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
						showError(parseError.textContent || 'Equation contains invalid notation.');
						return;
					}
					preview.replaceChildren(...Array.from(scratch.childNodes));
					clearError();
				} catch (error) {
					showError(error instanceof Error ? error.message : 'Unable to render equation.');
				}
			};

			const renderReferenceTokens = (): void => {
				const priorItems = Array.from(referenceTokens.querySelectorAll('.equation-reference-item'));
				const focusedItem = priorItems.findIndex((item) => item.contains(document.activeElement));
				const focusedRemove =
					document.activeElement instanceof HTMLElement &&
					document.activeElement.classList.contains('equation-reference-remove');
				referenceTokens.replaceChildren();
				current.segments.forEach((segment, segmentIndex) => {
					if (segment.kind !== 'reference') return;
					const presentation = equationReferencePresentation(segment, graph);
					const item = document.createElement('span');
					item.className = 'equation-reference-item';
					const token = document.createElement('button');
					token.type = 'button';
					token.disabled = !editable();
					token.className = 'equation-reference-token';
					token.dataset.equationReference = segment.nodeId;
					if (presentation.broken) token.dataset.broken = '';
					const resolved = resolvePublishedTarget(graph, segment.nodeId);
					token.textContent =
						presentation.broken || !resolved
							? presentation.label
							: `${presentation.label} · ${formatPublishedValue(
									resolved.targetNode.value,
									resolved.publishedNode.publication?.unit
								)}`;
					token.setAttribute(
						'aria-label',
						`${presentation.broken ? 'Repair missing reference' : 'Replace reference'} ${presentation.label}`
					);
					token.addEventListener('click', () => openPicker(segmentIndex));
					const remove = document.createElement('button');
					remove.type = 'button';
					remove.disabled = !editable();
					remove.className = 'equation-reference-remove';
					remove.textContent = 'Remove';
					remove.setAttribute('aria-label', `Remove reference ${presentation.label}`);
					remove.addEventListener('click', () => {
						if (!editable()) return;
						ensureSession();
						const next = clonePayload(current);
						next.segments.splice(segmentIndex, 1);
						if (next.segments.length === 0) next.segments.push({ kind: 'latex', latex: '' });
						if (applyPayload(next)) resetEditingProjection(true);
					});
					item.append(token, remove);
					referenceTokens.append(item);
				});
				referenceTokens.hidden = referenceTokens.childElementCount === 0;
				if (focusedItem >= 0) {
					queueMicrotask(() => {
						const item = referenceTokens.children.item(focusedItem);
						item
							?.querySelector<HTMLButtonElement>(
								focusedRemove ? '.equation-reference-remove' : '.equation-reference-token'
							)
							?.focus();
					});
				}
			};

			const paint = (): void => {
				const graphEquation = graph.blocks.get(blockId)?.equation;
				if (
					graphEquation &&
					JSON.stringify(graphEquation) !== JSON.stringify(current)
				) {
					current = clonePayload(graphEquation);
					currentAttrs = { ...currentAttrs, equation: graphEquation };
				}
				dom.dataset.equationVersion = String(current.version);
				renderReferenceTokens();
				if (fieldReady) {
					if (activeWithinEditor()) refreshMacros();
					else resetEditingProjection(false);
				}
				if (!rawMode && document.activeElement !== raw) {
					const sourceModel = equationSourceModel(current, graph);
					sourceReferences = sourceModel.references;
					raw.value = sourceModel.source;
				}
				if (pickerOpen) renderPicker();
				syncEditableState();
				void renderSafePreview();
			};

			const applyPayload = (next: EquationPayload): boolean => {
				if (!editable() || !blockId || !isEquationPayload(next) || !commit(blockId, next)) {
					return false;
				}
				current = clonePayload(next);
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
				renderReferenceTokens();
				void renderSafePreview();
				return true;
			};

			const applyEditedLatex = (): void => {
				const next = rawMode
					? equationPayloadFromSource(raw.value, sourceReferences, graph)
					: equationPayloadFromMathfield(
							fieldReady ? mathfield.getValue('latex') : authoredLatex(current),
							editingReferences
						);
				if (!isEquationPayload(next)) {
					showError(
						`Equation is over the ${MAX_TEX_LENGTH.toLocaleString()} character or ${MAX_EQUATION_REFERENCES} reference limit.`
					);
					return;
				}
				if (applyPayload(next) && rawMode) {
					sourceReferences = equationSourceModel(next, graph).references;
				}
			};

			const finishEditing = (): void => {
				sessionStart = null;
				sessionHistory = null;
				pickerOpen = false;
				picker.hidden = true;
				raw.blur();
				mathfield.blur();
				resetEditingProjection(false);
				dom.focus();
			};

			const restoreSession = (): void => {
				if (
					sessionStart &&
					sessionHistory &&
					!cancelSession(blockId, clonePayload(sessionStart), sessionHistory)
				) {
					showError('The equation could not be restored.');
					return;
				}
				if (sessionStart) {
					current = clonePayload(sessionStart);
					const position = getPos();
					if (typeof position === 'number') {
						const transaction = tiptapEditor.state.tr.setNodeMarkup(position, undefined, {
							...currentAttrs,
							equation: current
						});
						transaction.setMeta('octo-sync', true);
						transaction.setMeta('addToHistory', false);
						tiptapEditor.view.dispatch(transaction);
					}
					renderReferenceTokens();
					void renderSafePreview();
				}
				sessionStart = null;
				sessionHistory = null;
				pickerOpen = false;
				picker.hidden = true;
				rawMode = false;
				raw.hidden = true;
				mathfield.hidden = false;
				rawButton.textContent = 'Edit source';
				help.textContent =
					'Type @ or use Insert value · ⌘/Ctrl + Enter finishes · Escape restores';
				resetEditingProjection(false);
				raw.blur();
				mathfield.blur();
				dom.focus();
			};

			const selectPublishedValue = (value: PublishedValue): void => {
				const reference = equationReferenceFromPublishedValue(value);
				if (repairSegmentIndex !== null) {
					const next = clonePayload(current);
					next.segments[repairSegmentIndex] = reference;
					if (applyPayload(next)) resetEditingProjection(true);
				} else if (rawMode) {
					const presentation = equationReferencePresentation(reference, graph);
					sourceReferences.push({
						label: presentation.label,
						segment: reference
					});
					const token = `\\value{${presentation.label}}`;
					raw.setRangeText(token, raw.selectionStart, raw.selectionEnd, 'end');
					applyEditedLatex();
					raw.focus();
				} else if (fieldReady) {
					const name = equationReferenceMacroName(referenceCounter++);
					const presentation = equationReferencePresentation(reference, graph);
					editingReferences.push({
						name,
						segment: reference,
						broken: presentation.broken,
						label: presentation.label
					});
					refreshMacros();
					mathfield.focus();
					mathfield.insert(`\\${name}{}`, {
						format: 'latex',
						focus: true,
						selectionMode: 'after',
						silenceNotifications: true
					});
					applyEditedLatex();
				}
				closePicker(false);
				renderReferenceTokens();
			};

			const renderPicker = (): void => {
				const focusedValue =
					document.activeElement instanceof HTMLElement
						? document.activeElement.dataset.publishedValue
						: undefined;
				const values = listPublishedValues(graph, search.value);
				pickerOptions.replaceChildren();
				if (values.length === 0) {
					const empty = document.createElement('p');
					empty.className = 'equation-picker-empty';
					empty.textContent = search.value
						? 'No published values match this search.'
						: 'No values are published yet. Select a Workbook cell and publish it first.';
					pickerOptions.append(empty);
					if (!search.value) {
						const publish = document.createElement('button');
						publish.type = 'button';
						publish.textContent = 'Publish a workbook value';
						publish.addEventListener('click', () => onPublishValue?.());
						pickerOptions.append(publish);
					}
					return;
				}
				for (const value of values) {
					const option = document.createElement('button');
					option.type = 'button';
					option.disabled = !editable();
					option.dataset.publishedValue = value.id;
					option.setAttribute('role', 'option');
					option.className = 'equation-picker-option';
					const valueText = formatPublishedValue(value.value, value.unit);
					option.setAttribute(
						'aria-label',
						`${value.name}, ${valueText}, ${value.sheet} ${value.cell}`
					);
					option.innerHTML = `<strong></strong><span></span><small></small>`;
					option.querySelector('strong')!.textContent = value.name;
					option.querySelector('span')!.textContent = value.label ?? valueText;
					option.querySelector('small')!.textContent =
						`${valueText} · ${value.sheet} · ${value.cell}`;
					option.addEventListener('click', () => selectPublishedValue(value));
					pickerOptions.append(option);
				}
				if (focusedValue) {
					queueMicrotask(() =>
						pickerOptions
							.querySelector<HTMLButtonElement>(
								`[data-published-value="${CSS.escape(focusedValue)}"]`
							)
							?.focus()
					);
				}
			};

			function openPicker(segmentIndex: number | null = null): void {
				if (!editable()) return;
				ensureSession();
				pickerReturnFocus =
					document.activeElement instanceof HTMLElement ? document.activeElement : null;
				repairSegmentIndex = segmentIndex;
				pickerOpen = true;
				picker.hidden = false;
				pickerTitle.textContent =
					segmentIndex === null ? 'Insert published value' : 'Replace published value';
				picker.setAttribute(
					'aria-label',
					segmentIndex === null ? 'Insert published value' : 'Replace published value'
				);
				search.value = '';
				renderPicker();
				queueMicrotask(() => search.focus());
			}

			function closePicker(restoreInvoker = true): void {
				pickerOpen = false;
				picker.hidden = true;
				repairSegmentIndex = null;
				queueMicrotask(() => {
					if (restoreInvoker && pickerReturnFocus?.isConnected) pickerReturnFocus.focus();
					else if (rawMode) raw.focus();
					else if (fieldReady) mathfield.focus();
					pickerReturnFocus = null;
				});
			}

			insertReferenceButton.addEventListener('click', () => openPicker());
			closePickerButton.addEventListener('click', () => closePicker());
			search.addEventListener('input', renderPicker);
			picker.addEventListener('keydown', (event) => {
				if (event.key === 'Escape') {
					event.preventDefault();
					event.stopPropagation();
					closePicker();
					return;
				}
				const options = Array.from(
					pickerOptions.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
				);
				if (options.length === 0) return;
				if (event.key === 'Enter' && document.activeElement === search) {
					event.preventDefault();
					options[0].click();
					return;
				}
				if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
					event.preventDefault();
					const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
					const direction = event.key === 'ArrowDown' ? 1 : -1;
					const nextIndex =
						currentIndex < 0
							? direction > 0
								? 0
								: options.length - 1
							: (currentIndex + direction + options.length) % options.length;
					options[nextIndex].focus();
				}
			});

			rawButton.addEventListener('click', () => {
				if (!editable()) return;
				rawMode = !rawMode;
				raw.hidden = !rawMode;
				mathfield.hidden = rawMode;
				rawButton.textContent = rawMode ? 'Use visual editor' : 'Edit source';
				if (rawMode) {
					const sourceModel = equationSourceModel(current, graph);
					sourceReferences = sourceModel.references;
					raw.value = sourceModel.source;
					help.textContent =
						'Published values use \\value{name} · Stable links stay internal · Escape restores';
					queueMicrotask(() => raw.focus());
				} else {
					applyEditedLatex();
					help.textContent =
						'Type @ or use Insert value · ⌘/Ctrl + Enter finishes · Escape restores';
					resetEditingProjection(true);
				}
			});

			mathfield.addEventListener('input', () => {
				if (!suppressInput && editable()) applyEditedLatex();
			});
			raw.addEventListener('input', () => {
				if (editable()) applyEditedLatex();
			});

			const handleEditorKeydown = (event: KeyboardEvent): void => {
				if (event.key === '@' && !event.metaKey && !event.ctrlKey && !event.altKey) {
					event.preventDefault();
					event.stopPropagation();
					openPicker();
					return;
				}
				if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
					event.preventDefault();
					event.stopPropagation();
					finishEditing();
				} else if (event.key === 'Escape') {
					event.preventDefault();
					event.stopPropagation();
					restoreSession();
				}
			};
			mathfield.addEventListener('keydown', handleEditorKeydown);
			raw.addEventListener('keydown', handleEditorKeydown);

			dom.addEventListener('focusin', (event) => {
				if (
					sessionStart === null &&
					(event.target === mathfield || event.target === raw)
				) {
					ensureSession();
				}
			});
			dom.addEventListener('focusout', () => {
				queueMicrotask(() => {
					if (dom.contains(document.activeElement)) return;
					sessionStart = null;
					sessionHistory = null;
					resetEditingProjection(false);
				});
			});

			const unsubscribe = subscribe(paint);
			dom.addEventListener('octo-editable-change', syncEditableState);
			void loadMathlive().then(() => {
				if (!dom.isConnected) return;
				fieldReady = true;
				mathfield.defaultMode = 'math';
				mathfield.smartFence = true;
				mathfield.smartSuperscript = true;
				mathfield.mathVirtualKeyboardPolicy = 'auto';
				mathfield.placeholder = '\\text{Type an equation}';
				mathfield.inlineShortcuts = {
					...mathfield.inlineShortcuts,
					'*': '\\times'
				};
				baseMacros = { ...mathfield.macros };
				resetEditingProjection(false);
				const sink = mathfield.shadowRoot?.querySelector<HTMLElement>('.ML__keyboard-sink');
				sink?.setAttribute('aria-label', 'Equation input');
				void renderSafePreview();
			});
			paint();

			return {
				dom,
				update: (updated) => {
					if (updated.type.name !== EQUATION_NODE_NAME) return false;
					currentAttrs = updated.attrs;
					const next = payloadFrom(updated.attrs.equation, graph);
					const same = JSON.stringify(next) === JSON.stringify(current);
					current = next;
					if (!same && !activeWithinEditor()) resetEditingProjection(false);
					paint();
					return true;
				},
				stopEvent: (event) => dom.contains(event.target as globalThis.Node),
				ignoreMutation: () => true,
				destroy: () => {
					renderVersion++;
					unsubscribe();
					dom.removeEventListener('octo-editable-change', syncEditableState);
				}
			};
		};
	}
});
