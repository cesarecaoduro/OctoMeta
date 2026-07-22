# R1 — the living document: report canvas + attached workbook

*Release-level execution plan, deepened 20 Jul 2026 after reviewing the current engine, Univer adapter, editor, persistence layer, Convex functions, routes, tests, `DESIGN.md`, and deployment configuration.*

---

## Enhancement Summary

### What the code review changed

- Workbook tabs are now typed document state, with stable `SheetId`s and undoable mutations. They cannot “ride the snapshot” without breaking graph integrity and the promised linear undo history.
- Every adapter operation is sheet-explicit. The current active-sheet helpers are not safe in a multi-tab workbook.
- The preset Univer formula bar is disabled. Because OctoMeta deliberately demotes Univer formulas to settled values, R1 adds a slim graph-backed formula line that displays and edits the authoritative graph formula.
- Cross-tab formulas use published names in R1. The current parser does not support `Sheet!A1` syntax.
- Published parameters resolve through the existing `namedOutput` alias. The alias remains the binding identity; the resolved source node determines input/output behavior.
- Published-name rename preserves the existing alias `NodeId`, so chips and equations do not break.
- The steel demo’s imperial units are now real R1 work. `in`, `lbf`, `kip`, `psi`, `ksi`, and compound displays such as `in^2` are absent from the current unit registry.
- Graph rows and the workbook snapshot save in one revisioned Convex mutation. Hash/revision mismatch fails closed instead of opening an editable, potentially destructive session.
- The equation payload is a discriminated union and KaTeX rendering has explicit security and complexity limits.
- Trash, asset cleanup, dev reset, narrow layouts, offline/save failure, accessibility, and production authorization now have executable contracts.

### Research and review incorporated

- Architecture, data-integrity, product-flow, security, performance, TypeScript/race, deployment, document, and accessibility reviews.
- Current repository behavior and installed APIs, including Univer `0.25.1`, TipTap `3.28.0`, Convex `1.42.3`, Svelte `5.56.1`, SvelteKit `2.63.0`, TypeScript `6`, and Vite `8`.
- Official Univer, TipTap, KaTeX, Convex, WAI-ARIA, SvelteKit/Vercel, and web-interface guidance linked in §12.
- Baseline verification: `pnpm check` is green with 0 errors and 0 warnings. The production dependency audit has one known low-severity transitive advisory in `cookie@0.6.0` and no moderate, high, or critical findings.

### Execution status

**Implemented and locally release-verified on `feat/v1-6-workbench` (20 Jul
2026).** R1-0 through R1-6, the R1-7 product/demo/build work, and R1-8 are
complete. The protected production workflow is implemented; executing it is
correctly pending the separate production Convex/Vercel credentials, backup,
and environment approval listed in R1-7.

Completion evidence:

| Gate | Evidence |
|---|---|
| Contract and engine | Typed workbook manifest, `CellRef { sheetId, a1 }`, workbook history, alias-preserving rename, imperial/parameter/math suites |
| Atomic data | Owner isolation, CAS conflict, integrity corruption, byte/count limits, reproducibility, assets, trash, retention, and reset safety in Convex tests |
| Workbook/report | One live workbook, no report sheet blocks, graph-backed formula line, exact cell deep-link, parameters/equations/chrome/list |
| Browser | Complete steel demo through edit/error/fix/tab history/reload/trash/restore; signed-out gate; malicious TeX; `390×844` narrow/axe |
| Delivery | Vercel adapter, CSP/security headers, self-hosted app fonts, frozen pnpm CI, audit/secret scan, protected manual production workflow |

The production-only latency sample, real OAuth/magic-link delivery, backup ID,
and first production deployment remain release-operator evidence, not local
implementation gaps.

---

## 1. Context and decision log

Three shapes were considered as V1 met first use:

1. **V1 as built:** Univer grids as blocks *inside* the canvas. Verdict: the document became a spreadsheet container, not a report; grid chrome overwhelmed the prose; engineers do not think in A1 inside a report.
2. **Headless pivot (rejected):** drop Univer entirely and use “formula blocks” of named rows. Verdict: right instinct about the canvas, wrong about the engine room—real calculations need a working surface for data, intermediate tables, and formula work.
3. **The CalcTree shape (decided 20 Jul 2026):** **the document is the report; the spreadsheet is attached to the document.** One document-level workbook lives in a collapsible bottom drawer. The canvas holds text, images, equations, and parameters. The typed graph remains the single source of truth joining both surfaces.

The product shape is a relocation, but the implementation is a contract rewrite rather than a path rename. The current adapter assumes one active sheet per sheet block; cell ownership, tab lifecycle, formula presentation, undo, persistence, and error navigation all change when sheet blocks disappear.

### Locked decisions

| Question | R1 decision |
|---|---|
| Workbook identity | One workbook per document; typed manifest owns tab IDs, names, and order. |
| Tab identity | Stable opaque `SheetId`; never derive identity from display name or array position. |
| Default tabs | A new document is created atomically with one `Sheet 1`. The seeded demo has `Input`, `Calculation`, and `Output`. |
| Tab deletion | Cannot delete the last tab. Deleting a non-empty or referenced tab requires confirmation and is one undoable action. |
| Formula ownership | Graph AST is authoritative; Univer stores settled display values with formula payloads cleared. |
| Formula line | Custom graph-backed line; Univer preset `formulaBar: false`. |
| Structural grid operations | Disable Univer’s context menu entirely in R1. Keep direct cell edit, selection, copy/paste, cell styling, row height, and column width; do not expose insert/delete/move rows or columns, merge, sort, filter, or other address-changing commands. |
| Cross-tab formulas | Published names only. Bare A1/ranges are local to the formula’s sheet; `Sheet!A1` is deferred. |
| Parameter identity | Chip/equation binds the published alias `NodeId`; a one-hop resolver finds the source node. |
| Published-name rename | Rename alias in place, preserve `NodeId`, rewrite dependents atomically, one undo entry. |
| Units | Canonical SI storage plus authored display units. R1 adds the minimal imperial vocabulary required by the demo. |
| Persistence | One atomic, revisioned save mutation covers graph rows, typed workbook manifest, workbook snapshot, hashes, and stats. |
| Conflict behavior | Compare-and-swap conflict makes the client reload-required/read-only; no blind retry or last-writer-wins overwrite. |
| Integrity failure | Fail closed. Do not mount an editable editor/workbook and send zero writes. |
| Offline behavior | Online-required R1. In-memory edits survive transient loss; navigation is guarded until save succeeds or the user explicitly discards. No offline reload cache. |
| Production access | R1-0 implements minimal authenticated ownership and route gating; R1-7 verifies it in production. Full account management, sharing, teams, and ACLs remain R2. |
| Narrow layout | Parameters is a modal sheet and workbook is a full-screen workspace at `<= 800px`. |

---

## 2. Product definition and behavior contract

R1 is a demo-ready, single-owner product:

