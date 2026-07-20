<script lang="ts">
	import {
		format,
		parseParameterInput,
		resolvePublishedTarget,
		type GraphNode
	} from '$lib/engine';
	import type { GraphSession } from '$lib/adapters/univer';

	let {
		session,
		open,
		onclose,
		onchanged,
		oninsert
	}: {
		session: GraphSession;
		open: boolean;
		onclose: () => void;
		onchanged: () => void;
		oninsert: (nodeId: string) => boolean;
	} = $props();

	let revision = $state(0);
	let errors = $state<Record<string, string>>({});
	let selectedId = $state<string | null>(null);
	let dialogEl = $state<HTMLDivElement>();

	const aliases = $derived.by(() => {
		void revision;
		const inputs: Array<{ alias: GraphNode; target: GraphNode }> = [];
		const outputs: Array<{ alias: GraphNode; target: GraphNode }> = [];
		for (const node of session.doc.nodes.values()) {
			if (node.kind !== 'namedOutput') continue;
			const resolved = resolvePublishedTarget(session.doc, node.id);
			if (!resolved) continue;
			const item = { alias: resolved.publishedNode, target: resolved.targetNode };
			(resolved.targetNode.kind === 'input' ? inputs : outputs).push(item);
		}
		const byName = (a: { alias: GraphNode }, b: { alias: GraphNode }) =>
			(a.alias.name ?? '').localeCompare(b.alias.name ?? '');
		return { inputs: inputs.sort(byName), outputs: outputs.sort(byName) };
	});

	const selected = $derived.by(() => {
		void revision;
		if (!selectedId) return null;
		return resolvePublishedTarget(session.doc, selectedId);
	});

	$effect(() => session.onSettle(() => (revision += 1)));
	$effect(() => {
		if (!open) return;
		queueMicrotask(() => dialogEl?.querySelector<HTMLElement>('.close')?.focus());
	});

	function handleDialogKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			onclose();
			return;
		}
		if (event.key !== 'Tab') return;
		if (!dialogEl) return;
		const focusable = Array.from(
			dialogEl.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')
		);
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

	function commitInput(aliasId: string, target: GraphNode, input: HTMLInputElement): void {
		const parsed = parseParameterInput(input.value, target.value);
		if (!parsed.ok) {
			errors = { ...errors, [aliasId]: parsed.message };
			input.setAttribute('aria-invalid', 'true');
			return;
		}
		const result = session.commit({ op: 'setInput', id: target.id, value: parsed.value });
		if (!result.ok) {
			errors = { ...errors, [aliasId]: result.error.message };
			return;
		}
		const { [aliasId]: _removed, ...rest } = errors;
		errors = rest;
		input.removeAttribute('aria-invalid');
		input.value = format(parsed.value);
		revision += 1;
		onchanged();
	}
</script>

