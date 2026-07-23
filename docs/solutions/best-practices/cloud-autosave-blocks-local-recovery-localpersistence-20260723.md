---
module: Local Persistence
date: 2026-07-23
problem_type: best_practice
component: database
symptoms:
  - "Creating or editing a document produced Convex product writes instead of a browser-local working copy"
  - "Reload recovery and the undo cursor depended on cloud persistence rather than the latest committed device state"
  - "A trailing-only save delay could postpone durability indefinitely during continuous editing"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [indexeddb, local-first, autosave, generation-fencing, undo-history]
---

# Troubleshooting: Cloud autosave blocks trustworthy local recovery

## Problem

The workbench used one debounced Convex save for ordinary document, workbook,
undo, and redo changes. That made local-only document creation impossible and
could not truthfully claim that the latest working copy was stored on the
device.

## Environment

- Module: Local Persistence
- Framework: SvelteKit 2 with Svelte 5
- IndexedDB adapter: `idb` 8.0.3
- Affected components: workspace controller, document index, document route
- Stage: Issue #7 local persistence slice
- Date: 2026-07-23

## Symptoms

- Creating a document called `documents.create` and immediately created a
  Convex product record.
- Accepted document and workbook edits called `documents.save` after a 500 ms
  quiet period.
- Reload recovery depended on the last cloud save rather than an account-scoped
  IndexedDB generation.
- A timer state could say “saved” without an IndexedDB transaction outcome.

## What Didn't Work

**Keep the existing cloud `DocumentSaver` and add local instrumentation:**

- **Why it failed:** observing the cloud path did not change its durability
  semantics and could never prove zero Convex product writes.

**Use only a resettable 500 ms trailing timer:**

- **Why it failed:** continuous editing continually reset the timer, so the
  working copy had no bounded maximum dirty interval.

**Persist authored content and undo state separately:**

- **Why it failed:** a crash between writes could restore content with the wrong
  undo cursor. Both belong to one working-copy generation.

## Solution

Store each account/document/workspace tuple as one IndexedDB record. Commit the
complete authored graph, workbook snapshot, and unified undo state with an
expected-generation compare-and-swap, and update the document summary in the
same transaction.

```ts
const transaction = database.transaction(
  ['workspaces', 'documentSummaries'],
  'readwrite'
);
const current = await transaction.objectStore('workspaces').get(key);
const actualGeneration = current?.generation ?? 0;

if (actualGeneration !== expectedGeneration) {
  transaction.abort();
  throw new GenerationConflictError(expectedGeneration, actualGeneration);
}

await Promise.all([
  transaction.objectStore('workspaces').put(nextWorkingCopy, key),
  transaction.objectStore('documentSummaries').put(nextSummary, summaryKey)
]);
await transaction.done;
```

Use two autosave timers: reset the 500 ms trailing timer on every accepted
change, but create the 2 second maximum timer only when the working copy first
becomes dirty. Capture one immutable generation before the asynchronous write;
if changes arrive during that transaction, commit a fenced follow-up generation
immediately.

```ts
trailingTimer = setTimeout(commitNow, 500);
maximumTimer ??= setTimeout(commitNow, 2_000);
```

Load IndexedDB before cloud state. A healthy cloud document without a local
copy is read once and committed as generation 1 before editing begins. New
documents generate an application ID and create generation 1 directly in
IndexedDB, with no Convex mutation.

Drive the durability label only from the local transaction lifecycle:

- pending or in flight: **Saving locally…**
- committed: **Stored on this device**
- rejected or aborted: **Device save failed**, retained until a later
  transaction succeeds

## Why This Works

The IndexedDB transaction is the atomic durability boundary. Content and undo
state cannot advance independently, and the summary cannot advertise a
generation the working-copy store did not commit. Expected-generation CAS
turns an otherwise silent stale overwrite into an explicit failure. The
non-resetting maximum timer bounds data-at-risk during continuous input without
giving up the efficient trailing coalescence window.

Because creation, edit, undo, redo, workbook changes, and reload all use the
same local port, the browser activity seam can prove that those operations
produce no Convex product writes.

## Prevention

- Keep cloud publication out of the ordinary workspace controller port.
- Treat content plus unified undo state as one local generation.
- Never display a durable status before `transaction.done` resolves.
- Preserve the prior generation after transaction abort or CAS conflict.
- Test both the 500 ms quiet period and the 2 second continuous-edit ceiling
  with fake timers.
- Keep a real-browser test that reads IndexedDB directly, reloads the workbench,
  checks the restored undo cursor, and asserts zero cloud write activity.

## Related Issues

- [A unified document index needs workspace state](unified-document-index-needs-workspace-state-local-persistence-20260723.md)
- [ADR 0001: Create documents locally before their first cloud save](../../adr/0001-local-first-document-creation.md)
- [ADR 0011: Keep one unified undo history per working copy](../../adr/0011-one-local-history-per-working-copy.md)
- [Local-first document workspace specification](../../specs/2026-07-22-local-first-document-workspace.md)

No related solution entry was documented previously.
