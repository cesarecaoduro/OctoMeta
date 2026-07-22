# OctoMeta schema

*The R1.6 source-of-truth model and persistence guarantees. V2/V3 hooks remain
reserved but are not presented as implemented product behavior.*

**Last updated:** 20 July 2026

## 1. Layer model

The report, workbook, parameters, and equations are projections of one typed
document graph. Every authored change enters through `GraphMutation`; edges are
derived from formulas.

```text
report / workbook / parameters / equations
                    │
              GraphMutation
                    ▼
             DocumentGraph
                    │
         atomic revisioned bundle
                    ▼
                  Convex
```

## 2. Typed values

```ts
type TypedValue =
  | { kind: 'scalar'; value: number }
  | { kind: 'quantity'; value: number; unit: Dimension }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'table'; columns: ColumnDef[]; rows: TypedValue[][] }
  | { kind: 'geometry'; handle: GeomHandle } // reserved for V2
  | { kind: 'error'; code: ErrCode; message: string; origin: NodeId };

type Dimension = {
  L: number; M: number; T: number; I: number;
  Θ: number; N: number; J: number;
  display?: string;
};

type ErrCode =
  | '#UNIT!' | '#DIM!' | '#CYCLE!' | '#REF!'
  | '#NAME?' | '#GEOM!' | '#VALUE!';
```

Quantity magnitudes are stored in canonical SI. `display` retains the authored
unit for shared rendering. R1 includes SI plus `in`, `ft`, `lbf`, `kip`, `psi`,
and `ksi`; compound aliases normalize to canonical output such as `in²`.
Errors are values and propagate through the graph.

## 3. Workbook and graph

```ts
type NodeId = string;
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
  sheets: SheetMeta[];
};

interface GraphNode {
  id: NodeId;
  kind: 'input' | 'computed' | 'namedOutput' | 'geometry' | 'table' | 'error';
  name?: string;
  formula?: FormulaAST;
  value: TypedValue;
  inputs: NodeId[];
  contentHash: string;
  blockId?: BlockId;
  cellRef?: CellRef;
  provenance: Provenance;
  pending?: PendingChange | null;
}
```

`DocumentGraph` owns one `WorkbookManifest`. Sheet identity is always the opaque
ID; name and position may change. A `namedOutput` is the stable published alias.
Parameters and equations retain that alias ID, while one-hop resolution finds
the source input/formula.

## 4. Formulas and recalc

```ts
type FormulaAST =
  | { t: 'lit'; value: number | string | boolean; unit?: string }
  | { t: 'ref'; ref: CellRef | { name: string } }
  | { t: 'un'; op: '-' | 'not'; arg: FormulaAST }
  | {
      t: 'bin';
      op: '+'|'-'|'*'|'/'|'^'|'='|'<'|'>'|'<='|'>='|'<>';
      left: FormulaAST;
      right: FormulaAST;
    }
  | { t: 'call'; fn: string; args: FormulaAST[] };
```

`resolveInputs` derives node edges from references. A mutation settles its
affected nodes plus transitive dependents using Kahn ordering and content-hash
memoization. Cycles reject at the public mutation boundary; corrupt/legacy
cycles loaded into a graph settle as `#CYCLE!` without stopping acyclic
branches. Re-evaluating from stored inputs must reproduce hashes byte-for-byte.

Cross-tab formulas use published names. `Sheet!A1` and structural address
rewriting are not part of R1.

## 5. Report blocks and bindings

```ts
type BlockId = string;

type Block =
  | { id: BlockId; docId: string; type: 'text'; position: number; pm?: PMNodeJSON }
  | { id: BlockId; docId: string; type: 'heading'; position: number; pm?: PMNodeJSON }
  | {
      id: BlockId; docId: string; type: 'image'; position: number;
      image: { storageId: string; alt?: string; caption?: string };
    }
  | {
      id: BlockId; docId: string; type: 'equation'; position: number;
      equation:
        | { mode: 'static'; tex: string }
        | {
            mode: 'bound';
            nodeId: NodeId;
            display: 'symbolic' | 'substituted' | 'result' | 'steps';
          };
    };

interface ChipBinding {
  id: string;
  blockId: BlockId;
  nodeId: NodeId;
  format?: { digits?: number; unit?: string };
}
```

Workbook sheets are no longer report blocks. Block `position` controls reading
order only and never affects calculation. Chips and bound equations store the
published alias `NodeId`; deleting and undo-restoring the target heals the same
binding identity.

## 6. Mutation and history

The public mutation union includes value/formula/node/name operations,
`chipOp`, `blockOp`, and workbook operations:

