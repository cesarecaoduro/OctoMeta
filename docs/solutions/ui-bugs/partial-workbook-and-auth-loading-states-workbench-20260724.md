---
module: Document workbench
date: "2026-07-24"
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "The Workbook displayed “Starting workbook…” over a live cell while Univer was still mounting."
  - "The first skeleton implementation mixed placeholder bars with real cell values."
  - "Session resolution replaced the application with a full-page “Authenticating workspace…” message."
root_cause: async_timing
resolution_type: code_fix
severity: medium
related_components: [Authentication, Univer, SvelteKit]
tags: [loading-state, skeleton, authentication, workbook, svelte]
---

# Troubleshooting: Partial Workbook and full-page authentication loading states

## Problem

Asynchronous Workbook and session startup exposed intermediate implementation states.
The Workbook first painted status copy inside its grid and later mixed real cells with
transparent placeholder marks. Initial hydration replaced the route with authentication
copy instead of preserving the shape of the destination.

## Environment

- Module: Document workbench
- Stage: Post-implementation UI refinement
- OS: macOS
- Affected components: SvelteKit app layout, Workbook drawer, Univer adapter
- Date: 2026-07-24

## Symptoms

- `Starting workbook…` appeared over the selected cell.
- Real values such as `25`, `12`, and `13` were visible beneath grey skeleton bars.
- Refreshing a Document briefly showed `Authenticating workspace…` instead of a stable
  workbench frame.

## What didn't work

**Place a status paragraph above the Workbook grid**

- **Why it failed:** Univer started painting immediately, so status copy and cell content
  occupied the same visual space.

**Overlay a transparent grid skeleton only over the cells**

- **Why it failed:** the formula line and tabs looked complete while the grid remained
  partial, and any invalid or translucent background layer exposed real values beneath
  placeholder marks.

**Hide or unmount the live grid**

- **Why it failed:** Univer needs its final mounted dimensions to size the canvas. A
  hidden or absent container produced a zero-sized canvas.

## Solution

Keep the real Workbook adapter mounted at its final size, but cover the complete body
with one opaque structural skeleton spanning the formula line, tabs, and grid. Remove
that overlay only after adapter setup and listeners complete.

```svelte
<section>
  {#if loading}
    <div class="workbook-skeleton" role="status" aria-label="Loading workbook">
      <!-- formula, tabs, and empty grid structure -->
    </div>
  {/if}
  <div class="formula-line">...</div>
  <div class="tab-tools">...</div>
  <div class="grid" bind:this={gridEl}></div>
</section>
```

The application layout similarly renders a route-shaped shell through SSR hydration
and session resolution. Once the client and owner state are ready, it swaps directly
to the Document library or workbench.

```svelte
{#if clientReady && (auth.isAuthenticated || canOpenOffline)}
  {@render children()}
{:else if !clientReady || auth.isLoading}
  <AppShellSkeleton documentRoute={page.route.id === '/app/[docId]'} />
{/if}
```

## Why this works

The Workbook remains measurable and can initialise normally, but an opaque sibling
owns the visual surface until readiness. Covering the entire body prevents mixed
placeholder/live states. The session shell uses the same route geometry as the final
screen, so hydration changes content without replacing the user's spatial context.

## Prevention

- Skeletons must replace one complete perceived object, not decorate a partially live one.
- Keep third-party canvases mounted at their final dimensions during asynchronous setup.
- Use opaque semantic surfaces for overlays; do not depend on layered gradients to hide data.
- Test that placeholders were present, status copy was absent, and the live adapter is ready
  after the placeholder disappears.
- Test both Document-library and workbench session shells across a browser refresh.

## Related issues

- See also:
  [Read-only live refresh reauthenticates the workspace](readonly-live-refresh-reauthenticates-workspace-local-persistence-20260723.md)
