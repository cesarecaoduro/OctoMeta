<script lang="ts">
	/**
	 * The OctoMeta mark: a hairline ring with a single accent node on it:
	 * a value moving through the graph. Ring inherits ink via currentColor;
	 * the node is the one allowed use of accent.
	 *
	 * A parent with class `orbit-hover` spins the node once around the ring
	 * on hover (used by the nav lockup).
	 *
	 * @prop size - rendered width/height in px (default 24)
	 */
	let { size = 24 }: { size?: number } = $props();
</script>

<svg viewBox="0 0 32 32" fill="none" width={size} height={size} aria-hidden="true">
	<circle cx="16" cy="16" r="10.5" stroke="currentColor" stroke-width="2.5" />
	<g class="orbit">
		<circle
			cx="23.42"
			cy="8.58"
			r="3.3"
			fill="var(--accent, #0B5FFF)"
			stroke="var(--paper, #FAFAF9)"
			stroke-width="2"
		/>
	</g>
</svg>

<style>
	.orbit {
		transform-origin: 16px 16px;
	}
	:global(.orbit-hover:hover) .orbit {
		animation: orbit 0.9s var(--ease);
	}
	@keyframes orbit {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
</style>
