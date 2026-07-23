---
module: Local persistence
date: 2026-07-23
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "A read-only tab displayed stale document and workbook content."
  - "Refreshing the peer with location.reload() repeatedly showed “Authenticating workspace…”."
root_cause: logic_error
resolution_type: code_fix
severity: medium
related_components: [Authentication, Document workbench, IndexedDB]
tags: [broadcast-channel, cross-tab, indexeddb, readonly, svelte, workspace-lease]
---

# Troubleshooting: Read-only live refresh reauthenticates the workspace

## Problem

A read-only document tab needed to follow the editing tab's durable local
generations. Reloading the route on each stored generation updated the content,
but also restarted the application layout and authentication flow after every
autosave.

## Environment

- Module: Local persistence
- Stage: Post-implementation of GitHub issue #9
- OS: macOS
- Affected components: Workspace lease, Svelte document route, IndexedDB repository
- Date: 2026-07-23

## Symptoms

- The editing tab contained `Ciao` while the read-only tab remained at `C`.
- A route-reload implementation made the read-only tab repeatedly display
  `Authenticating workspace…`.
- A full reload also discarded transient view state such as the current
  JavaScript runtime and workbook projection.

## What Didn't Work

**Reload the document route when BroadcastChannel reports a stored generation**

- **Why it failed:** `location.reload()` reconstructed the entire SvelteKit
  route hierarchy. The application layout reran session authentication even
  though only the browser-local working-copy projection had changed.

## Solution

The editing lease now broadcasts a `generation-stored` message only after its
IndexedDB commit completes. A read-only peer loads that generation from the
account-scoped repository, hydrates a new graph, and replaces the document,
controller, parameters, and workbook projections in place.

```ts
// Before: content updated, but the whole authenticated application restarted.
location.reload();

// After: read only the durable generation and replace workspace projections.
const local = await localRepository.load(accountId, documentId, 'main');
if (leaseState === 'readonly' && local && local.generation > loadedGeneration) {
	installWorkingCopy(accountId, local.content, local.generation);
	projectionRevision += 1;
}
```

The refresh rechecks `leaseState` after the asynchronous IndexedDB read. This
prevents a refresh that began in read-only mode from replacing unsaved edits if
the tab acquires ownership while the read is in flight.

The browser regression test verifies prose and workbook updates, continued
read-only status, durable owner saves, and preservation of a runtime marker
that would disappear during navigation.

```bash
pnpm exec playwright test e2e/workbench.spec.ts \
  --project=desktop \
  --grep "active tab keeps storing"
```

## Why This Works

BroadcastChannel carries only an invalidation signal—the durable generation
number—not authored content. IndexedDB remains the source of truth, so peers
never render unsaved keystrokes. Replacing only the working-copy projections
keeps authentication and lease coordination alive while still rebuilding
graph-bound editor and workbook adapters against the new snapshot.

## Prevention

- Treat cross-tab notifications as durable-cache invalidations, not as route
  navigation commands.
- Broadcast only after the local transaction resolves.
- Recheck ownership after every asynchronous read before replacing UI state.
- Test that a read-only peer updates prose and workbook data without a new
  browser navigation.

## Related Issues

- See also:
  [Svelte proxy breaks takeover flush local persistence](../runtime-errors/svelte-proxy-breaks-takeover-flush-local-persistence-20260723.md)
