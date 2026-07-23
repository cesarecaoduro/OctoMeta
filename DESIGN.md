# OctoMeta — DESIGN.md (v1)
*Brand, logo, and design tokens. One source of truth for the marketing site, the deck, and the app shell.*

---

## 1. Brand premise

An octopus keeps roughly two-thirds of its neurons in its arms: eight limbs that sense and act semi-independently, coordinated by one mind. OctoMeta's architecture is the same — independent projections (grid, report, 3D viewer) each doing real work, coordinated by **one typed dependency graph**. *Meta* is the graph above the views.

**Canonical vision line (hero, decks, README):**
> OctoMeta is the living engineering document. Your calculations, your report, and your 3D model are arms of a single intelligent graph — edit anywhere, and every arm follows.

**Tagline:** *One mind. Eight arms.*

**Voice:** engineer-to-engineer. Confident, precise, zero fluff. Plain verbs, sentence case, active voice. We never say "revolutionary"; we show a cell edit moving a beam.

### 1.1 Experience north star

**Apple-caliber, OctoMeta-native.** Apply Apple's principles of hierarchy, clarity,
adaptability, tactile feedback, and purposeful motion without imitating an Apple
product or replacing OctoMeta's visual identity. The paper/ink/violet palette,
engineering typography, dependency lines, and computation motifs remain distinctive.

**Calm at rest, alive in response.** Reading and authoring surfaces remain quiet and
trustworthy; chrome recedes until relevant. Selection, direct manipulation,
computation, and completion may briefly introduce violet, material depth, and motion.
Empty states, onboarding, and marketing may be more expressive. Never use permanently
glowing controls, moving backgrounds, animated gradients, or continuous glass shimmer.

Use an **icon-first, not icon-only** control language. Familiar, repeated actions may
use icon-only controls when they retain an accessible name and discoverable tooltip.
Ambiguous, destructive, or OctoMeta-specific actions keep a visible text label, either
beside the icon or in an opened menu. Never trade comprehension or accessibility for
visual minimalism.

