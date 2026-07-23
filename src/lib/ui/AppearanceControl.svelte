<script lang="ts">
	import { onMount } from 'svelte';
	import { Monitor, Moon, Sun, type LucideIcon } from '@lucide/svelte';
	import Icon from './Icon.svelte';
	import IconButton from './IconButton.svelte';
	import {
		APPEARANCE_STORAGE_KEY,
		normalizeAppearance,
		type AppearancePreference
	} from './appearance';

	const OPTIONS: Array<{
		value: AppearancePreference;
		label: string;
		glyph: LucideIcon;
	}> = [
		{ value: 'system', label: 'System', glyph: Monitor },
		{ value: 'light', label: 'Light', glyph: Sun },
		{ value: 'dark', label: 'Dark', glyph: Moon }
	];

	let preference = $state<AppearancePreference>('system');
	let open = $state(false);
	let trigger = $state<HTMLButtonElement>();
	let root = $state<HTMLDivElement>();
	let menu = $state<HTMLDivElement>();
	const current = $derived(OPTIONS.find((option) => option.value === preference) ?? OPTIONS[0]);

	onMount(() => {
		preference = normalizeAppearance(localStorage.getItem(APPEARANCE_STORAGE_KEY));
	});

	/** Persist and announce an appearance preference to the global provider. */
	function changeAppearance(next: AppearancePreference): void {
		preference = next;
		open = false;
		localStorage.setItem(APPEARANCE_STORAGE_KEY, next);
		window.dispatchEvent(
			new CustomEvent<AppearancePreference>('octometa:appearance-change', { detail: next })
		);
		queueMicrotask(() => trigger?.focus());
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (!open) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			open = false;
			queueMicrotask(() => trigger?.focus());
			return;
		}
		if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
		const items = Array.from(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
		if (items.length === 0) return;
		event.preventDefault();
		const active = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? items.length - 1
					: (active + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
		items[next].focus();
	}

	function toggleMenu(): void {
		open = !open;
		if (!open) return;
		queueMicrotask(() => {
			menu
				?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')
				?.focus();
		});
	}

	function dismissFromPointer(event: PointerEvent): void {
		if (open && !root?.contains(event.target as Node)) open = false;
	}
</script>

<svelte:window onkeydown={handleKeydown} />
<svelte:document onpointerdown={dismissFromPointer} />

<div class="appearance-control" bind:this={root}>
	<IconButton
		bind:element={trigger}
		glyph={current.glyph}
		label={`Appearance: ${current.label}`}
		tooltip={`Appearance: ${current.label}`}
		expanded={open}
		hasPopup="menu"
		onclick={toggleMenu}
	/>
	{#if open}
		<div
			class="appearance-menu ui-surface"
			data-surface="menu"
			role="menu"
			aria-label="Appearance"
			bind:this={menu}
		>
			{#each OPTIONS as option (option.value)}
				<button
					type="button"
					role="menuitemradio"
					aria-checked={preference === option.value}
					onclick={() => changeAppearance(option.value)}
				>
					<Icon
						glyph={option.glyph}
						size={18}
						state={preference === option.value ? 'active' : 'default'}
					/>
					<span>{option.label}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.appearance-control {
		position: relative;
		display: inline-flex;
	}
	.appearance-menu {
		position: absolute;
		z-index: 100;
		top: calc(100% + var(--s1));
		right: 0;
		display: grid;
		width: 168px;
		padding: var(--s1);
	}
	.appearance-menu button {
		display: flex;
		align-items: center;
		gap: var(--s1);
		min-height: 44px;
		padding: 0 var(--s1);
		border: 0;
		border-radius: calc(var(--radius-control) - 3px);
		background: transparent;
		color: var(--text);
		font: 500 .86rem var(--font-body);
		cursor: pointer;
	}
	.appearance-menu button:hover,
	.appearance-menu button[aria-checked='true'] {
		background: var(--surface-muted);
	}
	.appearance-menu button:focus-visible {
		outline: var(--focus-ring);
		outline-offset: 0;
	}
</style>
