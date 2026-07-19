<script lang="ts">
	import Logo from './Logo.svelte';

	/**
	 * Mark + wordmark lockup, single ink weight; the accent node in the
	 * mark carries the only color.
	 *
	 * @prop href     - link target (default "#top")
	 * @prop size     - mark size in px
	 * @prop fontSize - wordmark font-size (CSS length)
	 */
	let {
		href = '#top',
		size = 23,
		fontSize = '1.02rem'
	}: { href?: string; size?: number; fontSize?: string } = $props();
</script>

<a class="lockup orbit-hover" {href} aria-label="OctoMeta home">
	<Logo {size} />
	<span class="wm" style:font-size={fontSize}>OctoMeta</span>
</a>

<style>
	.lockup {
		display: flex;
		align-items: center;
		gap: 9px;
		text-decoration: none;
		color: var(--ink);
	}
	.wm {
		font-family: var(--font-display);
		font-weight: 600;
		letter-spacing: -0.025em;
	}
</style>
