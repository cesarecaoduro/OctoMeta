<script lang="ts">
	/**
	 * Dimension-line section divider: 1px rule, 9px end ticks, mono tags.
	 * Engineering-drawing vernacular (DESIGN.md §4).
	 *
	 * @prop num - section number tag, e.g. "§ 01"
	 * @prop tag - section name tag, e.g. "ONE GRAPH"
	 */
	let { num, tag }: { num: string; tag: string } = $props();
</script>

<div class="dim-divider" aria-hidden="true">
	<span class="tag">{num}</span>
	<span class="line"></span>
	<span class="tag">{tag}</span>
</div>

<style>
	.dim-divider {
		display: flex;
		align-items: center;
		gap: var(--s2);
		margin: var(--s5) 0 var(--s4);
		user-select: none;
	}
	.line {
		flex: 1;
		height: 1px;
		background: var(--grey-3);
		position: relative;
	}
	.line::before,
	.line::after {
		content: '';
		position: absolute;
		top: -4px;
		width: 1px;
		height: 9px;
		background: var(--grey-2);
	}
	.line::before {
		left: 0;
	}
	.line::after {
		right: 0;
	}
	.tag {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		letter-spacing: 0.12em;
		color: var(--grey-2);
	}
	/* the § number takes the accent: dimension lines are on the accent
	   allowlist (DESIGN.md §3); the name tag stays grey */
	.tag:first-child {
		color: var(--accent);
	}
</style>
