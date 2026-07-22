---
status: complete
priority: p1
issue_id: "002"
tags: [workspace, persistence, testing, refactor]
dependencies: []
---

# Establish the workspace controller seam

## Problem Statement

The document route currently coordinates graph mutations, editor projection, workbook projection, and cloud saving directly. This makes it difficult for later browser-first slices to replace cloud autosave incrementally or prove which persistence target handled an operation.

## Findings

- The graph session already provides a framework-neutral commit and settlement boundary.
- The current document saver is framework-neutral but is constructed and scheduled directly by the Svelte route.
- Editor and workbook adapters already expose narrow projection methods and stable domain IDs.
- Existing browser hooks expose document behavior but do not distinguish local persistence activity from Convex product activity.
- The workbook reactivity learning requires fresh Svelte presentation identities at explicit settle boundaries.

## Proposed Solutions

### Option 1: Extract a framework-neutral workspace controller

**Approach:** Introduce a small controller that owns mutation, undo, redo, projection flush/render callbacks, cloud-save scheduling, and observable persistence activity while reusing the existing session and saver.

**Pros:**
- Creates the intended highest-level test seam.
- Preserves behavior while isolating later persistence replacement.
- Avoids framework and backend dependencies in the controller.

**Cons:**
- Adds one intentional orchestration module.

**Effort:** Medium

**Risk:** Low

### Option 2: Instrument the existing route only

**Approach:** Add test-only counters around current callbacks without extracting ownership.

**Pros:**
- Small initial diff.

**Cons:**
- Does not create the architectural seam required by later tickets.
- Leaves persistence behavior coupled to Svelte.

**Effort:** Low

**Risk:** Medium

## Recommended Action

Implement Option 1. Keep graph and workbook domain objects framework-neutral, adapt the existing cloud saver behind a narrow port, expose persistence activity through a typed observer, and verify behavior through controller tests plus the existing browser workbench seam.

## Technical Details

No schema, cloud persistence semantics, UI behavior, or destructive data operation changes belong in this ticket.

## Resources

- GitHub issue #6
- Parent specification #5
- ADRs 0001, 0010, and 0011
- Workbook adapter reactivity solution under `docs/solutions/ui-bugs/`

## Acceptance Criteria

- [x] Current document and workbook workflows remain user-visible and green through the controller.
- [x] Browser tests can distinguish local persistence activity from Convex product reads and writes.
- [x] Domain objects remain framework-neutral and presentation refreshes stay at explicit settle boundaries.
- [x] No new persistence behavior or destructive data operation is introduced.
- [x] Type checks, unit tests, production build, and existing workbench browser tests pass.

## Work Log

### 2026-07-22 - Started implementation

**By:** Codex

**Actions:**
- Confirmed issue #6 is the only unblocked frontier ticket.
- Reviewed the current route, graph session, persistence facade, saver, and repository instructions.
- Selected the framework-neutral controller extraction over route-only instrumentation.

**Learnings:**
- The existing session and saver are reusable ports; the route is the coupling point.
- This ticket can stay behavior-preserving while making later local persistence observable.

### 2026-07-22 - Completed implementation

**By:** Codex

**Actions:**
- Added a framework-neutral workspace controller over graph commits, history, projection settlement, and the existing saver.
- Added metadata-only persistence activity observation with explicit local/cloud, read/write, operation, and lifecycle fields.
- Routed workbench mutations and save scheduling through the controller and exposed the activity log through the existing browser test seam.
- Added controller and persistence observer tests, plus a browser assertion that workbook editing produces an observable Convex document save.
- Verified `pnpm check`, 545 unit tests, `pnpm build`, `pnpm secret:scan`, and all four workbench browser tests.

**Learnings:**
- The existing saver can remain behind the controller until the local-first persistence slice replaces it.
- Activity metadata is sufficient to prove persistence routing without exposing document payloads to test instrumentation.
- Direct module imports keep the controller free of Svelte runtime dependencies.

## Notes

- Do not implement IndexedDB or change cloud-save timing in this ticket.
- Do not execute the Convex product-data reset.
