# OctoMeta

*The living engineering document. Edit once, everything follows.*

OctoMeta is an authenticated engineering workbench. A report canvas, attached
multi-tab workbook, parameters, equations, derivations, and provenance are
projections of one typed dependency graph.

The workbench now uses account-scoped IndexedDB working copies for ordinary
authoring. New documents are created locally, edits and unified undo history
autosave on the device, and the document index presents local-only,
cloud-backed, and cloud-only documents together without publishing as a side
effect. The existing R1.6 graph, TipTap report, Univer workbook, units,
equations, trash, asset cleanup, guarded reset, CI, and protected production
release workflow remain in place.

## Local-first document index

The authenticated `/app` index distinguishes storage state explicitly:

- **On this device · No cloud version** identifies a local-only document.
- A downloaded cloud document shows its base revision and whether newer local
  generations exist.
- **Cloud only · Not downloaded to this device** identifies authorized cloud
  metadata whose working content is not available locally yet.
- Device-local branches are grouped beneath their parent document.

Local working copies can be renamed, duplicated with fresh undo history, or
discarded directly from the index. **Save new version** and **Export** are
visible entry points but remain non-mutating until the immutable cloud-version
and portable-export work lands; invoking either currently explains that no
cloud write occurred. Listing the index and opening a new local document make
no Convex product write.

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
actions and zero-cloud-write authoring, exercises the desktop demo through
reload/trash/restore, verifies route gating and safe TeX handling, and runs the
narrow layout at `390×844` with axe.

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

| File | Purpose |
|---|---|
| [PRD.md](PRD.md) | Product requirements and version arc |
| [docs/v1-6-workbench-plan.md](docs/v1-6-workbench-plan.md) | R1.6 execution contract and completion evidence |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Current ownership boundaries and code map |
| [SCHEMA.md](SCHEMA.md) | Typed graph and persisted bundle schema |
| [DESIGN.md](DESIGN.md) | Brand, tokens, and UI direction |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Historical milestones and current release addendum |
