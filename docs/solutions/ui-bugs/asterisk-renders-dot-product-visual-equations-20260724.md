---
module: Visual equations
date: "2026-07-24"
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "Typing * in a visual equation rendered a centered dot instead of an ordinary multiplication sign."
  - "Equation source stored \\cdot even though the author had entered *."
root_cause: wrong_api
resolution_type: code_fix
severity: medium
related_components: [MathLive, Equation source, Document graph]
tags: [equations, mathlive, multiplication, keyboard, latex]
---

# Troubleshooting: Asterisk renders a dot product in visual equations

## Problem

The visual Equation editor treated the common `*` keyboard input as a centered dot.
For engineering scalar multiplication this communicated the wrong operation, and the
raw source exposed `\cdot`.

## Environment

- Module: Visual equations
- Stage: Post-implementation of direct visual Equation editing
- OS: macOS
- Affected components: MathLive NodeView, Equation source projection
- Date: 2026-07-24

## Symptoms

- Typing `2*3` rendered `2 · 3`.
- Activating Edit source showed `2\cdot3`.
- An explicitly authored dot product could not be distinguished from the default
  keyboard multiplication gesture.

## What didn't work

**Normalise every stored `\cdot` to `\times`**

- **Why it failed:** that would destroy intentional dot products authored through raw
  source or another MathLive control.

## Solution

Override MathLive's single `*` inline shortcut at the input boundary. Leave payload
conversion and source parsing unchanged so explicit `\cdot` remains lossless.

```ts
mathfield.inlineShortcuts = {
  ...mathfield.inlineShortcuts,
  '*': '\\times'
};
```

The browser regression test enters `2*3`, verifies that source contains `\times`, then
round-trips an explicit `2\cdot3` and verifies it remains `\cdot`.

## Why this works

MathLive's default shortcut table maps `*` to `\cdot` before OctoMeta receives the input
event. Changing that mapping is the narrowest seam that can distinguish a physical
asterisk from deliberately authored LaTeX. Stored Equation segments therefore need no
heuristic rewrite.

## Prevention

- Configure editor keyboard semantics at the input boundary.
- Do not infer author intent later from two visually similar stored operators.
- Lock keyboard shortcuts and explicit source syntax down in the same browser test.

## Related issues

- See also:
  [Published values need a stable identity and explicit lifecycle](../best-practices/published-values-need-stable-identity-publication-lifecycle-20260723.md)