1. **Documents** — create, open, rename, search, sort, show stats, multi-select, move to trash, restore, delete forever, and empty trash. Trashed documents are retained for 30 days.
2. **Report canvas** — full-width prose, heading, image, and equation blocks. Blocks are visibly delimited on hover/focus, insertable at any gap, removable, reorderable, keyboard-operable, and covered by the same engine undo history.
3. **Attached workbook** — one Univer workbook in a collapsible bottom drawer with multiple tabs, a graph-backed formula line, and grid. There is no ribbon or built-in formula bar.
4. **Parameters** — published names bridge the workbook and report:
   - Input pills such as `d = 20 in` edit the underlying input node.
   - Output pills such as `A = 38.00 in²` are read-only and announce/reveal recompute.
   - A Parameters rail lists published inputs and outputs and incorporates provenance/detail.
5. **Equation blocks** — render a bound node as symbolic, substituted, result, or steps math; or hold authored static TeX.
6. **Trust surfaces** — show-steps, provenance, explicit errors, verified reload, save state, and one linear undo path across report structure, pills, workbook cells, names, and tabs.

### 2.1 Workbook behavior

- Canvas becomes editable before Univer finishes booting. Target: report ready in under 1 second on the production build; workbook boot continues once in the background.
- Closed drawer leaves a real button/tab bar, 40–48 px high, labelled `Workbook` or `Workbook · Loading…`, with `aria-expanded` and `aria-controls`.
- Desktop drawer opens to `45dvh`, participates in layout, and never overlays the last report block. It is not drag-resizable in R1.
- Drawer open/closed state is stored in a document-scoped local-storage key. Active tab is persisted in the workbook snapshot. Corrupt/missing UI state falls back to closed and the first tab.
- Mount remains measurable while collapsed or the adapter invokes an explicit resize/reflow before first paint; never boot Univer into `display:none` or a zero-size container.
- Workbook boot failure is isolated: report editing remains available, drawer shows an alert and Retry, and Retry does not create duplicate Univer instances/listeners.
- Add names the next unused `Sheet n`. Rename trims input, requires 1–64 characters, and enforces case-insensitive uniqueness. F2, double-click, and menu work on desktop; a menu is always available for touch.
- The tablist supports Left/Right/Home/End and activates tabs automatically. The active tab scrolls into view.
- Deleting a non-empty tab states its populated-cell, published-name, and external-dependent counts. Undo restores the same tab ID, name, data, names, active-tab state, and bindings.

### 2.2 Parameters and pill editing

- `resolvePublishedTarget` follows exactly one `namedOutput` alias hop and returns `{ publishedNode, targetNode }`. Alias chains beyond one hop are non-editable outputs for R1.
- Parameters rail groups aliases by resolved target kind, alphabetically within Inputs and Outputs.
- A pill retains the published alias as binding identity. An input edit commits `setInput` to the resolved source `NodeId`.
- Editable R1 values are scalar or quantity inputs. String, boolean, table, geometry, computed, and error targets remain read-only.
- Enter or F2 starts editing and selects the value. Enter commits; Escape cancels. Blur commits only a valid value and otherwise retains the editor/error.
- A unitless numeric edit of an existing quantity inherits its current display unit. An explicit compatible unit is accepted. Empty values, formulas, `NaN`, infinity, unknown units, and dimensionally incompatible units are rejected without mutation, save scheduling, or undo entry.
- Zero and negative values are valid unless the formula/domain itself rejects them.
- Successful commit keeps focus on the pill, repaints the source cell, recomputes dependents, updates equations/rail/inspector, and announces the settled value. Motion is supplementary and disabled by `prefers-reduced-motion`.
- Rail insertion uses the last valid prose `TextSelection`. If none exists, insertion is disabled with `Place the cursor in the report to insert`. Duplicate pills are allowed and get fresh chip IDs.
- `Alt+Enter` opens provenance/detail. Output pill Enter/click toggles steps. These actions never collide with input editing.

### 2.3 Unit contract

- Stored quantity magnitude is canonical SI. `Dimension.display` preserves the authored/preferred display.
- R1 adds `in`, `ft`, `lbf`, `kip`, `psi`, and `ksi`, including compound parsing/formatting required for `in^2`, `in²`, `sqin`, and derived outputs. Aliases normalize to one canonical display spelling.
- Plain cell text matching strict `number + unit-expression` syntax calls `parseQuantity`; it must not become a string. Formula literals such as `=20 in` keep the existing formula path.
- One shared formatter is used by cells, custom formula line, pills, rail, inspector, equations, and steps.
- Unknown or malformed intended unit input is surfaced as validation, not silently reclassified as text in editable numeric cells.
- R1 has no conversion picker or unit-management UI; those remain V2-U.

### 2.4 Equation behavior

- Inserting an equation creates `{ mode: 'static', tex: '' }` and focuses the TeX editor.
- Static TeX: `Ctrl/Cmd+Enter` commits, Escape cancels, invalid TeX remains editable with a visible error and last valid preview.
- Binding clears static TeX only after the user selects a valid published name. Switching back to static seeds the editor with the last successfully rendered TeX.
- `result` works for any displayable target. `symbolic`, `substituted`, and `steps` are disabled when the resolved source has no formula.
- A deleted target renders `#REF!` plus Rebind/Remove actions; it never crashes. Undo heals the existing binding because the `NodeId` is restored.
- The TeX printer covers arithmetic, comparisons, calls, local A1/ranges, published names, units, typed values, and errors with precedence-aware parentheses. Unsupported AST nodes fall back to escaped canonical formula text.
- Structured derivation data feeds both text and TeX printers; never parse flattened show-steps strings back into math.
- KaTeX renders with an accessible MathML representation. Long equations/steps scroll inside the block without widening the page.

### 2.5 Canvas, list, trash, and error navigation

- Block chrome appears on hover, focus-within, node selection, and keyboard navigation; touch layouts keep the menu visible.
- Block removal has one structural owner: flush editor content, commit `blockOp remove`, then render from graph. It must not also trigger a second reconcile removal.
- Removal is immediate and undoable; announce it and focus the next block, then previous block, then end insertion slot.
- Workbook-origin error navigation opens the drawer, waits for readiness, activates `cellRef.sheetId`, selects/scrolls/focuses `a1`, applies a temporary dependency ring, and returns focus to the originating pill when the drawer closes. Canvas block errors continue to focus `blockId`. Missing cells/tabs open surviving parameter detail.
- List defaults to Live and `Edited ↓`. Search is trimmed, case-insensitive title substring. Deterministic ties use title, then document ID. Select all means visible filtered rows only; selection clears on search/view change.
- Move to trash is recoverable and needs no modal confirmation. Delete forever and Empty trash use accessible confirmation dialogs with focus trap and return.
- Direct navigation distinguishes live, trashed, missing, unauthorized, and integrity-failed. A trashed document shows a tombstone with Restore/Back and never mounts editor/workbook.
- Days left is `max(0, ceil((deletedAt + 30d - now) / 24h))`; the purge boundary is strictly older than the UTC cutoff.

### 2.6 Responsive and accessibility contract

Desktop (`> 800px`):

- Report scroll area, 320 px docked Parameters rail, and 45dvh bottom workbook participate in layout.
- Opening rail/drawer never obscures report content.

