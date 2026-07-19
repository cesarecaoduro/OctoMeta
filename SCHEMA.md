# OctoMeta — SCHEMA.md (v1)
*The complete data model: graph, document, geometry, persistence — and the guarantees that make the experience notebook-like without Jupyter's failure modes.*

---

## 1. Layer map

```
┌──────────────────────────────── PROJECTIONS (read/write via Mutation API only) ─┐
│  Document canvas (TipTap)   Sheet blocks (Univer)   Viewer blocks (Three.js)    │
└───────────────▲──────────────────────▲──────────────────────▲──────────────────┘
                │            GraphMutation (single write path) │
┌───────────────┴──────────────────────┴──────────────────────┴──────────────────┐
│                     DOCUMENT GRAPH (source of truth)                            │
│   nodes · edges(derived) · TypedValue · content hashes · provenance · pending   │
├──────────────────────────────┬──────────────────────────────────────────────────┤
│  Function Registry (shared   │  GeometryStore (owns WASM objects; sweep/GC)     │
│  built-ins + future user fns)│  ├ manifold-3d (preview)  ├ occt-wasm (exact)    │
├──────────────────────────────┴──────────────────────────────────────────────────┤
│                     PERSISTENCE (Convex) · versions · export (PDF / IFC4X3)     │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Typed value system

```ts
type TypedValue =
  | { kind: 'scalar';   value: number }                      // dimensionless
  | { kind: 'quantity'; value: number; unit: Dimension }     // DEFAULT numeric
  | { kind: 'string';   value: string }
  | { kind: 'boolean';  value: boolean }
  | { kind: 'table';    columns: ColumnDef[]; rows: TypedValue[][] }
  | { kind: 'geometry'; handle: GeomHandle }                 // opaque "geom:<op>:<hash>"
  | { kind: 'error';    code: ErrCode; message: string; origin: NodeId };

type Dimension = { L:number; M:number; T:number; I:number; Θ:number; N:number; J:number;
                   display?: string };   // SI exponent vector + preferred display unit
type GeomHandle = `geom:${string}:${string}`;
type ErrCode = '#UNIT!' | '#DIM!' | '#CYCLE!' | '#REF!' | '#NAME?' | '#GEOM!' | '#VALUE!';
```

**Rules.** Quantities are the default numeric type; a bare number is `scalar` only when explicitly dimensionless. Errors are *values* — they flow through edges and render wherever the node projects. Geometry never enters the graph as an object; only the handle string does.

## 3. Graph model

```ts
type NodeId = string;                     // stable ULID, never positional

interface GraphNode {
  id: NodeId;
  kind: 'input' | 'computed' | 'namedOutput' | 'geometry' | 'table' | 'error';
  name?: string;                          // dotted path for published names: "beam.span"
  formula?: FormulaAST;                   // computed/geometry/table cells
  value: TypedValue;                      // last evaluated value (memoized)
  inputs: NodeId[];                       // DERIVED from formula refs — never authored
  contentHash: string;                    // hash(opId + inputHashes) → memo key
  blockId?: BlockId;                      // which document block hosts/renders it
  cellRef?: { sheetBlockId: BlockId; a1: string };  // for Univer-hosted cells
  provenance: Provenance;                 // reserved fields, serialized from day one
  pending?: PendingChange | null;         // reserved for M6 propose→validate→commit
}

