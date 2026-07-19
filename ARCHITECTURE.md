# OctoMeta · ARCHITECTURE.md

*What is actually built, where it lives, and the decisions behind it. Updated as the codebase grows; the forward-looking plan lives in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) (with [PRD.md](PRD.md) for the why).*

**Last updated:** 19 July 2026 · V1-2 engine (mutation API + undo log, reactive recalc, cycle detection) implemented and unit-tested; V1-1 engine core (values, units, formulas) done; V1-0 de-risk spikes complete (GO, see [docs/v1-0-findings.md](docs/v1-0-findings.md)); waitlist backend live on Convex + Resend; V1/V2/V3 version arc adopted (IMPLEMENTATION_PLAN.md v3).

## Current state

A SvelteKit + Svelte 5 (runes) + TypeScript app containing the marketing landing page, with a **live Convex backend for the waitlist**: idempotent `waitlist.join` mutation, confirmation emails through the Resend component, a delivery-status webhook, and a cleanup cron.

**V1-0 is done.** The workspace is scaffolded (exact-pinned Univer 0.25.1 + TipTap 3.28.0, Vitest on `src/lib/engine/`, Playwright e2e against the production build) and both Univer spikes passed: a Univer sheet lives inside a TipTap NodeView (SSR-safe, focus-isolated, move-safe, serializable), and Facade custom functions spill 2D arrays natively with tagged strings as the `TypedValue` display path. Findings, landmines, and the spike-route promotion plan are in `docs/v1-0-findings.md`.

**V1-1 is done.** The typed core of SCHEMA.md §2–3 + §6 lives in `src/lib/engine/` as pure TypeScript (zero UI imports, enforced by a boundary test): `types.ts` (TypedValue union, Dimension, error taxonomy, ULID ids, cyrb53 content hashing, exhaustive guards), `node.ts` (GraphNode with Provenance/PendingChange stamped from day one), `units.ts` (SI + engineering unit table, canonical-SI quantity storage, dimension algebra, `#UNIT!` checks, `format`/`convert` display conversion that never touches stored values), `formula.ts` (v1 grammar parser with unit literals/cell refs/dotted names, canonical printer, `resolveInputs` deriving edges, `#REF!`/`#NAME?` as values), and `registry.ts` (FnSignature registry with the builtin/user origin seam, quantity-lifted operators, the V1 built-ins, `SHOWSTEPS` stubbed until V1-5-4). 193 Vitest cases including a seeded property test over dimension algebra. `5 kN * 2` → `10 kN` and `kN + m` → `#UNIT!` hold in tests.

**V1-2 is done.** The engine is now reactive end-to-end, still pure TypeScript: `block.ts` (Block/ChipBinding data model, SCHEMA §8), `graph.ts` (`DocumentGraph` in-memory store with derived indexes — name, cellRef, reverse edges, unresolved-ref healing — plus subscribers and the undo-log storage), `mutations.ts` (`applyMutation` as the sole write path for all seven SCHEMA §9 ops, validation-before-commit, provenance stamping, serializable undo/redo with full-prior-state inverses, cycle rejection at mutation time), `topo.ts` (transitive descendants, Kahn topo-sort with cycle capture, `wouldCycle` pre-check), `evaluate.ts` (pure FormulaAST evaluator over the registry), and `recalc.ts` (dirty-set → Kahn → content-hash memo → subscriber notify, `#CYCLE!` marking, the `commit`/`commitUndo`/`commitRedo` facade, dormant `geometryHook`). Edit an input and dependents recompute in dependency order; undo/redo re-settle; the 500-node scalar-chain perf gate (< 50 ms, PRD §4) runs in CI at ~3–5 ms. No product tables yet; next is V1-3-1 (Univer adapter).

## Stack in use

