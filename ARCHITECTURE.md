# OctoMeta · ARCHITECTURE.md

*What is actually built, where it lives, and the decisions behind it. Updated as the codebase grows; the forward-looking plan lives in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) (with [PRD.md](PRD.md) for the why).*

**Last updated:** 19 July 2026 · waitlist backend live on Convex + Resend; V1/V2/V3 version arc adopted (IMPLEMENTATION_PLAN.md v3).

## Current state

A SvelteKit + Svelte 5 (runes) + TypeScript app containing the marketing landing page, with a **live Convex backend for the waitlist**: idempotent `waitlist.join` mutation, confirmation emails through the Resend component, a delivery-status webhook, and a cleanup cron. No product tables (documents/graph) and no engine code exist yet; V1 work starts with IMPLEMENTATION_PLAN.md V1-0-1 (scaffold) and V1-1-1 (engine types), which can run in parallel.

## Stack in use

| Layer | Choice | Status |
|---|---|---|
| Framework | SvelteKit 2 + Svelte 5 (runes), TypeScript | In use |
| Backend | Convex (`convex` + `convex-svelte`) | Waitlist mutation/schema live; product tables not started |
| Email | Resend via `@convex-dev/resend` | Confirmation email + delivery webhook live |
| Package manager | pnpm (single package; Turborepo deferred until there's more than one) | In use |
| Adapter | `@sveltejs/adapter-auto` | Placeholder; deployment target undecided |
| Fonts | Inter, Inter Tight, JetBrains Mono via Google Fonts (`src/app.html`) | In use |

## Layout

```
src/
  app.html                  fonts, favicon, meta shell
  convex/                   Convex functions root (convex.json points here)
    schema.ts               waitlist table (indexes: by_email, by_confirmation_email_id)
    waitlist.ts             join mutation: idempotent on email; queues confirmation email,
                            signup never fails on email errors
    emails.ts               Resend component setup (FROM_ADDRESS, resend client)
    http.ts                 Resend delivery-status webhook
    crons.ts                Resend component cleanup schedule
    _generated/             generated stubs
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
      Waitlist.svelte       signup form; submits via api.waitlist.join (convex-svelte client)
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
- **Version arc adopted** (user decision, 19 Jul 2026 · IMPLEMENTATION_PLAN.md v3): **V1** working prototype = pure-TS graph engine (`src/lib/engine/`) + Convex persistence + TipTap block document where text/markdown, images, and **Univer sheet blocks (the calculation engine)** coexist reactively, with live chips, show-steps, and a provenance inspector (the QAQC/no-black-box surfaces ship in V1). **V2** connects the geometry viewer (kernels, viewer block, PDF/IFC, templates). **V3** adds MCP + AI on the hooks built in V1. **No node/graph editor in any version**: graph relationships surface through published names, chip deep-links, and the provenance inspector.
- **Waitlist is live on Convex + Resend** (19 Jul 2026): idempotent `join` mutation (re-signup patches the existing row), confirmation email sent once per address with delivery status tracked via webhook; email failure never fails the signup. This is production code, not spike code; the earlier localStorage fallback is gone.
- **Convex functions live in `src/convex/`** (`convex.json`), per the Convex Svelte quickstart. Dev deployment: project `octometa`, deployment `amiable-leopard-466` (URLs in `.env.local`, gitignored).
- **Motion policy enforced globally:** `prefers-reduced-motion` disables all animation *and* the demo auto-loops (checked in JS in `HeroDemo`/`GraphDiagram`).

## Verification

`pnpm check` (0 errors/warnings), `pnpm build` passes, page SSRs correctly at `/`.

## Next (not started)

V1-0 from IMPLEMENTATION_PLAN.md v3: workspace scaffold + dependency pinning (V1-0-1), Univer-in-TipTap NodeView spike (V1-0-2), Facade custom-function/spill spike (V1-0-3), decision memo (V1-0-4). Engine work (V1-1-1 onward) starts in parallel; nothing in the engine waits on the spikes. The occt-wasm spike moved to V2-0.
