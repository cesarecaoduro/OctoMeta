# Production fit of Vercel-connected Neon for OctoMeta

**Research date:** 2026-07-23  
**Decision ticket:** [Validate the production fit of Vercel-connected Neon](https://github.com/cesarecaoduro/OctoMeta/issues/30)  
**Scope:** The database and SvelteKit server-runtime part of a complete Convex replacement. This does not select the final ORM, define DDL, or implement the migration.

## Decision

**A Vercel-managed Neon deployment is a production-fit replacement for the persistence part of OctoMeta's current Convex backend at the agreed early-production scale, with mandatory architectural constraints.**

The target should use:

- one Vercel-managed Neon **paid** project with its production root branch protected;
- Neon and Vercel Functions co-located in Sydney (`aws-ap-southeast-2` and `syd1`);
- the pooled `DATABASE_URL` for request-time application traffic and the direct `DATABASE_URL_UNPOOLED` for migrations, backup, and administration;
- short, explicit PostgreSQL transactions for ownership checks, idempotency, compare-and-swap version creation, and metadata finalization;
- an always-on production compute initially autoscaling from **0.5 to 2 CU**, validated and adjusted by load tests and working-set telemetry;
- a separate non-production Neon project, containing synthetic data only, for development and preview branches;
- tested point-in-time recovery plus scheduled snapshots and an independent `pg_dump` backup;
- an application-level staged chunk protocol for cloud-version bundles, because Vercel's 4.5 MB request/response limit is too close to OctoMeta's current 4 MiB canonical bundle ceiling to permit one JSON request safely.

This is a **conditional yes**, not a claim that connecting the Marketplace integration alone is sufficient. The conditions above must become specification requirements and release gates.

## Evaluation boundary

The agreed scale is:

- thousands of accounts;
- hundreds of concurrent HTTP requests;
- potentially large immutable document histories;
- explicit cloud saves rather than continuous edit synchronization;
- no realtime subscriptions, realtime collaboration, or global multi-region writes;
- browser-local working copies, with the backend used for authentication, explicit version operations, metadata, and asset bookkeeping.

That workload is materially friendlier to PostgreSQL than a continuous synchronization workload. OctoMeta's canonical model already requires stable product IDs, immutable cloud versions, expected-head compare-and-swap, operation idempotency, ownership isolation, asset reachability, and forward-only restore. Those invariants are described in the [local-first workspace specification](../specs/2026-07-22-local-first-document-workspace.md) and should be expressed with PostgreSQL constraints and transactions rather than copied from the Convex schema.

Neon is not the file store in this architecture. Vercel Blob holds image bytes; Neon holds ownership, content metadata, state, and version-to-asset reachability.

## Fit summary

| Concern | Finding | Production constraint |
| --- | --- | --- |
| Vercel integration | The Vercel-managed integration provisions the Neon account/project, bills through Vercel, injects pooled and direct connection variables, and can create preview branches. | Use the integration for provisioning and credentials, but treat Neon as ordinary PostgreSQL behind an application persistence boundary. |
| SvelteKit runtime | Vercel Functions support the required Node.js APIs and Fluid Compute can reuse a module-level connection pool across concurrent invocations. | Run database-backed SvelteKit routes in the Node.js runtime, in `syd1`, with a bounded global pool attached to the function lifecycle. |
| Connections | Neon PgBouncer accepts up to 10,000 clients, but backend concurrency is bounded by compute size and per-role/database pool size. | Use the pooled URL for the app, keep transactions short, expose pool wait metrics, and do not interpret “10,000 connections” as “10,000 simultaneous queries.” |
| Transactions | PostgreSQL provides the atomicity and locking needed for compare-and-swap and idempotency. Neon HTTP supports predetermined non-interactive transactions; interactive workflows require a transaction-capable connection. | Use one explicit transaction for final version creation. Retry only classified transient/serialization failures and preserve operation IDs across retries. |
| Large versions | Neon/PostgreSQL can store the data, but Vercel Functions cap request and response bodies at 4.5 MB. OctoMeta currently permits a 4 MiB canonical bundle before envelope overhead. | Stage chunks below a conservative wire limit, then hash-verify and finalize metadata in one database transaction. Never depend on a single 4 MiB JSON request succeeding. |
| Scale | Launch supports autoscaling up to 16 CU; Scale supports the same autoscaling ceiling and larger fixed computes. Storage supports up to 16 TB per paid branch by default. | Start at 0.5–2 CU, always on in production; load-test and scale the minimum to fit the active working set. |
| Region | Both providers have Sydney compute regions. Neon project region is immutable. | Create Neon in `aws-ap-southeast-2` and set Vercel Functions to `syd1` before importing accounts. A later region move is a database migration. |
| Recovery | Neon provides instant restore, snapshots, and standard `pg_dump`/`pg_restore` workflows. | Define RPO/RTO, test restoration, and maintain a provider-independent logical backup. |
| Security | TLS is mandatory; protected branches exist on paid plans. IP Allow, external telemetry, and an uptime SLA require Scale. Vercel outbound addresses are dynamic unless Static IPs or Secure Compute are enabled. | Separate owner/migration/runtime roles, protect production, keep secrets server-only, and decide explicitly whether Launch's public endpoint/no SLA posture is acceptable. |
| Preview branching | Native preview branches are copy-on-write branches, and auth data branches with the database. Cleanup is tied to Vercel deployment deletion and can lag for months by default. | Never branch production accounts or waitlist data into previews. Use a separate synthetic-data non-production project and explicit PR-close cleanup. |
| Observability | Neon supplies built-in database metrics; Scale adds metric/log export. | Instrument application query/transaction spans regardless of plan. If production requires durable cross-system alerting or an SLA, use Scale. |

## Connection path and runtime contract

### Provisioning and environment variables

The [Vercel-managed Neon integration](https://neon.com/docs/guides/vercel-managed-integration) creates or attaches a Neon organization and project, routes billing through Vercel, and injects:

- `DATABASE_URL`: pooled PgBouncer connection string;
- `DATABASE_URL_UNPOOLED`: direct PostgreSQL connection string;
- `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`, `PGDATABASE`, and `PGPASSWORD`;
- legacy `POSTGRES_*` aliases.

Branch-specific preview credentials are injected at deployment time and are not visible as ordinary Vercel project environment variables. Configuration and plan changes for a Vercel-managed database are performed through Vercel, while querying and most database operations remain available in the Neon Console.

The integration is an ownership, billing, and credential-distribution convenience. Application code should consume a generic PostgreSQL connection contract and must not couple domain logic to the Neon management API.

### Runtime connection

[Neon connection pooling](https://neon.com/docs/connect/connection-pooling) uses PgBouncer in transaction mode:

- up to 10,000 client connections can be accepted;
- backend connection capacity varies with compute size;
- `default_pool_size` is 90% of PostgreSQL `max_connections` per role/database pool;
- a queued query has a 120-second `query_wait_timeout`;
- session-level `SET`, `LISTEN`/`NOTIFY`, session advisory locks, and some temporary-table behavior do not survive transaction pooling.

The current Neon table lists 209 total PostgreSQL connections at 0.5 CU and 839 at 2 CU, before reserved connections. Those are backend limits, not a reason to make the application pool that large.

[Vercel's current guidance](https://vercel.com/kb/guide/connection-pooling-with-functions) for Fluid Compute is to initialize a bounded pool in module scope, attach it with `attachDatabasePool`, use a short idle timeout, acquire and release clients per request, and avoid a maximum pool size of one. The specification should choose the exact pool size through load testing; a starting cap in the low single digits per function instance is safer than copying Neon's backend limit.

Required runtime behavior:

1. use `DATABASE_URL`, never the owner/direct URL, for ordinary requests;
2. acquire a client only for the database portion of the request;
3. release it in `finally`;
4. set finite connect, statement, lock, and application request timeouts;
5. record pool wait time separately from query execution time;
6. qualify schema names rather than depending on per-session `search_path`;
7. reconnect on stale connections after maintenance or compute restart.

### Driver modes

The [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver) provides two distinct modes:

- HTTP for a single query or a predetermined, non-interactive array of queries;
- WebSocket `Pool`/`Client` for sessions, result-dependent interactive transactions, and `node-postgres` compatibility.

OctoMeta's final save operation has result-dependent checks and needs a clear transaction boundary. The later specification may use a PostgreSQL-compatible pool (standard TCP or Neon WebSocket) or reduce the whole operation to one well-reviewed SQL statement/function, but it must not model a result-dependent workflow as separate HTTP queries that can partially commit.

The ORM/query-builder choice remains open. The required capability is more important than the library: parameterized SQL, interactive transactions, row-count inspection for compare-and-swap, constraint error classification, and migration generation or execution from checked-in files.

## Transaction and concurrency behavior

The following operations belong in one short PostgreSQL transaction:

1. authenticate at the SvelteKit boundary and derive the stable Better Auth subject;
2. confirm ownership and live/trash state;
3. claim or re-read the durable operation ID and input hash;
4. lock or conditionally update the document head;
5. validate expected head/version;
6. validate staged chunk and asset metadata;
7. insert the immutable version and reachability rows;
8. advance the document head with a compare-and-swap predicate;
9. mark the operation committed;
10. commit.

The database must enforce, at minimum:

- unique `(document_id, version_number)`;
- unique operation ID and a stable operation-input hash;
- foreign keys for document/version/chunk/asset reachability;
- check constraints for chunk order, counts, sizes, and lifecycle states;
- no update/delete path for retained immutable version content in the application role;
- an atomic head update whose affected-row count distinguishes success from `REVISION_CONFLICT`.

PostgreSQL's default `READ COMMITTED` isolation plus conditional updates or row locks is likely sufficient for the head compare-and-swap. If a later design chooses `SERIALIZABLE`, PostgreSQL explicitly requires retrying whole transactions after serialization failures; deadlocks likewise abort one transaction and must be retried from the beginning ([PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html), [explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)).

Retry rules must be specified, not delegated to a generic retry wrapper:

- reuse the same operation ID and input hash;
- retry only transient connection failures, deadlocks, and serialization failures;
- use bounded exponential backoff with jitter;
- do not blindly retry validation, authorization, uniqueness, size, or revision conflicts;
- after an ambiguous network failure, read the operation record before attempting another commit.

## The Vercel payload limit is a design constraint

[Vercel Functions limit request and response bodies to 4.5 MB](https://vercel.com/docs/functions/limitations#request-body-size). OctoMeta currently sets `BUNDLE_BYTE_LIMIT` to 4 MiB in `src/lib/persistence/canonical.ts`. A 4 MiB canonical payload wrapped in JSON, hashes, metadata, and encoding can exceed Vercel's hard limit even though the canonical bytes themselves pass application validation.

The later specification must define a staged protocol:

1. create or resume an operation with document ID, expected head, canonical bundle hash, total bytes, and chunk manifest;
2. upload bounded chunks independently and idempotently;
3. store staged chunk rows or staged Blob objects keyed by operation and ordinal;
4. validate per-chunk hash, total byte count, complete ordinal range, and expiry;
5. finalize the immutable version and head update in one PostgreSQL transaction;
6. garbage-collect abandoned stages after a defined retention period;
7. load large versions through bounded chunk responses or a controlled streaming/download path.

The exact wire ceiling should leave meaningful margin under 4.5 MB for headers and envelope overhead. Reusing the existing approximately 700 KiB logical chunk target is safe in principle, but its final value and encoding must be verified by end-to-end tests on Vercel.

Direct browser-to-Blob upload is the correct path for images above the function limit; [Vercel explicitly recommends client uploads for large bodies](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions). That does not remove the need for authenticated token issuance, byte/content validation, durable staging, and transactional reachability finalization in Neon.

## Migrations and release order

Neon recommends the direct connection for schema migrations, `pg_dump`, and administration because transaction pooling does not preserve the session behavior many tools expect ([connection pooling guidance](https://neon.com/docs/connect/connection-pooling#when-to-use-pooled-vs-direct-connections)).

Required migration model:

- schema and migrations are checked into the repository;
- generated production SQL is reviewed;
- preview migrations run against isolated non-production branches using the direct URL;
- production migrations run exactly once from a controlled CI/release job, not from every concurrently building Vercel deployment;
- a transaction-level advisory lock or migration tool lock serializes migration runners;
- changes use expand/migrate/contract ordering when old and new deployments can overlap;
- destructive or table-rewriting changes have an explicit lock-duration and rollback analysis;
- application promotion follows successful migration and smoke verification;
- migration credentials are not available to request-time application code.

The Vercel integration documentation shows migrations in a preview build step as an available workflow. That is reasonable for isolated preview branches. It should not be copied to production because concurrent/retried builds can race and because a build failure is not a production migration rollback strategy.

The initial cutover does not need Convex/Neon dual writes. It should:

1. establish the final Neon schema;
2. verify a clean product schema;
3. migrate and reconcile Better Auth account data and waitlist records;
4. deploy the Neon-backed application while Convex remains unchanged but no longer receives traffic;
5. run post-cutover integrity and authentication checks;
6. remove Convex only after those gates pass.

## Region and topology

[Neon supports AWS Sydney](https://neon.com/docs/introduction/regions) as `aws-ap-southeast-2`. [Vercel supports Sydney](https://vercel.com/docs/regions#region-list) as `syd1`, also corresponding to `ap-southeast-2`. Vercel states that Functions should run close to their data source and otherwise defaults new projects to `iad1` in the United States ([Vercel Function regions](https://vercel.com/docs/functions/configuring-functions/region)).

Therefore:

- create the production Neon project in AWS Sydney;
- configure all database-backed SvelteKit Functions in `syd1`;
- verify the deployed function region in Vercel's deployment summary;
- keep static content on Vercel's global CDN;
- do not deploy database-writing functions to several regions against one Sydney writer.

Neon project region is immutable. Moving later means creating a new project and migrating data. Region selection must therefore be an explicit provisioning acceptance check before account import.

A Sydney Vercel Function failover region would still depend on a single-region Sydney Neon writer and would add cross-region latency. Multi-region Functions, read replicas, and regional failover are rejected for this phase; they do not solve the agreed problem and could disguise a database-region outage as a partially available application.

## Autoscaling and capacity

[Neon autoscaling](https://neon.com/docs/introduction/autoscaling) changes compute within configured minimum/maximum bounds without a restart. The [current plan limits](https://neon.com/docs/introduction/plans) allow up to 16 CU autoscaling on Launch and Scale; Scale additionally permits fixed computes up to 56 CU. Paid branch storage supports 16 TB logical size by default.

Recommended initial production setting:

- Launch or Scale paid plan;
- autoscaling minimum **0.5 CU** (2 GB RAM);
- autoscaling maximum **2 CU** (8 GB RAM);
- scale-to-zero disabled;
- no read replica initially.

This is a starting hypothesis, not a capacity guarantee. Before cutover, a load test must exercise authentication, document list/history reads, concurrent staged chunk uploads, version finalization, trash operations, and cleanup queries at and above the agreed hundreds-of-requests burst. Raise the minimum if the working set does not fit the Local File Cache or if p95 latency spikes when the compute scales down.

[Scale to zero](https://neon.com/docs/introduction/scale-to-zero) reactivates an idle compute in a few hundred milliseconds, but Neon recommends deciding explicitly whether this latency is acceptable for production. OctoMeta authentication and explicit saves are user-facing and should not inherit avoidable cold starts, so production should stay active. Enable scale-to-zero on development and preview computes.

The pooler protects backend connections; it does not create compute capacity. Capacity signals are:

- CPU and RAM saturation;
- pool client versus server connections;
- pool wait duration and 120-second queue timeouts;
- query p50/p95/p99;
- Local File Cache hit rate and working-set size;
- transaction duration, deadlocks, and serialization retries;
- storage, WAL/history, and public network transfer growth.

## Security model

[Neon requires TLS](https://neon.com/docs/security/security-overview) and supports `sslmode=verify-full`; data at rest is encrypted. Production must additionally enforce application-level least privilege:

- **owner/bootstrap role:** retained for controlled ownership operations, never exposed to the app;
- **migration role:** DDL and migration-history privileges, CI only;
- **runtime role:** only the schemas, tables, sequences, and functions required by the application;
- **backup role:** read-only privileges sufficient for logical backup, if separated from migration.

The runtime connection must not use `neondb_owner`. Authorization remains mandatory in SvelteKit services and repositories. PostgreSQL row-level security may be added as defense in depth, but it must not replace request authentication or repository authorization tests.

Mark the production root branch protected. Paid plans prevent protected branches, their project, and their compute from accidental deletion/reset; child branches receive new role passwords ([protected branch behavior](https://neon.com/docs/guides/protected-branches)).

Important Vercel-managed integration consequence: most ordinary Vercel Owner/Admin/Member roles map to Neon **Admin**, while read-only Vercel roles map to Neon Member. Team membership is therefore a database administrative boundary. Limit Vercel team membership, review it periodically, and use least privilege inside PostgreSQL even if console roles remain broad ([integration role mapping](https://neon.com/docs/guides/vercel-managed-integration#frequently-asked-questions-faq)).

Launch exposes the TLS-protected database endpoint publicly. Neon IP Allow and Private Networking require Scale. Vercel Functions use dynamic outbound addresses by default; [Vercel Static IPs](https://vercel.com/kb/guide/how-to-allowlist-deployment-ip-address) on Pro/Enterprise provide stable shared regional egress addresses suitable for a Neon allowlist, while Secure Compute is the dedicated Enterprise option. The production specification must make one of these choices:

1. **Launch baseline:** public TLS endpoint, strong generated secret, least-privilege runtime role, protected branch, credential rotation and monitoring; or
2. **Scale hardened:** Vercel Static IPs plus Neon IP Allow, with Scale's SLA and exported telemetry.

PrivateLink/Secure Compute is not required at the agreed scale and should be revisited only for a compliance or dedicated-network requirement.

## Backups, PITR, and recovery

[Neon's backup guidance](https://neon.com/docs/manage/backups) separates:

- instant restore/PITR for fast recovery within the configured history window;
- snapshots for stable restore points;
- `pg_dump`/`pg_restore` for provider-independent business continuity and disaster recovery.

The [current paid-plan limits](https://neon.com/docs/introduction/plans) are:

- Launch: up to 7 days of history, 100 manual snapshots;
- Scale: up to 30 days of history, 100 manual snapshots;
- scheduled snapshots on paid plans;
- instant-restore history at $0.20/GB-month and snapshots at $0.09/GB-month.

Required baseline:

- protect the production root branch;
- configure a history window only after defining RPO;
- schedule snapshots;
- automate a regular `pg_dump` through `DATABASE_URL_UNPOOLED` into storage outside the Neon project;
- encrypt and retain backups under a documented policy;
- perform a restore drill before cutover and periodically afterward;
- verify accounts, sessions policy, waitlist counts, document/version constraints, and asset references after restoration.

PITR is not a substitute for a provider-independent backup. Deleting the Vercel-managed database permanently deletes the underlying Neon project, so the operator runbook must make database deletion a separately approved action and must prove a recent external backup before destructive changes.

## Development and preview branches

The native integration can create a copy-on-write branch for each Vercel preview deployment, and its documentation states that authentication data branches with the database. A production-derived preview would therefore copy Better Auth and waitlist data into a wider development access surface.

Required environment topology:

- **production project:** connected only to Vercel Production; contains real accounts, waitlist, and product data;
- **non-production project:** connected only to Development and Preview; contains synthetic accounts and seed data;
- preview branches derive only from the non-production root;
- migrations run against preview branches before preview application tests;
- no preview receives a production connection string.

Vercel-managed preview cleanup is tied to deletion of the last corresponding Vercel deployment, not to PR closure. With Vercel's default retention, branches can persist for roughly six months. Configure a short pre-production deployment retention and add an explicit PR-close branch cleanup workflow; stale archived branches still count toward plan allowances and can add cost ([Neon preview cleanup guidance](https://neon.com/docs/guides/vercel-branch-cleanup)).

Restoring a deleted Vercel preview does not restore its deleted Neon branch. Preview deployments are disposable, and the team should create a fresh deployment rather than promise long-lived preview recovery.

## Observability and operational gates

[Neon monitoring](https://neon.com/docs/introduction/monitoring) includes compute, database, query, connection, system-operation, and usage views. The plan controls history and export:

- Launch: 3 days of in-console monitoring, no metrics/log export;
- Scale: 14 days and Datadog/OpenTelemetry export.

The application must emit correlated telemetry independently of plan:

- endpoint, operation type, deployment, and region;
- database acquisition wait and query duration;
- SQLSTATE/error class without SQL parameters or user content;
- transaction attempts and retry reason;
- CAS conflict and idempotent replay counts;
- staged bytes/chunks, finalize duration, and abandoned-stage cleanup;
- connection failures and pool saturation;
- backup, snapshot, restore-drill, migration, and cleanup outcomes.

Create dashboards and alerts for:

- p95/p99 API and database latency;
- error rate by transient/permanent class;
- connection and query queue saturation;
- CPU/RAM and Local File Cache pressure;
- deadlocks and long-running transactions;
- backup age and restore-drill status;
- database, history, snapshot, branch, and egress cost growth.

Scale is the production recommendation if OctoMeta needs a provider SLA, more than three days of database telemetry, direct support, IP Allow, or external metrics/log export. [Neon's SLA](https://neon.com/sla) currently covers Scale and Business compute endpoints with a 99.95% threshold for service credits; it does not cover every control-plane or platform function.

Launch is technically sufficient for the agreed capacity and is a defensible early-production choice only if the owner explicitly accepts:

- no uptime SLA;
- billing-only support;
- public endpoint without Neon IP Allow;
- three-day in-console monitoring and no database telemetry export;
- a seven-day maximum PITR history.

This risk acceptance belongs in the eventual architecture decision and launch checklist.

## Failure modes and required responses

| Failure | User-visible risk | Required design response |
| --- | --- | --- |
| Vercel payload exceeds 4.5 MB | Save/load fails with 413 or oversized response error. | Stage and load bounded chunks; enforce wire limits below the platform maximum. |
| Compute restart or maintenance | Connection is dropped during a request. | Pool reconnect; bounded retry only before/around idempotent transactions; test by triggering a Neon restart. |
| Commit succeeds but response is lost | User retries and could create a duplicate version. | Durable operation ID/input hash; reconcile operation status before replay. |
| Two saves target the same head | Lost update or silent overwrite. | Conditional head update in the final transaction; return `REVISION_CONFLICT`. |
| PgBouncer backend pool saturates | Queries queue and eventually time out. | Short transactions, small application pools, wait-time alerting, query optimization, and compute scaling. |
| Long transaction or inconsistent lock order | Lock waits or deadlock. | Fixed lock order, finite lock/statement timeout, whole-transaction retry for deadlock only. |
| Production compute scales to zero | First auth/save request experiences cold start or timeout. | Disable production scale-to-zero; retain it for non-production. |
| Migration races with deployments | Partial release, lock contention, or incompatible code/schema. | One controlled migration job using direct URL and migration lock; expand/contract compatibility. |
| Preview is branched from production | Account/waitlist PII is exposed to development access. | Separate synthetic-data non-production project; never connect production to Preview/Development. |
| Preview cleanup lags | Branch allowance and storage cost grow. | PR-close deletion plus short Vercel retention; monitor branch age/count. |
| Region mismatch | Every request pays cross-region latency. | Provision Neon Sydney and configure/verify Vercel `syd1`. |
| Accidental database deletion | Underlying Neon project is permanently removed. | Protected production branch, restricted admin membership, destructive-action approval, external backup. |
| Restore succeeds technically but is inconsistent operationally | Authentication or asset references remain broken. | Restore drill with domain integrity checks and a documented connection cutover procedure. |
| Provider/region outage | Database-backed behavior is unavailable. | Honest degraded UI, local working-copy continuity, regional status monitoring, and a tested recovery path; no false multi-region claim. |

## Cost drivers

Neon paid usage is primarily driven by:

1. **compute:** average CU size multiplied by active hours;
2. **root database storage:** actual GB-months;
3. **instant-restore history:** WAL/change volume retained within the history window;
4. **snapshots:** retained full and incremental snapshot GB-months;
5. **public network transfer:** database results and backup/export traffic;
6. **preview branches:** additional branch count, compute while active, and accumulated change storage;
7. **read replicas:** an additional compute, if introduced.

Current published direct Neon rates are [$0.106/CU-hour on Launch and $0.222/CU-hour on Scale](https://neon.com/docs/introduction/plans), $0.35/GB-month database storage, $0.20/GB-month instant-restore history, $0.09/GB-month snapshot storage, and $1.50 per extra branch-month. The Vercel Marketplace price shown at provisioning is the commercial source of truth for a Vercel-managed installation.

OctoMeta-specific cost pressure comes from immutable histories:

- every cloud version adds canonical bundle bytes rather than replacing the previous version;
- writes also create PITR history;
- repeated version downloads consume public network transfer;
- production-derived preview branches would amplify sensitive data and changes.

The specification should require bounded history pagination, on-demand version content loading, no `SELECT *` over content rows, retention/archival policy decisions, per-version byte accounting, and cost alerts. Images remain in Blob so their bytes do not inflate PostgreSQL storage, WAL, backup, and database egress simultaneously.

Vercel adds separate Function CPU, provisioned-memory, invocation, Static IP/Secure Compute, and Blob costs. Database I/O wait does not count as active Function CPU under Fluid Compute, but provisioned memory and invocation usage still apply ([Vercel Function pricing](https://vercel.com/docs/functions/usage-and-pricing)).

## Rejected options

### Free Neon plan for production

Rejected. Neon's own [production checklist](https://neon.com/docs/get-started/production-checklist) recommends a paid plan; Free has usage limits, mandatory scale-to-zero, a short history window, and no production support posture.

### Direct/unpooled URL for request traffic

Rejected. It exposes the smaller backend connection limit to serverless concurrency and loses PgBouncer protection. Direct connections are reserved for migrations, backup, and administration.

### HTTP-only database access for every workflow

Rejected. HTTP is attractive for one-shot queries, but OctoMeta's result-dependent finalization needs an interactive transaction or a single atomic SQL unit.

### One request containing the maximum canonical bundle

Rejected. A 4 MiB bundle plus transport overhead is not safely below Vercel's 4.5 MB body limit.

### Production-derived Vercel preview branches

Rejected. They would copy account and waitlist data into preview environments. The convenience does not justify the privacy and access expansion.

### Multi-region write Functions or read replicas now

Rejected. The agreed architecture has one Sydney writer and no global-write requirement. Multiple Function regions would add distance to the writer; read replicas do not improve explicit save availability.

### Production scale-to-zero

Rejected for the initial baseline. It saves compute but creates avoidable latency and reconnection behavior on user-facing authentication and save requests.

### Running production migrations in every Vercel build

Rejected. Production schema change must have one owner, one lock, explicit ordering, and independent verification.

### PITR as the only backup

Rejected. It does not provide the provider-independent recovery and deletion protection of a logical backup.

## Inputs that must move into specifications

### Database and repositories

- DDL for accounts integration, waitlist, documents, versions, chunks, operations, assets, version assets, trash/retention, cleanup claims, and migration history.
- Stable ID types and all unique, foreign-key, check, and immutability constraints.
- Runtime, migration, owner, and backup role grants.
- Repository API signatures and transaction ownership.
- SQLSTATE-to-domain-error mapping and retry policy.
- Compare-and-swap and idempotent replay behavior.

### SvelteKit API

- Node.js runtime and `syd1` deployment configuration.
- Authentication/authorization middleware and server-only database module.
- Pool size, timeouts, lifecycle attachment, and instrumentation.
- Staged chunk request/response schemas, limits, hashing, expiry, resume, finalization, load, and cleanup.
- Direct-to-Blob image token, completion, validation, and reachability flow.
- Honest degraded/offline behavior when database operations are unavailable.

### Migrations and cutover

- Migration tool and checked-in file format.
- Direct connection secret scope and serialized migration runner.
- Expand/contract rules and production deployment order.
- Better Auth and waitlist extraction, transformation, reconciliation, and rejection reports.
- No-dual-write cutover steps, smoke checks, and Convex-removal gates.
- Rollback before and after traffic switch.

### Environments and operations

- Separate production and synthetic non-production Neon projects.
- Production protected root, non-production preview parent, seed process, and PR-close cleanup.
- Sydney region verification.
- 0.5–2 CU initial settings and production scale-to-zero disabled.
- Load-test dataset, concurrency profile, pass/fail thresholds, and scaling triggers.
- Plan-tier risk acceptance: Launch versus Scale.
- Secret rotation and administrative access review.

### Recovery and observability

- Explicit RPO and RTO.
- PITR window, snapshot schedule, `pg_dump` schedule, retention, encryption, and restore location.
- Restore drill and domain integrity checks.
- Application and database telemetry fields, dashboards, alerts, and retention.
- Cost budgets and alerts for compute, storage, history, snapshots, branches, egress, Functions, Blob, and static networking.

## Acceptance gates for the later implementation

1. Vercel production Functions are verified in `syd1`; Neon production is verified in `aws-ap-southeast-2`.
2. Production and non-production projects cannot receive each other's environment variables.
3. Production root is protected and real data cannot be copied to a preview.
4. Request traffic uses a least-privilege pooled role; migration and backup use separately scoped direct credentials.
5. A load test at the agreed burst shows acceptable p95/p99 latency without pool timeouts, connection exhaustion, or transaction anomalies.
6. A maximum-size authored bundle saves and loads through the staged protocol without approaching Vercel's 4.5 MB boundary.
7. Concurrent saves produce one committed version and one explicit conflict, never a lost update.
8. Replaying an operation after an intentionally dropped response returns the original committed result.
9. A forced Neon compute restart proves reconnection and classified retry behavior.
10. Preview migrations and cleanup work without production access.
11. Better Auth accounts and waitlist counts reconcile exactly at cutover.
12. PITR, snapshot restore, and independent `pg_dump` restore are exercised and domain invariants verified.
13. Dashboards and alerts expose pool wait, query latency, retries, deadlocks, storage/history growth, branch growth, backup age, and cost.
14. Convex removal is blocked until Neon, Blob, auth, email/webhook, cron/cleanup, recovery, and rollback gates all pass.

## Primary sources

- [Neon: Vercel-managed integration](https://neon.com/docs/guides/vercel-managed-integration)
- [Neon: Connection pooling](https://neon.com/docs/connect/connection-pooling)
- [Neon: Serverless driver](https://neon.com/docs/serverless/serverless-driver)
- [Neon: Production checklist](https://neon.com/docs/get-started/production-checklist)
- [Neon: Plans and limits](https://neon.com/docs/introduction/plans)
- [Neon: Regions](https://neon.com/docs/introduction/regions)
- [Neon: Autoscaling](https://neon.com/docs/introduction/autoscaling)
- [Neon: Scale to zero](https://neon.com/docs/introduction/scale-to-zero)
- [Neon: Security overview](https://neon.com/docs/security/security-overview)
- [Neon: Protected branches](https://neon.com/docs/guides/protected-branches)
- [Neon: Backups](https://neon.com/docs/manage/backups)
- [Neon: Monitoring](https://neon.com/docs/introduction/monitoring)
- [Neon: Vercel preview branch cleanup](https://neon.com/docs/guides/vercel-branch-cleanup)
- [Neon: Service Level Agreement](https://neon.com/sla)
- [Vercel: Function regions](https://vercel.com/docs/functions/configuring-functions/region)
- [Vercel: Global regions](https://vercel.com/docs/regions)
- [Vercel: Connection pooling with Functions](https://vercel.com/kb/guide/connection-pooling-with-functions)
- [Vercel: Function limits](https://vercel.com/docs/functions/limitations)
- [Vercel: Static IP allowlisting](https://vercel.com/kb/guide/how-to-allowlist-deployment-ip-address)
- [Vercel: Function usage and pricing](https://vercel.com/docs/functions/usage-and-pricing)
- [PostgreSQL: Transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
- [PostgreSQL: Explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)
