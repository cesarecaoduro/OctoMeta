<script lang="ts">
	import { ChevronsUpDown, Search, X } from '@lucide/svelte';
	import { searchUnitCatalog, type UnitCatalogEntry } from '$lib/engine';
	import { Icon } from '$lib/ui';

	let {
		value,
		disabled = false,
		onchange,
		onquerychange
	}: {
		value: string;
		disabled?: boolean;
		onchange: (value: string) => void;
		onquerychange: (query: string) => void;
	} = $props();

	const inputId = 'publication-unit';
	const listboxId = 'publication-unit-options';
	let root = $state<HTMLDivElement>();
	let input = $state<HTMLInputElement>();
	let query = $state('');
	let open = $state(false);
	let activeIndex = $state(-1);
	let syncedValue = '';

	const options = $derived(searchUnitCatalog(query));
	const activeOption = $derived(options[activeIndex]);

	$effect(() => {
		if (value === syncedValue) return;
		syncedValue = value;
		query = value;
		activeIndex = -1;
		onquerychange(value);
	});

	function editQuery(next: string): void {
		query = next;
		open = true;
		activeIndex = -1;
		onquerychange(next);
		if (value) {
			syncedValue = '';
			onchange('');
		}
	}

	function selectUnit(option: UnitCatalogEntry): void {
		query = option.symbol;
		syncedValue = option.symbol;
		activeIndex = -1;
		open = false;
		onquerychange(option.symbol);
		onchange(option.symbol);
		input?.focus();
	}

	function clearUnit(): void {
		query = '';
		syncedValue = '';
		activeIndex = -1;
		open = false;
		onquerychange('');
		onchange('');
		input?.focus();
	}

	function moveActive(delta: number): void {
		if (options.length === 0) return;
		open = true;
		activeIndex =
			activeIndex < 0
				? delta > 0
					? 0
					: options.length - 1
				: (activeIndex + delta + options.length) % options.length;
		queueMicrotask(() =>
			document
				.getElementById(`${listboxId}-${activeIndex}`)
				?.scrollIntoView({ block: 'nearest' })
		);
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			moveActive(1);
			return;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			moveActive(-1);
			return;
		}
		if (event.key === 'Enter' && open && activeOption) {
			event.preventDefault();
			selectUnit(activeOption);
			return;
		}
		if (event.key === 'Escape' && open) {
			event.preventDefault();
			event.stopPropagation();
			open = false;
			activeIndex = -1;
		}
	}

	function handleFocusOut(): void {
		queueMicrotask(() => {
			if (!root?.contains(document.activeElement)) {
				open = false;
				activeIndex = -1;
			}
		});
	}
</script>

<div class="field">
	<label for={inputId}>Unit <small>optional</small></label>
	<div class="picker" bind:this={root} onfocusout={handleFocusOut}>
		<div class="control">
			<Icon glyph={Search} size={16} />
			<input
				id={inputId}
				class="mono"
				type="search"
				role="combobox"
				aria-label="Unit optional"
				aria-autocomplete="list"
				aria-expanded={open}
				aria-controls={listboxId}
				aria-activedescendant={activeOption ? `${listboxId}-${activeIndex}` : undefined}
				autocomplete="off"
				placeholder="Search units, e.g. kN"
				disabled={disabled}
				bind:this={input}
				value={query}
				onfocus={() => (open = true)}
				oninput={(event) => editQuery(event.currentTarget.value)}
				onkeydown={handleKeydown}
			/>
			{#if query}
				<button
					class="icon-button"
					type="button"
					aria-label="Clear unit"
					disabled={disabled}
					onclick={clearUnit}
				>
					<Icon glyph={X} size={16} />
				</button>
			{:else}
				<button
					class="icon-button"
					type="button"
					aria-label="Show unit options"
					disabled={disabled}
					onclick={() => {
						open = !open;
						if (open) input?.focus();
					}}
				>
					<Icon glyph={ChevronsUpDown} size={16} />
				</button>
			{/if}
		</div>

		{#if open}
			<div id={listboxId} class="options" role="listbox" aria-label="Units">
				{#if options.length === 0}
					<p>No canonical units match “{query}”.</p>
				{:else}
					{#each options as option, index (option.symbol)}
						<button
							id={`${listboxId}-${index}`}
							type="button"
							role="option"
							aria-selected={option.symbol === value}
							class:active={index === activeIndex}
							onpointerdown={(event) => event.preventDefault()}
							onclick={() => selectUnit(option)}
						>
							<strong class="mono">{option.symbol}</strong>
							<span>{option.name}</span>
							<small>{option.category}</small>
						</button>
					{/each}
				{/if}
			</div>
		{/if}
	</div>
	<p class="hint">Search is flexible; saved symbols use exact engineering nomenclature.</p>
</div>

<style>
	.field {
		display: grid;
		gap: var(--s1);
		color: var(--grey-1);
		font-size: .78rem;
	}
	label small {
		color: var(--grey-2);
	}
	.picker {
		position: relative;
		color: var(--ink);
	}
	.control {
		display: flex;
		align-items: center;
		min-height: 44px;
		padding-left: var(--s2);
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-chip);
		background: var(--surface);
	}
	.control:focus-within {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	input {
		flex: 1;
		min-width: 0;
		min-height: 42px;
		padding: var(--s1);
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--ink);
		font: inherit;
	}
	input::-webkit-search-cancel-button {
		display: none;
	}
	.icon-button {
		display: grid;
		flex: 0 0 42px;
		width: 42px;
		min-height: 42px;
		place-items: center;
		padding: 0;
		border: 0;
		border-left: 1px solid var(--grey-3);
		border-radius: 0 var(--radius-chip) var(--radius-chip) 0;
		background: transparent;
		color: var(--grey-1);
		cursor: pointer;
	}
	.icon-button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -3px;
	}
	.icon-button:disabled {
		cursor: default;
		opacity: .45;
	}
	.options {
		position: absolute;
		z-index: 20;
		top: calc(100% + var(--s1));
		right: 0;
		left: 0;
		display: grid;
		max-height: min(320px, 45dvh);
		overflow-y: auto;
		padding: var(--s1);
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-card);
		background: var(--material);
		box-shadow: var(--shadow-floating);
	}
	.options button {
		display: grid;
		grid-template-columns: minmax(52px, auto) minmax(0, 1fr) auto;
		gap: var(--s1);
		align-items: center;
		width: 100%;
		min-height: 44px;
		padding: var(--s1);
		border: 0;
		border-radius: var(--radius-chip);
		background: transparent;
		color: var(--ink);
		text-align: left;
		cursor: pointer;
	}
	.options button:hover,
	.options button.active,
	.options button[aria-selected='true'] {
		background: var(--accent-dim);
	}
	.options span {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.options small,
	.options p,
	.hint {
		color: var(--grey-2);
	}
	.options p {
		margin: 0;
		padding: var(--s2);
	}
	.hint {
		margin: 0;
		font-size: .7rem;
		line-height: 1.4;
	}
	@media (max-width: 480px) {
		.options button {
			grid-template-columns: 56px minmax(0, 1fr);
		}
		.options small {
			grid-column: 2;
		}
	}
</style>
