# `src/lib/adapters/`

Bridges between third-party surfaces and the engine. `src/lib/adapters/univer/`
is the **only** place in the codebase allowed to import `@univerjs/*`
(IMPLEMENTATION_PLAN.md §11 rule 2). Adapters translate UI events into
`applyMutation` calls and graph notifications into display updates; they never
hold authoritative state.

## `univer/` (V1-3-1, live)

Import from `./univer` (its `index.ts`), never module internals.

| Module | Role |
|---|---|
| `univer-api.ts` | Every Univer API touched, behind thin named wrappers (pre-1.0 churn isolation; the only runtime `@univerjs` imports) |
| `cell-text.ts` | Pure mapping: cell payload classification, A1 addressing, `TypedValue` display, name-ref rewrites, defined-name bookkeeping |
| `graph-sync.ts` | Graph-facing half: `GraphSession` (commit + settle fan-out), cell edit routing, publish/rename/unpublish — all through `applyMutation` |
| `adapter.ts` | `attachSheetAdapter`: binds one Univer instance to one sheet block; UI-framework-thin so V1-5-2 can host it in a TipTap NodeView |
| `sheet-store.ts` | In-memory workbook snapshot store (stand-in for the `sheetSnapshots` table until V1-4-1) |

Key invariants: no write path around `applyMutation` (proven by the undo-log
replay test in `graph-sync.test.ts`); Univer recalc is demoted to display (no
formula persists in the Univer cell model, the graph owns the AST); cell↔node
binding lives in the graph's cellRef index only.

- Owner task: V1-3-1 (done). Canvas hosting: V1-5-2. Units in cells: V2-U.
