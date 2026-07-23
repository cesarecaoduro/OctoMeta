<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { DocumentGraph, ulid } from '$lib/engine';
	import {
		createLocalWorkspaceRepository,
		createEmptyWorkbookSnapshot,
		createPersistenceActivityLog,
		serializeLocalGraph,
		usePersistence,
		type DocumentId,
		type DocumentSummary
	} from '$lib/persistence';
	import {
		buildDocumentIndex,
		resolveOwnerAccount,
		type DocumentAvailability,
		type IndexedCloudState,
		type IndexedDocumentBranch,
		type IndexedLocalState
	} from '$lib/workspace';
	import { buildSteelDemoFixture } from '$lib/persistence/fixtures';
	import { authClient } from '$lib/auth-client';

	const persistenceActivity = createPersistenceActivityLog();
	const persistence = usePersistence(persistenceActivity.observe);
	const localRepository = createLocalWorkspaceRepository({
		observe: persistenceActivity.observe
	});
	const authSession = authClient.useSession();
	const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
	type IndexDocument = Pick<
		DocumentSummary,
		'_id' | 'title' | 'stats' | 'createdAt' | 'updatedAt' | 'deletedAt'
	> & {
		kind: 'cloud' | 'local-only';
		hasLocalWorkingCopy: boolean;
		availability: DocumentAvailability;
		cloud: IndexedCloudState | null;
		local: IndexedLocalState | null;
		branches: IndexedDocumentBranch[];
	};
	type CloudIndexDocument = IndexDocument & { kind: 'cloud' };
	const isCloudDocument = (document: IndexDocument): document is CloudIndexDocument =>
		document.kind === 'cloud';

	let view = $state<'live' | 'trash'>('live');
	let cloudDocs = $state<DocumentSummary[] | null>(null);
	let liveDocs = $state<IndexDocument[] | null>(null);
	let trashDocs = $state<CloudIndexDocument[] | null>(null);
	let error = $state<string | null>(null);
	let creating = $state(false);
	let loadingDemo = $state(false);
	let search = $state('');
	let sort = $state<'updated' | 'created' | 'title-asc' | 'title-desc'>('updated');
	let selected = $state<Set<DocumentId>>(new Set());
	let renamingId = $state<DocumentId | null>(null);
	let renameValue = $state('');
	let renameError = $state('');
	let confirmingTrashId = $state<DocumentId | null>(null);
	let confirmingDiscardId = $state<DocumentId | null>(null);
	let permanentTarget = $state<
		| { kind: 'one'; document: CloudIndexDocument }
		| { kind: 'bulk'; documents: CloudIndexDocument[] }
		| { kind: 'empty'; documents: CloudIndexDocument[] }
		| null
	>(null);
	let confirmationText = $state('');
	let acting = $state(false);
	let toast = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | null = null;

	function accountId(): string {
		const id = resolveOwnerAccount($authSession.data?.user.id, !navigator.onLine);
		if (!id) throw new Error('Authenticated account is unavailable.');
		return id;
	}

	const source = $derived(view === 'live' ? liveDocs : trashDocs);
	const visible = $derived.by(() => {
		const normalized = search.trim().toLocaleLowerCase();
		const rows = [...(source ?? [])].filter(
			(document) =>
				document.title.toLocaleLowerCase().includes(normalized) ||
				document.branches.some((branch) => branch.name.toLocaleLowerCase().includes(normalized))
		);
		const byId = (left: IndexDocument, right: IndexDocument) =>
			String(left._id).localeCompare(String(right._id));
		rows.sort((left, right) => {
			if (sort === 'title-asc') return left.title.localeCompare(right.title) || byId(left, right);
			if (sort === 'title-desc') return right.title.localeCompare(left.title) || byId(left, right);
			const field = sort === 'created' ? 'createdAt' : 'updatedAt';
			return right[field] - left[field] || byId(left, right);
		});
		return rows;
	});
	const selectedDocuments = $derived(
		(source ?? []).filter(
			(document): document is CloudIndexDocument =>
				isCloudDocument(document) && selected.has(document._id)
		)
	);
	const allVisibleSelected = $derived(
		visible.some(isCloudDocument) &&
		visible
			.filter(isCloudDocument)
			.every((document) => selected.has(document._id))
	);

	function showToast(kind: 'ok' | 'err', text: string): void {
		toast = { kind, text };
		if (toastTimer !== null) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = null), 4000);
	}

	function buildLiveDocuments(
		cloudDocuments: DocumentSummary[],
		localWorkspaces: Awaited<ReturnType<typeof localRepository.listWorkspaces>>
	): IndexDocument[] {
		return buildDocumentIndex(cloudDocuments, localWorkspaces).map((document) => ({
			_id: document.documentId,
			title: document.title,
			stats: document.stats,
			createdAt: document.createdAt,
			updatedAt: document.updatedAt,
			kind: document.availability === 'local-only' ? 'local-only' : 'cloud',
			hasLocalWorkingCopy: document.local !== null,
			availability: document.availability,
			cloud: document.cloud,
			local: document.local,
			branches: document.branches
		}));
	}

	function buildTrashDocuments(documents: DocumentSummary[]): CloudIndexDocument[] {
		return documents.map((document) => ({
			...document,
			kind: 'cloud',
			hasLocalWorkingCopy: false,
			availability: 'cloud-only',
			cloud: { version: document.revision },
			local: null,
			branches: []
		}));
	}

	function retainSelected(rows: IndexDocument[]): void {
		selected = new Set([...selected].filter((id) => rows.some((document) => document._id === id)));
	}

	function applyLiveDocuments(
		cloudDocuments: DocumentSummary[],
		localWorkspaces: Awaited<ReturnType<typeof localRepository.listWorkspaces>>
	): void {
		cloudDocs = cloudDocuments;
		const rows = buildLiveDocuments(cloudDocuments, localWorkspaces);
		liveDocs = rows;
		error = null;
		if (view === 'live') retainSelected(rows);
	}

	function reportRefreshError(cause: unknown): void {
		error = cause instanceof Error ? cause.message : String(cause);
	}

	async function refreshLive(): Promise<void> {
		try {
			const localWorkspaces = await localRepository.listWorkspaces(accountId());
			if (!navigator.onLine) {
				applyLiveDocuments(cloudDocs ?? [], localWorkspaces);
				return;
			}
			const cloudDocuments = await persistence.listDocuments();
			applyLiveDocuments(cloudDocuments, localWorkspaces);
		} catch (cause) {
			reportRefreshError(cause);
		}
	}

	async function refreshLocalIndex(): Promise<void> {
		const cachedCloudDocs = cloudDocs;
		if (cachedCloudDocs === null) {
			await refreshLive();
			return;
		}
		try {
			const localWorkspaces = await localRepository.listWorkspaces(accountId());
			applyLiveDocuments(cachedCloudDocs, localWorkspaces);
		} catch (cause) {
			reportRefreshError(cause);
		}
	}

	async function refreshTrash(): Promise<void> {
		try {
			const rows = buildTrashDocuments(await persistence.listTrash());
			trashDocs = rows;
			error = null;
			if (view === 'trash') retainSelected(rows);
		} catch (cause) {
			reportRefreshError(cause);
		}
	}

	async function refreshView(target: 'live' | 'trash' = view): Promise<void> {
		if (target === 'live') await refreshLive();
		else await refreshTrash();
	}

	function changeView(next: 'live' | 'trash'): void {
		view = next;
		selected = new Set();
		renamingId = null;
		confirmingTrashId = null;
		confirmingDiscardId = null;
		search = '';
		if (next === 'live' ? liveDocs === null : trashDocs === null) void refreshView(next);
	}

	async function createDoc(): Promise<void> {
		creating = true;
		try {
			const id = ulid() as DocumentId;
			const graph = new DocumentGraph();
			await localRepository.commit({
				accountId: accountId(),
				documentId: String(id),
				workspaceId: 'main',
				expectedGeneration: 0,
				content: {
					title: 'Untitled',
					graph: serializeLocalGraph(graph),
					workbookSnapshot: createEmptyWorkbookSnapshot(
						String(id),
						'Untitled',
						graph.workbook
					)
				}
			});
			await goto(`/app/${id}`);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
			creating = false;
		}
	}

	/** Create the release fixture through the same owned create/save path as any document. */
	async function loadDemo(): Promise<void> {
		loadingDemo = true;
		try {
			const fixture = buildSteelDemoFixture();
			const id = await persistence.createDocument(fixture.title);
			await persistence.saveDocument(id, fixture.graph);
			await goto(`/app/${id}`);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
			loadingDemo = false;
		}
	}

	function toggleSelected(id: DocumentId): void {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected = next;
	}

	function toggleVisible(): void {
		const next = new Set(selected);
		const selectable = visible.filter(isCloudDocument);
		if (allVisibleSelected) selectable.forEach((document) => next.delete(document._id));
		else selectable.forEach((document) => next.add(document._id));
		selected = next;
	}

	function startRename(document: IndexDocument): void {
		renamingId = document._id;
		renameValue = document.title;
		renameError = '';
		confirmingTrashId = null;
		confirmingDiscardId = null;
	}

	async function duplicateDocument(document: IndexDocument): Promise<void> {
		if (!document.hasLocalWorkingCopy) return;
		acting = true;
		try {
			const duplicateId = ulid() as DocumentId;
			await localRepository.duplicateDocument({
				accountId: accountId(),
				sourceDocumentId: String(document._id),
				documentId: String(duplicateId),
				title: `${document.title} copy`
			});
			await refreshLocalIndex();
			showToast('ok', `Duplicated “${document.title}” on this device.`);
		} catch (cause) {
			showToast('err', `Could not duplicate: ${cause instanceof Error ? cause.message : String(cause)}`);
		} finally {
			acting = false;
		}
	}

	async function discardLocalDocument(document: IndexDocument): Promise<void> {
		if (!document.hasLocalWorkingCopy) return;
		acting = true;
		try {
			await localRepository.discardDocument(accountId(), String(document._id));
			confirmingDiscardId = null;
			await refreshLocalIndex();
			showToast('ok', `Discarded the device copy of “${document.title}”.`);
		} catch (cause) {
			showToast('err', `Could not discard: ${cause instanceof Error ? cause.message : String(cause)}`);
		} finally {
			acting = false;
		}
	}

	function showDeferredEntryPoint(action: 'save' | 'export'): void {
		showToast(
			'err',
			action === 'save'
				? 'Cloud version saving is not available yet. No cloud write was made.'
				: 'Portable export is not available yet. Your document remains stored on this device.'
		);
	}

	async function commitRename(document: IndexDocument): Promise<void> {
		if (renamingId !== document._id) return;
		const title = renameValue.trim();
		if (title.length === 0) {
			renameError = 'Title is required.';
			return;
		}
		if (title.length > 120) {
			renameError = 'Title must be 120 characters or fewer.';
			return;
		}
		renamingId = null;
		if (title === document.title) return;
		try {
			const hasLocalCopy = document.kind === 'local-only' || document.hasLocalWorkingCopy;
			if (hasLocalCopy) {
				const current = await localRepository.load(accountId(), String(document._id), 'main');
				if (!current) throw new Error('Local working copy is missing.');
				await localRepository.commit({
					accountId: accountId(),
					documentId: String(document._id),
					workspaceId: 'main',
					expectedGeneration: current.generation,
					content: { ...current.content, title }
				});
			} else {
				await persistence.renameDocument(document._id, title);
			}
			showToast('ok', `Renamed to “${title}”.`);
			if (hasLocalCopy) await refreshLocalIndex();
			else await refreshLive();
		} catch (cause) {
			showToast('err', `Could not rename: ${cause instanceof Error ? cause.message : String(cause)}`);
		}
	}

	async function moveToTrash(documents: CloudIndexDocument[]): Promise<void> {
		acting = true;
		try {
			await Promise.all(documents.map((document) => persistence.deleteDocument(document._id)));
			selected = new Set();
			confirmingTrashId = null;
			trashDocs = null;
			await refreshLive();
			showToast('ok', `${documents.length} document${documents.length === 1 ? '' : 's'} moved to trash.`);
		} catch (cause) {
			showToast('err', `Could not move to trash: ${cause instanceof Error ? cause.message : String(cause)}`);
		} finally {
			acting = false;
		}
	}

	async function restore(documents: IndexDocument[]): Promise<void> {
		const cloudDocuments = documents.filter(isCloudDocument);
		if (cloudDocuments.length === 0) return;
		acting = true;
		try {
			await Promise.all(
				cloudDocuments.map((document) => persistence.restoreDocument(document._id))
			);
			selected = new Set();
			cloudDocs = null;
			liveDocs = null;
			await refreshTrash();
			showToast(
				'ok',
				`${cloudDocuments.length} document${cloudDocuments.length === 1 ? '' : 's'} restored.`
			);
		} catch (cause) {
			showToast('err', `Could not restore: ${cause instanceof Error ? cause.message : String(cause)}`);
		} finally {
			acting = false;
		}
	}

	function expectedConfirmation(): string {
		if (permanentTarget?.kind === 'one') return permanentTarget.document.title;
		if (permanentTarget?.kind === 'bulk') return `DELETE ${permanentTarget.documents.length}`;
		return 'EMPTY TRASH';
	}

	async function confirmPermanent(): Promise<void> {
		if (!permanentTarget || confirmationText !== expectedConfirmation()) return;
		const target = permanentTarget;
		const documents = target.kind === 'one' ? [target.document] : target.documents;
		acting = true;
		try {
			const count = documents.length;
			if (target.kind === 'empty') await persistence.emptyTrash();
			else {
				await Promise.all(
					documents.map((document) => persistence.deleteForever(document._id))
				);
			}
			permanentTarget = null;
			confirmationText = '';
			selected = new Set();
			await refreshTrash();
			showToast('ok', `${count} document${count === 1 ? '' : 's'} permanently deleted.`);
		} catch (cause) {
			showToast('err', `Could not delete: ${cause instanceof Error ? cause.message : String(cause)}`);
		} finally {
			acting = false;
		}
	}

	function openPermanent(
		target: NonNullable<typeof permanentTarget>
	): void {
		permanentTarget = target;
		confirmationText = '';
	}

	function openPermanentDocument(document: IndexDocument): void {
		if (isCloudDocument(document)) openPermanent({ kind: 'one', document });
	}

	function fmtDate(timestamp: number): string {
		return new Date(timestamp).toLocaleDateString(undefined, {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
	}

	function fmtBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		return `${(bytes / 1024).toFixed(bytes < 102_400 ? 1 : 0)} KiB`;
	}

	function daysLeft(document: IndexDocument): number {
		if (!isCloudDocument(document)) return 30;
		if (document.deletedAt === undefined) return 30;
		return Math.max(0, Math.ceil((document.deletedAt + RETENTION_MS - Date.now()) / 86_400_000));
	}

	onMount(() => {
		Object.assign(window as object, {
			__documentIndex: {
				persistenceActivity: () => persistenceActivity.snapshot(),
				clearPersistenceActivity: () => persistenceActivity.clear()
			}
		});
		void refreshLive();
	});
	onDestroy(() => {
		if (toastTimer !== null) clearTimeout(toastTimer);
		localRepository.close();
	});
</script>

<svelte:head>
	<title>{view === 'live' ? 'Documents' : 'Trash'} · OctoMeta</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="wrap documents">
	<div class="heading">
		<div>
			<p class="eyebrow">Engineering workspace</p>
			<h1>{view === 'live' ? 'Documents' : 'Trash'}<span>.</span></h1>
		</div>
		{#if view === 'live'}
			<div class="create-actions">
				<button
					class="secondary"
					data-testid="load-demo"
					disabled={creating || loadingDemo}
					onclick={() => void loadDemo()}
				>
					{loadingDemo ? 'Loading demo…' : 'Load demo'}
				</button>
				<button
					class="primary"
					data-testid="new-doc"
					disabled={creating || loadingDemo}
					onclick={() => void createDoc()}
				>
					{creating ? 'Creating…' : 'New document'}
				</button>
			</div>
		{:else if (trashDocs?.length ?? 0) > 0}
			<button
				class="danger-action"
				disabled={acting}
				onclick={() => openPermanent({ kind: 'empty', documents: trashDocs ?? [] })}
			>Empty trash</button>
		{/if}
	</div>

	<div class="view-tabs" role="tablist" aria-label="Document state">
		<button
			role="tab"
			aria-selected={view === 'live'}
			disabled={acting}
			onclick={() => changeView('live')}
		>
			Live <span>{liveDocs?.length ?? '—'}</span>
		</button>
		<button
			role="tab"
			aria-selected={view === 'trash'}
			disabled={acting}
			onclick={() => changeView('trash')}
		>
			Trash <span>{trashDocs?.length ?? '—'}</span>
		</button>
	</div>

	<div class="filters">
		<label>
			<span class="visually-hidden">Search document titles</span>
			<input bind:value={search} type="search" placeholder="Search titles…" />
		</label>
		<label>
			<span class="visually-hidden">Sort documents</span>
			<select bind:value={sort}>
				<option value="updated">Recently updated</option>
				<option value="created">Recently created</option>
				<option value="title-asc">Title A–Z</option>
				<option value="title-desc">Title Z–A</option>
			</select>
		</label>
		{#if search}
			<button class="quiet" onclick={() => (search = '')}>Clear</button>
		{/if}
	</div>

	{#if selected.size > 0}
		<div class="bulk" role="region" aria-label="Selected document actions">
			<strong>{selected.size} selected</strong>
			{#if view === 'live'}
				<button disabled={acting} onclick={() => void moveToTrash(selectedDocuments)}>Move to trash</button>
			{:else}
				<button disabled={acting} onclick={() => void restore(selectedDocuments)}>Restore</button>
				<button
					class="danger-action"
					disabled={acting}
					onclick={() => openPermanent({ kind: 'bulk', documents: selectedDocuments })}
				>Permanently delete</button>
			{/if}
			<button class="quiet" onclick={() => (selected = new Set())}>Clear selection</button>
		</div>
	{/if}

	{#if error}
		<div class="notice error" role="alert">
			<p>{error}</p>
			<button onclick={() => void refreshView()}>Retry</button>
		</div>
	{:else if source === null}
		<p class="mono muted">Loading…</p>
	{:else if source.length === 0}
		<section class="empty" data-testid="empty">
			<h2>{view === 'live' ? 'No documents yet' : 'Trash is empty'}</h2>
			<p>{view === 'live' ? 'Create a document to begin a calculation.' : 'Deleted documents stay here for 30 days.'}</p>
		</section>
	{:else}
		<div class="select-row">
			<label>
				<input
					type="checkbox"
					checked={allVisibleSelected}
					onchange={toggleVisible}
					aria-label="Select all visible documents"
				/>
				Select all visible
			</label>
			<span>{visible.length} result{visible.length === 1 ? '' : 's'}</span>
		</div>
		{#if visible.length === 0}
			<section class="empty"><h2>No matching titles</h2><button class="quiet" onclick={() => (search = '')}>Clear search</button></section>
		{:else}
			<ul class="list" data-testid="doc-list">
				{#each visible as document (document._id)}
					<li class="row" data-testid="doc-row" data-title={document.title}>
						{#if document.kind === 'local-only'}
							<span class="select" aria-hidden="true"></span>
						{:else}
							<input
								class="select"
								type="checkbox"
								checked={selected.has(document._id)}
								onchange={() => toggleSelected(document._id)}
								aria-label={`Select ${document.title}`}
							/>
						{/if}
						<div class="document-main">
							{#if renamingId === document._id}
								<input
									class="rename"
									data-testid="rename-input"
									bind:value={renameValue}
									maxlength="120"
									aria-label="Document title"
									aria-invalid={renameError ? 'true' : undefined}
									aria-describedby={renameError ? `rename-error-${document._id}` : undefined}
									onkeydown={(event) => {
										if (event.key === 'Enter') void commitRename(document);
										if (event.key === 'Escape') {
											renamingId = null;
											renameError = '';
										}
									}}
									onblur={() => void commitRename(document)}
								/>
								{#if renameError}<p class="field-error" id={`rename-error-${document._id}`} role="alert">{renameError}</p>{/if}
							{:else if view === 'live'}
								<a class="title" data-testid="doc-link" href={`/app/${document._id}`}>{document.title}</a>
							{:else}
								<strong class="title">{document.title}</strong>
							{/if}
							<p class="stats mono">
								{document.stats.blocks} blocks · {document.stats.tabs} tabs · {document.stats.nodes} nodes · {fmtBytes(document.stats.bytes)}
							</p>
							{#if view === 'live'}
								<p class="storage-status mono" data-testid="storage-status">
									{#if document.availability === 'local-only'}
										<strong>On this device</strong> · No cloud version
					{:else if document.availability === 'cloud-backed'}
						<strong>On this device</strong> · {document.local?.baseVersion === undefined ? 'Base unavailable' : `Base v${document.local.baseVersion}`} · {document.local?.hasChanges === null ? 'Change state unavailable' : document.local?.hasChanges ? 'Local changes' : 'No local changes'}
									{:else}
										<strong>Cloud only</strong> · Not downloaded to this device
									{/if}
								</p>
								{#if document.branches.length > 0}
									<ul class="branches" aria-label={`Local branches for ${document.title}`}>
										{#each document.branches as branch (branch.workspaceId)}
											<li>
												<span class="branch-line" aria-hidden="true"></span>
								<span><strong>{branch.name}</strong> · On this device{branch.baseVersion !== undefined ? ` · Base v${branch.baseVersion}` : ' · Base unavailable'} · {branch.hasChanges === null ? 'Change state unavailable' : branch.hasChanges ? 'Local changes' : 'No local changes'}</span>
											</li>
										{/each}
									</ul>
								{/if}
							{/if}
						</div>
						<div class="dates mono">
							<span>Updated {fmtDate(document.updatedAt)}</span>
							{#if view === 'trash'}<span>{daysLeft(document)} days left</span>{/if}
						</div>
						<div class="actions">
							{#if view === 'live'}
								<button data-testid="rename" onclick={() => startRename(document)}>Rename</button>
								{#if document.hasLocalWorkingCopy}
									<button data-testid="export-entry" onclick={() => showDeferredEntryPoint('export')}>Export</button>
									<button data-testid="save-entry" onclick={() => showDeferredEntryPoint('save')}>Save new version</button>
									<button data-testid="duplicate" disabled={acting} onclick={() => void duplicateDocument(document)}>Duplicate</button>
									{#if confirmingDiscardId === document._id}
										<button class="danger-action" data-testid="confirm-discard" disabled={acting} onclick={() => void discardLocalDocument(document)}>Confirm discard</button>
									{:else}
										<button data-testid="discard" onclick={() => (confirmingDiscardId = document._id)}>Discard</button>
									{/if}
								{/if}
								{#if isCloudDocument(document) && confirmingTrashId === document._id}
									<button class="danger-action" onclick={() => void moveToTrash([document])}>Confirm trash</button>
								{:else if isCloudDocument(document)}
									<button data-testid="delete" onclick={() => (confirmingTrashId = document._id)}>Trash</button>
								{/if}
							{:else}
								<button onclick={() => void restore([document])}>Restore</button>
								<button class="danger-action" onclick={() => openPermanentDocument(document)}>Delete forever</button>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}

	{#if permanentTarget}
		<div class="dialog-backdrop" role="presentation">
			<div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description">
				<h2 id="delete-title">Permanently delete?</h2>
				<p id="delete-description">This removes the document content and files and cannot be undone.</p>
				<label>
					Type <strong>{expectedConfirmation()}</strong> to confirm
					<input bind:value={confirmationText} autocomplete="off" />
				</label>
				<div class="dialog-actions">
					<button onclick={() => (permanentTarget = null)}>Cancel</button>
					<button
						class="danger-action"
						disabled={acting || confirmationText !== expectedConfirmation()}
						onclick={() => void confirmPermanent()}
					>{acting ? 'Deleting…' : 'Delete permanently'}</button>
				</div>
			</div>
		</div>
	{/if}

	{#if toast}
		<div class="toast" class:err-toast={toast.kind === 'err'} role="status" data-testid="toast">{toast.text}</div>
	{/if}
</main>

<style>
	.documents { max-width: 1120px; padding-top: var(--s5); padding-bottom: var(--s6); }
	.heading { display: flex; justify-content: space-between; align-items: end; gap: var(--s3); }
	.create-actions { display: flex; gap: var(--s1); }
	.eyebrow { margin: 0 0 5px; font: 500 var(--fs-eyebrow) var(--font-mono); letter-spacing: .14em; text-transform: uppercase; color: var(--grey-2); }
	h1 { margin: 0; font: 600 clamp(2.3rem, 5vw, 4rem)/1 var(--font-display); letter-spacing: -.045em; }
	h1 span { color: var(--accent); }
	button, input, select { min-height: 38px; border: 1px solid var(--grey-3); border-radius: var(--radius-chip); background: var(--surface); color: var(--ink); font: inherit; }
	button { padding: 0 12px; cursor: pointer; }
	button:disabled { cursor: wait; opacity: .5; }
	button:focus-visible, input:focus, select:focus { outline: 2px solid var(--accent); outline-offset: 2px; }
	.primary { min-height: 44px; border-color: var(--ink); background: var(--ink); color: var(--surface); font-weight: 650; }
	.danger-action { color: var(--error); border-color: var(--error); }
	.quiet { border-color: transparent; background: transparent; color: var(--grey-1); }
	.view-tabs { display: flex; gap: var(--s1); margin-top: var(--s4); border-bottom: 1px solid var(--grey-3); }
	.view-tabs button { border: 0; border-bottom: 2px solid transparent; border-radius: 0; background: transparent; }
	.view-tabs button[aria-selected="true"] { border-bottom-color: var(--accent); color: var(--accent); }
	.view-tabs span { margin-left: 5px; color: var(--grey-2); font: var(--fs-caption) var(--font-mono); }
	.filters { display: flex; gap: var(--s1); align-items: center; padding: var(--s2) 0; }
	.filters label:first-child { flex: 1; }
	.filters input { width: 100%; box-sizing: border-box; padding: 0 12px; }
	.filters select { padding: 0 30px 0 10px; }
	.bulk, .select-row { display: flex; align-items: center; gap: var(--s1); padding: var(--s1) var(--s2); border: 1px solid var(--grey-3); background: var(--surface); }
	.bulk { border-radius: var(--radius-card); }
	.bulk strong { margin-right: auto; }
	.select-row { justify-content: space-between; border-width: 0 0 1px; background: transparent; color: var(--grey-1); font-size: .8rem; }
	.select-row label { display: flex; align-items: center; gap: 7px; }
	.select-row input, .select { min-height: auto; width: 17px; height: 17px; }
	.list { list-style: none; margin: 0; padding: 0; }
	.row { display: grid; grid-template-columns: 22px minmax(220px, 1fr) auto auto; align-items: center; gap: var(--s2); padding: var(--s2) 0; border-bottom: 1px solid var(--grey-3); }
	.document-main { min-width: 0; }
	.title { display: block; overflow: hidden; text-overflow: ellipsis; color: var(--ink); font-size: 1rem; font-weight: 620; text-decoration: none; white-space: nowrap; }
	a.title:hover { color: var(--accent); }
	.stats { margin: 5px 0 0; color: var(--grey-2); font-size: var(--fs-caption); }
	.dates { display: grid; gap: 4px; color: var(--grey-2); font-size: var(--fs-caption); text-align: right; }
	.actions { display: flex; flex-wrap: wrap; gap: 5px; justify-content: flex-end; max-width: 390px; }
	.actions button { min-height: 34px; font-size: .78rem; }
	.storage-status { margin: var(--s1) 0 0; color: var(--grey-1); font-size: var(--fs-caption); }
	.storage-status strong { color: var(--ink); font-weight: 600; }
	.branches { display: grid; gap: var(--s1); margin: var(--s1) 0 0; padding: 0; list-style: none; color: var(--grey-1); font: var(--fs-caption) var(--font-mono); }
	.branches li { display: flex; align-items: center; gap: var(--s1); }
	.branch-line { width: 18px; height: 10px; border-bottom: 1px solid var(--grey-3); border-left: 1px solid var(--grey-3); }
	.rename { width: 100%; box-sizing: border-box; padding: 0 10px; font-weight: 600; }
	.field-error { margin: 4px 0 0; color: var(--error); font-size: .78rem; }
	.empty, .notice { margin-top: var(--s3); padding: var(--s5) var(--s3); border: 1px dashed var(--grey-3); border-radius: var(--radius-card); text-align: center; }
	.empty h2 { margin: 0; font: 600 1.3rem var(--font-display); }
	.empty p { color: var(--grey-1); }
	.notice.error { color: var(--error); border-style: solid; background: var(--error-dim); }
	.muted { color: var(--grey-1); }
	.dialog-backdrop { position: fixed; z-index: 90; inset: 0; display: grid; place-items: center; padding: var(--s2); background: rgba(11, 11, 12, .38); }
	.dialog { width: min(100%, 480px); padding: var(--s3); border: 1px solid var(--grey-3); border-radius: var(--radius-card); background: var(--surface); }
	.dialog h2 { margin: 0; font: 600 1.45rem var(--font-display); }
	.dialog p { color: var(--grey-1); }
	.dialog label { display: grid; gap: 7px; font-size: .88rem; }
	.dialog input { padding: 0 10px; }
	.dialog-actions { display: flex; justify-content: flex-end; gap: var(--s1); margin-top: var(--s3); }
	.toast { position: fixed; z-index: 100; bottom: var(--s4); left: 50%; transform: translateX(-50%); max-width: min(90vw, 480px); padding: 10px var(--s2); border: 1px solid var(--grey-3); border-radius: var(--radius-chip); background: var(--surface); }
	.toast.err-toast { color: var(--error); border-color: var(--error); background: var(--error-dim); }
	@media (max-width: 780px) {
		.documents { padding-top: var(--s3); }
		.heading { align-items: center; }
		.create-actions { flex-direction: column-reverse; }
		.create-actions button { min-height: 44px; }
		.filters { flex-wrap: wrap; }
		.filters label:first-child { flex-basis: 100%; }
		.row { grid-template-columns: 22px minmax(0, 1fr); }
		.dates, .actions { grid-column: 2; justify-content: flex-start; text-align: left; }
		.actions button, .bulk button, .view-tabs button { min-height: 44px; }
		.bulk { flex-wrap: wrap; }
		.bulk strong { flex-basis: 100%; }
	}
</style>
