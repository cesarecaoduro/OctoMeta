<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import {
		attachWorkbookAdapter,
		type GraphSession,
		type WorkbookAdapter,
		type WorkbookSelection
	} from '$lib/adapters/univer';
	import type { SheetId, SheetMeta } from '$lib/engine';

	let {
		session,
		snapshot = null,
		readonly = false,
		expanded = $bindable(false),
		ondirty,
		onready
	}: {
		session: GraphSession;
		snapshot?: unknown;
		readonly?: boolean;
		expanded?: boolean;
		ondirty: () => void;
		onready?: (adapter: WorkbookAdapter | null) => void;
	} = $props();

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

<aside class:expanded aria-label="Attached workbook">
	<header>
		<button
			class="toggle"
			type="button"
			aria-expanded={expanded}
			aria-controls="workbook-panel"
			onclick={() => (expanded = !expanded)}
		>
			<span class="node" aria-hidden="true"></span>
			Workbook
			<span class="summary">{sheets.length} {sheets.length === 1 ? 'tab' : 'tabs'}</span>
			<span class="chevron" aria-hidden="true">{expanded ? '⌄' : '⌃'}</span>
		</button>
	</header>

	<section id="workbook-panel" aria-hidden={!expanded}>
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
					aria-label="Add workbook tab">+</button
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
					onclick={deleteActiveTab}>Delete</button
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
	.node {
		width: 8px;
		height: 8px;
		border: 2px solid var(--accent);
		border-radius: 50%;
	}
	.summary { color: var(--grey-1); font: 400 var(--fs-caption) var(--font-mono); }
	.chevron { margin-left: auto; color: var(--grey-1); }
	section {
		height: 0;
		overflow: hidden;
		visibility: hidden;
	}
	.expanded section {
		height: min(45dvh, 470px);
		visibility: visible;
	}
	.formula-line, .tab-tools {
		display: flex;
		align-items: center;
		gap: var(--s1);
		padding: 6px var(--s2);
		border-top: 1px solid var(--grey-3);
		background: var(--grey-4);
	}
	.formula-line .cell { min-width: 150px; color: var(--grey-1); font-size: .75rem; }
	.formula-line input { flex: 1; }
	input, button {
		min-height: 32px;
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
	.tab-row, .tabs, .rename { display: flex; align-items: center; gap: 4px; }
	.tabs button.active { border-color: var(--accent); color: var(--accent-2); background: var(--accent-dim); }
	.tab-row .add { font-size: 1.1rem; }
	.rename input { width: 150px; }
	.danger { color: var(--error); }
	.grid {
		height: calc(min(45dvh, 470px) - 110px);
		min-height: 230px;
		background: var(--surface);
	}
	.grid.readonly { pointer-events: none; }
	.loading, .error { position: absolute; z-index: 1; margin: var(--s2); }
	.error { color: var(--error); }
	@media (max-width: 800px) {
		.expanded {
			z-index: 80;
			top: 0;
			height: 100dvh;
		}
		.expanded section { height: calc(100dvh - 44px); }
		.formula-line { flex-wrap: wrap; }
		.formula-line .cell { width: 100%; }
		.tab-tools { align-items: stretch; flex-direction: column; overflow-x: auto; }
		.rename input { flex: 1; width: auto; }
		.grid { height: calc(100dvh - 196px); }
		.toggle, input, button { min-height: 44px; }
	}
</style>
