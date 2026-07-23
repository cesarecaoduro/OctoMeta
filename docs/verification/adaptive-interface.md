# Adaptive interface verification

Issue #26 establishes the automated baseline; release verification still requires
real Safari and VoiceOver because desktop emulation does not reproduce iPhone and iPad
input, browser chrome, safe areas, or assistive technology faithfully.

## Automated gate

Run:

```sh
pnpm check
pnpm test
pnpm test:e2e
pnpm build
```

`e2e/adaptive-interface.spec.ts` verifies light and dark appearances, both sides of
the 680 px and 1080 px content transitions, 320 px reflow, page-level horizontal
overflow, the non-overlaying desktop Workbook drawer, the compact bottom dock, and axe
baselines for marketing, authentication, the document library, and the workbench.
Univer receives the active appearance rather than leaving a light grid inside dark
workbench chrome.

## Real-device matrix

Test the current Safari release on:

- the oldest supported iPhone, plus one current iPhone;
- the oldest supported iPad, plus one current iPad;
- iPad portrait, landscape, and one-third, half, and two-thirds Split View widths;
- an attached hardware keyboard and trackpad where available;
- Apple Pencil selection, caret placement, scrolling, and resizing paths where those
  controls exist.

Repeat the critical paths with Light, Dark, and System appearances, larger text,
400% browser zoom where available, Reduce Motion, Increase Contrast, and Reduce
Transparency. Rotate and resize while the Workbook, a menu, a sheet, and Inspector are
open. Show and dismiss the software keyboard without losing the focused field or
covering the contextual dock.

## VoiceOver script

1. Enter the library and confirm the brand, Documents navigation, appearance control,
   account menu, search, document rows, status, and actions have concise names.
2. Open a Document and confirm Back, title, working-copy identity, local durability,
   Save new version, Document/Workbook switcher, contextual controls, and More are in
   a logical order.
3. Operate every essential action using swipe navigation and the rotor. No action may
   require hover, a gesture, or a keyboard shortcut.
4. Open and close the Workbook, More menu, Published-values/Parameters sheet, and
   Inspector. Focus must enter the surface, remain contained where modal, and return
   to the invoking control.
5. Commit one source edit. Confirm the reduced-motion path announces the computation
   result without spatial travel and does not steal focus or scroll the viewport.

Record device, OS version, Safari version, appearance, accessibility settings, input
method, result, and any reproduction steps.

## Performance script

Use Safari Web Inspector on the oldest supported iPhone and iPad:

- record taps, selections, menu opens, workspace switches, and typing; ordinary
  interactions must keep Interaction to Next Paint at or below 200 ms;
- record sheets, menus, Workbook presentation, resizing, and computation traces; the
  animation track should sustain 60 fps without long main-thread tasks;
- repeat with a dense Workbook and a long Document, then with Reduce Motion and Reduce
  Transparency;
- verify heavy workspaces do not block initial Document interaction and offscreen
  computation animation stops.

Attach the trace and device matrix to the release verification record. A miss on
accessibility, INP, frame rate, lost focus, or horizontal page scroll blocks release.
