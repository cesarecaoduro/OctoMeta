---
status: ready
priority: p1
issue_id: "001"
tags: [persistence, indexeddb, convex, offline, versioning]
dependencies: []
---

# Execute browser-first versioned persistence

## Problem Statement

OctoMeta currently rewrites the full normalized document and undo history to Convex after ordinary edits. The product needs browser-first automatic durability, deliberate immutable cloud versions, local branches and undo, portable recovery, offline owner access, and read-only sharing.

## Findings

- The approved and deepened implementation contract is `docs/plans/2026-07-21-feat-browser-first-versioned-persistence-plan.md`.
- `src/convex/documents.ts` currently allows live rows into the optional `deletedAt` expiry range and immediately reschedules full pages without proving deletion progress.
- `src/convex/files.ts` can repeatedly inspect the same full page of reachable assets and starve later unreachable assets.
- The existing baseline is green: 25 test files and 534 tests passed on 2026-07-21.
- The work must remain additive and phase-gated because it changes browser durability, cloud history, asset reachability, authorization, and production migration.

## Proposed Solutions

### Option 1: Execute the approved phased plan

**Approach:** Implement Phases 0–9 in dependency order, checking completed work in the source plan and verifying every phase gate before moving forward.

**Pros:** Preserves the reviewed architecture, migration safety, and acceptance criteria.

**Cons:** Large multi-release implementation requiring disciplined incremental verification.

**Effort:** Multi-phase feature delivery.

**Risk:** High, controlled by the plan's compatibility and rollback gates.

### Option 2: Direct browser persistence cutover

**Approach:** Replace the current saver and cloud schema in one release.

**Pros:** Fewer intermediate states.

**Cons:** Violates the approved migration, compatibility, recovery, and rollout requirements.

**Effort:** Lower initially, substantially higher incident risk.

**Risk:** Unacceptable.

## Recommended Action

Execute Option 1 on `feat/browser-first-versioned-persistence`. Treat the source plan as the authoritative task list, keep this todo's work log current, and commit only complete, tested logical units.

## Technical Details

**Primary areas:**

- `src/lib/persistence/` — local/authored contracts, IndexedDB, cloud facade, portable files, reconciliation
- `src/convex/` — cleanup containment, additive schema, immutable versions, access, migration, purge
- `src/routes/app/` — offline/local workspace orchestration and explicit cloud-save UI
- `src/lib/editor/` and `src/lib/adapters/univer/` — capture barriers and true read-only mounting
- `src/lib/persistence/reproducibility.convex.test.ts` plus browser/unit coverage

## Resources

- [Execution plan](../docs/plans/2026-07-21-feat-browser-first-versioned-persistence-plan.md)
- [Source brainstorm](../docs/brainstorms/2026-07-21-browser-first-versioned-persistence-brainstorm.md)
- [Architecture](../ARCHITECTURE.md)
- [Schema](../SCHEMA.md)
- [Design direction](../DESIGN.md)

## Acceptance Criteria

- [ ] Phase 0 cleanup containment is implemented, tested, deployed, and observed for its gate.
- [ ] Phase 1 contracts, integrity, stable IDs, validators, and dependencies pass their gate.
- [ ] Phase 2 browser workspace, assets, coordination, sign-out, and owner offline shell pass their gate.
- [ ] Phase 3 portable export/import passes hostile-input and recovery gates.
- [ ] Phase 4 additive immutable cloud APIs and compatibility paths pass their gate.
- [ ] Phase 5 migration dry run, canary conversion, and legacy recovery pass their gate.
- [ ] Phase 6 browser-first owner cutover passes real-browser gates.
- [ ] Phase 7 branches, history, reconciliation, restore, and duplicate pass their gate.
- [ ] Phase 8 viewer invitations and read-only access pass authorization/offline gates.
- [ ] Phase 9 observation, decommission, documentation, and compounded learnings are complete.
- [ ] Every checkbox and acceptance criterion in the source plan is complete with authoritative evidence.
- [ ] `pnpm check`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, production audit, secret scan, and `git diff --check` pass.

## Work Log

### 2026-07-21 - Execution setup and Phase 0 audit

**By:** Codex

**Actions:**

- Created `feat/browser-first-versioned-persistence` from `feat/v1-6-workbench`, preserving the reviewed plan edit.
- Read the execution plan, repository instructions, design system, current cleanup code, schema, cron configuration, maintenance tooling, and Convex regression tests.
- Confirmed the document cleanup defect in `src/convex/documents.ts` and asset pagination starvation in `src/convex/files.ts`.
- Ran the baseline test suite: 25 files and 534 tests passed.

**Learnings:**

- Phase 0 can be isolated as a small backend/test commit before persistence redesign work.
- Asset cleanup needs a durable per-row inspection timestamp (or equivalent cursor), not only removal of immediate recursion.

### 2026-07-21 - Phase 0 local containment

**By:** Codex

**Actions:**

- Restricted document expiry to rows with numeric `deletedAt` values inside the expired range, removed immediate cleanup recursion, and returned actual deletions.
- Added durable asset reachability inspection timestamps and ordered cleanup candidates by inspection age so reachable prefixes cannot starve unreachable tails.
- Added regression coverage for 26 live documents and multi-run reachable-prefix/unreachable-tail cleanup.
- Verified deployment variable names from `.env.example` and `.github/workflows/production.yml` without reading or recording secret values.
- Passed 536 tests, `pnpm check`, `pnpm build`, `pnpm secret:scan`, the high-severity production audit gate, and `git diff --check`.

**Remaining Phase 0 gate:**

- Production backup/export, credential rotation, usage alerts, deployment, dashboard verification, and 24-hour observation require the production environment and remain unchecked.

**Learnings:**

- Optional Convex index fields require an explicit lower bound when `undefined` rows must be excluded.
- Normal cron cadence plus a durable per-row marker provides bounded progress without scheduled-function recursion.

### 2026-07-21 - Phase 0 backup and operational evidence

**By:** Codex

**Actions:**

- Created a full production Convex snapshot with file storage outside the repository.
- Restricted the archive and checksum file to owner read/write access, verified the SHA-256 checksum, and passed ZIP integrity validation.
- Added `docs/operations/browser-first-persistence-rollout.md` with the backup inventory, isolated restore procedure, credential names, alert checklist, deployment checks, and 24-hour observation evidence table.
- Audited GitHub configuration by name only and confirmed the Production environment currently has none of the variables or secrets required by `.github/workflows/production.yml`.

**Remaining Phase 0 gate:**

- Provision an isolated disposable Convex deployment and pass the restore drill without overwriting the shared development deployment.
- Configure the GitHub Production environment, rotate credentials, configure Convex alerts, deploy the hotfix, and observe it for 24 hours.

**Learnings:**

- The authenticated local Convex CLI can export production safely while remaining configured to use development by default.
- Restore verification must use an isolated target because snapshot import with `--replace-all` is intentionally destructive.

## Notes

- The source plan is a living document; mark each completed implementation checkbox there.
- Production observation/deployment gates cannot be claimed from local tests alone.
