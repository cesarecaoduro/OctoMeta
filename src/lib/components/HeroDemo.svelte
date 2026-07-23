<script lang="ts">
	import { onMount } from 'svelte';

	/**
	 * The landing page's one bold moment: edit `footing.B`, watch the report
	 * chips flash, a pulse travel the dependency hairline, and the pad footing
	 * re-extrude. A staged preview of the real product loop; this is UI
	 * theatre only; no graph engine behind it yet.
	 */

	const COL_P = 1000.0; // col.load, kN
	const Q_ALLOW = 250.0; // allowable bearing, kPa

	let b = $state(2.4); // footing.B, m (square pad)
	const q = $derived(COL_P / (b * b));
	const U = $derived(q / Q_ALLOW);

	/* ---- isometric pad footing, pure function of B ----
	   Square plan (B × B) at fixed thickness, drawn as a classic isometric
	   diamond: front corner fixed, the two plan axes mirror each other so the
	   pad stays centred as it grows. */
	type Pt = { x: number; y: number };
	const F: Pt = { x: 240, y: 214 }; // front corner of the top face
	const AX: Pt = { x: 0.87, y: -0.5 }; // plan axis to the right
	const BX: Pt = { x: -0.87, y: -0.5 }; // plan axis to the left
	const T = 48; // pad thickness, px
	const K = 62; // px per metre
	const add = (p: Pt, v: Pt, s: number): Pt => ({ x: p.x + v.x * s, y: p.y + v.y * s });
	const dn = (p: Pt): Pt => ({ x: p.x, y: p.y + T });
	const pts = (a: Pt[]) => a.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

	const pad = $derived.by(() => {
		const len = b * K;
		const f = F;
		const r = add(f, AX, len);
		const l = add(f, BX, len);
		const bk = add(r, BX, len);
		const off = { x: 30, y: 52 }; // perpendicular offset clearing the pad's side face
		const a = { x: f.x + off.x, y: f.y + off.y };
		const bb = { x: r.x + off.x, y: r.y + off.y };
		const t = { x: -AX.y * 7, y: AX.x * 7 }; // dimension-line end-tick vector
		return {
			top: pts([f, r, bk, l]),
			right: pts([f, r, dn(r), dn(f)]),
			left: pts([f, l, dn(l), dn(f)]),
			a,
			b: bb,
			t
		};
	});

	/* ---- dependency hairline (measured from the live DOM) ----
	   One deliberate line: footing.B row → viewer, terminated by node dots so
	   it never ends in space. It lives in the panel gutter, clear of any text;
	   the chips communicate recompute by flashing in place. */
	let demoBody: HTMLElement;
	let sheetEl: HTMLElement;
	let cellBRow: HTMLElement;
	let chipMEl: HTMLElement;
	let chipUEl: HTMLElement;

	let route: string | null = $state(null);
	let routeEnds: Pt[] = $state([]);
	let depsBox = $state({ w: 0, h: 0 });
	let pulseEl: SVGPathElement | undefined = $state();
	let reduced = false;

	function drawDeps() {
		if (matchMedia('(max-width: 900px)').matches) {
			route = null;
			routeEnds = [];
			return;
		}
		const c = demoBody.getBoundingClientRect();
		depsBox = { w: c.width, h: c.height };
		const s = sheetEl.getBoundingClientRect();
		const r = cellBRow.getBoundingClientRect();
		const from: Pt = { x: s.right - c.left + 6, y: r.top - c.top + r.height / 2 };
		const to: Pt = { x: c.width * 0.585, y: from.y };
		route = `M${from.x},${from.y} L${to.x},${to.y}`;
		routeEnds = [from, to];
	}

	function flash(el: Element, cls: string) {
		el.classList.remove(cls);
		void el.getBoundingClientRect(); // restart the CSS animation
		el.classList.add(cls);
	}

	function update(B: number, animate = true) {
		b = B;
		if (animate && !reduced) {
			flash(cellBRow, 'cellchange');
			flash(chipMEl, 'pulse');
			flash(chipUEl, 'pulse');
			if (pulseEl) flash(pulseEl, 'run');
		}
	}

	/* ---- idle auto-loop: sweep span until the user takes over,
	        and only while the demo is actually on screen ---- */
	let looping = true;
	let onScreen = true;
	let loopDir = 1;
	let idleTimer: ReturnType<typeof setTimeout>;

	function onInput(e: Event) {
		looping = false;
		clearTimeout(idleTimer);
		idleTimer = setTimeout(() => (looping = true), 6000);
		update(parseFloat((e.target as HTMLInputElement).value));
	}

	onMount(() => {
		reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		looping = !reduced;
		drawDeps();
		document.fonts?.ready.then(drawDeps);
		addEventListener('resize', drawDeps);
		const io = new IntersectionObserver(
			(entries) => entries.forEach((e) => (onScreen = e.isIntersecting)),
			{ threshold: 0.35 }
		);
		io.observe(demoBody);
		const loop = setInterval(() => {
			if (!looping || !onScreen) return;
			let v = b + 0.1 * loopDir;
			if (v >= 3.0) {
				v = 3.0;
				loopDir = -1;
			} else if (v <= 2.0) {
				v = 2.0;
				loopDir = 1;
			}
			update(v);
		}, 2600);
		return () => {
			removeEventListener('resize', drawDeps);
			io.disconnect();
			clearInterval(loop);
			clearTimeout(idleTimer);
		};
	});
