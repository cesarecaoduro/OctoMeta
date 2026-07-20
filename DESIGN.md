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

> **v2 direction — this section supersedes the v1 "Octet" mark.** Provenance and an open flag are logged in §2.1.

**Concept ("Node"):** a rounded head loop over three legs, each ending in an open ring; a shallow arc threads the legs together with three small graph nodes underneath. Head = one mind; the three legs = the load-bearing projections (sheet, report, viewer); the arc = *Meta*, the graph running under them. Monoline, no eyes, no suckers, no mascot.

**Construction (master SVG, 64-box):** head ring Ø20 at (32,18), stroke 3.2; neck (32,28)→(32,36); legs stroke 3.2 from (32,36) to ring centers (14,50) / (32,54) / (50,50), ring Ø9; graph arc stroke 1.6 from (18,44) through (32,48.5) to (46,44), three nodes Ø3.6 on the arc in `--accent`.

```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" fill="none" role="img" aria-label="OctoMeta">
  <circle cx="32" cy="18" r="10" stroke="currentColor" stroke-width="3.2"/>
  <path d="M 32 28 L 32 36" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>
  <g stroke="currentColor" stroke-width="3.2" stroke-linecap="round">
    <path d="M 32 36 C 24 38, 16 42, 14 50"/>
    <path d="M 32 36 L 32 54"/>
    <path d="M 32 36 C 40 38, 48 42, 50 50"/>
  </g>
  <g fill="none" stroke="currentColor" stroke-width="2.2">
    <circle cx="14" cy="50" r="4.5"/>
    <circle cx="32" cy="54" r="4.5"/>
    <circle cx="50" cy="50" r="4.5"/>
  </g>
  <path d="M 18 44 Q 32 50 46 44" stroke="currentColor" stroke-width="1.6" fill="none"/>
  <circle cx="18" cy="44"   r="1.8" fill="var(--accent, #6C5CE7)"/>
  <circle cx="32" cy="48.5" r="1.8" fill="var(--accent, #6C5CE7)"/>
  <circle cx="46" cy="44"   r="1.8" fill="var(--accent, #6C5CE7)"/>
</svg>
```

**Filled brand stamp (marketing, splash, avatars, app icon):** solid silhouette stroked in the accent gradient, ring nodes knocked out in paper. This is the *only* context where the gradient and `--accent-2` are allowed — see the exception in §6.

```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="OctoMeta">
  <defs>
    <linearGradient id="octoGrad" x1="32" y1="8" x2="32" y2="58" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="var(--accent-2, #2B2E83)"/>
      <stop offset="1" stop-color="var(--accent, #6C5CE7)"/>
    </linearGradient>
  </defs>
  <g fill="none" stroke="url(#octoGrad)" stroke-width="6" stroke-linecap="round">
    <circle cx="32" cy="18" r="10"/>
    <path d="M 32 28 L 32 36"/>
    <path d="M 32 36 C 24 38, 16 42, 14 50"/>
    <path d="M 32 36 L 32 54"/>
    <path d="M 32 36 C 40 38, 48 42, 50 50"/>
  </g>
  <g fill="var(--paper, #F5F6F8)">
    <circle cx="14" cy="50" r="4.5"/>
    <circle cx="32" cy="54" r="4.5"/>
    <circle cx="50" cy="50" r="4.5"/>
  </g>
</svg>
```

**Glyph (below 24 px, 32-box):** same anatomy at half scale, arc dots dropped — used for the favicon and any tiny context.

```svg
<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" fill="none" role="img" aria-label="OctoMeta">
  <circle cx="16" cy="9" r="5" stroke="currentColor" stroke-width="2"/>
  <g stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <path d="M 16 14 L 16 18"/>
    <path d="M 16 18 C 12 19, 8 21, 7 25"/>
    <path d="M 16 18 L 16 27"/>
    <path d="M 16 18 C 20 19, 24 21, 25 25"/>
  </g>
  <g fill="none" stroke="currentColor" stroke-width="1.4">
    <circle cx="7"  cy="25" r="2.2"/>
    <circle cx="16" cy="27" r="2.2"/>
    <circle cx="25" cy="25" r="2.2"/>
  </g>
</svg>
```

