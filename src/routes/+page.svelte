<script lang="ts">
	import Nav from '$lib/components/Nav.svelte';
	import HeroDemo from '$lib/components/HeroDemo.svelte';
	import DimDivider from '$lib/components/DimDivider.svelte';
	import GraphDiagram from '$lib/components/GraphDiagram.svelte';
	import Waitlist from '$lib/components/Waitlist.svelte';
	import Footer from '$lib/components/Footer.svelte';
</script>

<svelte:head>
	<title>OctoMeta · The living engineering document</title>
	<meta
		name="description"
		content="OctoMeta joins calculations, reports, and 3D geometry in one traceable engineering graph. Recompute predictably, verify every value, and deliver PDF and IFC from the same source."
	/>
	<meta property="og:title" content="OctoMeta · The living engineering document" />
	<meta
		property="og:description"
		content="Predictable engineering calculations, traceable decisions, and verified PDF and IFC deliverables from one living document."
	/>
</svelte:head>

<a class="skip-link" href="#main-content">Skip to main content</a>
<Nav />

<header class="hero" id="top">
	<div class="hero-bg" aria-hidden="true"></div>
	<div class="wrap hero-inner">
		<p class="eyebrow eyebrow-tick hero-eyebrow">One mind. Eight arms.</p>
		<h1>
			The <em class="acc-i">living</em><br />
			<span class="h1-dim">engineering document<span class="ap">.</span></span>
		</h1>
		<p class="sub vision">
			Your calculations, your report, and your 3D model are arms of a single intelligent graph.
			<strong>Edit anywhere, and every arm follows:</strong> units checked, decisions traceable,
			outputs ready to verify.
		</p>
		<p class="engineering-position">
			Built for engineering certainty—not AI theatre. Familiar workflows, deterministic
			calculation, and a clear record of how every result was produced.
		</p>
		<div class="hero-ctas">
			<a class="btn btn-primary" href="#waitlist">Join the private beta <span class="arr">→</span></a>
			<a class="btn btn-ghost" href="#proof">See one edit propagate <span class="arr-d">↓</span></a>
		</div>
		<div id="proof">
			<HeroDemo />
		</div>
		<div class="post-demo-cta">
			<p><strong>One edit.</strong> Calculation, report, geometry, and the model delivered through IFC.</p>
			<a href="#waitlist">Join the private beta <span aria-hidden="true">→</span></a>
		</div>
	</div>
</header>

