<script lang="ts">
	import { onMount } from 'svelte';

	/**
	 * Section §01 exhibit: report, sheet and viewer panels joined by
	 * dependency hairlines. Pulses sweep the edges when the diagram
	 * scrolls into view, and re-fire periodically while visible.
	 */
	let el: HTMLElement;
	let inview = $state(false);

	function fire() {
		inview = true;
		setTimeout(() => (inview = false), 2600);
	}

	onMount(() => {
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const io = new IntersectionObserver(
			(entries) => entries.forEach((e) => e.isIntersecting && fire()),
			{ threshold: 0.5 }
		);
		io.observe(el);
		const tick = setInterval(() => {
			const r = el.getBoundingClientRect();
			if (r.top < innerHeight && r.bottom > 0) fire();
		}, 6000);
		return () => {
			io.disconnect();
			clearInterval(tick);
		};
	});
</script>

<div class="graphdiagram" class:inview bind:this={el}>
	<svg viewBox="0 0 960 190" role="img" aria-label="Prose, grid and 3D panels linked by dependency lines">
		<rect class="gnode" x="20" y="55" width="230" height="80" rx="10" />
		<rect class="gnode" x="365" y="55" width="230" height="80" rx="10" />
		<rect class="gnode" x="710" y="55" width="230" height="80" rx="10" />
		<text class="gnode-label" x="40" y="88">§ Report</text>
		<text class="gnode-sub" x="40" y="110">utilisation chip · 0.69</text>
		<text class="gnode-label" x="385" y="88">Sheet · bearing</text>
		<text class="gnode-sub" x="385" y="110">footing.B → q_b</text>
		<text class="gnode-label" x="730" y="88">Viewer</text>
		<text class="gnode-sub" x="730" y="110">=EXTRUDE(plan, 0.6 m)</text>
		<path class="gedge" d="M365,95 L250,95" />
		<path class="gpulse" d="M365,95 L250,95" />
		<path class="gedge" d="M595,95 L710,95" />
		<path class="gpulse d2" d="M595,95 L710,95" />
		<path
			class="gedge"
			d="M480,135 L480,156 Q480,164 472,164 L143,164 Q135,164 135,156 L135,135"
		/>
		<path
			class="gpulse d3"
			d="M480,135 L480,156 Q480,164 472,164 L143,164 Q135,164 135,156 L135,135"
		/>
		<circle class="gdot" cx="365" cy="95" r="3" />
		<circle class="gdot" cx="250" cy="95" r="3" />
		<circle class="gdot" cx="595" cy="95" r="3" />
		<circle class="gdot" cx="710" cy="95" r="3" />
		<circle class="gdot" cx="480" cy="135" r="3" />
		<circle class="gdot" cx="135" cy="135" r="3" />
	</svg>
</div>

<style>
	/* keep labels legible on phones: the drawing scrolls instead of shrinking */
	.graphdiagram {
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
	}
	.graphdiagram svg {
		width: 100%;
		min-width: 640px;
		height: auto;
		display: block;
	}
	.gnode {
		fill: var(--surface);
		stroke: var(--grey-3);
	}
	.gnode-label {
		font-family: var(--font-mono);
		font-size: 12px;
		fill: var(--ink);
	}
	.gnode-sub {
		font-family: var(--font-body);
		font-size: 10.5px;
		fill: var(--grey-2);
	}
	.gedge {
		stroke: var(--grey-3);
		stroke-width: 1;
		fill: none;
	}
	.gdot {
		fill: var(--paper);
		stroke: var(--grey-2);
		stroke-width: 1;
	}
	.gpulse {
		stroke: var(--accent);
		stroke-width: 1.5;
		fill: none;
		stroke-dasharray: 6 200;
		stroke-dashoffset: 206;
		opacity: 0;
	}
	.inview .gpulse {
		animation: deprun 1.2s var(--ease) forwards;
	}
	.inview .gpulse.d2 {
		animation-delay: 0.35s;
	}
	.inview .gpulse.d3 {
		animation-delay: 0.7s;
	}
</style>
