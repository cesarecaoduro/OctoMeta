# OctoMeta · ARCHITECTURE.md

*What is actually built, where it lives, and the decisions behind it. Updated as the codebase grows; the forward-looking plan lives in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) (with [PRD.md](PRD.md) for the why).*

**Last updated:** 20 July 2026 · **V1 is complete.** All of V1-0 through V1-5-6 landed and tested (517 Vitest, 33/33 Playwright incl. the end-to-end demo scenario, the V1 exit gate), plus a post-V1 polish pass (range formulas, notebook insertion slots, computed-cell styling, full-width canvas). The working prototype: prose + images + Univer sheets + live chips + show-steps + provenance inspector, all reactive over one typed graph, persisted on Convex with byte-for-byte reproducibility. Waitlist live on Convex + Resend. Next: V2 (geometry viewer arc).

## Current state

A SvelteKit + Svelte 5 (runes) + TypeScript app containing the marketing landing page, with a **live Convex backend for the waitlist**: idempotent `waitlist.join` mutation, confirmation emails through the Resend component, a delivery-status webhook, and a cleanup cron.

**V1-0 is done.** The workspace is scaffolded (exact-pinned Univer 0.25.1 + TipTap 3.28.0, Vitest on `src/lib/engine/`, Playwright e2e against the production build) and both Univer spikes passed: a Univer sheet lives inside a TipTap NodeView (SSR-safe, focus-isolated, move-safe, serializable), and Facade custom functions spill 2D arrays natively with tagged strings as the `TypedValue` display path. Findings, landmines, and the spike-route promotion plan are in `docs/v1-0-findings.md`.

**V1-1 is done.** The typed core of SCHEMA.md §2–3 + §6 lives in `src/lib/engine/` as pure TypeScript (zero UI imports, enforced by a boundary test): `types.ts` (TypedValue union, Dimension, error taxonomy, ULID ids, cyrb53 content hashing, exhaustive guards), `node.ts` (GraphNode with Provenance/PendingChange stamped from day one), `units.ts` (SI + engineering unit table, canonical-SI quantity storage, dimension algebra, `#UNIT!` checks, `format`/`convert` display conversion that never touches stored values), `formula.ts` (v1 grammar parser with unit literals/cell refs/dotted names, canonical printer, `resolveInputs` deriving edges, `#REF!`/`#NAME?` as values), and `registry.ts` (FnSignature registry with the builtin/user origin seam, quantity-lifted operators, the V1 built-ins, `SHOWSTEPS` stubbed until V1-5-4). 193 Vitest cases including a seeded property test over dimension algebra. `5 kN * 2` → `10 kN` and `kN + m` → `#UNIT!` hold in tests.

**V1-2 is done.** The engine is now reactive end-to-end, still pure TypeScript: `block.ts` (Block/ChipBinding data model, SCHEMA §8), `graph.ts` (`DocumentGraph` in-memory store with derived indexes — name, cellRef, reverse edges, unresolved-ref healing — plus subscribers and the undo-log storage), `mutations.ts` (`applyMutation` as the sole write path for all seven SCHEMA §9 ops, validation-before-commit, provenance stamping, serializable undo/redo with full-prior-state inverses, cycle rejection at mutation time), `topo.ts` (transitive descendants, Kahn topo-sort with cycle capture, `wouldCycle` pre-check), `evaluate.ts` (pure FormulaAST evaluator over the registry), and `recalc.ts` (dirty-set → Kahn → content-hash memo → subscriber notify, `#CYCLE!` marking, the `commit`/`commitUndo`/`commitRedo` facade, dormant `geometryHook`). Edit an input and dependents recompute in dependency order; undo/redo re-settle; the 500-node scalar-chain perf gate (< 50 ms, PRD §4) runs in CI at ~3–5 ms.

**V1-3-1 is done.** The Univer adapter lives in `src/lib/adapters/univer/` — the only place allowed to import `@univerjs` (grep-verified, CI boundary pending V1-5-6). `attachSheetAdapter` binds one Univer instance to one sheet block, UI-framework-thin (no Svelte) so the editor's NodeView wraps it directly. Univer's own recalc is **structurally demoted**: the adapter's `set-range-values` listener classifies user edits, routes them through `commit` (applyMutation + recalc), and writes settled values back with `{v, f: null, si: null, p: null}` — no formula ever persists in the Univer model; the graph owns every AST. Named ranges lift to `publishName`, dotted names (`=beam.span`) resolve in the engine parser, and the graph's cellRef index is the only cell↔node binding. The spike routes were deleted; their patterns (Steady wait, snapshot store, canvas selectors) were promoted per the findings memo. A standalone two-sheet reference page lives at `/sheet`.

