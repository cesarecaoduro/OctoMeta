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
	<meta property="og:title" content="OctoMeta · The living engineering document" />
	<meta
		property="og:description"
		content="The living engineering document: calculations, report and 3D model driven by one typed dependency graph. Join the waitlist."
	/>
</svelte:head>

<Nav />

<header class="hero" id="top">
	<div class="hero-bg" aria-hidden="true"></div>
	<div class="wrap">
		<p class="eyebrow hero-eyebrow r r1">One mind. Eight arms.</p>
		<h1>
			<span class="r r2">The living</span><br />
			<span class="r r3 h1-dim">engineering document.</span>
		</h1>
		<p class="sub vision r r4">
			Your calculations, your report, and your 3D model are arms of a single intelligent graph.
			<strong>Edit anywhere, and every arm follows:</strong> units checked, provenance kept,
			nothing stale.
		</p>
		<div class="hero-ctas r r5">
			<a class="btn btn-primary" href="#waitlist">Join the waitlist <span class="arr">→</span></a>
			<a class="btn btn-ghost" href="#demo">Watch it compute <span class="arr-d">↓</span></a>
		</div>
		<div class="hero-why r r6" aria-label="Why it matters, per role">
			<div class="why">
				<span class="who">Design engineer</span>
				<p>Edit once: the sheet, the report and the model follow. The reconciling week disappears.</p>
			</div>
			<div class="why">
				<span class="who">Checker</span>
				<p>Every value carries units, derivation and author. Review the logic, not cell references.</p>
			</div>
			<div class="why">
				<span class="who">BIM lead</span>
				<p>The geometry in the calc is the geometry delivered: IFC4X3 from the same graph.</p>
			</div>
		</div>
		<div class="r r7">
			<HeroDemo />
		</div>
	</div>
</header>

