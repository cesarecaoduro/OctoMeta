# Browser-First Persistence Rollout Runbook

This runbook records the operational controls for the browser-first persistence rollout. Never add deployment values, credentials, exported data, invitation tokens, or document content to this repository.

## Phase 0 Production Backup

The pre-schema production snapshot was created on 2026-07-21 with file storage included.

| Evidence | Value |
|---|---|
| Local archive | `$HOME/.octometa/backups/convex/octometa-production-pre-browser-persistence-2026-07-21.zip` |
| SHA-256 | `ad1a4e901034e610feabc96f9571d91bbe8976ea096ccfc501218c2416148d02` |
| Checksum file | Same path with `.sha256` appended |
| Permissions | Owner read/write only (`0600`) |
| Archive validation | `unzip -t` passed |
| Included data | Convex tables, components, and `_storage` file content |
| Restore drill | Passed in an isolated expiring development deployment on 2026-07-21 |

The local archive is sensitive production data. Keep it outside the repository, do not upload it to general-purpose file sharing, and retain it only in an access-controlled backup location.

### Create and verify a replacement snapshot

Run from a trusted workstation with authenticated Convex access:

```sh
backup_dir="$HOME/.octometa/backups/convex"
backup_path="$backup_dir/octometa-production-YYYY-MM-DD.zip"
mkdir -p "$backup_dir"
pnpm exec convex export --prod --include-file-storage --path "$backup_path"
chmod 600 "$backup_path"
shasum -a 256 "$backup_path"
unzip -t "$backup_path"
```

Store the checksum beside the archive with owner-only permissions. Never print table data or file contents while validating the export.

### Restore drill

Use a newly provisioned disposable Convex deployment. Never run the drill against production or a shared development deployment.

1. Deploy the schema and functions compatible with the snapshot to the disposable deployment.
2. Record the disposable deployment identifier outside the repository.
3. Import the snapshot with an explicit deployment target:

   ```sh
   pnpm exec convex import \
     --deployment '<disposable-deployment>' \
     --replace-all \
     --yes \
     "$HOME/.octometa/backups/convex/octometa-production-pre-browser-persistence-2026-07-21.zip"
   ```

4. Verify table counts, stored-file availability, authentication configuration, owner document loading, trash state, and cleanup schedules without exposing document content in logs.
5. Record the drill date, verifier, count comparison, and result in this runbook.
6. Destroy the disposable deployment after the evidence is retained.

The 2026-07-21 drill used `dev/browser-persistence-restore-20260721`, configured to expire after one day. The snapshot imported successfully with `--replace-all`; counts for every product table and `_storage` matched production exactly. Both cleanup functions completed with zero work and no cleanup continuation. Production contained zero product/auth rows and zero stored files at snapshot time, so authenticated owner loading was not applicable to this drill.

## Production Configuration by Name

The production GitHub workflow expects these GitHub environment values:

- Variables: `CONVEX_PRODUCTION_URL`, `CONVEX_PRODUCTION_SITE_URL`.
- Secrets: `CONVEX_DEPLOY_KEY`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_TOKEN`.

The two Convex URL variables and all four workflow secrets are configured directly on the GitHub `Production` environment. On 2026-07-22, `VERCEL_TOKEN` was created as a dedicated `MyOrg`-scoped CI token named `OctoMeta GitHub Production`, with a one-year expiration on 2027-07-22. It is not the personal CLI token.

Convex deployment variables required by the current application are documented in `.env.example`. Verify names only before deployment.

The production Convex deployment has production-specific `BETTER_AUTH_SECRET`, `SITE_URL`, `AUTH_TRUSTED_ORIGINS`, `RESEND_API_KEY`, and `RESEND_WEBHOOK_SECRET` values. `SITE_URL` and the trusted origin use the Vercel-assigned `https://octometa.app` domain. Google OAuth remains intentionally disabled because no production OAuth client is configured; `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are optional in the application and must be added together when that provider is provisioned. Keep `RESET_ENVIRONMENT` and `DEV_RESET_TOKEN` absent from production.

Resend has separate sending-only API keys for the Convex development and production deployments. The production webhook targets `https://cheerful-hummingbird-383.convex.site/resend-webhook`, listens for the same six events as development, and has a distinct signing secret.

## Credential Rotation

Rotate the development credentials exposed in prior diagnostic output before deploying the hotfix:

