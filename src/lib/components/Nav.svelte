<script lang="ts">
	import Lockup from './Lockup.svelte';

	let y = $state(0);
	const scrolled = $derived(y > 8);
</script>

<svelte:window bind:scrollY={y} />

<nav class:scrolled>
	<div class="wrap nav-inner">
		<Lockup />
			<ul class="nav-links">
				<li class="hide-m"><a href="#outcomes">Product</a></li>
				<li class="hide-m"><a href="#graph">The graph</a></li>
				<li class="hide-m"><a href="#trust">Engineering trust</a></li>
				<li><a href="#waitlist" class="btn btn-primary btn-sm">Join the beta</a></li>
		</ul>
	</div>
</nav>

<style>
	nav {
		position: sticky;
		top: 0;
		z-index: 50;
		background: transparent;
		border-bottom: 1px solid transparent;
		transition:
			background var(--t-med) var(--ease),
			border-color var(--t-med) var(--ease);
	}
	nav.scrolled {
		background: color-mix(in srgb, var(--paper) 86%, transparent);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		border-bottom-color: var(--grey-3);
	}
	.nav-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 64px;
	}
	.nav-links {
		display: flex;
		gap: var(--s4);
		align-items: center;
		list-style: none;
	}
	.nav-links a:not(.btn) {
		font-size: 0.9rem;
		color: var(--grey-1);
		text-decoration: none;
		transition: color var(--t-fast);
	}
	.nav-links a:not(.btn):hover {
		color: var(--ink);
	}
	@media (max-width: 900px) {
		li.hide-m {
			display: none;
		}
	}
</style>
