---
module: Workbook Adapter
date: 2026-07-20
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "Renaming Sheet 4 to Notes succeeded in DocumentGraph but the tab continued to render Sheet 4"
  - "Playwright could not find getByRole('tab', { name: 'Notes' }) after clicking Rename"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [svelte-runes, workbook, univer, reactivity, playwright]
---

# Troubleshooting: Workbook tab rename commits but the label stays stale

## Problem

The R1.6 workbook drawer committed a valid `workbookOp rename`, and the adapter
could rename the tab directly, but the custom Svelte tab strip continued to
show the old name. This blocked the release-level workbook lifecycle scenario.

## Environment

- Module: Workbook Adapter
- Stage: R1.6 implementation
- Affected component: `src/routes/app/[docId]/WorkbookDrawer.svelte`
- Runtime: Svelte 5 runes, Univer 0.25.1, Playwright 1.61.1
- OS: macOS development workspace
- Date: 2026-07-20

## Symptoms

- `adapter.renameSheet(sheetId, "Notes")` returned `{ ok: true }`.
- `window.__canvas.sheets()` showed the graph name had changed.
- The visible tab and accessibility tree still contained `Sheet 4`.
- Playwright failed with:

  ```text
  Locator: getByRole('tab', { name: 'Notes' })
  Error: element(s) not found
  ```

## What didn't work

**Renaming the local click handler and submitting through a form**

- The event did fire and the graph command succeeded.
- It did not fix the stale presentation because the underlying reactive
  dependency was still the same plain array/object graph.

**Incrementing a revision rune that was read only as `void revision` in a
derived callback**

- This was too implicit and coupled UI invalidation to a side-channel.
- The manifest's array identity stayed stable and a sheet's `name` property was
  mutated in place by the engine, so the rendered view could retain its cached
  objects.

## Solution

Maintain an explicit cloned presentation view and refresh it at the graph
settle boundary and after workbook commands.

```ts
// Before: a derived view over mutable, non-rune engine objects.
const sheets = $derived.by(() => {
  void revision;
  return [...session.doc.workbook.sheets].sort((a, b) => a.position - b.position);
});
```

```ts
// After: the UI receives fresh identities whenever authoritative state settles.
let sheets = $state<SheetMeta[]>([]);

function refreshSheets(): void {
  sheets = session.doc.workbook.sheets
    .map((sheet) => ({ ...sheet }))
    .sort((a, b) => a.position - b.position);
}

session.onSettle(() => {
  refreshSheets();
});

function commitTabRename(): void {
  const result = adapter.renameSheet(activeSheetId, renameText.trim());
  if (!result.ok) return;
  refreshSheets();
  ondirty();
}
```

The tab handlers retain stable IDs. Only the presentation objects are cloned;
the engine remains authoritative and all writes still go through
`workbookOp`.

## Why this works

`DocumentGraph` is framework-independent TypeScript and intentionally does not
use Svelte proxies. Its workbook mutation changes an existing `SheetMeta`
object. Svelte can reliably invalidate `sheets` when the state variable itself
is assigned a new array containing new sheet objects.

Refreshing on `session.onSettle` also covers undo and redo, not just controls
owned by the drawer. This keeps one mutation path and avoids making the engine
UI-aware.

## Prevention

- Treat engine objects as non-reactive across the Svelte boundary.
- Project mutable domain state into fresh view objects at one explicit settle
  boundary.
- Key workbook UI by stable `SheetId`, never by name or array position.
- Include add/rename/delete plus undo/redo in a real browser scenario and
  assert the accessibility-tree labels, not just adapter return values.
- Keep direct adapter hooks for diagnosis, but do not use them as the product
  test path.

## Related issues

- See also: [Published values need stable identity and explicit lifecycle](../best-practices/published-values-need-stable-identity-publication-lifecycle-20260723.md)
