<script lang="ts">
	import type { LucideIcon } from '@lucide/svelte';
	import Icon from './Icon.svelte';

	interface Props {
		glyph: LucideIcon;
		/** Required control name; also supplies the native discoverable tooltip. */
		label: string;
		tooltip?: string;
		pressed?: boolean;
		expanded?: boolean;
		hasPopup?: 'menu' | 'dialog' | 'listbox' | 'tree' | 'grid';
		disabled?: boolean;
		state?: 'default' | 'active' | 'success' | 'warning' | 'error';
		testId?: string;
		element?: HTMLButtonElement;
		onclick?: (event: MouseEvent) => void;
	}

	let {
		glyph,
		label,
		tooltip = label,
		pressed,
		expanded,
		hasPopup,
		disabled = false,
		state = 'default',
		testId,
		element = $bindable(),
		onclick
	}: Props = $props();
</script>

<button
	bind:this={element}
	class="icon-button"
	class:pressed
	type="button"
	aria-label={label}
	aria-pressed={pressed}
	aria-expanded={expanded}
	aria-haspopup={hasPopup}
	title={tooltip}
	data-testid={testId}
	{disabled}
	{onclick}
>
	<Icon {glyph} {state} />
</button>

<style>
	.icon-button {
		display: inline-grid;
		flex: 0 0 44px;
		width: 44px;
		height: 44px;
		place-items: center;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--radius-control);
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
		transition:
			background var(--motion-feedback) var(--ease-out),
			color var(--motion-feedback) var(--ease-out);
	}
	.icon-button:hover:not(:disabled) {
		background: var(--surface-muted);
		color: var(--text);
	}
	.icon-button:active:not(:disabled),
	.icon-button.pressed {
		background: var(--tint-muted);
		color: var(--tint);
	}
	.icon-button:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-offset);
	}
	.icon-button:disabled {
		opacity: .42;
		cursor: default;
	}
</style>
