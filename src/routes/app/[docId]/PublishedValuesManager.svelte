<script lang="ts">
	import { ArrowUpRight, Search, X } from '@lucide/svelte';
	import {
		format,
		listPublishedValues,
		publishedValueUses,
		type PublicationMetadata
	} from '$lib/engine';
	import type {
		GraphSession,
		WorkbookAdapter,
		WorkbookSelection
	} from '$lib/adapters/univer';
	import { Icon, IconButton, type AdaptiveMode } from '$lib/ui';

	let {
		session,
		adapter,
		selection,
		mode = 'compact',
		open,
		readonly = false,
		onclose,
		onchanged,
		oninsert
	}: {
		session: GraphSession;
		adapter: WorkbookAdapter | null;
		selection: WorkbookSelection | null;
		mode?: AdaptiveMode;
		open: boolean;
		readonly?: boolean;
		onclose: () => void;
		onchanged: () => void;
		oninsert: (nodeId: string) => boolean;
	} = $props();

	let revision = $state(0);
	let query = $state('');
	let selectedId = $state<string | null>(null);
	let name = $state('');
	let label = $state('');
	let unit = $state('');
	let description = $state('');
	let error = $state('');
	let confirmingRemoval = $state(false);
	let dialogEl = $state<HTMLDivElement>();
	let returnFocus = $state<HTMLElement | null>(null);
	let wasOpen = false;

	const values = $derived.by(() => {
		void revision;
		return listPublishedValues(session.doc, query);
	});
	const selectedValue = $derived.by(() => {
		void revision;
		return selectedId ? listPublishedValues(session.doc).find((item) => item.id === selectedId) : undefined;
	});
	const uses = $derived.by(() => {
		void revision;
		return selectedId ? publishedValueUses(session.doc, selectedId) : [];
	});

	$effect(() => session.onSettle(() => (revision += 1)));
	$effect(() => {
		if (!selectedValue) return;
		name = selectedValue.name;
		label = selectedValue.label ?? '';
		unit = selectedValue.unit ?? '';
		description = selectedValue.description ?? '';
		confirmingRemoval = false;
		error = '';
	});
	$effect(() => {
		if (open && !wasOpen) {
			wasOpen = true;
			returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			queueMicrotask(() => dialogEl?.querySelector<HTMLElement>('input[type="search"]')?.focus());
			return;
		}
		if (!open && wasOpen) {
			wasOpen = false;
			const target = returnFocus;
			returnFocus = null;
			queueMicrotask(() => {
				if (target?.isConnected) target.focus();
			});
		}
	});

	function metadata(): PublicationMetadata {
		const next: PublicationMetadata = {};
		if (label.trim()) next.label = label.trim();
		if (unit.trim()) next.unit = unit.trim();
		if (description.trim()) next.description = description.trim();
		return next;
	}

	function publishSelection(): void {
		if (!adapter || !selection || readonly) return;
		const semanticName = name.trim();
		if (!semanticName) {
			error = 'Enter a unique semantic name.';
			return;
		}
		if (!adapter.publishValue(selection.sheetId, selection.a1, semanticName, metadata())) {
			error = 'That name could not be published. Use a unique dotted name such as beam.span.';
			return;
		}
		error = '';
		name = '';
		label = '';
		unit = '';
		description = '';
		onchanged();
	}

	function saveSelected(): void {
		if (!adapter || !selectedValue || readonly) return;
		const semanticName = name.trim();
		if (!semanticName) {
			error = 'Enter a unique semantic name.';
			return;
		}
		if (
			semanticName !== selectedValue.name &&
			!adapter.renameName(selectedValue.name, semanticName)
		) {
			error = 'That semantic name is already in use or is invalid.';
			return;
		}
		const updated = session.commit({
			op: 'updatePublication',
			nodeId: selectedValue.id,
			publication: metadata()
		});
		if (!updated.ok) {
			error = updated.error.message;
			return;
		}
		error = '';
		revision += 1;
		onchanged();
	}

	function selectValue(id: string, sheetId: string, cell: string): void {
		selectedId = id;
		adapter?.activateCell(sheetId, cell);
	}

	function unpublishSelected(): void {
		if (!adapter || !selectedValue || readonly) return;
		if (!adapter.deleteName(selectedValue.name)) {
			error = 'The published value could not be removed.';
			return;
		}
		selectedId = null;
		confirmingRemoval = false;
		error = '';
		onchanged();
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			if (confirmingRemoval) confirmingRemoval = false;
			else onclose();
			return;
		}
		if (event.key !== 'Tab' || !dialogEl) return;
		const focusable = Array.from(
			dialogEl.querySelectorAll<HTMLElement>(
				'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
			)
		).filter((element) => !element.hidden);
		if (focusable.length === 0) {
			event.preventDefault();
			dialogEl.focus();
			return;
		}
		const first = focusable[0];
		const last = focusable.at(-1)!;
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}
</script>

