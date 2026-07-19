# V1-0 · De-risk spike findings

**Date:** 19 July 2026 · **Status:** complete · **Verdict: GO for the V1 plan as written.**
Spike code: `src/routes/spike/` (index at `/spike`, no navigation links point there).
Proofs are executable: `pnpm test:e2e` runs `e2e/spike-univer.spec.ts` against the production build (SSR + hydration, Chromium).

## V1-0-2 · Univer sheet inside a TipTap NodeView — **confirmed**

Setup proven: TipTap v3 (`Editor` from `@tiptap/core`, StarterKit) with a custom
`univerSheet` atom block whose plain-JS NodeView mounts a Svelte 5 component via
`mount()`/`unmount()`; the component hosts a Univer OSS sheet through
`createUniver` + `UniverSheetsCorePreset` (`@univerjs/presets` 0.25.1, exact pin).

| Proof | Outcome |
|---|---|
| (a) SSR/hydration | Page server-renders (all Univer imports are dynamic inside `onMount`); grid mounts after hydration. |
| (b) Keyboard focus | `stopEvent: () => true` + `contenteditable="false"` on the NodeView dom: typing in the grid never reaches ProseMirror, and focus returns cleanly to prose. `ignoreMutation: () => true` is mandatory (Univer mutates its DOM constantly). |
| (c) Edits survive block move | A move destroys and recreates the NodeView. The live workbook cannot survive that, so snapshots are saved to a module-level store (`sheet-store.ts`, keyed by `sid` attr) on a debounced `onCommandExecuted` and flushed synchronously on view destroy; the new view rehydrates from the store. This is the pattern V1-5-2 promotes into the `sheetSnapshots` table. |
| (d) Serialize/restore | Serialization flushes the store into the node's `snapshot` attr (`IWorkbookData` JSON), then `editor.getJSON()`. Full editor teardown + rebuild from that JSON restores the sheet bit-for-bit at the workbook-data level. |

### API landmines (carry into V1-3-1 / V1-5-2)

1. **Lifecycle gating.** `univerAPI.getFormula().registerFunction()` throws
   `[redi]: Expect 1 dependency item(s) for id "sheets-formula.register-function-service"`
   if called before the lifecycle reaches `Steady`. Wait on
   `univerAPI.addEvent(univerAPI.Event.LifeCycleChanged, …)` for
   `Enum.LifecycleStages.Steady` after `createWorkbook` before touching the
   formula facade. Consequence: a snapshot whose cells already reference custom
   functions evaluates before registration — V1-3-1 must set the initial
   calculation mode (facade `setInitialFormulaComputing`) or re-trigger recalc
   after registration.
2. **One Univer instance per sheet block is heavy** (~3 canvases, own DI
   container, seconds to `Steady`). Fine for the spike; V1-5-2 (multiple sheets
   per document) should measure and consider one shared Univer instance with
   multiple workbook units, or lazy-mount off-screen sheets.
3. **TipTap v3 StarterKit keeps a trailing paragraph** after the last block
   (`trailingNode`); DOM assertions/positioning must not assume the sheet can be
   the last child.
4. **NodeView `update()` must return true for attr-only changes** (same `sid`),
   or every snapshot flush remounts the grid.
5. **Univer renders several stacked canvases** per instance; for pointer-driven
   tests/features, the grid surface is `canvas[id^="univer-sheet-main-canvas"]`
   (the doc/editor canvases intercept naïve `canvas` selectors), and the top-left
   grid cell sits below ~20 px of headers.
6. **pnpm blocks `protobufjs`'s postinstall** (transitive via `@univerjs/rpc`);
   denied in `pnpm-workspace.yaml` (`allowBuilds: protobufjs: false`) — it is not
   needed and silencing it keeps `pnpm install` clean in CI.

## V1-0-3 · Facade custom functions + array spill — **confirmed, no fallback needed**

Mechanism chosen for V1-3-1: **`univerAPI.getFormula().registerFunction(name, fn, description)`**.

- **2D array returns spill natively.** A facade function returning
  `number[][]` (`OCTO_MATRIX(2)` in `F1`) fills `F1:G2`; no plugin-level
  `BaseFunction`/`ArrayValueObject` fallback is required. (Typing confirms the
  contract: `FormulaFunctionResultValueType = PrimitiveValueType | PrimitiveValueType[][]`.)
- **Rich/boxed values cannot be returned** — the result type is primitives only.
  For `TypedValue` display (quantities with units, `#UNIT!` etc.) V1-3-1 uses the
  proven fallback: functions return a **tagged string** (`OCTO_QTY(5,"kN")` →
  `"5 kN"` round-trips through cell storage/display), which the adapter
  intercepts and renders; the authoritative typed value lives in the graph, not
  in Univer. Univer's own recalc stays demoted to display exactly as planned.
- Argument values arrive as primitives (single cells) or 2D arrays (ranges);
  `BaseValueObject` shows up only for lambda-style args — the V1-3-1 adapter
  should coerce defensively.

## V1-0-1 · Scaffold — done

Exact pins (`@univerjs/presets` + `@univerjs/preset-sheets-core` 0.25.1;
`@tiptap/core`/`starter-kit`/`pm` 3.28.0), Vitest wired to `src/lib/engine/`,
Playwright (`e2e/`, prod-build web server, `workers: 1` — parallel workers
starve the heavy spike page's load), README ownership stubs in
`src/lib/{engine,adapters,persistence}/`.

## Spike route disposition

`/spike` and `/spike/univer` are **kept** (with their Playwright proofs as a
regression net for the pinned Univer version) until V1-3-1 lands the real
adapter; the NodeView/store patterns get promoted into `src/lib/adapters/univer/`
and the editor components then, and the routes are deleted in that PR. Nothing
is silently absorbed: the promotion list is exactly `univer-sheet-node.ts`
(NodeView glue), `UniverSheetView.svelte` (mount/dispose + lifecycle wait), and
`sheet-store.ts` (snapshot store → `sheetSnapshots` table).

## Go/no-go

- **Go** on Univer as the V1 calculation surface: embedding, focus isolation,
  snapshot round-trip, custom functions, and spill all work on the pinned version.
- **Go** on the V1-3-1 adapter design as written (single write path through
  `applyMutation`, tagged-value display interception).
- Geometry spikes deliberately absent — moved to V2-0 (PRD risk register
  re-tagged accordingly).
