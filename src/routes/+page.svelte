<script lang="ts">
	import Nav from '$lib/components/Nav.svelte';
	import HeroDemo from '$lib/components/HeroDemo.svelte';
	import DimDivider from '$lib/components/DimDivider.svelte';
	import GraphDiagram from '$lib/components/GraphDiagram.svelte';
	import Waitlist from '$lib/components/Waitlist.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import { reveal } from '$lib/actions/reveal';
</script>

<svelte:head>
	<title>OctoMeta · The living engineering document</title>
	<meta
		name="description"
		content="OctoMeta is the living engineering document: calculations, report, and 3D model driven by one typed dependency graph. Edit once: the sheet recomputes, the report rewrites, the model rebuilds. Units checked, provenance kept, nothing stale."
	/>
	<meta property="og:title" content="OctoMeta · Edit once. Everything follows." />
	<meta
		property="og:description"
		content="The living engineering document: calculations, report and 3D model driven by one typed dependency graph. Join the waitlist."
	/>
</svelte:head>

<Nav />

<header class="hero" id="top">
	<div class="hero-bg" aria-hidden="true"></div>
	<div class="wrap">
		<p class="eyebrow hero-eyebrow r r1">The living engineering document</p>
		<h1>
			<span class="r r2">Edit once.</span><br />
			<span class="r r3 h1-dim">Everything follows.</span>
		</h1>
		<p class="sub vision r r4">
			OctoMeta turns the calculation, the report, and the 3D model into one living document, driven
			by a typed dependency graph. Change a number: the sheet recomputes, the report rewrites, the
			model rebuilds. Units checked. Provenance kept. Nothing stale.
		</p>
		<div class="hero-ctas r r5">
			<a class="btn btn-primary" href="#waitlist">Join the waitlist <span class="arr">→</span></a>
			<a class="btn btn-ghost" href="#demo">Watch it compute <span class="arr-d">↓</span></a>
		</div>
		<div class="r r6">
			<HeroDemo />
		</div>
	</div>
</header>

