<script lang="ts">
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';

	const session = authClient.useSession();
	let open = $state(false);
	let busy = $state(false);

	const label = $derived(
		$session.data?.user.name || $session.data?.user.email || 'Account'
	);
	const initials = $derived(
		label
			.split(/\s+/)
			.map((part) => part[0])
			.join('')
			.slice(0, 2)
			.toUpperCase()
	);

	async function signOut(): Promise<void> {
		busy = true;
		await authClient.signOut();
		await goto('/signin');
	}
</script>

<div class="user-badge">
	<button
		class="trigger"
		type="button"
		aria-label={`Account menu for ${label}`}
		aria-expanded={open}
		aria-haspopup="menu"
		onclick={() => (open = !open)}
	>
		<span aria-hidden="true">{initials || '•'}</span>
	</button>
	{#if open}
		<div class="menu" role="menu">
			<p>{label}</p>
			{#if $session.data?.user.email && $session.data.user.email !== label}
				<small>{$session.data.user.email}</small>
			{/if}
			<button role="menuitem" type="button" disabled={busy} onclick={() => void signOut()}>
				{busy ? 'Signing out…' : 'Sign out'}
			</button>
		</div>
	{/if}
</div>

<style>
	.user-badge { position: relative; }
	.trigger {
		display: grid;
		place-items: center;
		width: 38px;
		height: 38px;
		border: 1px solid var(--grey-3);
		border-radius: 50%;
		background: var(--surface);
		color: var(--ink);
		font: 600 .72rem var(--font-mono);
		cursor: pointer;
	}
	.trigger:focus-visible, .menu button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.menu {
		position: absolute;
		z-index: 70;
		top: calc(100% + 8px);
		right: 0;
		width: 220px;
		padding: var(--s2);
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-card);
		background: var(--surface);
	}
	.menu p, .menu small { display: block; margin: 0; overflow-wrap: anywhere; }
	.menu p { font-weight: 600; }
	.menu small { margin-top: 3px; color: var(--grey-2); }
	.menu button {
		width: 100%;
		min-height: 38px;
		margin-top: var(--s2);
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-chip);
		background: var(--surface);
		color: var(--ink);
		cursor: pointer;
	}
</style>
