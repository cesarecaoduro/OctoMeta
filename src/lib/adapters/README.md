# `src/lib/adapters/`

Bridges between third-party surfaces and the engine. `src/lib/adapters/univer/`
is the **only** place in the codebase allowed to import `@univerjs/*`
(IMPLEMENTATION_PLAN.md §11 rule 2). Adapters translate UI events into
`applyMutation` calls and graph notifications into display updates; they never
hold authoritative state.

- Owner task: V1-3-1 (Univer adapter).
- Spike code under `src/routes/spike/` is exempt from the import rule until
  promoted or deleted (V1-0-4).
