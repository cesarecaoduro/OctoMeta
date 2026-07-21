<script lang="ts">
	import Logo from './Logo.svelte';
	import { useWaitlist } from '$lib/persistence';

	/**
	 * Collects one canonical early-access signup and optionally captures team
	 * context. The persistence boundary remains `waitlist.join`.
	 */
	const waitlist = useWaitlist();

	let email = $state('');
	let name = $state('');
	let role = $state('');
	let firm = $state('');
	let tool = $state('');
	let consent = $state(false);
	let submitting = $state(false);
	let done = $state(false);
	let note = $state('One email when your testing invite is ready. Nothing else.');

	let formEl: HTMLFormElement | undefined = $state();
	let successEl: HTMLElement | undefined = $state();

	async function onSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!formEl?.checkValidity()) {
			const invalid = formEl?.querySelector<HTMLElement>(':invalid');
			invalid?.focus();
			formEl?.reportValidity();
			return;
		}

		submitting = true;
		note = 'Joining…';
		try {
			await waitlist.join({
				email: email.trim(),
				name: name.trim() || undefined,
				role: role || undefined,
				firm: firm || undefined,
				tool: tool || undefined,
				source: 'landing'
			});
			done = true;
			const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
			setTimeout(() => {
				successEl?.focus({ preventScroll: true });
				successEl?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
			});
		} catch {
			submitting = false;
			note = 'We could not save your signup. Check your connection and try again.';
		}
	}
</script>

<section class="waitlist" id="waitlist" aria-labelledby="waitlist-title">
	{#if !done}
		<div class="wl-grid">
			<div>
				<span class="eyebrow eyebrow-tick">Private beta</span>
				<h2 id="waitlist-title">Bring a real calculation<span class="ap">.</span></h2>
				<p class="lead">
					We are onboarding structural and civil teams who care about predictable calculation,
					traceable decisions, and deliverables they can verify.
				</p>
				<ul class="wl-points">
					<li>Test the document, workbook, units, derivations, and provenance on real work.</li>
					<li>Test formula-driven 3D geometry and IFC delivery in the private beta.</li>
					<li>Private beta is free; we ask for direct engineering feedback.</li>
				</ul>
			</div>

			<form class="wl-form" onsubmit={onSubmit} novalidate bind:this={formEl}>
				<div class="field">
					<label for="wlEmail">Work email</label>
					<input
						id="wlEmail"
						name="email"
						type="email"
						placeholder="you@practice.com…"
						required
						autocomplete="email"
						spellcheck="false"
						aria-describedby="wlNote"
						bind:value={email}
					/>
				</div>

				<details class="optional-fields">
					<summary>Tell us about your team <span>Optional</span></summary>
					<div class="optional-grid">
						<div class="field">
							<label for="wlName">Name</label>
							<input id="wlName" name="name" type="text" placeholder="Priya Sharma…" autocomplete="name" bind:value={name} />
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
							<label for="wlTool">Primary tool today</label>
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
				</details>

				<label class="wl-consent">
					<input name="consent" type="checkbox" required bind:checked={consent} />
					<span>Email me about early access and beta onboarding. Unsubscribe anytime.</span>
				</label>
				<button class="btn btn-primary" type="submit" disabled={submitting}>
					{submitting ? 'Joining…' : 'Join the private beta'}
				</button>
				<p class="wl-note" id="wlNote" aria-live="polite">{note}</p>
			</form>
		</div>
	{:else}
		<div class="wl-success" aria-live="polite" bind:this={successEl} tabindex="-1">
			<span class="mark-badge"><Logo size={22} /></span>
			<span class="eyebrow eyebrow-tick">Confirmed</span>
			<h2 id="waitlist-title">You are on the list<span class="ap">.</span></h2>
			<p>We will email you when your testing invite is ready.</p>
		</div>
	{/if}
</section>

<style>
	.waitlist {
		margin: var(--s5) 0;
		padding: var(--s5) var(--s4);
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-panel);
		background: var(--surface);
	}
	.wl-grid { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); gap: var(--s5); align-items: start; }
	.waitlist h2 { max-width: 16ch; }
	.lead { max-width: 44ch; margin-top: var(--s2); color: var(--grey-1); }
	.wl-points { display: grid; gap: 10px; margin-top: var(--s3); list-style: none; }
	.wl-points li { display: flex; gap: 10px; color: var(--grey-1); font-size: 0.88rem; }
	.wl-points li::before { content: ''; flex: none; width: 7px; height: 7px; margin-top: 7px; border-radius: 50%; background: var(--accent); }
	.wl-form { display: grid; gap: var(--s2); }
	.field { display: grid; gap: 6px; min-width: 0; }
	.field label { color: var(--grey-1); font: 500 0.7rem var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; }
	.field input, .field select {
		width: 100%;
		min-height: 48px;
		padding: 12px var(--s2);
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-card);
		background-color: var(--paper);
		color: var(--ink);
		font: 0.95rem var(--font-body);
		touch-action: manipulation;
	}
	.field input:hover, .field select:hover { border-color: var(--grey-2); }
	.field input:focus-visible, .field select:focus-visible { border-color: var(--accent); }
	.optional-fields { border-block: 1px solid var(--grey-3); }
	.optional-fields summary { display: flex; justify-content: space-between; gap: var(--s2); padding: 13px 0; color: var(--grey-1); cursor: pointer; font-size: 0.86rem; touch-action: manipulation; }
	.optional-fields summary:hover { color: var(--ink); }
	.optional-fields summary span { color: var(--grey-1); font: 0.68rem var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; }
	.optional-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s2); padding: var(--s1) 0 var(--s3); }
	.wl-consent { display: flex; align-items: flex-start; gap: 10px; color: var(--grey-1); font-size: 0.8rem; cursor: pointer; }
	.wl-consent input { flex: none; width: 20px; height: 20px; margin: 1px 0 0; accent-color: var(--accent); }
	.wl-note { min-height: 1.4em; color: var(--grey-1); font: 0.72rem var(--font-mono); }
	.wl-success { display: grid; justify-items: center; padding: var(--s3) 0; text-align: center; }
	.mark-badge { display: grid; place-items: center; width: 72px; height: 72px; margin-bottom: var(--s3); border-radius: 50%; background: var(--accent-dim); }
	.mark-badge :global(svg) { transform: scale(1.6); }
	.wl-success .eyebrow { margin-bottom: var(--s1); }
	.wl-success p { max-width: 40ch; margin-top: var(--s2); color: var(--grey-1); }

	@media (max-width: 900px) {
		.wl-grid, .optional-grid { grid-template-columns: minmax(0, 1fr); }
	}
	@media (max-width: 600px) {
		.waitlist { margin: var(--s4) 0; padding: var(--s4) var(--s3); }
	}
</style>
