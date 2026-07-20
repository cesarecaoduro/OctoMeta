# `src/lib/editor/`

The document canvas (V1-5-1): TipTap hosting the block types `text`,
`heading`, and `image`. **This directory is the only place allowed to import
`@tiptap/*` / ProseMirror** (IMPLEMENTATION_PLAN.md §11 rule 2 — third-party
isolation; the Univer adapter has the same arrangement for `@univerjs` under
`src/lib/adapters/univer/`).

Block structure lives in the graph, not in TipTap: every add/move/remove/
update goes through `commit(blockOp …)` so it lands in the engine undo log,
and engine history is THE undo/redo (TipTap's own history is disabled).

| Module | What it does |
|---|---|
| `blocks.ts` | Pure PM-JSON ⇄ `Block` mapping: classify top-level nodes, strip/stamp the `blockId` attribute, render a TipTap doc from graph blocks. |
| `sync.ts` | `createBlockSync` — reconciles the editor doc against the graph after every TipTap update: structural ops (add/remove/move, type changes) commit immediately; per-block prose content updates are debounced into `blockOp update`. |
| `image-node.ts` | `imageBlock` atom node + plain-DOM NodeView; resolves `storageId` → URL through an injected resolver (persistence stays out of this layer). |
| `chips.ts` | Pure chip logic (V1-5-3/V1-5-4): value → display mapping (formats, errors, busy, dangling), the doc ⇄ bindings sync plan (`planChipSync`), picker filtering, show-steps helpers (`canExpandSteps`, `chipDerivation`, `derivationLines`). |
| `chip-node.ts` | `valueChip` inline atom + NodeView: renders the bound node's live value from graph state, recompute flash on settle, error deep-link on click/Enter, show-steps expansion on value chips (V1-5-4), SR labels. |
| `chip-picker.ts` | The `@` insert-by-name picker: a small ProseMirror plugin + DOM listbox (keyboard-navigable, `role=listbox`/`option`, `aria-activedescendant`). |
| `inspector.ts` | Pure provenance-inspector view-model (V1-5-5): node → panel mapping (title/kind/canonical formula/value), provenance formatting (actor kind + id, absolute times), navigable inputs/dependents links off the graph's derived indexes. Rendered by `src/routes/app/[docId]/Inspector.svelte`. |
| `create-editor.ts` | Assembles the editor: StarterKit (markdown input rules, `undoRedo`/`link` off), blockId global attribute, keymap (undo/redo/block move), reconcile-on-update wiring, chip sync + insertion + deep-link navigation, `renderFromGraph`. |

Prose→blockOp mapping (the decision, for ARCHITECTURE.md): each top-level PM
node carries a hidden `blockId` attribute (`keepOnSplit: false`, so Enter
splits yield unidentified nodes that reconcile as fresh `blockOp add`s).
On every editor update the doc is diffed against `graph.blocksOrder`:
structure commits synchronously, per-block PM-JSON changes commit after a
300 ms debounce (`flush()` before undo/redo/save/structural ops). A top-level
node type change (e.g. `#` turning a paragraph into a heading) commits as
`blockOp remove` + `add` under the same block id, because `blockOp update`
protects `type`. Evaluation never reads `position`; moves return an empty
AffectedSet (asserted by `sync.test.ts`). The empty trailing paragraph that
TipTap's `trailingNode` keeps after the last block (docs/v1-0-findings.md
landmine 3) is ephemeral UI chrome: reconcile ignores it until it gains
content, so re-renders never plant stray undo entries.

Value chips (V1-5-3, the decisions, for ARCHITECTURE.md/SCHEMA.md):

- **Op shape.** Chip lifecycle is `{ op: 'chipOp', action: 'create' | 'remove',
  chipId, chip? }` where `chip` (`create` only) is `Omit<ChipBinding, 'id'>` —
  `{ blockId, nodeId, format? }`. `create` requires a fresh chipId and an
  existing node + block; its inverse is `chipOp remove`. `remove`'s inverse is
  the undo-internal `restoreChip` (full prior binding). `rebindChip` stays
  strict update-only. AffectedSet is always empty (chips are projections).
- **Undo pairing/ordering.** Insert commits `[chipOp create]` then the prose
  `[blockOp update]`; deleting a chip from prose flushes the hosting block's
  `[blockOp update]` FIRST, then `[chipOp remove]`. Undo replays newest-first,
  so the binding always exists whenever the chip node is in the doc — no
  intermediate `#REF!`. One user action spans two entries; the binding-only
  entry is invisible on its own.
