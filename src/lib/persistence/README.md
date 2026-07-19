# `src/lib/persistence/`

The only place UI code goes through to load/save documents. Wraps Convex
(`convex` may be imported only here and in `src/convex/`,
IMPLEMENTATION_PLAN.md §11 rule 2) behind a thin interface so the engine and
editor never know the storage backend.

- Owner task: V1-4-1 (Convex persistence + reproducibility CI).
