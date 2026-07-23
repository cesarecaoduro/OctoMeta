<script lang="ts">
	import type { LucideIcon } from '@lucide/svelte';

	interface Props {
		/** A Lucide icon or an optically matched OctoMeta domain glyph. */
		glyph: LucideIcon;
		/** Accessible name when the glyph stands alone; omit inside a named control. */
		accessibleName?: string;
		size?: 16 | 18 | 20 | 24;
		state?: 'default' | 'active' | 'success' | 'warning' | 'error';
		animation?: 'none' | 'feedback' | 'computation';
	}

	let {
		glyph: Glyph,
		accessibleName,
		size = 20,
		state = 'default',
		animation = 'none'
	}: Props = $props();
</script>

<span
	class="icon"
	class:feedback={animation === 'feedback'}
	class:computation={animation === 'computation'}
	data-state={state}
	role={accessibleName ? 'img' : undefined}
	aria-label={accessibleName}
	aria-hidden={accessibleName ? undefined : 'true'}
>
	<Glyph {size} strokeWidth={1.8} absoluteStrokeWidth />
</span>

<style>
	.icon {
		display: inline-grid;
		flex: 0 0 auto;
		place-items: center;
		color: currentColor;
		line-height: 0;
	}
	.icon[data-state='active'] { color: var(--tint); }
	.icon[data-state='success'] { color: var(--status-success); }
	.icon[data-state='warning'] { color: var(--status-warning); }
	.icon[data-state='error'] { color: var(--status-error); }
	.feedback { animation: icon-feedback var(--motion-feedback) var(--ease-out); }
	.computation { animation: icon-computation var(--motion-computation) var(--ease-out); }
	@keyframes icon-feedback {
		50% { transform: scale(.9); }
	}
	@keyframes icon-computation {
		50% { color: var(--tint); }
	}
</style>
