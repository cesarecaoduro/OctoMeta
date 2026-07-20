<script lang="ts">
	import { PUBLIC_CONVEX_URL } from '$env/static/public';
	import { setupPersistence } from '$lib/persistence';
	import '$lib/styles/tokens.css';
	import '$lib/styles/base.css';

	let { children } = $props();

	// Registers the backend client in Svelte context; components consume it
	// through $lib/persistence helpers (never convex/convex-svelte directly).
	setupPersistence(PUBLIC_CONVEX_URL);
</script>

{@render children()}
