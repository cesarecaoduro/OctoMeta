# `src/lib/adapters/`

Third-party surfaces translate user events into engine mutations and settled
graph values back into display state. They never own authoritative product
state.

## Univer

`src/lib/adapters/univer/` owns the document's one attached workbook.
`univer-api.ts` is the only module with runtime `@univerjs/*` imports.

| Module | Responsibility |
|---|---|
| `univer-api.ts` | Thin wrappers for workbook/tab/cell/name/selection/snapshot APIs, boot order, accessibility normalization |
| `workbook-adapter.ts` | One Univer instance ↔ one `GraphSession`; explicit `SheetId` IO; manifest reconciliation; formula demotion |
| `graph-sync.ts` | Commit/recalc session, cell edit routing, published-name lifecycle |
| `cell-text.ts` | Pure A1 mapping, edit classification, shared value formatting, defined-name bookkeeping |
| `index.ts` | Public adapter surface |

Invariants:

- every cell operation carries immutable `{ sheetId, a1 }`;
- active tab is presentation state, never an ownership lookup;
- the engine AST is authoritative and persisted Univer cells have formula
  payloads cleared;
- workbook add/rename/remove commits `workbookOp` and participates in the one
  engine history;
- graph settle reconciles tabs and paints values without resetting user
  selection;
- one adapter and listener set exists per loaded document and all listeners are
  disposed with it.

Import from `./univer`, not its internals.
