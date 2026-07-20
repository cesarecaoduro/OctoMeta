/**
 * `valueChip` — the inline TipTap atom projecting a live graph value into
 * prose (V1-5-3). The PM node carries only `chipId`; the authoritative
 * binding lives in the graph (`ChipBinding`, SCHEMA.md §8) and the bound
 * node's LIVE value is what renders — mono, `.chip` styling from base.css.
 *
 * - Live updates: every NodeView subscribes to the injected settle fan-out
 *   (GraphSession.onSettle via the page) and re-renders from graph state; a
 *   changed value re-triggers the `.pulse` recompute flash (DESIGN.md §5,
 *   accent → dim 700 ms; `prefers-reduced-motion` kills all animation in
 *   base.css).
 * - Busy: the engine's pre-settle placeholder renders as `…` with
 *   `aria-busy` (commits settle synchronously in V1, so this is transient).
 * - Errors render the code (`#REF!`, `#CYCLE!`…) in `.err` styling and
 *   deep-link to the error's `origin` node on click/Enter (SCHEMA.md §11).
 *   When the origin cannot be resolved to a block in the doc (node deleted,
 *   or no hosting block), the chip re-pulses in place as feedback — the
 *   documented fallback.
 * - Show-steps expansion (V1-5-4): click/Enter on a VALUE chip toggles an
 *   in-canvas derivation panel (`.chip-steps`) built from `derive` at render
 *   time — formula, substitution, intermediates, result, all mono. The panel
 *   re-derives on every settle while open, so it follows upstream edits.
 *   The affordance never conflicts with error deep-linking: expansion is
 *   value-state only, deep-link is error/dangling only, and busy chips do
 *   nothing. Escape collapses. The plain-text derivation (`renderStepsText`)
 *   is exposed to screen readers via visually-hidden text; the visual lines
 *   are `aria-hidden` so nothing reads twice.
 * - A11y (PRD §10): chips are focusable (`tabindex=0`) with a screen-reader
 *   label naming the bound value and its current state; expandable chips are
 *   `role=button` with `aria-expanded`.
 * - Provenance inspector (V1-5-5): Alt+click or Alt+Enter opens the inspector
 *   on the chip's bound node — a dedicated modifier affordance, so it can
 *   never collide with plain click/Enter (error deep-link, V1-5-3; steps
 *   expansion, V1-5-4). Announced via `aria-keyshortcuts="Alt+Enter"`; the
 *   chip stays focusable so the affordance is fully keyboard-reachable.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import type { ChipBinding, Derivation, GraphNode, NodeId } from '../engine';
import { renderStepsText } from '../engine';
import {
	CHIP_NODE_NAME,
	canExpandSteps,
	chipDisplay,
	derivationLines,
	sameDisplay,
	type ChipDisplay
} from './chips';

export interface ChipNodeOptions {
	/** Look up a chip's binding and its bound node in the graph. */
	resolve: (chipId: string) => { binding: ChipBinding | undefined; node: GraphNode | undefined };
	/** Subscribe to the session settle fan-out. Returns an unsubscriber. */
	subscribe: (cb: () => void) => () => void;
	/**
	 * Deep-link to an error origin: scroll to + highlight its hosting block.
	 * Returns false when the origin cannot be located (fallback pulses the chip).
	 */
	navigate: (origin: NodeId) => boolean;
	/**
	 * Build the derivation a chip shows when expanded (V1-5-4). Undefined
	 * disables expansion entirely (chips render exactly as V1-5-3).
	 */
	derive?: (nodeId: NodeId) => Derivation;
	/**
	 * Open the provenance inspector on the chip's bound node (V1-5-5),
	 * triggered by Alt+click / Alt+Enter. Undefined disables the affordance.
	 */
	inspect?: (nodeId: NodeId) => void;
}

