<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { X } from '@lucide/svelte';
	import type { NodeId } from '$lib/engine';
	import { buildInspector, type InspectorSource } from '$lib/editor';
	import { IconButton, type AdaptiveMode } from '$lib/ui';

	// V1-5-5 · the provenance inspector — the read-only reviewability panel
	// (PRD §2). Renders the pure view-model (editor/inspector.ts) for the
	// selected node: name, kind, canonical formula, current value, authorship,
	// and NAVIGABLE direct inputs/dependents. Clicking a link re-targets the
	// panel (the page owns the target), so a reviewer walks the dependency
	// chain without leaving it. Nothing here mutates anything.

	interface Props {
		/** The graph, read-only (structural slice; DocumentGraph satisfies it). */
		graph: InspectorSource;
		/** The inspected node. */
		nodeId: NodeId;
		/** Bumped by the page on every settle so the panel re-derives live. */
		revision: number;
		/**
		 * Bumped when the panel is opened from a focus-bearing affordance
		 * (chip Alt+click / Alt+Enter): the panel takes focus and returns it on
		 * close. Cell-selection opens never bump it — grid typing keeps focus.
		 */
		focusTick: number;
		/** Re-target the inspector at another node (link navigation). */
		onnavigate: (nodeId: NodeId) => void;
		/** Close the panel (close button; Escape lives on the page). */
		onclose: () => void;
		/** Current content-driven presentation mode. */
		mode?: AdaptiveMode;
	}
	let {
		graph,
		nodeId,
		revision,
		focusTick,
		onnavigate,
		onclose,
		mode = 'compact'
	}: Props = $props();

	let panelEl = $state<HTMLElement>();
	/** Where focus came from when the panel took it; restored on close. */
	let returnFocusTo: Element | null = null;
	/** Last focusTick acted on (plain: bookkeeping, not render state). */
	let handledFocusTick = 0;

	const vm = $derived.by(() => {
		void revision; // settle fan-out: re-derive the view-model live
		return buildInspector(graph, nodeId);
	});

	// The inspected node vanished (undo, delete): nothing to show, close.
	$effect(() => {
		if (vm === null) onclose();
	});

	// Focus management: chip-driven opens (focusTick > 0, bumped per open)
	// move focus into the panel; cell-selection opens never do.
	$effect(() => {
		if (focusTick > 0 && focusTick !== handledFocusTick && panelEl) {
			handledFocusTick = focusTick;
			returnFocusTo ??= document.activeElement;
			panelEl.focus();
		}
	});
	onDestroy(() => {
		if (returnFocusTo instanceof HTMLElement && returnFocusTo.isConnected) returnFocusTo.focus();
	});

	/** Link navigation: re-target, then keep keyboard context on the panel. */
	async function go(id: NodeId): Promise<void> {
		onnavigate(id);
		await tick();
		panelEl?.focus();
	}
</script>

