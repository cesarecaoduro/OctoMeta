# Better Auth continuity from Convex to Neon

Date: 2026-07-23  
Decision ticket: [Define Better Auth continuity without Convex](https://github.com/cesarecaoduro/OctoMeta/issues/31)

## Decision

Retain Better Auth, but replace the Convex component and Svelte token bridge with Better Auth's first-party PostgreSQL adapter running in the existing SvelteKit application:

- use a module-scoped `pg.Pool` with the Vercel/Neon pooled `DATABASE_URL` at runtime;
- mount Better Auth with its official SvelteKit handler and populate `event.locals.user` / `event.locals.session`;
- keep the existing Svelte Better Auth client and magic-link client plugin, but remove the Convex client plugin, Convex JWT cookie, proxy route, and Svelte token bridge;
- preserve accounts by importing the Better Auth `user` and `account` records into CLI-generated PostgreSQL tables, retaining IDs and password hashes exactly;
- make a planned sign-in reset the default cutover: do not import sessions or outstanding verification tokens;
- retain the exact Better Auth secret for the cutover, then rotate it as a separate, verified operation;
- send magic-link mail directly through Resend from the Better Auth callback;
- store Better Auth rate limits in Neon rather than function memory.

This is supported without a custom Better Auth database adapter. Better Auth documents a direct PostgreSQL integration using `pg.Pool`, backed internally by its Kysely adapter, and supports both schema generation and migration for it ([PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql)). Neon recommends a pooled connection for serverless/web application traffic and a direct connection for migrations and administrative work ([Neon connection pooling](https://neon.com/docs/connect/connection-pooling)).

## Repository baseline

The current integration has four Convex-specific layers:

1. [`src/convex/auth.ts`](../../src/convex/auth.ts) constructs Better Auth with `authComponent.adapter(ctx)`, enables email/password, conditionally enables Google, and sends magic links through the Convex Resend component.
2. [`src/convex/http.ts`](../../src/convex/http.ts) registers Better Auth HTTP routes on the Convex site.
3. [`src/routes/api/auth/[...all]/+server.ts`](../../src/routes/api/auth/[...all]/+server.ts) proxies same-origin `/api/auth/*` requests to that Convex site.
4. [`src/hooks.server.ts`](../../src/hooks.server.ts), [`src/routes/+layout.svelte`](../../src/routes/+layout.svelte), and [`src/routes/app/+layout.svelte`](../../src/routes/app/+layout.svelte) turn the Convex plugin's `convex_jwt` cookie into Convex server/client authentication state.

The user-facing surface is already mostly portable:

- [`src/lib/auth-client.ts`](../../src/lib/auth-client.ts) uses Better Auth's Svelte client;
- [`src/routes/signin/+page.svelte`](../../src/routes/signin/+page.svelte) calls the standard `signUp.email`, `signIn.email`, `signIn.magicLink`, and `signIn.social` APIs;
- [`src/lib/components/UserBadge.svelte`](../../src/lib/components/UserBadge.svelte) already consumes `authClient.useSession()` and calls `authClient.signOut()`.

Consequently, the sign-in UI and its API calls should remain stable. The meaningful application changes are server construction/handling, route authorization, and removal of Convex token state.

## Target server and client integration

### Server

Create one server-only Better Auth instance, conceptually:

```ts
const pool = new Pool({ connectionString: DATABASE_URL });

export const auth = betterAuth({
  baseURL: BETTER_AUTH_URL,
  trustedOrigins,
  secret: BETTER_AUTH_SECRET,
  database: pool,
  user: { modelName: "auth_user" },
  session: { modelName: "auth_session" },
  account: { modelName: "auth_account" },
  verification: { modelName: "auth_verification" },
  rateLimit: {
    storage: "database",
    modelName: "auth_rate_limit",
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  socialProviders,
  plugins: [
    magicLink({ sendMagicLink }),
  ],
});
```

The exact source should use SvelteKit private environment imports and a shared database module; the snippet only fixes the contract. Keep the auth runtime on Vercel's Node.js runtime because `pg`, Better Auth's Node password implementation, and the Resend SDK are server dependencies.

Use the public schema with prefixed table names rather than a connection-level `search_path`. Better Auth supports custom model names ([database schema customization](https://better-auth.com/docs/concepts/database#custom-table-names)), while Neon's transaction-mode pool does not preserve session-level `SET search_path` behavior between transactions ([Neon pooled versus direct connections](https://neon.com/docs/connect/connection-pooling)). Prefixes also make table ownership clear beside product tables.

Mount the auth handler in `hooks.server.ts` using `svelteKitHandler`. The official integration explicitly supports retrieving the session from request headers and storing `session.session` and `session.user` in SvelteKit locals ([SvelteKit integration](https://better-auth.com/docs/integrations/svelte-kit)). Preserve OctoMeta's existing security-header logic around that handler.

The resulting server contract is:

- `App.Locals.user`: Better Auth user or `null`;
- `App.Locals.session`: Better Auth session or `null`;
- product authorization uses `locals.user.id`;
- `/app` server guards check `locals.session`, not the presence of a Convex JWT;
- backend product routes receive the authenticated user ID from the same server-validated session, not a client-supplied ID.

The standalone proxy endpoint can be deleted when the official hook owns `/api/auth/*`. If later specs prefer an endpoint mount, they must demonstrate that it is supported by the pinned Better Auth release; the documented SvelteKit path is the hook.

### Client

Retain:

```ts
createAuthClient({
  plugins: [magicLinkClient()],
});
```

Remove `convexClient()`, `createSvelteAuthClient`, `useAuth`, `getToken`, and `withServerConvexToken`. In the product layout, render authenticated content from `authClient.useSession()` plus the existing offline-owner exception. The current sign-in and badge components then need little or no behavioral change.

Better Auth's Svelte client is the supported reactive session interface ([SvelteKit client setup](https://better-auth.com/docs/integrations/svelte-kit#create-a-client)). The magic-link plugin still requires both its server plugin and client plugin ([magic-link plugin](https://better-auth.com/docs/plugins/magic-link)).

## PostgreSQL schema ownership

Use Better Auth's CLI against the exact target auth configuration and commit the generated SQL as a normal migration:

```sh
pnpm exec auth generate \
  --config src/lib/server/auth.ts \
  --output <project migration path> \
  --yes
```

Do not run `auth@latest migrate` during application startup or a Vercel deployment. The CLI supports generated SQL for the built-in Kysely/PostgreSQL adapter, and `migrate` can apply the schema directly ([Better Auth CLI](https://better-auth.com/docs/concepts/cli)). A checked-in migration provides review, reproducibility, and a stable rollback boundary.

Use:

- pooled `DATABASE_URL` for application requests;
- `DATABASE_URL_UNPOOLED` for schema generation checks, migrations, bulk import, and integrity validation.

The Neon Vercel integration exposes pooled runtime values and an unpooled connection value for tools that need a direct connection ([Neon Vercel integration change](https://neon.com/docs/changelog/2024-02-23)). Do not create a second database client abstraction just for auth: share the same module-scoped `pg.Pool`, while keeping Better Auth table access behind the Better Auth instance.

The generated schema is the source of truth. With the proposed configuration it must contain:

- `auth_user`;
- `auth_session`;
- `auth_account`;
- `auth_verification`;
- `auth_rate_limit`.

The four core record shapes are defined by Better Auth's database contract ([core schema](https://better-auth.com/docs/concepts/database#core-schema)). Database-backed rate limiting is important on horizontally scaled Vercel functions because Better Auth documents in-memory limits as unsuitable for many serverless deployments ([rate-limit storage](https://better-auth.com/docs/concepts/rate-limit#storage)).

The repository currently pins Better Auth 1.6.23, while [1.6.24](https://github.com/better-auth/better-auth/releases/tag/v1.6.24) is the latest stable release on the research date. Upgrade to the then-latest stable release as a preparatory change, generate the target schema from it, complete the migration rehearsal on it, and freeze that exact version for the final cutover. Do not discover or apply an auth upgrade during the production snapshot/import window.

### ID type constraint

Convex document IDs are opaque non-UUID strings. The target auth IDs and foreign keys must therefore be PostgreSQL `text`, and the import must explicitly set every preserved ID. Do not configure `advanced.database.generateId: "uuid"` for the initial migration: that setting changes ID and foreign-key columns to PostgreSQL `uuid`, which cannot contain Convex IDs. The pinned Better Auth 1.6 schema generator uses `text` unless UUID or serial generation is explicitly selected ([v1.6.24 migration source](https://github.com/better-auth/better-auth/blob/v1.6.24/packages/better-auth/src/db/get-migration.ts)).

After cutover, Better Auth can continue generating opaque string IDs. Product tables should reference `auth_user.id` as `text`.

## Account export and import

### Feasibility

The current Convex component stores Better Auth's logical records with the same field names and semantics. Its published schema contains `user`, `session`, `account`, and `verification` tables; credential hashes live in `account.password` ([Convex Better Auth v0.12.5 schema](https://github.com/get-convex/better-auth/blob/v0.12.5/src/component/schema.ts)). Its adapter maps Convex `_id` to Better Auth `id` and stores Better Auth dates as epoch-millisecond numbers ([Convex adapter mapping](https://github.com/get-convex/better-auth/blob/v0.12.5/src/client/adapter.ts)).

This makes a one-time transform feasible:

| Convex source | Neon target | Transform |
| --- | --- | --- |
| Better Auth `user` | `auth_user` | `_id -> id`; copy core fields; epoch ms -> `timestamptz`; drop Convex-only/plugin fields after asserting they are unused |
| Better Auth `account` | `auth_account` | `_id -> id`; preserve `userId`, `accountId`, `providerId`, `password`; epoch ms -> `timestamptz` |
| Better Auth `session` | `auth_session` | Only for the optional seamless-session path; same ID/date transform |
| Better Auth `verification` | `auth_verification` | Do not import; outstanding links are intentionally invalidated |
| Better Auth `jwks` | none | Do not import; it exists for the Convex JWT bridge being removed |
| Better Auth `rateLimit` | `auth_rate_limit` | Do not import; begin with empty counters |

Convex exports deployment data as a snapshot ZIP ([Convex data export](https://docs.convex.dev/database/import-export/export)). OctoMeta's existing snapshot demonstrates that component data is represented under `_components/<component>/...`; a dry-run export after Better Auth is enabled must confirm the exact `betterAuth` paths before the migration script is specified.

### Import rules

The migration program must:

1. accept an explicit snapshot path and refuse to run against a non-empty target unless a dedicated rehearsal/reset flag is present;
2. parse only an allowlist of Better Auth tables and fields;
3. import users before accounts, inside transactions;
4. preserve user and account IDs exactly;
5. convert every epoch-millisecond date explicitly and reject invalid dates;
6. treat password hashes as opaque secrets—never re-hash, decrypt, print, or include them in diagnostics;
7. preserve `emailVerified`;
8. preserve credential `providerId`, `accountId`, and `password`;
9. preserve Google `providerId` and `accountId`;
10. set Google access, refresh, and ID tokens to `NULL` unless a product requirement proves they are used outside sign-in;
11. reject duplicate users/emails, duplicate provider/account pairs, orphan account rows, and malformed required fields before committing;
12. emit only counts, IDs hashed for reconciliation, and non-sensitive validation results.

The export contains password hashes and may contain OAuth tokens. Store it encrypted, restrict access, avoid CI artifacts/logs, and destroy the working copy after the agreed retention window.

### Password compatibility

Password continuity is high confidence if the opaque value is copied unchanged:

- the current Convex integration and target both use Better Auth;
- neither current config nor the proposed target overrides password hashing;
- Better Auth stores password hashes in the credential account row and uses scrypt by default ([email/password storage](https://better-auth.com/docs/authentication/email-password#configuration), [security reference](https://better-auth.com/docs/reference/security#password-hashing)).

No plaintext password is needed. The cutover rehearsal must still create a dedicated credential test account in Convex, export/import it, and prove that its unchanged password signs in through Neon.

### Google compatibility

Google continuity requires importing the Google account row with its `providerId`, external `accountId`, and `userId`. Existing OAuth access/refresh tokens are not required for sign-in and can be discarded because OctoMeta currently uses Google only as an authentication method.

Keep the same client ID/secret and production base URL. Better Auth's default Google callback is `/api/auth/callback/google`, which is already OctoMeta's public callback path; the backend move is invisible to Google as long as the public origin and path remain unchanged ([Google provider](https://better-auth.com/docs/authentication/google)).

Production Google is currently intentionally disabled because production credentials have not been provisioned. Later specs must state whether the migration merely preserves conditional support or includes production Google enablement; these are different acceptance scopes.

### Magic-link compatibility

No existing magic-link token should survive the cutover. New requests use the same `authClient.signIn.magicLink` API and the same branded templates, while the server plugin writes its verification row to Neon and calls Resend directly. Better Auth's plugin creates/verifies the token and redirects to the requested callback URL ([magic-link plugin](https://better-auth.com/docs/plugins/magic-link)); the sender only delivers the supplied URL.

Use the official Resend Node SDK and fail the callback when `resend.emails.send` returns an error ([Resend send API](https://resend.com/docs/api-reference/emails/send-email)). The direct integration does not inherit the Convex Resend component's durable queue, retry, or callback state. If delivery retries and audit state remain requirements, specify them as an application email capability rather than hiding them inside auth.

## Session cutover options

### Option A — planned sign-in reset (recommended)

Import users and accounts only. Do not import `session`, `verification`, `jwks`, or rate-limit rows. Deploy the Neon-backed handler and expire/ignore the old Convex JWT and Better Auth cookies. All users sign in again using password, Google, or a new magic link.

Why this is the default:

- it avoids transferring active bearer-equivalent session tokens;
- it avoids coupling the cutover to exact cookie signing, names, attributes, and expiry;
- it gives a clean security boundary after moving the auth server;
- the stated production dataset has no meaningful activity that justifies the additional risk.

### Option B — preserve unexpired sessions (conditional)

This is technically possible because Better Auth stores the session token in the `session` row and the standard session cookie is signed using the Better Auth secret. The Convex plugin adds a separate `convex_jwt` cookie but also relies on the ordinary Better Auth session. Better Auth's default secure cookie behavior, database-backed session expiry, and session revocation are documented in its security reference ([sessions and cookies](https://better-auth.com/docs/reference/security#session-management)).

It requires all of the following:

- import every unexpired `session` row with the same `id`, `token`, `userId`, and dates;
- copy the exact production `BETTER_AUTH_SECRET`;
- keep the same public HTTPS origin, `/api/auth` base path, cookie prefix/name, path, `SameSite`, and secure-cookie behavior;
- keep the Better Auth version/config compatible for the cutover;
- verify in a production-like domain that a browser signed in before export remains signed in after switching;
- explicitly clear the obsolete `convex_jwt` cookie after acceptance.

If any rehearsal condition fails, fall back to Option A rather than adding a compatibility shim or dual-writing.

## No-dual-write cutover

Use a brief maintenance window:

1. Provision Neon through Vercel.
2. Apply the reviewed auth schema over the unpooled connection.
3. Rehearse export, transform, import, and verification on a Neon branch or disposable database.
4. Deploy the completed Neon-backed auth path to a preview environment and execute all auth flow tests.
5. Begin the cutover window and reject new sign-ups/sign-ins/magic-link requests on the Convex-backed production path.
6. Take the final Convex snapshot.
7. Run the one-way account import and integrity checks.
8. Deploy/switch production to the Neon-backed SvelteKit handler.
9. Run smoke and data reconciliation gates.
10. End maintenance.
11. Keep only the encrypted rollback snapshot for the agreed short retention; do not send production traffic or writes back to Convex.
12. After the acceptance window, remove Convex auth code/packages/configuration and decommission the component with the rest of Convex.

Rollback before any new Neon auth write can restore the previous deployment. After production sign-ins/sign-ups begin on Neon, rolling back to Convex would lose new auth state and is therefore not a safe rollback; the runbook must define that point of no return.

## Environment and secret inventory

| Variable | Target use | Migration rule |
| --- | --- | --- |
| `DATABASE_URL` | pooled Neon runtime connection | supplied by Vercel/Neon integration |
| `DATABASE_URL_UNPOOLED` | migrations/import/admin checks | never exposed to client bundles |
| `BETTER_AUTH_URL` | canonical production origin | set to `https://octometa.app`; may replace application-specific `SITE_URL` |
| `BETTER_AUTH_SECRET` | Better Auth signing/encryption | securely copy exact Convex production value for cutover; do not print it |
| `AUTH_TRUSTED_ORIGINS` | CSRF/redirect allowlist | production must not include localhost; Better Auth validates trusted origins ([security reference](https://better-auth.com/docs/reference/security#trusted-origins)) |
| `GOOGLE_CLIENT_ID` | optional Google provider | copy unchanged if provisioned |
| `GOOGLE_CLIENT_SECRET` | optional Google provider | copy unchanged if provisioned; server only |
| `RESEND_API_KEY` | direct magic-link email | use environment-specific sending-only key |
| `RESEND_WEBHOOK_SECRET` | delivery webhook verification, if retained | server only; not required merely to send magic links |
| sender address | `OctoMeta <waitlist@octometa.app>` today | make one server-owned constant/config and keep verified-domain alignment |

Remove `PUBLIC_CONVEX_URL`, `PUBLIC_CONVEX_SITE_URL`, Convex deployment variables, and Convex-only JWT/JWKS settings when the full backend cutover is accepted.

Do not rotate `BETTER_AUTH_SECRET`, Google credentials, and Resend credentials in the same change as the database migration. Better Auth supports non-destructive versioned secret rotation, but that should be a separately tested operation ([secret rotation](https://better-auth.com/docs/reference/security#secret-rotation)).

## Verification gates

### Automated

- generated auth schema snapshot/migration is stable for the pinned config;
- migration transform unit tests cover all source fields, `null`, dates, malformed rows, duplicate emails, duplicate provider accounts, and orphan foreign keys;
- credential hash is byte-for-byte unchanged after import;
- source/target counts match for users and credential/Google account rows;
- every account `userId` references an imported user;
- every product owner foreign key references an imported auth user where product data is retained;
- server hook returns typed locals and rejects a forged/missing cookie;
- `/app` redirects without a server-validated session;
- auth client no longer imports Convex plugins or bridge packages;
- dependency/boundary tests prove no auth code imports Convex;
- database-backed auth rate limiting returns `429` and a retry header at the configured threshold;
- secret scan passes.

### Production-like end to end

- create a dedicated pre-migration password account, import it, and sign in with its unchanged password;
- sign up with email/password, sign out, sign in, and reload an authenticated route;
- request a magic link, receive it through Resend, redeem it once, reject a replay, and land on the requested same-origin callback;
- verify expired and invalid magic links fail safely;
- if Google is in scope, verify the exact production callback URI, first sign-in, repeat sign-in, and linking behavior;
- verify sign-out clears the Better Auth session and obsolete Convex JWT cookie;
- verify a revoked/expired session is rejected;
- test the selected session cutover option on the production-like HTTPS domain;
- verify an offline workspace still opens only for the remembered owner and cannot call authenticated server APIs while offline;
- inspect function logs to ensure cookies, passwords, hashes, magic-link tokens, OAuth tokens, and connection strings are absent.

### Operational

- record source and target row counts by provider without sensitive values;
- record the final Convex snapshot checksum and encrypted storage location;
- record migration start/end, deployed commit, Neon branch/database, and point-of-no-return acknowledgement;
- verify Vercel production and preview environments point at the intended Neon branches;
- verify the unpooled URL is used only by controlled migration jobs;
- verify the old Convex auth endpoints no longer receive production traffic.

## Risks and mitigations

| Risk | Consequence | Mitigation |
| --- | --- | --- |
| Convex IDs inserted into UUID columns | import failure or changed user identity | generate `text` IDs/FKs and test preserved IDs before import |
| duplicate email/provider records tolerated by source | PostgreSQL unique constraint failure | preflight duplicates and resolve before maintenance |
| password hashes transformed or logged | account lockout or credential exposure | opaque byte-for-byte copy; redacted tests/logs |
| exact snapshot component path differs | migration reads no auth data | dry-run export and fixture the observed archive layout |
| runtime uses direct Neon connections | connection exhaustion under Vercel scaling | pooled runtime URL and module-scoped pool |
| migrations use pooled connection/session state | incomplete or inconsistent DDL | unpooled URL for schema/admin work |
| in-memory rate limiting | limits differ by function instance | database-backed auth rate-limit table |
| direct Resend call loses queue/retry behavior | transient delivery failures become user-visible | explicit error handling; specify durable email delivery separately if required |
| production Google remains unconfigured | button/flow cannot meet acceptance | keep provider conditional or provision credentials as explicit scope |
| session-preservation assumptions differ in production | unexpected sign-outs | default to planned re-auth; require HTTPS rehearsal for seamless option |
| auth library upgrade combined with data move | schema/cookie/hash ambiguity | pin the cutover version/config; upgrade separately after acceptance |
| rollback after new Neon writes | accounts created after cutover are lost | maintenance gate and explicit point of no return |

## Rejected options

- **Replace Better Auth.** No product requirement justifies changing identity systems; it would add password, OAuth, UI, and recovery migration work.
- **Write a custom Neon adapter.** Better Auth already supports PostgreSQL directly.
- **Keep the Convex auth component only.** This violates complete Convex removal and retains the proxy/token bridge.
- **Use Neon Auth.** This is a second identity migration, not a persistence migration.
- **Store auth rate limits in function memory.** It is not consistent across horizontally scaled serverless instances.
- **Rely on a non-default `search_path` over the pooled runtime URL.** Transaction pooling makes session-level state a poor application invariant.
- **Import JWT keys, verification tokens, and rate-limit rows.** They are transient Convex-era state with no account-continuity value.
- **Re-hash credential passwords.** Plaintext is unavailable and unnecessary; Better Auth's current hashes remain valid.
- **Preserve OAuth access/refresh tokens by default.** OctoMeta only needs the stable provider/account link for sign-in; retaining unused tokens increases migration sensitivity.
- **Dual-write Convex and Neon.** The agreed cutover uses a maintenance window and one-way import.
- **Run auth migrations at server startup.** Vercel cold starts are not a migration coordinator.

## Inputs required by later specifications

Later implementation specs must fix these inputs rather than rediscover them:

1. **Pinned cutover versions:** Better Auth, `pg`, SvelteKit, Vercel adapter, and Resend SDK.
2. **Migration owner:** Better Auth generated SQL applied by the repository's selected migration runner; no second tool may mutate the same auth tables.
3. **Physical names:** the five `auth_*` table names and exact generated column/index/foreign-key names.
4. **ID contract:** preserved Convex IDs and future IDs are `text`; product `ownerId` references `auth_user.id`.
5. **Observed source fixture:** redacted shape and exact paths from a current Convex snapshot containing Better Auth rows.
6. **Source inventory:** user/account/session counts, provider counts, duplicate-email/provider results, optional-field usage, and whether any Google token is used by product code.
7. **Session decision:** planned sign-in reset (default) or rehearsed session preservation.
8. **Google scope:** conditional support only or production enablement, with registered redirect URIs.
9. **Email delivery contract:** direct-send only, or durable retry/audit requirements beyond Better Auth.
10. **Environment matrix:** local, preview, and production origins, trusted origins, Neon branches, pooled/unpooled variables, and secret ownership.
11. **Runtime:** Node.js function runtime and pool sizing/idle settings.
12. **Migration program contract:** input flags, idempotency/refusal behavior, transaction boundaries, redaction, reconciliation output, and cleanup.
13. **Maintenance experience:** how auth writes are blocked and what users see during the final snapshot/import.
14. **Rollback boundary:** exact point of no return and encrypted snapshot retention/deletion policy.
15. **Acceptance fixtures:** dedicated password account, magic-link recipient, and Google test account if enabled.
16. **Security follow-up:** timing and method for post-cutover Better Auth secret rotation.

## Effort for the auth workstream

Assuming product data is reset and the planned sign-in reset is selected:

| Work | Optimistic | Likely | Pessimistic |
| --- | ---: | ---: | ---: |
| SvelteKit/Postgres auth integration and bridge removal | 1.0 d | 1.5 d | 2.5 d |
| generated schema and account transform/import tool | 1.0 d | 2.0 d | 3.0 d |
| automated/e2e verification and production-like rehearsal | 1.5 d | 2.5 d | 4.0 d |
| environment, Resend, cutover runbook, and production gates | 0.5 d | 1.0 d | 2.0 d |
| **Total** | **4.0 d** | **7.0 d** | **11.5 d** |

Add approximately 1–2 engineer-days if seamless session preservation is required. This estimate excludes the product persistence rewrite, waitlist migration, Vercel Blob, and general Convex deletion.

## Source set

Primary sources used:

- [Better Auth PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql)
- [Better Auth database/schema/CLI model](https://better-auth.com/docs/concepts/database)
- [Better Auth CLI](https://better-auth.com/docs/concepts/cli)
- [Better Auth SvelteKit integration](https://better-auth.com/docs/integrations/svelte-kit)
- [Better Auth email/password](https://better-auth.com/docs/authentication/email-password)
- [Better Auth magic-link plugin](https://better-auth.com/docs/plugins/magic-link)
- [Better Auth Google provider](https://better-auth.com/docs/authentication/google)
- [Better Auth sessions, cookies, secrets, and trusted origins](https://better-auth.com/docs/reference/security)
- [Better Auth rate limiting](https://better-auth.com/docs/concepts/rate-limit)
- [Convex Better Auth v0.12.5 component schema](https://github.com/get-convex/better-auth/blob/v0.12.5/src/component/schema.ts)
- [Convex Better Auth v0.12.5 adapter mapping](https://github.com/get-convex/better-auth/blob/v0.12.5/src/client/adapter.ts)
- [Convex snapshot export](https://docs.convex.dev/database/import-export/export)
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)
- [Neon/Vercel connection variables](https://neon.com/docs/changelog/2024-02-23)
- [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email)
