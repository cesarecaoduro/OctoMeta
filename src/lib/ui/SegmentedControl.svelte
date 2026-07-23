<script lang="ts">
	import type { LucideIcon } from '@lucide/svelte';
	import Icon from './Icon.svelte';

	interface Option {
		value: string;
		label: string;
		glyph?: LucideIcon;
	}
	interface Props {
		label: string;
		options: Option[];
		value: string;
		onchange: (value: string) => void;
	}
	let { label, options, value, onchange }: Props = $props();
</script>

<div class="segmented" role="group" aria-label={label}>
	{#each options as option (option.value)}
		<button
			type="button"
			aria-pressed={value === option.value}
			onclick={() => onchange(option.value)}
		>
			{#if option.glyph}
				<Icon
					glyph={option.glyph}
					size={18}
					state={value === option.value ? 'active' : 'default'}
				/>
			{/if}
			{option.label}
		</button>
	{/each}
</div>

<style>
	.segmented {
		display: inline-grid;
		grid-auto-flow: column;
		grid-auto-columns: 1fr;
		gap: var(--s1);
		padding: var(--s1);
		border: 1px solid var(--border);
		border-radius: var(--radius-control);
		background: var(--surface-muted);
	}
	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--s1);
		min-height: 44px;
		padding: 0 var(--s2);
		border: 0;
		border-radius: calc(var(--radius-control) - 4px);
		background: transparent;
		color: var(--text-secondary);
		font: 600 .82rem var(--font-body);
		cursor: pointer;
	}
	button[aria-pressed='true'] {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-control);
	}
	button:focus-visible {
		outline: var(--focus-ring);
		outline-offset: 0;
	}
</style>
