# OctoMeta — Product Requirements Document (v3)

_The living engineering document. One mind, eight arms._

**Status:** Approved for development kickoff · **Date:** 18 July 2026 · **Owner:** Founding team

---

## 0. Name & brand premise

**OctoMeta.** An octopus keeps two-thirds of its neurons in its arms — eight limbs sensing and acting semi-independently, coordinated by one mind. That is precisely our architecture: independent projections (the grid, the report, the 3D viewer) each doing real work, coordinated by one typed dependency graph. **"Meta" is the graph above the views.** The name is not decoration; it states the architecture.

**Vision statement (canonical, used verbatim in the hero):**

> OctoMeta is the living engineering document. Your calculations, your report, and your 3D model are arms of a single intelligent graph — edit anywhere, and every arm follows.

---

## 1. Problem

Civil/structural engineers split every project across (a) spreadsheets where logic hides behind cell references and unit errors are silent, (b) Word/PDF calc packages disconnected from the numbers that produced them, and (c) CAD/BIM models manually reconciled with the calcs. Recalculation is order-dependent with hidden state (the Jupyter/Excel failure mode — large-scale studies found only ~24% of Jupyter notebooks re-execute without error and ~4% reproduce their results), provenance is weak, and the calc is never the deliverable — it is _transcribed_ into one. Industry estimates put ~40% of engineering time into finding, rebuilding, and reconciling calculations.

## 2. Product thesis

**One model, many projections.** The source of truth is a typed, document-scoped dependency graph — named values, quantities-with-units, tables, geometry handles. The spreadsheet is a view. The report is a view. The 3D model is a view. There is no node-canvas UI: reviewability comes from provenance queries, "show steps," and inspector panels, not a graph editor.

**Jupyter-style, with the bug fixed.** The document reads top-to-bottom like a computational notebook — visible inputs and outputs, no hidden state — but evaluation order is the topological order of the graph, never the position of a block on the page (the Observable/Marimo principle applied to engineering values).

**The report is the deliverable.** Paginated PDF _and_ schema-valid IFC4X3 export from the same graph. The calc document and the BIM model are one artifact.

**AI-ready, not AI-led.** Every edit — human or future agent — flows through one typed mutation API with provenance fields reserved from day one. AI features ship late (M6) into pre-built hooks.

## 3. Personas & Jobs To Be Done

| Persona                                      | Core job                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Priya — design engineer** (primary)        | "Produce a defensible, unit-safe calc package + model faster, without re-authoring across tools." |
| **Marcus — checker/verifier**                | "Show me how any number was derived, who authored it, and that nothing is stale."                 |
| **Aisha — BIM/digital lead**                 | "Give me ISO 19650-style auditability and IFC4X3 interoperability from the calc itself."          |
| **Tom — computational designer** (secondary) | "Geometry from parameters, inside a documentable, checkable calc."                                |

## 4. Success metrics

**Early (M1–M4):** zero stale reads over a 1,000-recalc soak; small-edit mesh update < 16 ms; scalar propagation < 50 ms @ 500 nodes; "show steps" on 100% of computed quantity nodes; reference calc round-trips to valid PDF + IFC4X3; time-to-first-geometry < 10 min.
**Later (M5–M6):** concurrent editors per doc; % agent-proposed mutations accepted unedited; validation catch-rate on unit/dimension errors.

## 5. Core architecture (fixed decisions)