interface Provenance {
  authoredBy: 'human' | 'agent' | 'template' | null;
  authorId?: string; authoredAt?: number;
  verifiedBy?: string; verifiedAt?: number;
}
interface PendingChange {
  diffId: string; proposedBy: 'agent' | 'human';
  proposed: Partial<Pick<GraphNode,'formula'|'value'|'name'>>;
  validation: { unit: boolean; type: boolean; geometry: boolean; messages: string[] };
  status: 'proposed' | 'accepted' | 'rejected';
}
```

**Edges are derived.** Resolving a formula's references (cell refs, dotted names) yields `inputs`. This is what makes cycles detectable at mutation time and order irrelevant at evaluation time.

## 4. Recalc algorithm (topological + incremental)

```
onMutation(m):
  affected = mutate(m)                       // returns changed NodeIds
  dirty    = affected ∪ transitiveDescendants(affected)
  order    = kahnTopoSort(subgraph(dirty))   // cycle found here → mark #CYCLE!, stop branch
  for node in order:
      h = hash(node.opId, inputs.map(n => n.contentHash))
      if h == node.contentHash: continue     // memo hit — skip (salsa-style)
      node.value = registry.evaluate(node.formula, inputValues)   // may be Err
      node.contentHash = h
      if node.kind == 'geometry': geomQueue.push(node)
      notifySubscribers(node)                // chips, cells, viewer bindings
  geometryStore.rebuild(geomQueue)           // preview mesh first, exact async
  geometryStore.sweep(liveHandles())         // dispose unreferenced WASM objects
```

**Budgets.** Scalar propagation < 50 ms @ 500 dirty-adjacent nodes; small-edit mesh < 16 ms (preview path); exact B-Rep may complete async and swap in. **No WASM growth over 1,000 recalcs** (sweep is mandatory, not best-effort).

## 5. The Jupyter-like experience — guarantees, not vibes

The document must *feel* like a notebook while being immune to Jupyter's defects. Each guarantee below is enforced by the schema, not by convention:

| Notebook quality we keep | How the schema delivers it |
|---|---|
| **Reading order for humans** | Blocks have a `position` used ONLY for layout. Evaluation ignores it entirely. |
| **Order-independence by construction** | `inputs` derived from references; Kahn topo-sort decides evaluation. Moving a block never changes results. |
| **No hidden state** | There is no interpreter session. All state is graph rows; every value's derivation is its `formula` + `inputs`. |
| **"Restart & run all" is a no-op** | Deterministic replay: re-evaluating the whole graph from inputs reproduces every `contentHash` bit-for-bit. This is our CI reproducibility test. |
| **Delete scrubs, never lingers** | Removing a node deletes its value and converts dependents' refs to `#REF!` immediately (Marimo semantics) — no ghost variables. |
| **Visible inputs and outputs** | Every block renders its bound nodes; value chips expose graph values inline in prose; `show steps` renders substituted derivations. |
| **Stale is impossible, busy is visible** | Between mutation and settle, affected projections show a computing state; there is no state in which a stale value renders as fresh. |
| **Cells are addressable** | Every node has a stable `NodeId` (never positional), so provenance, comments (later), and bindings survive reordering. |

## 6. Function registry (one seam for built-ins and future user code)

```ts
interface FnSignature {
  name: string;                            // 'EXTRUDE'
  params: { name: string; type: TypedValue['kind'] | 'any'; dim?: Partial<Dimension> }[];
  returns: TypedValue['kind'];
  pure: true;                              // v1: all functions pure
  impl: (args: TypedValue[], ctx: FnCtx) => TypedValue;   // built-ins: in-process
  origin: 'builtin' | 'user';              // 'user' → M6 sandbox (E2B) — SAME signature
}
```

Registered into Univer via the Facade API; geometry built-ins call the GeometryStore through `ctx`. The sandbox is a *hook*: when user functions arrive (M6), only `impl` dispatch changes — signatures, validation, and registration are already shared.

**v1 built-ins:** arithmetic/aggregation lifted to Quantity · `POINT(x,y,z)` · `LINE(a,b)` · `POLYLINE(tbl)` · `PROFILE(tbl)` · `EXTRUDE(profile,h)` · `DISTANCE(a,b)` · `LENGTH(g)` · `VOLUME(g)` · `SHOWSTEPS(ref)`.

## 7. GeometryStore