</script>

<div
	class="demo"
	id="demo"
	aria-label="Live demo: edit footing.B and watch the bearing pressure, the report text, and the 3D footing recompute"
>
	<div class="demo-chrome">
		<span class="dot"></span><span class="dot"></span><span class="dot"></span>
		<span class="title">footing-check.octo · live document</span>
	</div>
	<div class="demo-body" bind:this={demoBody}>
		<svg
			class="deps"
			aria-hidden="true"
			viewBox="0 0 {depsBox.w} {depsBox.h}"
			width={depsBox.w}
			height={depsBox.h}
		>
			{#if route}
				<path class="dep" d={route} />
				<path class="dep-pulse" d={route} bind:this={pulseEl} />
				{#each routeEnds as p (p.x)}
					<circle class="dep-node" cx={p.x} cy={p.y} r="3" />
				{/each}
			{/if}
		</svg>
		<div class="demo-left">
			<div class="demo-prose">
				<span class="eyebrow blocklabel">§ 4.1 · Report</span>
				For the pad footing under column C3, the applied bearing pressure is
				<span class="chip" bind:this={chipMEl}>{q.toFixed(1)} kPa</span>, giving a utilisation of
				<span class="chip" bind:this={chipUEl}>{U.toFixed(2)}</span> against the allowable bearing of
				<span class="mono">250 kPa</span>.
			</div>
			<div>
				<span class="eyebrow blocklabel">Sheet · bearing</span>
				<div class="sheet" bind:this={sheetEl}>
					<div class="fbar"><span class="fx">fx</span><span>=col.load / footing.B²</span></div>
					<table aria-label="Calculation sheet">
						<tbody>
							<tr bind:this={cellBRow}>
								<td class="name">footing.B</td>
								<td class="val">{b.toFixed(1)}</td>
								<td class="unit">m</td>
							</tr>
							<tr>
								<td class="name">col.load</td>
								<td class="val">{COL_P.toFixed(1)}</td>
								<td class="unit">kN</td>
							</tr>
							<tr>
								<td class="name">q_b</td>
								<td class="val computed">{q.toFixed(1)}</td>
								<td class="unit">kPa</td>
							</tr>
						</tbody>
					</table>
				</div>
			</div>
			<div class="spanctl">
				<label for="bRange">footing.B · drag to edit</label>
				<input
					type="range"
					id="bRange"
					min="2.0"
					max="3.0"
					step="0.1"
					value={b}
					oninput={onInput}
					aria-label="footing.B in metres"
				/>
			</div>
		</div>
		<div class="demo-right">
			<span class="eyebrow viewer-label">Viewer · =EXTRUDE(plan, 0.6 m)</span>
			<div class="viewer">
				<svg
					viewBox="0 0 480 300"
					role="img"
					aria-label="Isometric pad footing whose plan size follows footing.B"
				>
					<polygon class="padface" fill="#ECECEA" points={pad.top} />
					<polygon class="padface" fill="#DBDBD8" points={pad.right} />
					<polygon class="padface" fill="#C9C9C6" points={pad.left} />
					<line
						class="dimtick"
						x1={pad.a.x - pad.t.x}
						y1={pad.a.y - pad.t.y}
						x2={pad.a.x + pad.t.x}
						y2={pad.a.y + pad.t.y}
					/>
					<line
						class="dimtick"
						x1={pad.b.x - pad.t.x}
						y1={pad.b.y - pad.t.y}
						x2={pad.b.x + pad.t.x}
						y2={pad.b.y + pad.t.y}
					/>
					<line class="dimline" x1={pad.a.x} y1={pad.a.y} x2={pad.b.x} y2={pad.b.y} />
					<text
						class="dimtext"
						text-anchor="middle"
						x={(pad.a.x + pad.b.x) / 2 + 6}
						y={(pad.a.y + pad.b.y) / 2 + 22}>{b.toFixed(1)} m</text
					>
				</svg>
			</div>
		</div>
	</div>
</div>

<style>
	.demo {
		position: relative;
		margin-top: var(--s4);
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-panel);
		background: var(--surface);
		overflow: hidden;
		box-shadow: 0 32px 80px -36px rgba(11, 11, 12, 0.18);
	}
	.demo-chrome {
		display: flex;
		align-items: center;
		gap: var(--s2);
		padding: 10px var(--s2);
		border-bottom: 1px solid var(--grey-3);
	}
	.demo-chrome .dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--grey-3);
	}
	.demo-chrome .title {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--grey-2);
		letter-spacing: 0.08em;
	}
	.demo-body {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
	}
	.demo-left {
		padding: var(--s3);
		display: flex;
		flex-direction: column;
		gap: var(--s3);
		border-right: 1px solid var(--grey-3);
	}
	.demo-right {
		padding: var(--s3);
		display: flex;
		flex-direction: column;
	}
	.demo-prose {
		font-size: 0.95rem;
		line-height: 1.7;
		color: var(--grey-1);
	}
	.blocklabel {
		display: block;
		margin-bottom: var(--s1);
	}
	.viewer-label {
		display: block;
		margin-bottom: 8px;
	}

	/* sheet */
	.sheet {
		border: 1px solid var(--grey-3);
		border-radius: 8px;
		overflow: hidden;
		background: var(--surface);
	}
	.fbar {
		display: flex;
		gap: 10px;
		align-items: center;
		padding: 7px 10px;
		border-bottom: 1px solid var(--grey-3);
		background: var(--grey-4);
		font-family: var(--font-mono);
		font-size: 0.74rem;
		color: var(--grey-1);
	}
	.fbar .fx {
		color: var(--grey-2);
		font-style: italic;
	}
	.sheet table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.82rem;
	}
	.sheet td {
		padding: 7px 10px;
		border-top: 1px solid var(--grey-3);
	}
	.sheet tr:first-child td {
		border-top: 0;
	}
	.sheet td.name {
		font-family: var(--font-mono);
		font-size: 0.74rem;
		color: var(--grey-1);
	}
	.sheet td.val {
		font-family: var(--font-mono);
		text-align: right;
		font-weight: 500;
		white-space: nowrap;
	}
	.sheet td.unit {
		color: var(--grey-2);
		font-family: var(--font-mono);
		font-size: 0.74rem;
		width: 1%;
	}
	.sheet :global(tr.cellchange) {
		animation: cellflash 0.7s var(--ease);
	}
	td.val.computed {
		color: var(--accent);
	}

	/* slider */
	.spanctl {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.spanctl label {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--grey-2);
		letter-spacing: 0.06em;
	}
	input[type='range'] {
		-webkit-appearance: none;
		appearance: none;
		width: 100%;
		height: 22px;
		background: transparent;
		cursor: ew-resize;
	}
	input[type='range']::-webkit-slider-runnable-track {
		height: 1px;
		background: var(--grey-3);
	}
	input[type='range']::-moz-range-track {
		height: 1px;
		background: var(--grey-3);
	}
	input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 15px;
		height: 15px;
		margin-top: -7px;
		border-radius: 50%;
		background: var(--paper);
		border: 2px solid var(--accent);
	}
	input[type='range']::-moz-range-thumb {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: var(--paper);
		border: 2px solid var(--accent);
	}

	/* viewer */
	.viewer {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 280px;
		position: relative;
	}
	.viewer svg {
		width: 100%;
		height: auto;
		max-width: 480px;
		display: block;
	}
	.dimline,
	.dimtick {
		stroke: var(--accent);
		stroke-width: 1;
	}
	.dimtext {
		font-family: var(--font-mono);
		font-size: 13px;
		fill: var(--accent);
		font-weight: 500;
	}
	.padface {
		stroke: rgba(11, 11, 12, 0.45);
		stroke-width: 1;
		stroke-linejoin: round;
	}

	/* dependency hairlines */
	.deps {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: visible;
	}
	.dep {
		fill: none;
		stroke: var(--grey-3);
		stroke-width: 1;
	}
	.dep-pulse {
		fill: none;
		stroke: var(--accent);
		stroke-width: 1.5;
		stroke-dasharray: 6 120;
		stroke-dashoffset: 126;
		opacity: 0;
	}
	.dep-node {
		fill: var(--paper);
		stroke: var(--grey-2);
		stroke-width: 1;
	}
	.deps :global(.dep-pulse.run) {
		animation: deprun 0.9s var(--ease);
	}

	@media (max-width: 900px) {
		.demo-body {
			grid-template-columns: minmax(0, 1fr);
		}
		.demo-left {
			border-right: 0;
			border-bottom: 1px solid var(--grey-3);
		}
		.viewer {
			min-height: 210px;
		}
	}
</style>
