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
| Restore drill | Pending an isolated disposable non-production deployment |

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

Do not claim the Phase 0 observation gate until this drill passes.

## Production Configuration by Name

The production GitHub workflow expects these GitHub environment values:

- Variables: `CONVEX_PRODUCTION_URL`, `CONVEX_PRODUCTION_SITE_URL`.
- Secrets: `CONVEX_DEPLOY_KEY`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_TOKEN`.

As of 2026-07-21, neither repository-level nor `Production` environment-level names are configured. Configure them through GitHub without placing values in files or command output.

Convex deployment variables required by the current application are documented in `.env.example`. Verify names only before deployment.

## Credential Rotation

Rotate the development credentials exposed in prior diagnostic output before deploying the hotfix:

- `BETTER_AUTH_SECRET`
- `RESEND_API_KEY`
- `RESEND_WEBHOOK_SECRET`
- `DEV_RESET_TOKEN`

Invalidate the prior value at its provider, set the replacement directly in the relevant Convex deployment, restart or redeploy consumers when required, and verify the old value no longer authenticates. Do not record either value. Re-run `pnpm secret:scan` after rotation.

## Usage Alerts and Limits

Configure and verify alerts in the Convex dashboard for:

- Function calls
- Database bandwidth
- File bandwidth
- Outstanding scheduled functions

Record only the configured threshold, notification destination owner, and verification date. Do not record alert delivery credentials.

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
| 2026-07-21 | GitHub Production environment | Required release secret/variable names configured | Fail — configuration absent |
| 2026-07-21 | Disposable non-production | Snapshot restore drill | Pending — isolated target not provisioned |