Narrow (`<= 800px`, tested at `390×844` and `768×1024`):

- Header becomes two rows: Back, title, and save state first; secondary actions in an accessible More menu.
- Parameters becomes a full-height modal dialog with visible Close, focus trap, Escape, and focus/caret restoration. Grid selection updates pending detail but does not auto-open it.
- Workbook becomes a full-screen workspace below the compact header with `Back to report`. Formula line and grid scroll internally; body never scrolls horizontally.
- Tab targets and block actions are at least 44×44 px. No required action depends on hover, double-click, or right-click.
- Document rows stack; the bulk bar remains above the safe-area inset.

Accessibility:

- Tabs use `tablist`, `tab`, `tabpanel`, `aria-selected`, labelled panel, and roving tabindex.
- Loading regions use `aria-busy`; save/recompute use polite live regions; blocking load/save errors use `role=alert`.
- Parameter input uses a native textbox with `aria-invalid`, `aria-describedby`, and live validation. Do not nest buttons inside a button-like chip.
- Desktop rail is a labelled `aside`; narrow rail is a modal `dialog`. Only one representation is exposed to assistive technology.
- KaTeX exposes one math representation to assistive technology and hides duplicate visual markup.
- All icon-only actions have accessible names; destructive meaning is not color-only; visible `:focus-visible` styling remains.

### 2.7 Demo script

Open `Steel beam check`.

1. Report shows intro prose, Inputs with editable `Fy = 50 ksi`, `d = 20 in`, `tw = 2 in`, `bf = 14.5 in`, `tf = 0.5 in`, a bound area equation, and Results with `A = 38.00 in²` and `rt = 2.115 in`.
2. Drawer contains `Input`, `Calculation`, and `Output` tabs. Calculation formulas refer across tabs through published names.
3. Edit `d` in the report: source cell repaints, equation re-substitutes, outputs announce/flash and settle.
4. Edit a workbook input: report projections update.
5. Break a formula: error pill deep-links to the exact workbook cell; fix it.
6. Rename a published name: existing pill/equation bindings survive.
7. Add/rename/delete a tab and undo/redo it from either surface.
8. Reload: graph, manifest, defined names, values, hashes, and snapshot revision match with zero integrity errors.
9. Trash and restore the document.

### Explicitly out of R1

- 3D viewer; charts; PDF export; templates/resource tree; drag sliders.
- `Sheet!A1` parsing and structural row/column reference remapping.
- Offline reload cache or collaborative editing.
- Full account settings, teams, sharing, invitations, and document ACLs. Minimal identity/ownership required to protect production data is in R1-0 and its production verification is in R1-7.
- Unit picker/conversion UI beyond authored display units.

---

## 3. Architecture and data flow

### 3.1 Ownership boundaries

| State | Authoritative owner | Projection/consumer |
|---|---|---|
| Typed values, formulas, dependencies, names | `DocumentGraph` | Workbook cells, pills, equations, rail |
| Report block order/payload | `DocumentGraph` | TipTap |
| Workbook tab ID/name/order | `DocumentGraph.workbook` manifest | Univer workbook tabs |
| Cell address | `CellRef { sheetId, a1 }` | Explicit `FWorksheet` range |
| Workbook visual state | Univer snapshot | Adapter only |
| Active tab | Snapshot | Custom tab strip |
| Drawer/rail open state | Document-scoped local storage | Route shell |
| Save revision/hash | Convex document + snapshot rows | Persistence client |

`GraphNode.blockId` continues to mean a report block host. Workbook cells and published aliases normally omit it. `cellRef.sheetId` is their workbook location.

### 3.2 Core types

```ts
type NodeId = string;
type BlockId = string;
type SheetId = string;

type CellRef = {
  sheetId: SheetId;
  a1: string;
};

type SheetMeta = {
  id: SheetId;
  name: string;
  position: number;
};

type WorkbookManifest = {
  sheets: SheetMeta[]; // non-empty; positions are 0..n-1
};

type SheetProjection = {
  version: 1;
  sheetId: SheetId;
  wasActive: boolean;
  snapshot: unknown; // validated, formula-demoted Univer data for this tab only
};

type EquationPayload =
  | {
      mode: 'bound';
      nodeId: NodeId;
      display: 'symbolic' | 'substituted' | 'result' | 'steps';
    }
  | {
      mode: 'static';
      tex: string;
    };
```

`SheetId` and `BlockId` must be separate types throughout the engine, adapter, persistence wire shapes, fixtures, Convex validators, and generated types. Avoid `string`-only callback signatures where a sheet context is required.

### 3.3 Workbook mutations and undo

Add public graph mutations:

```ts
type WorkbookMutation =
  | { op: 'workbookOp'; action: 'add'; sheet: SheetMeta; activate: boolean }
  | { op: 'workbookOp'; action: 'rename'; sheetId: SheetId; name: string }
  | { op: 'workbookOp'; action: 'remove'; sheetId: SheetId; projection: SheetProjection }
  | { op: 'renameName'; nodeId: NodeId; name: string };
```

- Add/rename/remove validates before changing state and creates exactly one history entry.
- `remove` rejects the last tab. The adapter captures a bounded, validated `SheetProjection` before commit. The inverse records the original `SheetMeta`, projection, removed cell/alias nodes, and original active sheet.
- Removal deletes cells and published aliases hosted by the tab, then recalculates surviving dependents into the engine’s existing error semantics. Chip/equation bindings remain and safely dangle.
- Undo restores identical sheet/node/alias IDs and projection; redo removes them again.
- `renameName` validates uniqueness/name grammar, rewrites dependent AST name refs atomically, preserves the alias `NodeId`, and detects cycles before commit.
- Univer mirrors only successful graph mutations. UI must never mutate a tab/name in Univer first and hope to reconcile afterward.

### 3.4 Multi-tab adapter

`attachWorkbookAdapter({ session, docId, container, snapshotStore })` owns one Univer instance and instance-scoped snapshot state.

- Extract `GraphSession` from the Univer adapter into an engine/application module because workbook, pills, equations, rail, and global undo all consume it.
- Delete the module-global `sheetStore`; navigation/tests must not share stale workbook state.
- Use Univer’s actual worksheet ID as `SheetId`. Do not invent a parallel map.
- Every read, write, selection, edit event, repaint, defined-name target, and test driver carries `{ sheetId, a1 }`.
- Capture Univer event `subUnitId` at event time. Never consult `getActiveSheet()` later in a microtask.
- Resolve ranges with `workbook.getSheetBySheetId(sheetId).getRange(a1)`.
- Formula/view writes continue clearing Univer `f`, so the workbook snapshot contains no authoritative formulas.
- Preset config: `header: false`, `toolbar: false`, `footer: false`, `formulaBar: false`, `contextMenu: false`. Direct cell edit, selection, copy/paste, cell styling, row height, and column width remain; all address-changing structural commands are absent.
- Custom formula line reads the selected graph node. It shows canonical `=formula` for computed cells and formatted authored value for inputs; commit enters the same adapter classification/write path as direct cell editing.

