<!--
	V1-3-1: standalone sheet page. Two Univer sheet instances (sheet-a, sheet-b)
	bound to ONE DocumentGraph through the adapter: cell edits become graph
	mutations, settled values paint back into cells, and published dotted names
	(beam.span) resolve across sheets through the graph, never through Univer's
	formula engine. Document-canvas hosting is V1-5-2; this page is the
	adapter's proving ground and e2e surface.
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import {
		attachSheetAdapter,
		createGraphSession,
		formatCellDisplay,
		nodeForCell,
		type SheetAdapter
	} from '$lib/adapters/univer';
	import { printFormula } from '$lib/engine';

	const session = createGraphSession({ docId: 'sheet-playground' });

	let containerA: HTMLDivElement;
	let containerB: HTMLDivElement;
	let adapterA: SheetAdapter | null = null;
	let adapterB: SheetAdapter | null = null;
	let status = $state('mounting');

	const BLOCK: Record<'a' | 'b', string> = { a: 'sheet-a', b: 'sheet-b' };

	function adapterFor(sheet: 'a' | 'b'): SheetAdapter | null {
		return sheet === 'a' ? adapterA : adapterB;
	}

	async function mountSheets() {
		adapterA = await attachSheetAdapter({
			session,
			blockId: BLOCK.a,
			container: containerA,
			name: 'Sheet A'
		});
		adapterB = await attachSheetAdapter({
			session,
			blockId: BLOCK.b,
			container: containerB,
			name: 'Sheet B'
		});
	}

	/**
	 * Snapshot regression path: serialize both workbooks (dispose flushes into
	 * the adapter sheet store), tear the Univer instances down completely, then
	 * remount from the snapshots. The graph survives untouched and repaints
	 * every bound cell on attach.
	 */
	async function restore() {
		status = 'restoring';
		adapterA?.dispose();
		adapterB?.dispose();
		adapterA = null;
		adapterB = null;
		await mountSheets();
		status = 'restored';
	}

	onMount(() => {
		void mountSheets().then(() => (status = 'ready'));
		// e2e hooks: deterministic cell/name access through the adapter facade.
		Object.assign(window as object, {
			__sheet: {
				isReady: () => adapterA !== null && adapterB !== null,
				status: () => status,
				getCell: (s: 'a' | 'b', a1: string) => adapterFor(s)?.getCell(a1) ?? null,
				getRawCell: (s: 'a' | 'b', a1: string) => adapterFor(s)?.getRawCell(a1) ?? null,
				setCell: (s: 'a' | 'b', a1: string, input: number | string | boolean) =>
					adapterFor(s)?.setCellText(a1, input),
				publish: (s: 'a' | 'b', a1: string, name: string) =>
					adapterFor(s)?.publishName(a1, name),
				rename: (oldName: string, newName: string) =>
					(adapterA?.renameName(oldName, newName) || adapterB?.renameName(oldName, newName)) ??
					false,
				deleteName: (name: string) =>
					(adapterA?.deleteName(name) || adapterB?.deleteName(name)) ?? false,
				formulaOf: (s: 'a' | 'b', a1: string) => {
					const node = nodeForCell(session, BLOCK[s], a1);
					return node?.formula ? printFormula(node.formula) : null;
				},
				graphDisplay: (s: 'a' | 'b', a1: string) => {
					const node = nodeForCell(session, BLOCK[s], a1);
					return node ? formatCellDisplay(node.value) : null;
				},
				restore: () => restore()
			}
		});
	});

	onDestroy(() => {
		adapterA?.dispose();
		adapterB?.dispose();
		adapterA = null;
		adapterB = null;
	});
</script>

<svelte:head>
	<title>sheet · octometa</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main>
	<p class="eyebrow">V1-3-1 · UNIVER ADAPTER</p>
	<h1>Two sheets, one graph</h1>
	<p class="sub">
		Publish a name on sheet A, reference it from sheet B: the dependency graph computes,
		the grids display.
	</p>

	<div class="toolbar">
		<button data-testid="restore" onclick={() => void restore()}>Serialize and restore</button>
		<span class="mono" data-testid="status">{status}</span>
	</div>

	<section class="sheets">
		<div>
			<p class="mono label">sheet-a</p>
			<div class="sheet" data-sheet="a" bind:this={containerA}></div>
		</div>
		<div>
			<p class="mono label">sheet-b</p>
			<div class="sheet" data-sheet="b" bind:this={containerB}></div>
		</div>
	</section>
</main>

<style>
	main {
		max-width: var(--max);
		margin: 0 auto;
		padding: var(--s4) var(--s3) var(--s6);
	}
	h1 {
		font-family: var(--font-display);
		font-size: var(--fs-h2);
		letter-spacing: -0.025em;
		margin: var(--s1) 0 var(--s1);
	}
	.sub {
		color: var(--grey-1);
		margin: 0 0 var(--s3);
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: var(--s1);
		margin-bottom: var(--s2);
	}
	button {
		font: 500 0.85rem var(--font-body);
		padding: 6px 12px;
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-chip);
		background: var(--surface);
		cursor: pointer;
	}
	.mono {
		font-family: var(--font-mono);
		font-size: var(--fs-caption);
		color: var(--grey-1);
	}
	.label {
		margin: 0 0 var(--s1);
		color: var(--grey-2);
	}
	.sheets {
		display: grid;
		gap: var(--s3);
	}
	.sheet {
		height: 340px;
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-panel);
		overflow: hidden;
		background: var(--surface);
	}
</style>
