# OctoMeta · IMPLEMENTATION_PLAN.md (v3 + R1.6)
*Historical V1 milestone briefs plus the implemented R1.6 workbench pivot. V2
connects the geometry viewer. V3 adds MCP and the AI layer.*

**Status:** R1.6 implemented; production credentials pending · **Date:** 20 July 2026 · **Companion docs:** [docs/v1-6-workbench-plan.md](docs/v1-6-workbench-plan.md) · [SCHEMA.md](SCHEMA.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [DESIGN.md](DESIGN.md)

---

## 0. How to use this document

Each task below is designed to be handed to a coding agent as a self-contained brief:

- **Confined scope.** Every task has explicit *In* / *Out* boundaries. An agent should refuse scope creep past *Out*.
- **Dependencies are hard.** `Deps:` lists task IDs that must be **merged** before this task starts. Tasks with no shared deps can run in parallel (see the lane table per milestone).
- **Acceptance criteria are the definition of done.** Every criterion must be verifiable by running a command or exercising the app, not by reading the diff.
- **Every task ends with:** `pnpm check` clean, `pnpm build` passes, new logic unit-tested with Vitest, and `ARCHITECTURE.md` updated if the task changed structure or decisions.

**Handover brief template** (paste into the agent prompt):

```
Task: <ID> · <title>          (from IMPLEMENTATION_PLAN.md)
Read first: PRD.md §<n>, SCHEMA.md §<n>, ARCHITECTURE.md
Scope In / Out: <copy from task>
Acceptance: <copy from task>
Do not implement anything beyond this task's scope.
```

---

## 1. The version arc

**V1 · Working prototype (complete; superseded in product shape by R1.6).** The
original canvas-with-sheet-blocks prototype proved the typed graph, adapter,
persistence, document, chips, derivations, and provenance. R1.6 retained those
contracts and moved calculation sheets into one attached workbook:

1. **Schema working.** SCHEMA.md §2–§6, §9, §11 as a pure-TypeScript engine: typed values, dimensions, formula AST, mutation API as the sole write path, topological + content-hash recalc, cycle detection, function registry, error taxonomy.
2. **Persistence.** Convex (already wired in this repo for the waitlist) behind a thin `src/lib/persistence/` interface. Reload restores the exact document, verified by hash in CI.
3. **The main editor.** A TipTap report document at `/app/[docId]` with text,
   headings, images, equations, and live values, plus one attached multi-tab
   Univer workbook. Cells and report projections are joined by the typed graph.
4. **Not a black box.** Show-steps derivations on every computed quantity, a read-only provenance inspector (who/what authored a value, its inputs and dependents), and the full error taxonomy rendered inline with deep-links to the origin. This is the QAQC/handover story and it ships in V1.

R1.6 subsequently activated the imperial unit surface, KaTeX equation blocks,
Better Auth ownership, atomic graph/workbook persistence, trash/assets,
responsive workbench UI, and production delivery gates.

**V2 · Connect the viewer.** Geometry kernels behind `GeometryKernel`, geometry built-ins (`EXTRUDE` in a cell drives a solid), the Three.js viewer block with bidirectional picking, plus the report/deliverable surface: equations, PDF export, templates, versions, performance at 2,000 nodes, IFC.

**V3 · MCP + AI.** MCP meta-tools over the mutation API and provenance queries, propose→validate→commit on the `PendingChange` slot, sandboxed user functions. Every hook V3 needs (provenance, `pending`, single write path, shared `FnSignature`) is built in V1 and stays dormant.

**No node/graph editor, in any version.** The graph is the data model, not a canvas. Graph *relationships* surface through published names in formulas, chips deep-linking to error origins, and the provenance inspector's navigable inputs/dependents. Reviewability comes from provenance queries, not a node canvas.

---

## 2. V1 milestone map

| # | Name | Duration | User-visible checkpoint at exit |
|---|---|---|---|
| **V1-0** | De-risk spikes (Univer) | 1.5–2 wk | ✅ done · (internal) Univer-in-TipTap and custom functions proven; go/no-go recorded |
| **V1-1** | Engine: values, units, formulas | 2 wk (starts during V1-0) | ✅ done · (internal) `5 kN * 2` → `10 kN`; `kN + m` → `#UNIT!`, all in tests. Units layer stays engine-only/dormant until V2 (decision 19 Jul 2026) |
| **V1-2** | Engine: mutations + reactive recalc | 1.5 wk | ✅ done · (internal) Edit an input, dependents recompute in order; undo/redo; `#CYCLE!` |
| **V1-3** | Univer adapter | 2 wk | ✅ done · Standalone sheet: graph-evaluated formulas, named ranges publish to the graph |
| **V1-4** | Persistence | 1 wk (parallel with V1-3/V1-5) | ✅ done · Documents survive reload bit-for-bit; reproducibility test in CI |
| **V1-5** | The document | 3 wk | ✅ done · **The prototype:** prose + images + sheets + chips + show-steps + provenance, all reactive |

Engine work (V1-1/V1-2) overlaps the spikes; persistence overlaps the adapter and editor. Realistic wall-clock to the V1-5 checkpoint: **~8–9 weeks**.

---

## 3. V1-0 — De-risk spikes (1.5–2 weeks)

**Goal:** kill or confirm the assumptions the V1 plan rests on. Both remaining risks are Univer-shaped (geometry spikes moved to V2-0). Spike code lives in `src/routes/spike/` behind no navigation link and is deleted or promoted explicitly, never silently absorbed.

**V1-0-1 · Workspace scaffold + dependency pinning** · *Size S · Deps: none*
- **In:** Add pinned deps: `@univerjs/*` (exact version, no `^`), `@tiptap/*` + ProseMirror (exact), Vitest with a `src/lib/engine/` test path, Playwright setup. Create `src/lib/engine/`, `src/lib/adapters/`, `src/lib/persistence/` with README stubs stating ownership. Add `src/routes/spike/+page.svelte` linking spike pages.
- **Out:** No three/manifold/occt, no katex/mathlive (all V2). No feature code. No Turborepo (single package until it hurts).
- **Acceptance:** `pnpm check` and `pnpm build` pass; lockfile pins exact Univer and TipTap versions; `pnpm test` runs an empty engine suite; spike index renders at `/spike`.

**V1-0-2 · Spike: Univer sheet inside a TipTap NodeView** · *Size M · Deps: V1-0-1*
- **In:** A `/spike/univer` page: TipTap editor with one custom block node whose Svelte 5 NodeView mounts a Univer OSS sheet (edra patterns). Prove: (a) renders under SSR/hydration, (b) keyboard focus enters/leaves the grid without TipTap stealing keys, (c) sheet edits survive block move up/down, (d) snapshot serialize/restore works.
- **Out:** No graph binding, no named ranges, no styling polish.
- **Acceptance:** All four proofs demonstrated on the spike page; findings (including Univer API landmines) written into the V1-0-4 memo.

**V1-0-3 · Spike: Univer Facade custom functions + array spill** · *Size S · Deps: V1-0-2*
- **In:** Register a custom function via the Facade API on the V1-0-2 spike sheet. Determine: can a Facade function return a 2D array that spills? If not, prove the fallback (plugin-level `BaseFunction` returning `ArrayValueObject`). Verify a custom function can return a rich/boxed value or a tagged string we can intercept for `TypedValue` display (quantities with units, error codes).
- **Out:** No real function registry.
- **Acceptance:** Spill behavior documented with working code for whichever path works; V1-3-1 below is annotated with the chosen mechanism in the memo.

**V1-0-4 · Decision memo + doc updates** · *Size S · Deps: V1-0-2, V1-0-3*
- **In:** Write `docs/v1-0-findings.md`: per-spike outcome, chosen mechanisms, API landmines, go/no-go calls. Update ARCHITECTURE.md current-state and the PRD risk register rows affected (geometry rows re-tagged V2). Delete or explicitly promote each spike route.
- **Acceptance:** Memo exists; ARCHITECTURE.md reflects reality; no orphaned spike code without a stated reason.

---

## 4. V1-1 — Engine: values, units, formulas (2 weeks, starts during V1-0)

**Goal:** the typed core of SCHEMA.md, pure TypeScript with **zero UI imports** (`src/lib/engine/`), fully unit-tested. This layer is the product; every block type is a projection of it. Nothing here depends on the spikes, so it starts day one.

> **Status: done (19 Jul 2026).** All four tasks shipped and tested. Per the same-day decision, the V1-1-2 quantity/units layer stays **engine-only and dormant until V2** — no V1 surface parses, renders, or converts units.

### Parallel lanes

| Lane A (types) | Lane B (units) | Lane C (formulas) |
|---|---|---|
| V1-1-1 | V1-1-2 (after V1-1-1) | V1-1-3 (after V1-1-1) → V1-1-4 |

**V1-1-1 · TypedValue, Dimension, and node model** · *Size M · Deps: V1-0-1*
- **In:** Implement SCHEMA.md §2–3 verbatim in `src/lib/engine/types.ts` + `node.ts`: `TypedValue` union, `Dimension` (SI exponent vector + display), `GraphNode`, `ErrCode` set, ULID `NodeId` generation, stable `contentHash` (`hash(opId + inputHashes)`) with a fast non-crypto hash, exhaustive type guards. Include `Provenance` and `PendingChange` fields (SCHEMA.md §3) on every node from day one: serialized, stamped, never interpreted (the V3 hook).
- **Out:** No evaluation, no parsing, no persistence.
- **Acceptance:** Vitest: hash deterministic and input-order-sensitive; type guards exhaustive (`switch` over `kind` compiles with `never` check); provenance/pending round-trip untouched; zero imports from outside `engine/`.

**V1-1-2 · Quantity/units layer + dimensional checking + conversion** · *Size L · Deps: V1-1-1*
- **In:** `src/lib/engine/units.ts`: unit table (SI + common engineering: N, kN, MPa, mm, m, kg, s, °C…), parse `"5 kN"` → `{value, Dimension}`, arithmetic on the exponent vector (mul/div compose; add/sub require equal dims else `#UNIT!`), power/root, comparisons, and **display-unit conversion** (`format(q, {unit, digits})`, `convert(q, unit)` rejecting dimension mismatches). Feet-inch explicitly out (PRD §5.6).
- **Out:** No UI components; no user-defined units.
- **Acceptance:** Vitest corpus ≥60 cases: `kN·m` composition, `kN + m` → `#UNIT!`, `sqrt(m²)` → `m`, conversion round-trips (`5 kN` ↔ `5000 N`); property test: dimension arithmetic associative/commutative where math says so.

**V1-1-3 · FormulaAST + reference resolution (edges are derived)** · *Size L · Deps: V1-1-1*
- **In:** `FormulaAST` and a parser for the v1 grammar: numbers with unit literals (`5 kN`, `3.2 m`), arithmetic/comparison operators, function calls, cell refs (`A1`, ranges), dotted published names (`beam.span`). `resolveInputs(ast, resolver): NodeId[] | #REF!/#NAME?` derives the `inputs` array (SCHEMA.md §3: edges are derived, never authored). AST is serializable JSON; include a printer (AST → canonical source text) for show-steps (V1-5-4) and the provenance inspector.
- **Out:** No evaluation (V1-2-2), no Univer syntax quirks (V1-3-1 maps those).
- **Acceptance:** Vitest table-driven parse/print round-trip corpus (≥40 cases incl. unit literals and error cases); unresolved name → `#NAME?`, dangling ref → `#REF!` as *values* per SCHEMA.md §2.

**V1-1-4 · Function registry + built-ins** · *Size M · Deps: V1-1-2, V1-1-3*
- **In:** `FnSignature` registry per SCHEMA.md §6 with `origin: 'builtin' | 'user'` from day one (the V3 sandbox seam). Quantity-lifted arithmetic + `SUM/MIN/MAX/AVERAGE/COUNT/IF/ROUND/ABS/SQRT/POW`, arg validation against declared `params` (wrong kind → `#VALUE!`, wrong dim → `#UNIT!`). `SHOWSTEPS` registered but returns `#VALUE!('not yet')` until V1-5-4.
- **Out:** No geometry functions (V2), no evaluator wiring (V1-2-2 consumes this).
- **Acceptance:** Vitest: each built-in with quantity/scalar/error inputs; error propagation (any `Err` arg ⇒ `Err` result carrying `origin`); registry rejects duplicate registration.

---

## 5. V1-2 — Engine: mutations + reactive recalc (1.5 weeks)

**Goal:** the mutation API is the sole write path and edits propagate reactively. This is what "every block is connected and reactive" means mechanically: after this milestone, every block type (sheet, chip, and later viewer and agent) is just a subscriber.

> **Status: done (19 Jul 2026).** All three tasks shipped and tested (320 engine cases total; perf gate green at ~3–5 ms for the 500-node chain). Design decisions recorded in ARCHITECTURE.md "Engine conventions (V1-2)".

**V1-2-1 · Mutation API + undo log** · *Size L · Deps: V1-1-3*
- **In:** `applyMutation(m: GraphMutation, actor: Actor)` per SCHEMA.md §9 for `setInput`, `setFormula`, `addNode`, `removeNode`, `publishName`, `rebindChip`, and `blockOp` (all real: the document editor is V1, nothing stays stubbed). Validation before commit (type/dim shape, cycle pre-check via V1-1-3 resolution), provenance stamping from `actor`. Undo log per SCHEMA.md §9: `UndoEntry` with serializable inverses captured at apply time (full prior state; `removeNode`/`blockOp remove` carry the whole node/block), one linear per-document history with a cursor, `undo()`/`redo()` running through the same validated apply path without appending entries, fresh mutations truncating the redo tail, cap at 200 entries. Delete semantics: removing a node converts dependents' refs to `#REF!` immediately (SCHEMA.md §5).
- **Out:** No recalc (returns `AffectedSet` for V1-2-2); no UI; no log persistence (V1-4-1 stores it).
- **Acceptance:** Vitest: every op round-trips through undo/redo to identical graph state (deep-equal incl. hashes); undo of `removeNode` heals dependents' `#REF!` on re-resolution; entries survive `JSON.stringify`/`parse` and still undo/redo correctly; a fresh mutation after `undo()` truncates the redo tail; invalid mutations reject without partial writes; actors `human`/`template` stamp provenance correctly.

**V1-2-2 · Topological + content-hash incremental recalc** · *Size L · Deps: V1-2-1, V1-1-4*
- **In:** Implement SCHEMA.md §4 exactly: dirty = affected ∪ transitive descendants, Kahn topo-sort of the dirty subgraph, memo skip on `contentHash` match, evaluation via the function registry, subscriber notification (`subscribe(nodeId, cb)`). Geometry queue is a documented no-op hook until V2.
- **Out:** No geometry, no UI bindings.
- **Acceptance:** Vitest: order-independence (shuffled insertion order ⇒ identical results/hashes); memo hits verified by an eval-count spy; **perf test: < 50 ms scalar propagation over a 500-node dirty chain** (CI-enforced, PRD §4); full re-eval from inputs reproduces every `contentHash` bit-for-bit.

**V1-2-3 · Cycle detection → `#CYCLE!`** · *Size S · Deps: V1-2-2*
- **In:** Cycle found during Kahn ⇒ every member gets `#CYCLE!` listing member names/ids (SCHEMA.md §11); rest of the graph still evaluates; a mutation that *introduces* a cycle is rejected at `applyMutation` time with the would-be cycle in the error.
- **Acceptance:** Vitest: direct, transitive, and self-reference cycles; non-cycle branch unaffected; breaking the cycle clears `#CYCLE!` on next recalc.

---

## 6. V1-3 — Univer adapter (2 weeks)

**V1-3-1 · Univer adapter: custom functions, cell↔node binding, named-range lift** · *Size XL · Deps: V1-2-3, V1-0-3*
- **In:** `src/lib/adapters/univer/`: the **only** place allowed to import `@univerjs`. (a) Register all registry functions into Univer via the V1-0-3-chosen mechanism; `TypedValue` display (scalars, error codes `#CYCLE!`/`#REF!`/`#VALUE!` etc.) renders in cells. (b) Cell edit → `setInput`/`setFormula` mutation; graph notification → cell display update; **no write path around `applyMutation`** (Univer's own recalc is demoted to display). (c) Named range creation/rename/delete → `publishName` → `NamedOutputNode` with dotted name; dotted names usable in formulas across sheets through the graph (no second formula engine, PRD §5.4). (d) Adapter-wrap every Univer API touched (pre-1.0 churn risk). (e) Boot order per docs/v1-0-findings.md landmine 1: `setInitialFormulaComputing(NO_CALCULATION)` before workbook creation, register functions at lifecycle `Steady`, then one explicit recalc — otherwise loaded snapshots referencing custom functions paint `#NAME?`.
- **Out:** No document canvas hosting (V1-5-2); a single standalone sheet page is fine here; no geometry functions; **no unit literals, unit rendering, or display-unit conversion in cells** (units surface in V2 · decision 19 Jul 2026; the engine layer already exists in V1-1-2).
- **Acceptance:** Playwright: type `=5 * 2` → cell shows `10`; `=beam.span` in another sheet resolves; rename the named range → dependents update; a self-referencing formula shows `#CYCLE!`; a cell edit reaches the graph *only* through `applyMutation` (spy in a unit test of the adapter layer).

> **Status: done (20 Jul 2026).** Shipped and tested (40 adapter unit tests, 9 Playwright). Recalc demotion is structural — formulas are stripped from the Univer model (`f: null`), the graph owns every AST. Conventions recorded in ARCHITECTURE.md "Adapter conventions (V1-3-1)". Spike routes deleted; `/sheet` is the standalone reference page.

---

## 7. V1-4 — Persistence (1 week, parallel with V1-3/V1-5)

**V1-4-1 · Convex persistence + reproducibility CI** · *Size L · Deps: V1-2-2*
- **In:** Convex tables `documents`, `graphNodes`, `blocks`, `sheetSnapshots`, `chipBindings`, `undoLog` (SCHEMA.md §10; `versions` is V2) behind a thin `src/lib/persistence/` interface so **no UI component imports `convex` directly**. Save: debounced full-node upsert on recalc settle (keep it simple; optimize when it hurts, V2-6), undo entries + `documents.undoCursor` written with the same debounce and pruned to the 200-entry cap. Load: rows → graph → verify hashes → restore the undo stack and cursor. Document create/list/rename/delete. **CI reproducibility test:** load each fixture doc, re-evaluate all from inputs, assert every `contentHash` matches stored, byte-for-byte (SCHEMA.md §5: "restart & run all is a no-op").
- **Out:** No version snapshots; no auth; no conflict handling (single user); no offline mode.
- **Acceptance:** Kill the tab mid-work, reload → identical values and hashes, and `undo()` after reload reverts the last pre-reload edit (redo tail preserved too); reproducibility test runs in CI on ≥2 fixture documents; grep shows zero `convex` imports outside `src/lib/persistence/` + `src/convex/`.

> **Status: done (20 Jul 2026).** Shipped and tested; the reproducibility gate and the convex-import boundary both run in CI (`reproducibility.convex.test.ts`, `boundary.test.ts`). Θ→THETA codec, wipe-and-replace save, pure `hydrateGraph` load. Conventions in ARCHITECTURE.md "Persistence conventions (V1-4-1)"; fixtures exported for V1-5-6.

---

## 8. V1-5 — The document (3 weeks)

**Goal:** the working prototype. One TipTap canvas where prose (markdown input), images, and calculation sheets coexist, prose references sheet results via live chips, every computed value can show its derivation, and nothing is a black box.

### Parallel lanes

| Lane A (canvas) | Lane B (graph UX) | Lane C (QAQC) |
|---|---|---|
| V1-5-1 → V1-5-2 | V1-5-3 (after V1-5-1) | V1-5-4 · V1-5-5 (after V1-5-3) |
| | all → **V1-5-6** | |

**V1-5-1 · Block editor shell + blockOp + document list** · *Size L · Deps: V1-2-1, V1-4-1, V1-0-2*
- **In:** `/app` document list (create/rename/delete) and `/app/[docId]` TipTap document (DESIGN.md tokens via existing `tokens.css`): block types `text`, `heading`, `image` (Convex file storage) per SCHEMA.md §8, with markdown input rules for prose (`#`, `**`, lists). Add/move/remove/reorder via the `blockOp` mutation so block structure lives in the graph's undo log; `position` is layout-only (evaluation never reads it, SCHEMA.md §5); save-state indicator; undo/redo wired to V1-2-1; keyboard-navigable blocks (PRD §10).
- **Out:** No sheet blocks yet (V1-5-2), no chips (V1-5-3), no equation blocks (V2), no sharing.
- **Acceptance:** Playwright: author text/headings/images with markdown shortcuts, reorder, reload intact; undo spans block ops; Vitest: moving blocks never triggers recalc (spy).

> **Status: done (20 Jul 2026).** Shipped and tested (24 editor unit tests, 4 Playwright). TipTap history disabled — engine undo is the one history; trailing paragraph is ephemeral until it gains content. Conventions in ARCHITECTURE.md "Editor conventions (V1-5-1/V1-5-2)".

**V1-5-2 · Sheet blocks in the canvas** · *Size L · Deps: V1-5-1, V1-3-1*
- **In:** Promote the V1-3-1 adapter into a canvas NodeView (V1-0-2 patterns): multiple sheet blocks per document, each with its own Univer snapshot (`sheetSnapshots`), all publishing into the one document graph; cross-sheet dotted-name references verified in-canvas; focus management between prose and grid; sheet edits and block ops share one undo history. Each sheet block is a full Univer instance (docs/v1-0-findings.md landmine 2): measure mount time + memory at N sheets and, if it hurts, lazy-mount only visible sheets (off-screen sheets render from their snapshot).
- **Out:** No viewer blocks (V2).
- **Acceptance:** Playwright: two sheets in one doc; sheet A publishes `beam.span`, sheet B consumes it; block move never changes values (SCHEMA.md §5); reload restores both snapshots and all graph state; mount time + memory at 2/4/8 sheet blocks measured and recorded in ARCHITECTURE.md with the mount strategy decision (eager vs lazy).

> **Status: done (20 Jul 2026).** Shipped and tested (6 Playwright). Mount metrics at 2/4/8 sheets recorded in ARCHITECTURE.md → decision: **eager** (~3.4 s/sheet, flat; revisit thresholds documented). In-grid undo chords intercepted at window-capture and routed to engine undo (Univer's ShortcutService also binds window-capture).

**V1-5-3 · Inline live value chips** · *Size L · Deps: V1-5-1, V1-3-1*
- **In:** Inline TipTap node + `ChipBinding` (SCHEMA.md §8): insert-by-name picker (`@beam.span`), renders live value per `format` (plain numbers in V1; units V2), recompute flash per DESIGN.md §5 (accent → dim, 700 ms; reduced-motion honored), busy state during recalc, error chips show the code and **deep-link to `origin`** (click scrolls to the failing block/cell, SCHEMA.md §11). `rebindChip` through `applyMutation` only. Deleted node → chip shows `#REF!`. Labeled for screen readers (PRD §10).
- **Acceptance:** Playwright: chip in prose updates on cell edit with flash; error chip navigates to root cause; chips survive copy/paste within the doc; Vitest: rebind through `applyMutation` only.

> **Status: done (20 Jul 2026).** Shipped and tested (23 chip unit tests + 5 engine lifecycle tests, 5 Playwright). Chip lifecycle is a new `chipOp create/remove` mutation (SCHEMA.md §9 updated); conventions (undo ordering, busy-as-value, deep-link fallback, paste semantics) in ARCHITECTURE.md "Chip conventions (V1-5-3)".

**V1-5-4 · Show-steps rendering** · *Size M · Deps: V1-1-4, V1-5-3*
- **In:** For any computed node: substituted derivation from the stored AST via the V1-1-3 printer — formula with names, then values substituted (units in the substitution arrive with V2), then intermediate results, then final (PRD §4: 100% of computed nodes). Surfaces: chip expansion in-canvas and `SHOWSTEPS(ref)` (un-stub from V1-1-4) rendering as a block. Plain-text representation available (accessibility, PRD §10). Mono for all computational text (DESIGN.md §4).
- **Acceptance:** Vitest: derivation corpus over the V1-5-6 fixture (every computed node yields well-formed steps); Playwright: expand chip → steps.

> **Status: done (20 Jul 2026).** Engine half: `src/lib/engine/showsteps.ts` (derivation builder + plain-text renderer, 19 tests incl. the fixture corpus), `SHOWSTEPS(ref)` un-stubbed via `evaluateFormula` interception + optional `EvalEnv.nodeById`. UI half: value chips expand to an in-canvas steps panel; `=SHOWSTEPS(name)` cells settle to derivation text; evaluator wired in `createGraphSession` + `hydrateGraph` (4 Playwright scenarios incl. reload with zero hydration mismatches). Conventions in ARCHITECTURE.md "Show-steps conventions (V1-5-4)".

**V1-5-5 · Provenance inspector (read-only)** · *Size S · Deps: V1-1-1, V1-5-3*
- **In:** Side-panel on chip/cell/named-value select: name, kind, formula (canonical text), value, `authoredBy/At`, direct inputs and dependents as navigable links (provenance queries are the reviewability story, PRD §2 — this panel is why there is no node canvas). Read-only.
- **Acceptance:** Playwright: select chip → inspector; walk inputs to a source input; walk dependents back down; template-authored fixture displays attribution.

> **Status: done (20 Jul 2026).** Shipped and tested (16 view-model unit tests, 4 Playwright; template/agent attribution covered in Vitest against real-actor fixtures). Alt+click/Alt+Enter inspects a chip; graph-bound cell selection inspects, intent-gated so mount-time programmatic selections never open the panel. Conventions in ARCHITECTURE.md "Inspector conventions (V1-5-5)".

**V1-5-6 · V1 checkpoint: the prototype demo** · *Size S · Deps: all V1-5, V1-4-1*
- **In:** A scripted fixture document (also a CI fixture for V1-4-1's reproducibility test): a short beam calc authored as prose + image + two sheets + chips + show-steps. One Playwright scenario end-to-end: create doc → markdown prose → sheet with inputs/formulas and published names → chips in prose → edit a cell, chips flash and follow → cross-sheet reference → introduce and fix a `#CYCLE!` and a `#VALUE!` → expand a chip to show-steps → open the inspector and walk the dependency chain → reload, state intact → undo/redo across the whole session, including undoing a pre-reload edit after the reload.
- **Acceptance:** The scenario passes in CI and takes < 3 minutes to demo live. This is the V1 exit gate.

> **Status: done (20 Jul 2026) — V1 exit gate passed.** `buildDemoFixture` (simply-supported beam: `beam.moment = w * L^2 / 8`, deflection chain, cross-sheet `beam.util`, SHOWSTEPS cell) joined `FIXTURE_BUILDERS` and rides the reproducibility gate; `e2e/v1-demo.spec.ts` walks the full scenario end-to-end through the real UI in ~16 s (image block covered by app-editor.spec.ts instead; noted in the spec). Full suite: 504 Vitest + 33/33 Playwright. CI-workflow wiring (GitHub Actions + Convex secret) is a separate pending decision.

---

## 9. R1.6 — Attached workbook release (complete locally)

The detailed contract, sequencing, risks, and acceptance matrix live in
[docs/v1-6-workbench-plan.md](docs/v1-6-workbench-plan.md). Completion summary:

| Workstream | Result |
|---|---|
| R1-0 contract, ownership, persistence | Stable `SheetId`, typed workbook manifest, Better Auth ownership, atomic revision/hash CAS, fail-closed load |
| R1-1 workbook | One Univer instance/document, custom tab strip + graph formula line, add/rename/delete/undo/redo, exact cell deep-link |
| R1-2 parameters + units | Published alias resolver, editable input pills/rail, shared SI/imperial parsing and formatting |
| R1-3 equations | Static/bound discriminated union, structured TeX derivations, guarded accessible KaTeX |
| R1-4/5 report + list | Uniform block chrome, live/trash views, search/sort/stats/bulk lifecycle, responsive layouts |
| R1-6 lifecycle | Recoverable trash, strict 30-day purge, validated owned assets, durable cleanup, guarded dev reset |
| R1-7 release/demo | Steel demo fixture, Vercel adapter/CSP/headers, CI and protected manual production workflow |
| R1-8 docs | Architecture/schema/operator docs and compounded resolution note |

Local release gates are green: frozen install, Svelte/TypeScript diagnostics,
all Vitest projects, production build, desktop/narrow Playwright, axe, dependency
audit threshold, secret scan, and import boundaries. Production execution is
intentionally pending the separate production Convex/Vercel credentials and
protected-environment approval described in the README.

---

## 10. V2 — Connect the viewer (outline; task briefs written at V1 exit)

Geometry updating from calculation results is the V2 headline. The deferred spikes run first, because that's when their answers are needed:

- **V2-0 · Spike:** occt-wasm browser matrix + disposal behavior (former M0-4, verbatim; decides the exact-kernel path).
- **V2-U · Units surfaced in the product** (deferred from V1, decision 19 Jul 2026): unit literals and quantity display in cells, display-unit conversion per cell/named value (`format`/`convert` from V1-1-2; stored value unchanged), `#UNIT!` rendered inline with deep-links, chips and show-steps with units. Adapter + UI only — the engine layer already exists and is tested (V1-1-2).
- **V2-1 · Geometry core:** `GeometryKernel` interface + content-addressed `GeometryStore` with sweep (SCHEMA.md §7); manifold-3d preview adapter; occt-wasm exact adapter in a Worker. (Former M2-1..M2-3.)
- **V2-2 · Geometry as a value:** `POINT/LINE/POLYLINE/PROFILE/EXTRUDE/DISTANCE/LENGTH/VOLUME` built-ins with dimension checks (`EXTRUDE(profile, 5 kg)` → `#UNIT!`); recalc integration filling the V1-2-2 hook (preview-then-exact, mandatory sweep); hard gates in CI: no WASM growth over 1,000 recalcs, p95 small-edit preview < 16 ms. (Former M2-4..M2-6.)
- **V2-3 · Viewer block:** Three.js viewer as a canvas block with bidirectional picking (click solid → node; `highlight(nodeId)` in); parametric-beam demo: edit `beam.span` in a sheet, the solid re-extrudes, chips update. (Former M2-7/M2-8.)
- **V2-4 · Report surface:** equation block (KaTeX/MathLive, display-only), paginated PDF export (blocks in `position` order, chips resolved, sheets as tables, viewers as snapshots, show-steps per settings; SCHEMA.md §12). (Former M3-2/M3-7.)
- **V2-5 · Trust:** templates (beam/column/footing instantiated through `applyMutation`, actor `template`; time-to-first-value < 10 min), version snapshots + restore, 2,000-node performance pass, error UX + a11y sweep. (Former M4-1/M4-2/M4-5/M4-6.)
- **V2-6 · IFC:** "ifc-lite" IFC4X3 writer + validation harness in CI, gated on the V2-0 exact-kernel decision. (Former M4-3/M4-4.)

Auth + collaboration (former M5) remains its own pre-beta track after V2; the single mutation API (V1-2-1) is what keeps concurrent editing tractable.

## 11. V3 — MCP + AI (outline)

The hooks are already live at V1 exit: `pending` slot + provenance (V1-1-1, V1-2-1), single mutation API (V1-2-1), shared `FnSignature` (V1-1-4).

- **V3-1 · MCP meta-tools** exposing the mutation API + provenance queries.
- **V3-2 · Propose→validate→commit** on the `PendingChange` slot; diff UI; `actor: 'agent'`.
- **V3-3 · Ambient suggestions** surfaced in the provenance inspector.
- **V3-4 · User-defined functions via E2B:** only `impl` dispatch changes; signatures/validation/registration already shared (SCHEMA.md §6).

---

## 12. Cross-cutting rules for every task

1. **No projection writes around `applyMutation`.** Enforce with a lint rule/test once V1-2-1 lands, not by review vigilance.
2. **Third-party isolation:** `@univerjs` only under `src/lib/adapters/univer/`; `convex` only under `src/lib/persistence/` (+ `src/convex/`); `@tiptap`/ProseMirror only under the editor components; kernels (V2) only under `src/lib/geometry/`. Cheap to check in review, existential when Univer churns (risk register).
3. **Licensing:** Apache/MIT/BSD/MPL only; LGPL solely as the replaceable occt `.wasm` (V2); **no GPL** anywhere, including dev deps of shipped code (PRD §10).
4. **Design compliance:** app surfaces consume `tokens.css`; mono for everything computational; accent only where DESIGN.md §3 allows; no new colors, no shadows, no gradients.
5. **Docs:** a task that changes structure or takes a decision updates ARCHITECTURE.md in the same PR. Public methods get doc comments (AGENTS.md).
6. **CI gates are cumulative:** scalar perf (V1-2-2), reproducibility (V1-4-1), then V2's leak/16 ms/zero-stale/IFC gates. Once added, never disabled.
