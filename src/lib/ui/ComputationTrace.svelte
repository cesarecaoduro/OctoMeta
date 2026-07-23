<script lang="ts">
	interface Props {
		active?: boolean;
		message?: string;
		oninterrupt?: () => void;
	}
	let {
		active = false,
		message = 'Dependent values updated.',
		oninterrupt
	}: Props = $props();
</script>

<div class="trace" class:active aria-hidden="true">
	<span class="source"></span>
	<span class="path"></span>
	<span class="destination"></span>
</div>
<span class="visually-hidden" role="status" aria-live="polite">{active ? message : ''}</span>
{#if active && oninterrupt}
	<button class="visually-hidden" type="button" onclick={oninterrupt}>Stop computation trace</button>
{/if}

<style>
	.trace {
		position: relative;
		display: grid;
		grid-template-columns: 8px minmax(32px, 1fr) 8px;
		align-items: center;
		width: min(180px, 35vw);
		opacity: 0;
	}
	.trace.active { opacity: 1; }
	.source, .destination {
		width: 8px;
		height: 8px;
		border: 2px solid var(--tint);
		border-radius: 50%;
	}
	.path {
		height: 1px;
		overflow: hidden;
		background: var(--border-strong);
	}
	.path::after {
		content: '';
		display: block;
		width: 40%;
		height: 1px;
		background: var(--tint);
		transform: translateX(-110%);
	}
	.active .path::after {
		animation: computation-trace var(--motion-computation) var(--ease-out) both;
	}
	@keyframes computation-trace {
		to { transform: translateX(360%); }
	}
	@media (prefers-reduced-motion: reduce) {
		.active .path::after {
			width: 100%;
			transform: none;
			animation: none;
		}
		.active .source,
		.active .destination {
			background: var(--tint-muted);
		}
	}
</style>
