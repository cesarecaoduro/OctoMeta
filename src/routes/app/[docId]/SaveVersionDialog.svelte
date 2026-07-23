<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { AlertTriangle, Check, CloudUpload, X } from '@lucide/svelte';
	import type {
		CloudVersionOutcome,
		CloudVersionProgress,
		CloudVersionReview
	} from '$lib/persistence';
	import { Icon, IconButton } from '$lib/ui';

	interface Props {
		review: CloudVersionReview;
		mode: 'compact' | 'regular' | 'expanded';
		online: boolean;
		progress: CloudVersionProgress | null;
		outcome: CloudVersionOutcome | null;
		onsave: (message: string) => void;
		onclose: () => void;
	}

	let { review, mode, online, progress, outcome, onsave, onclose }: Props = $props();
	let message = $state(untrack(() => review.message ?? ''));
	let panel: HTMLElement;
	const busy = $derived(
		progress?.stage === 'preparing' ||
			progress?.stage === 'assets' ||
			progress?.stage === 'version'
	);
	const blocked = $derived(review.blockers.length > 0 || !online);

	function signed(value: number): string {
		return value > 0 ? `+${value}` : String(value);
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			onclose();
			return;
		}
		if (event.key !== 'Tab') return;
		const focusable = [...panel.querySelectorAll<HTMLElement>(
			'button:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
		)];
		if (focusable.length === 0) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	onMount(() => {
		panel.querySelector<HTMLElement>('button, textarea')?.focus();
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="backdrop" data-mode={mode}>
	<div
		class="version-dialog ui-surface"
		data-surface={mode === 'compact' ? 'sheet' : 'modal'}
		data-testid="save-version-dialog"
		role="dialog"
		aria-modal="true"
		aria-labelledby="save-version-title"
		bind:this={panel}
	>
		<header>
			<div>
				<p class="eyebrow">Immutable Main history</p>
				<h2 id="save-version-title">Save version {review.nextVersion}</h2>
			</div>
			<IconButton glyph={X} label="Close version review and continue editing" onclick={onclose} />
		</header>

		{#if outcome}
			<div class="completion" role="status" data-testid="save-version-result">
				<Icon glyph={Check} size={24} state="success" />
				<div>
					<h3>
						{outcome.status === 'created'
							? `Version ${outcome.version} saved`
							: 'No new version created'}
					</h3>
					<p>
						{outcome.status === 'created'
							? outcome.dirtyAfterSave
								? 'The captured generation is in Main. Newer edits remain stored locally as unsaved changes.'
								: 'The captured generation is now the latest immutable Main version.'
							: 'This authored content already matches Main.'}
					</p>
				</div>
			</div>
			<footer>
				<button class="primary" type="button" onclick={onclose}>Done</button>
			</footer>
		{:else}
			<div class="review-grid">
				<section aria-labelledby="version-source-title">
					<h3 id="version-source-title">Version</h3>
					<dl>
						<div><dt>Proposed Main</dt><dd>Version {review.nextVersion}</dd></div>
						<div><dt>Source</dt><dd>{review.source}</dd></div>
						<div><dt>Captured generation</dt><dd>{review.capturedGeneration}</dd></div>
					</dl>
				</section>

					<section aria-labelledby="version-summary-title">
						<h3 id="version-summary-title">Change summary</h3>
						<p>
							<strong>{review.summary.generations}</strong>
							local {review.summary.generations === 1 ? 'generation' : 'generations'} since
							{review.expectedHeadNumber === 0 ? ' the empty Main' : ` Main v${review.expectedHeadNumber}`}.
						</p>
						{#if review.summary.changes}
							<p class="mono">
								{signed(review.summary.changes.blocks)} blocks ·
								{signed(review.summary.changes.nodes)} graph nodes ·
								{signed(review.summary.changes.sheets)} Workbook sheets ·
								{signed(review.summary.changes.assets)} assets
							</p>
						{:else}
							<p>
								The earlier Main totals predate change summaries; current authored totals are shown.
							</p>
						{/if}
						<p>
							Current snapshot: {review.summary.blocks} blocks, {review.summary.nodes} graph nodes,
							{review.summary.sheets} Workbook {review.summary.sheets === 1 ? 'sheet' : 'sheets'},
							and {review.summary.assets} {review.summary.assets === 1 ? 'asset' : 'assets'}.
						</p>
					</section>
			</div>

			{#if review.warnings.length > 0}
				<section class="warnings" aria-labelledby="version-warning-title">
					<h3 id="version-warning-title">
						<Icon glyph={AlertTriangle} size={18} state="warning" />
						Warnings
					</h3>
					<ul>
						{#each review.warnings as warning}
							<li>{warning.message} This does not block saving.</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if review.blockers.length > 0}
				<section class="blockers" role="alert" aria-labelledby="version-blocker-title">
					<h3 id="version-blocker-title">Resolve before saving</h3>
					<ul>
						{#each review.blockers as blocker}
							<li>{blocker.message}</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if !online}
				<p class="offline" role="status">
					Cloud version creation needs a connection. Local authoring and device storage remain
					available.
				</p>
			{/if}

			<label for="version-message">Version message <span>Optional</span></label>
			<textarea
				id="version-message"
				bind:value={message}
				maxlength="500"
				rows="3"
				disabled={busy || progress?.stage === 'error'}
				placeholder="Describe this saved point in Main"
			></textarea>

			{#if progress}
				<ol class="progress" aria-label="Save version progress" aria-live="polite">
					<li class:active={progress.stage === 'preparing'}>Prepare captured generation</li>
					<li class:active={progress.stage === 'assets'}>Verify and upload assets</li>
					<li class:active={progress.stage === 'version'}>Create immutable version</li>
				</ol>
				{#if progress.stage === 'error'}
					<p class="save-error" role="alert">
						Could not save this version. Retry uses the same protected operation.
					</p>
				{/if}
			{/if}

			<footer>
				<p>{Math.round(review.byteLength / 1024)} KiB authored snapshot</p>
				<button
					class="primary"
					type="button"
					data-testid="confirm-save-version"
					disabled={blocked || busy}
					onclick={() => onsave(message)}
				>
					<Icon glyph={CloudUpload} size={18} />
					{progress?.stage === 'error'
						? `Retry version ${review.nextVersion}`
						: `Save version ${review.nextVersion}`}
				</button>
			</footer>
		{/if}
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		z-index: 100;
		inset: 0;
		display: grid;
		place-items: center;
		padding: var(--s3);
		background: color-mix(in srgb, var(--canvas) 42%, transparent);
	}
	.version-dialog {
		display: grid;
		gap: var(--s3);
		width: min(720px, 100%);
		max-height: min(780px, calc(100dvh - 2 * var(--s3)));
		overflow-y: auto;
		padding: var(--s3);
	}
	.backdrop[data-mode='compact'] {
		align-items: end;
		padding: 0;
	}
	.backdrop[data-mode='compact'] .version-dialog {
		width: 100%;
		height: 100dvh;
		max-height: 100dvh;
		box-sizing: border-box;
		padding:
			max(var(--s2), env(safe-area-inset-top))
			max(var(--s2), env(safe-area-inset-right))
			calc(var(--s2) + env(safe-area-inset-bottom))
			max(var(--s2), env(safe-area-inset-left));
		border-inline: 0;
		border-bottom: 0;
		border-radius: 0;
	}
	header,
	footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s2);
	}
	header {
		position: sticky;
		z-index: 1;
		top: calc(-1 * var(--s3));
		padding-block: var(--s1);
		background: var(--material);
	}
	.eyebrow,
	h2,
	h3,
	p {
		margin: 0;
	}
	.eyebrow {
		color: var(--text-tertiary);
		font: 500 var(--fs-caption) var(--font-mono);
		letter-spacing: .08em;
		text-transform: uppercase;
	}
	h2 {
		font: 650 1.55rem var(--font-display);
		letter-spacing: -.02em;
	}
	h3 {
		font: 650 .9rem var(--font-body);
	}
	.review-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--s2);
	}
	.review-grid section,
	.warnings,
	.blockers,
	.completion {
		display: grid;
		gap: var(--s1);
		padding: var(--s2);
		border: 1px solid var(--border);
		border-radius: var(--radius-control);
		background: var(--surface);
	}
	dl {
		display: grid;
		gap: var(--s1);
		margin: 0;
	}
	dl div {
		display: flex;
		justify-content: space-between;
		gap: var(--s2);
	}
	dt {
		color: var(--text-secondary);
	}
	dd {
		margin: 0;
		font-weight: 600;
		text-align: right;
	}
	.review-grid p,
	.warnings li,
	.blockers li,
	.completion p,
	.offline,
	footer p {
		color: var(--text-secondary);
		font-size: .86rem;
		line-height: 1.45;
	}
	.warnings {
		border-color: var(--status-warning);
		background: var(--status-warning-muted);
	}
	.warnings h3,
	.completion {
		display: flex;
		align-items: flex-start;
		gap: var(--s1);
	}
	.blockers,
	.save-error {
		border-color: var(--status-error);
		background: var(--status-error-muted);
	}
	ul {
		margin: 0;
		padding-left: var(--s3);
	}
	.offline {
		padding: var(--s2);
		border: 1px solid var(--status-info);
		border-radius: var(--radius-control);
		background: var(--status-info-muted);
	}
	label {
		font-weight: 650;
	}
	label span {
		color: var(--text-tertiary);
		font-weight: 400;
	}
	textarea {
		width: 100%;
		min-height: 88px;
		box-sizing: border-box;
		resize: vertical;
		padding: var(--s2);
		border: 1px solid var(--border);
		border-radius: var(--radius-control);
		background: var(--surface);
		color: var(--text);
		font: 16px/1.4 var(--font-body);
	}
	textarea:focus {
		outline: var(--focus-ring);
		outline-offset: var(--focus-offset);
	}
	.progress {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--s1);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.progress li {
		padding: var(--s1);
		border-top: 2px solid var(--border);
		color: var(--text-tertiary);
		font-size: var(--fs-caption);
	}
	.progress li.active {
		border-color: var(--tint);
		color: var(--text);
	}
	.save-error {
		padding: var(--s1) var(--s2);
		color: var(--status-error);
	}
	.primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--s1);
		min-height: 44px;
		padding: 0 var(--s3);
		border: 1px solid var(--text);
		border-radius: var(--radius-control);
		background: var(--text);
		color: var(--canvas);
		font: 650 .88rem var(--font-body);
		cursor: pointer;
	}
	.primary:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-offset);
	}
	.primary:disabled {
		opacity: .42;
		cursor: default;
	}
	@media (max-width: 560px) {
		.review-grid,
		.progress {
			grid-template-columns: 1fr;
		}
		footer {
			align-items: stretch;
			flex-direction: column;
		}
	}
</style>
