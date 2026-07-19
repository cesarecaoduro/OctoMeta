<!--
	V1-0-2 · Spike: Univer sheet inside a TipTap NodeView.
	V1-0-3 · Spike: Facade custom functions + array spill (functions registered in
	UniverSheetView; exercised from the sheet below and from e2e/spike-univer.spec.ts).

	Proofs on this page:
	(a) SSR/hydration — this page server-renders, the grid mounts after hydration
	(b) keyboard focus enters/leaves the grid without TipTap stealing keys
	(c) sheet edits survive block move up/down
	(d) snapshot serialize → full editor teardown → restore
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { Editor, type JSONContent } from '@tiptap/core';
	import type { Node as PMNode } from '@tiptap/pm/model';
	import StarterKit from '@tiptap/starter-kit';
	import type { CellValue } from '@univerjs/presets';
	import { UniverSheet, liveSheets } from './univer-sheet-node';
	import { sheetStore } from './sheet-store';

	const SID = 'spike-sheet-1';

	const initialContent: JSONContent = {
		type: 'doc',
		content: [
			{ type: 'paragraph', content: [{ type: 'text', text: 'Prose above the sheet.' }] },
			{ type: 'univerSheet', attrs: { sid: SID, snapshot: null } },
			{ type: 'paragraph', content: [{ type: 'text', text: 'Prose below the sheet.' }] }
		]
	};

	let editorEl: HTMLDivElement;
	let editor: Editor | null = null;
	let lastSerialized: JSONContent | null = $state(null);
	let status = $state('mounting…');

	function createEditor(content: JSONContent) {
		editor = new Editor({
			element: editorEl,
			extensions: [StarterKit, UniverSheet],
			content
		});
	}

	/** First (only) univerSheet node in the doc, with its position and child index. */
	function findSheet() {
		if (!editor) return null;
		const doc = editor.state.doc;
		for (let index = 0, pos = 0; index < doc.childCount; index++) {
			const node: PMNode = doc.child(index);
			if (node.type.name === 'univerSheet') return { node, pos, index };
			pos += node.nodeSize;
		}
		return null;
	}

	/** Proof (c): move the sheet block past its neighbor without losing edits. */
	function moveSheet(dir: 'up' | 'down') {
		if (!editor) return;
		const found = findSheet();
		if (!found) return;
		const doc = editor.state.doc;
		const targetIndex = found.index + (dir === 'down' ? 1 : -1);
		if (targetIndex < 0 || targetIndex >= doc.childCount) return;
		const neighbor = doc.child(targetIndex);
		const tr = editor.state.tr;
		tr.delete(found.pos, found.pos + found.node.nodeSize);
		const insertPos = dir === 'down' ? found.pos + neighbor.nodeSize : found.pos - neighbor.nodeSize;
		tr.insert(insertPos, found.node);
		editor.view.dispatch(tr);
		status = `moved ${dir}`;
	}

	/** Proof (d) step 1: flush live snapshots into node attrs, then getJSON(). */
	function serialize(): JSONContent | null {
		if (!editor) return null;
		const found = findSheet();
		if (found) {
			const tr = editor.state.tr;
			tr.setNodeMarkup(found.pos, undefined, {
				...found.node.attrs,
				snapshot: liveSheets.get(SID)?.getActiveWorkbook()?.save() ?? found.node.attrs.snapshot
			});
			editor.view.dispatch(tr);
		}
		lastSerialized = editor.getJSON();
		status = 'serialized';
		return lastSerialized;
	}

	/** Proof (d) step 2: hard teardown, then rebuild purely from the serialized doc. */
	function restore() {
		if (!editor || !lastSerialized) return;
		editor.destroy();
		editor = null;
		sheetStore.clear(); // force rehydration from node attrs, not the live store
		liveSheets.clear();
		createEditor(lastSerialized);
		status = 'restored';
	}

	/** e2e helpers: read/write cells through the Facade so tests are deterministic. */
	function range(a1: string) {
		return liveSheets.get(SID)?.getActiveWorkbook()?.getActiveSheet()?.getRange(a1) ?? null;
	}

	onMount(() => {
		createEditor(initialContent);
		status = 'ready';
		// Spike-only test hooks for Playwright; never ship this pattern.
		Object.assign(window as object, {
			__spike: {
				/** True once the grid is live AND custom functions are registered. */
				isReady: () => liveSheets.has(SID),
				getCell: (a1: string): CellValue | null => range(a1)?.getValue() ?? null,
				setCell: (a1: string, v: number | string) => range(a1)?.setValue(v),
				setFormula: (a1: string, f: string) => range(a1)?.setValue({ f }),
				docText: () => editor?.getText() ?? '',
				serialize,
				restore,
				moveSheet
			}
		});
	});

	onDestroy(() => {
		editor?.destroy();
		editor = null;
	});
</script>

<svelte:head>
	<title>spike · univer in tiptap</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main>
	<p class="eyebrow">V1-0-2 / V1-0-3 · spike</p>
	<h1>Univer sheet inside a TipTap NodeView</h1>

	<div class="toolbar">
		<button data-testid="move-up" onclick={() => moveSheet('up')}>Move sheet up</button>
		<button data-testid="move-down" onclick={() => moveSheet('down')}>Move sheet down</button>
		<button data-testid="serialize" onclick={() => serialize()}>Serialize</button>
		<button data-testid="restore" onclick={restore} disabled={!lastSerialized}>Restore</button>
		<span class="mono" data-testid="status">{status}</span>
	</div>

	<div class="editor" bind:this={editorEl} data-testid="editor"></div>
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
		margin: var(--s1) 0 var(--s3);
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
	button:disabled {
		color: var(--grey-2);
		cursor: default;
	}
	.mono {
		font-family: var(--font-mono);
		font-size: var(--fs-caption);
		color: var(--grey-1);
	}
	.editor :global(.tiptap) {
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-panel);
		background: var(--surface);
		padding: var(--s3);
		min-height: 560px;
	}
	.editor :global(.tiptap:focus) {
		outline: none;
	}
	.editor :global(.tiptap [data-univer-sheet]) {
		margin: var(--s2) 0;
	}
</style>