Defined names:

- Parse targets as sheet-aware refs instead of dropping the sheet qualifier.
- Resolve sheet display name to stable worksheet ID at ingestion.
- `DefinedNameBook` stores `CellRef`, not bare A1.
- Bootstrap it from all restored workbook defined names before installing listeners.
- Published names are unique workbook-wide and follow the existing dotted-name grammar.

### 3.5 Data-flow sequence

```text
User edit (pill, formula line, or cell)
  -> validate/classify authored text
  -> GraphSession.commit(mutation)
  -> recalc affected nodes
  -> settle event with affected NodeIds
  -> explicit-sheet adapter repaint + pill/equation/rail repaint
  -> saver captures immutable graph + manifest + snapshot bundle
  -> documents.save(expectedRevision, bundle)
  -> atomic Convex commit returns next revision/hash
```

Edits arriving while a save is in flight mark a new dirty generation and schedule a second immutable bundle after the first succeeds. A late response can acknowledge only the generation it captured.

---

## 4. Persistence, schema, integrity, and lifecycle

### 4.1 Engine and wire schema

| Area | Authoritative change |
|---|---|
| `BlockType` | Remove `sheet`; activate `equation`. Final R1 union: `text | heading | image | equation`. `viewer` stays reserved for V2, not accepted in R1 persistence. |
| `Block` | Remove `univerSnapshot`; add required discriminated `equation` payload only when `type === 'equation'`. |
| `CellRef` | Rename validated field `sheetBlockId` to `sheetId`; change its type from `BlockId` to `SheetId`. |
| Graph node host | `blockId` remains report ownership; workbook nodes use `cellRef`. |
| Document graph | Add non-empty `workbook: WorkbookManifest`. |
| Mutations | Add `workbookOp` and `renameName`. |
| Documents | Add `ownerId`, `revision`, `deletedAt?`, and `stats`. |
| Snapshot | Replace per-block `sheetSnapshots` with one doc-keyed `workbookSnapshots` row. |

The current Convex schema explicitly enumerates `cellRef.sheetBlockId`; this rename is not transparent. Update `src/convex/schema.ts`, payload validators, codecs, serializers, fixtures, generated types, and tests together.

### 4.2 Convex schema

```ts
documents: {
  ownerId: string,
  title: string,
  blocksOrder: string[],
  undoCursor: number,
  revision: number,
  bundleHash: string,
  deletedAt?: number,
  stats: { blocks: number, tabs: number, nodes: number, bytes: number },
  createdAt: number,
  updatedAt: number
}

workbookSnapshots: {
  docId: Id<'documents'>,
  revision: number,
  snapshotHash: string,
  snapshot: unknown,
  updatedAt: number
}
```

Indexes:

- `documents.by_owner_deleted_updated` for live/trash list pagination.
- `documents.by_deleted_at` for retention.
- Existing child `by_doc` and undo `by_doc_seq`.
- `workbookSnapshots.by_doc` with an enforced one-row invariant.
- `assets.by_owner_doc`, `assets.by_state_updated` for claim/GC.

### 4.3 Atomic revisioned save

Replace parallel `documents.save` and snapshot upserts with one mutation:

```ts
documents.save({
  docId,
  expectedRevision,
  graph,
  workbookSnapshot,
  snapshotHash,
  bundleHash
})
```

The mutation:

1. Authenticates and calls `requireLiveOwnedDocument`.
2. Validates all scalar limits, exact unions, IDs, A1/name/title/tab/TeX syntax, numeric finiteness, collection counts, AST depth/node count, and snapshot shape/size before deleting rows.
3. Validates unique IDs/names/undo sequences; exact `blocksOrder` permutation and positions; non-empty contiguous tab manifest; all cell sheet IDs; chip/equation bindings; defined names; and undo cursor.
4. Rejects unless `document.revision === expectedRevision`.
5. Recomputes/validates canonical byte counts and hashes using the shared pure canonical serializer.
6. Replaces child graph rows, upserts the one snapshot row, derives stats, increments revision, and patches the header inside the same Convex transaction.
7. Prunes undo to the last 200 entries and rebases `undoCursor` by the dropped prefix.

Validation or conflict leaves the prior revision byte-for-byte intact.

Canonicalization and hashes are explicit:

- `canonicalJson` recursively sorts object keys, preserves array order, and rejects cycles, `undefined`, non-finite numbers, unsupported prototypes, and unknown fields.
- `snapshotHash = fastHash(canonicalJson(workbookSnapshot))`.
- `bundleHash = fastHash(canonicalJson({ graph, workbookManifest, snapshotHash }))`.
- `fastHash` is the existing deterministic engine hash, used as a corruption/revision checksum rather than a security signature. Authorization—not the checksum—is the tamper boundary.
- Client and Convex import the same pure canonicalization/hash implementation and the server recomputes both values before writing.

Limits:

- Workbook snapshot row: maximum 750 KiB canonical UTF-8 JSON, leaving headroom below Convex’s 1 MiB document limit.
- Total R1 save bundle: maximum 4 MiB canonical UTF-8 JSON, comfortably below Convex mutation argument limits.
- Title: trimmed, 1–120 characters.
- Tab name: trimmed, 1–64 characters, case-insensitive unique.
- Static TeX: maximum 10,000 characters; AST/derivation budgets are enforced separately.
- Per owner: at most 500 live-plus-trashed documents in R1.
- Per document: at most 32 tabs, 5,000 graph nodes, 1,000 report blocks, 2,000 chip bindings, 2,000 published names, and 200 retained undo entries.
- Per formula/equation: at most 10,000 source characters, 1,000 AST nodes, and nesting depth 64.
- Per removed-tab undo projection: at most 700 KiB canonical UTF-8 JSON; tab deletion is rejected with a clear `Workbook tab is too large to remove safely` error if the inverse cannot fit.
- Per image: at most 10 MiB; accepted MIME types are exactly `image/png`, `image/jpeg`, and `image/webp`.
- Live/trash list queries return at most the owner’s bounded 500 header rows through the owner/deleted index; client filtering therefore covers the complete R1 set. Retention purges 25 documents per mutation and schedules continuation. Abandoned-asset cleanup processes 50 rows per mutation.
- Tests cover one below, exactly at, and one above every byte, count, length, and depth limit.

Stats are server-derived from the validated bundle:

- `blocks`: block row count.
- `tabs`: manifest length.
- `nodes`: node row count.
- `bytes`: UTF-8 bytes of canonical graph plus workbook snapshot.

Create atomically initializes one `Sheet 1` manifest/snapshot at revision 0 and zero-content stats.

### 4.4 Load, integrity, conflict, and offline states

Load returns a typed state: `live | trashed | missing | unauthorized | integrity-error`.

For `live`, require:

- document revision equals workbook snapshot revision;
- `snapshotHash` matches canonical snapshot;
- `bundleHash` matches the canonical persisted bundle;
- every node hash reproduces;
- manifest and snapshot IDs/names/order match;
- defined names and graph aliases agree;
- no workbook cell carries an authoritative formula payload after repaint.