1. **Typed dependency graph** as single source of truth (full model in `SCHEMA.md`): InputNode / ComputedNode / NamedOutputNode / GeometryNode / TableNode / ErrorNode; `TypedValue` union (Scalar, Quantity, Str, Bool, Table, GeometryHandle, Err); edges derived from references, never authored; topological + content-hash incremental recalc; cycle rejection → `#CYCLE!`.
2. **Single typed mutation API** — the only write path for every projection; undo log; the AI hook.
3. **Geometry as a value.** `=POINT/LINE/EXTRUDE` return content-addressed handles `geom:<op>:<hash>`; a document-scoped **GeometryStore** owns real objects; `=DISTANCE` unboxes to Quantity. Kernels behind a swappable `GeometryKernel` interface: **manifold-3d** (Apache-2.0, fast previews) + **public `andymai/occt-wasm`** (OCCT V8, exact B-Rep; LGPL satisfied via replaceable `.wasm`). **Hard gate:** no WASM leak over 1,000 recalcs; sweep/GC after each recalc.
4. **Univer OSS only** (Apache-2.0) as the demoted, swappable grid widget; custom functions via the Facade formula API; named ranges publish named outputs into the document graph. HyperFormula rejected (GPLv3). No second formula engine at document level.
5. **Document canvas:** TipTap/ProseMirror with Svelte 5 NodeViews (`edra` patterns). Blocks: text, heading, image, equation (KaTeX render / MathLive edit), sheet, viewer, plus **inline live value chips** in prose.
6. **Units as table stakes:** boxed Quantity everywhere, dimensional checking → `#UNIT!`, "show steps" substitution rendering; feet-inch later.
7. **Persistence:** Convex (document JSON, Univer snapshots, graph rows, version history). Single-user early; **no auth until M5**.
8. **Deferred with hooks built now:** AI propose→validate→commit + MCP meta-tools (hook = mutation API + provenance/pending-change fields); sandboxed user-defined functions via E2B (hook = shared function-registry signature model); auth/collaboration via Better Auth (hook = mutation-API-mediated writes).

## 6. Tech stack