The authenticated workbench defines the shared interaction and visual system because
it contains the product's densest workflows. Apply that system across the complete
experience in this order: workbench, document library, sign-in, then marketing.

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
  --accent:       #6C5CE7;   /* "graph violet" — the system tint. Allowed: active
                                selection, focus, primary-action feedback, computed
                                values, value chips, dependency pulses, dimension
                                lines, logo arc nodes, and the §6 text-emphasis doses.
                                4.65:1 on paper — AA at any text size. */
  --accent-2:     #2B2E83;   /* deep indigo — gradient partner to --accent. Logo
                                mark ONLY (see DESIGN.md §2). Never in UI chrome. */
  --accent-light: #A99CFF;   /* decoration ONLY (2.26:1 on paper — fails AA as
                                text): underline emphasis, ticks, tints where
                                --accent-dim reads too subtle. Never glyphs. */
  --accent-dim:   rgba(108,92,231,.10);
  --error:      #C42B1C;   /* validation, persistence, access, destructive intent,
                              and typed graph errors (#UNIT!, #CYCLE!) */
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

### 3.1 Appearance

Light and dark are first-class appearances across the complete experience, including
the Document, Workbook, equations, floating chrome, authentication, and marketing.
Follow the operating-system appearance by default and offer `System`, `Light`, and
`Dark` preferences. Define semantic tokens for each appearance rather than mechanically
inverting values; preserve the violet identity while selecting theme-specific tints
that meet contrast requirements. Never ship a partially themed surface.

Violet is the system tint for selection, focus, primary-action feedback, published or
computed values, and dependency activity. It may tint selected icons and restrained
material fills, but never whole toolbars, large backgrounds, or body copy. Define
independent success, warning, error, and informational roles for each appearance;
status never borrows violet and never relies on color alone.

### 3.2 Adaptive layout

Use three content-driven modes based on available container width, never device names
or user-agent detection:

- **Compact** focuses one primary workspace at a time and places frequent controls
  within comfortable touch reach.
- **Regular** composes the Document with one companion workspace only when the
  available content area supports both.
- **Expanded** places the independently scrolling Workbook in a non-overlaying bottom
  drawer that resizes the Document viewport.

Choose transitions where content and controls stop working, then verify continuously
on both sides of each threshold. Treat orientation, window resizing and iPad
multitasking, safe-area insets, Dynamic Type, browser zoom, virtual keyboards, and
input modality as independent variables.

### 3.3 Typography behavior

Inter Tight remains the branded display face, Inter the interface and prose face, and
JetBrains Mono the computational face. Apply Apple-like discipline through hierarchy,
leading, concise labels, and fluid scaling rather than copying Apple's system
typography. Layouts must tolerate browser text zoom and larger accessibility text
without clipping content or hiding actions. Keep editable controls at least 16 px in
compact layouts to prevent unwanted mobile Safari zoom.

### 3.4 Input independence

Touch, keyboard, pointer, and Apple Pencil are equally valid inputs. Touch receives
reachable controls and explicit menus; pointer input may add hover previews, precision
resizing, and secondary-click shortcuts; keyboards receive complete focus navigation,
standard shortcuts, and the command palette. Apple Pencil behaves as a precise pointer
for selection, caret placement, dragging, resizing, and supported hover previews.
Handwriting, sketching, and freeform annotation are not implied product capabilities.
No essential action may require one input method.

### 3.5 Accessibility

WCAG 2.2 AA is a release gate in both appearances. Support complete keyboard
operation, visible focus, correctly named and stateful icon controls, robust
screen-reader structure, and reflow without lost functionality at 400% zoom or a
320 CSS-pixel viewport. Respect reduced motion, reduced transparency where a web
equivalent is available, increased contrast, and forced colors. Never communicate
meaning through color, blur, material, sound, or motion alone. Accessibility may
override icon-only presentation or translucent styling.

Verification combines automated checks with manual focus-order, sheet/dialog focus
management, grid navigation, virtual-keyboard, and VoiceOver testing in Safari on
macOS, iPhone, and iPad.

### 3.6 Platform boundary

OctoMeta remains a cross-platform SvelteKit web application with first-class Safari
behavior on iPhone, iPad, and macOS. Account for safe areas, dynamic viewport height,
browser chrome, virtual keyboards, Back gestures, mixed input, and standalone/PWA
presentation while preserving equivalent capability in other modern browsers. Apply
Apple principles without imitating native-only components or behaviors that the web
cannot reproduce honestly. A native application or wrapper is a separate future
product decision.

## 4. Motifs

- **Arms as dependency lines.** Hairline curves (1px `--grey-3`) with travelling accent pulses are the signature motif — in the logo, the hero demo, and section diagrams. A pulse means *computation happened*.
- **Dimension dividers.** Section breaks are dimension lines: 1px rule, 9px end ticks, mono tags (`§ 03 ——— GEOMETRY`). Engineering-drawing vernacular, used with restraint.
- **Mono = computational.** Anything the graph touches — formulas, units, handles, node names — renders in JetBrains Mono. Prose never does.
- **Functional material.** The Document canvas stays matte and paper-like. Floating chrome
  may use restrained translucency, backdrop blur, and soft elevation to clarify genuine
  overlap. Prefer hairlines and surface contrast first; never apply glass or shadow as
  decoration across ordinary content.
- **Icon language.** Use Lucide as the base family for familiar actions and a small,
  optically matched OctoMeta set for domain concepts. Route icons through one shared
  primitive that owns size, stroke, alignment, state, tooltip, accessible naming, and
  touch-target behavior. Do not use Unicode symbols, emoji, or mismatched one-off SVGs
  as controls.
- **Structured geometry.** Engineering content, grids, and equations keep crisp
  alignment and restrained radii. Floating panels, menus, sheets, toolbars, and
  segmented controls use more generous concentric curves. Reserve pills for values,
  compact states, segmented choices, and a few primary controls. The mark's rounded
  nodes may inform handles, selection points, and activity indicators without making
  every button or card a capsule.

## 5. Motion principles

Every animation must provide **feedback**, preserve **continuity**, or communicate
**computation**. Feedback acknowledges direct actions and state changes. Continuity
shows where panels, sheets, blocks, and workspaces come from or go. Computation retains
OctoMeta's signature recompute flashes and dependency pulses.

Prefer brief, interruptible transitions; gesture-driven movement tracks the gesture.
Use subtle press feedback, icon-state transitions, and layout reflow where they improve
understanding. No parallax, scroll-jacking, gratuitous loops, or decorative entrance
reveals.

When `prefers-reduced-motion` is active, replace spatial movement, scale, animated blur,
and springs with short opacity changes or immediate state changes. Information and
feedback must never depend on animation. Disable all automatic demo loops.

The signature interaction is the **computation trace**. After a committed source edit,
briefly activate its node, send one restrained pulse through the affected dependency
path, and settle updated values in sequence. When several workspaces are visible, the
trace may connect them without moving the viewport. Never run it per keystroke or
animate every edge of a large graph; summarize broad changes. Reduced motion replaces
travel with simultaneous source/destination emphasis and a textual announcement.

## 6. Application rules (do / don't)

**Do:** paper background everywhere; product-as-hero; one bold moment per surface (landing = live demo; deck = matrix slide); 8-px spacing scale only; AA contrast (`--grey-1` is the floor for body text; `--accent` passes AA on paper at any size, `--accent-light` never renders glyphs).

**Accent as text emphasis** (v2, supersedes the old "no accent in headings" rule): accent appears in prose only as fixed, single-dose emphasis, never as whole sentences or whole headings —
- **heading full stops** — display headings end with an accent period (`.ap`), the graph touching the end of every claim;
- **one keyword in the hero H1** — italic *and* accent (`.acc-i`), so color never carries the emphasis alone;
- **stat numerals** — computed-cost figures are accent display type; the label stays grey;
- **eyebrow ring-ticks** — section eyebrows open with a 6px accent ring node (`.eyebrow-tick`), the logo's ring node as punctuation; eyebrow text stays grey; not used on eyebrows that serve as panel labels inside demos;
- **mono role/§ labels** — persona labels and the dimension-divider `§` number may take accent (dimension lines are on the §3 allowlist);
- **underline emphasis** — a key phrase may take a 2px `--accent-light` underline under ink text; the light tint is decoration-only.

**Don't:** second accent color or gradient anywhere outside the logo mark (§2 — `--accent-2` and the gradient never appear in UI chrome, chips, or buttons); shadows on ordinary content or elevation without real overlap; octopus illustration/mascot anywhere (the mark is a diagram, not a character); accent on whole headings or body sentences (emphasis doses above only); stock imagery; incomplete or ad hoc appearance overrides outside the semantic token system.

## 7. Surface mapping

### 7.1 Workbench hierarchy

The **Document** is the primary work surface and default destination. Its attached
**Workbook** is a persistent secondary calculation workspace, never a block inside the
Document. **Published values** are managed contextually from within the Workbook rather
than through a separate Parameters destination. The **Inspector** is transient detail
for the current selection and never a permanent navigation destination. The document
library sits outside the workbench and is reached through Back/Documents rather than
persistent editor navigation.

Compact layouts switch the Document and Workbook as focused workspaces and present the
Published-values manager over the Workbook and Inspector as distinct sheets. Regular
and expanded layouts progressively compose the same surfaces without changing their
meaning.

### 7.2 Command architecture

Use progressive, contextual disclosure. The workbench shell owns Back, Document title,
working-copy or Branch identity, distinct local-durability and cloud-version state, a
visible Save new version action, the Workbook toggle, and More. Local durability must
never imply cloud publication. Undo and Redo live in the contextual touch dock,
labelled menus, the command palette, and keyboard shortcuts rather than permanent
global chrome.

Editing tools appear next to the selected content on pointer layouts and in a reachable
contextual toolbar on touch layouts. Workbook and Published-value commands remain
inside the Workbook; Inspector exposes only commands relevant to its current content.
Put history, Branch, export/import, help, activity, and appearance commands in
structured labelled menus. Critical and destructive actions must never depend solely
on a gesture, hover, or keyboard shortcut.

### 7.3 Compact workbench chrome

The compact workbench uses a safe-area-aware top row for Back, truncated Document
title, working-copy identity, combined status detail, and More. A second action row
keeps Save new version visible and provides a labelled segmented switcher between
Document and Workbook; these product-specific actions are not icon-only. A contextual
editing dock sits above the bottom safe-area inset or virtual keyboard. The
Published-values manager opens over the Workbook and Inspector opens as a distinct
detented sheet; both can expand to full height. When height becomes severely
constrained, combine the top rows without removing capabilities.

### 7.4 Workspace sizing

Compact layouts focus the Workbook as a full-screen workspace and use fixed sheet
detents for transient contextual surfaces. Regular layouts compose Document and
Workbook only when both retain viable content areas; otherwise they switch as focused
workspaces. Expanded layouts place the independently scrolling Workbook in a bottom
drawer that shortens rather than overlays the Document viewport. A future adjustable
separator remains keyboard- and touch-accessible; snapping motion is brief and
interruptible. Persist drawer height per Document and layout mode, clamp it after
viewport changes, and provide a labelled command to restore the default layout.

### 7.5 Feedback hierarchy

Direct actions respond at the affected control or content. Routine local or cloud save
success stays in the compact shell status and does not produce a toast. Consequential,
undoable actions receive a transient confirmation with a visible Undo command.
Validation appears beside the exact field, cell, block, or formula. Recoverable system
problems remain visible within the affected workspace; unsafe integrity, access, or
destructive decisions may block progress with a dialog or dedicated state. Significant
persistence outcomes remain reviewable as Activity events. Sound and vibration are
never required, and the web app does not imitate unavailable native haptics.

### 7.6 Document block interaction

Blocks stay visually quiet while idle and text accepts direct caret placement without
an intermediate selection tap. A focused or selected Block reveals a subtle boundary,
one drag handle, and More; pointer hover may preview the same chrome. Reordering
supports direct drag, keyboard commands, and labelled Move actions. Insertion uses a
contextual Add block control near the active gap plus the touch toolbar rather than
permanently exposing actions between every Block. Dragged content receives restrained
functional elevation while neighboring Blocks preserve spatial continuity; reduced
motion applies the final arrangement immediately.

Typing `/` at a valid insertion point and activating Add block open the same searchable
menu. Keyboard presentation supports filtering, arrow navigation, Enter, Escape, and
focus restoration; touch presentation uses a reachable sheet rather than a tiny
popover. It inserts Text, Heading, Section, Equation, and Image Blocks.

A Section is a quiet notebook group whose title, boundary, collapse control, drag
handle, and More become prominent on focus or selection. Moving or deleting a Section
clearly applies to all child Blocks and remains undoable. Collapse is local preference
state, uses brief continuity motion, and never enters cloud versions or exports.
Sections never contain Sections.

Equation Blocks enter direct visual editing in place with no Apply action or
static-versus-bound mode switch. One expression composes authored notation with
multiple stable Published-value reference tokens. Typing `@` or activating Insert
reference opens the shared searchable picker. Invalid or incomplete intermediate math
remains editable and visibly flagged; Escape restores the edit-session starting state
and Cmd/Ctrl+Enter finishes editing. Compact layouts keep equation content, the math
keyboard, and reference sheet usable without page-level horizontal overflow.
Projection updates never steal focus or replace active controls.

Image Blocks created through file selection, drag-and-drop, or clipboard paste use the
same locally owned model and appear immediately after validation. Idle images read as
Document content rather than cards. Selection reveals bounded resize handles and
contextual alignment, caption, alternative text, replace, and remove actions. Pointer
layouts support direct resizing; touch layouts add coarse handles and accessible width
presets or numeric width. Preserve aspect ratio by default. Missing bytes and
validation failures stay in place with recovery actions. Cloud-upload language appears
only during Save new version, and remote hotlinks are not offered.

### 7.7 Workbook density

Preserve a dense, familiar calculation grid while making its chrome Apple-caliber.
Workbook controls, tabs, menus, resize handles, and formula actions retain 44×44 touch
targets; individual cells are a deliberate density exception. Selection receives a
generous visible focus treatment and touch-friendly handles without inflating every
row. Keep the formula line and sheet tabs persistently reachable. Compact mode gives
the Workbook the available workspace and moves contextual cell actions into the touch
dock. Grid zoom or density is adjustable, and both appearances theme the complete grid
rather than only its surrounding chrome.

### 7.8 Published values and Inspector

Published values belong to a searchable contextual manager within the Workbook.
Selecting one can navigate to its source, disclose usage and publication metadata, or
open Inspector detail. Document and equation insertion flows use searchable
Published-value pickers and link to the publication action when none exist. Inspector
remains a transient provenance surface invoked explicitly from a live reference,
equation reference, Published value, or Workbook cell. On compact layouts, the
Published-values manager opens over the Workbook and Inspector uses the same sheet
infrastructure without becoming the same concept.

### 7.9 Marketing expression

Marketing uses large, confident typography and generous negative space, but the
product remains the spectacle. The hero is a real interactive OctoMeta demonstration:
one engineering edit updates the Document, Workbook, equation, and dependency graph.
Later sections isolate those relationships through focused product views and purposeful
computation motion. Scrolling reveals narrative without hijacking it. Compact layouts
receive a simplified, touchable version of the same demonstration rather than a static
screenshot or a compressed desktop animation. Primary calls to action remain visibly
labelled. Do not use abstract glass sculpture, stock imagery, device-mockup walls, or
generic AI glow.

### 7.10 Document library

The library is adaptive and list-first. Search remains prominent at every width.
Expanded layouts present Live and Trash as sidebar destinations; smaller layouts use a
compact segmented control. Rows stack secondary metadata and move actions into More as
space contracts. Touch enters an explicit selection mode for bulk actions while
pointer layouts may expose checkboxes. Swipes may accelerate common actions only when
every action also exists in a labelled menu. New document remains a visible primary
action. Empty, offline, and recovery states may be more expressive than real document
rows, which remain calm.

### 7.11 Authentication

Authentication progressively discloses the existing methods. Lead with visibly
labelled Google continuation, then email and Continue; after email entry, reveal
password sign-in with a secure magic link as the secondary path. Account creation is
an explicit mode change. Preserve native autofill, password-manager behavior,
validation, loading, and errors. Compact layouts use the full safe area; larger
layouts place the form in a restrained floating material panel. One subtle
dependency-line motif may carry the brand, but authentication uses no decorative
illustration and no icon-only provider controls.

### 7.12 Shell ownership

The document library owns the OctoMeta brand, Documents navigation, appearance
control, and account menu. Opening a Document enters one focused workbench shell that
alone owns Back, title, working-copy or Branch identity, local durability, cloud state,
Save new version, Workbook switching, and More. Do not stack the global app header
above the workbench. The compact mark may appear subtly in menus or transitions
without consuming persistent editor space. Returning to the library restores its
navigation state.

### 7.13 History and Reconciliation

History and Reconciliation use a dedicated full-height task workspace rather than a
popover or Inspector sheet. Regular and expanded layouts pair a version list with a
read-only preview; compact layouts stack list, preview, and actions. Historical
versions offer Create Branch or Restore to working copy and never imply that Main can
rewind.

Reconciliation first summarizes automatically resolved independent changes, then
requires an explicit decision for every remaining conflict. Expanded layouts may
compare conflicting Blocks side by side; compact layouts present one conflict at a
time with clear source labels and a final review. Concurrent Workbook changes remain
one whole-Workbook conflict. Never preselect a side silently. Completion creates the
next Main version and leaves the reconciled Branch visibly read-only.

### 7.14 Branch presentation

The library groups Main and browser-local Branches beneath their parent Document.
Regular and expanded layouts disclose Branch rows beneath the parent; compact layouts
open a Document detail view rather than relying on deep indentation. Every Branch
shows its name, device-local status, base version, last edit time, and active,
divergent, or reconciled state. Reconciled Branches remain visibly read-only until
continued or deleted. Search returns the parent and reveals a matching Branch instead
of presenting it as an unrelated file. Opening a Branch changes the workbench identity
label and never masquerades as Main.

### 7.15 Portable recovery and sign-out

Import OctoMeta file lives in labelled library actions; Export portable copy is
available from Document and Branch menus. Import validates the complete archive before
creating one new independent local Document and creates nothing after any validation
failure.

Sign out first checks for unresolved browser work. When local Documents, dirty working
copies, or Branches remain, open a dedicated Resolve work before sign out workspace
instead of a confirmation dialog. Each item offers only valid Save new version, Export,
or Discard paths with consequences explained. Compact layouts resolve one item at a
time; expanded layouts use a reviewable status list. Sign-out proceeds only after all
items resolve, reports cleanup failures persistently, and always permits cancellation
without deletion.

### 7.16 Help and Activity

Help is a dedicated full-height, searchable, offline-capable workspace. Contextual
links from empty, warning, and error states deep-link to the exact topic and preserve a
return path. Tooltips teach unfamiliar controls but never contain critical state or
recovery instructions.

Activity is a session-scoped sheet or side panel opened from status, grouped
chronologically by severity and affected Document or working copy. Significant save,
upload, Reconciliation, recovery, import/export, and storage outcomes remain
reviewable and may link back to their source. Routine successful local autosave stays
in shell status and creates neither toast nor Activity noise. Explicit successful
actions may use brief toasts; warnings and errors persist until acknowledged or
resolved. Activity is not cloud History.

### 7.17 Save new version

Save new version opens a focused review surface rather than behaving like generic
saving. It shows the proposed Main version, source working copy or Branch, change
summary, assets to upload, warnings, and an optional message. Incomplete calculations
and broken references warn but remain saveable when structurally safe; corruption or
missing required assets block the action with recovery guidance. Compact layouts use a
full-height sheet and larger layouts a spacious modal with the same reading order. The
final action is labelled Save version N.

Progress distinguishes preparation, asset upload, and immutable version creation while
continued local edits remain possible. Identify the captured generation so edits made
during upload remain visibly outside the new cloud version. Offline mode explains why
version creation is unavailable without disabling local authoring. A no-change attempt
states that no new version was created.

| Surface | Tokens applied | Signature element |
|---|---|---|
| Landing page | Full set | Live hero demo (edit → chips flash → pulses → footing re-extrudes) |
| Reveal.js decks | Full set; slide bg `--paper`; H2 per slide; hairline footer with mark + page tag | Comparison-matrix slide |
| App shell (SvelteKit) | Import `tokens.css` from `src/lib/styles`; chips/errors/pulses identical to marketing | The document itself |
| PDF export | Print-safe subset (pure black text, accent preserved for chips) | Show-steps blocks |

## 8. Verification gates

Responsiveness is verified, not inferred from a few device presets. Automated coverage
sweeps from 320 px through expanded desktop widths and exercises both sides of every
content-driven layout transition. Cover compact and regular portrait/landscape,
iPad-style split-window widths, virtual keyboards, long content, validation failures,
offline/read-only states, dense Workbook data, open sheets and dialogs, both
appearances, increased text, reduced motion, touch, and pointer input.

The page must never scroll horizontally by accident; grids, long equations, and code
may scroll only within explicit bounded regions. Completion requires manual VoiceOver
and interaction verification on real iPhone and iPad hardware because desktop browser
emulation does not reproduce mobile Safari reliably.

Perceived performance also blocks acceptance. Ordinary interactions target Interaction
to Next Paint within 200 ms, and press or selection feedback appears by the next
rendered frame. Sheets, menus, resizing, and computation traces target smooth 60 fps
on representative real hardware. Keep transitions interruptible, confine backdrop
blur, stop offscreen animation, and lazy-load heavy workspaces without blocking the
Document. Slow computation communicates progress without freezing editing or
navigation. Verify on older supported iPhone and iPad hardware as well as current
high-end devices.

## 9. Delivery alignment

The accepted cross-cutting specification and its mapping to ADRs and open issues live
in [docs/specs/2026-07-23-apple-caliber-adaptive-interface.md](docs/specs/2026-07-23-apple-caliber-adaptive-interface.md).
Implement the system as verified vertical slices in the dependency order recorded
there; do not schedule a separate cosmetic pass after functional work.
