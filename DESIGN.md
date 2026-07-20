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

> **v2 direction — this section supersedes the v1 "Octet" mark.** Provenance is logged in §2.1.

**Concept ("Node"):** a rounded head over three legs, each ending in a knocked-out ring; a shallow arc threads the legs together with three accent nodes underneath. Head = one mind; the three legs = the load-bearing projections (sheet, report, viewer); the arc = *Meta*, the graph running under them. Solid silhouette, no eyes, no suckers, no mascot.

**Source files:** `static/brand/` holds the shipped vector pack — `octometa_mark_outline.svg` (primary, ≥48 px), `octometa_mark_filled.svg` (compact, <48 px), `octometa_mark_mono_black.svg` / `octometa_mark_mono_white.svg` (single-tone), `octometa_icon_light.svg` / `octometa_icon_dark.svg` / `octometa_icon_gradient.svg` (app icon, 1000-box rounded square), `octometa_wordmark.svg`, and the two horizontal lockups. Path data below is copied verbatim from `octometa_mark_outline.svg` (1000-box viewBox) — don't hand-edit coordinates outside that source.

**Primary mark — outline (1000-box, ≥48 px):** brand gradient body (navy → indigo → violet), paper knockout for the head ring and the three leg-end rings, `--accent` graph arc with three ring nodes.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" role="img" aria-label="OctoMeta">
  <defs>
    <linearGradient id="octoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="var(--ink, #0B1020)"/>
      <stop offset="55%" stop-color="var(--accent-2, #2B2E83)"/>
      <stop offset="100%" stop-color="var(--accent, #6C5CE7)"/>
    </linearGradient>
  </defs>
  <path d="M 500 115 C 365 115 285 215 285 335 C 285 420 325 475 355 515 C 315 560 270 600 200 610 C 125 620 90 680 105 745 C 120 815 190 850 250 820 C 300 795 325 745 315 695 C 350 670 390 645 425 620 C 450 650 470 685 470 730 L 470 785 C 420 800 390 845 400 900 C 410 960 470 995 525 975 C 575 955 600 900 580 850 C 565 815 535 795 510 785 L 510 730 C 510 685 530 650 555 620 C 590 645 630 670 665 695 C 655 745 680 795 730 820 C 790 850 860 815 875 745 C 890 680 855 620 780 610 C 710 600 665 560 625 515 C 655 475 695 420 695 335 C 695 215 615 115 500 115 Z" fill="url(#octoGrad)"/>
  <path d="M 500 185 C 405 185 350 255 350 345 C 350 430 400 500 500 530 C 600 500 650 430 650 345 C 650 255 595 185 500 185 Z" fill="var(--paper, #F5F6F8)"/>
  <circle cx="210" cy="715" r="58" fill="var(--paper, #F5F6F8)"/>
  <circle cx="490" cy="885" r="58" fill="var(--paper, #F5F6F8)"/>
  <circle cx="770" cy="715" r="58" fill="var(--paper, #F5F6F8)"/>
  <path d="M 390 650 C 430 705 460 735 500 760 C 540 735 570 705 610 650" fill="none" stroke="var(--accent, #6C5CE7)" stroke-width="18" stroke-linecap="round"/>
  <circle cx="390" cy="650" r="20" fill="var(--paper, #F5F6F8)" stroke="var(--accent, #6C5CE7)" stroke-width="12"/>
  <circle cx="500" cy="760" r="22" fill="var(--paper, #F5F6F8)" stroke="var(--accent, #6C5CE7)" stroke-width="12"/>
  <circle cx="610" cy="650" r="20" fill="var(--paper, #F5F6F8)" stroke="var(--accent, #6C5CE7)" stroke-width="12"/>
</svg>
```

**Compact mark — filled (<48 px, favicon, inline lockups):** same silhouette, head-ring knockout dropped for legibility at small size, arc rendered paper-on-gradient with solid `--accent` nodes.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" role="img" aria-label="OctoMeta">
  <defs>
    <linearGradient id="octoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="var(--ink, #0B1020)"/>
      <stop offset="55%" stop-color="var(--accent-2, #2B2E83)"/>
      <stop offset="100%" stop-color="var(--accent, #6C5CE7)"/>
    </linearGradient>
  </defs>
  <path d="M 500 115 C 365 115 285 215 285 335 C 285 420 325 475 355 515 C 315 560 270 600 200 610 C 125 620 90 680 105 745 C 120 815 190 850 250 820 C 300 795 325 745 315 695 C 350 670 390 645 425 620 C 450 650 470 685 470 730 L 470 785 C 420 800 390 845 400 900 C 410 960 470 995 525 975 C 575 955 600 900 580 850 C 565 815 535 795 510 785 L 510 730 C 510 685 530 650 555 620 C 590 645 630 670 665 695 C 655 745 680 795 730 820 C 790 850 860 815 875 745 C 890 680 855 620 780 610 C 710 600 665 560 625 515 C 655 475 695 420 695 335 C 695 215 615 115 500 115 Z" fill="url(#octoGrad)"/>
  <circle cx="210" cy="715" r="58" fill="var(--paper, #F5F6F8)"/>
  <circle cx="490" cy="885" r="58" fill="var(--paper, #F5F6F8)"/>
  <circle cx="770" cy="715" r="58" fill="var(--paper, #F5F6F8)"/>
  <path d="M 390 650 C 430 705 460 735 500 760 C 540 735 570 705 610 650" fill="none" stroke="var(--paper, #F5F6F8)" stroke-width="15" stroke-linecap="round" opacity="0.92"/>
  <circle cx="390" cy="650" r="18" fill="var(--accent, #6C5CE7)" stroke="var(--paper, #F5F6F8)" stroke-width="9"/>
  <circle cx="500" cy="760" r="20" fill="var(--accent, #6C5CE7)" stroke="var(--paper, #F5F6F8)" stroke-width="9"/>
  <circle cx="610" cy="650" r="18" fill="var(--accent, #6C5CE7)" stroke="var(--paper, #F5F6F8)" stroke-width="9"/>
</svg>
```

**Single-tone (print, monochrome reproduction, dark UI chrome):** `octometa_mark_mono_black.svg` / `octometa_mark_mono_white.svg` in `static/brand/` — flat ink or paper fill, no gradient, no accent.

**App icon (Apple platforms):** `octometa_icon_light.svg` (paper canvas, gradient mark) and `octometa_icon_dark.svg` (`--ink` canvas, paper mark) — symbol only, no wordmark, rounded-square canvas baked into the 1000-box source. `octometa_icon_gradient.svg` (gradient canvas, paper mark) is the marketing/App Store variant. Generate shipping sizes from these masters via Apple's icon tooling.

**Rules.** The gradient is fixed brand identity, not theme-adaptive — it renders the same on light and dark surfaces; only the paper/ink knockouts and the accent swap for the mono variants. Clear space = one leg-ring diameter on all sides. Minimum size 16 px; below 48 px use the compact filled mark. Animation means computation only: a pulse traveling the arc, or a ring flash on hover, then stillness. Never rotate, flip, stretch, or add a face.

**Wordmark:** `octometa_wordmark.svg` — `OctoMeta` set in Inter (Inter Tight in-product), weight 600, tracking −0.024em (letter-spacing −6 at the 1000-box wordmark's 150 px type size), ink fill. Mark-left lockup, gap = 0.6× mark height — see `octometa_logo_horizontal_outline.svg` / `_filled.svg`.

### 2.1 Provenance

v2 replaces the v1 eight-arm "Octet" per a submitted logo-system writeup and reference image; the writeup's own asset links were unreachable (another tool's ephemeral sandbox), so an earlier pass of this doc hand-traced the mark from a raster preview. The full vector pack has since been supplied (`static/brand/`, source `octometa_logo_system.zip`), and the construction above is now copied directly from it — the earlier hand-traced approximation is superseded.

One bug fixed in transit: `octometa_icon_gradient.svg` shipped with a malformed `<svg>` tag (`<defs>` placed before the root element's attributes closed, which XML parsers reject). Fixed in the copy under `static/brand/`.

**Unresolved:** §1's tagline ("*One mind. Eight arms.*") and premise copy are built on the octopus's eight limbs and still don't match a three-legged mark. This doc doesn't touch §1 — that's a copy decision, not a token/logo one.

Reference palette (`static/brand/README.md`; adopted into tokens — see §3):

| Swatch | Hex | Mapped to |
|---|---|---|
| Near-black navy | `#0B1020` | close to existing `--ink` (`#0B0B0C`) — left unchanged, reused as the gradient's dark stop |
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
                                mark ONLY (see DESIGN.md §2). Never in UI chrome. */
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
**Don't:** second accent color or gradient anywhere outside the logo mark (§2 — `--accent-2` and the gradient never appear in UI chrome, chips, or buttons); shadows (elevation = border + surface shift); octopus illustration/mascot anywhere (the mark is a diagram, not a character); accent in headings; stock imagery; dark-mode improvisation (a dark theme is a future, tokenized decision — invert paper/ink, keep accent).

## 7. Surface mapping

| Surface | Tokens applied | Signature element |
|---|---|---|
| Landing page | Full set | Live hero demo (edit → chips flash → pulses → footing re-extrudes) |
| Reveal.js decks | Full set; slide bg `--paper`; H2 per slide; hairline footer with mark + page tag | Comparison-matrix slide |
| App shell (SvelteKit) | Import `tokens.css` from `src/lib/styles`; chips/errors/pulses identical to marketing | The document itself |
| PDF export | Print-safe subset (pure black text, accent preserved for chips) | Show-steps blocks |
