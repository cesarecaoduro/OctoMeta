<script lang="ts">
	/**
	 * The OctoMeta mark: a rounded head over three legs, each ending in a
	 * knocked-out ring node, threaded underneath by a shallow graph arc
	 * with three accent nodes — the typed dependency layer. Fixed brand
	 * gradient (not currentColor); path data mirrors static/brand and
	 * DESIGN.md §2.
	 *
	 * Renders the compact filled variant below 48px, which holds up
	 * better at small sizes per the brand pack's usage guidance; the
	 * fuller outline variant (open head ring) at 48px and above.
	 *
	 * A parent with class `mark-hover` flashes the arc nodes on hover.
	 *
	 * @prop size - rendered width/height in px (default 24)
	 */
	let { size = 24 }: { size?: number } = $props();

	const uid = $props.id();
	const BODY =
		'M 500 115 C 365 115 285 215 285 335 C 285 420 325 475 355 515 C 315 560 270 600 200 610 C 125 620 90 680 105 745 C 120 815 190 850 250 820 C 300 795 325 745 315 695 C 350 670 390 645 425 620 C 450 650 470 685 470 730 L 470 785 C 420 800 390 845 400 900 C 410 960 470 995 525 975 C 575 955 600 900 580 850 C 565 815 535 795 510 785 L 510 730 C 510 685 530 650 555 620 C 590 645 630 670 665 695 C 655 745 680 795 730 820 C 790 850 860 815 875 745 C 890 680 855 620 780 610 C 710 600 665 560 625 515 C 655 475 695 420 695 335 C 695 215 615 115 500 115 Z';
	const ARC = 'M 390 650 C 430 705 460 735 500 760 C 540 735 570 705 610 650';
</script>

<svg viewBox="0 0 1000 1000" width={size} height={size} aria-hidden="true">
	<defs>
		<linearGradient id="octoGrad-{uid}" x1="0%" y1="0%" x2="100%" y2="100%">
			<stop offset="0%" stop-color="var(--ink)" />
			<stop offset="55%" stop-color="var(--accent-2)" />
			<stop offset="100%" stop-color="var(--accent)" />
		</linearGradient>
	</defs>
	<path d={BODY} fill="url(#octoGrad-{uid})" />
	{#if size >= 48}
		<path
			d="M 500 185 C 405 185 350 255 350 345 C 350 430 400 500 500 530 C 600 500 650 430 650 345 C 650 255 595 185 500 185 Z"
			fill="var(--paper)"
		/>
	{/if}
	<circle cx="210" cy="715" r="58" fill="var(--paper)" />
	<circle cx="490" cy="885" r="58" fill="var(--paper)" />
	<circle cx="770" cy="715" r="58" fill="var(--paper)" />
	{#if size >= 48}
		<path d={ARC} fill="none" stroke="var(--accent)" stroke-width="18" stroke-linecap="round" />
		<circle class="node" cx="390" cy="650" r="20" fill="var(--paper)" stroke="var(--accent)" stroke-width="12" />
		<circle class="node" cx="500" cy="760" r="22" fill="var(--paper)" stroke="var(--accent)" stroke-width="12" />
		<circle class="node" cx="610" cy="650" r="20" fill="var(--paper)" stroke="var(--accent)" stroke-width="12" />
	{:else}
		<path d={ARC} fill="none" stroke="var(--paper)" stroke-width="15" stroke-linecap="round" opacity="0.92" />
		<circle class="node" cx="390" cy="650" r="18" fill="var(--accent)" stroke="var(--paper)" stroke-width="9" />
		<circle class="node" cx="500" cy="760" r="20" fill="var(--accent)" stroke="var(--paper)" stroke-width="9" />
		<circle class="node" cx="610" cy="650" r="18" fill="var(--accent)" stroke="var(--paper)" stroke-width="9" />
	{/if}
</svg>

<style>
	.node {
		transform-box: fill-box;
		transform-origin: center;
	}
	:global(.mark-hover:hover) .node {
		animation: node-flash 0.7s var(--ease);
	}
	@keyframes node-flash {
		0%,
		100% {
			transform: scale(1);
		}
		35% {
			transform: scale(1.35);
		}
	}
</style>
