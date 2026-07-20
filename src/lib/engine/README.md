# `src/lib/engine/`

The typed dependency graph: values, dimensions, formula AST, structured
derivations, report blocks, one workbook manifest, mutation/history, and
incremental recalc. Pure TypeScript, **zero UI imports** and zero third-party
UI dependencies. Report, workbook, parameters, equations, and future
viewer/agent surfaces are projections of this layer.

- Workbook tabs have stable `SheetId`s; `CellRef` is `{ sheetId, a1 }`.
- `workbookOp` add/rename/remove is validated, projection-capturing, and
  undoable in the same history as cells and report blocks.
- Published aliases keep their `NodeId` on rename; one-hop target resolution
  powers parameters and bound equations.
- Canonical SI quantities retain authored display units, including the R1
  imperial vocabulary.
- Spec: SCHEMA.md §2–§6, §9, §11. Conventions: ARCHITECTURE.md "Engine conventions".
- Import from `index.ts`, never from module internals.
- Tests live next to the code as `*.test.ts` (Vitest); `engine.test.ts` enforces
  the zero-external-imports boundary.