{#if open}
	<div class="backdrop" role="presentation" onclick={(event) => {
		if (event.target === event.currentTarget) onclose();
	}}>
		<div
			class="rail"
			role="dialog"
			tabindex="-1"
			aria-label="Parameters"
			aria-modal="true"
			bind:this={dialogEl}
			onkeydown={handleDialogKeydown}
		>
			<header>
				<div>
					<p class="eyebrow">Published graph</p>
					<h2>Parameters<span>.</span></h2>
				</div>
				<button class="close" type="button" onclick={onclose} aria-label="Close parameters">✕</button>
			</header>

			<section aria-labelledby="inputs-title">
				<h3 id="inputs-title">Inputs</h3>
				{#if aliases.inputs.length === 0}
					<p class="empty">Publish an input cell to edit it here.</p>
				{/if}
				{#each aliases.inputs as item (item.alias.id)}
					<div class="parameter" class:selected={selectedId === item.alias.id}>
						<button class="name mono" type="button" onclick={() => (selectedId = item.alias.id)}>
							{item.alias.name}
						</button>
						<input
							class="mono"
							value={format(item.target.value)}
							aria-label={`Edit ${item.alias.name}`}
							aria-invalid={errors[item.alias.id] ? 'true' : undefined}
							aria-describedby={errors[item.alias.id] ? `error-${item.alias.id}` : undefined}
							onkeydown={(event) => {
								if (event.key === 'Enter') {
									event.preventDefault();
									commitInput(item.alias.id, item.target, event.currentTarget);
								}
								if (event.key === 'Escape') {
									event.currentTarget.value = format(item.target.value);
									event.currentTarget.blur();
								}
							}}
						/>
						<button
							class="insert"
							type="button"
							onclick={() => oninsert(item.alias.id)}
							aria-label={`Insert ${item.alias.name} at report caret`}>＋</button
						>
						{#if errors[item.alias.id]}
							<p class="validation" id={`error-${item.alias.id}`} role="alert">
								{errors[item.alias.id]}
							</p>
						{/if}
					</div>
				{/each}
			</section>

			<section aria-labelledby="outputs-title">
				<h3 id="outputs-title">Outputs</h3>
				{#if aliases.outputs.length === 0}
					<p class="empty">Published computed cells appear here.</p>
				{/if}
				{#each aliases.outputs as item (item.alias.id)}
					<div class="parameter output" class:selected={selectedId === item.alias.id}>
						<button class="name mono" type="button" onclick={() => (selectedId = item.alias.id)}>
							{item.alias.name}
						</button>
						<output class="mono">{format(item.target.value)}</output>
						<button
							class="insert"
							type="button"
							onclick={() => oninsert(item.alias.id)}
							aria-label={`Insert ${item.alias.name} at report caret`}>＋</button
						>
					</div>
				{/each}
			</section>

			{#if selected}
				<section class="detail" aria-labelledby="detail-title">
					<h3 id="detail-title">Detail</h3>
					<dl>
						<div><dt>Name</dt><dd class="mono">{selected.publishedNode.name}</dd></div>
						<div><dt>Kind</dt><dd class="mono">{selected.targetNode.kind}</dd></div>
						<div><dt>Value</dt><dd class="mono">{format(selected.targetNode.value)}</dd></div>
						{#if selected.targetNode.cellRef}
							<div>
								<dt>Cell</dt>
								<dd class="mono">
									{session.doc.sheet(selected.targetNode.cellRef.sheetId)?.name} · {selected.targetNode.cellRef.a1}
								</dd>
							</div>
						{/if}
					</dl>
				</section>
			{/if}
		</div>
	</div>
{/if}

<style>
	.backdrop { position: fixed; inset: 0; z-index: 45; pointer-events: none; }
	.rail {
		position: absolute;
		top: 132px;
		right: var(--s3);
		bottom: 60px;
		width: 320px;
		overflow-y: auto;
		pointer-events: auto;
		padding: var(--s3);
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-panel);
		background: var(--surface);
	}
	header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s2); }
	.eyebrow { margin: 0 0 4px; font: 500 var(--fs-eyebrow) var(--font-mono); letter-spacing: .14em; text-transform: uppercase; color: var(--grey-2); }
	h2 { margin: 0; font: 600 1.5rem var(--font-display); }
	h2 span { color: var(--accent); }
	h3 { margin: 0 0 var(--s1); font: 600 .76rem var(--font-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--grey-1); }
	section { margin-top: var(--s3); padding-top: var(--s2); border-top: 1px solid var(--grey-3); }
	button, input {
		min-height: 36px;
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-chip);
		background: var(--surface);
		color: var(--ink);
	}
	button { cursor: pointer; }
	button:focus-visible, input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
	.close { min-width: 36px; }
	.parameter { display: grid; grid-template-columns: minmax(0, 1fr) 108px 36px; gap: 4px; padding: 5px 0; }
	.parameter.selected { background: var(--accent-dim); }
	.name { overflow: hidden; text-overflow: ellipsis; text-align: left; padding: 0 8px; }
	.parameter input, output { padding: 0 8px; font-size: .78rem; }
	output { display: flex; align-items: center; color: var(--accent); }
	.insert { padding: 0; font-size: 1rem; }
	.validation { grid-column: 1 / -1; margin: 0; color: var(--error); font-size: .76rem; }
	.empty { color: var(--grey-2); font-size: .82rem; }
	dl { margin: 0; }
	dl div { display: flex; justify-content: space-between; gap: var(--s2); padding: 5px 0; }
	dt { color: var(--grey-2); font-size: .78rem; }
	dd { margin: 0; text-align: right; font-size: .78rem; overflow-wrap: anywhere; }
	@media (max-width: 800px) {
		.backdrop { pointer-events: auto; background: rgba(11, 11, 12, .2); }
		.rail { inset: 0; width: auto; border: 0; border-radius: 0; }
		button, input { min-height: 44px; }
	}
</style>
