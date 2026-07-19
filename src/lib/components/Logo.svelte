<script lang="ts">
	/**
	 * The OctoMeta mark: one head node (the graph) with eight arms drawn as
	 * dependency hairlines, each ending in a node (the projections). Exactly
	 * one tip takes the accent: the value that just recomputed. Ink inherits
	 * via currentColor.
	 *
	 * Below 24px renders the three-arm glyph so the mark stays legible.
	 * A parent with class `mark-hover` flashes the accent tip on hover.
	 *
	 * @prop size - rendered width/height in px (default 24)
	 */
	let { size = 24 }: { size?: number } = $props();
</script>

{#if size >= 24}
	<svg viewBox="0 0 64 64" fill="none" width={size} height={size} aria-hidden="true">
		<g stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
			<path d="M 25.62 15.24 C 18.75 16.58, 6 31.5, 6 38.5" />
			<path d="M 26.61 17.63 C 19.98 22.11, 12 38, 12 46" />
			<path d="M 28.46 19.45 C 24.10 26.16, 20 44, 20 52" />
			<path d="M 30.87 20.40 C 29.48 28.28, 28 47, 28 55" />
			<path d="M 33.13 20.40 C 34.52 28.28, 36 47, 36 55" />
			<path d="M 35.54 19.45 C 39.90 26.16, 44 44, 44 52" />
			<path d="M 37.39 17.63 C 44.02 22.11, 52 38, 52 46" />
			<path d="M 38.38 15.24 C 45.25 16.58, 58 31.5, 58 38.5" />
		</g>
		<circle cx="32" cy="14" r="7.5" fill="currentColor" />
		<circle cx="6" cy="38.5" r="2.5" fill="currentColor" />
		<circle cx="12" cy="46" r="2.5" fill="currentColor" />
		<circle cx="20" cy="52" r="2.5" fill="currentColor" />
		<circle cx="28" cy="55" r="2.5" fill="currentColor" />
		<circle cx="36" cy="55" r="2.5" fill="currentColor" />
		<circle class="tip" cx="44" cy="52" r="2.5" fill="var(--accent, #0B5FFF)" />
		<circle cx="52" cy="46" r="2.5" fill="currentColor" />
		<circle cx="58" cy="38.5" r="2.5" fill="currentColor" />
	</svg>
{:else}
	<svg viewBox="0 0 32 32" fill="none" width={size} height={size} aria-hidden="true">
		<g stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
			<path d="M 13.05 10.85 C 9.09 14.67, 6.5 18.5, 6.5 23.5" />
			<path d="M 16.00 12.10 C 16.00 17.60, 16 22, 16 27" />
			<path d="M 18.95 10.85 C 22.91 14.67, 25.5 18.5, 25.5 23.5" />
		</g>
		<circle cx="16" cy="8" r="4.6" fill="currentColor" />
		<circle cx="6.5" cy="23.5" r="2.1" fill="currentColor" />
		<circle cx="16" cy="27" r="2.1" fill="currentColor" />
		<circle class="tip" cx="25.5" cy="23.5" r="2.1" fill="var(--accent, #0B5FFF)" />
	</svg>
{/if}

<style>
	.tip {
		transform-box: fill-box;
		transform-origin: center;
	}
	:global(.mark-hover:hover) .tip {
		animation: tip-flash 0.7s var(--ease);
	}
	@keyframes tip-flash {
		0%,
		100% {
			transform: scale(1);
		}
		35% {
			transform: scale(1.8);
		}
	}
</style>
