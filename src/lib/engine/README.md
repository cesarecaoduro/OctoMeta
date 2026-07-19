# `src/lib/engine/`

The typed dependency graph: values, dimensions, formula AST, mutation API, recalc.
Pure TypeScript, **zero UI imports** and zero third-party UI deps. Every block type
(sheet, chip, viewer, agent) is a projection of this layer.

- Owner tasks: V1-1-x (types/units/formulas — done), V1-2-x (mutations/recalc — next).
- Spec: SCHEMA.md §2–§6, §9, §11. Conventions: ARCHITECTURE.md "Engine conventions".
- Import from `index.ts`, never from module internals.
- Tests live next to the code as `*.test.ts` (Vitest); `engine.test.ts` enforces
  the zero-external-imports boundary.