{#if open}
	<div class="backdrop" data-mode={mode} role="presentation">
		<div
			class="manager"
			role="dialog"
			aria-modal="true"
			aria-label="Published values"
			tabindex="-1"
			bind:this={dialogEl}
			onkeydown={handleKeydown}
		>
			<header>
				<div>
					<p class="eyebrow">Workbook references</p>
					<h2>Published values<span>.</span></h2>
				</div>
				<IconButton glyph={X} label="Close published values" onclick={onclose} />
			</header>

			<label class="search">
				<span class="visually-hidden">Search published values</span>
				<Icon glyph={Search} size={18} />
				<input type="search" placeholder="Search name, label, sheet, or cell" bind:value={query} />
			</label>

			<div class="layout">
				<section aria-labelledby="published-list-title">
					<h3 id="published-list-title">Available publications</h3>
					{#if values.length === 0}
						<p class="empty">
							{query
								? 'No published values match this search.'
								: 'No values are published yet. Select a workbook cell and publish it here.'}
						</p>
					{:else}
						<div class="table" role="table" aria-label="Published workbook values">
							<div class="table-head" role="row">
								<span role="columnheader">Name</span>
								<span role="columnheader">Value</span>
								<span role="columnheader">Unit</span>
								<span role="columnheader">Source</span>
							</div>
							{#each values as value (value.id)}
								<button
									type="button"
									role="row"
									class:selected={selectedId === value.id}
									onclick={() => selectValue(value.id, value.sheetId, value.cell)}
								>
									<span role="cell">
										<strong class="mono">{value.name}</strong>
										{#if value.label}<small>{value.label}</small>{/if}
									</span>
									<span class="mono" role="cell">{format(value.value)}</span>
									<span class="mono" role="cell">{value.unit ?? '—'}</span>
									<span class="mono" role="cell">{value.sheet} · {value.cell}</span>
								</button>
							{/each}
						</div>
					{/if}
				</section>

				<section class="editor-panel" aria-labelledby="publication-editor-title">
					<h3 id="publication-editor-title">
						{selectedValue ? 'Manage publication' : 'Publish selected cell'}
					</h3>
					{#if !selectedValue && !selection}
						<p class="empty">Select one workbook cell to publish its current scalar value.</p>
					{:else}
						{#if !selectedValue && selection}
							<p class="source mono">
								{session.doc.sheet(selection.sheetId)?.name} · {selection.a1}
							</p>
						{/if}
						<label>
							<span>Semantic name</span>
							<input
								class="mono"
								placeholder="beam.span"
								disabled={readonly}
								bind:value={name}
							/>
						</label>
						<label>
							<span>Label <small>optional</small></span>
							<input placeholder="Beam span" disabled={readonly} bind:value={label} />
						</label>
						<label>
							<span>Unit <small>optional</small></span>
							<input class="mono" placeholder="m" disabled={readonly} bind:value={unit} />
						</label>
						<label>
							<span>Description <small>optional</small></span>
							<textarea rows="3" disabled={readonly} bind:value={description}></textarea>
						</label>
						{#if error}<p class="error" role="alert">{error}</p>{/if}
						{#if selectedValue}
							<div class="actions">
								<button type="button" disabled={readonly} onclick={saveSelected}>Save changes</button>
								<button
									type="button"
									onclick={() => oninsert(selectedValue.id)}
								>
									<Icon glyph={ArrowUpRight} size={16} />
									Insert in Document
								</button>
							</div>
							{#if confirmingRemoval}
								<div class="removal" role="alert">
									<p>
										<strong>Unpublish {selectedValue.name}?</strong>
										Existing references will remain visible as repairable broken references.
									</p>
									{#if uses.length === 0}
										<p>This value has no current uses.</p>
									{:else}
										<p>{uses.length} {uses.length === 1 ? 'use' : 'uses'} will break:</p>
										<ul>
											{#each uses as use (use.kind + use.id)}
												<li>{use.label}</li>
											{/each}
										</ul>
									{/if}
									<div class="actions">
										<button class="danger" type="button" onclick={unpublishSelected}>Confirm unpublish</button>
										<button type="button" onclick={() => (confirmingRemoval = false)}>Cancel</button>
									</div>
								</div>
							{:else}
								<button
									class="danger secondary"
									type="button"
									disabled={readonly}
									onclick={() => (confirmingRemoval = true)}
								>Unpublish…</button>
							{/if}
						{:else}
							<button type="button" disabled={readonly || !selection} onclick={publishSelection}>
								Publish selected cell
							</button>
						{/if}
					{/if}
				</section>
			</div>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 90;
		display: grid;
		place-items: center;
		padding: var(--s3);
		background: rgba(11, 11, 12, .28);
	}
	.manager {
		width: min(960px, 100%);
		max-height: min(760px, calc(100dvh - 48px));
		overflow: auto;
		padding: var(--s3);
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-sheet);
		background: var(--material);
		box-shadow: var(--shadow-floating);
		backdrop-filter: blur(var(--material-blur));
	}
	header, .actions { display: flex; align-items: center; justify-content: space-between; gap: var(--s2); }
	.eyebrow { margin: 0 0 var(--s1); font: 500 var(--fs-eyebrow) var(--font-mono); letter-spacing: .14em; text-transform: uppercase; color: var(--grey-2); }
	h2 { margin: 0; font: 600 1.5rem var(--font-display); }
	h2 span { color: var(--accent); }
	h3 { margin: 0 0 var(--s2); font: 600 .78rem var(--font-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--grey-1); }
	.search {
		display: flex;
		align-items: center;
		gap: var(--s1);
		margin-top: var(--s3);
		padding: 0 var(--s2);
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-chip);
		background: var(--surface);
	}
	.search input { flex: 1; border: 0; }
	.layout { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(280px, 1fr); gap: var(--s3); margin-top: var(--s3); }
	section { min-width: 0; padding-top: var(--s2); border-top: 1px solid var(--grey-3); }
	.table { overflow: hidden; border: 1px solid var(--grey-3); border-radius: var(--radius-card); background: var(--surface); }
	.table-head, .table button {
		display: grid;
		grid-template-columns: minmax(140px, 1.5fr) minmax(80px, 1fr) 64px minmax(110px, 1fr);
		gap: var(--s1);
		align-items: center;
		width: 100%;
		padding: var(--s1) var(--s2);
		text-align: left;
	}
	.table-head { min-height: 36px; color: var(--grey-1); font: 600 .7rem var(--font-mono); text-transform: uppercase; }
	.table button { min-height: 52px; border-width: 1px 0 0; border-radius: 0; }
	.table button.selected { background: var(--accent-dim); box-shadow: inset 3px 0 var(--accent); }
	.table span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
	.table strong, .table small { display: block; overflow: hidden; text-overflow: ellipsis; }
	.table small { margin-top: var(--s1); color: var(--grey-1); }
	.editor-panel { display: flex; flex-direction: column; gap: var(--s2); }
	.editor-panel > label { display: grid; gap: var(--s1); color: var(--grey-1); font-size: .78rem; }
	label small { color: var(--grey-2); }
	input, textarea, button {
		min-height: 44px;
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-chip);
		background: var(--surface);
		color: var(--ink);
		padding: var(--s1) var(--s2);
		font: inherit;
	}
	textarea { resize: vertical; }
	button { cursor: pointer; }
	button:disabled { cursor: default; opacity: .45; }
	input:focus, textarea:focus, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
	.actions { justify-content: flex-start; flex-wrap: wrap; }
	.actions button { display: inline-flex; align-items: center; gap: var(--s1); }
	.danger { color: var(--error); }
	.secondary { align-self: flex-start; background: transparent; }
	.source, .empty, .error, .removal p { margin: 0; font-size: .82rem; }
	.empty { color: var(--grey-1); }
	.error { color: var(--error); }
	.removal { padding: var(--s2); border: 1px solid var(--error); border-radius: var(--radius-card); background: var(--error-dim); }
	.removal ul { margin: var(--s1) 0 var(--s2); padding-left: var(--s3); font-size: .78rem; }
	.backdrop[data-mode='compact'] { padding: 0; align-items: end; }
	.backdrop[data-mode='compact'] .manager {
		width: 100%;
		max-height: 92dvh;
		padding-bottom: calc(var(--s3) + env(safe-area-inset-bottom));
		border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
	}
	.backdrop[data-mode='compact'] .layout { grid-template-columns: 1fr; }
	@media (max-width: 720px) {
		.table-head { display: none; }
		.table button { grid-template-columns: minmax(0, 1fr) auto; }
		.table button span:nth-child(3) { display: none; }
		.table button span:last-child { grid-column: 1 / -1; color: var(--grey-1); }
	}
</style>
