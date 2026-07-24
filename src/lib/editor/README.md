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
| `equation-model.ts` | Pure structured-segment ↔ MathLive macro projection |
| `equation-node.ts` | Focus-safe visual equation editor and guarded KaTeX fallback |
| `chip-node.ts` | Live parameter/output pills, editing, steps, inspector/error links |
| `chips.ts` | Pure binding, display, target-resolution, and picker helpers |
| `inspector.ts` | Pure provenance/dependency view model |

Top-level nodes carry stable `blockId`s. Structural changes commit immediately;
prose content flushes before save, undo/redo, or structural work. A workbook
error link carries the exact `CellRef`, opens the drawer after readiness,
activates/selects that cell, and preserves return focus.

Equation payloads are versioned and composable:

```ts
{
  version: 1;
  segments: Array<
    | { kind: 'latex'; latex: string }
    | {
        kind: 'reference';
        nodeId: string;
        fallback: { name: string; sheetId?: string; cell?: string };
      }
  >;
}
```

MathLive reference macros are immutable editing atoms whose names exist only
in the projection; parsing them restores the stored stable IDs. The visual
formula substitutes the current published value, while the source projection
uses `\value{name}` so authors see the semantic parameter without internal
macro names. Published display units accompany both equation substitutions and
inline value chips. Input commits without Apply, graph repaint updates the
substituted value without replacing the focused field, Escape restores the
session start, and Cmd/Ctrl+Enter finishes. Read-only leases disable the field,
source, and reference controls. KaTeX is trust-disabled and limit-guarded.
Invalid TeX stays editable and reveals the last valid preview.
