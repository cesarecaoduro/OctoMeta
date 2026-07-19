<!--
	Spike index (V1-0). No navigation links point here; spikes are deleted or
	promoted explicitly at V1-0-4, never silently absorbed.
-->
<svelte:head>
	<title>OctoMeta · spikes</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main>
	<p class="eyebrow">V1-0 · de-risk spikes</p>
	<h1>Spike index</h1>
	<ul>
		<li>
			<a href="/spike/univer">/spike/univer</a>
			<span class="sub">
				V1-0-2 Univer sheet inside a TipTap NodeView · V1-0-3 Facade custom functions + spill
			</span>
		</li>
	</ul>
</main>

<style>
	main {
		max-width: var(--prose);
		margin: 0 auto;
		padding: var(--s5) var(--s3);
	}
	h1 {
		font-family: var(--font-display);
		font-size: var(--fs-h2);
		letter-spacing: -0.025em;
		margin: var(--s1) 0 var(--s4);
	}
	ul {
		list-style: none;
		padding: 0;
	}
	li {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: var(--s2) 0;
		border-top: 1px solid var(--grey-3);
	}
	a {
		font-family: var(--font-mono);
		color: var(--ink);
	}
	.sub {
		color: var(--grey-1);
		font-size: var(--fs-caption);
	}
</style>