| Layer | Choice | Status |
|---|---|---|
| Framework | SvelteKit 2 + Svelte 5 (runes), TypeScript | In use |
| Backend | Convex (`convex` + `convex-svelte`) | Waitlist mutation/schema live; product tables not started |
| Email | Resend via `@convex-dev/resend` | Confirmation email + delivery webhook live |
| Package manager | pnpm (single package; Turborepo deferred until there's more than one) | In use |
| Calc grid | Univer OSS via `@univerjs/presets` + `@univerjs/preset-sheets-core` **0.25.1 exact** | Spiked (V1-0-2/3); adapter is V1-3-1 |
| Block editor | TipTap `@tiptap/{core,starter-kit,pm}` **3.28.0 exact** | Spiked (V1-0-2); document editor is V1-5 |
| Tests | Vitest 4 (`src/lib/engine/**/*.test.ts`, node env) · Playwright (`e2e/`, prod build, `workers: 1`) | In use (`pnpm test`, `pnpm test:e2e`) |
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
    engine/                   the typed graph — pure TS, zero UI imports (boundary-tested)
      types.ts              TypedValue, Dimension, ErrCode, ULID ids, content hashing, guards
      node.ts               GraphNode + Provenance + PendingChange (V3 hook, stamped never read)
      units.ts              unit table, dimension algebra, parse/format/convert, quantity ops
      formula.ts            FormulaAST, parser, canonical printer, resolveInputs (edges derived)
      registry.ts           FnSignature registry, quantity-lifted operators, V1 built-ins
      block.ts              Block + ChipBinding data model (SCHEMA §8, pure data)
      graph.ts              DocumentGraph store: nodes/blocks/chips, derived indexes,
                            unresolved-ref healing index, subscribers, undo-log storage
      mutations.ts          applyMutation (sole write path, all 7 ops), undo/redo,
                            validation, provenance stamping, cycle rejection
      topo.ts               transitiveDescendants, kahnTopoSort, wouldCycle (pure)
      evaluate.ts           pure FormulaAST evaluator (literals/refs/operators/calls)
      recalc.ts             incremental recalc + #CYCLE! marking + commit facade,
                            dormant geometryHook (V2 seam)
      index.ts              public engine surface (import from here, not internals)
    adapters/                 (V1-3) third-party bridges; only place allowed to import @univerjs; README stub
    persistence/              (V1-4) the only path to Convex for UI code; README stub
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
    spike/                  V1-0 spike routes (no nav links; kept until V1-3-1 promotes them,
                            see docs/v1-0-findings.md): index + univer-in-tiptap NodeView spike
e2e/                        Playwright specs (spike proofs run against `vite preview`)
static/favicon.svg          the mark
docs/references/            original static mockups (index.html is the landing reference)
docs/v1-0-findings.md       V1-0 decision memo: spike outcomes, Univer landmines, go/no-go
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

- **V1-0 spikes: GO** (19 Jul 2026, `docs/v1-0-findings.md`): Univer-in-TipTap works (plain-JS NodeView mounting Svelte 5 `mount()`; `stopEvent`/`ignoreMutation` for isolation; snapshot store keyed by `sid` because block moves recreate the view). Custom functions register through `univerAPI.getFormula().registerFunction` **after lifecycle `Steady`** (earlier throws a redi DI error); 2D returns spill natively; rich values are impossible so `TypedValue` display uses tagged strings intercepted by the adapter. Spike routes stay until V1-3-1 promotes their patterns, then get deleted.

- **Units deferred to V2 in the product** (user decision, 19 Jul 2026): the V1-1-2 quantity/units engine layer stays built, tested, and **dormant** — same pattern as the geometry hooks. No V1 surface (Univer adapter, chips, show-steps, fixtures) parses, renders, or converts units; V1 numbers are plain scalars and `#UNIT!` never surfaces before V2. IMPLEMENTATION_PLAN.md V1-3/V1-5 acceptance was re-tagged accordingly and units surfacing is task V2-U.
- **Engine conventions (V1-1, 19 Jul 2026):** quantities are stored as canonical SI magnitudes; `Dimension.display` is presentation only, so display-unit switches never change stored values or hashes. A dimensionless arithmetic result collapses to `scalar` (a ratio is a bare number). Formula grammar: juxtaposition after a number always means a unit literal (`5 m2` is 5 m²; write `5 * M2` for the cell), `^` right after a unit extends the unit (`(5 m)^2` to square a quantity), `*` is always arithmetic (compound units use `·` or `/`), and in denominators cell-ref lookalikes stay cell refs (`5 kN/m2` divides by M2; write `kN/m^2`). Unary minus binds tighter than `^` (Excel). Errors are values with `origin`; units-layer errors carry `origin: ''` until the evaluator (V1-2-2) stamps the failing node.

- **Engine conventions (V1-2, 19 Jul 2026):**
  - **Undo inverses are restore ops.** SCHEMA §9's public mutations cannot carry full prior state, so the undo system uses two undo-internal ops — `restoreNode {node}` and `restoreChip {chip}` — that restore captured state verbatim (value, inputs, contentHash, provenance, pending). `applyMutation` rejects them at the public boundary; only `undo`/`redo` reach them. Redo is bit-for-bit deterministic: recorded `publishName` entries carry the minted `nodeId`, and redo replays with the entry's original timestamp so `authoredAt` reproduces exactly.
  - **Unresolved refs heal.** The graph keeps an unresolved-ref index (`name:<name>` / `cell:<blockId>␟<a1>` keys). A formula referencing a not-yet-existing cell or name gets `#REF!`/`#NAME?` as its value and registers as a waiter; a later `addNode`/`publishName` re-derives the waiters' inputs and seeds them into the AffectedSet so recalc settles them. Deleting a node converts dependents to `#REF!` immediately (Marimo semantics, SCHEMA §5) with `origin` = the dependent's own id (the removed node no longer exists to deep-link to).
  - **Provenance is authorship, not mechanics.** Actor stamping (`authoredBy/authorId/authoredAt`, clearing `verifiedBy/At`) applies only to nodes a mutation authors; healed waiters and `#REF!`-converted dependents keep their provenance.
  - **Seeds bypass the memo.** Mutations refresh the touched node's `contentHash` (undo round-trips deep-equal *including* hashes), so a seed's stored hash matches while its value is stale; `recalc` re-settles every AffectedSet id unconditionally and applies the salsa-style hash memo only to downstream dirty nodes. Post-pass invariant: stored hash current ⟹ value current, document-wide.
  - **Cycles:** a mutation that would introduce one (self, direct, transitive) is rejected with the would-be cycle in the error (`wouldCycle` pre-check). Cycles that exist anyway (loaded fixtures) are caught by Kahn: every unsortable node — members and trapped descendants — gets `#CYCLE!` listing the group, `origin` = its own id, and a `''` hash sentinel that never memo-matches, so breaking the cycle clears members on the next pass while the acyclic rest keeps evaluating.
  - **blockOp is layout-only for recalc:** add/move/update return an empty AffectedSet (evaluation never reads `position`); `remove` cascade-removes hosted nodes through the same internal path with full inverse capture; `update` treats `null` as field-clearing so inverses stay JSON-safe.
  - **Eager evaluation:** call arguments (IF branches included) evaluate left-to-right before dispatch — a deliberate v1 simplification documented in `evaluate.ts`.
  - **Enforcement note:** the "no projection writes around `applyMutation`" lint/test (cross-cutting rule 1) lands with the first projection in V1-3-1 — nothing outside the engine imports it yet.

## Verification

`pnpm check` (0 errors/warnings), `pnpm build` passes, page SSRs correctly at `/`, `pnpm test` (320 engine cases: types/hashing, units corpus + property test, formula parse/print round-trips, registry built-ins, graph store/indexes, mutation round-trips incl. JSON-serialized undo, evaluator corpus, recalc order-independence + memo spy + cycle suite + the CI-enforced < 50 ms/500-node perf gate + bit-for-bit reproducibility, engine import boundary), `pnpm test:e2e` (spike proofs incl. SSR/hydration, focus isolation, move survival, serialize/restore, custom functions, spill).

## Next (not started)

V1-3-1 from IMPLEMENTATION_PLAN.md v3: the Univer adapter (custom functions, cell↔node binding, named-range lift) — plus V1-4-1 persistence, which can start in parallel. The occt-wasm spike stays moved to V2-0.