<main class="wrap" id="main-content">
	<DimDivider num="§ 00" tag="ENGINEERING OUTCOMES" />

	<section id="outcomes" aria-labelledby="outcomes-title">
		<div class="section-head">
			<span class="eyebrow eyebrow-tick">One graph, three obligations</span>
			<h2 id="outcomes-title">
				Calculate. Verify.<br /><span class="h2-dim">Deliver<span class="ap">.</span></span>
			</h2>
			<p class="sub">
				OctoMeta follows the engineering design process you already know. The difference is that
				the calculation, its evidence, and its geometry never become separate copies.
			</p>
		</div>

		<div class="outcome-grid">
			<article class="outcome">
				<span class="outcome-num">01 / CALCULATE</span>
				<div class="outcome-evidence formula-evidence" translate="no">
					<span>q_b = P / B²</span>
					<span class="chip">173.6 kPa</span>
					<span class="err">#UNIT! kN + m</span>
				</div>
				<h3>Predictable by construction<span class="ap">.</span></h3>
				<p>Typed units and dependency order replace hidden state. The same inputs always produce the same checked result.</p>
			</article>

			<article class="outcome">
				<span class="outcome-num">02 / VERIFY</span>
				<div class="outcome-evidence provenance-evidence" translate="no">
					<span>footing.B = 2.4 m</span><span class="verified">Verified</span>
					<small>input · P. Sharma</small><small>source retained</small>
				</div>
				<h3>Traceable by default<span class="ap">.</span></h3>
				<p>Every value keeps its formula, units, source, author, and verification state. Review the engineering—not cell references.</p>
			</article>

			<article class="outcome outcome-deliver">
				<span class="outcome-num">03 / DELIVER</span>
				<div class="outcome-evidence deliver-evidence">
					<svg viewBox="0 0 150 92" role="img" aria-label="Isometric footing generated from a calculation">
						<polygon points="75,43 112,22 75,1 38,22" />
						<polygon points="75,43 112,22 112,47 75,68" />
						<polygon points="75,43 38,22 38,47 75,68" />
						<line x1="120" y1="22" x2="120" y2="47" />
						<text x="126" y="38">0.6 m</text>
					</svg>
					<span class="format-badge" translate="no">IFC4X3</span>
				</div>
				<h3>Geometry is the deliverable<span class="ap">.</span></h3>
				<p>In the private beta, formulas produce live 3D geometry and the same verified model leaves through IFC—no remodel, no reconciliation.</p>
			</article>
		</div>
	</section>

	<DimDivider num="§ 01" tag="THE PROBLEM" />

	<section class="problem" id="problem" aria-labelledby="problem-title">
		<div class="problem-copy">
			<span class="eyebrow eyebrow-tick">Copies create doubt</span>
			<h2 id="problem-title">
				The calc you stamped<br /><span class="h2-dim">isn't the calc you have<span class="ap">.</span></span>
			</h2>
			<p class="sub">
				The span changed on Friday. The spreadsheet followed. The report did not, and the model
				belongs to another team. Three artifacts now claim to be true; one signature carries the risk.
			</p>
		</div>
		<div class="revision-ledger" aria-label="Example of diverging engineering files">
			<div><span>foundation-check.xlsx</span><span>rev 14 · current</span></div>
			<div><span>report_FINAL_r3.pdf</span><span class="stale">rev 11 · stale</span></div>
			<div><span>tower-b-model.ifc</span><span class="stale">rev 09 · stale</span></div>
			<p>OctoMeta removes the copies: one graph underneath, with one revision history.</p>
		</div>
	</section>

	<DimDivider num="§ 02" tag="ONE GRAPH" />

	<section id="graph" aria-labelledby="graph-title">
		<div class="section-head graph-head">
			<span class="eyebrow eyebrow-tick">Reactive by construction</span>
			<h2 id="graph-title">
				Position is for humans.<br /><span class="h2-dim">Order is for the graph<span class="ap">.</span></span>
			</h2>
			<p class="sub">
				Your document reads top to bottom. It computes by dependency, never by where a block sits
				on the page. Change one named value and every dependent view settles from the same source.
			</p>
		</div>
		<GraphDiagram />
	</section>

	<DimDivider num="§ 03" tag="ENGINEERING TRUST" />

	<section id="trust" aria-labelledby="trust-title">
		<div class="trust-intro">
			<div>
				<span class="eyebrow eyebrow-tick">No black boxes</span>
				<h2 id="trust-title">Engineering judgment stays in charge<span class="ap">.</span></h2>
			</div>
			<p>
				OctoMeta is not an AI wrapper around a spreadsheet. It is a deterministic engineering
				system with typed inputs, visible derivations, versioned decisions, and outputs that can be
				checked before they are issued.
			</p>
		</div>

		<div class="principles" aria-label="OctoMeta engineering principles">
			<div><span>01</span><strong>Quality</strong><p>Errors surface where they begin, before they reach a deliverable.</p></div>
			<div><span>02</span><strong>Traceability</strong><p>Every result retains its inputs, derivation, author, and revision.</p></div>
			<div><span>03</span><strong>Verification</strong><p>Show steps and provenance make independent checking part of the document.</p></div>
		</div>

		<div class="status-ledger" aria-label="Product availability">
			<div class="status-row">
				<span class="status-label live">Private beta</span>
				<div class="beta-scope">
					<div><strong>The engineering document</strong><p>Report canvas, workbook, parameters, equations, units, derivations, provenance, and durable document history.</p></div>
					<div><strong>3D geometry + IFC delivery</strong><p>Formula-driven geometry and schema-valid IFC4X3 leave from the same graph as the checked calculation.</p></div>
				</div>
			</div>
			<div class="status-row soon">
				<span class="status-label">Coming soon</span>
				<div><strong>MCP connections + careful AI assistance</strong><p>Future tools enter through the typed, traceable workflow. They will assist engineering judgment—not replace deterministic calculation or verification.</p></div>
			</div>
		</div>
	</section>

	<p class="audience">
		<strong>For structural, civil &amp; infrastructure engineers</strong>: design engineers,
		checkers, and BIM leads who need fewer copies and more confidence in what they issue.
	</p>

	<Waitlist />
