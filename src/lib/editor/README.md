# `src/lib/editor/`

The TipTap report projection. This is the only source directory allowed to
import TipTap/ProseMirror.

The report block union is `text | heading | image | equation`. Workbook sheets
are document-level state rendered by `WorkbookDrawer`, not TipTap nodes.
Structure lives in `DocumentGraph`; TipTap history is disabled so engine
undo/redo spans report and workbook actions.

| Module | Responsibility |
|---|---|
| `blocks.ts` | Pure graph block ↔ ProseMirror JSON mapping |
| `sync.ts` | Structural reconcile and debounced prose updates through `blockOp` |
| `create-editor.ts` | Editor assembly, engine history, insertion, focus, error navigation |
| `block-chrome.ts` | Visible, keyboard-operable move/remove controls |
| `insert-slots.ts` | Between-block text/image/equation insertion |
| `image-node.ts` | Owned storage-backed image node view |
| `equation-node.ts` | Static/bound equation UI and guarded KaTeX rendering |
| `chip-node.ts` | Live parameter/output pills, editing, steps, inspector/error links |
| `chips.ts` | Pure binding, display, target-resolution, and picker helpers |
| `inspector.ts` | Pure provenance/dependency view model |

Top-level nodes carry stable `blockId`s. Structural changes commit immediately;
prose content flushes before save, undo/redo, or structural work. A workbook
error link carries the exact `CellRef`, opens the drawer after readiness,
activates/selects that cell, and preserves return focus.

Equation payloads are discriminated:

```ts
{ mode: 'static'; tex: string }
{ mode: 'bound'; nodeId: string; display: 'symbolic'|'substituted'|'result'|'steps' }
```

KaTeX is trust-disabled and limit-guarded. Invalid TeX leaves the editor usable
and retains the last valid preview.