<main class="wrap">
	<DimDivider num="§ 00" tag="THE PROBLEM" />

	<section id="why">
		<div class="section-head" use:reveal>
			<span class="eyebrow">Why OctoMeta exists</span>
			<h2>The calc you stamped<br />isn't the calc you have.</h2>
			<p class="sub">
				Every engineer knows the Monday: the span changed on Friday, the spreadsheet was updated,
				the Word report wasn't, and the model belongs to another team. Three artifacts. Three
				different truths. One signature: yours.
			</p>
		</div>

		<div class="pain-grid">
			<div class="pain" use:reveal>
				<div class="artifact">=C4*SUM(D6:D12)/B33</div>
				<h3>Logic you can't review.</h3>
				<p>
					That formula is load distribution across a six-pile group, but nothing on screen says
					so. Cell references hide engineering intent, so checking means reverse-engineering. And
					on most projects, that means it doesn't happen.
				</p>
			</div>
			<div class="pain" use:reveal={{ delay: 100 }}>
				<div class="artifact">
					report_FINAL_r3.pdf <span class="dimmed">· issued 08 Nov</span><br />
					<span class="bad">model updated 12 Nov</span>
				</div>
				<h3>Deliverables that rot.</h3>
				<p>
					The PDF was true the day it was printed. Four days later the founding level changed and
					the report didn't. Now the stale copy carries your stamp while the truth lives in
					somebody else's file, and nobody is sure which numbers were checked.
				</p>
			</div>
			<div class="pain" use:reveal={{ delay: 200 }}>
				<div class="artifact">
					234.6 kN + 234.6 <span class="bad">kip</span> = <span class="bad">?</span>
				</div>
				<h3>Units on the honour system.</h3>
				<p>
					Spreadsheets will add anything to anything. A kip that should have been a kilonewton
					survives every review that doesn't recompute by hand: the exact class of silent error
					behind some of the industry's most expensive failures.
				</p>
			</div>
		</div>

		<div class="stats" aria-label="The cost of fragmented calculations" use:reveal>
			<div class="stat">
				<div class="n">~40%</div>
				<div class="l">
					of engineering time spent finding, rebuilding and reconciling calculations (industry
					estimates)
				</div>
			</div>
			<div class="stat">
				<div class="n">~24%</div>
				<div class="l">
					of computational notebooks re-executed without error in the largest study to date; order
					and hidden state defeat the rest
				</div>
			</div>
			<div class="stat">
				<div class="n">up to 7%</div>
				<div class="l">
					of contract value on large projects attributed to calculation errors (industry
					estimates)
				</div>
			</div>
		</div>

		<p class="pain-pivot" use:reveal>
			Every copy is maintained by hand.
			<span class="pivot-dim">
				OctoMeta removes the copies: one graph underneath, so nothing to reconcile, nothing to go
				stale, nothing to take on faith.
			</span>
		</p>
	</section>

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
			<div class="geo-grid">
				<div>
					<div class="steps-line">
						<span>D4</span><span>=</span><span>EXTRUDE(plan, 0.6 m)</span>
					</div>
					<div class="steps-line"><span>→</span><span class="chip">geom:extrude:9f3a1c</span></div>
					<div class="steps-line">
						<span>D5</span><span>=</span><span>DISTANCE(D2, D3)</span><span>→</span>
						<span class="chip">4.21 m</span>
					</div>
				</div>
				<svg
					class="geo-iso"
					viewBox="0 0 230 170"
					role="img"
					aria-label="Isometric pad footing returned by the EXTRUDE formula, thickness dimensioned 0.6 m"
				>
					<polygon class="geo-face" fill="#ECECEA" points="110,108 177.9,69 110,30 42.1,69" />
					<polygon class="geo-face" fill="#DBDBD8" points="110,108 177.9,69 177.9,99 110,138" />
					<polygon class="geo-face" fill="#C9C9C6" points="110,108 42.1,69 42.1,99 110,138" />
					<line class="geo-dim" x1="192" y1="69" x2="192" y2="99" />
					<line class="geo-dim" x1="187" y1="69" x2="197" y2="69" />
					<line class="geo-dim" x1="187" y1="99" x2="197" y2="99" />
					<text class="geo-dimtext" x="203" y="88">0.6 m</text>
				</svg>
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
				<svg class="fmt-ic" viewBox="0 0 24 24" aria-hidden="true">
					<path d="M6 3h8l4 4v14H6z" />
					<path d="M14 3v4h4" />
					<path d="M9 12h6M9 15h6M9 18h4" />
				</svg>
				<span class="fmt">report.pdf</span>
				<p>Paginated, submission-ready. Show-steps included where the checker needs them.</p>
			</div>
			<div class="card">
				<svg class="fmt-ic" viewBox="0 0 24 24" aria-hidden="true">
					<path d="M12 3l7 4v10l-7 4-7-4V7z" />
					<path d="M5 7l7 4 7-4M12 11v10" />
				</svg>
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

	<DimDivider num="§ 06" tag="CONNECTED" />

	<section id="connected" class="feature">
		<div class="copy" use:reveal>
			<span class="eyebrow">Your tools, one graph</span>
			<h2>Connected to the tools you already run.</h2>
			<p>
				The numbers you need already exist: in Revit models on Autodesk Construction Cloud, and in
				the business systems that hold your rates and quantities. OctoMeta binds them into the
				graph instead of asking you to retype them.
			</p>
			<p>
				<strong>
					Autodesk Platform Services publishes official MCP server samples for its AEC Data Model
					API</strong
				>: Revit elements on ACC, queried over GraphQL, no plugins. OctoMeta consumes exactly this
				class of server, so a bound element property enters the graph with provenance, like any
				other input. The same pattern reaches the MCP server in front of your ERP: unit rates land
				in the same checked graph as your quantities.
			</p>
			<p class="conn-fine">
				First connectors ship read-only: Revit via APS, plus any MCP server you already run.
				Exposing the document graph as its own MCP server is on the roadmap, built on the same
				mutation API.
			</p>
			<div class="conn-badges" aria-label="Connectors">
				<span class="conn-badge hi">Revit · ACC via APS AEC Data Model</span>
				<span class="conn-badge hi">ERP cost data via MCP</span>
				<span class="conn-badge">XLSX import</span>
				<span class="conn-badge">MCP-native by design</span>
			</div>
		</div>
		<div class="exhibit" aria-label="Live binding example" use:reveal={{ delay: 100 }}>
			<div class="conn-flow-wrap">
				<svg
					class="conn-flow"
					viewBox="0 0 520 132"
				role="img"
				aria-label="Revit on ACC and an ERP feeding the OctoMeta graph over MCP"
			>
				<rect class="cnode" x="10" y="14" width="158" height="42" rx="8" />
				<rect class="cnode" x="10" y="76" width="158" height="42" rx="8" />
				<rect class="cnode" x="352" y="45" width="158" height="42" rx="8" />
				<text class="cnode-label" x="26" y="32">Revit · ACC</text>
				<text class="cnode-sub" x="26" y="48">aecdm · GraphQL</text>
				<text class="cnode-label" x="26" y="94">ERP</text>
				<text class="cnode-sub" x="26" y="110">unit_rate("N40 mix")</text>
				<text class="cnode-label" x="368" y="63">document graph</text>
				<text class="cnode-sub" x="368" y="79">typed · provenance-stamped</text>
				<path class="cedge" d="M168,35 C265,35 255,66 352,66" />
				<path class="cedge" d="M168,97 C265,97 255,66 352,66" />
				<path class="cpulse" d="M168,35 C265,35 255,66 352,66" />
				<path class="cpulse d2" d="M168,97 C265,97 255,66 352,66" />
				<circle class="cdot" cx="168" cy="35" r="3" />
				<circle class="cdot" cx="168" cy="97" r="3" />
				<circle class="cdot" cx="352" cy="66" r="3" />
				</svg>
			</div>
			<div class="steps-line">
				<span class="src">aecdm</span><span>·</span>
				<span>GetElementsByElementGroup("Tower-B.rvt", "Structural Foundations")</span>
			</div>
			<div class="steps-line">
				<span>footing.B</span><span>←</span><span>Tower-B.rvt · footing F3 · width</span>
				<span class="chip">2.4 m</span>
			</div>
			<div class="steps-line">
				<span>rates.concrete</span><span>←</span><span>erp · unit_rate("N40 mix")</span>
				<span class="chip">385 $/m³</span>
			</div>
			<div class="steps-line">
				<span>cost.F3</span><span>=</span><span>VOLUME(footing) × rates.concrete</span>
				<span class="chip">1.33 k$</span>
			</div>
			<p class="caption">
				Model data and cost data meet inside one graph. Bound inputs carry provenance (source,
				query, pull time), and the whole document recomputes when they're refreshed: checks, cost
				and geometry together.
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
		padding: calc(var(--s6) + 8px) 0 var(--s5);
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
	.vision strong {
		color: var(--ink);
		font-weight: 500;
	}
	.hero-ctas {
		display: flex;
		gap: var(--s2);
		margin-top: var(--s4);
		flex-wrap: wrap;
	}

	/* per-persona "why for me": hairline-topped columns, deck's title-slide motif */
	.hero-why {
		display: flex;
		gap: var(--s4);
		margin-top: var(--s4);
		max-width: 980px;
	}
	.why {
		flex: 1;
		border-top: 1px solid var(--grey-3);
		padding-top: 12px;
	}
	.why .who {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--grey-2);
	}
	.why p {
		font-size: 0.88rem;
		color: var(--grey-1);
		margin-top: 6px;
		max-width: 34ch;
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
	}
	.r7 {
		animation-delay: 680ms;
		animation-duration: 1.1s;
	}

	/* ---- problem: editorial columns split by hairlines, not cards ---- */
	.pain-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		margin-top: var(--s4);
	}
	.pain {
		padding-right: var(--s4);
	}
	.pain + .pain {
		border-left: 1px solid var(--grey-3);
		padding-left: var(--s4);
	}
	.artifact {
		font-family: var(--font-mono);
		font-size: 0.78rem;
		background: var(--grey-4);
		border: 1px solid var(--grey-3);
		border-radius: 8px;
		padding: 12px 14px;
		overflow-x: auto;
		white-space: nowrap;
	}
	.artifact .bad {
		color: var(--error);
		font-weight: 500;
	}
	.artifact .dimmed {
		color: var(--grey-2);
	}
	.pain h3 {
		margin-top: var(--s2);
		font-size: 1.05rem;
	}
	.pain p {
		font-size: 0.88rem;
		color: var(--grey-1);
		margin-top: 8px;
	}
	.stats {
		display: flex;
		gap: var(--s4) var(--s5);
		flex-wrap: wrap;
		margin-top: var(--s4);
		padding-top: var(--s3);
		border-top: 1px solid var(--grey-3);
	}
	.stat .n {
		font-family: var(--font-display);
		font-weight: 600;
		font-size: 1.9rem;
		letter-spacing: -0.02em;
	}
	.stat .l {
		font-size: 0.78rem;
		color: var(--grey-2);
		max-width: 26ch;
		margin-top: 2px;
	}
	/* pivot statement: two-tone display type, echoes the hero headline */
	.pain-pivot {
		margin-top: var(--s4);
		font-family: var(--font-display);
		font-weight: 600;
		letter-spacing: -0.02em;
		line-height: 1.3;
		font-size: clamp(1.35rem, 2.4vw, 1.8rem);
		max-width: 34ch;
	}
	.pivot-dim {
		color: var(--grey-1);
	}

	/* ---- geometry exhibit: formulas beside the iso footing they produce ---- */
	.geo-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 230px;
		gap: var(--s3);
		align-items: center;
	}
	.geo-iso {
		width: 100%;
		height: auto;
		display: block;
	}
	.geo-face {
		stroke: rgba(11, 11, 12, 0.45);
		stroke-width: 1;
		stroke-linejoin: round;
	}
	.geo-dim {
		stroke: var(--accent);
		stroke-width: 1;
	}
	.geo-dimtext {
		font-family: var(--font-mono);
		font-size: 11px;
		fill: var(--accent);
		font-weight: 500;
	}

	/* ---- connected ---- */
	.conn-flow-wrap {
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
		margin-bottom: var(--s3);
	}
	.conn-flow {
		width: 100%;
		min-width: 440px;
		height: auto;
		display: block;
	}
	.cnode {
		fill: var(--surface);
		stroke: var(--grey-3);
	}
	.cnode-label {
		font-family: var(--font-mono);
		font-size: 12px;
		fill: var(--ink);
	}
	.cnode-sub {
		font-family: var(--font-body);
		font-size: 10.5px;
		fill: var(--grey-2);
	}
	.cedge {
		stroke: var(--grey-3);
		stroke-width: 1;
		fill: none;
	}
	.cdot {
		fill: var(--paper);
		stroke: var(--grey-2);
		stroke-width: 1;
	}
	/* periodic pulse: a refresh pulling source data into the graph.
	   Pulse sweeps in the first fifth of the cycle, then the line rests. */
	.cpulse {
		stroke: var(--accent);
		stroke-width: 1.5;
		fill: none;
		stroke-dasharray: 6 220;
		stroke-dashoffset: 226;
		opacity: 0;
		animation: connpulse 5.4s var(--ease) infinite;
	}
	.cpulse.d2 {
		animation-delay: 0.4s;
	}
	@keyframes connpulse {
		0% {
			opacity: 1;
			stroke-dashoffset: 226;
		}
		18% {
			opacity: 1;
		}
		22% {
			opacity: 0;
			stroke-dashoffset: -40;
		}
		100% {
			opacity: 0;
			stroke-dashoffset: -40;
		}
	}
	.conn-fine {
		font-size: 0.9rem;
	}
	.conn-badges {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-top: var(--s3);
	}
	.conn-badge {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		padding: 6px 12px;
		border: 1px solid var(--grey-3);
		border-radius: var(--radius-pill);
		color: var(--grey-1);
		white-space: nowrap;
	}
	.conn-badge.hi {
		border-color: transparent;
		background: var(--accent-dim);
		color: var(--accent);
	}
	.src {
		color: var(--grey-2);
	}

	/* ---- sections ---- */
	.section-head {
		display: grid;
		gap: var(--s2);
		margin-bottom: var(--s4);
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
		padding: var(--s2) 0;
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
		min-width: 0;
	}
	/* long mono tokens (API calls, handles) must wrap, never overflow */
	.steps-line span {
		overflow-wrap: anywhere;
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
	.fmt-ic {
		display: block;
		width: 26px;
		height: 26px;
		margin-bottom: var(--s2);
		fill: none;
		stroke: var(--grey-1);
		stroke-width: 1.2;
		stroke-linejoin: round;
		stroke-linecap: round;
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
		padding: var(--s3) 0;
		margin: var(--s5) 0 var(--s4);
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
		.hero-why {
			flex-direction: column;
			gap: var(--s2);
		}
		.pain-grid {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--s3);
		}
		.pain {
			padding-right: 0;
		}
		.pain + .pain {
			border-left: 0;
			border-top: 1px solid var(--grey-3);
			padding-left: 0;
			padding-top: var(--s3);
		}
		.stats {
			gap: var(--s3);
		}
		.geo-grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.geo-iso {
			max-width: 230px;
			margin: 0 auto;
		}
		.feature,
		.feature.flip {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--s3);
		}
		.feature.flip .exhibit {
			order: 2;
		}
	}
	@media (max-width: 600px) {
		.hero {
			padding-top: var(--s5);
		}
		.exhibit {
			padding: var(--s3);
		}
		.pain-pivot {
			font-size: 1.3rem;
		}
	}
	@media (max-width: 380px) {
		h1 {
			font-size: 2.55rem;
		}
	}
</style>