Any mismatch:

- shows a blocking integrity alert with Reload and Back;
- mounts neither editable TipTap nor Univer;
- sends zero saves;
- may offer a dev-only read-only/export recovery path.

Save conflict:

- persistent `Reload required—this document changed elsewhere`;
- stop automatic writes and make the session read-only;
- user may reload or explicitly discard local changes. No automatic merge is promised in single-owner R1.

Offline:

- initial offline/list/load failure shows Retry, not empty/missing;
- if connectivity drops after load, keep edits in memory, show `Offline—changes not saved`, retry on `online` and `Retry now`;
- install `beforeunload` while dirty/error;
- cancel in-app navigation until awaited flush succeeds or the user chooses `Leave without saving`;
- `pagehide` flush is best effort and is never presented as a durability guarantee.

### 4.5 Authorization boundary

R1 production data cannot rely on Vercel deployment protection because Convex endpoints are independently reachable.

- Extend the Better Auth work described in `docs/better-auth-integration-plan.md` with route gating and ownership.
- Add `ownerId` to documents/assets. Every product query/mutation obtains identity and verifies ownership server-side.
- Centralize `requireIdentity`, `requireOwnedDocument`, and `requireLiveOwnedDocument`.
- `/app` and `/app/[docId]` require a server-validated session and redirect signed-out users to `/signin`; the Convex ownership checks remain the authoritative enforcement.
- Document creation stamps `ownerId` from the authenticated identity subject and rejects creation when that owner already has 500 live-plus-trashed documents.
- List queries return only the current owner’s rows. Document IDs are never an authorization mechanism.
- Full sharing/ACLs remain out of scope.
- If this prerequisite is not implemented, R1 may run only as a disposable, non-confidential development demo and must not be promoted as a persistent production app.

### 4.6 Assets, trash, retention, and reset

Assets:

- Add an ownership/claim row: `uploaded -> claimed -> referenced -> pendingDeletion`.
- The row contains `ownerId`, optional `docId`, optional `storageId`, state, MIME, byte size, `createdAt`, `updatedAt`, delete-attempt count, and last-error code. Upload URL generation first creates the `uploaded` row/token; claim attaches the returned storage ID only after metadata validation.
- Upload URL requires identity. Claim checks storage metadata, the 10 MiB limit, exact PNG/JPEG/WebP MIME allowlist, owner/document match, and rejects SVG/HTML.
- Unclaimed uploads expire through bounded cleanup.
- Save-time reachability includes current image blocks and retained undo inverses.
- Purge writes durable pending-deletion state before storage deletion. Transient failures retain retry metadata.

Trash:

- Soft delete sets `deletedAt`, increments revision, and keeps all content.
- Every content write requires a live document; a stale open editor cannot write into trash.
- Restore clears `deletedAt`, increments revision, and returns intact graph/workbook/history/assets.
- Purge rechecks owner, deleted state, and cutoff, then removes graph rows, workbook snapshot, assets/current and undo-only storage IDs, and document.
- A daily 03:00 UTC cron queries `by_deleted_at`, processes 25 idempotent rows per mutation, and continues via scheduled work.
- Empty trash reuses the same bounded purge primitive.

Development reset:

- Internal-only, temporary, dev/test-only command; production always refuses.
- Requires deployment-specific confirmation token, dry-run counts, maintenance lock checked by all product mutations, and irreversible backup acknowledgement.
- Exact allowlist includes product documents, graph rows, blocks, chips, undo, old/new snapshots, and product assets.
- Explicitly excludes waitlist, Resend, Better Auth/component tables, and other non-product data.
- Verify zero target rows afterward; never invoke from browser code or CI.

---

## 5. Workstreams

### R1-0 · Typed workbook contract + atomic persistence + minimal ownership — size L

This is a prerequisite, not optional infrastructure cleanup.

Implementation:

1. Add `SheetId`, `WorkbookManifest`, `EquationPayload`, `workbookOp`, `renameName`, and `resolvePublishedTarget`.
2. Make sheet tab identity separate from report block ownership; remove all cell-node `blockId` assumptions.
3. Update Convex schema/validators/generated types and add revision/hash/stats/ownership.
4. Implement one immutable, atomic save bundle with CAS and fail-closed load.
5. Add minimal identity, ownership, and route gating using the auth integration prerequisite.
6. Replace module-global snapshot state with adapter-instance state.
7. Add dev reset only after all new/old product tables are listed.

Primary touchpoints:

- `src/lib/engine/types.ts`, `node.ts`, `graph.ts`, `mutations.ts`, tests.
- `src/lib/persistence/codec.ts`, `serialize.ts`, `saver.ts`, `client.ts`, fixtures and reproducibility tests.
- `src/convex/schema.ts`, `documents.ts`, `sheets.ts -> workbook.ts`, `files.ts`, `crons.ts`, generated files.
- `src/routes/app/[docId]/+page.svelte`, route gating/auth helpers.

Acceptance:

- Tab mutations round-trip through undo/redo with identical IDs.
- Published rename preserves binding IDs.
- Save failure/conflict never exposes mixed graph/workbook revisions.
- Corrupt load is read-only and sends zero writes.
- Unauthenticated, foreign-owner, trashed, and stale-revision writes fail.
- Payload boundaries and undo-cursor pruning are covered.

### R1-1 · Multi-tab adapter + workbook drawer — size L

Implementation:

1. Rename/rework `attachSheetAdapter` to one `attachWorkbookAdapter`.
2. Replace active-sheet APIs with explicit worksheet lookup for reads, writes, selection, edit classification, repaint, and test controls.
3. Capture event-time sheet ID before queued processing.
4. Make defined-name parsing/hydration sheet-aware.
5. Disable preset formula bar and unsafe row/column commands; add custom graph-backed formula line.
6. Build `WorkbookDrawer.svelte` and keep `/app/[docId]/+page.svelte` as session/orchestration rather than growing the current 773-line route.
7. Port existing sheet-block tests to one-workbook fixtures; remove sheet node/block code only after parity passes.

Primary touchpoints:

- `src/lib/adapters/univer/adapter.ts`, `univer-api.ts`, `cell-text.ts`, `graph-sync.ts`, `sheet-store.ts`.
- `src/lib/editor/sheet-node.ts` and tests (removed), `create-editor.ts`, `blocks.ts`, `sync.ts`, `insert-slots.ts`.
- New `src/routes/app/[docId]/WorkbookDrawer.svelte`.
- `e2e/adapter-univer.spec.ts`, `canvas-sheets.spec.ts`.

Acceptance:

- Edit tab B while tab A is active; only `{B, a1}` changes.
- Switch tabs before queued edit processing; captured sheet ID still wins.
- Settle repaints non-active tabs.
- Reload then rename/delete a defined name on a non-active tab.
- Formula line shows the graph formula after edit, settle, switch, and reload; snapshot has no formulas.
- Add/rename/delete each creates one undo entry; last tab cannot be deleted.
- Collapsed eager boot expands to correctly measured grid; close/reopen does not remount.
- Canvas is interactive before a deliberately delayed workbook boot.

