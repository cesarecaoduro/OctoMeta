<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { adaptiveModeForWidth, type AdaptiveMode } from './adaptive-layout';

	interface Props {
		children: Snippet<[AdaptiveMode]>;
		class?: string;
		testId?: string;
		onmodechange?: (mode: AdaptiveMode) => void;
	}

	let { children, class: className = '', testId, onmodechange }: Props = $props();
	let container = $state<HTMLElement>();
	let mode = $state<AdaptiveMode>('compact');

	onMount(() => {
		if (!container) return;
		let initialized = false;
		const update = (width: number): void => {
			const next = adaptiveModeForWidth(width);
			if (initialized && next === mode) return;
			initialized = true;
			mode = next;
			onmodechange?.(next);
		};
		update(container.getBoundingClientRect().width);
		const observer = new ResizeObserver(([entry]) => update(entry.contentRect.width));
		observer.observe(container);
		return () => observer.disconnect();
	});
</script>

<div
	bind:this={container}
	class={`adaptive-container ${className}`}
	data-layout-mode={mode}
	data-testid={testId}
>
	{@render children(mode)}
</div>

<style>
	.adaptive-container {
		container-type: inline-size;
		min-width: 0;
	}
</style>
