<script lang="ts">
	import { PUBLIC_CONVEX_URL } from '$env/static/public';
	import { createSvelteAuthClient } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { authClient } from '$lib/auth-client';
	import { setupPersistence } from '$lib/persistence';
	import { AppearanceProvider } from '$lib/ui';
	import '$lib/styles/fonts.css';
	import '$lib/styles/tokens.css';
	import '$lib/styles/base.css';
	import '$lib/styles/primitives.css';

	let { children } = $props();

	// Registers the backend client in Svelte context; components consume it
	// through $lib/persistence helpers (never convex/convex-svelte directly).
	const convexClient = setupPersistence(PUBLIC_CONVEX_URL);
	createSvelteAuthClient({ authClient, convexClient });
</script>

<AppearanceProvider />
{@render children()}
