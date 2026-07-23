---
module: Local Persistence
date: 2026-07-23
problem_type: runtime_error
component: database
symptoms:
  - "Cooperative takeover was denied even though the active tab still held the edit lease"
  - "The active tab remained at Saving locally instead of committing its pending generation"
  - "Failed to execute 'structuredClone' on 'Window': #<Object> could not be cloned."
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags: [svelte-5, structured-clone, indexeddb, edit-lease, takeover, local-first]
---

# Troubleshooting: A Svelte proxy can break a cooperative takeover flush

## Problem

The second-tab safety flow correctly asked the active editor to flush before
releasing its Web Lock, but the flush could fail before reaching IndexedDB. A
workbook snapshot held in Svelte 5 `$state` was still a reactive proxy, which
the autosave boundary attempted to clone as if it were plain authored data.

## Environment

- Module: Local Persistence
- Framework: SvelteKit 2 with Svelte 5
- IndexedDB adapter: `idb` 8.0.3
- Affected components: document workbench, local autosave, edit-lease handoff
- Stage: Issue #9 cross-tab and offline durability slice
- Date: 2026-07-23

## Symptoms

- The second tab opened read-only as intended.
- Selecting **Take over editing** left the requester read-only.
- The active tab displayed **Saving locally…** and did not release ownership.
- The requester received:
  `Failed to execute 'structuredClone' on 'Window': #<Object> could not be cloned.`

## What Didn't Work

**Treat the failure as a lease-release problem:**

- **Why it failed:** Web Locks and BroadcastChannel were behaving correctly.
  The active owner never reached the release step because its required
  durability flush rejected first.

**Retry the same capture unchanged:**

- **Why it failed:** every retry received the same Svelte proxy and failed
  before the IndexedDB transaction could begin.

## Solution

Convert reactive state to a plain snapshot before it enters the autosave
capture. Also keep capture and commit inside the autosave error boundary so
serialization failures produce the same persistent, non-durable recovery state
as quota and transaction failures.

```ts
// Before: may return a Svelte proxy while the workbook adapter is not mounted.
workbookSnapshot: () =>
  workbookAdapter?.saveSnapshot() ?? restoredWorkbookSnapshot;

// After: the persistence boundary receives cloneable authored data.
workbookSnapshot: () =>
  workbookAdapter?.saveSnapshot() ?? $state.snapshot(restoredWorkbookSnapshot);
```

```ts
// Capture belongs inside the same failure boundary as the IndexedDB commit.
try {
  const captured = structuredClone(options.capture());
  generation = await options.commit(generation, captured);
  options.onError?.(null);
} catch (error) {
  options.onError?.(error);
  dirty = true;
  setState('error');
  throw error;
}
```

The cooperative takeover then follows a strict order:

1. flush the active controller;
2. wait for the IndexedDB transaction to complete;
3. release the Web Lock;
4. let the requester acquire ownership and reload the committed generation.

## Why This Works

Svelte proxies describe reactive application state, not portable authored
content. `$state.snapshot` removes that framework-specific wrapper before
`structuredClone` freezes the generation. The subsequent IndexedDB write can
therefore complete, and the active tab releases its lease only after the
durability promise resolves.

Keeping capture inside the failure boundary also prevents a serialization
error from leaving the UI stuck at **Saving locally…**. Any capture, quota, or
transaction failure now retains the dirty generation and shows persistent
retry guidance until a later transaction succeeds.

## Prevention

- Convert Svelte `$state` values to plain snapshots at persistence boundaries.
- Treat capture/serialization and IndexedDB commit as one durability outcome.
- Never release an edit lease until the active generation has committed.
- Keep a two-tab browser test that types in the owner, requests takeover
  immediately, and verifies the requester reloads the flushed content.
- Keep browser tests for quota failure and offline reload so the durable label
  cannot drift from transaction outcomes.

## Related Issues

- [Cloud autosave blocks trustworthy local recovery](../best-practices/cloud-autosave-blocks-local-recovery-localpersistence-20260723.md)
- [ADR 0013: Allow one editing tab per working copy](../../adr/0013-one-editing-tab-per-working-copy.md)
- [ADR 0014: Support offline owner workspaces without automatic cloud sync](../../adr/0014-offline-owner-workspaces-without-cloud-sync.md)
- [Local-first document workspace specification](../../specs/2026-07-22-local-first-document-workspace.md)