**App icon (Apple platforms):** symbol only, no wordmark, centered on the standard rounded-square canvas built from a 1024×1024 master. Ship a light appearance (paper canvas, ink or gradient mark) and a dark appearance (`--ink` canvas, paper mark); generate shipping sizes from the master via Apple's icon tooling rather than hand-exported PNGs.

**Rules.** Default context is the monoline outline in `currentColor` with arc nodes in `--accent` — this is what ships in-product (UI chrome, favicon, docs). The gradient filled stamp is reserved for marketing/brand moments (hero, splash, decks, social avatars, app icon). Clear space = one ring-node diameter on all sides. Minimum size 16 px; below 24 px always the glyph. Animation means computation only: a pulse traveling the arc, or a ring flash on hover, then stillness. Never rotate, flip, stretch, or add a face.

**Wordmark:** `OctoMeta` set in Inter Tight 600, tracking −0.02em; "Meta" may render in `--grey-1` next to ink "Octo" in large lockups; single weight/color in small sizes. Mark-left lockup, gap = 0.6× mark height.

### 2.1 Provenance and open flag

This mark replaces the v1 eight-arm "Octet" per a submitted reference image and logo-system writeup (Apple HIG-informed: text-free app icon, layered light/dark appearances, restrained iconography). The construction above is hand-traced from a raster preview only — the source SVGs referenced by that writeup were not retrievable (they pointed to another tool's ephemeral sandbox storage, not a live URL) — so treat the coordinates as a first pass to true up if real vector source ever surfaces.

**Unresolved:** §1's tagline ("*One mind. Eight arms.*") and premise copy are built on the octopus's eight limbs and no longer match a three-legged mark. This doc doesn't touch §1 — that's a copy decision, not a token/logo one — flagging it for a follow-up call.

Reference palette from the submitted study (for traceability; only `--accent`/`--accent-2` were adopted into tokens — see §3):

| Swatch | Hex | Mapped to |
|---|---|---|
| Near-black navy | `#0B1020` | close to existing `--ink` (`#0B0B0C`) — left unchanged |
| Deep indigo | `#2B2E83` | `--accent-2` (gradient stop, logo-only) |
| Violet | `#6C5CE7` | `--accent` |
| Light violet | `#A99CFF` | `--accent-light` |
| Off-white | `#F5F6F8` | close to existing `--paper` (`#FAFAF9`) — left unchanged |

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
  --accent:       #6C5CE7;   /* "graph violet" — THE accent. Allowed: computed values,
                                value chips, dependency pulses, dimension lines,
                                logo arc nodes, CTA hover, focus rings. Nothing else. */
  --accent-2:     #2B2E83;   /* deep indigo — gradient partner to --accent. Logo
                                filled brand stamp ONLY (see DESIGN.md §2). Never
                                in UI chrome. */
  --accent-light: #A99CFF;   /* tints where --accent-dim reads too subtle */
  --accent-dim:   rgba(108,92,231,.10);
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
**Don't:** second accent color or gradient anywhere outside the logo's filled brand stamp (§2 — `--accent-2` and the gradient never appear in UI chrome, chips, or buttons); shadows (elevation = border + surface shift); octopus illustration/mascot anywhere (the mark is a diagram, not a character); accent in headings; stock imagery; dark-mode improvisation (a dark theme is a future, tokenized decision — invert paper/ink, keep accent).

## 7. Surface mapping

| Surface | Tokens applied | Signature element |
|---|---|---|
| Landing page | Full set | Live hero demo (edit → chips flash → pulses → footing re-extrudes) |
| Reveal.js decks | Full set; slide bg `--paper`; H2 per slide; hairline footer with mark + page tag | Comparison-matrix slide |
| App shell (SvelteKit) | Import `tokens.css` from `src/lib/styles`; chips/errors/pulses identical to marketing | The document itself |
| PDF export | Print-safe subset (pure black text, accent preserved for chips) | Show-steps blocks |
