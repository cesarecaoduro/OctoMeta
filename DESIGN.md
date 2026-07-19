# OctoMeta — DESIGN.md (v1)
*Brand, logo, and design tokens. One source of truth for the marketing site, the deck, and the app shell.*

---

## 1. Brand premise

An octopus keeps roughly two-thirds of its neurons in its arms: eight limbs that sense and act semi-independently, coordinated by one mind. OctoMeta's architecture is the same — independent projections (grid, report, 3D viewer) each doing real work, coordinated by **one typed dependency graph**. *Meta* is the graph above the views.

**Canonical vision line (hero, decks, README):**
> OctoMeta is the living engineering document. Your calculations, your report, and your 3D model are arms of a single intelligent graph — edit anywhere, and every arm follows.

**Tagline:** *One mind. Eight arms.*

**Voice:** engineer-to-engineer. Confident, precise, zero fluff. Plain verbs, sentence case, active voice. We never say "revolutionary"; we show a cell edit moving a beam.

## 2. Logo

**Concept ("Octet"):** one head node above, eight arms below. The head is the typed graph (Meta, one mind); the arms are dependency hairlines that leave the head radially and arrive hanging vertical, each ending in a node dot (the projections). Exactly **one** tip dot takes the accent color: the value that just recomputed. Octopus by count and silhouette, diagram by construction — no eyes, no suckers, no taper.

**Construction (master SVG, 64-box):** head Ø15 at (32,14); arms stroke 1.9, departing at ±10° ±33° ±56° ±79°; tips Ø5 cascading at y 55 / 52 / 46 / 38.5; accent on tip 6 of 8.

```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" fill="none" role="img" aria-label="OctoMeta">
  <g stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
    <path d="M 25.62 15.24 C 18.75 16.58, 6 31.5, 6 38.5"/>
    <path d="M 26.61 17.63 C 19.98 22.11, 12 38, 12 46"/>
    <path d="M 28.46 19.45 C 24.10 26.16, 20 44, 20 52"/>
    <path d="M 30.87 20.40 C 29.48 28.28, 28 47, 28 55"/>
    <path d="M 33.13 20.40 C 34.52 28.28, 36 47, 36 55"/>
    <path d="M 35.54 19.45 C 39.90 26.16, 44 44, 44 52"/>
    <path d="M 37.39 17.63 C 44.02 22.11, 52 38, 52 46"/>
    <path d="M 38.38 15.24 C 45.25 16.58, 58 31.5, 58 38.5"/>
  </g>
  <circle cx="32" cy="14" r="7.5" fill="currentColor"/>
  <circle cx="6"  cy="38.5" r="2.5" fill="currentColor"/>
  <circle cx="12" cy="46"   r="2.5" fill="currentColor"/>
  <circle cx="20" cy="52"   r="2.5" fill="currentColor"/>
  <circle cx="28" cy="55"   r="2.5" fill="currentColor"/>
  <circle cx="36" cy="55"   r="2.5" fill="currentColor"/>
  <circle cx="44" cy="52"   r="2.5" fill="#0B5FFF"/>   <!-- the ONE accent tip -->
  <circle cx="52" cy="46"   r="2.5" fill="currentColor"/>
  <circle cx="58" cy="38.5" r="2.5" fill="currentColor"/>
</svg>
```

**Glyph (below 24 px, 32-box):** same anatomy, three arms — used for the favicon and any tiny context.

```svg
<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" fill="none" role="img" aria-label="OctoMeta">
  <g stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
    <path d="M 13.05 10.85 C 9.09 14.67, 6.5 18.5, 6.5 23.5"/>
    <path d="M 16.00 12.10 C 16.00 17.60, 16 22, 16 27"/>
    <path d="M 18.95 10.85 C 22.91 14.67, 25.5 18.5, 25.5 23.5"/>
  </g>
  <circle cx="16"   cy="8"    r="4.6" fill="currentColor"/>
  <circle cx="6.5"  cy="23.5" r="2.1" fill="currentColor"/>
  <circle cx="16"   cy="27"   r="2.1" fill="currentColor"/>
  <circle cx="25.5" cy="23.5" r="2.1" fill="#0B5FFF"/>
</svg>
```

**Rules.** Mark uses `currentColor` so it inherits ink on paper and paper on ink; the accent tip stays `--accent` in every context except single-color reproduction (then all-ink). Clear space = one head-diameter on all sides. Minimum size 16 px; below 24 px always the glyph. Animation means computation only: one pulse from head to tip (or a tip flash on hover), then stillness. Never rotate or flip (arms hang down), never multi-color, never add gradients, never give it eyes.

**Wordmark:** `OctoMeta` set in Inter Tight 600, tracking −0.02em; "Meta" may render in `--grey-1` next to ink "Octo" in large lockups; single weight/color in small sizes. Mark-left lockup, gap = 0.6× mark height.

## 3. Design tokens

```css
:root {
  /* ---- color ---- */
  --paper:      #FAFAF9;   /* page background */
  --ink:        #0B0B0C;   /* text, mark, primary buttons */
  --grey-1:     #55555A;   /* secondary text */
  --grey-2:     #9A9AA0;   /* tertiary text, ticks, eyebrows */
  --grey-3:     #E4E4E1;   /* hairlines — 1px, always */
  --grey-4:     #F1F1EF;   /* panel fills, formula bars */
  --surface:    #FFFFFF;   /* cards, demo panels */
  --accent:     #0B5FFF;   /* "arm blue" — THE accent. Allowed: computed values,
                              value chips, dependency pulses, dimension lines,
                              accent logo tip, CTA hover, focus rings. Nothing else. */
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

- **Arms as dependency lines.** Hairline curves (1px `--grey-3`) with travelling accent pulses are the signature motif — in the logo, the hero demo, and section diagrams. A pulse means *computation happened*.
- **Dimension dividers.** Section breaks are dimension lines: 1px rule, 9px end ticks, mono tags (`§ 03 ——— GEOMETRY`). Engineering-drawing vernacular, used with restraint.
- **Mono = computational.** Anything the graph touches — formulas, units, handles, node names — renders in JetBrains Mono. Prose never does.

## 5. Motion principles

Motion exists only to demonstrate computation. Recompute flash (chip: accent→dim, 700ms), pulse sweeps along dependency hairlines (~900ms, staggered ≤3), hover transitions 180ms color/border only. No parallax, no scroll-jacking, no decorative reveals. `prefers-reduced-motion` disables **everything**, including demo auto-loops.

## 6. Application rules (do / don't)

**Do:** paper background everywhere; product-as-hero; one bold moment per surface (landing = live demo; deck = matrix slide); 8-px spacing scale only; AA contrast (`--grey-1` is the floor for body text).
**Don't:** second accent color; gradients; shadows (elevation = border + surface shift); octopus illustration/mascot anywhere (the mark is a diagram, not a character); accent in headings; stock imagery; dark-mode improvisation (a dark theme is a future, tokenized decision — invert paper/ink, keep accent).

## 7. Surface mapping

| Surface | Tokens applied | Signature element |
|---|---|---|
| Landing page | Full set | Live hero demo (edit → chips flash → pulses → footing re-extrudes) |
| Reveal.js decks | Full set; slide bg `--paper`; H2 per slide; hairline footer with mark + page tag | Comparison-matrix slide |
| App shell (SvelteKit) | Import `tokens.css` from `src/lib/styles`; chips/errors/pulses identical to marketing | The document itself |
| PDF export | Print-safe subset (pure black text, accent preserved for chips) | Show-steps blocks |