{#if vm}
	<aside
		class="inspector"
		data-mode={mode}
		data-testid="inspector"
		aria-label="Provenance inspector"
		tabindex="-1"
		bind:this={panelEl}
	>
		<header>
			<span class="eyebrow">Inspector</span>
			<IconButton
				glyph={X}
				label="Close inspector"
				testId="inspector-close"
				onclick={onclose}
			/>
		</header>

		<h2 class="title mono" data-testid="inspector-title">{vm.title}</h2>
		<div class="kind mono" data-testid="inspector-kind">{vm.kind}</div>

		<section>
			<span class="eyebrow">Value</span>
			<div>
				<span
					class="chip value"
					class:err={vm.value.state === 'error'}
					data-testid="inspector-value"
					aria-busy={vm.value.state === 'busy' ? 'true' : undefined}>{vm.value.text}</span
				>
			</div>
		</section>

		{#if vm.formula}
			<section>
				<span class="eyebrow">Formula</span>
				<div class="formula mono" data-testid="inspector-formula">{vm.formula}</div>
			</section>
		{/if}

		<section>
			<span class="eyebrow">Authored</span>
			{#if vm.authored}
				<div class="stamp mono" data-testid="inspector-authored">
					{vm.authored.actor}{vm.authored.at ? ` · ${vm.authored.at}` : ''}
				</div>
			{:else}
				<div class="stamp mono muted" data-testid="inspector-authored">not recorded</div>
			{/if}
		</section>

		{#if vm.verified}
			<section>
				<span class="eyebrow">Verified</span>
				<div class="stamp mono" data-testid="inspector-verified">
					{vm.verified.by}{vm.verified.at ? ` · ${vm.verified.at}` : ''}
				</div>
			</section>
		{/if}

		<section>
			<span class="eyebrow">Inputs</span>
			{#if vm.inputs.length > 0}
				<ul class="links">
					{#each vm.inputs as link (link.nodeId)}
						<li>
							<button
								class="link mono"
								type="button"
								data-testid="inspector-input"
								onclick={() => go(link.nodeId)}
							>
								{link.label}<span class="link-kind">{link.kind}</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<div class="stamp mono muted">none</div>
			{/if}
		</section>

		<section>
			<span class="eyebrow">Dependents</span>
			{#if vm.dependents.length > 0}
				<ul class="links">
					{#each vm.dependents as link (link.nodeId)}
						<li>
							<button
								class="link mono"
								type="button"
								data-testid="inspector-dependent"
								onclick={() => go(link.nodeId)}
							>
								{link.label}<span class="link-kind">{link.kind}</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<div class="stamp mono muted">none</div>
			{/if}
		</section>
	</aside>
{/if}

<style>
	/* DESIGN.md: --surface panel, 1px hairline, --radius-panel, no shadows,
	   no animation (reduced motion honored by construction). Mono for ALL
	   computational text; --grey-1 is the floor for readable text. */
	.inspector {
		position: fixed;
		top: 96px;
		right: var(--s3);
		width: 300px;
		max-height: calc(100vh - 128px);
		overflow-y: auto;
		z-index: 60;
		background: var(--surface);
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-panel);
		padding: var(--s3);
		box-shadow: var(--shadow-floating);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--s2);
	}
	.title {
		font-size: 1.05rem;
		font-weight: 500;
		color: var(--ink);
		line-height: 1.3;
		overflow-wrap: break-word;
	}
	.kind {
		font-size: var(--fs-caption);
		color: var(--grey-1);
		margin-bottom: var(--s2);
	}
	section {
		padding-top: var(--s2);
		margin-top: var(--s2);
		border-top: 1px solid var(--grey-3);
	}
	section .eyebrow {
		display: block;
		margin-bottom: var(--s1);
	}
	/* The current value reuses the global .chip/.err rendering (base.css) —
	   a computed value is an allowed accent surface (DESIGN.md §3). */
	.value {
		font-size: 0.85rem;
	}
	.formula {
		font-size: 0.82rem;
		color: var(--ink);
		background: var(--grey-4);
		border-radius: var(--radius-chip);
		padding: var(--s1) 10px;
		overflow-x: auto;
		white-space: pre;
	}
	.stamp {
		font-size: 0.8rem;
		color: var(--grey-1);
	}
	.muted {
		color: var(--grey-2);
	}
	.links {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.link {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--s1);
		width: 100%;
		font-family: var(--font-mono);
		font-size: 0.82rem;
		text-align: left;
		color: var(--ink);
		background: none;
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-chip);
		padding: 4px 10px;
		cursor: pointer;
		transition:
			color var(--t-fast) var(--ease),
			border-color var(--t-fast) var(--ease);
	}
	.link:hover {
		border-color: var(--ink);
	}
	.link-kind {
		font-size: var(--fs-caption);
		color: var(--grey-2);
	}
	.inspector[data-mode='compact'] {
		inset: auto 0 0;
		width: auto;
		max-height: min(76dvh, 680px);
		padding-bottom: calc(var(--s3) + env(safe-area-inset-bottom));
		border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
	}
</style>
