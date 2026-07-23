# Apple-caliber adaptive interface

**Status:** Accepted
**Date:** 23 July 2026
**Scope:** Cross-cutting interface strategy for the marketing site, authentication,
document library, and authenticated workbench

## Purpose

OctoMeta will adopt Apple-caliber hierarchy, clarity, adaptability, tactile feedback,
and purposeful motion without imitating an Apple product. The result remains
OctoMeta-native: paper/ink/violet, engineering typography, dependency lines, and
computation behavior remain the identity.

`DESIGN.md` is the visual and interaction source of truth. This specification records
how that system aligns with the accepted domain model, ADRs, and current GitHub issue
graph. It does not authorize native-app work or change the product's domain behavior.

Primary Apple guidance:

- [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines)
- [Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
- [Icons](https://developer.apple.com/design/human-interface-guidelines/icons)
- [Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
- [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- [Designing for iPadOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ipados)

## Governing constraints

The redesign must preserve these accepted decisions:

| Area | Governing decisions | Interface consequence |
|---|---|---|
| Local creation and durability | ADR 0001, 0011, 0013, 0014 | Local durability and cloud publication remain distinct; one editing lease and offline owner authoring stay visible and safe. |
| Document composition | ADR 0008, 0009 | TipTap remains the engine; Sections own one child level; slash/Add insertion and contextual Block controls extend existing primitives. |
| Published content | ADR 0003, 0004 | Only Published values enter reference pickers; identity survives rename; unpublishing discloses usage and leaves repairable broken references. |
| Equations | ADR 0002 | Direct visual equations compose authored notation with multiple stable Published-value references. |
| Images | ADR 0005 | Image Blocks own imported bytes and remain locally reproducible before explicit publication. |
| Cloud history | ADR 0006, 0007, 0010, 0015 | Main advances through immutable versions; Branches stay local; Reconciliation is explicit and conservative; Restore never rewinds Main. |
| Sign-out | ADR 0012 | Every unresolved local Document, working copy, and Branch is saved, exported, or discarded before browser data removal. |
| Prototype cleanup | ADR 0016 | Operational reset remains guarded and preserves authentication identities and the marketing waitlist. |
| Adaptive capability | ADR 0017 | Essential authoring capability remains available in compact, regular, and expanded layouts. |

Historical R1.6 plans describe the completed bottom-Workbook/Parameters prototype.
Current issues #12 and #13 deliberately refine that into a non-overlaying Workbook
drawer and Workbook-owned Published-value management.

## Experience contract

### Identity and tone

- Apple-caliber, OctoMeta-native.
- Calm at rest, alive in response.
- Inter Tight remains display type, Inter remains interface/prose, and JetBrains Mono
  remains computational.
- Violet becomes the disciplined system tint; independent semantic status colors never
  borrow brand meaning.
- Gradients remain exclusive to the logo.

### Controls and materials

- Use Lucide for familiar actions and an optically matched OctoMeta set for domain
  concepts.
- Icon-first never means universally icon-only. Ambiguous, destructive, and
  OctoMeta-specific actions retain visible labels or labelled menu entries.
- The Document stays matte and paper-like.
- Restrained translucency, backdrop blur, and soft elevation are limited to genuinely
  floating chrome.
- Engineering content remains geometrically crisp; floating controls use selective
  concentric rounding.

### Appearance and motion

- `System`, `Light`, and `Dark` are first-class preferences across every surface,
  including the Workbook and marketing.
- Motion must provide feedback, continuity, or computation.
- The computation trace is the signature interaction after a committed edit.
- Reduced Motion replaces spatial travel, scale, blur animation, and springs with
  short opacity changes or immediate state changes.
- Reduced transparency, increased contrast, and forced colors receive usable
  fallbacks.

### Adaptive layout

- Layout is content-driven, never device-detected.
- Compact focuses one primary workspace at a time.
- Regular composes the Document and one companion only when both retain viable content
  areas.
- Expanded places the independently scrolling Workbook in a non-overlaying bottom
  drawer that resizes the Document viewport.
- iPad multitasking, orientation, safe areas, browser chrome, virtual keyboards,
  Dynamic Type/text zoom, pointer, touch, hardware keyboard, and Apple Pencil are
  independent variables.
- Every essential task remains possible on phones and tablets.

## Surface contracts

### Workbench

- One focused workbench shell replaces the current global-header-plus-toolbar stack.
- The shell owns Back, Document title, working-copy or Branch identity, local
  durability, cloud state, visible `Save new version`, Workbook toggle, and More.
- Undo and Redo live in contextual touch controls, labelled menus, the command
  palette, and keyboard shortcuts.
- Compact mode keeps a labelled Document/Workbook switch and a safe-area-aware
  contextual dock.
- Future Workbook height adjustment is bounded, accessible, persisted by Document and
  layout mode, and resettable through a labelled command.

### Document authoring

- Blocks stay quiet until focused or selected.
- Text accepts direct caret placement.
- Selection reveals a restrained boundary, drag handle, and More.
- Reordering has drag, keyboard, and labelled menu paths.
- `/` and Add Block open the same searchable insertion command.
- Sections are one-level notebook groups whose collapse is local preference state.
- Equations edit directly with composable Published-value tokens and no Apply step.
- Images insert from picker, drop, or paste; preserve aspect ratio; and expose
  accessible resize, alignment, caption, and alternative-text controls.

### Workbook, Published values, and Inspector

- The Workbook remains dense; 44×44 targets apply to chrome, not every cell.
- Formula line and tabs remain reachable; compact mode gives the Workbook the focused
  workspace.
- Published values are managed in a searchable contextual manager inside the Workbook.
- No Parameters rail, Parameters destination, or permanent Parameters control remains.
- Inspector is transient provenance opened explicitly from a reference, Published
  value, or cell; it never becomes a permanent navigation destination.

### Library and authentication

- The library remains list-first, with adaptive Live/Trash navigation, prominent
  search, explicit touch selection, and grouped Main/Branch presentation.
- Branches show local-device status, base version, edit time, and
  active/divergent/reconciled state.
- Authentication progressively discloses existing Google, email/password, magic-link,
  and account-creation paths while preserving autofill and password-manager behavior.

### Versions, history, and recovery

- `Save new version` opens a review surface showing the proposed version, source,
  change summary, assets, warnings, and optional message.
- History is a dedicated full-height workspace with a read-only preview.
- Reconciliation summarizes automatic resolutions and requires an explicit decision
  for every remaining conflict; concurrent Workbook changes stay one conflict.
- Import validates the complete archive before creating an independent local Document.
- Sign-out opens a dedicated resolution workspace whenever unresolved browser work
  exists.
- Help is a searchable offline task workspace.
- Activity is session-scoped and distinct from immutable cloud History.

### Marketing

- Product behavior remains the spectacle.
- The live hero demonstrates one engineering edit propagating through the Document,
  Workbook, equation, and graph.
- Compact layouts receive a touchable simplified demonstration, not a compressed
  desktop animation.
- No abstract glass sculpture, generic AI glow, stock imagery, or scroll hijacking.

## Open-issue alignment

| Order | Issue | Interface alignment |
|---:|---|---|
| 0 | #26 Adaptive interface foundation | Shared themes, icons, materials, motion, adaptive primitives, accessibility, performance, and verification baselines. |
| 1 | #10 Save immutable cloud versions | Review-first responsive version sheet; visible local/cloud distinction. |
| 1 | #12 Resizable workbench | Single shell; independently scrolling bottom-panel Workbook; adaptive focus modes. |
| 2 | #11 Images | Content-first local Image Blocks with adaptive accessible controls. |
| 2 | #13 Published values | Workbook-owned manager; no Parameters rail; shared searchable pickers. |
| 2 | #15 Sections/slash menu | Shared slash/Add insertion; quiet one-level notebook Sections. |
| 3 | #14 Visual equations | Direct focus-safe composition with stable reference tokens and no Apply step. |
| 4 | #16 Local Branches | Grouped library presentation and explicit workbench Branch identity. |
| 5 | #17 Reconciliation/history | Dedicated responsive task workspace; explicit conflicts; forward-only restore. |
| 5 | #18 Portability/sign-out | Dedicated import/export and unresolved-work resolution flows. |
| 6 | #19 Help/Activity | Offline full-height Help and session Activity distinct from History. |
| 7 | #20 Reset/legacy removal | No new product surface; inherits repository verification gates. |

The cross-cutting design foundation precedes UI-bearing work. Existing issue bodies,
labels, and dependency relationships remain intact; additive alignment notes point to
this specification and `DESIGN.md`.

## Verification gates

Completion requires:

- WCAG 2.2 AA in both appearances.
- Keyboard and VoiceOver verification, including focus restoration across sheets,
  dialogs, the Workbook, and full-height task workspaces.
- Automated viewport sweeps from 320 px through expanded widths and tests on both sides
  of every content-driven transition.
- Compact and regular portrait/landscape, iPad-style split widths, browser text zoom,
  virtual keyboard, touch, pointer, and reduced-motion coverage.
- No accidental page-level horizontal scroll.
- Immediate control feedback, ordinary Interaction to Next Paint within 200 ms, and
  smooth 60 fps transitions on representative real hardware.
- Final real-device Safari verification on iPhone and iPad, including older supported
  hardware.
- Existing type, unit, browser, build, audit, and secret-scan gates.

## Delivery rule

Implementation proceeds as reviewable vertical slices but releases only when the core
workbench language is coherent. Existing behavior and ADR guarantees remain regression
contracts unless an accepted issue explicitly replaces them. Library and
authentication adopt the system as their workflows land; marketing follows once the
workbench language is stable.
