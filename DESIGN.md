# OctoMeta · DESIGN.md (v1)
*Brand, logo, and design tokens. One source of truth for the marketing site, the deck, and the app shell.*

---

## 1. Brand premise

One typed dependency graph is the source of truth; the grid, the report, and the 3D viewer are projections of it. The brand states that plainly: no mascots, no metaphors. *(The original octopus / "eight arms" narrative was retired on 18 Jul 2026: not relevant to the product, and it dragged every surface toward illustration.)*

**Canonical vision line (hero, decks, README):**
> OctoMeta is the living engineering document. Your calculations, your report, and your 3D model are views of a single intelligent graph: edit anywhere, and everything follows.

**Tagline:** *Edit once. Everything follows.*

**Voice:** engineer-to-engineer. Confident, precise, zero fluff. Plain verbs, sentence case, active voice. We never say "revolutionary"; we show a cell edit moving a beam.

## 2. Logo

**Concept:** a hairline ring carrying a single accent node, a value moving through the graph. Reads as an "O", scales to 16 px, and diagrams the product's one promise: computation flowing to wherever it's needed.

**Construction (master SVG):**

```svg
<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" fill="none" role="img" aria-label="OctoMeta">
  <circle cx="16" cy="16" r="10.5" stroke="currentColor" stroke-width="2.5"/>
  <circle cx="23.42" cy="8.58" r="3.3" fill="#0B5FFF" stroke="#FAFAF9" stroke-width="2"/>
</svg>
```

**Rules.** Ring uses `currentColor` so it inherits ink on paper and paper on ink; the node stays `--accent` with a `--paper` keyline (all-mono in single-color reproduction). The node sits at 45° by default; animating it once around the ring (0.9 s, `--ease`) is the only permitted motion: on hover in the nav lockup, never autoplaying. Clear space = ½ mark width on all sides. Minimum size 14 px. Never rotate the resting mark, never multi-color, never add gradients.

**Wordmark:** `OctoMeta` set in Inter Tight 600, tracking −0.025em, single ink color; the accent node in the mark carries the only color. Mark-left lockup, gap ≈ 0.4× mark height.

## 3. Design tokens

```css
:root {
  /* ---- color ---- */
  --paper:      #FAFAF9;   /* page background */
  --ink:        #0B0B0C;   /* text, mark, primary buttons */
  --grey-1:     #55555A;   /* secondary text */
  --grey-2:     #9A9AA0;   /* tertiary text, ticks, eyebrows */
  --grey-3:     #E4E4E1;   /* hairlines: 1px, always */
  --grey-4:     #F1F1EF;   /* panel fills, formula bars */
  --surface:    #FFFFFF;   /* cards, demo panels */
  --accent:     #0B5FFF;   /* "graph blue": THE accent. Allowed: computed values,
                              value chips, dependency pulses, dimension lines,
                              the logo node, CTA hover, focus rings. Nothing else. */
  --accent-dim: rgba(11,95,255,.10);
  --error:      #C42B1C;   /* typed graph errors only (#UNIT!, #CYCLE!) */
  --error-dim:  rgba(196,43,28,.08);

  /* ---- type ---- */
  --font-display: "Inter Tight", system-ui, sans-serif;   /* w600, ls -0.025em */
  --font-body:    "Inter", system-ui, sans-serif;          /* w400/500 */
  --font-mono:    "JetBrains Mono", ui-monospace, monospace; /* formulas, units,
                     handles (geom:extrude:9f3a), eyebrows, section tags */
  --fs-h1: clamp(2.6rem, 6vw, 4.4rem);
  --fs-h2: clamp(1.8rem, 3.6vw, 2.6rem);
  --fs-sub: clamp(1.05rem, 1.6vw, 1.3rem);
  --fs-body: 17px;  --fs-caption: .78rem;
  --fs-eyebrow: .72rem;   /* mono, uppercase, letter-spacing .14em */

  /* ---- spacing (8-base) ---- */
  --s1:8px; --s2:16px; --s3:24px; --s4:40px; --s5:64px; --s6:96px;

  /* ---- layout ---- */
  --max:1200px; --prose:720px;
  --radius-card:12px; --radius-panel:14px; --radius-chip:6px; --radius-pill:999px;

  /* ---- motion ---- */
  --t-fast:180ms; --t-med:280ms; --ease:cubic-bezier(.25,.1,.25,1);
}
```

## 4. Motifs

- **Dependency hairlines.** Hairline curves (1px `--grey-3`) with travelling accent pulses are the signature motif, in the hero demo and section diagrams. A pulse means *computation happened*.
- **Dimension dividers.** Section breaks are dimension lines: 1px rule, 9px end ticks, mono tags (`§ 03 ——— GEOMETRY`). Engineering-drawing vernacular, used with restraint.
- **Mono = computational.** Anything the graph touches (formulas, units, handles, node names) renders in JetBrains Mono. Prose never does.

## 5. Motion principles

Motion demonstrates computation first: recompute flash (chip: accent→dim, 700ms), pulse sweeps along dependency hairlines (~900ms, staggered ≤3), hover transitions 180ms color/border only. Structural motion is allowed with restraint: a one-time staggered hero entrance (rise + fade, ≤1.1s total) and once-per-element scroll reveals (rise + fade, ~0.8s): progressive enhancement only, never blocking content when JS is absent. No parallax, no scroll-jacking. `prefers-reduced-motion` disables **everything**, including demo auto-loops.

## 6. Application rules (do / don't)

**Do:** paper background everywhere; product-as-hero; one bold moment per surface (landing = live demo; deck = matrix slide); 8-px spacing scale only; AA contrast (`--grey-1` is the floor for body text).
**Don't:** second accent color; gradients; hard shadows (one soft ambient shadow is allowed on hero-level panels, `0 24–32px 60–80px` at ≤0.18 alpha ink; everything else stays border + surface shift); octopus/eight-arms narrative, illustration, or mascot anywhere; accent in headings; stock imagery; dark-mode improvisation (a dark theme is a future, tokenized decision: invert paper/ink, keep accent).

## 7. Surface mapping

| Surface | Tokens applied | Signature element |
|---|---|---|
| Landing page | Full set | Live hero demo (edit → chips flash → pulses → beam re-extrudes) |
| Reveal.js decks | Full set; slide bg `--paper`; H2 per slide; hairline footer with mark + page tag | Comparison-matrix slide |
| App shell (SvelteKit) | Import `tokens.css` from `src/lib/styles`; chips/errors/pulses identical to marketing | The document itself |
| PDF export | Print-safe subset (pure black text, accent preserved for chips) | Show-steps blocks |
