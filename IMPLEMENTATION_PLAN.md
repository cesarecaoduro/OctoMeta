# OctoMeta — IMPLEMENTATION_PLAN.md (v1)
*Actionable expansion of PRD §7–8 into confined, agent-handoverable tasks. The PRD says what and why; this says exactly what to build next, in what order, and how we know each piece is done.*

**Status:** Active · **Date:** 18 July 2026 · **Companion docs:** [PRD.md](PRD.md) · [SCHEMA.md](SCHEMA.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [DESIGN.md](DESIGN.md)

---

## 0. How to use this document

Each task below is designed to be handed to a coding agent as a self-contained brief:

- **Confined scope.** Every task has explicit *In* / *Out* boundaries. An agent should refuse scope creep past *Out*.
- **Dependencies are hard.** `Deps:` lists task IDs that must be **merged** before this task starts. Tasks with no shared deps can run in parallel (see the lane table per milestone).
- **Acceptance criteria are the definition of done.** Every criterion must be verifiable by running a command or exercising the app — not by reading the diff.
- **Every task ends with:** `pnpm check` clean, `pnpm build` passes, new logic unit-tested with Vitest, and `ARCHITECTURE.md` updated if the task changed structure or decisions.

**Handover brief template** (paste into the agent prompt):

```
Task: <ID> — <title>          (from IMPLEMENTATION_PLAN.md)
Read first: PRD.md §<n>, SCHEMA.md §<n>, ARCHITECTURE.md
Scope In / Out: <copy from task>
Acceptance: <copy from task>
Do not implement anything beyond this task's scope.
```

---

## 1. Priority rationale — what the user gets first

The landing page exists; nothing behind it does. The sequencing below optimizes for the earliest *real* user value while respecting the dependency graph and front-loading the two existential risks (Univer embedding, WASM geometry):

1. **First deliverable to users (end of M1): a unit-safe calculation workspace.** Create a document, work in a live grid where numbers carry units, publish named values, see `#UNIT!`/`#CYCLE!` instead of silent errors, and have it persist. This is already better than a spreadsheet for Priya, with zero geometry and zero report.
2. **Second (end of M2): geometry as a value.** `=EXTRUDE(...)` in a cell drives a 3D viewer. This is the demo that sells the thesis and the highest technical risk — it must not wait behind the report.
3. **Third (end of M3): the report is the deliverable.** Full document canvas, live chips in prose, show-steps, PDF export. This is the point where OctoMeta replaces the Word/PDF calc package — the primary JTBD.
4. **Fourth (M4): trust and interop.** Templates (time-to-first-value < 10 min), performance at 2,000 nodes, schema-valid IFC4X3.
5. **Then M5 (auth/collab) and M6 (AI, sandboxed functions)** — hooks for both are built in M1 and never blocked on.

M0 stays first and short: three weeks of spikes that decide whether the M1–M3 plan survives contact with reality.

---

## 2. Milestone map

| # | Name | Duration | User-visible checkpoint at exit |
|---|---|---|---|
| **M0** | De-risk spikes | 3 wk | (internal) Go/no-go decisions recorded; waitlist on real backend |
| **M1** | Graph core + units + first usable calc doc | 5 wk | Create a doc, compute with units in a live grid, values persist |
| **M2** | Geometry + viewer | 5 wk | Parametric beam: edit a cell, watch the solid re-extrude |
| **M3** | Document canvas + chips + PDF | 5 wk | Author a full calc report with live values; export paginated PDF |
| **M4** | Polish + templates + IFC | 5 wk | Start from a template; export schema-valid IFC4X3 |
| **M5** | Pre-beta: auth + collaboration | 5 wk | Sign in, share a doc, concurrent editing |
| **M6** | AI + sandboxed user functions | open | Agent proposes → validates → human commits |

---

## 3. M0 — De-risk spikes (3 weeks)

**Goal:** kill or confirm the four assumptions the whole plan rests on. Spike code lives in `src/routes/spike/` behind no navigation link and is deleted or promoted explicitly — never silently absorbed.

**Exit criteria (PRD §7):** Univer-in-TipTap-in-SvelteKit renders and round-trips Convex; occt-wasm verified in Chrome/Firefox/Safari; Facade array-spill behavior determined and documented.

### Parallel lanes

| Lane A (app/infra) | Lane B (grid) | Lane C (geometry) |
|---|---|---|
| M0-1 → M0-3 | M0-2 → M0-5 | M0-4 |
| all → **M0-6** | | |

---

**M0-1 · Workspace scaffold + dependency pinning** — *Size S · Deps: none*
- **In:** Add pinned deps: `@univerjs/*` (exact version, no `^`), `@tiptap/*` + ProseMirror, `three`, `manifold-3d`, `katex`, `mathlive`, Vitest config with a `src/lib/engine/` test path, Playwright setup. Create empty `src/lib/engine/`, `src/lib/geometry/`, `src/lib/adapters/` directories with README stubs stating ownership. Add `src/routes/spike/+page.svelte` index linking the spike pages.
- **Out:** No feature code. No Turborepo (single package until it hurts).
- **Acceptance:** `pnpm check` and `pnpm build` pass with all deps installed; lockfile pins exact Univer version; spike index renders at `/spike`.

**M0-2 · Spike: Univer sheet inside a TipTap NodeView** — *Size M · Deps: M0-1*
- **In:** A `/spike/univer` page: TipTap editor with one custom block node whose Svelte 5 NodeView mounts a Univer OSS sheet (edra patterns). Prove: (a) renders under SSR/hydration, (b) keyboard focus enters/leaves the grid without TipTap stealing keys, (c) sheet edits survive block move up/down, (d) snapshot serialize/restore works.
- **Out:** No graph binding, no named ranges, no styling polish.
- **Acceptance:** All four proofs demonstrated on the spike page; findings (including any Univer API landmines) written into the M0-6 memo.

**M0-3 · Spike→prod: first Convex functions + waitlist migration** — *Size M · Deps: M0-1*
- **In:** Define Convex schema for `waitlist` and a provisional `documents` table (SCHEMA.md §10). Write the first mutation/query pair; wire `Waitlist.svelte` to the mutation (drain any `localStorage["octometa-waitlist"]` entries on next visit). Prove live subscription round-trip from a Svelte component. Create `src/lib/persistence/` with a thin interface so no UI imports Convex directly (PRD risk: Convex↔SvelteKit maturity).
- **Out:** No graph tables yet beyond the provisional stub; no auth.
- **Acceptance:** Waitlist submissions land in Convex (visible in dashboard); localStorage drain verified; a spike page shows a value updating live via subscription; no component outside `src/lib/persistence/` imports `convex` directly.
- **Note:** This task is production code (waitlist), not throwaway.

**M0-4 · Spike: occt-wasm browser matrix + disposal behavior** — *Size M · Deps: M0-1*
- **In:** A `/spike/occt` page loading public `andymai/occt-wasm` in a Web Worker: make a box, boolean-subtract a cylinder, mesh it, report timing. Run in Chrome, Firefox, Safari (verify the README's "no Firefox" tail-call note is stale). Measure WASM memory across 100 create/dispose cycles to characterize leak behavior and the disposal API we'll rely on in M2-6.
- **Out:** No kernel interface, no manifold, no viewer.
- **Acceptance:** Matrix table (browser × operation × time × works) and memory-over-cycles numbers in the M0-6 memo; explicit go/no-go on occt-wasm with the manifold-only fallback decision if no-go.

**M0-5 · Spike: Univer Facade custom functions + array spill** — *Size S · Deps: M0-2*
- **In:** Register a custom function via the Facade API on the M0-2 spike sheet. Determine: can a Facade function return a 2D array that spills? If not, prove the fallback (plugin-level `BaseFunction` returning `ArrayValueObject`). Also verify a custom function can return a rich/boxed value or a tagged string we can intercept for `TypedValue` display.
- **Out:** No real function registry.
- **Acceptance:** Spill behavior documented with working code for whichever path works; the M1-8 task below is annotated with the chosen mechanism in the M0-6 memo.

**M0-6 · Decision memo + doc updates** — *Size S · Deps: M0-2, M0-3, M0-4, M0-5*
- **In:** Write `docs/m0-findings.md`: per-spike outcome, chosen mechanisms, API landmines, go/no-go calls. Update ARCHITECTURE.md current-state and PRD risk register rows affected. Delete or explicitly promote each spike route.
- **Acceptance:** Memo exists; ARCHITECTURE.md reflects reality; no orphaned spike code without a stated reason.

---

## 4. M1 — Graph core + units + first usable calc doc (5 weeks)

**Goal:** the typed dependency graph is real, is the sole write path, and a user can do unit-safe calculation work in a persisted document. The engine is **pure TypeScript with zero UI imports** (`src/lib/engine/`) so it is unit-testable and reusable by every later milestone.

**Exit criteria (PRD §7 + user checkpoint):** mutation API sole write path; topo + content-hash recalc; `#UNIT!`/`#CYCLE!` live; named-range → NamedOutputNode; provenance/pending serialized dormant; function registry; **and** a minimal workspace where a user creates a doc, edits a grid, and reloads to the same state.

### Parallel lanes

| Lane A (engine core) | Lane B (units/registry) | Lane C (adapter/UI) |
|---|---|---|
| M1-1 → M1-2 → M1-3 → M1-4 → M1-5 | M1-6 (after M1-1) · M1-7 (after M1-3) | M1-8 (after M1-7) → M1-11 |
| M1-9 (after M1-1) · M1-10 (after M1-4) | | |

---

**M1-1 · TypedValue, Dimension, and node model** — *Size M · Deps: M0-3*
- **In:** Implement SCHEMA.md §2–3 verbatim in `src/lib/engine/types.ts` + `node.ts`: `TypedValue` union, `Dimension` (SI exponent vector + display), `GraphNode`, `ErrCode` set, ULID `NodeId` generation, and stable `contentHash` (`hash(opId + inputHashes)`) with a fast non-crypto hash. Include exhaustive type guards (`isQuantity`, `isErr`, …).
- **Out:** No evaluation, no parsing, no persistence.
- **Acceptance:** Vitest: hash is deterministic and input-order-sensitive; type guards exhaustive (a `switch` over `kind` compiles with `never` check); zero imports from outside `engine/`.

**M1-2 · FormulaAST + reference resolution (edges are derived)** — *Size L · Deps: M1-1*
- **In:** Define `FormulaAST` and a parser for the v1 expression grammar: numbers with unit literals (`5 kN`, `3.2 m`), arithmetic/comparison operators, function calls, cell refs (`A1`, ranges), dotted published names (`beam.span`). `resolveInputs(ast, resolver): NodeId[] | #REF!/#NAME?` derives the `inputs` array — the mechanism SCHEMA.md §3 requires ("edges are derived, never authored"). AST is serializable JSON; include a printer (AST → canonical source text) for show-steps later.
- **Out:** No evaluation (M1-4), no Univer syntax quirks (M1-8 maps those).
- **Acceptance:** Vitest table-driven parse/print round-trip corpus (≥40 cases incl. unit literals and error cases); unresolved name → `#NAME?`, dangling ref → `#REF!` as *values* per SCHEMA.md §2.

**M1-3 · Mutation API + undo log** — *Size L · Deps: M1-2*
- **In:** `applyMutation(m: GraphMutation, actor: Actor)` per SCHEMA.md §9 for `setInput`, `setFormula`, `addNode`, `removeNode`, `publishName` (defer `rebindChip`/`blockOp` to M3 — leave typed stubs returning `MutationError('unimplemented')`). Validation before commit (type/dim shape, cycle pre-check via M1-2 resolution), inverse-mutation undo log with `undo()`/`redo()`, provenance stamping from `actor`. Delete semantics: removing a node converts dependents' refs to `#REF!` immediately (Marimo scrub, SCHEMA.md §5).
- **Out:** No recalc yet (returns `AffectedSet` for M1-4 to consume); no UI.
- **Acceptance:** Vitest: every op round-trips through undo/redo to identical graph state (deep-equal incl. hashes); invalid mutations reject without partial writes; delete-scrub produces `#REF!` in dependents.

**M1-4 · Topological + content-hash incremental recalc** — *Size L · Deps: M1-3*
- **In:** Implement SCHEMA.md §4 exactly: dirty = affected ∪ transitive descendants, Kahn topo-sort of the dirty subgraph, memo skip on `contentHash` match, evaluation via the function registry interface (stub registry acceptable until M1-7 merges), subscriber notification (`subscribe(nodeId, cb)`). Geometry queue is a no-op hook until M2-5.
- **Out:** No geometry, no UI bindings.
- **Acceptance:** Vitest: order-independence (shuffled node insertion order ⇒ identical results/hashes); memo hits verified by an eval-count spy; **perf test: < 50 ms scalar propagation over a 500-node dirty chain** (CI-enforced, PRD §4); "restart & run all" determinism: full re-eval from inputs reproduces every `contentHash` bit-for-bit.

**M1-5 · Cycle detection → `#CYCLE!`** — *Size S · Deps: M1-4*
- **In:** Cycle found during Kahn ⇒ every member node gets `#CYCLE!` listing member names/ids (SCHEMA.md §11); rest of the graph still evaluates; mutation that *introduces* a cycle is rejected at `applyMutation` time with the would-be cycle in the error.
- **Acceptance:** Vitest: direct, transitive, and self-reference cycles; non-cycle branch unaffected; breaking the cycle clears `#CYCLE!` on next recalc.

**M1-6 · Quantity/units layer + dimensional checking** — *Size L · Deps: M1-1*
- **In:** `src/lib/engine/units.ts`: unit table seeded from js-quantities/mathjs definitions (SI + common engineering: N, kN, MPa, mm, m, kg, s, °C…), parse `"5 kN"` → `{value, Dimension}`, arithmetic on the exponent vector (mul/div compose, add/sub require equal dims else `#UNIT!`), power/root, comparisons, display-unit conversion and formatting (`format(q, {unit, digits})`). Feet-inch explicitly out (PRD §5.6).
- **Out:** No UI formatting components; no user-defined units.
- **Acceptance:** Vitest corpus ≥60 cases: `kN·m` composition, `kN + m` → `#UNIT!`, `sqrt(m²)` → `m`, display conversion round-trips; property test: dimension vector arithmetic is associative/commutative where math says so.

**M1-7 · Function registry + scalar/aggregate built-ins** — *Size M · Deps: M1-3, M1-6*
- **In:** `FnSignature` registry per SCHEMA.md §6 (the M6 sandbox seam — `origin: 'builtin' | 'user'` from day one). Implement Quantity-lifted arithmetic + `SUM/MIN/MAX/AVERAGE/COUNT/IF/ROUND/ABS/SQRT/POW`, arg validation against declared `params` (wrong kind → `#VALUE!`, wrong dim → `#UNIT!`). Wire the real registry into M1-4's evaluator, replacing the stub. `SHOWSTEPS` registered but returns `#VALUE!('not yet')` until M3-5.
- **Acceptance:** Vitest: each built-in with quantity/scalar/error inputs; error propagation (any `Err` arg ⇒ `Err` result carrying `origin`); registry rejects duplicate registration.

**M1-8 · Univer adapter: custom functions, cell↔node binding, named-range lift** — *Size XL · Deps: M1-7, M0-2, M0-5*
- **In:** `src/lib/adapters/univer/`: the **only** file allowed to import `@univerjs`. (a) Register all registry functions into Univer via the M0-5-chosen mechanism; unit literals and `TypedValue` display (quantity with unit, error codes as `#UNIT!` etc.) render in cells. (b) Cell edit → `setInput`/`setFormula` mutation; graph notification → cell display update; **no write path around `applyMutation`** (Univer's own recalc is demoted to display). (c) Named range creation/rename/delete → `publishName` → `NamedOutputNode` with dotted name; dotted names usable in formulas across sheets through the graph (no second formula engine, PRD §5.4). (d) Adapter-wrap every Univer API touched (pre-1.0 churn risk).
- **Out:** No document canvas hosting (M3-3); single standalone sheet is fine; no geometry functions.
- **Acceptance:** Playwright: type `=5 kN * 2` → cell shows `10 kN`; `=beam.span` in another sheet resolves; rename the named range → dependents update; `kN + m` cell shows `#UNIT!`; a cell edit reaches the graph *only* through `applyMutation` (assert via spy in a unit test of the adapter layer).

**M1-9 · Provenance + pending-change fields (dormant hooks)** — *Size S · Deps: M1-1, M1-3*
- **In:** `Provenance` and `PendingChange` per SCHEMA.md §3 on every node; `applyMutation` stamps `authoredBy/authorId/authoredAt` from `actor`; fields serialize/deserialize; `pending` is written/read but **no UI and no behavior** (M6 hook).
- **Acceptance:** Vitest: mutations from actors `human`/`template` stamp correctly; round-trip through persistence preserves both fields untouched.

**M1-10 · Graph persistence + reproducibility CI** — *Size L · Deps: M1-4, M1-9, M0-3*
- **In:** Convex tables `documents`, `graphNodes`, `sheetSnapshots` (SCHEMA.md §10) behind the `src/lib/persistence/` interface; save (debounced full-node upsert on settle — keep it simple, optimize in M4-1), load (rows → graph → verify hashes), document create/list/delete. **CI reproducibility test:** load each fixture doc, re-evaluate all from inputs, assert every `contentHash` matches stored, byte-for-byte (SCHEMA.md §5 "restart & run all is a no-op").
- **Out:** No version snapshots UI (M4-5); no auth; no conflict handling (single user).
- **Acceptance:** Kill the tab mid-work, reload → identical values and hashes; reproducibility test runs in CI on ≥2 fixture documents; UI code has zero direct Convex imports.

**M1-11 · Minimal workspace UI — first user checkpoint** — *Size M · Deps: M1-8, M1-10*
- **In:** `/app` route (DESIGN.md tokens via existing `tokens.css`): document list (create/rename/delete), document page hosting one Univer sheet block via the M1-8 adapter, save-state indicator, undo/redo buttons wired to M1-3. Deliberately grid-only — no prose canvas yet.
- **Out:** No blocks other than the single sheet; no sharing; no polish beyond token compliance.
- **Acceptance:** Playwright end-to-end: create doc → build a small unit-safe calc with a named value → reload → state intact → introduce a unit error → see `#UNIT!` → fix → undo/redo works. This scenario is the M1 demo.

---

## 5. M2 — Geometry + viewer (5 weeks)

**Goal:** geometry as a value, exactly as SCHEMA.md §7 specifies, with the two hard gates passed: **no WASM growth over 1,000 recalcs** and **small-edit preview mesh < 16 ms**.

**Exit criteria (PRD §7):** kernels behind interface; handle store + sweep; leak/16 ms gates in CI; viewer with bidirectional picking.

### Parallel lanes

| Lane A (kernel/store) | Lane B (functions/integration) | Lane C (viewer) |
|---|---|---|
| M2-1 → M2-2, M2-3 | M2-4 (after M2-2) → M2-5 → M2-6 | M2-7 (after M2-5) |
| | all → **M2-8** | |

---

**M2-1 · `GeometryKernel` interface + GeometryStore** — *Size M · Deps: M1-7*
- **In:** `src/lib/geometry/`: `GeometryKernel` (make/boolean/measure/mesh/dispose) and `GeometryStore` per SCHEMA.md §7 — content-addressed `GeomHandle` (`geom:<op>:<hash>`, hash from op + input hashes so memoization crosses blocks), `GeomEntry` with `refs: Set<NodeId>`, `sweep(liveHandles)` disposing unreferenced entries via kernel `dispose`. Store is document-scoped.
- **Out:** No real kernel (fake kernel for tests); no recalc wiring.
- **Acceptance:** Vitest with fake kernel: identical inputs → identical handle, no second build; sweep disposes exactly the dead set (spy on `dispose`); refcounts track add/remove.

**M2-2 · manifold-3d adapter (preview path)** — *Size M · Deps: M2-1*
- **In:** Implement `GeometryKernel` over `manifold-3d`: point/polyline/profile (planar polygon), extrude, boolean, mesh → `MeshBuffers` (positions/normals/indices, transferable), measures (length/volume), dispose.
- **Acceptance:** Vitest (node-side wasm): 100×50×20 box extrusion volume within 1e-9; mesh buffers valid (no NaN, index in range); dispose leaves manifold's internal count at baseline.

**M2-3 · occt-wasm adapter in a Worker (exact path)** — *Size L · Deps: M2-1, M0-4*
- **In:** Same interface over public `andymai/occt-wasm`, running in a dedicated Worker with a promise-RPC layer; arena/`Symbol.dispose` discipline per M0-4 findings; exact B-Rep retained for M4-3 IFC. Load lazily on first exact request.
- **Out:** If M0-4 was no-go, this task converts to "manifold-only fallback: stub exact path, document consequences for IFC" — decide from the M0-6 memo, don't improvise.
- **Acceptance:** Same geometric test corpus as M2-2 agrees on measures within tolerance; Worker crash → `#GEOM!` on affected nodes, not app crash; repeated create/dispose returns memory to baseline (per M0-4 methodology).

**M2-4 · Geometry built-ins** — *Size M · Deps: M2-2, M1-8*
- **In:** Register `POINT(x,y,z)`, `LINE(a,b)`, `POLYLINE(tbl)`, `PROFILE(tbl)`, `EXTRUDE(profile,h)`, `DISTANCE(a,b)`, `LENGTH(g)`, `VOLUME(g)` in the function registry (SCHEMA.md §6 list). Args are Quantities with length-dimension checks (`EXTRUDE(profile, 5 kg)` → `#UNIT!`); geometry ops call GeometryStore through `ctx`; measures unbox to Quantity (`DISTANCE` → `m`); kernel failure → `#GEOM!` with origin. Handles render in cells as `geom:extrude:9f3a…` in mono (DESIGN.md §4).
- **Acceptance:** Vitest: each function happy-path + dim-error + kernel-error; identical formula in two nodes yields one store entry. Playwright: `=EXTRUDE(PROFILE(...), 3 m)` in a cell shows a handle chip.

**M2-5 · Recalc ↔ geometry integration (preview-then-exact)** — *Size M · Deps: M2-4, M2-3*
- **In:** Fill the M1-4 hook: recalc collects dirty GeometryNodes → `geometryStore.rebuild(queue)` builds preview meshes synchronously, schedules exact async with handle-keyed swap-in; `sweep(liveHandles())` runs after **every** recalc (mandatory, SCHEMA.md §4); busy state visible on affected nodes until preview lands (stale-is-impossible, SCHEMA.md §5).
- **Acceptance:** Vitest: edit → preview available on settle; exact swap preserves handle identity; sweep called exactly once per recalc; deleting a geometry node disposes its entry.

**M2-6 · Hard gates: 1,000-recalc leak soak + <16 ms small-edit** — *Size M · Deps: M2-5*
- **In:** Automated harness (Playwright + CDP memory metrics): scripted 1,000 recalcs over a parametric doc mutating geometry inputs; assert WASM heap at end ≤ start + tolerance; assert p95 small-edit → preview-mesh < 16 ms. Runs in CI as a **required** check; failure blocks merge to the geometry paths.
- **Out:** No optimization work itself — file findings as tasks if it fails; the gate is the deliverable.
- **Acceptance:** CI job green on main; harness README documents how to run locally and read a regression.

**M2-7 · Three.js viewer + bidirectional picking** — *Size L · Deps: M2-5*
- **In:** `src/lib/components/viewer/`: Three.js scene subscribing to GeometryStore — handle-keyed mesh diff/swap (only changed handles re-upload), preview material vs exact material swap, orbit/pan/zoom, `prefers-reduced-motion` honored for any animated transitions. **Picking both ways:** click mesh → highlight + report `NodeId` (event out); external `highlight(nodeId)` API in (for M3 chips/cells). Standalone page in M2; becomes a canvas block in M3-3.
- **Acceptance:** Playwright: edit span cell → beam updates < 16 ms to preview; click solid → bound node reported; 100 solids scene stays interactive (60 fps orbit on CI-recorded trace is best-effort, assert no per-frame allocation growth).

**M2-8 · M2 demo doc: parametric beam** — *Size S · Deps: M2-6, M2-7, M1-11*
- **In:** A fixture document (also a CI fixture for M2-6): inputs `span/width/depth`, section profile table, extruded solid, `VOLUME`-derived quantities — sheet on the left, viewer on the right at `/app`. This is the M2 demo and the seed of the M4-2 beam template.
- **Acceptance:** The M1-11 Playwright scenario extended: drag span value → solid re-extrudes; volume chip updates; reload reproduces.

---

## 6. M3 — Document canvas + chips + PDF (5 weeks)

**Goal:** the document becomes the deliverable. Prose, equations, sheets, viewers, and live value chips in one TipTap canvas; show-steps and provenance answer the checker; paginated PDF exports.

**Exit criteria (PRD §7):** full block editor; live chips; show-steps; read-only provenance inspector; paginated PDF.

### Parallel lanes

| Lane A (canvas) | Lane B (graph UX) | Lane C (export) |
|---|---|---|
| M3-1 → M3-2 → M3-3 | M3-4 (after M3-1) · M3-5 · M3-6 | M3-7 (after M3-3, M3-4) |
| | all → **M3-8** | |

---

**M3-1 · Block editor shell + `blockOp` mutations** — *Size L · Deps: M1-3, M1-10, M0-2*
- **In:** TipTap document at `/app/[docId]` replacing the M1-11 single-sheet page: block types `text`, `heading`, `image` (Convex file storage) per SCHEMA.md §8; add/move/remove/reorder via the `blockOp` mutation (un-stub from M1-3) so block structure lives in the graph's undo log; `position` is layout-only (evaluation never reads it — SCHEMA.md §5); persistence of `blocks` + `blocksOrder`. Keyboard-navigable blocks (PRD §10).
- **Out:** No equation/sheet/viewer blocks yet; no chips.
- **Acceptance:** Playwright: author text/headings/images, reorder, reload intact; undo spans block ops and cell edits in one history; Vitest: moving blocks never triggers recalc (spy).

**M3-2 · Equation block (KaTeX render / MathLive edit)** — *Size M · Deps: M3-1*
- **In:** Equation block: display via KaTeX, click-to-edit via MathLive, stored as LaTeX in block `pm` content. Display-only in v1 — equations don't evaluate (the graph computes; equations document).
- **Acceptance:** Playwright: insert, edit, render round-trip; PDF path (M3-7) renders it; AA contrast and keyboard access.

**M3-3 · Sheet + viewer blocks in the canvas** — *Size L · Deps: M3-1, M1-8, M2-7*
- **In:** Promote M1-11's sheet and M2-7's viewer into canvas NodeViews (M0-2 patterns): multiple sheet blocks per doc, each with its own Univer snapshot, all publishing into the one document graph; viewer block with `boundHandles: 'auto' | NodeId[]` + persisted camera (SCHEMA.md §8); cross-sheet dotted-name references (already graph-native from M1-8) verified in-canvas; focus management between prose and grid.
- **Acceptance:** Playwright: two sheets + viewer in one doc; sheet A publishes `beam.span`, sheet B consumes it, viewer follows; block move never changes values (SCHEMA.md §5); reload restores camera.

**M3-4 · Inline live value chips** — *Size L · Deps: M3-1, M1-8*
- **In:** Inline TipTap node + `ChipBinding` (SCHEMA.md §8): insert-by-name picker (`@beam.span`), renders live value with unit per `format`, recompute flash per DESIGN.md §5 (accent → dim, 700 ms; reduced-motion honored), busy state during recalc, error chips show code and **deep-link to `origin`** (SCHEMA.md §11 — click scrolls to the failing block/cell). `rebindChip` mutation un-stubbed. Deleted node → chip shows `#REF!`.
- **Acceptance:** Playwright: chip in prose updates on cell edit with flash; error chip navigates to root cause; labeled for screen readers (PRD §10); Vitest: rebind through `applyMutation` only.

**M3-5 · Show-steps rendering** — *Size M · Deps: M1-6, M1-7, M1-2*
- **In:** For any computed quantity node: substituted derivation from the stored AST via the M1-2 printer — formula with names → values-with-units substituted → intermediate results → final (PRD §4: 100% of computed quantity nodes). Surfaces: chip expansion in-canvas and `SHOWSTEPS(ref)` (un-stub from M1-7) rendering as a block. Plain-text representation available (accessibility, PRD §10). Mono for all computational text (DESIGN.md §4).
- **Acceptance:** Vitest: derivation corpus over M2-8 fixture (every computed node yields well-formed steps); Playwright: expand chip → steps; steps appear in M3-7 PDF when enabled.

**M3-6 · Provenance inspector (read-only)** — *Size S · Deps: M1-9, M3-4*
- **In:** Side-panel on chip/cell/node select: name, kind, formula (canonical text), value, `authoredBy/At`, direct inputs and dependents as navigable links (provenance queries are the reviewability story, PRD §2 — no node canvas). Read-only.
- **Acceptance:** Playwright: select chip → inspector; walk inputs to a source input node; agent/template-authored fixtures display attribution.

**M3-7 · Paginated PDF export** — *Size L · Deps: M3-3, M3-4, M3-5, M3-2*
- **In:** Print pipeline (CSS paged media via headless Chromium is the default; document the choice): blocks in `position` order, chips as resolved values, equations rendered, sheets as formatted tables, viewer blocks as captured snapshots, show-steps sections per export settings (SCHEMA.md §12); print-safe token subset (pure black text, accent preserved for chips — DESIGN.md §7); headers/footers with doc title + pagination.
- **Acceptance:** M2-8 reference doc exports to PDF; CI smoke: export succeeds, page count stable, text layer extractable; visual review checklist in the PR.

**M3-8 · M3 checkpoint: reference calc round-trip** — *Size S · Deps: all M3*
- **In:** Author the reference beam calc as a real document (prose + equations + sheet + viewer + chips + show-steps) and export it. Fixture for CI; input to M4-2 templates. This is the PRD §4 "reference calc round-trips to valid PDF" metric (IFC half lands in M4).
- **Acceptance:** Scenario scripted in Playwright end-to-end; exported PDF checked into fixtures for visual regression.

---

## 7. M4 — Polish + templates + IFC (5 weeks)

**Goal:** trustworthy at scale, fast to start, and interoperable — the PRD's remaining early metrics: 2,000-node perf, time-to-first-geometry < 10 min, schema-valid IFC4X3.

### Parallel lanes

| Lane A (perf/robustness) | Lane B (templates/UX) | Lane C (IFC) |
|---|---|---|
| M4-1 · M4-5 | M4-2 · M4-6 | M4-3 → M4-4 |

---

**M4-1 · Performance pass @ 2,000 nodes** — *Size L · Deps: M3-8*
- **In:** Generate a 2,000-node stress fixture; profile mutation→settle, load, save; fix to budgets (scalar < 50 ms on dirty-adjacent 500; small-edit mesh < 16 ms holds; load < 2 s target — set and record actuals). Likely levers: batched Convex writes (revisit M1-10's simple save), subscriber coalescing, adapter render batching. Zero stale reads over a 1,000-recalc soak (PRD §4) added to CI.
- **Acceptance:** Budgets in CI perf job with the stress fixture; before/after numbers in the PR.

**M4-2 · Templates: beam / column / footing** — *Size M · Deps: M3-8*
- **In:** Three starter documents instantiated from "new from template" (actor `template` — provenance shows it, M1-9): single-span beam (from M3-8), axially loaded column, spread footing; each with prose structure, inputs sheet, geometry, chips, show-steps. Template = fixture JSON applied through `applyMutation` — **not** a snapshot copy path around the API.
- **Acceptance:** New user → template → sees geometry in < 10 min (scripted walkthrough proves the path is < 10 min of steps); all three export clean PDFs; provenance shows `template`.

**M4-3 · "ifc-lite" IFC4X3 writer** — *Size XL · Deps: M2-3, M2-4*
- **In:** `src/lib/export/ifc/`: map GeometryNodes with exact shapes → IfcProduct subtypes with placement + tessellated/B-Rep geometry per SCHEMA.md §12; property sets carry `name`, provenance, and canonical formula text (auditability travels with the model); minimal spatial structure (project→site→building→storey); STEP serialization. Reference web-ifc for structure; no GPL code (PRD §10).
- **Out:** No IFC *import*; no non-geometry nodes exported.
- **Acceptance:** M2-8 fixture exports; file opens in web-ifc viewer with correct solids and psets visible; unit tests on entity serialization.

**M4-4 · IFC validation harness in CI** — *Size M · Deps: M4-3*
- **In:** CI job: export fixture corpus → validate (buildingSMART validation tooling where feasible, plus web-ifc read-back asserting entity counts, volumes within tolerance, psets present) — the PRD "schema-valid IFC4X3" exit gate and regression corpus (risk register: IFC correctness).
- **Acceptance:** Job required on main; corpus ≥ 3 docs (beam/column/footing); breaking the writer breaks CI.

**M4-5 · Version snapshots + restore** — *Size M · Deps: M1-10*
- **In:** `versions` table (SCHEMA.md §10): atomic snapshot of `graphNodes + blocks + sheetSnapshots`, label, list + restore UI, auto-snapshot before template apply and restore. Reproducibility CI (M1-10) extended to run against snapshots.
- **Acceptance:** Playwright: snapshot → mutate → restore → bit-identical hashes; auto-snapshot verified.

**M4-6 · Error UX + accessibility pass** — *Size M · Deps: M3-8*
- **In:** Sweep the full error taxonomy (SCHEMA.md §11) end-to-end: every code renders consistently in cell/chip/inspector with `--error` tokens, origin deep-links everywhere; keyboard-only full-document authoring audit; AA contrast audit; `prefers-reduced-motion` audit incl. viewer; labeled chips (PRD §10).
- **Acceptance:** Playwright a11y suite (axe) on `/app` green; manual keyboard walkthrough recorded in the PR; every ErrCode has a rendered-state test.

---

## 8. M5 — Pre-beta: auth + collaboration (5 weeks) — outline

Detailed task briefs to be written at M4 exit (they depend on M4's real surface). Confirmed shape from PRD §7–8:

- **M5-1 · Better Auth integration** — users/sessions; Convex tables `users`, `memberships`; persistence interface already isolates this (M0-3). *Deps: M1-10.*
- **M5-2 · Document sharing + permissions** — ownership, invite, viewer/editor roles; ACL checks in Convex functions. *Deps: M5-1.*
- **M5-3 · Concurrent editing over the mutation API** — serialize `applyMutation` per document server-side; presence; conflict policy (last-writer for inputs, reject on concurrent formula edit of same node). The mutation API being the sole write path (M1-3) is what makes this tractable. *Deps: M5-2, M1-3.*

## 9. M6 — AI + sandboxed functions (open) — outline

The hooks are already built by then: `pending` slot + provenance (M1-9), single mutation API (M1-3), shared `FnSignature` (M1-7).

- **AI-1 · Propose→validate→commit** on the `PendingChange` slot; diff UI; `actor: 'agent'`.
- **AI-2 · Ambient suggestions** surfaced in the inspector.
- **AI-3 · MCP meta-tools** exposing the mutation API + provenance queries.
- **SANDBOX-1 · User-defined functions via E2B** — only `impl` dispatch changes; signatures/validation/registration already shared (SCHEMA.md §6).

---

## 10. Cross-cutting rules for every task

1. **No projection writes around `applyMutation`** — enforce with a lint rule/test once M1-3 lands, not by review vigilance.
2. **Third-party isolation:** `@univerjs` only under `src/lib/adapters/univer/`; `convex` only under `src/lib/persistence/` (+ `src/convex/`); kernels only under `src/lib/geometry/`. Cheap to check in review, existential when Univer churns (risk register).
3. **Licensing:** Apache/MIT/BSD/MPL only; LGPL solely as the replaceable occt `.wasm`; **no GPL** anywhere, including dev deps of shipped code (PRD §10).
4. **Design compliance:** app surfaces consume `tokens.css`; mono for everything computational; accent only where DESIGN.md §3 allows; no new colors, no shadows, no gradients.
5. **Docs:** a task that changes structure or takes a decision updates ARCHITECTURE.md in the same PR. Public methods get doc comments (AGENTS.md).
6. **CI gates are cumulative:** reproducibility (M1-10), scalar perf (M1-4), leak + 16 ms (M2-6), zero-stale soak (M4-1), IFC validation (M4-4) — once added, never disabled.
