# OctoMeta · ARCHITECTURE.md

*What is actually built, where it lives, and the decisions behind it. Updated as the codebase grows; the forward-looking plan lives in [PRD.md](PRD.md).*

**Last updated:** 18 July 2026 · landing page redesign (octopus narrative retired) + Convex hookup (pre-M0).

## Current state

A SvelteKit + Svelte 5 (runes) + TypeScript app containing the marketing landing page, with a Convex project provisioned and the client wired into the layout. **No Convex functions, schema, or data access exist yet**; backend work starts with the M0 spikes (PRD §7).

## Stack in use

| Layer | Choice | Status |
|---|---|---|
| Framework | SvelteKit 2 + Svelte 5 (runes), TypeScript | In use |
| Backend | Convex (`convex` + `convex-svelte`) | Client wired; no functions yet |
| Package manager | pnpm (single package; Turborepo deferred until there's more than one) | In use |
| Adapter | `@sveltejs/adapter-auto` | Placeholder; deployment target undecided |
| Fonts | Inter, Inter Tight, JetBrains Mono via Google Fonts (`src/app.html`) | In use |

## Layout

```
src/
  app.html                  fonts, favicon, meta shell
  convex/                   Convex functions root (convex.json points here);
    _generated/             only generated stubs so far, no functions written
  lib/
    styles/
      tokens.css            design tokens, 1:1 with DESIGN.md §3, the single source of truth
      base.css              resets, type primitives (.eyebrow/.sub/.mono), .chip/.err,
                            .btn + arrow micro-interactions, shared motion keyframes
                            (rise/reveal/flash/pulse), reduced-motion kill switch
    actions/
      reveal.ts             scroll-reveal action (IntersectionObserver, progressive
                            enhancement: no-op without JS or with reduced motion)
    components/
      Logo.svelte           the mark: hairline ring + one accent node (currentColor;
                            optional once-around orbit on nav-lockup hover)
      Lockup.svelte         mark + single-ink wordmark
      DimDivider.svelte     dimension-line section divider
      Nav.svelte            sticky nav: transparent at top, hairline + blur on scroll
      HeroDemo.svelte       signature demo: footing.B slider → chips flash, dependency
                            pulse, isometric pad footing re-extrudes (staged; no engine)
      GraphDiagram.svelte   §01 exhibit with in-view dependency pulses
      Waitlist.svelte       signup form; persists to localStorage until backend exists
      Footer.svelte
  routes/
    +layout.svelte          setupConvex(PUBLIC_CONVEX_URL) + global CSS imports
    +page.svelte            landing page composition + section-level styles
static/favicon.svg          the mark
docs/references/            original static mockups (index.html is the landing reference)
```

## Decisions taken

- **The octopus / "eight arms" narrative is retired** (user decision, 18 Jul 2026): no such copy anywhere, and the eight-armed mark was replaced by a ring-plus-accent-node mark. DESIGN.md §1–2 were rewritten to match; the old mark survives only in `docs/references/`. The tagline is now "Edit once. Everything follows."
- **Motion model:** one-time staggered hero entrance (`rise` keyframes with `both` fill, so reduced-motion users see content immediately), scroll reveals via the `reveal` action (adds hidden state only after JS confirms motion is allowed), and the computation pulses from v1. No parallax or scroll-jacking.
- **Tokens are global CSS custom properties** (`src/lib/styles/tokens.css`), imported once in the layout. The future app shell imports the same file (PRD §5, DESIGN.md §7); marketing and app must not drift.
- **Component-scoped styles, shared primitives global.** Anything used across surfaces (chips, errors, buttons, eyebrows, motion keyframes) lives in `base.css`; section styling stays scoped in its component. Keyframes triggered via dynamically-added classes (`cellflash`, `deprun`, `chipflash`) are global on purpose: Svelte's scoper can't see runtime `classList` usage.
- **The hero demo is theatre, not the product.** `HeroDemo.svelte` hard-codes a pad-footing bearing check (`q_b = P/B²`); the pad polygons are a pure derived function of `footing.B`, and the dependency hairline is measured from the live DOM. When the real graph engine exists it replaces the arithmetic, not the presentation. The example is deliberately geotechnical and generic rather than bridge-specific.
- **Waitlist has no backend yet, deliberately.** Submissions go to `localStorage["octometa-waitlist"]` so nothing is lost during development. The upgrade path is a single Convex mutation (see comment in `Waitlist.svelte`); the client is already in context via the layout.
- **Convex functions live in `src/convex/`** (`convex.json`), per the Convex Svelte quickstart. Dev deployment: project `octometa`, deployment `amiable-leopard-466` (URLs in `.env.local`, gitignored).
- **Motion policy enforced globally:** `prefers-reduced-motion` disables all animation *and* the demo auto-loops (checked in JS in `HeroDemo`/`GraphDiagram`).

## Verification

`pnpm check` (0 errors/warnings), `pnpm build` passes, page SSRs correctly at `/`.

## Next (not started)

M0 spikes from PRD §8: Univer-in-TipTap NodeView, Convex round-trip (first real functions + schema), occt-wasm browser matrix, Facade spill behavior. First backend milestone should also move the waitlist off localStorage.