/** The inline value chip node. Attrs carry ONLY the chip id. */
export const ChipNode = Node.create<ChipNodeOptions>({
	name: CHIP_NODE_NAME,
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,

	addOptions() {
		return {
			resolve: () => ({ binding: undefined, node: undefined }),
			subscribe: () => () => {},
			navigate: () => false
		};
	},

	addAttributes() {
		return {
			chipId: { default: '' }
		};
	},

	parseHTML() {
		return [{ tag: 'span[data-chip-id]', getAttrs: (el) => ({ chipId: el.getAttribute('data-chip-id') ?? '' }) }];
	},

	renderHTML({ node, HTMLAttributes }) {
		return [
			'span',
			mergeAttributes(HTMLAttributes, {
				'data-chip-id': String(node.attrs.chipId ?? ''),
				class: 'chip'
			})
		];
	},

	addNodeView() {
		const { resolve, subscribe, navigate, derive, inspect } = this.options;
		return ({ node }) => {
			const chipId = String(node.attrs.chipId ?? '');

			const dom = document.createElement('span');
			dom.dataset.chipId = chipId;
			dom.contentEditable = 'false';
			dom.tabIndex = 0;
			// The inspector affordance (V1-5-5), announced to AT. Alt+click works
			// for pointers; the shortcut works wherever the chip has focus.
			if (inspect) dom.setAttribute('aria-keyshortcuts', 'Alt+Enter');
			/** The value text lives in its own child so the panel can coexist. */
			const valueEl = document.createElement('span');
			dom.appendChild(valueEl);

			let last: ChipDisplay | null = null;
			let pulseTimer: ReturnType<typeof setTimeout> | null = null;
			/** The expanded show-steps panel, present only while expanded. */
			let panel: HTMLSpanElement | null = null;

			/** Restart the recompute flash (remove → reflow → add re-triggers). */
			const pulse = (): void => {
				dom.classList.remove('pulse');
				void dom.offsetWidth;
				dom.classList.add('pulse');
				if (pulseTimer !== null) clearTimeout(pulseTimer);
				// Fallback cleanup for reduced motion, where animationend never fires.
				pulseTimer = setTimeout(() => dom.classList.remove('pulse'), 800);
			};
			dom.addEventListener('animationend', () => dom.classList.remove('pulse'));

			/** Rebuild the panel content from a fresh derivation (V1-5-4). */
			const refreshSteps = (): void => {
				if (!panel || !derive) return;
				const { binding } = resolve(chipId);
				if (!binding) {
					collapse();
					return;
				}
				const derivation = derive(binding.nodeId);
				// Screen readers get the engine's plain-text form (PRD §10); the
				// styled lines are hidden from them so nothing reads twice.
				const sr = document.createElement('span');
				sr.className = 'visually-hidden';
				sr.textContent = renderStepsText(derivation);
				const lines = document.createElement('span');
				lines.className = 'chip-steps-lines';
				lines.setAttribute('aria-hidden', 'true');
				for (const line of derivationLines(derivation)) {
					const el = document.createElement('span');
					el.className = 'chip-steps-line';
					el.dataset.stepKind = line.kind;
					el.textContent = line.text;
					lines.appendChild(el);
				}
				panel.replaceChildren(sr, lines);
			};

			const expand = (): void => {
				if (panel || !derive) return;
				panel = document.createElement('span');
				panel.className = 'chip-steps';
				panel.dataset.chipSteps = '';
				dom.appendChild(panel);
				refreshSteps();
				dom.setAttribute('aria-expanded', 'true');
			};

			const collapse = (): void => {
				if (!panel) return;
				panel.remove();
				panel = null;
				if (dom.hasAttribute('aria-expanded')) dom.setAttribute('aria-expanded', 'false');
			};

			const render = (flashOnChange: boolean): void => {
				const { binding, node: bound } = resolve(chipId);
				const d = chipDisplay(binding, bound);
				if (last && sameDisplay(last, d)) return;
				const changed = last !== null;
				last = d;
				const expandable = derive !== undefined && canExpandSteps(d);
				if (!expandable) collapse(); // e.g. the bound node turned error
				valueEl.textContent = d.text;
				const isError = d.state === 'error' || d.state === 'dangling';
				dom.className = isError
					? 'chip err chip-error'
					: expandable
						? 'chip chip-expandable'
						: 'chip';
				dom.setAttribute('aria-label', d.label);
				if (d.state === 'busy') dom.setAttribute('aria-busy', 'true');
				else dom.removeAttribute('aria-busy');
				if (isError) {
					dom.setAttribute('role', 'button');
					dom.removeAttribute('aria-expanded');
				} else if (expandable) {
					dom.setAttribute('role', 'button');
					dom.setAttribute('aria-expanded', panel !== null ? 'true' : 'false');
				} else {
					dom.removeAttribute('role');
					dom.removeAttribute('aria-expanded');
				}
				if (changed && flashOnChange) pulse();
			};
			render(false);

			// Steps re-derive on every settle while expanded, so an open panel
			// follows upstream edits even when the chip's own text is unchanged.
			const offSettle = subscribe(() => {
				render(true);
				refreshSteps();
			});

			/**
			 * Click or Enter: error/dangling chips deep-link to the origin block
			 * (V1-5-3); value chips toggle the show-steps panel (V1-5-4). Busy
			 * chips do nothing.
			 */
			const activate = (): void => {
				if (last?.state === 'error' || last?.state === 'dangling') {
					const ok = last.origin !== undefined ? navigate(last.origin) : false;
					// Fallback (documented): origin unresolvable — pulse in place.
					if (!ok) pulse();
					return;
				}
				if (last !== null && canExpandSteps(last) && derive !== undefined) {
					if (panel) collapse();
					else expand();
				}
			};
			/**
			 * V1-5-5: open the inspector on the bound node. Dangling chips have
			 * nothing to inspect. Returns whether the affordance handled the event.
			 */
			const inspectChip = (): boolean => {
				if (!inspect) return false;
				const { binding } = resolve(chipId);
				if (!binding) return false;
				inspect(binding.nodeId);
				return true;
			};
			const onClick = (e: MouseEvent): void => {
				// Clicks inside the panel (text selection, scrolling) never toggle.
				if (panel && e.target instanceof globalThis.Node && panel.contains(e.target)) return;
				// Alt+click = inspector (V1-5-5); never falls through to the plain
				// activation so the two affordances stay unambiguous. The chip takes
				// focus first — a click lands focus on the editor root, and the
				// inspector must return focus HERE when it closes.
				if (e.altKey) {
					if (inspectChip()) dom.focus();
					return;
				}
				activate();
			};
			const onKeydown = (e: KeyboardEvent): void => {
				if (e.key === 'Enter') {
					e.preventDefault();
					e.stopPropagation();
					if (e.altKey) {
						inspectChip();
						return;
					}
					activate();
				} else if (e.key === 'Escape' && panel) {
					e.preventDefault();
					e.stopPropagation();
					collapse();
				}
			};
			dom.addEventListener('click', onClick);
			dom.addEventListener('keydown', onKeydown);

			return {
				dom,
				// Attr-identical updates keep the DOM; a reminted chipId recreates
				// the view so it binds and subscribes freshly.
				update: (updated) => {
					if (updated.type.name !== CHIP_NODE_NAME) return false;
					return String(updated.attrs.chipId ?? '') === chipId;
				},
				// Events inside the open panel stay with the browser (text
				// selection, panel scrolling) instead of ProseMirror.
				stopEvent: (event) =>
					panel !== null && event.target instanceof globalThis.Node && panel.contains(event.target),
				destroy: () => {
					offSettle();
					if (pulseTimer !== null) clearTimeout(pulseTimer);
					dom.removeEventListener('click', onClick);
					dom.removeEventListener('keydown', onKeydown);
				}
			};
		};
	}
});
