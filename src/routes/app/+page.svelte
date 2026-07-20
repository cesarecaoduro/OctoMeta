<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { usePersistence, type DocumentSummary } from '$lib/persistence';
	import Logo from '$lib/components/Logo.svelte';

	// V1-5-1 · /app — the document list: create / open / rename / delete, all
	// through the persistence facade (never convex directly).
	const persistence = usePersistence();

	let docs = $state<DocumentSummary[] | null>(null);
	let error = $state<string | null>(null);
	let creating = $state(false);
	let renamingId = $state<string | null>(null);
	let renameValue = $state('');
	let confirmingId = $state<string | null>(null);

	/** Transient action feedback (delete/rename outcomes). */
	let toast = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | null = null;

	function showToast(kind: 'ok' | 'err', text: string): void {
		toast = { kind, text };
		if (toastTimer !== null) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = null), 4000);
	}

	async function refresh(): Promise<void> {
		try {
			docs = await persistence.listDocuments();
			error = null;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function createDoc(): Promise<void> {
		creating = true;
		try {
			const id = await persistence.createDocument('Untitled');
			await goto(`/app/${id}`);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			creating = false;
		}
	}

	function startRename(doc: DocumentSummary): void {
		renamingId = doc._id;
		renameValue = doc.title;
		confirmingId = null;
	}

	async function commitRename(doc: DocumentSummary): Promise<void> {
		const title = renameValue.trim();
		renamingId = null;
		if (title === '' || title === doc.title) return;
		try {
			await persistence.renameDocument(doc._id, title);
			showToast('ok', `Renamed to "${title}"`);
		} catch (e) {
			showToast('err', `Could not rename: ${e instanceof Error ? e.message : String(e)}`);
		}
		await refresh();
	}

	async function deleteDoc(doc: DocumentSummary): Promise<void> {
		confirmingId = null;
		let failure: string | null = null;
		try {
			await persistence.deleteDocument(doc._id);
		} catch (e) {
			failure = e instanceof Error ? e.message : String(e);
		}
		await refresh();
		if (failure) showToast('err', `Could not delete "${doc.title}": ${failure}`);
		else showToast('ok', `Deleted "${doc.title}"`);
	}

	function fmtDate(ts: number): string {
		return new Date(ts).toLocaleDateString(undefined, {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
	}

	onMount(() => {
		void refresh();
	});
</script>

<svelte:head>
	<title>Documents · OctoMeta</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="wrap">
	<header>
		<a class="home" href="/" aria-label="OctoMeta home"><Logo size={28} /></a>
		<p class="eyebrow">§ app ——— documents</p>
	</header>

	<div class="bar">
		<h1>Documents</h1>
		<button class="btn btn-primary btn-sm" data-testid="new-doc" disabled={creating} onclick={createDoc}>
			New document
		</button>
	</div>

	{#if error}
		<p class="err" role="alert">{error}</p>
	{:else if docs === null}
		<p class="mono muted">loading…</p>
	{:else if docs.length === 0}
		<p class="muted" data-testid="empty">No documents yet. Create one to start.</p>
	{:else}
		<ul class="list" data-testid="doc-list">
			{#each docs as doc (doc._id)}
				<li class="row" data-testid="doc-row" data-title={doc.title}>
					{#if renamingId === doc._id}
						<!-- svelte-ignore a11y_autofocus -->
						<input
							class="rename"
							data-testid="rename-input"
							autofocus
							bind:value={renameValue}
							onkeydown={(e) => {
								if (e.key === 'Enter') void commitRename(doc);
								if (e.key === 'Escape') renamingId = null;
							}}
							onblur={() => void commitRename(doc)}
						/>
					{:else}
						<a class="title" data-testid="doc-link" href={`/app/${doc._id}`}>{doc.title}</a>
					{/if}
					<span class="mono when">{fmtDate(doc.updatedAt)}</span>
					<span class="actions">
						<button class="ghost" data-testid="rename" onclick={() => startRename(doc)}>
							Rename
						</button>
						{#if confirmingId === doc._id}
							<button class="ghost danger" data-testid="delete-confirm" onclick={() => void deleteDoc(doc)}>
								Confirm delete
							</button>
						{:else}
							<button class="ghost" data-testid="delete" onclick={() => (confirmingId = doc._id)}>
								Delete
							</button>
						{/if}
					</span>
				</li>
			{/each}
		</ul>
	{/if}

	{#if toast}
		<div class="toast" class:err-toast={toast.kind === 'err'} role="status" data-testid="toast">
			{toast.text}
		</div>
	{/if}
</main>

<style>
	main {
		max-width: var(--prose);
		padding-top: var(--s4);
		padding-bottom: var(--s6);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--s4);
	}
	.home {
		display: inline-flex;
		color: var(--ink);
	}
	.bar {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--s2);
		margin-bottom: var(--s3);
		padding-bottom: var(--s2);
		border-bottom: 1px solid var(--grey-3);
	}
	h1 {
		font-size: var(--fs-h2);
	}
	.muted {
		color: var(--grey-1);
	}
	.list {
		list-style: none;
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--s2);
		padding: var(--s2) 0;
		border-bottom: 1px solid var(--grey-3);
	}
	.title {
		flex: 1;
		font-weight: 500;
		text-decoration: none;
	}
	.title:hover {
		color: var(--accent);
	}
	.rename {
		flex: 1;
		font: 500 var(--fs-body) var(--font-body);
		color: var(--ink);
		background: var(--surface);
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-chip);
		padding: 4px 8px;
	}
	.when {
		font-size: var(--fs-caption);
		color: var(--grey-2);
	}
	.actions {
		display: inline-flex;
		gap: var(--s1);
	}
	.ghost {
		font: 500 0.8rem var(--font-body);
		color: var(--grey-1);
		background: transparent;
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-chip);
		padding: 4px 10px;
		cursor: pointer;
		transition:
			color var(--t-fast) var(--ease),
			border-color var(--t-fast) var(--ease);
	}
	.ghost:hover {
		color: var(--ink);
		border-color: var(--ink);
	}
	.ghost.danger {
		color: var(--error);
		border-color: var(--error);
	}

	/* Action feedback — elevation is border + surface, never shadow (DESIGN.md). */
	.toast {
		position: fixed;
		bottom: var(--s4);
		left: 50%;
		transform: translateX(-50%);
		max-width: min(90vw, 480px);
		font: 500 0.85rem var(--font-body);
		color: var(--ink);
		background: var(--surface);
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-chip);
		padding: 10px var(--s2);
	}
	.toast.err-toast {
		color: var(--error);
		border-color: var(--error);
		background: var(--error-dim);
	}
</style>