- **Copy/paste.** In-doc duplicates are reminted on the next reconcile: fresh
  chipId, same nodeId, format cloned, hosted by the pasted block. Cross-doc
  pastes have no source binding and render `#REF!`. Cut-then-paste removes
  the binding at cut time (mandated by delete semantics), so the re-pasted
  node is also `#REF!` — undo recovers it.
- **Deep-link fallback.** Error chips navigate to `origin`'s hosting block
  (scroll + accent ring). When the origin is unresolvable (node deleted, no
  `blockId`, block not in the doc) the chip re-pulses its error styling in
  place.
- **Busy state.** The engine settles synchronously, so "between mutation and
  settle" is only observable as the mutation layer's `#VALUE! not yet
  evaluated` seed; chips render it as `…` with `aria-busy`.

Show-steps expansion (V1-5-4, the decisions, for ARCHITECTURE.md):

- **Affordance.** Click/Enter on a VALUE chip toggles an in-canvas derivation
  panel; click/Enter on an error/dangling chip keeps the V1-5-3 deep-link.
  The two never conflict because they are keyed off the chip's display state
  (busy chips do nothing). Escape collapses; role=button + `aria-expanded`
  announce the affordance without changing the V1-5-3 label text.
- **Derivation at render time.** The panel builds from `chipDerivation(nodeId,
  graph, registry)` on expand and re-derives on EVERY settle while open, so an
  open panel follows upstream edits. `chipDerivation` follows one alias hop:
  chips bind to published names, and a `namedOutput` node's own derivation is
  the bare alias (`beam.load = B1`), so when the bound node is a namedOutput
  whose formula is a bare resolving reference, the referenced node's
  derivation is shown instead, headed by the published name. Everything else
  is the engine's `buildDerivation` verbatim.
- **A11y.** The plain-text derivation (`renderStepsText`) rides in the panel
  as visually-hidden text; the styled `.chip-steps-line` spans are
  `aria-hidden` so nothing reads twice.
- **Styling.** `.chip-steps` in base.css: surface + 1px hairline +
  `--radius-panel`, no shadow, no animation (reduced motion honored by
  construction); all lines mono; accent only on the result line (a computed
  value, an allowed accent surface).

Provenance inspector (V1-5-5, the decisions, for ARCHITECTURE.md):

- **Chip affordance.** Alt+click or Alt+Enter on a chip opens the inspector on
  its bound node — a dedicated modifier affordance, so it can never collide
  with plain click/Enter (error deep-link, V1-5-3; steps expansion, V1-5-4)
  or with chip focus. Announced via `aria-keyshortcuts="Alt+Enter"`; the chip
  label text is unchanged. Dangling chips (no binding) have nothing to
  inspect and the affordance is inert.
- **Cell affordance.** Selecting a graph-bound sheet cell opens/re-targets the
  inspector at that cell's node (unbound cells do nothing). The adapter's
  `onSelect` hook is read-only and gated on user intent: Univer's mount-time
  programmatic A1 selection never fires it (see `adapter.ts`).
- **Read-only, live.** The panel only reads: `buildInspector` derives from the
  node, its provenance, and the graph's derived indexes (`inputs`,
  `dependentsOf` reverse edges); the page bumps a revision on every settle so
  the open panel follows edits. Navigation is data (`InspectorLink.nodeId`) —
  clicking a link re-targets the panel, walking the chain without leaving it.
  When the inspected node vanishes (undo, delete) the panel closes.
- **Focus.** Chip-driven opens move focus to the panel and return it to the
  chip on close; cell-selection opens never steal focus from the grid.
  Escape closes from anywhere outside a grid (inside one, Escape keeps its
  V1-5-2 meaning: leave the grid). Links are real buttons, keyboard-walkable.
- **Display.** Engine kind `computed` renders as `formula`; the value renders
  like chips do (shared `.chip`/`.err` styling, busy `…`, error codes as-is)
  but without per-chip `format.digits` — the inspector shows bare nodes.
  Provenance renders actor kind plus id (`template · beam-template`) and
  absolute local time (`20 Jul 2026, 14:32`); `verifiedBy/At` appear when
  present. All computational text mono; no shadows; no animation, so reduced
  motion is honored by construction.

- Owner tasks: V1-5-1 (block editor shell + blockOp + document list),
  V1-5-3 (inline live value chips), V1-5-4 UI half (show-steps rendering),
  V1-5-5 (provenance inspector view-model + affordances).