<main class="wrap">
	<DimDivider num="§ 01" tag="ONE GRAPH" />

	<section id="graph">
		<div class="section-head" use:reveal>
			<span class="eyebrow">Reactive by construction</span>
			<h2>Position is for humans.<br />Order is for the graph.</h2>
			<p class="sub">
				Your document reads top to bottom. It computes by dependency, never by where a block sits
				on the page. No hidden state, no run-order bugs, no stale cell three tabs away.
			</p>
		</div>
		<div use:reveal={{ delay: 120 }}>
			<GraphDiagram />
		</div>
	</section>

	<DimDivider num="§ 02" tag="UNITS" />

	<section id="units" class="feature">
		<div class="copy" use:reveal>
			<span class="eyebrow">Unit-safe by default</span>
			<h2>Every number carries its units.</h2>
			<p>
				Dimensional mismatches surface as typed errors, not silent bugs. Ask for the full
				substituted derivation on demand, so a checker reads the logic, not cell references.
			</p>
		</div>
		<div class="exhibit" aria-label="Show steps example" use:reveal={{ delay: 100 }}>
			<div class="steps-line"><span>q_b</span><span>=</span><span>P / B²</span></div>
			<div class="steps-line">
				<span>=</span><span>1000.0 kN / (2.4 m)²</span><span>=</span>
				<span class="chip">173.6 kPa</span>
			</div>
			<div class="steps-line">
				<span>P + B</span><span>→</span><span class="err">#UNIT! kN + m</span>
			</div>
			<p class="caption">
				"Show steps" renders the derivation with values and units substituted. Mixing dimensions is
				a typed error that propagates, never a silent wrong number.
			</p>
		</div>
	</section>

	<DimDivider num="§ 03" tag="GEOMETRY" />

	<section id="geometry" class="feature flip">
		<div class="exhibit" aria-label="Geometry as a value example" use:reveal={{ delay: 100 }}>
			<div class="steps-line"><span>D4</span><span>=</span><span>EXTRUDE(plan, 0.6 m)</span></div>
			<div class="steps-line"><span>→</span><span class="chip">geom:extrude:9f3a1c</span></div>
			<div class="steps-line">
				<span>D5</span><span>=</span><span>DISTANCE(D2, D3)</span><span>→</span>
				<span class="chip">4.21 m</span>
			</div>
			<p class="caption">
				Geometry is a first-class value: formulas return content-addressed handles into a real B-Rep
				kernel. Scalars unbox straight back into ordinary math.
			</p>
		</div>
		<div class="copy" use:reveal>
			<span class="eyebrow">Live 3D from your formulas</span>
			<h2>Type a formula.<br />Get a footing.</h2>
			<p>
				<span class="mono">=EXTRUDE(plan, t)</span> returns real B-Rep geometry, computed by a
				proper CAD kernel, live in the viewer. Pick a cell, highlight the object, and back again. No
				export, no round-trip, no separate tool.
			</p>
		</div>
	</section>

	<DimDivider num="§ 04" tag="DELIVERABLES" />

	<section id="deliverable" class="feature">
		<div class="copy" use:reveal>
			<span class="eyebrow">The report is the deliverable</span>
			<h2>From calc to PDF and IFC. One artifact.</h2>
			<p>
				Your calculation isn't transcribed into a deliverable. It <em>is</em> one. Export a paginated
				report and a schema-valid IFC4X3 model from the same graph; nothing to reconcile.
			</p>
		</div>
		<div class="deliv" use:reveal={{ delay: 100 }}>
			<div class="card">
				<span class="fmt">report.pdf</span>
				<p>Paginated, submission-ready. Show-steps included where the checker needs them.</p>
			</div>
			<div class="card">
				<span class="fmt">model.ifc <span class="fmt-sub">· IFC4X3</span></span>
				<p>
					The geometry you calculated is the geometry you deliver, straight into the BIM workflow.
				</p>
			</div>
		</div>
	</section>

	<DimDivider num="§ 05" tag="REVIEW" />

	<section id="review" class="feature flip">
		<div class="exhibit" aria-label="Provenance inspector example" use:reveal={{ delay: 100 }}>
			<div class="provrow">
				<span>footing.B = 2.4 m</span><span class="who">input · P. Sharma</span>
				<span class="badge ok">Verified</span>
			</div>
			<div class="provrow">
				<span>q_b = P/B²</span><span class="who">formula · template EN 1997-1</span>
				<span class="badge ok">Verified</span>
			</div>
			<div class="provrow">
				<span>borehole.logs = TABLE(A2:C40)</span><span class="who">import · P. Sharma</span>
				<span class="badge">Unverified</span>
			</div>
			<p class="caption">
				Every value knows how it was derived, who authored it, and whether it's been checked.
			</p>
		</div>
		<div class="copy" use:reveal>
			<span class="eyebrow">Built for checking</span>
			<h2>Reviewable by design.</h2>
			<p>
				Provenance and "show steps" make verification fast and trustworthy: a workflow made for ISO
				19650-style checking, not bolted on after.
			</p>
		</div>
	</section>

	<div class="ai-strip" use:reveal>
		<div class="inner">
			<span class="eyebrow">AI-ready by architecture</span>
			<p>
				Every edit flows through one typed API, with provenance built in, so when AI arrives, it's
				just another careful reviewer, not a bolt-on.
			</p>
		</div>
	</div>

	<section use:reveal>
		<p class="audience">
			<strong>For structural, civil &amp; infrastructure engineers</strong>: design engineers, checkers,
			and BIM leads who are done reconciling spreadsheets, Word calcs, and models by hand.
		</p>
	</section>

	<div use:reveal>
		<Waitlist />
	</div>
</main>

<Footer />

