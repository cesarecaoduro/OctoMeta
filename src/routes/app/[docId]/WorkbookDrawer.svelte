<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { BookOpenCheck, PanelBottomClose, Plus, Table2, Trash2 } from '@lucide/svelte';
	import {
		attachWorkbookAdapter,
		type GraphSession,
		type WorkbookAdapter,
		type WorkbookSelection
	} from '$lib/adapters/univer';
	import type { SheetId, SheetMeta } from '$lib/engine';
	import { Icon, type AdaptiveMode } from '$lib/ui';
	import PublishedValuesManager from './PublishedValuesManager.svelte';

	let {
		session,
		mode = 'compact',
		snapshot = null,
		readonly = false,
		expanded = $bindable(false),
		publishedValuesOpen = $bindable(false),
		ondirty,
		onready,
		oninsert
	}: {
		session: GraphSession;
		mode?: AdaptiveMode;
		snapshot?: unknown;
		readonly?: boolean;
		expanded?: boolean;
		publishedValuesOpen?: boolean;
		ondirty: () => void;
		onready?: (adapter: WorkbookAdapter | null) => void;
		oninsert: (nodeId: string) => boolean;
	} = $props();
	const displayed = $derived(expanded);

	let gridEl: HTMLDivElement;
	let adapter = $state<WorkbookAdapter | null>(null);
	let loading = $state(true);
	let error = $state('');
	let sheets = $state<SheetMeta[]>([]);
	let activeSheetId = $state<SheetId>('');
	let selected = $state<WorkbookSelection | null>(null);
	let formulaText = $state('');
	let renameText = $state('');
	let cleanup: Array<() => void> = [];
	let publishedValuesButton = $state<HTMLButtonElement>();

	function refreshSheets(): void {
		sheets = session.doc.workbook.sheets
			.map((sheet) => ({ ...sheet }))
			.sort((a, b) => a.position - b.position);
	}

	onMount(() => {
		let cancelled = false;
		refreshSheets();
		activeSheetId = session.doc.workbook.sheets[0].id;
		renameText = session.doc.workbook.sheets[0].name;
		void (async () => {
			try {
				const mounted = await attachWorkbookAdapter({
					session,
					container: gridEl,
					snapshot: snapshot as never,
					name: 'Workbook'
				});
				if (cancelled) {
					mounted.dispose();
					return;
				}
				adapter = mounted;
				onready?.(mounted);
				cleanup.push(
					mounted.onMutated(() => {
						if (!readonly) ondirty();
					}),
					mounted.onSelect((next) => {
						selected = next;
						activeSheetId = next.sheetId;
						formulaText = next.text;
						renameText =
							session.doc.sheet(next.sheetId)?.name ?? renameText;
					}),
					session.onSettle(() => {
						refreshSheets();
						const current = mounted.selection();
						if (current) {
							selected = current;
							formulaText = current.text;
						}
					})
				);
				loading = false;
			} catch (cause) {
				error = cause instanceof Error ? cause.message : 'Workbook failed to start.';
				loading = false;
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	onDestroy(() => {
		for (const off of cleanup) off();
		cleanup = [];
		onready?.(null);
		adapter?.dispose();
		adapter = null;
	});

	function selectSheet(sheetId: SheetId): void {
		if (!adapter?.activateSheet(sheetId)) return;
		activeSheetId = sheetId;
		renameText = session.doc.sheet(sheetId)?.name ?? '';
	}

	function addWorkbookTab(): void {
		if (readonly) return;
		const result = adapter?.addSheet();
		if (!result) return;
		if (!result.ok) {
			error = result.message;
			return;
		}
		error = '';
		activeSheetId = result.sheetId;
		renameText = session.doc.sheet(result.sheetId)?.name ?? '';
		refreshSheets();
		ondirty();
	}

	function commitTabRename(): void {
		if (!adapter || readonly) return;
		const sheetId = activeSheetId;
		const name = renameText.trim();
		const result = adapter.renameSheet(sheetId, name);
		if (!result.ok) {
			error = result.message;
			return;
		}
		renameText = session.doc.sheet(sheetId)?.name ?? name;
		error = '';
		refreshSheets();
		ondirty();
	}

	function deleteActiveTab(): void {
		if (!adapter || readonly) return;
		const result = adapter.deleteSheet(activeSheetId);
		if (!result.ok) {
			error = result.message;
			return;
		}
		error = '';
		const next = session.doc.workbook.sheets[0];
		activeSheetId = next.id;
		renameText = next.name;
		adapter.activateSheet(next.id);
		refreshSheets();
		ondirty();
	}

	function commitFormula(): void {
		if (!adapter || !selected || readonly) return;
		adapter.setCellText(selected.sheetId, selected.a1, formulaText);
		ondirty();
	}
</script>

<aside class:expanded={displayed} data-mode={mode} aria-label="Attached workbook">
	<header>
		<button
			class="toggle"
			type="button"
			aria-expanded={displayed}
			aria-controls="workbook-panel"
			onclick={() => (expanded = !expanded)}
		>
			<Icon glyph={Table2} size={18} />
			Workbook
			<span class="summary">{sheets.length} {sheets.length === 1 ? 'tab' : 'tabs'}</span>
			<span class="panel-action" aria-hidden="true">
				<Icon glyph={PanelBottomClose} size={18} />
			</span>
		</button>
	</header>

	<section id="workbook-panel" aria-hidden={!displayed}>
		<div class="formula-line">
			<span class="cell mono">{selected ? `${session.doc.sheet(selected.sheetId)?.name} · ${selected.a1}` : 'Select a cell'}</span>
			<input
				class="mono"
				aria-label="Cell value or formula"
				bind:value={formulaText}
				disabled={!selected || readonly}
				onkeydown={(event) => {
					if (event.key === 'Enter') {
						event.preventDefault();
						commitFormula();
					}
				}}
			/>
			<button type="button" disabled={!selected || readonly} onclick={commitFormula}>Apply</button>
			<button
				class="published-values"
				type="button"
				bind:this={publishedValuesButton}
				aria-expanded={publishedValuesOpen}
				onclick={() => (publishedValuesOpen = true)}
			>
				<Icon glyph={BookOpenCheck} size={18} />
				Published values
			</button>
		</div>

		<div class="tab-tools">
			<div class="tab-row">
				<div class="tabs" role="tablist" aria-label="Workbook tabs">
					{#each sheets as sheet (sheet.id)}
						<button
							type="button"
							role="tab"
							aria-selected={sheet.id === activeSheetId}
							class:active={sheet.id === activeSheetId}
							onclick={() => selectSheet(sheet.id)}
						>{sheet.name}</button>
					{/each}
				</div>
				<button
					class="add"
					type="button"
					disabled={readonly}
					onclick={addWorkbookTab}
					aria-label="Add workbook tab"><Icon glyph={Plus} size={18} /></button
				>
			</div>
			<form
				class="rename"
				onsubmit={(event) => {
					event.preventDefault();
					commitTabRename();
				}}
			>
				<input
					aria-label="Active tab name"
					bind:value={renameText}
					maxlength="64"
					disabled={readonly}
				/>
				<button type="submit" disabled={readonly}>Rename</button>
				<button
					class="danger"
					type="button"
					disabled={readonly || sheets.length === 1}
					onclick={deleteActiveTab}><Icon glyph={Trash2} size={16} /> <span>Delete</span></button
				>
			</form>
		</div>

		{#if error}<p class="error" role="alert">{error}</p>{/if}
		{#if loading}<p class="loading mono" aria-live="polite">Starting workbook…</p>{/if}
		<div
			class="grid"
			class:readonly
			bind:this={gridEl}
			data-testid="workbook-grid"
			aria-disabled={readonly}
			inert={readonly}
		></div>
	</section>
	<PublishedValuesManager
		{session}
		{adapter}
		selection={selected}
		{mode}
		open={publishedValuesOpen}
		{readonly}
		onclose={() => {
			publishedValuesOpen = false;
			queueMicrotask(() => publishedValuesButton?.focus());
		}}
		onchanged={ondirty}
		{oninsert}
	/>
</aside>

<style>
	aside {
		position: fixed;
		z-index: 30;
		left: 0;
		right: 0;
		bottom: 0;
		border-top: 1px solid var(--grey-3);
		background: var(--surface);
		box-shadow: var(--shadow-floating);
		transition: transform var(--motion-continuity) var(--ease-out);
	}
	aside:not(.expanded) {
		display: none;
	}
	header { height: 44px; }
	.toggle {
		width: 100%;
		height: 44px;
		display: flex;
		align-items: center;
		gap: var(--s1);
		padding: 0 var(--s3);
		border: 0;
		background: var(--surface);
		color: var(--ink);
		font: 600 .86rem var(--font-display);
		cursor: pointer;
	}
	.summary { color: var(--grey-1); font: 400 var(--fs-caption) var(--font-mono); }
	.panel-action {
		display: inline-flex;
		margin-left: auto;
		color: var(--grey-1);
	}
	section {
		height: 0;
		overflow: hidden;
		visibility: hidden;
	}
	.expanded section {
		height: var(--workbook-panel-height, clamp(280px, 42dvh, 440px));
		visibility: visible;
	}
	.formula-line, .tab-tools {
		display: flex;
		align-items: center;
		gap: var(--s1);
		padding: var(--s1) var(--s2);
		border-top: 1px solid var(--grey-3);
		background: var(--grey-4);
	}
	.formula-line .cell { min-width: 150px; color: var(--grey-1); font-size: .75rem; }
	.formula-line input { flex: 1; }
	.published-values { display: inline-flex; align-items: center; gap: var(--s1); white-space: nowrap; }
	input, button {
		min-height: 44px;
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-chip);
		background: var(--surface);
		color: var(--ink);
		padding: 0 10px;
	}
	input:focus, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
	button { cursor: pointer; }
	button:disabled { cursor: default; opacity: .45; }
	.tab-tools { justify-content: space-between; background: var(--surface); }
	.tab-row, .tabs, .rename { display: flex; align-items: center; gap: var(--s1); }
	.tabs button.active { border-color: var(--tint); color: var(--tint-text); background: var(--tint-muted); }
	.tab-row .add { font-size: 1.1rem; }
	.add,
	.danger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--s1);
	}
	.rename input { width: 150px; }
	.danger { color: var(--error); }
	.grid {
		height: calc(var(--workbook-panel-height, clamp(280px, 42dvh, 440px)) - 110px);
		min-height: 170px;
		background: var(--surface);
	}
	.grid.readonly { pointer-events: none; }
	.loading, .error { position: absolute; z-index: 1; margin: var(--s2); }
	.error { color: var(--error); }
	aside[data-mode='compact'].expanded {
		z-index: 80;
		top: 0;
		height: 100dvh;
		padding-bottom: env(safe-area-inset-bottom);
	}
	aside[data-mode='compact'].expanded section {
		height: calc(100dvh - 44px - env(safe-area-inset-bottom));
	}
	aside[data-mode='compact'] .formula-line {
		flex-wrap: wrap;
	}
	aside[data-mode='compact'] .formula-line .cell {
		width: 100%;
	}
	aside[data-mode='compact'] .tab-tools {
		align-items: stretch;
		flex-direction: column;
		overflow-x: auto;
	}
	aside[data-mode='compact'] .rename input {
		flex: 1;
		width: auto;
	}
	aside[data-mode='compact'] .grid {
		height: calc(100dvh - 196px);
	}
	aside[data-mode='compact'] .toggle,
	aside[data-mode='compact'] input,
	aside[data-mode='compact'] button {
		min-height: 44px;
	}
</style>
