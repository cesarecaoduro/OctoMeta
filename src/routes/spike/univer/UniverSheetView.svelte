<!--
	V1-0-2/V1-0-3 spike: mounts one Univer OSS sheet (preset-sheets-core) inside
	a TipTap NodeView. All Univer imports are dynamic so the page SSRs cleanly;
	the grid appears after hydration.
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { FUniver, IWorkbookData, Univer } from '@univerjs/presets';
	import { sheetStore } from './sheet-store';

	interface Props {
		sid: string;
		initialSnapshot: IWorkbookData | null;
		/** Called once the workbook is live; used by the spike page's test hooks. */
		onReady?: (api: FUniver) => void;
	}

	const { sid, initialSnapshot, onReady }: Props = $props();

	let container: HTMLDivElement;
	let univer: Univer | null = null;
	let univerAPI: FUniver | null = null;
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	/** Persist the current workbook snapshot into the module-level store. */
	function saveSnapshot() {
		const wb = univerAPI?.getActiveWorkbook();
		if (wb) sheetStore.set(sid, wb.save());
	}

	onMount(async () => {
		const [{ createUniver, LocaleType, mergeLocales }, { UniverSheetsCorePreset }, locale] =
			await Promise.all([
				import('@univerjs/presets'),
				import('@univerjs/preset-sheets-core'),
				import('@univerjs/preset-sheets-core/locales/en-US'),
				import('@univerjs/preset-sheets-core/lib/index.css')
			]);

		const created = createUniver({
			locale: LocaleType.EN_US,
			locales: { [LocaleType.EN_US]: mergeLocales(locale.default) },
			presets: [UniverSheetsCorePreset({ container })]
		});
		univer = created.univer;
		univerAPI = created.univerAPI;
		const api = created.univerAPI;

		const snapshot = sheetStore.get(sid) ?? initialSnapshot;
		api.createWorkbook(snapshot ?? { id: sid, name: 'Spike sheet' });

		// Landmine (memo): the register-function service is DI-registered only once
		// the lifecycle reaches Steady; calling getFormula().registerFunction earlier
		// throws "[redi]: Expect 1 dependency item(s)…". Wait for Steady first.
		await new Promise<void>((resolve) => {
			const disposable = api.addEvent(api.Event.LifeCycleChanged, (p) => {
				if ((p as { stage: number }).stage === api.Enum.LifecycleStages.Steady) {
					disposable.dispose();
					resolve();
				}
			});
		});

		// V1-0-3: custom functions through the Facade API.
		const formula = api.getFormula();
		formula.registerFunction('OCTO_DOUBLE', (x) => Number(x) * 2, 'Spike: doubles a number');
		formula.registerFunction(
			'OCTO_MATRIX',
			(n) => {
				// 2D array return: does it spill? (the V1-0-3 question)
				const size = Number(n);
				const rows: number[][] = [];
				for (let r = 0; r < size; r++) {
					rows.push([]);
					for (let c = 0; c < size; c++) rows[r].push(r * size + c + 1);
				}
				return rows;
			},
			'Spike: n×n matrix to test array spill'
		);
		formula.registerFunction(
			'OCTO_QTY',
			(value, unit) => `${Number(value)} ${String(unit)}`,
			'Spike: tagged quantity string, the TypedValue display candidate'
		);

		// Keep the store fresh so a block move (view destroy) can never lose more
		// than the debounce window; destroy() below flushes synchronously anyway.
		api.getActiveWorkbook()?.onCommandExecuted(() => {
			if (saveTimer) clearTimeout(saveTimer);
			saveTimer = setTimeout(saveSnapshot, 300);
		});

		onReady?.(api);
	});

	onDestroy(() => {
		if (saveTimer) clearTimeout(saveTimer);
		saveSnapshot();
		univer?.dispose();
		univer = null;
		univerAPI = null;
	});
</script>

<div class="sheet" bind:this={container}></div>

<style>
	.sheet {
		height: 360px;
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-panel);
		overflow: hidden;
	}
</style>
