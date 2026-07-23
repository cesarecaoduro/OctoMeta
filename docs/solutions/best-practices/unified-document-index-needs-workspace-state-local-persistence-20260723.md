---
module: Local Persistence
date: 2026-07-23
problem_type: best_practice
component: database
symptoms:
  - "The document list could not distinguish local-only, downloaded cloud-backed, and cloud-only documents"
  - "One summary per document could not represent device-local branches independently"
  - "Downloaded working copies did not retain the cloud base needed to report local changes"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [indexeddb, local-first, document-index, cloud-metadata, branches, lifecycle]
---

# Troubleshooting: A unified document index needs workspace state

## Problem

The document list merged a cloud row and an optional local summary with one
boolean. That was insufficient to explain whether content was available on the
device, which cloud revision a working copy came from, whether local changes
existed, or which branch workspaces belonged beneath the parent document.

## Environment

- Module: Local Persistence
- Framework: SvelteKit 2 with Svelte 5
- IndexedDB adapter: `idb` 8.0.3
- Affected components: local repository, document index model, document routes
- Stage: Issue #8 unified document index slice
- Date: 2026-07-23

## Symptoms

- A local-only document showed only a generic local badge without explicitly
  stating that no cloud version existed.
- A downloaded cloud document could not report its base revision or whether a
  later local generation had changed.
- A cloud list row did not state whether it was metadata-only or had working
  content on the device.
- The summary key omitted `workspaceId`, so a future branch summary would
  overwrite the main summary.

## What Didn't Work

**Merge cloud rows with one `hasLocalWorkingCopy` boolean:**

- **Why it failed:** presence alone cannot encode the cloud base, dirty state,
  or multiple local workspaces.

**Keep one summary key per account and document:**

- **Why it failed:** main and branch working copies share a document identity
  but require independently addressable local generations and labels.

**Implement save or export through the legacy cloud facade:**

- **Why it failed:** immutable version saving and portable archive validation
  belong to later delivery slices. Calling legacy document mutations from the
  index would reintroduce unintended cloud persistence and incorrect identity
  semantics.

## Solution

Store a lightweight summary for every account/document/workspace tuple and
retain the immutable cloud base on the local working-copy record:

```ts
interface LocalWorkspaceSummary {
  accountId: string;
  documentId: string;
  workspaceId: string;
  workspace: { kind: 'main' } | { kind: 'branch'; name: string };
  generation: number;
  cloudBase?: {
    version: number;
    bundleHash: string;
    generation: number;
  };
}
```

When cloud content is first downloaded, commit the cloud revision and bundle
hash with generation 1. Preserve that base on subsequent commits. The index can
then derive local changes without inspecting authored payloads:

```ts
const hasChanges =
  summary.cloudBase
    ? summary.generation > summary.cloudBase.generation
    : null;
```

Migrated issue #7 summaries have no trustworthy cloud-base metadata. Render
their base and change state as unavailable instead of substituting the current
cloud revision or claiming that local changes do or do not exist.

Merge cloud metadata and local workspace summaries in a framework-neutral
`buildDocumentIndex` function. It emits exactly three parent states:

- `local-only`: working content exists locally and no cloud metadata exists;
- `cloud-backed`: cloud metadata and a local main working copy both exist;
- `cloud-only`: authorized cloud metadata exists without a local main copy.

Group every non-main workspace beneath its parent and sort branches by name.
Keep rename, duplicate, and discard as IndexedDB transactions. Duplicate resets
undo history and cloud lineage; discard deletes every local workspace for the
document. Save and export remain explicit, non-mutating entry points until
their dedicated workflows land.

## Why This Works

The storage model now represents the product concepts directly. A document is
the parent identity, while main and branch working copies are separate local
workspaces. Cloud authorization metadata remains independent from downloaded
content. The base generation makes dirty state a monotonic comparison instead
of a fragile UI guess.

Keeping the merge in a pure module gives unit tests a stable public seam and
keeps Svelte responsible only for rendering and invoking lifecycle actions.
Because local lifecycle methods never receive the Convex facade, tests can
prove that listing, opening, renaming, duplicating, and discarding local work
produce no cloud product write.

## Prevention

- Key local summaries by account, document, and workspace whenever multiple
  working copies can belong to one document.
- Record immutable base metadata at the download boundary and preserve it
  until an explicit successful cloud-version operation replaces it.
- Derive index presentation in a pure model rather than scattering merge rules
  through component conditionals.
- Keep deferred save/export entry points visibly non-mutating; never route them
  through a legacy persistence path for convenience.
- Test repository lifecycle behavior, index state derivation, and browser-level
  cloud-write activity independently.

## Related Issues

- [Cloud autosave blocks trustworthy local recovery](cloud-autosave-blocks-local-recovery-localpersistence-20260723.md)
- [ADR 0001: Create documents locally before their first cloud save](../../adr/0001-local-first-document-creation.md)
- [ADR 0014: Support offline owner workspaces without automatic cloud sync](../../adr/0014-offline-owner-workspaces-without-cloud-sync.md)
- [Local-first document workspace specification](../../specs/2026-07-22-local-first-document-workspace.md)
