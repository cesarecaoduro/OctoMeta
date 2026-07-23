# `src/lib/persistence/`

The browser-local working-copy boundary and the only UI-facing path to Convex.
Direct `convex`/`convex-svelte` imports are restricted to this directory and
`src/convex/` by boundary tests.

| Module | Responsibility |
|---|---|
| `client.ts` | Typed owned-document, trash, asset, and atomic-save facade |
| `svelte.ts` | Root setup/context for product and waitlist clients |
| `server.ts` | Server token bridge kept inside the Convex import boundary |
| `serialize.ts` | Graph/bundle serialization and fail-closed hydration |
| `canonical.ts` | Stable bytes, workbook hash, and complete bundle hash |
| `local/repository.ts` | Account-scoped IndexedDB working copies, summaries, and generation CAS |
| `local/autosave.ts` | Non-overlapping 500 ms trailing / 2 s maximum local commit queue |
| `local/serialization.ts` | Local authored/history envelope, structurally distinct from cloud payloads |
| `workbook-snapshot.ts` | Shared empty-workbook snapshot factory |
| `saver.ts` | Retained legacy cloud-save utility; not used by ordinary workbench editing |
| `fixtures.ts` | Fixtures built through real mutations, including the steel demo |
| `index.ts` | Public persistence surface |

One IndexedDB generation owns authored graph rows, report blocks/order, chips,
undo history/cursor, workbook manifest, and the Univer snapshot. The repository
updates the working copy and its document summary in the same transaction only
when `expectedGeneration` matches. Transaction aborts and stale generations
leave the previous durable copy unchanged.

The workspace controller captures accepted document/workbook/history changes,
coalesces rapid input for 500 ms, and forces a commit within 2 seconds of
continuous editing. Only a completed transaction may produce **Stored on this
device**. Ordinary create, edit, undo, redo, and reload paths make no Convex
product writes.

Local load is account-scoped and precedes cloud access. Cloud fallback still
distinguishes live, trashed, missing, unauthorized, and integrity-error; only a
healthy live result is copied into a first local generation.

Assets are byte/type/owner validated and cleanup is durable. Reachability
includes retained undo. Trash/purge cascades every product row and asset.

Focused fake-IndexedDB tests cover namespace isolation, generation fencing,
transaction abort rollback, bounded autosave timing, and persistent failures.
Playwright reads the durable record directly and proves zero Convex product
writes across local create, document/workbook edits, undo, redo, and reload.
