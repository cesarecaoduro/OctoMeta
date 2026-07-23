# OctoMeta

*The living engineering document. Edit once, everything follows.*

OctoMeta is an authenticated engineering workbench. A report canvas, attached
multi-tab workbook, parameters, equations, derivations, and provenance are
projections of one typed dependency graph.

The current delivery program rebuilds OctoMeta as a browser-first, local-first
technical-document workspace. It retains the typed graph, TipTap report, and
attached Univer workbook proven by the earlier workbench, while replacing its
cloud-first authoring model with explicit local durability and immutable cloud
versions. New documents are created locally, edits and unified undo history
autosave on the device, and the document index presents local-only,
cloud-backed, and cloud-only documents together without publishing as a side
effect.

## Local-first document index

The authenticated `/app` index distinguishes storage state explicitly:

- **On this device · No cloud version** identifies a local-only document.
- A downloaded cloud document shows its base revision and whether newer local
  generations exist.
- **Cloud only · Not downloaded to this device** identifies authorized cloud
  metadata whose working content is not available locally yet.
- Device-local branches are grouped beneath their parent document.

Local working copies can be renamed, duplicated with fresh undo history, or
discarded directly from the index. **Save new version** reviews one durable
generation and explicitly creates immutable cloud version 1 or the next Main
version; **Export** remains a non-mutating placeholder until portable recovery
lands. Listing the index and opening a new local document make
no Convex product write. Live cloud metadata is read once when the index opens;
Trash is loaded only when opened, and local lifecycle actions reuse the loaded
metadata without issuing additional Convex calls.

## Prerequisites

- Node.js 24
- pnpm 11.10.0 (Corepack is fine)
- A Convex account for a development deployment

## Local setup

```sh
pnpm install --frozen-lockfile
pnpm exec convex dev --once
cp .env.example .env.local
```

Keep the Convex-generated `CONVEX_DEPLOYMENT` and `PUBLIC_CONVEX_URL` values in
`.env.local`. `PUBLIC_CONVEX_SITE_URL` is the deployment's HTTP Actions URL.

Configure Better Auth on the Convex development deployment:

```sh
pnpm exec convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
pnpm exec convex env set SITE_URL http://localhost:5173
pnpm exec convex env set AUTH_TRUSTED_ORIGINS http://localhost:5173,http://localhost:4173
```

Google OAuth is optional. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in
Convex together to enable it. Email/password works without them. Magic links
also require the existing `RESEND_API_KEY` configuration.

Run Convex and the app in separate terminals:

```sh
pnpm exec convex dev
pnpm dev
```

Open [http://localhost:5173/signin](http://localhost:5173/signin), create an
account, then use **Load demo** on the document list to open the complete
`Steel beam check` workbench.

## Verification

```sh
pnpm check
pnpm test
pnpm build
pnpm test:e2e
pnpm audit --prod --audit-level=high
pnpm secret:scan
```

The Playwright suite creates an isolated owner, verifies local index lifecycle
actions, view-scoped cloud reads, and zero-cloud-call local actions, exercises
the desktop demo through reload/trash/restore, verifies route gating and safe
TeX handling, and runs the narrow layout at `390×844` with axe.

## Development reset

The reset deletes only product tables and product-owned storage. It excludes
Better Auth, component, and waitlist data. It refuses production, requires a
deployment-specific token plus the exact backup acknowledgement, supports a
dry run, acquires a product-write lock, deletes in bounded batches, and unlocks
only after zero-row verification.

Configure only a development/test deployment:

```sh
pnpm exec convex env set RESET_ENVIRONMENT development
pnpm exec convex env set DEV_RESET_TOKEN "<random deployment-specific token>"
```

Preview counts:

```sh
pnpm exec convex run maintenance:developmentReset \
  '{"token":"<token>","dryRun":true,"acknowledgeBackup":"IRREVERSIBLE BACKUP CONFIRMED"}'
```

Run the reset only after reviewing the dry-run counts and taking the intended
backup:

```sh
pnpm exec convex run maintenance:developmentReset \
  '{"token":"<token>","dryRun":false,"acknowledgeBackup":"IRREVERSIBLE BACKUP CONFIRMED"}'
```

If a reset fails, maintenance mode deliberately remains locked for inspection.
Do not edit the lock row manually until the failed stage and storage state have
been reconciled.

## Production release

`.github/workflows/production.yml` is manual and targets the protected GitHub
`production` environment. Configure:

- variables: `CONVEX_PRODUCTION_URL`, `CONVEX_PRODUCTION_SITE_URL`
- secrets: `CONVEX_DEPLOY_KEY`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`,
  `VERCEL_TOKEN`
- production Convex environment: `BETTER_AUTH_SECRET`, `SITE_URL`,
  `AUTH_TRUSTED_ORIGINS`, Resend settings, and optional Google OAuth settings

The workflow reruns install, types, tests, production build, audit, secret scan,
and Playwright before deploying Convex and the prebuilt Vercel artifact.
Production reset must remain unconfigured/disabled.

Rollback means redeploying the previous Vercel deployment while keeping Convex
schema changes forward-compatible. Never restore a development snapshot into
production.

## Project documents

GitHub [issue #5](https://github.com/cesarecaoduro/OctoMeta/issues/5) and its
child issues are the live delivery tracker. Repository documents provide the
stable specification, decisions, and implementation context behind those
tickets.

### Current

| File | Purpose |
|---|---|
| [docs/specs/2026-07-22-local-first-document-workspace.md](docs/specs/2026-07-22-local-first-document-workspace.md) | Current product specification for the local-first workspace rebuild |
| [docs/plans/2026-07-22-feat-local-first-document-workspace-plan.md](docs/plans/2026-07-22-feat-local-first-document-workspace-plan.md) | Current delivery plan, phase gates, and verification strategy |
| [CONTEXT.md](CONTEXT.md) | Canonical domain language and cross-cutting constraints |
| [docs/adr/](docs/adr/) | System-wide architectural decisions and trade-offs |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Implemented ownership boundaries, runtime flow, and code map |
| [SCHEMA.md](SCHEMA.md) | Typed graph and persisted bundle schema |
| [DESIGN.md](DESIGN.md) | Brand, design tokens, and interface direction |
| [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md) | GitHub issue workflow used for active delivery |

### Historical context

| File | Status |
|---|---|
| [PRD.md](PRD.md) | Founding product thesis and original version arc; some implementation assumptions are superseded |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Completed V1/R1.6 milestone briefs and workbench pivot |
| [docs/v1-6-workbench-plan.md](docs/v1-6-workbench-plan.md) | Completed R1.6 execution contract and release evidence |
| [docs/plans/2026-07-21-feat-browser-first-versioned-persistence-plan.md](docs/plans/2026-07-21-feat-browser-first-versioned-persistence-plan.md) | Superseded persistence plan retained for decision history |
