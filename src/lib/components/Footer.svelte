<script lang="ts">
	import Lockup from './Lockup.svelte';
</script>

<footer>
	<div class="wrap foot">
		<Lockup size={22} fontSize="0.95rem" />
		<ul class="links">
			<li><a href="#graph">Product</a></li>
			<li><a href="#geometry">Geometry</a></li>
			<li><a href="#waitlist">Docs (soon)</a></li>
			<li><a href="mailto:hello@octometa.app">Contact</a></li>
		</ul>
		<span class="fine">The living engineering document · © 2026 OctoMeta</span>
	</div>
</footer>

<style>
	footer {
		border-top: 1px solid var(--grey-3);
		padding: var(--s4) 0 var(--s5);
		margin-top: var(--s5);
	}
	.foot {
		display: flex;
		justify-content: space-between;
		gap: var(--s3);
		flex-wrap: wrap;
		align-items: center;
	}
	.links {
		display: flex;
		gap: var(--s3);
		list-style: none;
	}
	.foot a {
		font-size: 0.85rem;
		color: var(--grey-1);
		text-decoration: none;
	}
	.foot a:hover {
		color: var(--ink);
	}
	.fine {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--grey-2);
	}
</style>
