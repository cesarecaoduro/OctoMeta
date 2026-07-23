---
module: Convex Maintenance
date: 2026-07-23
problem_type: database_issue
component: database
symptoms:
  - "Development product tables still contained 1,085 records before the persistence refactor"
  - "Convex root storage contained 21 orphaned files while the assets table contained zero rows"
  - "A broad cleanup risked deleting Better Auth, waitlist, or Resend data that had to be preserved"
root_cause: missing_workflow_step
resolution_type: tooling_addition
severity: high
related_components:
  - Better Auth
  - Resend
  - Local Persistence
tags: [convex, data-reset, root-storage, component-isolation, backup, pre-refactor]
---

# Troubleshooting: Safely reset Convex product data before a refactor

## Problem

The development deployment still held legacy product data before the local-first
persistence refactor. The reset needed to remove product documents and root file
storage while preserving Better Auth, waitlist, and Resend data. Browser
IndexedDB working copies were intentionally outside the reset.

## Environment

- Module: Convex Maintenance
- Stage: Pre-refactor cleanup
- Affected component: Convex root database and root file storage
- Development deployment: `amiable-leopard-466`
- Production deployment: `cheerful-hummingbird-383`
- Date: 2026-07-23

## Symptoms

- The development inventory contained 20 documents, 255 graph nodes, 101
  blocks, 591 undo-log entries, 98 chip bindings, and 20 workbook snapshots.
- The root `assets` table was empty, but the root `_storage` system table still
  contained 21 files. Deleting only tracked assets would have leaked these
  orphaned files.
- Production contained no product rows or root-storage objects, so attempting to
  weaken the development-only guard would have added risk without deleting data.

## What Didn't Work

**Relying on the `assets` ownership table alone:** The legacy files no longer had
matching ownership rows, so an asset-row traversal could not discover them.

**Treating all Convex data as one deletion scope:** Better Auth and Resend are
mounted components with their own tables and storage. A broad, component-agnostic
cleanup would not express the required preservation boundary.

**Running the reset against production for symmetry:** The verified production
inventory was already empty. The reset correctly refuses non-development
environments, so production was retained as a verified no-op.

## Solution

The reset uses an explicit allowlist for product tables, separately enumerates
root `_storage`, and never mounts or queries Better Auth or Resend components.
It acquires a product-write lock, deletes in bounded batches, and verifies the
zero state in the same mutation that releases the lock.

```ts
const RESET_STAGES = [
  'graphNodes',
  'blocks',
  'undoLog',
  'chipBindings',
  'workbookSnapshots',
  'documents'
] as const;

export const nextRootStorageBatch = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requireResetLock(ctx);
    const files = await ctx.db.system.query('_storage').take(RESET_BATCH);
    return files.map((file) => file._id);
  }
});
```

The completion step fails closed. If any allowlisted row or root-storage object
remains, the transaction rolls back and the maintenance lock stays active.

```ts
export const finishReset = internalMutation({
  args: {},
  handler: async (ctx) => {
    const lock = await requireResetLock(ctx);
    const after = await readResetCounts(ctx);
    if (Object.entries(after).some(([key, count]) => key !== 'truncated' && count !== 0)) {
      throw new Error('RESET_VERIFICATION_FAILED');
    }
    await ctx.db.delete(lock._id);
    return after;
  }
});
```

Operationally, the cleanup followed this order:

1. Export and checksum development and production backups.
2. Inventory root tables, component tables, and root storage without exposing
   record contents.
3. Deploy the reset action and run its dry-run mode.
4. Compare the dry-run counts with the backup inventory.
5. Execute the development-only reset.
6. Recount product, waitlist, Better Auth, Resend, and storage data independently.
7. Remove the temporary reset environment variables.

The final development verification returned zero for every product table,
`sheetSnapshots`, and root storage. Better Auth remained at 40 users, 40
accounts, 44 sessions, and one key; Resend remained at seven emails, 14 content
records, 14 delivery events, and one last-options record. Waitlist remained
present and empty. Production remained unchanged and empty of product data.

Verified backups are stored outside the repository at:

```text
/Users/cesarecaoduro/OctoMeta Backups/2026-07-23-pre-refactor/development.zip
/Users/cesarecaoduro/OctoMeta Backups/2026-07-23-pre-refactor/production.zip
```

## Why This Works

Convex component boundaries are the data-isolation boundary. A root query of
`ctx.db.system.query('_storage')` reaches root storage only; it does not enumerate
storage owned by mounted Better Auth or Resend components. Combining that
boundary with a table allowlist prevents newly discovered or preserved tables
from being deleted implicitly.

The atomic final mutation closes a race between verification and unlocking.
Because a thrown Convex mutation rolls back, failed verification cannot remove
the write lock. The reset therefore cannot report success or resume writes while
target data remains.

## Prevention

- Make a verified export before any destructive maintenance operation.
- Inventory root tables, mounted components, and system storage separately.
- Delete product tables through an explicit allowlist, never a catch-all table
  traversal.
- Treat orphaned root storage as a separate reset stage from asset ownership
  rows.
- Keep dry-run counts and compare them with the export before deletion.
- Verify preserved component counts after deletion and remove one-time reset
  credentials immediately.
- Keep production refusal in the reset authority check; a production no-op does
  not justify weakening the guard.

## Related Issues

No related issues documented yet.