| Variable | Status |
|---|---|
| `BETTER_AUTH_SECRET` | Rotated directly in the development Convex deployment on 2026-07-21 |
| `RESEND_API_KEY` | Rotated on 2026-07-22; development and production use distinct sending-only provider keys and the shared legacy key was revoked |
| `RESEND_WEBHOOK_SECRET` | Rotated on 2026-07-22; development and production use distinct signing secrets and production has its own webhook endpoint |
| `DEV_RESET_TOKEN` | Not configured in the development Convex deployment; no active value to rotate |

Invalidate the prior value at its provider, set the replacement directly in the relevant Convex deployment, restart or redeploy consumers when required, and verify the old value no longer authenticates. Do not record either value. Re-run `pnpm secret:scan` after rotation.

## Usage Alerts and Limits

The following monthly production warning/disable thresholds were configured on 2026-07-21:

| Metric | Warning | Disable |
|---|---:|---:|
| Function calls | 500,000 calls | 900,000 calls |
| Database I/O | 1 GB | 2 GB |
| Data egress, including file delivery | 1 GB | 2 GB |

Convex emails production threshold events to team members. Scheduled executions count toward the function-call metric. Convex does not expose outstanding scheduled functions as a separate usage-limit metric; the production Schedules page showed zero outstanding runs before deployment, and the post-deploy check must confirm it remains at the expected cron cadence.

Record only configured thresholds, the notification destination owner, and the verification date. Do not record alert delivery credentials.

## Phase 0 Deploy and Observation

Before deployment:

- Confirm the backup checksum again.
- Complete the restore drill.
- Complete credential rotation.
- Configure usage alerts and confirm recipients.
- Pass `pnpm check`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm audit --prod --audit-level=high`, `pnpm secret:scan`, and `git diff --check`.

After deploying the Phase 0 Convex hotfix, inspect schedules and logs without printing function arguments or document content. Verify:

- Cleanup functions run only at the configured cron cadence.
- No immediate cleanup recurrence chain is created.
- Live document counts remain stable except for expected user actions.
- Reachable assets remain available.
- Database I/O, file bandwidth, function calls, and outstanding scheduled functions stay within the recorded baseline.

Observe these invariants for 24 hours. Record timestamps, baseline/observed counts, and a pass/fail decision here before Phase 1 begins.

## Evidence Log

| Date | Environment | Check | Result |
|---|---|---|---|
| 2026-07-21 | Production export | Snapshot with file storage downloaded, checksum verified, archive tested, and permissions restricted | Pass |
| 2026-07-21 | GitHub Production environment | Convex URLs/deploy key and Vercel project identifiers configured | Partial — dedicated `VERCEL_TOKEN` pending |
| 2026-07-21 | Disposable non-production | Snapshot restore drill, product/storage count parity, and bounded cleanup execution | Pass — source snapshot contained zero product/auth rows and files |
| 2026-07-21 | Development Convex | `BETTER_AUTH_SECRET` rotated without exposing its value | Pass |
| 2026-07-21 | Development/Production Convex | Resend API key separation | Fail — both deployments reference the same token; provider-side replacement/revocation pending |
| 2026-07-21 | Production Convex | Required application variable names present | Fail — only `RESEND_API_KEY` is configured |
| 2026-07-21 | Production Convex | Function-call, database-I/O, and data-egress monthly warning/disable thresholds | Pass |
| 2026-07-21 | Production Convex | Outstanding scheduled functions before hotfix deployment | Pass — zero outstanding runs; post-deploy observation pending |
| 2026-07-22 | Resend/Convex | Development and production API keys separated; shared legacy key revoked | Pass — distinct sending-only keys verified by prefix, length, and inequality without printing values |
| 2026-07-22 | Resend/Convex | Development webhook secret rotated and production webhook provisioned | Pass — distinct signing secrets verified without printing values |
| 2026-07-22 | GitHub Production environment | Dedicated Vercel CI token configured | Pass — `MyOrg` scope, one-year expiration, secret name verified |
| 2026-07-22 | Production Convex | Core application variable names present | Pass — Better Auth, site/trusted origin, Resend API, and webhook variables present; optional Google OAuth disabled |
| 2026-07-22 | Development Convex | Better Auth JWKS after secret rotation | Pass — one key encrypted under the retired secret was removed and regenerated under the replacement secret |
| 2026-07-22 | Local release gate | Types, 536 unit tests, production build, 5 Playwright tests, audit, secret scan, and diff check | Pass — audit reports one low-severity advisory and no high-severity blocker |
| 2026-07-22 | GitHub Actions | Initial Production workflow dispatch | Blocked safely — GitHub has no workflow registered on default branch `main`; no deployment started |