<style>
	/* ---- hero ---- */
	.hero {
		position: relative;
		padding: calc(var(--s6) + 8px) 0 var(--s6);
		overflow: hidden;
	}
	.hero-bg {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background-image:
			linear-gradient(var(--grey-3) 1px, transparent 1px),
			linear-gradient(90deg, var(--grey-3) 1px, transparent 1px);
		background-size: 56px 56px;
		opacity: 0.5;
		mask-image: radial-gradient(ellipse 90% 60% at 50% 0%, black 0%, transparent 68%);
		-webkit-mask-image: radial-gradient(ellipse 90% 60% at 50% 0%, black 0%, transparent 68%);
	}
	.hero .wrap {
		position: relative;
	}
	.hero-eyebrow {
		margin-bottom: var(--s3);
	}
	.hero h1 {
		max-width: 12em;
	}
	.h1-dim {
		color: var(--grey-1);
	}
	.vision {
		max-width: 56ch;
		margin-top: var(--s3);
	}
	.hero-ctas {
		display: flex;
		gap: var(--s2);
		margin-top: var(--s4);
		flex-wrap: wrap;
	}

	/* staggered entrance; spans need inline-block for transform to apply */
	.r {
		animation: rise 0.9s var(--ease) both;
	}
	span.r {
		display: inline-block;
	}
	.r1 {
		animation-delay: 0ms;
	}
	.r2 {
		animation-delay: 80ms;
	}
	.r3 {
		animation-delay: 180ms;
	}
	.r4 {
		animation-delay: 300ms;
	}
	.r5 {
		animation-delay: 420ms;
	}
	.r6 {
		animation-delay: 560ms;
		animation-duration: 1.1s;
	}

	/* ---- sections ---- */
	.section-head {
		display: grid;
		gap: var(--s2);
		margin-bottom: var(--s5);
		max-width: 820px;
	}
	.section-head .eyebrow {
		margin-bottom: var(--s1);
	}
	.section-head .sub {
		max-width: 58ch;
	}
	.feature {
		display: grid;
		grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
		gap: var(--s5);
		align-items: center;
		padding: var(--s4) 0;
	}
	.feature.flip {
		grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
	}
	.feature .copy p {
		color: var(--grey-1);
		margin-top: var(--s2);
		max-width: 46ch;
	}
	.exhibit {
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-panel);
		background: var(--surface);
		padding: var(--s4);
		font-family: var(--font-mono);
		font-size: 0.84rem;
		box-shadow: 0 24px 60px -32px rgba(11, 11, 12, 0.14);
	}
	.exhibit .caption {
		font-family: var(--font-body);
		font-size: var(--fs-caption);
		color: var(--grey-2);
		margin-top: var(--s3);
	}
	.steps-line {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 12px;
		align-items: baseline;
	}
	.steps-line + .steps-line {
		margin-top: 12px;
		padding-top: 12px;
		border-top: 1px dashed var(--grey-3);
	}
	.provrow {
		display: flex;
		justify-content: space-between;
		gap: var(--s2);
		padding: 11px 0;
		border-top: 1px solid var(--grey-3);
		font-size: 0.8rem;
	}
	.provrow:first-child {
		border-top: 0;
	}
	.provrow .who {
		color: var(--grey-1);
	}
	.badge {
		font-size: 0.68rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding: 2px 8px;
		border-radius: var(--radius-pill);
		border: 1px solid var(--grey-3);
		color: var(--grey-1);
	}
	.badge.ok {
		border-color: transparent;
		background: var(--accent-dim);
		color: var(--accent);
	}
	.deliv {
		display: flex;
		gap: var(--s2);
		flex-wrap: wrap;
	}
	.deliv .card {
		flex: 1;
		min-width: 180px;
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-card);
		padding: var(--s3);
		background: var(--surface);
		transition: border-color var(--t-fast) var(--ease);
	}
	.deliv .card:hover {
		border-color: var(--grey-2);
	}
	.deliv .card .fmt {
		font-family: var(--font-mono);
		font-weight: 500;
		font-size: 1.05rem;
	}
	.fmt-sub {
		color: var(--grey-2);
	}
	.deliv .card p {
		font-size: 0.85rem;
		color: var(--grey-1);
		margin-top: 6px;
	}
	.ai-strip {
		border-top: 1px solid var(--grey-3);
		border-bottom: 1px solid var(--grey-3);
		padding: var(--s4) 0;
		margin: var(--s6) 0;
	}
	.ai-strip .inner {
		display: flex;
		gap: var(--s4);
		align-items: baseline;
		flex-wrap: wrap;
	}
	.ai-strip p {
		color: var(--grey-1);
		max-width: 62ch;
	}
	.audience {
		color: var(--grey-1);
		max-width: 62ch;
	}

	@media (max-width: 900px) {
		.feature,
		.feature.flip {
			grid-template-columns: 1fr;
			gap: var(--s3);
		}
		.feature.flip .exhibit {
			order: 2;
		}
	}
</style>
