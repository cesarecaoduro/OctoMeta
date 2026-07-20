# `src/lib/persistence/`

The only place UI code goes through to load/save documents — `convex` and
`convex-svelte` may be imported only here and in `src/convex/`
(IMPLEMENTATION_PLAN.md §11 rule 2, enforced by `boundary.test.ts` in CI).

| Module | What it does |
|---|---|
| `client.ts` | `createPersistence(client)` — the typed facade (document CRUD, full save/load, sheet-snapshot and chip upserts) over the Convex functions in `src/convex/`. Framework-free. |
| `svelte.ts` | Svelte-context entry points: `setupPersistence(url)` (root layout), `usePersistence()`, and the marketing `useWaitlist()`. |
| `serialize.ts` | `serializeGraph(graph)` → save payload · `hydrateGraph(rows)` → rebuilt `DocumentGraph` + reproducibility verdict (re-derives every `contentHash` from inputs, SCHEMA.md §5). App and CI share this code path. |
| `codec.ts` | Convex value codec: renames the non-ASCII `Θ` dimension key to `THETA` and back (Convex requires ASCII object keys), drops `undefined` fields. |
| `saver.ts` | `createDocumentSaver(...)` — debounced full save on recalc settle; `scheduleSave()` / `flush()` / `dispose()` plus a `SaveState` for the save indicator (V1-5-1). |
| `fixtures.ts` | Fixture documents built through the real `commit` path — the reproducibility CI gate runs on them; V1-5-6 reuses them. |

File storage (V1-5-1, image blocks): `Persistence.uploadFile(blob)` runs the
Convex upload-URL flow (`files.generateUploadUrl` + POST) and returns the
`storageId` stored in `Block.image`; `Persistence.fileUrl(storageId)` resolves
a serving URL. Files are deleted with their document (`documents.remove`).

Tests: `*.test.ts` run in node; `*.convex.test.ts` run against `convex-test`
in the `edge-runtime` vitest project (see `vite.config.ts`). The
reproducibility gate (`reproducibility.convex.test.ts`) is cumulative CI
(IMPLEMENTATION_PLAN.md §11 rule 6): save each fixture, load it back,
re-evaluate everything from inputs, and require every stored `contentHash` to
reproduce byte-for-byte.

- Owner task: V1-4-1 (Convex persistence + reproducibility CI).
