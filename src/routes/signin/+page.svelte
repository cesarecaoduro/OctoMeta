<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { authClient } from '$lib/auth-client';
	import { AppearanceControl } from '$lib/ui';

	let mode = $state<'signin' | 'signup'>('signin');
	let email = $state('');
	let password = $state('');
	let name = $state('');
	let message = $state('');
	let busy = $state(false);

	const destination = $derived(page.url.searchParams.get('next') || '/app');

	async function submitPassword(): Promise<void> {
		busy = true;
		message = '';
		const result =
			mode === 'signup'
				? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
				: await authClient.signIn.email({ email: email.trim(), password });
		busy = false;
		if (result.error) {
			message = result.error.message ?? 'Unable to sign in.';
			return;
		}
		await goto(destination);
	}

	async function sendMagicLink(): Promise<void> {
		busy = true;
		message = '';
		const result = await authClient.signIn.magicLink({
			email: email.trim(),
			callbackURL: destination
		});
		busy = false;
		message = result.error
			? (result.error.message ?? 'Unable to send the link.')
			: 'Check your email for a secure sign-in link.';
	}

	async function continueWithGoogle(): Promise<void> {
		await authClient.signIn.social({ provider: 'google', callbackURL: destination });
	}
</script>

<svelte:head><title>Sign in — OctoMeta</title></svelte:head>

<main class="auth-shell">
	<div class="appearance"><AppearanceControl /></div>
	<section class="auth-card" aria-labelledby="auth-title">
		<p class="eyebrow">Secure workspace</p>
		<h1 id="auth-title">{mode === 'signin' ? 'Sign in' : 'Create account'}<span>.</span></h1>
		<p class="lede">Your engineering documents stay attached to your account.</p>

		<form onsubmit={(event) => { event.preventDefault(); void submitPassword(); }}>
			{#if mode === 'signup'}
				<label>Name<input bind:value={name} autocomplete="name" required /></label>
			{/if}
			<label>Email<input bind:value={email} type="email" autocomplete="email" required /></label>
			<label>
				Password
				<input
					bind:value={password}
					type="password"
					autocomplete={mode === 'signup' ? 'new-password' : 'current-password'}
					minlength="8"
					required
				/>
			</label>
			<button class="primary" type="submit" disabled={busy}>
				{busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
			</button>
		</form>

		<div class="alternatives" aria-label="Other sign-in methods">
			<button type="button" onclick={() => void sendMagicLink()} disabled={busy || !email}>
				Email me a magic link
			</button>
			<button type="button" onclick={() => void continueWithGoogle()} disabled={busy}>
				Continue with Google
			</button>
		</div>

		{#if message}<p class="message" aria-live="polite">{message}</p>{/if}

		<button
			class="mode"
			type="button"
			onclick={() => {
				mode = mode === 'signin' ? 'signup' : 'signin';
				message = '';
			}}
		>
			{mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
		</button>
	</section>
</main>

<style>
	.auth-shell {
		position: relative;
		min-height: 100dvh;
		display: grid;
		place-items: center;
		padding: var(--s3);
		background: var(--paper);
	}
	.appearance { position: absolute; top: max(var(--s2), env(safe-area-inset-top)); right: max(var(--s2), env(safe-area-inset-right)); }
	.auth-card {
		width: min(100%, 430px);
		padding: var(--s4);
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-card);
		background: var(--material);
		box-shadow: var(--shadow-floating);
		backdrop-filter: blur(var(--material-blur));
	}
	.eyebrow {
		margin: 0 0 var(--s1);
		font: 500 var(--fs-eyebrow) var(--font-mono);
		letter-spacing: .14em;
		text-transform: uppercase;
		color: var(--grey-2);
	}
	h1 { margin: 0; font: 600 2.25rem/1.1 var(--font-display); letter-spacing: -.025em; }
	h1 span { color: var(--accent); }
	.lede { margin: var(--s2) 0 var(--s3); color: var(--grey-1); }
	form, .alternatives { display: grid; gap: var(--s2); }
	label { display: grid; gap: 6px; font-size: .9rem; font-weight: 500; }
	input, button {
		min-height: 44px;
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-chip);
		font: inherit;
	}
	input { padding: 0 12px; background: var(--surface); color: var(--ink); }
	input:focus, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
	button { padding: 0 14px; background: var(--surface); color: var(--ink); cursor: pointer; }
	button:disabled { cursor: wait; opacity: .55; }
	.primary { border-color: var(--ink); background: var(--ink); color: var(--surface); font-weight: 600; }
	.alternatives { margin-top: var(--s2); padding-top: var(--s2); border-top: 1px solid var(--grey-3); }
	.message { color: var(--grey-1); font-size: .9rem; }
	.mode { width: 100%; margin-top: var(--s1); border: 0; color: var(--accent); }
	@media (max-width: 520px) {
		.auth-shell { padding: 0; }
		.auth-card { min-height: 100dvh; border: 0; border-radius: 0; padding: calc(var(--s6) + env(safe-area-inset-top)) var(--s3) calc(var(--s3) + env(safe-area-inset-bottom)); box-shadow: none; backdrop-filter: none; }
	}
</style>
