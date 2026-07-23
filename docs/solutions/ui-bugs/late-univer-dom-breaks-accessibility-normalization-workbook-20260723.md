---
module: Workbook Adapter
date: 2026-07-23
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "Univer reintroduced positive tabindex values after its lifecycle reported Steady"
  - "Multiple workbook notification regions exposed duplicate accessible names"
  - "Axe results varied depending on which post-mount frame the audit observed"
root_cause: async_timing
resolution_type: code_fix
severity: high
tags: [accessibility, univer, mutation-observer, tabindex, axe, playwright]
---

# Troubleshooting: Late Univer DOM breaks accessibility normalization

## Problem

Univer creates and updates some canvas controls and notification regions for several
animation frames after its API reports a steady lifecycle state. A one-time cleanup
could therefore pass locally and still leave positive tab order or duplicate landmark
names by the time an accessibility audit ran.

## Environment

- Module: Workbook Adapter
- Stage: Issue #26 adaptive-interface implementation
- Affected component: `src/lib/adapters/univer/univer-api.ts`
- Runtime: Svelte 5, Univer 0.25.1, Playwright 1.61.1
- Date: 2026-07-23

## Symptoms

- Elements matching `[data-u-comp][tabindex="1"]` appeared after workbook mount.
- Notification regions shared the same `aria-label`.
- Axe results depended on post-mount timing rather than stable product state.

## What didn't work

**A one-time normalization after Univer reached `Steady`**

- `Steady` did not mean that every asynchronous DOM insertion had finished.
- Controls inserted in later animation frames bypassed the cleanup.

**A mutation observer without a post-mount sweep**

- It covered ordinary child and attribute mutations, but third-party lifecycle timing
  still left a narrow race around observer setup and queued rendering work.

## Solution

Keep the third-party correction in one documented adapter function, run it immediately,
observe relevant DOM changes, and repeat it for a bounded number of animation frames
after mount.

```ts
const observer = new MutationObserver(() => normalizeUniverAccessibility());
observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['tabindex', 'aria-label']
});

normalizeUniverAccessibility();

let settleFrames = 0;
let settleFrame = 0;
const normalizeAfterMount = (): void => {
  normalizeUniverAccessibility();
  settleFrames += 1;
  if (settleFrames < 12) {
    settleFrame = requestAnimationFrame(normalizeAfterMount);
  }
};
settleFrame = requestAnimationFrame(normalizeAfterMount);
```

Disposal must cancel the frame and disconnect the observer before disposing Univer.
The browser test also asserts that no positive Univer `tabindex` remains before
running axe.

## Why this works

The immediate pass covers existing DOM, the observer covers subsequent insertions and
attribute changes, and the bounded frame sweep closes the short asynchronous mount
window. Keeping all three paths behind `normalizeUniverAccessibility` prevents the
third-party correction from spreading through product components.

The sweep is bounded, so it does not create permanent animation-frame work. The
observer remains necessary because later Workbook operations can still create Univer
DOM after initial mount.

## Prevention

- Treat a third-party library's lifecycle state as an API guarantee, not proof that its
  DOM has stopped changing.
- Put third-party accessibility corrections at the adapter boundary.
- Make post-mount stabilization bounded and clean it up on disposal.
- Assert the exact invariant before axe so timing failures identify the offending DOM.
- Test the dense Workbook after editing and reload, not only immediately after mount.

## Related issues

- See also:
  [Workbook tab rename commits but the label stays stale](tab-rename-stays-stale-workbook-adapter-20260720.md)
