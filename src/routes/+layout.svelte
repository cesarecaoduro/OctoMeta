<script lang="ts">
	import { PUBLIC_CONVEX_URL } from '$env/static/public';
	import { setupConvex } from 'convex-svelte';
	import '$lib/styles/tokens.css';
	import '$lib/styles/base.css';

	let { children } = $props();

	// Registers the Convex client in Svelte context; pages consume it with
	// useQuery/useConvexClient once backend functions exist (none yet).
	setupConvex(PUBLIC_CONVEX_URL);
</script>

{@render children()}