**V1-4-1 is done.** Convex persistence: product tables per SCHEMA §10 (`documents`, `graphNodes`, `blocks`, `undoLog`, `sheetSnapshots`, `chipBindings`; `versions` skipped for V1) in `src/convex/schema.ts` with the waitlist table byte-identical; `src/lib/persistence/` is the only path to Convex for UI code, now CI-enforced by `boundary.test.ts`. Save is a wipe-and-replace mutation debounced client-side by `createDocumentSaver`; load is pure `hydrateGraph(rows)` shared by app and CI. The reproducibility gate (`reproducibility.convex.test.ts`, edge-runtime) round-trips both fixtures through real commits and asserts every stored `contentHash` byte-for-byte, plus undo-across-reload.

**V1-5-1 and V1-5-2 are done.** The block document is real: `src/lib/editor/` is the sole home of `@tiptap/*`/ProseMirror. Prose, images, and Univer sheet blocks coexist on one canvas at `/app/[docId]` (doc list at `/app`); every block carries a hidden `blockId` PM attribute and reconciles against `graph.blocksOrder` — structural ops commit synchronously through `blockOp`, prose content debounces 300 ms into `blockOp update`, and sheets are managed structure-only (their content lives in the graph + snapshots, never in PM JSON). TipTap history is disabled: engine undo is THE history, including in-grid edits (a window-capture keydown interceptor beats Univer's ShortcutService and routes undo chords on sheet blocks to `commitUndo`/`commitRedo`). Sheets mount eagerly (~3.4 s each to Univer Steady, flat per-sheet cost measured to 8 sheets); snapshots flush content-hash-deduped into `sheetSnapshots` on save.

**V1-5-3 is done.** Live value chips: `@`-picker in prose (hand-rolled PM plugin + DOM listbox, no new dependency) inserts an inline `valueChip` atom bound to a `ChipBinding`; chips render the live value, flash on recompute (accent → dim, reduced-motion honored), show a neutral busy state, and error chips deep-link to the failing block/cell (scroll + 1.4 s accent ring). The chip lifecycle is a new engine mutation `chipOp create/remove` through `applyMutation` (SCHEMA §9 updated); `rebindChip` stays strict update-only; chips are projections so `chipOp`'s AffectedSet is always `[]`. In-doc paste remints fresh chip ids against the same node; cross-doc paste and cut-then-paste show `#REF!` (documented limitation — delete-from-prose must remove the binding).

**V1-5-6 is done — the V1 exit gate.** The demo fixture (`buildDemoFixture` in `FIXTURE_BUILDERS`, template actor `octometa.beam-demo`): a simply-supported beam calc as prose + chips + two sheets — inputs `beam.w`/`beam.span`, `beam.moment` = `w * L^2 / 8`, a deflection chain, and a checks sheet consuming cross-sheet dotted names into `beam.util` with a `SHOWSTEPS` cell. It rides the reproducibility CI gate automatically. The single end-to-end Playwright scenario (`e2e/v1-demo.spec.ts`, ~16 s) drives the real UI through the whole story: create → markdown → sheets → publish names → @-picker chips → edit-and-flash → cross-sheet refs → introduce/fix `#CYCLE!` and `#VALUE!` → chip show-steps → inspector chain walk → reload with zero mismatches → undo of a pre-reload edit after the reload. The image block is exercised by app-editor.spec.ts rather than the demo (kept tight on purpose).

**V1-5-5 is done.** The provenance inspector: a read-only side panel (`src/routes/app/[docId]/Inspector.svelte` over the pure view-model in `src/lib/editor/inspector.ts`) showing the selected node's name, kind, canonical formula (`printFormula`), live value, authorship (`authoredBy/At`, `verifiedBy/At`), and direct inputs/dependents as navigable links — walk the dependency chain without leaving the panel. Opens via Alt+click / Alt+Enter on a chip (plain click keeps its V1-5-3/V1-5-4 meanings) or by selecting a graph-bound sheet cell (a read-only selection hook in the adapter, gated on user intent so mount-time programmatic selections never open it). Re-derives on every settle; closes if the node vanishes; Escape closes except inside a grid.

**V1-5-4 is done.** Engine half: `src/lib/engine/showsteps.ts` builds serializable `Derivation`s (formula → substituted values → stepwise intermediates → settled result) by collapsing innermost ready sub-expressions through the same `applyBinary`/`applyUnary`/registry layer recalc uses, printed via `printFormula` so parenthesization matches the canonical printer. `SHOWSTEPS(ref)` is intercepted in `evaluateFormula` before eager arg evaluation (a ref to an error node derives instead of propagating) and renders through the optional `EvalEnv.nodeById` accessor. UI half: value chips expand in-canvas to a mono steps panel that re-derives on every settle while open; `=SHOWSTEPS(name)` in a sheet cell settles to the plain-text derivation string; the derivation-capable evaluator is wired at exactly two seams — `createGraphSession` (commit/undo/redo, so both `/app/[docId]` and `/sheet` inherit) and `hydrateGraph`'s verification recalc (so saved SHOWSTEPS nodes reproduce their hash on reload).

## Stack in use

| Layer | Choice | Status |
|---|---|---|
| Framework | SvelteKit 2 + Svelte 5 (runes), TypeScript | In use |
| Backend | Convex (`convex` + `convex-svelte`) | Waitlist + product tables live (dev deployment); all UI access through `src/lib/persistence/` |
| Email | Resend via `@convex-dev/resend` | Confirmation email + delivery webhook live |
| Package manager | pnpm (single package; Turborepo deferred until there's more than one) | In use |
| Calc grid | Univer OSS via `@univerjs/presets` + `@univerjs/preset-sheets-core` **0.25.1 exact** | Adapter live (`src/lib/adapters/univer/`), recalc demoted to display |
| Block editor | TipTap `@tiptap/{core,starter-kit,pm}` **3.28.0 exact** | Editor live (`src/lib/editor/`, `/app/[docId]`), history disabled in favor of engine undo |
| Tests | Vitest 4 (five projects: engine/adapters/persistence/editor node env, convex edge-runtime) · Playwright (`e2e/`, prod build, `workers: 1`) | In use (`pnpm test`, `pnpm test:e2e`) |
| Adapter | `@sveltejs/adapter-auto` | Placeholder; deployment target undecided |
| Fonts | Inter, Inter Tight, JetBrains Mono via Google Fonts (`src/app.html`) | In use |

## Layout

```
src/
  app.html                  fonts, favicon, meta shell
  convex/                   Convex functions root (convex.json points here)
    schema.ts               product tables (documents, graphNodes, blocks, undoLog,
                            sheetSnapshots, chipBindings) + waitlist (untouched)
    documents.ts            create/list/rename/remove/save/load; UNDO_CAP=200 server prune;
                            remove cascades all per-doc rows + image storage files
    sheets.ts               sheetSnapshots upsert
    chips.ts                chipBindings upsert/remove (idempotent)
    files.ts                generateUploadUrl mutation + getUrl query (image blocks)
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
      evaluate.ts           pure FormulaAST evaluator (literals/refs/operators/calls),
                            SHOWSTEPS interception + evaluateWithDerivations helper
      showsteps.ts          derivation builder (formula → substitution → intermediates →
                            result) + renderStepsText plain-text renderer
      recalc.ts             incremental recalc + #CYCLE! marking + commit facade,
                            dormant geometryHook (V2 seam)
      index.ts              public engine surface (import from here, not internals)
    adapters/univer/          the ONLY place importing @univerjs (CI boundary via grep-rule)
      univer-api.ts         all runtime Univer imports, thin named wrappers (churn isolation)
      cell-text.ts          pure mapping: edit classification, A1 addressing, TypedValue→display
      graph-sync.ts         GraphSession (commit/undo/redo + settle fan-out), cell-edit routing,
                            name publish/rename/unpublish
      adapter.ts            attachSheetAdapter: one Univer instance ↔ one sheet block
      sheet-store.ts        module-level snapshot store (blockId-keyed, sheetSnapshots stand-in)
    persistence/              the ONLY path to Convex for UI code (CI: boundary.test.ts)
      codec.ts              Θ↔THETA deep-rename (Convex needs ASCII keys)
      serialize.ts          hydrateGraph(rows): pure load path shared by app + CI
      client.ts             Persistence facade (documents/sheets/chips/waitlist/files)
      saver.ts              createDocumentSaver: 500 ms debounce, overlap-free, flush()
      sheet-snapshots.ts    content-hash-deduped snapshot flusher riding the saver
      svelte.ts             setupPersistence/usePersistence/useWaitlist (context wiring)
      fixtures.ts           FIXTURE_BUILDERS (beam calc + branch calc; V1-5-6 reuses)
    editor/                   the ONLY place importing @tiptap/ProseMirror
      blocks.ts             pure PM-JSON ⇄ Block mapping (classify, blockId stamp/strip)
      sync.ts               createBlockSync: doc⇄graph reconciler, 300 ms prose debounce
      image-node.ts         imageBlock atom + NodeView (injected URL resolver)
      sheet-node.ts         sheetBlock atom + NodeView (injected attach(), Univer-free)
      chips.ts              pure chip logic: chipDisplay, planChipSync, filterPickItems
      chip-node.ts          valueChip inline atom + NodeView (live render, flash,
                            deep-link, a11y)
      chip-picker.ts        @-picker (PM plugin + DOM listbox, no new dependency)
      create-editor.ts      editor assembly: StarterKit (undoRedo: false), keymap,
                            renderFromGraph, moveSelectedBlock, undo-chord interceptor
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
    +layout.svelte          setupPersistence(PUBLIC_CONVEX_URL) + global CSS imports
    +page.svelte            landing page composition + section-level styles
    app/+page.svelte        document list (create/open/rename/delete)
    app/[docId]/+page.svelte  the editor shell: load → hydrateGraph → editor + saver;
                            toolbar (undo/redo, move, image, sheet, save state)
    sheet/+page.svelte      standalone two-Univer-instance adapter reference page
e2e/                        Playwright (prod build, port 4173, workers: 1):
                            adapter-univer (9) · app-editor (4) · canvas-sheets (6)
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

- **Adapter conventions (V1-3-1, 20 Jul 2026):**
  - **Recalc demotion is structural, not configurational.** Settled values write back as `{v, f: null, si: null, p: null}`; the Univer model never stores a formula, so Univer literally has nothing to compute. Edit processing defers to a microtask (never inside Univer's command stack); an `applying` flag suppresses echo events; `fromFormula`/`onlyLocal` writes are skipped.
  - **Boot order (landmine 1):** `setInitialFormulaComputing(NO_CALCULATION)` before `createWorkbook`; registry functions registered after lifecycle `Steady`; one `executeCalculation()` after. Engine functions (SUM, MAX, …) deliberately shadow Univer's — harmless because Univer computes nothing.
  - **Names:** dotted names never reach Univer's parser (formulas are stripped); the engine parser resolves them. Univer defined-name commands lift to `publishName`/rename/`removeNode`; rename uses Excel semantics (publish new → rewrite dependent ASTs → remove old; dependents keep values). The graph's cellRef index is the only cell↔node binding.
  - **Rejected edits** (cycles, etc.) render their error code display-only; the graph keeps last valid state. Unparseable formula text becomes a string input (visible typo). Kind changes (value↔formula) are `removeNode`+`addNode`; dependents heal via the unresolved-ref index.
  - **`univer-api.ts` isolates every Univer import** behind thin named wrappers, so version churn on the 0.25.1 pin touches one file.
  - The write-path acceptance test replays the undo log onto a fresh graph via `applyMutation` alone and asserts deep-equality — any bypass write could not replay (cross-cutting rule 1, now enforced).

- **Persistence conventions (V1-4-1, 20 Jul 2026):**
  - **`Θ` → `THETA` codec:** Convex requires ASCII object keys; `codec.ts` deep-renames on write and back on read (fixed engine key vocabulary; collisions throw loudly). `undefined` drops at encode, matching engine `stableStringify`.
  - **Save is wipe-and-replace** of all per-doc rows in one mutation, debounced 500 ms client-side by `createDocumentSaver` (saves never overlap; `flush()` is the kill-the-tab path, wired to visibilitychange/pagehide/beforeNavigate). Server prunes undoLog to 200 as a backstop. Deep engine structures store as `v.any()` — the engine owns those shapes.
  - **Load is `hydrateGraph(rows)`**, pure and shared with CI: formula nodes re-register in a second pass (row-order-independent healing index), then a full recalc re-derives every `contentHash` and reports mismatches (empty ⇒ reproducible).
  - Dev deployment `amiable-leopard-466`; e2e specs create fresh docs on it and delete them in `afterEach`.

- **Editor conventions (V1-5-1/V1-5-2, 20 Jul 2026):**
  - **Engine undo is THE history.** TipTap history is off; Mod-z/y route through `flushProse` → `commitUndo/commitRedo` → `renderFromGraph`. Univer 0.25.1 binds shortcuts on window with capture, so a container listener can never win: the sheetBlock extension registers one window-capture interceptor at editor creation (before any Univer boots) that routes undo chords on `[data-sheet-block]` to engine undo. One linear history across prose, blocks, and cells; known tradeoff: Cmd+Z mid-cell-edit runs engine undo, not typed-text revert.
  - **Reconcile protocol:** structural block ops commit synchronously; prose content debounces 300 ms into `blockOp update`, flushed before any structural commit/undo/move/save. Sheets are managed structure-only (no pm payload, so no `blockOp update` ever fires for them). Top-level type changes (`#` paragraph→heading) are `remove`+`add` under the same id. TipTap's trailing paragraph is **ephemeral** — ignored until it gains content (otherwise it plants a stray `add` between an action and its undo).
  - **Sheets mount eagerly** (~3.4 s each to Steady, flat per-sheet, ~7–9 MB heap each; measured to 8 sheets). Revisit (lazy or one shared Univer instance with multiple workbook units) if typical docs > 4 sheets, aggregate mount > 30 s, or heap > 500 MB. `renderFromGraph` never remounts live grids.
  - **Snapshot flow:** NodeView destroy and save flush workbook JSON to the module store; the saver decorates `saveDocument` to `flushChanged` deduped snapshots into `sheetSnapshots`; on load, rows seed the store before NodeViews mount and the hydrated graph repaints bound cells. Any workbook mutation (incl. column widths) marks the doc dirty.
  - **Focus:** grid events never reach ProseMirror; Enter on a selected sheet enters the grid, Escape node-selects and refocuses prose. Image files upload via Convex storage (`generateUploadUrl`); orphaned files GC only on document delete (accepted V1 deviation).

- **Chip conventions (V1-5-3, 20 Jul 2026):**
  - **Ordering keeps chips coherent under undo.** Insert = `[chipOp create]` then `[blockOp update]`; delete-from-prose = flush `[blockOp update]` then `[chipOp remove]`. Undo replays newest-first, so a binding exists whenever the chip node is in the doc — no intermediate `#REF!` ever renders. One user action spans two undo entries; the binding-only entry is invisible on its own.
  - **Busy is a value, not a flag:** commits settle synchronously, so the busy state is the engine's not-yet-evaluated seed, rendered `…` with `aria-busy` in neutral grey (never accent).
  - **Deep-link fallback:** error chips navigate to `origin`'s hosting block; an unresolvable origin (deleted node) re-pulses the chip's error styling in place.
  - **A11y:** chips are focusable with labels like `beam.span: 12`; error chips are `role=button` announcing "press Enter to go to the source"; the picker is a proper `role=listbox` driven by `aria-activedescendant`.
  - **Persistence needed no changes:** bindings already ride `serializeGraph`/`hydrateGraph` and the full-save path.

- **Inspector conventions (V1-5-5, 20 Jul 2026):**
  - **Affordances never collide:** Alt+click / Alt+Enter on a chip inspects (`aria-keyshortcuts`); plain click keeps deep-link (error chips) and steps expansion (value chips). Selecting a graph-bound cell inspects; unbound cells do nothing and focus stays in the grid.
  - **Selection hook is intent-gated:** `univer-api.ts onSelectionChanged` wraps the facade's `selectionMoveEnd$`; `SheetAdapter.onSelect` arms only after a `pointerdown` on the container, so Univer's programmatic mount-time selection never opens the panel; adapter write-backs are filtered. Read-only, no write-path changes.
  - **View-model is pure** (`buildInspector(source, id)`, no DOM/TipTap): links label as `name ?? a1 ?? id`, inputs in formula order, dependents from reverse edges sorted by label, dead ids skipped. Actor renders `kind · id`; times absolute local. Value formatting mirrors chips (duplicated deliberately — `chips.ts` was outside the task's file boundary; unify if a third consumer appears).
  - **Lifecycle:** re-derives on every settle; closes itself if the inspected node vanishes; close restores focus to the opening chip; Escape closes anywhere except inside a grid (there it keeps its leave-grid meaning). Panel styles are component-scoped (base.css untouched — shared primitives global, section styles scoped).

- **Show-steps conventions (V1-5-4, 20 Jul 2026):** derivations are total (never throw) and serializable; the last step is always the node's **settled** value, so a derivation can never disagree with the graph. Substitution prints by swapping values through `printFormula` (parenthesization = the canonical printer, negatives parenthesized); intermediates collapse innermost ready sub-expressions per pass through the same operator/registry layer recalc uses. `SHOWSTEPS(ref)` intercepts before eager arg evaluation, needs the optional `EvalEnv.nodeById` accessor, and degrades to `#VALUE! 'SHOWSTEPS: derivation unavailable'` through a plain `commit` — surfaces opt in by passing `evaluate: evaluateWithDerivations(graph)` in `RecalcOptions` (wired in `createGraphSession` and `hydrateGraph`; new commit sites must do the same). Nested SHOWSTEPS is not expanded inside a derivation. UI conventions: chip click/Enter is keyed off display state — error/dangling chips deep-link, value chips toggle the steps panel (`role=button` + `aria-expanded`), busy chips do nothing; Escape collapses and the panel auto-collapses if the node turns error. **Alias hop:** a chip on a `namedOutput` whose formula is a bare resolving ref shows the referenced node's derivation headed by the published name (raw SHOWSTEPS cells keep the engine's alias form verbatim). A11y: `renderStepsText` rides as visually-hidden text, the styled mono lines are `aria-hidden`; accent only on the result line. A SHOWSTEPS cell holds the full multi-line text; a single-row cell visually shows the first line (accepted V1 simplicity).

- **Polish conventions (post-V1, 20 Jul 2026):**
  - **Ranges are call-argument sugar.** `SUM(A1:A3)` behaves as `SUM(A1, A2, A3)`: `collectRefs` expands ranges into constituent cells (row-major, corners normalized), so inputs, cycle checks, and per-cell healing come free; the evaluator flattens range args inside calls; show-steps substitutes one value per cell (`SUM(10, 20, 30)`). A range outside a call argument is `#VALUE!`; expansion caps at `MAX_RANGE_CELLS` (1024). A missing constituent cell is `#REF!` naming that cell — consistent with single-ref semantics — and heals when the cell appears. ASTs and printing keep the range form (`SUM(A1:B2)` round-trips unchanged).
  - **Computed cells are visibly computed.** `writeCellDisplay` takes a `CellDisplayStyle`: formula-bearing nodes paint accent (`#6C5CE7`, the tokens.css "computed value" surface), error values paint `--error` red, plain inputs reset to ink. The hex values are inline twins of the CSS tokens because Univer styles cells by value, not `var()`.
  - **Insertion slots** (`editor/insert-slots.ts`): ProseMirror widget decorations at every top-level gap, plus an always-visible end slot, offer `+ text · + sheet · + image` (Jupyter-style). Gap index = graph position (sync.ts invariant); the page owns the insert — text focuses the new block, image stashes the slot position through the upload flow. e2e assertions over `.tiptap > *` must exclude `.octo-insert-slot`.
  - **Full-width canvas + honest deletes:** the document page dropped its `--prose` clamp (`max-width: none`); the doc-list delete surfaces failures ("Could not delete …") instead of silently swallowing the rejection.

## Verification

`pnpm check` (0 errors/warnings), `pnpm build` passes, `pnpm test` 517 cases across five vitest projects: engine 362 (incl. the < 50 ms/500-node perf gate, bit-for-bit undo reproducibility, import boundary, show-steps derivation corpus over all three fixtures, chip-lifecycle round-trips, range expansion/healing), adapters 40, persistence unit + Convex-runtime suites (incl. the reproducibility CI gate over all three fixtures and the convex-import boundary), editor 66+ (incl. 16 inspector view-model tests). `pnpm test:e2e` 33/33 against the prod build (~4 min): adapter-univer 9 (canvas-typed formulas, cross-sheet reactivity, rename/delete/heal, cycles, serialize→restore), app-editor 4 (markdown + image + reload, reorder, undo spanning block delete, doc list), canvas-sheets 6 (grid-in-canvas, one-history undo, focus isolation, snapshot persistence), chips 5 (flash on edit, deep-link, copy/paste, reload), showsteps 4 (chip expansion, re-derive on upstream edit, SHOWSTEPS cell, reload with zero hydration mismatches), inspector 4 (chip inspect, walk the chain, cell selection, close/Escape), v1-demo 1 (the exit-gate scenario end-to-end).

## Next (not started)

**V1 is complete.** Next is the V2 arc from IMPLEMENTATION_PLAN.md: V2-0 geometry spikes (occt-wasm), kernels, the viewer block, PDF/IFC export, templates — plus V2-U (surfacing the dormant units layer). CI wiring (GitHub Actions running check/test/build/e2e) needs a Convex deployment secret and is a pending user decision.
