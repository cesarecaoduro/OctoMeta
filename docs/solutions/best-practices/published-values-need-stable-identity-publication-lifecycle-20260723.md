---
module: Published Values
date: "2026-07-23"
problem_type: best_practice
component: service_object
symptoms:
  - Renaming a published semantic name can break Document and Equation references when consumers bind to display names or cell addresses.
  - Unpublishing can silently delete or freeze dependent content when uses are not disclosed before removal.
  - Published units can disappear or duplicate when each projection formats values independently.
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [published-values, stable-identity, broken-references, workbook, projections]
---

# Published values need a stable identity and explicit lifecycle

## Problem

A Published value has editable presentation data—semantic name, label, unit,
description, and source location—but Document and Equation consumers must survive
those edits. Removal also needs to leave enough identity for repair instead of
silently deleting consumers or converting their last value to ordinary text.

## Environment

- Module: Published Values
- Affected components: engine graph, Univer adapter, Document and Equation references
- Stage: post-implementation
- Date: 2026-07-23

## Symptoms

- Renaming a publication breaks consumers that bind to its name or cell address.
- Unpublishing gives the owner no inventory of affected content.
- Removed consumers disappear or become frozen text rather than explicit broken references.
- A published scalar shows `25` in prose or equations even though its alias declares `m`.

## What didn't work

**Treating the Workbook defined name as authoritative:** restored Univer snapshots
may not contain the projection even though the graph has the publication. A command
can then report the name as missing while the domain state remains valid.

**Binding consumers to the semantic name:** names are author-editable presentation
data, so they cannot also be durable identity.

## Solution

Keep one stable `NodeId` on the graph's published alias. Document chips and Equation
bindings store that identity; the Workbook defined name mirrors it as a projection.
Rename the alias in place, disclose consumers through a public query, and remove only
the alias after explicit confirmation. Consumer bindings retain the missing `NodeId`
and render as broken until rebound.

```ts
// Fragile: presentation text doubles as identity.
type Reference = { publishedName: string };

// Durable: editable metadata is separate from stable identity.
type Reference = { nodeId: NodeId };
type PublishedAlias = {
	id: NodeId;
	name: string;
	publication?: { label?: string; unit?: string; description?: string };
};
```

All authoritative writes still pass through graph mutations. Projection commands are
best-effort mirrors:

```ts
const renamed = renamePublishedName(session, oldName, newName);
if (!renamed.ok) return false;
renameSheetDefinedName(api, oldName, newName);
return true;
```

Use one published-value formatter for every visible projection. The visual formula
substitutes the current value and unit, while equation source keeps a readable semantic
token and the stable ID stays out of band:

```ts
formatPublishedValue(target.value, alias.publication?.unit); // "25 m"
equationSourceModel(reference); // "\\value{bridge.span}"
```

Quantity values pass the published unit through typed conversion; scalar values treat
it as presentation metadata. Never concatenate a unit after a formatter that may have
already emitted one.

## Why this works

Stable identity follows ADR 0004: renaming changes presentation without rebinding
consumers. Use disclosure is derived from graph dependents, Document chip bindings,
and Equation block payloads. Removing the alias makes those durable bindings
explicitly unresolved, preserving the information needed for a later repair action.

## Prevention

- Bind reusable content to stable IDs, never names or cell addresses.
- Keep Workbook defined names as projections of the graph.
- Add metadata through an undoable graph mutation and serialize it in local and cloud formats.
- Test rename and unpublish through public publication/reference APIs.
- Test scalar and quantity units in Document chips, visual equations, and pickers.
- Require a use inventory and explicit confirmation before unpublishing.

## Related issues

- See also: [Tab rename stays stale in the Workbook adapter](../ui-bugs/tab-rename-stays-stale-workbook-adapter-20260720.md)
