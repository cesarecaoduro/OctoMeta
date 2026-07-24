<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import Logo from '$lib/components/Logo.svelte';
	import UserBadge from '$lib/components/UserBadge.svelte';
	import { AppearanceControl } from '$lib/ui';
	import { authClient } from '$lib/auth-client';
	import { rememberOwnerAccount, rememberedOwnerAccount } from '$lib/workspace';
	import AppShellSkeleton from './AppShellSkeleton.svelte';

	let { children } = $props();
	const auth = useAuth();
	const authSession = authClient.useSession();
	let online = $state(true);
	let offlineOwner = $state<string | null>(null);
	let clientReady = $state(false);
	const canOpenOffline = $derived(!online && offlineOwner !== null);

	$effect(() => {
		const accountId = $authSession.data?.user.id;
		if (!accountId) return;
		rememberOwnerAccount(accountId);
		offlineOwner = accountId;
	});

	$effect(() => {
		const routeUrl = page.url.href;
		if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
		void navigator.serviceWorker.ready.then((registration) => {
			registration.active?.postMessage({ type: 'cache-owner-route', url: routeUrl });
		});
	});

	onMount(() => {
		online = navigator.onLine;
		offlineOwner = rememberedOwnerAccount();
		clientReady = true;
		const update = (): void => {
			online = navigator.onLine;
		};
		window.addEventListener('online', update);
		window.addEventListener('offline', update);
		return () => {
			window.removeEventListener('online', update);
			window.removeEventListener('offline', update);
		};
	});
</script>

{#if page.route.id !== '/app/[docId]'}
	<header class="app-header">
		<a class="brand" href="/app" aria-label="OctoMeta documents">
			<Logo size={26} />
			<span>OctoMeta</span>
		</a>
		<nav aria-label="Workspace">
			<a href="/app">Documents</a>
		</nav>
		<span class="grow"></span>
		<AppearanceControl />
		<UserBadge />
	</header>
{/if}

{#if clientReady && (auth.isAuthenticated || canOpenOffline)}
	{@render children()}
{:else if !clientReady || auth.isLoading}
	<AppShellSkeleton documentRoute={page.route.id === '/app/[docId]'} />
{:else}
	<main class="auth-state">
		<p role="alert">Your session has expired. <a href="/signin">Sign in again</a>.</p>
	</main>
{/if}

<style>
	.app-header {
		position: relative;
		z-index: 60;
		display: flex;
		align-items: center;
		gap: var(--s3);
		min-height: 58px;
		padding: 0 max(var(--s2), calc((100vw - 1180px) / 2));
		border-bottom: 1px solid var(--grey-3);
		background: var(--material);
		backdrop-filter: blur(var(--material-blur));
	}
	.brand { display: inline-flex; align-items: center; gap: 8px; color: var(--ink); text-decoration: none; font-weight: 650; }
	nav a { color: var(--grey-1); font-size: .88rem; text-decoration: none; }
	nav a:hover { color: var(--accent); }
	.grow { flex: 1; }
	.auth-state {
		max-width: 1180px;
		margin: 0 auto;
		padding: var(--s4) var(--s2);
		color: var(--grey-1);
	}
	.auth-state a { color: var(--accent-2); }
	@media (max-width: 640px) {
		.brand span { display: none; }
		.app-header { gap: var(--s1); padding-inline: var(--s2); }
	}
</style>
