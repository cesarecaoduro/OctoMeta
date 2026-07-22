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

### 2026-07-21 - Phase 0 restore drill

**By:** Codex

**Actions:**

- Provisioned an isolated development deployment with a one-day expiration and deployed the Phase 0-compatible schema/functions.
- Imported the full production snapshot with destructive replacement confined to that disposable target.
- Compared every product-table and `_storage` count against production; all counts matched exactly.
- Executed document and asset cleanup against the restored snapshot; both returned bounded zero-work results and created no cleanup continuation.
- Restored `.env.local` to the original personal development deployment after the drill.

**Remaining Phase 0 gate:**

- Configure the GitHub Production environment, rotate credentials, configure Convex alerts, deploy the hotfix, and observe it for 24 hours.

**Learnings:**

- Production contained no product/auth rows or stored files at snapshot time, so count parity and function execution are the strongest available restore evidence; owner-document loading was not applicable.
- An expiring isolated cloud development deployment provides a safer restore target than reusing the personal development database.

### 2026-07-21 - Phase 0 release configuration and usage guardrails

**By:** Codex

**Actions:**

- Configured GitHub Production environment variables for both Convex URLs and secrets for the Convex deploy key and Vercel project identifiers without exposing their values.
- Created a production-scoped Convex deploy key for CI; left `VERCEL_TOKEN` unset rather than reusing a personal CLI credential.
- Rotated `BETTER_AUTH_SECRET` directly in the development Convex deployment without printing or storing the replacement.
- Configured monthly production warning/disable thresholds of 500,000/900,000 function calls, 1/2 GB database I/O, and 1/2 GB data egress.
- Verified the production Schedules page had zero outstanding runs before hotfix deployment.

**Remaining Phase 0 gate:**

- Rotate the Resend API and webhook credentials at the provider and update Convex atomically.
- Add a dedicated GitHub Production `VERCEL_TOKEN`.
- Deploy the hotfix, verify dashboard cadence/I/O, and observe it for 24 hours.

**Learnings:**

- Convex emails team members when a production usage threshold is reached, and scheduled executions count toward the function-call metric.
- Outstanding scheduled functions are not a separate configurable usage-limit metric, so their zero/cron-cadence invariant remains part of the dashboard observation gate.
- Development and production currently reference the same Resend API token, and that token cannot manage API keys through the provider API; safe rotation requires the authenticated provider dashboard and revocation of the shared value.
- Production Convex currently has only `RESEND_API_KEY`; the remaining production auth/site/webhook variable names must be configured before deployment.

### 2026-07-22 - Phase 0 credential and production readiness

**By:** Codex

**Actions:**

- Created separate sending-only Resend API keys for Convex development and production, verified the stored values were valid and distinct without printing them, and revoked the shared legacy provider key.
- Rotated the development Resend webhook signing secret, created a production webhook with the same six-event coverage, and verified distinct development/production signing secrets.
- Created a dedicated `MyOrg`-scoped Vercel CI token with a one-year expiration and stored it in the GitHub `Production` environment.
- Configured production-specific Better Auth, site URL, trusted origin, Resend API, and Resend webhook values in Convex. Left optional Google OAuth disabled because no production OAuth client is provisioned.
- Verified `octometa.app` is assigned to the OctoMeta Vercel project and used it as the production authentication origin.
- Removed the single development JWKS row encrypted under the retired Better Auth secret, allowed Better Auth to regenerate it under the replacement secret, and passed all five Playwright release tests.
- Passed `pnpm check`, 536 unit tests, `pnpm build`, the high-severity production audit gate, `pnpm secret:scan`, and `git diff --check` immediately before deployment.

**Remaining Phase 0 gate:**

- Deploy the hotfix, verify Convex schedule/log cadence and production behavior, and observe the gate for 24 hours.
- Register `.github/workflows/production.yml` on default branch `main` before dispatching this feature ref. GitHub rejected the initial dispatch because the workflow exists only on the feature lineage; do not bypass the protected workflow with a direct deployment.

**Learnings:**

- Browser clipboard state is not a safe shell handoff boundary; one-time provider values were instead transferred through owner-only temporary files that were deleted immediately after the target accepted them.
- Provider-side webhook secret rotation is immediate, so the matching Convex environment update must follow directly and be verified before proceeding.

## Notes

- The source plan is a living document; mark each completed implementation checkbox there.
- Production observation/deployment gates cannot be claimed from local tests alone.