### R1-2 · Parameters, editable pills, rail, and units — size M/L

Implementation:

1. Add the one-hop published-target resolver and use it in chips, rail, equations, inspector, and show-steps.
2. Add strict authored numeric/quantity parsing and minimal imperial registry.
3. Replace bare magnitude rendering with the shared display formatter everywhere.
4. Extend chip NodeView with native input editing and accessible errors.
5. Extract `ParametersRail.svelte`; fold current inspector view-model into detail.
6. Preserve/restore prose selection for insertion and focus.

Primary touchpoints:

- `src/lib/engine/units.ts`, formula/evaluate/registry tests.
- `src/lib/adapters/univer/graph-sync.ts`, `cell-text.ts`.
- `src/lib/editor/chips.ts`, `chip-node.ts`, `chip-picker.ts`, `inspector.ts`, `create-editor.ts`.
- New `src/routes/app/[docId]/ParametersRail.svelte`.

Acceptance:

- Published input alias appears under Inputs and commits to its source input node.
- Published computed alias remains read-only.
- `20 in`, `50 ksi`, and `38 in²` round-trip with SI storage and authored display.
- Unitless `21` inherits `in`; incompatible/unknown input stays editing and adds no undo/save.
- Pill edit repaints cell/equation/output and undo/redo is one action.
- Rail insertion requires a valid report caret; duplicate insertions get fresh chip IDs.
- Keyboard, pointer, narrow modal, and reduced-motion paths pass.

### R1-3 · Equation blocks and safe KaTeX rendering — size M/L

Implementation:

1. Add structured math-expression/derivation representation and pure TeX printers.
2. Activate equation block with exact discriminated payload in engine, editor, codec, Convex, fixtures, and sync.
3. Build atom NodeView for static/bound modes and display controls.
4. Install latest stable KaTeX at implementation time (research baseline: `0.18.1`) with self-hosted CSS/fonts and lazy document-route import.
5. Use `katex.render()` into an owned element, never Svelte `{@html}`.
6. Configure `trust: false`, `throwOnError: false`, `strict: 'warn'`, `maxSize: 100`, `maxExpand: 1000`, `output: 'htmlAndMathml'`, and a new empty macros object per render. User-defined macros are out of R1. Render errors as plain text.
7. Bound view unwraps one published alias and survives delete/undo.

Primary touchpoints:

- `src/lib/engine/formula.ts`, `showsteps.ts`, new printer module and tests.
- `src/lib/engine/block.ts`, persistence codecs/validators.
- New `src/lib/editor/equation-node.ts`; `create-editor.ts`, `blocks.ts`, `sync.ts`, `insert-slots.ts`.

Acceptance:

- Static TeX round-trips exact source.
- Bound symbolic/substituted/result/steps update live and disable unsupported modes.
- Operator precedence and unit rendering match the formula corpus.
- Deleted target renders safely and undo heals.
- Malicious links/images/HTML commands, malformed Unicode, nested macros/groups, and oversize TeX cause no script/network request/crash and remain responsive.
- KaTeX output has one accessible math representation.

### R1-4 · Canvas chrome and route decomposition — size M

Implementation:

- Add uniform block decorations/type labels/menu for text, heading, image, and equation.
- Expose Move up, Move down, and Remove through keyboard/touch-safe controls.
- Keep one structural removal owner and deterministic post-action focus.
- Extract workbook, parameters, title/save header, and list/trash components so the route coordinates lifecycle rather than implementing every UI.
- Update managed top-level block types after removing sheets and adding equations.

Acceptance:

- Hover/focus/touch reveals an operable menu.
- Remove/move each creates one undoable action and announces result.
- Focus lands predictably after remove and undo restores payload/binding.
- No required control depends on hover at narrow viewports.

### R1-5 · Document header and list — size M

Implementation:

- In-document title edit with trim, 1–120 chars, Enter commit, Escape cancel, valid blur commit, and `<title>` update. Duplicate titles are allowed.
- Owner/deleted-indexed Live/Trash queries return the complete bounded set of at most 500 headers; client-side title filtering and deterministic sort therefore never search a partial page.
- Stats line from server-derived stats.
- Visible-filter selection, bulk trash, count toast, accessible no-results/Clear state.
- Narrow stacked rows and safe-area-aware bulk bar.

Acceptance:

- Sort ties are deterministic.
- Search is case-insensitive and selection rules hold across filter/view changes.
- Rename validation is accessible and list/head update after save.
- Stats match canonical bundle after workbook/report edits and reload.

### R1-6 · Trash, retention, and asset deletion — size M

Implementation:

- Soft-delete/listTrash/restore/purge/emptyTrash with live-document guards.
- Tombstone route for trashed docs.
- Bounded `by_deleted_at` cron with retry/continuation.
- Asset claim/reachability/pending-deletion lifecycle, including undo-only refs and abandoned uploads.
- Shared e2e purge helper to prevent leaked documents.

Acceptance:

- Trash/restore preserves graph, workbook, history, names, and assets.
- Stale open editor cannot save into trash.
- 29-day/30-day boundary and restore-vs-purge race are deterministic.
- Purge and Empty trash are idempotent and accessible.
- Storage deletion failure retains retry state; foreign/forged/unsupported/oversized assets fail.

### R1-7 · Production deployment and seeded demo — size M, credentials required

Implementation:

1. Replace `adapter-auto` with the latest stable `@sveltejs/adapter-vercel` and configure it in the existing `vite.config.ts` SvelteKit adapter hook (research baseline: `6.3.4`; do not use a prerelease).
2. Use separate production Convex deployment; the current live Vercel project must stop pointing at development Convex.
3. Complete minimal auth/ownership gate from R1-0 before enabling persistence.
4. Set production-only secrets in Convex/Vercel; only public site/Convex URLs enter client bundles.
5. Add protected/manual production workflow: frozen lockfile, check, unit, build, Convex tests, e2e, audit, secret scan, deploy.
6. Add `Load demo` that creates the verified steel fixture through the normal owned create/save path.
7. Add/enforce security headers and CSP after report-only validation. Self-host existing Google fonts before `font-src 'self'`.

User-provided inputs:

- Convex production deploy key, production deployment URL, Better Auth secret/provider credentials, production site URL.
- Resend production API key/webhook secret if magic-link/email flows ship.
- Vercel project/team access and confirmation of protected production environment.

Secret rules:

- `CONVEX_DEPLOY_KEY` only in protected CI production environment; never public/runtime client vars or fork-PR jobs.
- Auth, OAuth, Resend, and webhook secrets remain server/Convex-only.
- Never log document payloads, formulas, TeX, snapshots, signed storage URLs, or tokens.

Acceptance:

