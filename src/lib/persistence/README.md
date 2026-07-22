# `src/lib/persistence/`

The only UI-facing path to Convex. Direct `convex`/`convex-svelte` imports are
restricted to this directory and `src/convex/` by boundary tests.

| Module | Responsibility |
|---|---|
| `client.ts` | Typed owned-document, trash, asset, and atomic-save facade |
| `svelte.ts` | Root setup/context for product and waitlist clients |
| `server.ts` | Server token bridge kept inside the Convex import boundary |
| `serialize.ts` | Graph/bundle serialization and fail-closed hydration |
| `canonical.ts` | Stable bytes, workbook hash, and complete bundle hash |
| `saver.ts` | Debounced non-overlapping saves, generations, CAS conflict state |
| `fixtures.ts` | Fixtures built through real mutations, including the steel demo |
| `index.ts` | Public persistence surface |

One save mutation owns graph rows, report blocks/order, chips, undo
history/cursor, workbook manifest, Univer snapshot, snapshot hash, bundle hash,
revision, and stats. Convex validates ownership, live state, maintenance lock,
limits, asset references, hashes, and expected revision before replacing the
bundle transactionally.

Load distinguishes live, trashed, missing, unauthorized, and integrity-error.
Only `live` hydrates an editable graph. Hash/revision mismatch sends no writes.

Assets are byte/type/owner validated and cleanup is durable. Reachability
includes retained undo. Trash/purge cascades every product row and asset.

Tests are split between node unit suites and `*.convex.test.ts` under
`convex-test`; the reproducibility suite re-evaluates fixtures and requires
stored hashes to match byte-for-byte.
