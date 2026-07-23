<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
		kind?: 'neutral' | 'success' | 'warning' | 'error' | 'info';
		live?: 'off' | 'polite' | 'assertive';
		testId?: string;
		dataState?: string;
	}
	let {
		children,
		kind = 'neutral',
		live = 'off',
		testId,
		dataState
	}: Props = $props();
</script>

<span
	class="status"
	data-kind={kind}
	data-testid={testId}
	data-save-state={dataState}
	aria-live={live}
>{@render children()}</span>

<style>
	.status {
		display: inline-flex;
		align-items: center;
		gap: var(--s1);
		color: var(--text-secondary);
		font: 500 var(--fs-caption) var(--font-body);
	}
	.status::before {
		content: '';
		width: 8px;
		height: 8px;
		border: 2px solid currentColor;
		border-radius: 50%;
	}
	.status[data-kind='success'] { color: var(--status-success); }
	.status[data-kind='warning'] { color: var(--status-warning); }
	.status[data-kind='error'] { color: var(--status-error); }
	.status[data-kind='info'] { color: var(--status-info); }
</style>