</main>

<Footer />

<style>
	.hero {
		position: relative;
		padding: calc(var(--s6) + var(--s1)) 0 var(--s5);
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
		opacity: 0.48;
		mask-image: radial-gradient(ellipse 90% 55% at 50% 0%, black 0%, transparent 72%);
		-webkit-mask-image: radial-gradient(ellipse 90% 55% at 50% 0%, black 0%, transparent 72%);
	}
	.hero-inner { position: relative; }
	.hero-eyebrow { margin-bottom: var(--s3); }
	.hero h1 { max-width: 12em; }
	.h1-dim, .h2-dim { color: var(--grey-1); }
	.acc-i { color: var(--accent); font-style: italic; }
	.vision { max-width: 57ch; margin-top: var(--s3); }
	.vision strong {
		color: var(--ink);
		font-weight: 500;
		text-decoration: underline;
		text-decoration-color: var(--accent-light);
		text-decoration-thickness: 2px;
		text-underline-offset: 5px;
	}
	.engineering-position {
		max-width: 66ch;
		margin-top: var(--s3);
		padding-left: var(--s2);
		border-left: 1px solid var(--accent);
		font-size: 0.92rem;
		color: var(--grey-1);
	}
	.hero-ctas { display: flex; gap: var(--s2); margin-top: var(--s4); flex-wrap: wrap; }
	.post-demo-cta {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--s3);
		padding: var(--s3) 0 0;
		font-size: 0.9rem;
		color: var(--grey-1);
	}
	.post-demo-cta strong { color: var(--ink); }
	.post-demo-cta a { color: var(--ink); font-weight: 500; text-decoration-color: var(--accent-light); text-underline-offset: 4px; white-space: nowrap; }

	.section-head { display: grid; gap: var(--s2); max-width: 820px; margin-bottom: var(--s4); }
	.section-head .sub { max-width: 61ch; }
	.outcome-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--grey-3); border-bottom: 1px solid var(--grey-3); }
	.outcome { min-width: 0; padding: var(--s3) var(--s4) var(--s4) 0; }
	.outcome + .outcome { border-left: 1px solid var(--grey-3); padding-left: var(--s4); }
	.outcome-num { display: block; margin-bottom: var(--s3); color: var(--accent); font: 500 0.7rem var(--font-mono); letter-spacing: 0.1em; }
	.outcome-evidence { min-height: 116px; margin-bottom: var(--s3); border: 1px solid var(--grey-3); border-radius: var(--radius-card); background: var(--surface); }
	.outcome h3 { font-size: 1.25rem; }
	.outcome > p { margin-top: var(--s1); color: var(--grey-1); font-size: 0.9rem; }
	.formula-evidence { display: flex; flex-wrap: wrap; align-content: center; align-items: center; gap: 12px; padding: var(--s3); font: 0.75rem var(--font-mono); }
	.provenance-evidence { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--s1) var(--s2); align-content: center; padding: var(--s3); font: 0.72rem var(--font-mono); }
	.provenance-evidence small { color: var(--grey-1); }
	.verified { color: var(--accent); font-weight: 500; }
	.deliver-evidence { position: relative; display: grid; place-items: center; padding: var(--s2); }
	.deliver-evidence svg { width: 150px; height: 92px; overflow: visible; }
	.deliver-evidence polygon { fill: var(--grey-4); stroke: color-mix(in srgb, var(--ink) 45%, transparent); stroke-width: 1; }
	.deliver-evidence polygon:nth-child(2) { fill: #dededb; }
	.deliver-evidence polygon:nth-child(3) { fill: #cececa; }
	.deliver-evidence line { stroke: var(--accent); }
	.deliver-evidence text { fill: var(--accent); font: 9px var(--font-mono); }
	.format-badge { position: absolute; right: var(--s2); bottom: var(--s2); border: 1px solid var(--accent); border-radius: var(--radius-chip); padding: 3px 7px; color: var(--accent); font: 500 0.65rem var(--font-mono); }

	.problem { display: grid; grid-template-columns: minmax(0, 1fr) minmax(360px, 0.8fr); gap: var(--s5); align-items: center; }
	.problem-copy { display: grid; gap: var(--s2); }
	.revision-ledger { border: 1px solid var(--grey-3); border-radius: var(--radius-panel); background: var(--surface); overflow: hidden; font: 0.76rem var(--font-mono); }
	.revision-ledger > div { display: flex; justify-content: space-between; gap: var(--s2); padding: 13px var(--s2); border-bottom: 1px solid var(--grey-3); }
	.revision-ledger > div span:last-child { color: var(--grey-1); white-space: nowrap; }
	.revision-ledger > div .stale { color: var(--error); }
	.revision-ledger .stale { color: var(--error); }
	.revision-ledger p { padding: var(--s2); background: var(--grey-4); color: var(--grey-1); font-family: var(--font-body); }
	.graph-head { margin-bottom: var(--s3); }

	.trust-intro { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr); gap: var(--s5); align-items: end; }
	.trust-intro h2 { margin-top: var(--s2); }
	.trust-intro > p { color: var(--grey-1); }
	.principles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: var(--s4); border-block: 1px solid var(--grey-3); }
	.principles > div { display: grid; grid-template-columns: auto 1fr; gap: var(--s1) 12px; padding: var(--s3) var(--s4) var(--s3) 0; }
	.principles > div + div { border-left: 1px solid var(--grey-3); padding-left: var(--s4); }
	.principles span { grid-row: 1 / 3; color: var(--accent); font: 0.7rem var(--font-mono); }
	.principles strong { font-family: var(--font-display); font-size: 1.05rem; }
	.principles p { color: var(--grey-1); font-size: 0.86rem; }
	.status-ledger { margin-top: var(--s4); border-top: 1px solid var(--ink); }
	.status-row { display: grid; grid-template-columns: 170px minmax(0, 1fr); gap: var(--s4); padding: var(--s3) 0; border-bottom: 1px solid var(--grey-3); }
	.status-label { align-self: start; width: max-content; border: 1px solid var(--grey-3); border-radius: var(--radius-pill); padding: 5px 11px; color: var(--grey-1); font: 500 0.68rem var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; }
	.status-label.live { border-color: var(--accent); color: var(--accent); }
	.beta-scope { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s4); }
	.status-row strong { font-family: var(--font-display); font-size: 1.1rem; }
	.status-row p { max-width: 68ch; margin-top: 4px; color: var(--grey-1); font-size: 0.9rem; }
	.soon .status-label { border-color: var(--grey-3); color: var(--grey-1); }
	.audience { max-width: 780px; margin: var(--s5) auto 0; text-align: center; font-size: 1.05rem; color: var(--grey-1); }
	.audience strong { color: var(--ink); }

	@media (max-width: 900px) {
		.outcome-grid, .principles { grid-template-columns: minmax(0, 1fr); }
		.outcome { padding: var(--s3) 0; }
		.outcome + .outcome, .principles > div + div { border-left: 0; border-top: 1px solid var(--grey-3); padding-left: 0; }
		.outcome-evidence { max-width: 520px; }
		.problem, .trust-intro { grid-template-columns: minmax(0, 1fr); gap: var(--s3); }
		.problem { align-items: stretch; }
	}
	@media (max-width: 600px) {
		.hero { padding-top: var(--s5); }
		.hero-ctas { align-items: stretch; flex-direction: column; }
		.hero-ctas .btn { justify-content: center; }
		.post-demo-cta { align-items: flex-start; flex-direction: column; gap: var(--s2); }
		.status-row { grid-template-columns: minmax(0, 1fr); gap: var(--s2); }
		.beta-scope { grid-template-columns: minmax(0, 1fr); gap: var(--s3); }
		.status-row { padding: var(--s2) 0; }
		.outcome { padding: var(--s3) 0; }
		.outcome-evidence { min-height: 96px; }
		.principles > div { padding-top: var(--s2); padding-bottom: var(--s2); }
		.audience { margin-top: var(--s4); }
		.revision-ledger > div { align-items: flex-start; flex-direction: column; gap: 3px; }
	}
</style>
