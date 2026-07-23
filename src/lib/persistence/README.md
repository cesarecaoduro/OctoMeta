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
| `local/repository.ts` | IndexedDB working copies, workspace summaries, cloud bases, local lifecycle, and generation CAS |
| `local/autosave.ts` | Non-overlapping 500 ms trailing / 2 s maximum local commit queue |
| `local/lease.ts` | Web Locks ownership and BroadcastChannel cooperative takeover for one working copy |
| `local/serialization.ts` | Local authored/history envelope, structurally distinct from cloud payloads |
| `local/storage-failure.ts` | Stable quota/transaction recovery guidance without false durability claims |
| `workbook-snapshot.ts` | Shared empty-workbook snapshot factory |
| `saver.ts` | Retained legacy cloud-save utility; not used by ordinary workbench editing |
| `fixtures.ts` | Fixtures built through real mutations, including the steel demo |
| `index.ts` | Public persistence surface |

One IndexedDB generation owns authored graph rows, report blocks/order, chips,
undo history/cursor, workbook manifest, and the Univer snapshot. The repository
updates the working copy and its document summary in the same transaction only
when `expectedGeneration` matches. Transaction aborts and stale generations
leave the previous durable copy unchanged.

Each downloaded main working copy records the cloud base revision, bundle hash,
and local generation. Subsequent local generations preserve that base, allowing
the unified index to distinguish a clean downloaded copy from local changes.
Branch summaries use independent workspace keys and are grouped by the pure
`$lib/workspace/document-index` model. Duplicate and discard are local-only
transactions; a duplicate resets undo history and cloud lineage.

The workspace controller captures accepted document/workbook/history changes,
coalesces rapid input for 500 ms, and forces a commit within 2 seconds of
continuous editing. Only a completed transaction may produce **Stored on this
device**. Ordinary create, edit, undo, redo, and reload paths make no Convex
product writes.

Local load is account-scoped and precedes cloud access. Cloud fallback still
distinguishes live, trashed, missing, unauthorized, and integrity-error; only a
healthy live result is copied into a first local generation.

Each account/document/workspace tuple has one exclusive browser edit lease.
Additional tabs load the local generation read-only. Cooperative takeover
flushes the current owner, waits for its transaction, then releases the Web
Lock; unsupported locking fails safely to read-only. The service worker caches
shipped assets and previously visited owner routes, while a remembered local
owner profile reopens only device-local content offline. Reconnect changes
availability state and never invokes cloud publication.

Assets are byte/type/owner validated and cleanup is durable. Reachability
includes retained undo. Trash/purge cascades every product row and asset.

Focused fake-IndexedDB tests cover namespace isolation, generation fencing,
transaction abort rollback, bounded autosave timing, and persistent failures.
Playwright reads the durable record directly and covers zero cloud writes,
read-only second tabs, cooperative takeover, unsupported-lock fallback, quota
recovery, and offline reload/reconnect behavior.