- Unauthenticated/cross-owner endpoint matrix fails.
- Production Vercel uses production Convex.
- CSP has no required-resource violations and includes `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `form-action 'self'`, `nosniff`, restrictive Permissions Policy, and Referrer Policy.
- Dependency audit blocks high/critical findings; the known low transitive `cookie@0.6.0` advisory is recorded until upstream resolution.
- Seeded demo executes §2.7 on a production build.

### R1-8 · Documentation and memory — size S, last

Update:

- `IMPLEMENTATION_PLAN.md`: completed R1 workstreams and verification evidence.
- `ARCHITECTURE.md`: CalcTree rationale, ownership table, workbook adapter lifecycle, session data flow, layout tree, single-boot and bundle measurements.
- `SCHEMA.md`: types, mutations, persistence, ownership, trash/assets, limits.
- Adapter/editor/persistence READMEs and public-method documentation.
- Memory: “Univer is the document workbook and a projection of the graph.”
- Compound the solved migration/atomic-save/adapter lessons in the project’s normal documentation location.

---

## 6. Sequencing and implementation checkpoints

```text
R1-0 typed contract + atomic persistence + ownership
  -> R1-1 multi-tab adapter + drawer
    -> R1-2 parameters + units
      -> R1-3 equations
        -> R1-4 chrome/decomposition

R1-0 -> R1-5 list/header -> R1-6 trash/assets

R1-1..6 -> R1-7 production/demo -> R1-8 docs
```

### Checkpoint A — contract and persistence

- Land engine/wire/Convex type changes together.
- Seed/reset development data only after dry-run verification.
- Gate: fixtures hydrate, reproduce hashes, and save atomically with one default tab.

### Checkpoint B — workbook parity

- Multi-tab adapter passes explicit-sheet unit/integration tests before removing sheet blocks.
- Port existing adapter e2e hooks to drawer, then delete sheet NodeView/per-block snapshot code.
- Gate: one boot, correct non-active-tab edits/repaint, name reload, tab undo.

### Checkpoint C — report bridge

- Parameter resolver/units/formatter before editable pills.
- Structured derivation/TeX printer before equation NodeView.
- Gate: full beam propagation in both directions and safe error deep-link.

### Checkpoint D — product lifecycle

- List/header and trash/assets can proceed after R1-0.
- Gate: stale/trashed/conflict/offline/retention flows.

### Checkpoint E — production

- Minimal ownership, production Convex, CSP, CI, audit, performance, and full demo.
- Documentation records actual measurements and final schema.

---

## 7. Executable acceptance matrix

1. **Canvas before workbook:** delay workbook boot 5 s; report becomes editable in <1 s, toggle says Loading, opening shows `aria-busy`, boot completes once, reload restores doc-scoped drawer state.
2. **Workbook failure/retry:** first attach rejects; report stays editable; alert/Retry succeeds without losing edits or duplicating listeners.
3. **Explicit sheet context:** edit non-active B while A is active and switch tabs before queued processing; only B changes. Settle repaints a non-active dependent.
4. **Tab identity/undo:** add, rename, validate blank/duplicate/65-char, reload same ID, delete referenced tab, show safe errors, undo/redo exact ID/data/names/bindings, last-tab delete disabled.
5. **Cross-tab names:** Input drives Calculation/Output by published names; tab display rename does not alter formulas/values; `Sheet!A1` is rejected/deferred clearly.
6. **Defined names:** restore snapshot, rename/remove a name on a non-active tab; name book is pre-hydrated and alias `NodeId` survives rename.
7. **Formula line:** selected computed cell shows canonical graph formula after settle/reload; commit follows graph path; snapshots contain no formulas; structural row/column commands unavailable.
8. **Published input alias:** rail classifies named alias by source kind; pill edit targets source; equation/output update; one undo/redo action.
9. **Pill validation:** incompatible/unknown unit, formula, empty, NaN/infinity do not mutate/save/history; Escape restores; zero/negative commit; bare numeric inherits display unit.
10. **Unit round-trip:** `20 in`, `50 ksi`, and area output serialize canonical SI and render chosen unit across every surface.
11. **Error deep-link:** error pill opens exact tab/cell after delayed boot; closing returns focus. Missing tab/cell falls back to surviving detail.
12. **Rail insertion/detail:** valid prose caret inserts fresh chips and restores caret; no caret disables insert; Alt+Enter detail focus/return works; narrow selection does not auto-cover grid.
13. **Equations:** static exact round-trip; bound four modes update; unsupported modes disabled; delete target safe/healable; invalid/malicious/oversize TeX safe.
14. **Block chrome:** keyboard/touch move/remove, live announcement, deterministic focus, undo restoration, no duplicate mutation.
15. **Desktop/narrow layout:** 1440×900 no overlap and last block remains scrollable; 390×844/768×1024 have zero body overflow, modal Parameters, full-screen Workbook, focus restoration, 44 px targets.
16. **List/search/sort/select:** deterministic ties, case-insensitive search, Clear state, visible-only select-all, selection clearing, bulk-trash counts.
17. **Rename/stats:** validation/Enter/Escape/blur and `<title>` work; server stats match canonical bytes/content after reload.
18. **Trash lifecycle:** live/trashed/missing direct routes, restore intact, accessible permanent confirmations, exact cutoff, purge race, idempotent empty.
19. **Asset lifecycle:** foreign/forged/unsupported/oversized reject; abandoned cleanup; undo-only reference retained; purge retry after storage failure.
20. **Save/offline/navigation:** labelled pending/saving/saved/error states; dirty offline banner; guarded navigation; reconnect retry; initial offline Retry.
21. **Conflict/integrity:** stale revision cannot overwrite; corrupt hash/revision mounts no editor/workbook and sends zero save; recovery works.
22. **Authorization:** unauthenticated and owner B cannot list/load/mutate/purge owner A’s data or attach owner A’s asset.
23. **Reset:** bad token, production, and concurrent writer refuse; dry-run is no-op; excluded tables preserved; second execution idempotent.
24. **Accessibility:** keyboard-only complete demo, axe pass on live/trash/editor desktop/narrow, visible focus, save/error announcements, reduced-motion behavior.
25. **Reproducibility:** graph hashes, manifest/snapshot alignment, defined names, formula demotion, immediate re-save stability, and fixture workbook shape all pass.

---

## 8. Verification and release gates

Required commands:

1. `pnpm install --frozen-lockfile`
2. `pnpm check` — 0 errors, 0 warnings.
3. `pnpm test` — engine, adapter, persistence, Convex, security, and limit suites.
4. `pnpm build` — real Vercel adapter.
5. `pnpm test:e2e` — production build/preview, including desktop and narrow projects.
6. `pnpm audit --prod` — no high or critical advisories; record accepted lower findings.
7. Boundary check: `@univerjs` imports only under `src/lib/adapters/univer/`.

Quality gates:

- Public methods/types are documented.
- TypeScript uses exhaustive discriminated unions; no new `any` at engine/persistence boundaries.
- Every async listener has teardown and every queued edit owns an immutable event-time sheet/ref.
- Exactly one Univer instance/listener set per loaded document.
- No graph/workbook split revision is observable.
- No save occurs for unauthorized, trashed, stale, or integrity-failed sessions.
- Demo bundle stays within byte/count budgets.
- On the documented release device and production build: canvas interactive p95 <1 s; cold workbook-ready p95 <5 s; drawer reopen/reflow p95 <100 ms; 500-node engine recompute <50 ms in its unit benchmark; demo pill-edit-to-settled-paint p95 <100 ms.
- On the production deployment from the documented test region: demo save p95 <1.5 s; maximum-budget save p95 <3 s; complete 500-document header-list query p95 <500 ms.
- Demo equation render p95 <50 ms; a valid or invalid maximum-budget TeX render returns control in <250 ms without a long task over 250 ms.
- Measure drawer boot, reopen/reflow, bundle bytes, save/list latency, TeX render worst-case, and memory before release. Record p50/p95 over 20 cold and 50 warm samples on a documented device/build; do not gate on one warm run.
- Production build completes the §2.7 demo with zero console errors, integrity mismatches, CSP violations, or leaked test documents.

### Deployment go/no-go

Go only if:

- production secrets and separate Convex deployment are confirmed;
- minimal identity/ownership negative tests pass;
- reset refuses production;
- asset purge retry is durable;
- rollback is documented as redeploy previous Vercel build plus forward-compatible Convex schema (never restore dev snapshot into production);
- an on-demand Convex production backup/export has completed and its backup identifier is recorded before the first irreversible production purge. Reset remains production-disabled.

---

## 9. Risks and mitigations

| Risk | Mitigation/gate |
|---|---|
| Univer boot cost | Canvas-first hydration, one eager boot, isolated Retry, measure collapsed reflow. |
| Active-tab race | Event-time `SheetId`; explicit worksheet for all operations; race tests. |
| Tab deletion corrupts graph | Typed manifest + one undoable `workbookOp`; validate/capture inverse before commit. |
| Formula bar lies | Disable preset bar; graph-backed line; assert snapshots contain no formulas. |
| Row/column changes stale A1 refs | Disable structural commands in R1. |
| Published alias breaks editability | Shared one-hop resolver; alias identity/source behavior tests. |
| Rename breaks bindings | In-place `renameName` preserving `NodeId`. |
| Imperial demo cannot parse/render | Minimal imperial registry, strict quantity parser, shared formatter, round-trip tests. |
| Graph/snapshot split-brain | One revisioned Convex transaction, CAS, fail-closed load. |
| Save race loses edits | Immutable generations, queued follow-up save, conflict/read-only behavior, navigation guard. |
| Snapshot exceeds Convex row | 750 KiB server/client cap and boundary tests; do not silently truncate. |
| TeX injection/DoS | `katex.render`, trust off, complexity/length limits, safe errors, malicious corpus, CSP. |
| Public Convex API exposes data | Minimal identity/owner checks before production; otherwise dev-only demo. |
| Purge deletes undoable asset | Reachability includes retained undo; durable pending-deletion retries. |
| Reset deletes non-product data | Internal dev/test allowlist, dry-run, lock, confirmation, post-check, production refusal. |
| Route becomes a god component | Extract drawer, rail, header/status, list/trash; route owns lifecycle only. |
| Hover-only UI fails touch/keyboard | Focus/touch-visible chrome, semantic controls, narrow acceptance, axe/keyboard pass. |
| Full-save performance degrades | Explicit bundle budgets/telemetry; optimize only after measured p95 warrants it. |

---

## 10. File-level change map

| Area | Expected files |
|---|---|
| Engine types/state | `src/lib/engine/types.ts`, `node.ts`, `graph.ts`, `block.ts`, `mutations.ts` and tests |
| Formula/units/steps | `formula.ts`, `units.ts`, `showsteps.ts`, formatter/printer modules and tests |
| Univer adapter | `adapter.ts`, `univer-api.ts`, `cell-text.ts`, `graph-sync.ts`, `index.ts`; remove/replace `sheet-store.ts` |
| Editor | `blocks.ts`, `sync.ts`, `create-editor.ts`, `insert-slots.ts`, `chips.ts`, `chip-node.ts`, `inspector.ts`; remove `sheet-node.ts`; add `equation-node.ts` |
| Route UI | `/app/[docId]/+page.svelte`; new `WorkbookDrawer.svelte`, `ParametersRail.svelte`, header/status components; `/app/+page.svelte` list/trash components |
| Persistence | `codec.ts`, `serialize.ts`, `saver.ts`, `client.ts`, `svelte.ts`, fixtures and reproducibility tests |
| Convex | `schema.ts`, `documents.ts`, `sheets.ts -> workbook.ts`, `files.ts`, `crons.ts`, auth/ownership helpers, generated types |
| Deployment | `vite.config.ts`, Vercel/CI configuration, environment docs, `src/app.html` font/CSP work |
| E2E | Port existing adapter/canvas suites; add workbook, parameters, equation, list/trash, save/conflict, auth, responsive, and accessibility flows |
| Documentation | `SCHEMA.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, adapter/editor/persistence READMEs, compounded solution |

