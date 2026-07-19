<script lang="ts">
	import Logo from './Logo.svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '../../convex/_generated/api';

	/**
	 * Waitlist signup. Submissions go to the Convex `waitlist.join` mutation,
	 * which stores the signup and queues a confirmation email through the
	 * Resend component. The client is configured in +layout.svelte.
	 */

	const client = useConvexClient();

	let email = $state('');
	let name = $state('');
	let role = $state('');
	let firm = $state('');
	let tool = $state('');
	let consent = $state(false);
	let submitting = $state(false);
	let done = $state(false);
	let note = $state('Testing invites roll out in cohorts, prioritised by role and use case.');

	let emailEl: HTMLInputElement | undefined = $state();
	let successEl: HTMLElement | undefined = $state();

	async function onSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (emailEl && !emailEl.checkValidity()) {
			emailEl.focus();
			emailEl.reportValidity();
			return;
		}
		submitting = true;
		try {
			await client.mutation(api.waitlist.join, {
				email: email.trim(),
				name: name.trim() || undefined,
				role: role || undefined,
				firm: firm || undefined,
				tool: tool || undefined,
				source: 'landing'
			});
			done = true;
			const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
			setTimeout(() =>
				successEl?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
			);
		} catch {
			submitting = false;
			note = 'Something went wrong saving your signup. Please try again.';
		}
	}
</script>

<section class="waitlist" id="waitlist">
	{#if !done}
		<div class="wl-grid">
			<div>
				<span class="eyebrow">Early access</span>
				<h2>Test the platform first.</h2>
				<p class="lead">
					We're onboarding a small group of structural and civil teams. Bring a real calc package;
					leave with a document that recalculates, verifies, and exports.
				</p>
				<ul class="wl-points">
					<li>Private beta is free; we ask only for honest feedback on real work.</li>
					<li>Founding Engineer pricing locked for beta users who continue.</li>
					<li>One email when your invite is ready. Nothing else.</li>
				</ul>
			</div>
			<form class="wl-form" onsubmit={onSubmit} novalidate>
				<div class="field">
					<label for="wlEmail">Work email *</label>
					<input
						id="wlEmail"
						name="email"
						type="email"
						placeholder="you@practice.com"
						required
						autocomplete="email"
						bind:value={email}
						bind:this={emailEl}
					/>
				</div>
				<div class="wl-row">
					<div class="field">
						<label for="wlName">Name</label>
						<input
							id="wlName"
							name="name"
							type="text"
							placeholder="Priya Sharma"
							autocomplete="name"
							bind:value={name}
						/>
					</div>
					<div class="field">
						<label for="wlRole">Role</label>
						<select id="wlRole" name="role" bind:value={role}>
							<option value="">Select…</option>
							<option>Design engineer</option>
							<option>Senior / checking engineer</option>
							<option>BIM / digital practice lead</option>
							<option>Computational designer</option>
							<option>Engineering manager</option>
							<option>Other</option>
						</select>
					</div>
				</div>
				<div class="wl-row">
					<div class="field">
						<label for="wlFirm">Firm size</label>
						<select id="wlFirm" name="firm" bind:value={firm}>
							<option value="">Select…</option>
							<option>Independent / 1–5</option>
							<option>6–50</option>
							<option>51–500</option>
							<option>500+</option>
						</select>
					</div>
					<div class="field">
						<label for="wlTool">Today you mostly use</label>
						<select id="wlTool" name="tool" bind:value={tool}>
							<option value="">Select…</option>
							<option>Excel</option>
							<option>Mathcad</option>
							<option>CalcTree / Blockpad</option>
							<option>Grasshopper / Dynamo</option>
							<option>Python / notebooks</option>
							<option>Other</option>
						</select>
					</div>
				</div>
				<label class="wl-consent">
					<input type="checkbox" required bind:checked={consent} />
					<span>
						Email me about early access and beta onboarding. No marketing lists, unsubscribe
						anytime.
					</span>
				</label>
				<button class="btn btn-primary" type="submit" disabled={submitting}>
					{submitting ? 'Joining…' : 'Join the waitlist'}
				</button>
				<p class="wl-note">{note}</p>
			</form>
		</div>
	{:else}
		<div class="wl-success" aria-live="polite" bind:this={successEl}>
			<span class="mark-badge"><Logo size={22} /></span>
			<span class="eyebrow">Confirmed</span>
			<h3>You're on the list.</h3>
			<p>A new node just entered the graph. We'll email you when your testing invite is ready.</p>
		</div>
	{/if}
</section>

<style>
	.waitlist {
		margin: var(--s5) 0;
		padding: var(--s5) var(--s4);
		border: 1px solid var(--grey-3);
		border-radius: 16px;
		background: var(--surface);
	}
	.wl-grid {
		display: grid;
		grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
		gap: var(--s5);
		align-items: start;
	}
	.waitlist h2 {
		max-width: 16ch;
	}
	.lead {
		color: var(--grey-1);
		margin-top: var(--s2);
		max-width: 44ch;
	}
	.wl-points {
		list-style: none;
		margin-top: var(--s3);
		display: grid;
		gap: 10px;
	}
	.wl-points li {
		display: flex;
		gap: 10px;
		font-size: 0.9rem;
		color: var(--grey-1);
	}
	.wl-points li::before {
		content: '';
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--accent);
		margin-top: 7px;
		flex: none;
	}
	.wl-form {
		display: grid;
		gap: var(--s2);
	}
	.field {
		display: grid;
		gap: 6px;
	}
	.field label {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		color: var(--grey-2);
		text-transform: uppercase;
	}
	.field input,
	.field select {
		font: inherit;
		font-size: 0.95rem;
		padding: 12px 16px;
		border: 1px solid var(--grey-3);
		border-radius: 10px;
		background: var(--paper);
		color: var(--ink);
		width: 100%;
	}
	.field input:focus,
	.field select:focus {
		border-color: var(--accent);
		outline: none;
	}
	.wl-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--s2);
	}
	.wl-consent {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		font-size: 0.8rem;
		color: var(--grey-2);
	}
	.wl-consent input {
		margin-top: 3px;
		accent-color: var(--accent);
	}
	.wl-note {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--grey-2);
	}
	.wl-success {
		text-align: center;
		padding: var(--s3) 0;
		display: grid;
		justify-items: center;
		animation: rise 0.7s var(--ease) both;
	}
	.wl-success .mark-badge {
		display: grid;
		place-items: center;
		width: 72px;
		height: 72px;
		border-radius: 50%;
		background: var(--accent-dim);
		color: var(--ink);
		margin-bottom: var(--s3);
	}
	.wl-success .mark-badge :global(svg) {
		transform: scale(1.6);
	}
	.wl-success .eyebrow {
		margin-bottom: var(--s1);
	}
	.wl-success h3 {
		font-size: 1.6rem;
	}
	.wl-success p {
		color: var(--grey-1);
		margin-top: var(--s2);
		max-width: 40ch;
	}
	@media (max-width: 900px) {
		.wl-grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.wl-row {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (max-width: 600px) {
		.waitlist {
			padding: var(--s4) var(--s3);
		}
	}
</style>