```ts
type WorkbookMutation =
  | { op: 'workbookOp'; action: 'add'; sheet: SheetMeta; activate: boolean }
  | { op: 'workbookOp'; action: 'rename'; sheetId: SheetId; name: string }
  | {
      op: 'workbookOp'; action: 'remove'; sheetId: SheetId;
      projection: SheetProjection;
    };

interface SheetProjection {
  version: 1;
  sheetId: SheetId;
  wasActive: boolean;
  snapshot: unknown;
}
```

Add/rename/remove is validated before commit. The last sheet cannot be removed;
names are bounded and unique. Removal captures the sheet projection and hosted
nodes so undo restores the same identity and content.

```ts
interface UndoEntry {
  seq: number;
  mutation: GraphMutation;
  inverse: GraphMutation[];
  actor: Actor;
  at: number;
}
```

One linear cursor/history spans report blocks, cells, names, chips, and tabs.
Undo and redo use the same validated internal apply path without appending new
entries. A fresh mutation truncates the redo tail. The retained cap is 200.

## 7. Provenance and derivations

```ts
interface Provenance {
  authoredBy: 'human' | 'agent' | 'template' | null;
  authorId?: string;
  authoredAt?: number;
  verifiedBy?: string;
  verifiedAt?: number;
}
```

Every computed node can produce a structured derivation: canonical formula,
substitution, intermediate steps, and result. Plain text and TeX printers
consume this structure. Authorship is stamped only by authoring mutations;
mechanical healing/recalc does not rewrite provenance.

`PendingChange` remains a serialized V3 propose/validate/commit hook and is not
interpreted in R1.

## 8. Convex product schema

```text
documents {
  ownerId, title, blocksOrder, undoCursor,
  revision, bundleHash, workbookManifest,
  deletedAt?, stats, createdAt, updatedAt
}
graphNodes        { docId, nodeId, ...GraphNode }
blocks            { docId, blockId, type, position, pm?, image?, equation? }
undoLog           { docId, seq, mutation, inverse, actor, at }
chipBindings      { docId, chipId, blockId, nodeId, format? }
workbookSnapshots { docId, revision, snapshotHash, snapshot, updatedAt }
assets {
  storageId, ownerId, docId?, contentType, size,
  state, createdAt, claimedAt?, pendingDeletionAt?,
  deleteAttempts, nextAttemptAt?, lastError?
}
maintenance       { key, locked, operation?, startedAt?, updatedAt }
```

Indexes cover owner/deletion list queries, per-document child rows, storage
ownership, asset retry state, and the singleton maintenance key. Better Auth
and component tables are owned by their Convex components; `waitlist` remains
separate marketing data.

### Atomic save

One mutation:

1. authenticates and verifies ownership/live state;
2. checks the maintenance lock;
3. validates expected revision and all count/byte/title/tab limits;
4. validates graph, manifest, snapshot, and referenced assets;
5. recomputes snapshot and bundle hashes;
6. replaces all child rows;
7. patches document revision/hash/manifest/stats;
8. commits or rolls back as a unit.

The snapshot row and document carry the same revision. A stale writer receives
`REVISION_CONFLICT`; it cannot overwrite current data. Load returns
`integrity-error` if hashes or revisions disagree and the client mounts no
editable surface.

## 9. Ownership and lifecycle

All product reads/writes require a Better Auth subject. Documents and assets
carry `ownerId`; unauthorized callers receive no foreign list data and cannot
load/mutate/serve/claim foreign resources.

Trash sets `deletedAt`. Restore clears it. Permanent and scheduled deletion
cascade graph rows, blocks, history, chips, workbook snapshot, and assets.
Automatic expiry is strictly older than the 30-day UTC cutoff.

Asset reachability includes retained undo history. Unreachable assets move to
`pendingDeletion`; cleanup retries storage deletion with durable attempt/error
state before removing metadata.

## 10. Limits and safety

The server enforces document, tab, node, block, chip, undo, bundle, snapshot,
title, and upload limits. Client checks improve feedback but never replace
server enforcement.

The development reset hardcodes its product-table allowlist, refuses anything
except `development`/`test`, requires a deployment token and exact backup
acknowledgement, locks product writes, uses bounded batches, verifies zero
allowlisted rows, and remains locked on failure. Auth, component, and waitlist
data are excluded.

## 11. Reserved future schema

`TypedValue.geometry`, `GeomHandle`, `PendingChange`, and actor kind `agent`
remain stable seams for the V2 geometry viewer and V3 agent layer. Versions,
sharing/ACLs, comments, collaboration, templates, and exports require explicit
future schema work; they are not implied by the reserved fields.