```ts
interface GeomEntry {
  handle: GeomHandle;                      // content-addressed: hash(op + input hashes)
  kind: 'point'|'curve'|'profile'|'solid';
  preview?: MeshBuffers;                   // manifold-3d, sync-fast
  exact?: OcctShapeRef;                    // occt-wasm arena ref, async, disposable
  refs: Set<NodeId>;
}
```
Same inputs → same handle → no rebuild (memoization crosses blocks). `sweep(live)` disposes every entry whose handle no longer appears in any live GeometryNode — the WASM-leak gate depends on this. Kernels sit behind `GeometryKernel` (make/boolean/measure/mesh/dispose) so either kernel is swappable; occt runs in a Worker.

## 8. Document & block model

```ts
type BlockId = string;
interface Block {
  id: BlockId; docId: string;
  type: 'text'|'heading'|'image'|'equation'|'sheet'|'viewer';
  position: number;                        // layout ONLY (see §5)
  // type-specific:
  pm?: PMNodeJSON;                         // text/heading/equation content (ProseMirror)
  univerSnapshot?: unknown;                // sheet blocks
  viewer?: { boundHandles: 'auto' | NodeId[]; camera?: CameraState };
}
interface ChipBinding { id: string; blockId: BlockId; nodeId: NodeId;
                        format?: { digits?: number; unit?: string } }   // inline value chips
```
Sheet blocks lift named ranges → `NamedOutputNode`s; chips and viewers bind by `NodeId`; cross-sheet references resolve through the document graph (no second formula engine).

## 9. Mutation API (the only write path)

```ts
type GraphMutation =
  | { op:'setInput';    id:NodeId; value:TypedValue }
  | { op:'setFormula';  id:NodeId; formula:FormulaAST }
  | { op:'addNode';     node:Omit<GraphNode,'value'|'contentHash'|'inputs'> }
  | { op:'removeNode';  id:NodeId }
  | { op:'publishName'; cellRef:CellRef; name:string }
  | { op:'rebindChip';  chipId:string; nodeId:NodeId }
  | { op:'blockOp';     ... }                             // add/move/remove blocks
  ;
applyMutation(m: GraphMutation, actor: Actor): Result<AffectedSet, MutationError>
```
Every call is validated (types, dims, cycles), recorded to the undo log, stamped with provenance, then recalc runs (§4). Humans, templates, and — later — agents are all just `actor`s. **No projection may write around this API.**

## 10. Convex persistence schema

```
documents      { _id, title, blocksOrder: BlockId[], createdAt, updatedAt }
blocks         { _id, docId, type, position, pm?, viewer? }
sheetSnapshots { _id, blockId, univerSnapshot, updatedAt }
graphNodes     { _id, docId, ...GraphNode }               // one row per node
chipBindings   { _id, docId, blockId, nodeId, format }
versions       { _id, docId, snapshotRef, label, createdAt }
waitlist       { _id, email, name?, role?, firm?, createdAt, source }   // marketing site
-- deferred (M5/M6): users, memberships, permissions, pendingDiffs
```
Single-user early: no auth tables, no ACLs; the persistence layer is abstracted so M5 adds identity without schema surgery. Version snapshots capture `graphNodes + blocks + sheetSnapshots` atomically; reproducibility (§5 "restart & run all") is verified against snapshots in CI.

## 11. Error taxonomy & propagation

`#UNIT!` dimensional mismatch · `#DIM!` incompatible table/vector shapes · `#CYCLE!` membership in a rejected cycle (lists members) · `#REF!` dangling reference after delete · `#NAME?` unresolved published name · `#GEOM!` kernel failure (non-manifold, invalid profile) · `#VALUE!` type mismatch. Errors carry `origin` (first failing node) so any downstream chip can deep-link to the root cause.

## 12. Export mapping

**PDF:** blocks render in `position` order; chips render resolved values; show-steps expandable sections included per checker settings.
**IFC4X3 ("ifc-lite"):** GeometryNodes with exact shapes → IfcProduct subtypes with property sets carrying `name`, provenance, and source formula text (auditability travels with the model); validated against a web-ifc read-back in CI.