| Layer     | Choice                                                         | License                | Note                                                                                                                     |
| --------- | -------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Framework | SvelteKit + Svelte 5 (runes), TypeScript                       | MIT                    | Mandatory                                                                                                                |
| Grid      | Univer OSS (`@univerjs`, pin version)                          | Apache-2.0             | Pre-1.0 API churn → adapter wrap                                                                                         |
| Editor    | TipTap + ProseMirror + `svelte-tiptap`/`edra` patterns         | MIT                    | Svelte NodeViews                                                                                                         |
| Math      | KaTeX (render) + MathLive (edit)                               | MIT                    |                                                                                                                          |
| Geometry  | `andymai/occt-wasm` (exact) + `manifold-3d` (preview)          | LGPL-wasm / Apache-2.0 | Behind `GeometryKernel`; verify browser matrix in M0 (tail-calls now Baseline — README's "no Firefox" note likely stale) |
| Viewer    | Three.js                                                       | MIT                    | Handle-keyed mesh diff/swap, bidirectional picking                                                                       |
| Units     | Custom Quantity layer seeded from js-quantities / mathjs units | MIT / Apache-2.0       |                                                                                                                          |
| Backend   | Convex                                                         | —                      | SvelteKit support experimental → M0 spike; abstract persistence                                                          |
| IFC       | Custom "ifc-lite" IFC4X3 writer (reference web-ifc)            | —                      | Validation harness in CI                                                                                                 |
| Tooling   | pnpm + Turborepo, Vitest + Playwright                          | MIT                    |                                                                                                                          |
| Deferred  | Better Auth (M5), E2B sandbox (M6), MCP server (M6)            | —                      | Hooks only, early                                                                                                        |

## 7. Milestones

| #      | Name                              | Dur. | Exit criteria                                                                                                                                                                  |
| ------ | --------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **M0** | De-risk spikes                    | 3 wk | Univer-in-TipTap-in-SvelteKit renders + Convex round-trip; occt-wasm verified in Chrome/Firefox/Safari; Facade array-spill behavior determined                                 |
| **M1** | Graph core + units + grid binding | 5 wk | Mutation API sole write path; topo + content-hash recalc; `#UNIT!`/`#CYCLE!`; named-range → NamedOutputNode; provenance/pending fields serialized (dormant); function registry |
| **M2** | Geometry + viewer                 | 5 wk | Kernels behind interface; handle store + sweep; **1,000-recalc no-leak + <16 ms gate**; viewer with bidirectional picking                                                      |
| **M3** | Document canvas + chips + PDF     | 5 wk | Full block editor; live value chips; show-steps; provenance inspector (read-only); paginated PDF                                                                               |
| **M4** | Polish + templates + IFC          | 5 wk | 2,000-node perf pass; beam/column/footing templates; **schema-valid IFC4X3**                                                                                                   |
| **M5** | Pre-beta: collaboration + auth    | 5 wk | Better Auth; sharing; concurrent editing over the mutation API                                                                                                                 |
| **M6** | Roadmap: AI + sandboxed functions | open | Propose/validate/commit on pending-change slot; ambient suggestions; MCP meta-tools; user functions via shared registry                                                        |

## 8. Task graph (IDs → depends-on)

M0-1 scaffold → M0-2 Univer-in-NodeView, M0-3 Convex round-trip, M0-4 occt browser matrix, M0-5 spill spike.
M1-1 node/value model (M0-3) → M1-2 **mutation API + undo** → M1-3 topo/hash recalc → M1-4 cycles; M1-5 units (M1-1); M1-6 named-range lift (M1-2, M0-2); M1-7 provenance fields (M1-1); M1-8 function registry (M1-2).
M2-1 kernel interface (M1-8) → M2-2 occt adapter (M0-4), M2-3 manifold adapter → M2-4 geometry fns → M2-5 store+sweep → M2-6 **leak/16 ms gate** → M2-7 viewer.
M3-1 block editor (M1-2) → M3-2 sheet/viewer blocks (M2-7) → M3-3 value chips (M1-6); M3-4 show-steps (M1-5); M3-5 provenance inspector (M1-7); M3-6 PDF (M3-2).
M4-1 perf pass; M4-2 templates; M4-3 IFC writer (M2-4).
M5-1 auth → M5-2 sharing → M5-3 concurrency (M1-2).
Deferred: AI-1..3 (M1-2, M1-7); SANDBOX-1 (M1-8).

## 9. Risk register

| Risk                            | L   | I   | Mitigation                                                                                                             |
| ------------------------------- | --- | --- | ---------------------------------------------------------------------------------------------------------------------- |
| Univer pre-1.0 API churn        | H   | M   | Pin exact (0.25.1), adapter-wrap, swappable grid; known landmines recorded in docs/v1-0-findings.md                     |
| Facade array-spill undocumented | —   | —   | **Resolved by V1-0-3 spike:** Facade functions returning 2D arrays spill natively; no `BaseFunction` fallback needed    |
| WASM memory leaks (V2)          | M   | H   | Sweep/GC per recalc; V2-2 hard gate; `Symbol.dispose` discipline                                                       |
| occt-wasm browser matrix (V2)   | M   | H   | V2-0 empirical test; manifold-only fallback path                                                                       |
| ProseMirror-in-Svelte friction  | L   | M   | **De-risked by V1-0-2 spike:** plain-JS NodeView mounting Svelte 5 `mount()`; logic in TS, views in Svelte             |
| Recalc→mesh perf (V2)           | M   | H   | Content-hash memoization; kernel in worker; preview-then-exact                                                         |
| Convex↔SvelteKit maturity       | L   | M   | De-risked by the live waitlist backend; persistence abstraction (V1-4-1)                                               |
| IFC correctness (V2)            | M   | H   | Validate vs web-ifc reader; CI regression corpus                                                                       |
| Open Calc Studio ships graph+3D | M   | M   | Speed on IFC + web + spreadsheet UX; monitor                                                                           |

## 10. Non-functional requirements

Perf budgets as §4. Licensing: Apache/MIT/BSD/MPL preferred; LGPL only as replaceable `.wasm`; **no GPL**. Offline-tolerant single-user posture early (client-side WASM compute). Accessibility: keyboard-navigable blocks, labeled chips, AA contrast, `prefers-reduced-motion` honored, show-steps available as text.

## 11. Out of scope (v1)

Node-canvas editor · founder's private OCCT build · HyperFormula · auth/collaboration before M5 · AI features before M6 · sandboxed user code before M6 · mobile authoring · FEA solving (we integrate results; we don't solve).