---

## 11. Documentation notes for implementation

- Keep package versions on latest stable releases at implementation time and pin infrastructure-sensitive packages consistently with the monorepo policy. Do not select alpha/insider Univer builds.
- Update generated Convex types only through the normal codegen workflow.
- Reset is the migration strategy only for development data. Production schema changes after R1 begins storing real data require a forward migration plan.

---

## 12. Primary references

- Univer sheet facade and stable sheet IDs: [Sheets API](https://docs.univer.ai/guides/sheets/features/core/sheets-api)
- Univer defined names: [Defined names](https://docs.univer.ai/guides/sheets/features/core/defined-names)
- Univer preset configuration: [Sheets core](https://docs.univer.ai/guides/sheets/features/core)
- TipTap custom atom/UI behavior: [Node views](https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views)
- KaTeX rendering and options: [API](https://katex.org/docs/api), [Options](https://katex.org/docs/options)
- KaTeX trust/security and errors: [Security](https://katex.org/docs/security), [Error handling](https://katex.org/docs/error)
- Convex transactional behavior: [Optimistic concurrency control](https://docs.convex.dev/database/advanced/occ)
- Convex indexes and query performance: [Database indexes](https://docs.convex.dev/database/reading-data/indexes/)
- Convex limits: [Limits](https://docs.convex.dev/production/state/limits)
- Convex scheduled retention work: [Scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions)
- WAI-ARIA tabs: [Tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
- WAI-ARIA keyboard/focus patterns: [ARIA Authoring Practices patterns](https://www.w3.org/WAI/ARIA/apg/patterns/)
- Vercel SvelteKit deployment: [SvelteKit on Vercel](https://vercel.com/docs/frameworks/full-stack/sveltekit)

---

## 13. Execution readiness

- No product or architecture decision remains open in the implemented local
  release.
- The feature branch is runnable with the README setup and its seeded steel
  fixture.
- The reset authority, allowlist, lock, staged deletion, and zero-row unlock
  are implemented and tested. Running a destructive reset remains an explicit
  operator action after its dry run and backup acknowledgement.
- Before production enablement, supply the protected-environment credentials,
  confirm the separate production Convex deployment, record the backup ID,
  verify OAuth/Resend callbacks on the production domain, run the workflow, and
  record the production-only latency samples in §8.
