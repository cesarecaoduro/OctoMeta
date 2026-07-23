# Vercel Blob and background operations without Convex

**Date:** 2026-07-23  
**Status:** Decision-ready research for specification handoff  
**Issue:** [#32 — Validate private Blob storage and Vercel background operations](https://github.com/cesarecaoduro/OctoMeta/issues/32)  
**Scope:** Private Vercel Blob, SvelteKit/Vercel Functions, Vercel Cron, direct
Resend integration, and any additional asynchronous infrastructure needed to
replace Convex storage, actions, scheduled functions, and the Resend component.

## Decision

Use this target:

- Vercel Private Blob for immutable asset bytes, authenticated from server code
  with Vercel OIDC.
- Neon for upload intents, ownership, asset metadata, lifecycle state, job
  leases, a transactional email outbox, and webhook deduplication.
- SvelteKit server routes for authorization, signed-URL issuance, upload
  finalization, webhooks, and bounded maintenance workers.
- Vercel Cron as a wake-up mechanism only. Durable state and retry schedules
  live in Neon because Cron does not retry failed invocations and may overlap or
  duplicate them.
- Direct Resend API calls from an outbox worker, with deterministic Resend
  idempotency keys and a signed, deduplicating webhook route.

No additional managed queue or workflow product is required at the agreed
early-growth scale. A Neon outbox and bounded leased workers are required;
calling Resend directly from the request path or relying only on `waitUntil`
would weaken the guarantees currently supplied by `@convex-dev/resend`.

Private Blob is no longer a beta risk: Vercel announced general availability on
2026-06-30, including private stores, signed URLs, and OIDC authentication
([Vercel Private Blob GA](https://vercel.com/changelog/vercel-private-blob-is-now-generally-available)).
The current stable SDK is `@vercel/blob@2.6.1`, which is also the release Vercel
requires for consistent private reads
([consistent private reads](https://vercel.com/changelog/vercel-blob-now-supports-consistent-reads-on-private-storage)).

## What must be replaced

At commit
[`317708a`](https://github.com/cesarecaoduro/OctoMeta/tree/317708a02d90c1df6635a6642e06f2a7afd0dbdb),
Convex supplies more than byte storage:

- Uploads are authenticated, capped at 10 MiB, checked against PNG/JPEG/WebP/GIF
  magic bytes and declared MIME, and claimed against exactly one live owned
  document
  ([`files.ts` lines 8–68](https://github.com/cesarecaoduro/OctoMeta/blob/317708a02d90c1df6635a6642e06f2a7afd0dbdb/src/convex/files.ts#L8-L68)).
- File resolution rechecks the asset, owner, claim state, document ownership,
  and trash state before returning a URL
  ([`files.ts` lines 70–86](https://github.com/cesarecaoduro/OctoMeta/blob/317708a02d90c1df6635a6642e06f2a7afd0dbdb/src/convex/files.ts#L70-L86)).
- Unreachable and failed-deletion assets have durable state, exponential
  backoff, and bounded hourly cleanup
  ([`files.ts` lines 88–146](https://github.com/cesarecaoduro/OctoMeta/blob/317708a02d90c1df6635a6642e06f2a7afd0dbdb/src/convex/files.ts#L88-L146)).
- Three schedules purge finalized email records, 30-day document trash, and
  assets
  ([`crons.ts` lines 5–24](https://github.com/cesarecaoduro/OctoMeta/blob/317708a02d90c1df6635a6642e06f2a7afd0dbdb/src/convex/crons.ts#L5-L24)).
- Waitlist confirmation and administrator notification emails are queued
  without making signup success depend on email delivery
  ([`waitlist.ts` lines 11–78](https://github.com/cesarecaoduro/OctoMeta/blob/317708a02d90c1df6635a6642e06f2a7afd0dbdb/src/convex/waitlist.ts#L11-L78)).
- Better Auth magic links also use the same queued Resend component, so the
  replacement email executor is an authentication dependency, not only a
  marketing dependency
  ([`auth.ts` lines 33–54](https://github.com/cesarecaoduro/OctoMeta/blob/317708a02d90c1df6635a6642e06f2a7afd0dbdb/src/convex/auth.ts#L33-L54)).
- The pinned Resend component provides queueing, batching, durable execution,
  retry, idempotency, rate limiting, delivery-event storage, and cleanup. These
  are the component's stated guarantees
  ([`@convex-dev/resend` v0.2.5 README](https://github.com/get-convex/resend/blob/v0.2.5/README.md));
  OctoMeta explicitly relies on them
  ([`emails.ts` lines 5–16](https://github.com/cesarecaoduro/OctoMeta/blob/317708a02d90c1df6635a6642e06f2a7afd0dbdb/src/convex/emails.ts#L5-L16)).

Therefore, replacing Blob alone is insufficient. Ownership, durable state,
leases, retry policy, idempotency, and operations are part of the replacement.

## Official platform findings

### Vercel Private Blob

The relevant current behavior is:

| Concern | Official behavior | Design consequence |
| --- | --- | --- |
| Product maturity | Private Blob, signed URLs, and OIDC are GA on all plans. | Acceptable production dependency. |
| Server credentials | New Blob connections use short-lived, automatically rotating Vercel OIDC rather than a long-lived read/write token. | Prefer OIDC; do not introduce `BLOB_READ_WRITE_TOKEN` in production unless a non-Vercel execution path later requires it. |
| Capability URLs | A signed URL is scoped to one operation (`put`, `get`, `head`, or `delete`), one pathname, and an expiry of at most seven days. | Authorize in SvelteKit, then mint a short-lived exact-path capability. Never expose store credentials. |
| Browser upload | Signed `put` URLs let the browser stream directly to Blob without routing bytes through the Function. | Avoids Function payload and transfer limits. |
| Read consistency | A new unique pathname is read-after-write consistent. Overwrites can serve a cached prior value for up to 60 seconds; `useCache: false` bypasses it. | Use immutable unique pathnames and no overwrite. Use `useCache: false` during upload validation. |
| Blob limits | A blob may be up to 5 TB; multipart is recommended beyond 100 MB. Pro rate limits are 120 simple and 75 advanced operations per second. | OctoMeta's 10 MiB cap is far inside the service envelope. Keep cleanup bounded and rate-aware. |
| Delivery | Private files can be streamed through an authenticated Function. Signed GET URLs can instead remove the Function from the byte path. | Prefer a five-minute signed GET after an ownership check. Retain proxy delivery as the stricter revocation/WAF option. |
| Mutability | Vercel recommends immutable pathnames; overwrites have cache-propagation behavior. Conditional delete supports an ETag. | Generate a unique pathname per upload and store its ETag. Never overwrite an asset pathname. |

Sources:

- [Private Blob GA, OIDC, and signed URLs](https://vercel.com/changelog/vercel-private-blob-is-now-generally-available)
- [Signed URL operation, pathname, expiry, upload, and conditional-delete behavior](https://vercel.com/changelog/signed-urls-are-now-available-for-vercel-blob)
- [Consistent private reads and `useCache: false`](https://vercel.com/changelog/vercel-blob-now-supports-consistent-reads-on-private-storage)
- [Blob limits and operation rates](https://vercel.com/docs/vercel-blob/usage-and-pricing)
- [Private delivery and caching guidance](https://vercel.com/docs/vercel-blob/private-storage)
- [SDK options, metadata, and client upload constraints](https://vercel.com/docs/vercel-blob/using-blob-sdk)

Signed URLs are bearer capabilities. Anyone holding one can use the permitted
operation until it expires. A five-minute signed GET is suitable for
owner-only document images and scales better than proxying every image through
SvelteKit. If later requirements demand immediate revocation, per-request WAF
evaluation, or auditable reads, switch that use case to the authenticated proxy
pattern with `Cache-Control: private, no-cache` and `X-Content-Type-Options:
nosniff`; Vercel documents that pattern
([private delivery](https://vercel.com/docs/vercel-blob/private-storage)).

### Vercel Functions

With Fluid compute, Node.js/SvelteKit functions default to 300 seconds. Hobby
tops out at 300 seconds; Pro and Enterprise can be configured to 800 seconds.
Functions auto-scale up to 30,000 concurrent invocations on Hobby and Pro.
Request and response bodies are capped at 4.5 MB, and an overrun returns 413
`FUNCTION_PAYLOAD_TOO_LARGE`
([Vercel Functions limits](https://vercel.com/docs/functions/limitations)).

Consequences:

- A 10 MiB image must not pass through an upload Function. Direct signed Blob
  upload is mandatory, not merely an optimization.
- The current canonical document bundle cap is 4 MiB
  ([`canonical.ts` lines 3–5](https://github.com/cesarecaoduro/OctoMeta/blob/317708a02d90c1df6635a6642e06f2a7afd0dbdb/src/lib/persistence/canonical.ts#L3-L5)).
  This is nominally below the platform cap but leaves little room for the API
  envelope. The persistence specification must cap the actual serialized HTTP
  request and response below 4.5 MB, with a safety margin and boundary tests.
  Recommended wire cap: 3.75 MiB. If product bundles must grow beyond it, put
  immutable bundle bytes in Blob and keep transactional metadata in Neon.
- Cleanup and email workers must process bounded batches and exit well before
  `maxDuration`. Increasing duration is not a substitute for resumable state.
- `waitUntil()` may finish work after the response, but it remains bound by the
  Function timeout and is terminated on timeout. It is a latency optimization,
  not durable execution
  ([Vercel guidance](https://vercel.com/kb/guide/troubleshooting-inconsistent-logs-in-vercel-functions)).

### Vercel Cron

Vercel Cron invokes a Function on the production deployment. The schedule is
UTC. Pro and Enterprise support one-minute minimum intervals and per-minute
precision; Hobby is limited to daily jobs with an execution window of up to 59
minutes
([Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing),
[Cron expressions](https://vercel.com/docs/cron-jobs)).

The important reliability contract is explicit:

- Vercel does not retry a failed Cron invocation.
- A later invocation can overlap a still-running invocation.
- The event-driven system can occasionally deliver the same scheduled event
  more than once.
- Vercel recommends both a lock and idempotent processing.
- Cron has the same duration limits as the Function it invokes.
- `CRON_SECRET` is sent automatically as
  `Authorization: Bearer <CRON_SECRET>`; the route must compare it.

These behaviors are documented together in
[Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

Cron should therefore wake a durable state machine; it must not be the state
machine. OctoMeta needs Pro for its current hourly schedules and for a
minute-level email-outbox backstop.

### Direct Resend

Resend provides the primitives needed, but not the application's durable queue:

- `POST /emails` and `/emails/batch` accept an optional idempotency key. The
  same request can be retried safely within a 24-hour retention window. Keys
  are limited to 256 characters; conflicting payloads and concurrent same-key
  requests return 409
  ([Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)).
- The default API limit is five requests per second per team, shared by all API
  keys. Responses include `ratelimit-*` and `retry-after` headers. Resend
  recommends a queue or reduced concurrency when callers can exceed the limit
  ([Resend usage limits](https://resend.com/docs/api-reference/rate-limit)).
- 429 responses may also mean a daily or monthly quota has been exhausted, not
  merely a short rate window. 500 errors are retryable; validation and
  credential failures require correction
  ([Resend error reference](https://resend.com/docs/api-reference/errors)).
- Webhook signatures must be verified against the raw request body using
  `svix-id`, `svix-timestamp`, and `svix-signature`
  ([Resend webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests)).
- Webhooks are at-least-once and unordered. Failed deliveries are retried after
  5 seconds, 5 minutes, 30 minutes, 2 hours, 5 hours, and 10 hours. Resend says
  to deduplicate on `svix-id` and order by the event's `created_at`
  ([Resend webhook delivery behavior](https://resend.com/docs/webhooks/introduction)).

Direct sending inside the waitlist request is therefore rejected: it creates a
commit/send split-brain window and loses durable retry. The send must be
represented as data in the same Neon transaction as the waitlist change.

## Required asset design

### Tables

The later schema specification should include, at minimum:

```text
asset_upload_intent
  id uuid primary key
  owner_id text not null
  document_id uuid not null
  pathname text unique not null
  declared_content_type text not null
  max_bytes integer not null
  state enum(pending, validating, claimed, rejected, expired)
  expires_at timestamptz not null
  lease_until timestamptz null
  created_at, updated_at timestamptz not null

asset
  id uuid primary key                         -- stable product ID
  owner_id text not null
  document_id uuid not null
  pathname text unique not null               -- provider locator, never user input
  etag text not null
  content_type text not null
  size_bytes integer not null
  sha256 text not null
  state enum(claimed, pending_delete, deleting, delete_failed)
  pending_delete_at, lease_until, next_attempt_at timestamptz null
  delete_attempts integer not null default 0
  last_error text null
  created_at, claimed_at, updated_at timestamptz not null
```

Foreign keys should cascade or restrict metadata as the document model
requires, but Blob deletion must remain an explicit out-of-transaction state
transition. A Postgres transaction cannot atomically commit an external Blob
delete.

### Upload and claim protocol

```mermaid
sequenceDiagram
    participant B as Browser
    participant S as SvelteKit
    participant N as Neon
    participant V as Private Blob

    B->>S: Request upload for live document
    S->>S: Authenticate Better Auth session
    S->>N: Verify owner/live doc; insert upload intent
    S->>V: Issue exact-path signed PUT (10 MiB, allowed image MIME, short TTL)
    S-->>B: Intent ID + signed PUT URL
    B->>V: PUT bytes directly
    B->>S: Finalize intent
    S->>V: Consistent authenticated read of uploaded bytes
    S->>S: Verify size, MIME signature, and SHA-256
    S->>N: Transactionally claim intent and insert asset
    S-->>B: Stable asset ID
```

Required rules:

1. Authenticate and check a live owned document before creating the intent.
2. Generate a server-owned immutable pathname such as
   `assets/<environment>/<intent-uuid>.<normalized-extension>`. Do not accept a
   client pathname and do not allow overwrite. Because Neon knows the exact
   pathname before upload, an expired-intent worker can delete an orphan even
   if the browser disappears.
3. Mint a signed `put` capability for exactly that pathname, accepted image
   MIME types, 10 MiB maximum, and a short validity window (recommended 15
   minutes). These provider checks reduce abuse but do not prove file type.
4. On finalize, perform a consistent authenticated read (`useCache: false`),
   stream the bytes through a 10 MiB limit, detect the existing four magic
   signatures, require declared and detected MIME to agree, and calculate
   SHA-256. Store the returned ETag for conditional delete. Do not treat ETag as
   a documented cryptographic checksum.
5. Claim by unique intent/pathname in one Neon transaction after rechecking the
   user, document, and ownership. Finalize must be idempotent.
6. If validation or claim fails, mark the intent rejected and enqueue deletion;
   do not depend on an immediate `del()` succeeding.
7. The expired-intent worker deletes known pathnames for unclaimed intents.
   Add a low-frequency paginated Blob inventory audit by environment prefix as
   an operational repair tool, not the normal ownership source.

Vercel's older `handleUpload` flow is viable and retries
`onUploadCompleted` five times, but it is not selected. A deterministic signed
PUT plus authenticated finalize gives OctoMeta an explicit claim response,
works in local development without a public callback tunnel, and makes orphan
cleanup possible from the pre-recorded pathname. The callback flow remains a
fallback reference
([Vercel client uploads](https://vercel.com/docs/vercel-blob/client-upload)).

### Read authorization

Expose `GET /api/assets/:assetId/url`, not a pathname-taking endpoint:

1. Authenticate the session.
2. Read `asset` by stable ID and join the document.
3. Require `asset.state = claimed`, matching owner IDs, a live document, and
   any future ACL/share check.
4. Mint an exact-path, `get`-only signed URL valid for five minutes.
5. Return no Blob pathname for unauthorized, missing, trashed, or deleting
   assets. Use the application's existing not-found/unauthorized response
   policy to avoid enumeration.

The storage provider stays behind an `AssetStore` adapter. Domain and route code
use stable asset IDs; only the adapter knows Vercel pathnames, OIDC, signed
tokens, `get`, and `del`.

### Reachability and deletion

Preserve the existing rule that both active blocks and retained undo can make
an asset reachable. During a document/version save:

- lock all referenced asset rows;
- require every reference to be owned, document-bound, and `claimed`;
- allow a still-not-leased `pending_delete` row to return to `claimed`;
- reject `deleting` or missing assets;
- mark newly unreachable rows `pending_delete` with `next_attempt_at = now()`;
- commit document/version and reachability changes together.

The delete worker then:

1. claims a bounded batch using `FOR UPDATE SKIP LOCKED`, a lease, and
   `state = deleting`;
2. commits before calling Blob;
3. calls conditional `del(pathname, ifMatch: etag)` outside the transaction;
4. deletes/tombstones metadata only after provider success;
5. on error, returns the row to `delete_failed` with capped exponential backoff
   and jitter;
6. treats an already-missing object as successful after verifying the provider
   response contract in an integration test.

This removes the race in which a document reclaims an asset while another
invocation is deleting it. Every pass must have a row limit, time budget, and
continuation based on persisted state.

## Required background-job design

### Cron routes

Recommended production schedules:

| Route | Schedule | Work |
| --- | --- | --- |
| `/api/internal/cron/email-outbox` | every minute | Lease and send ready emails in a bounded, rate-limited batch. |
| `/api/internal/cron/assets` | hourly | Expire upload intents; retry pending asset deletion; advance reachability audit. |
| `/api/internal/cron/trash` | every six hours | Purge expired document/version trash in bounded batches. |
| `/api/internal/cron/retention` | hourly or daily | Delete finalized outbox/event history by policy. |

Each GET route must:

- compare `Authorization` to `Bearer ${CRON_SECRET}` and otherwise return 401;
- disable response caching;
- acquire/renew a Neon job lease with an expiry, not an in-memory mutex;
- be safe under duplicate and overlapping invocations;
- persist per-item attempts and the next eligible time;
- stop claiming new work before its Function time budget is exhausted;
- emit structured counts: claimed, succeeded, retried, permanent failures,
  remaining ready, oldest-ready age, and duration;
- return non-2xx on an invocation-level failure for observability even though
  Vercel will not retry it.

Local/preview environments need a protected manual runner or CLI command because
Vercel schedules production deployments. Post-deploy verification must confirm
the registered production schedules and `CRON_SECRET`. Vercel notes that
instant rollback does not itself update active Cron registrations, so rollback
runbooks must verify Cron state
([Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)).

### Transactional Resend outbox

The waitlist transaction should upsert the signup and insert two outbox rows
(confirmation and administrator notification) using unique business keys, for
example:

```text
email_outbox
  id uuid primary key
  kind text not null
  aggregate_type text not null
  aggregate_id text not null
  payload jsonb not null
  payload_hash text not null
  idempotency_key text unique not null
  state enum(pending, leased, sent, retry, permanent_failure, ambiguous)
  lease_until, next_attempt_at timestamptz null
  attempt_count integer not null default 0
  resend_email_id text unique null
  last_http_status integer null
  last_error text null
  first_attempt_at, last_attempt_at, sent_at timestamptz null
  created_at, updated_at timestamptz not null

unique(kind, aggregate_type, aggregate_id)
```

The signup succeeds when the database transaction commits; it does not wait for
Resend. The worker uses `FOR UPDATE SKIP LOCKED` to lease rows, sends outside
the transaction with a deterministic key such as
`octometa/<kind>/<outbox-id>/<payload-hash>`, and records the returned Resend
email ID. Concurrent worker count must remain below the team's Resend limit;
start at four requests per second to leave headroom.

Retry classification:

- retry network failures, 5xx, 409 `concurrent_idempotent_requests`, and ordinary
  429 rate limiting using `retry-after` or capped exponential backoff with
  jitter;
- mark invalid payload, domain, credential, and permission errors as permanent
  and alert;
- distinguish daily/monthly quota 429 responses from short-window rate limits;
  schedule them for operator-visible recovery rather than a hot retry loop.

Resend retains idempotency keys for only 24 hours. If a send outcome is
ambiguous and the same key cannot be retried inside that window, automatic
resend can produce a duplicate. Move such a row to `ambiguous` for operator
reconciliation rather than silently retrying after 24 hours. This is the
specification's honest boundary for the external side effect.

An opportunistic `waitUntil(() => drainOutbox(outboxId))` after commit may lower
normal latency, but the persisted row and minute Cron remain authoritative.

Magic-link delivery uses the same executor with a different service-level
contract:

- create a unique `auth_magic_link` outbox item with an idempotency key tied to
  the Better Auth token/request, not merely the email address;
- immediately attempt that one item before the auth route returns so normal
  delivery remains interactive;
- retain the durable row for a short retry window if the immediate attempt
  fails, while returning the auth response required by the Better Auth
  specification;
- never send after the link's expiry, and prune the sensitive link payload as
  soon as the send reaches a terminal state.

The Better Auth/Neon specification must own the token lifetime, response
semantics, and whether a failed immediate send is surfaced to the user. This
research establishes only that a raw direct Resend call without an outbox does
not preserve today's durable email behavior.

### Resend webhook

The SvelteKit webhook route must:

1. read the body as raw text before JSON parsing;
2. require all three Svix headers and verify them with
   `RESEND_WEBHOOK_SECRET`;
3. insert `svix-id` into `email_event` under a unique constraint;
4. return 200 immediately for a duplicate;
5. in the same transaction, link by `resend_email_id` and update derived status
   only when the event `created_at` is not older than the recorded status event;
6. return 200 only after the durable write commits, and 5xx on a temporary
   database failure so Resend retries;
7. retain enough payload and timestamps for diagnosis, then prune by policy.

Do not overwrite a newer state with whichever webhook arrived last; Resend
explicitly does not guarantee order.

## Is Vercel Queues or Workflow required?

**No, not initially.** Vercel Queues is a capable at-least-once system with
durable replication, automatic retries, configurable consumer concurrency, and
publish idempotency. It is, however, still public beta, retains messages for at
most 24 hours, and has no built-in dead-letter queue
([Vercel Queues](https://vercel.com/docs/queues)). OctoMeta already needs Neon,
and its present workloads are small, queryable state machines:

- a few email types;
- bounded deletion and retention scans;
- no real-time collaboration;
- no long multi-step workflow;
- no task that should exceed one Function invocation.

A Neon outbox avoids another beta service, keeps the queue and business change
transactional, supports retention beyond 24 hours, and is sufficient for
thousands of accounts and hundreds of concurrent requests because the browser
does ordinary editing locally.

Adopt a managed queue later when one or more measured conditions hold:

- sustained outbox production exceeds the Resend rate or the oldest-ready age
  breaches the email SLA despite minute draining;
- large traffic bursts need buffering independent of database polling;
- multiple independent consumers/fan-out are required;
- jobs must begin with reliably sub-minute latency without opportunistic
  request draining;
- cleanup throughput cannot drain its ready set within the scheduled batch
  budget.

Adopt Workflow rather than Queues only for stateful, multi-step, long-lived
business processes. Neither is justified for today's deletion reapers or
two-email waitlist flow.

## Failure and recovery matrix

| Failure | Durable result | Recovery |
| --- | --- | --- |
| Upload intent committed, browser never uploads | Known pathname remains `pending`. | Expiry worker conditionally deletes path and expires intent. |
| Blob uploaded, browser disappears before finalize | Known pathname remains `pending`. | Expiry worker deletes; optional callback/inventory audit repairs anomalies. |
| Finalize races or retries | Unique intent/path and transactional claim. | Return the existing asset result. |
| Blob validation fails | Intent becomes `rejected`; no asset becomes referenceable. | Deletion worker retries provider cleanup. |
| Document save references foreign/unclaimed asset | Transaction rejects before document/version commit. | Client removes or reuploads reference. |
| Blob delete succeeds, Function dies before DB finalize | Row remains leased/deleting. | Lease expiry retries conditional delete; missing object completes cleanup. |
| Cron invocation fails | Ready rows and `next_attempt_at` remain in Neon. | Next Cron/manual run continues; alert on backlog age. |
| Cron duplicates/overlaps | Job/item leases and idempotent transitions prevent double effects. | Extra invocation exits or finds no claimable rows. |
| Resend accepts email, Function dies before recording ID | Outbox remains retryable with the same provider idempotency key. | Retry within 24 hours returns the original response; after 24 hours quarantine as ambiguous. |
| Resend webhook is duplicated | Unique `svix-id` conflicts. | Return 200 without reapplying. |
| Resend webhook is out of order | Event timestamp is older than current derived state. | Retain event but do not regress current status. |

## Specification inputs and acceptance gates

The implementation specs should make these normative:

### Asset acceptance

- Production uses a private Blob store connected with OIDC and the latest
  stable `@vercel/blob`.
- No product/domain module imports Vercel Blob directly; an `AssetStore` port
  owns provider calls.
- Upload authorization proves authenticated user + live owned document before
  a token is issued.
- Browser bytes bypass SvelteKit; upload tokens are exact-path, put-only,
  short-lived, MIME-limited, and 10 MiB-limited.
- Finalize independently proves magic bytes, declared MIME, byte count, and
  SHA-256 before a claim; repeated finalize is idempotent.
- Database references use a stable asset UUID, never a Blob URL or pathname.
- GET URL issuance repeats owner/document/live-state checks and returns a
  five-minute get-only URL.
- Save, trash, restore, undo reachability, permanent delete, abandoned upload,
  failed Blob deletion, and concurrent deletion/re-reference have integration
  tests.
- An environment-scoped Blob inventory audit can prove there are no unknown
  product objects after cleanup.

### Background acceptance

- Every worker has a row/time bound, durable lease, retry counter, next-attempt
  timestamp, and structured result.
- Tests inject duplicate and overlapping Cron calls and prove one logical
  outcome.
- Tests inject provider success followed by local crash and prove recovery.
- Cron routes reject missing/wrong `CRON_SECRET`; production schedules are
  verified after deploy and rollback.
- Dashboards/alerts cover oldest ready outbox item, permanent/ambiguous email
  failures, oldest pending Blob deletion, repeated job failures, and inventory
  drift.

### Email acceptance

- Waitlist upsert and both outbox inserts are one Neon transaction.
- Duplicate signup does not create a second confirmation or administrator
  notification.
- Magic-link outbox items are token-scoped, dispatched immediately, never sent
  after expiry, and have their sensitive payload pruned on terminal state.
- The worker respects the shared Resend rate, `retry-after`, deterministic
  idempotency, permanent/retryable classification, and the 24-hour ambiguity
  boundary.
- The webhook verifies raw-body signatures, deduplicates `svix-id`, tolerates
  unordered events, and commits before 200.
- Retention matches or deliberately changes today's seven-day finalized and
  28-day abandoned-email policy.

### Platform acceptance

- Actual maximum serialized request and response bodies are tested below 4.5
  MB with margin.
- Worker `maxDuration` and batch sizes are explicit and load-tested against
  worst-case provider latency.
- Production is on Vercel Pro or a plan supporting the required hourly and
  minute Cron schedules.
- Preview/local tests do not depend on production Cron or a Blob callback to
  localhost.

## Effort contribution for the migration estimate

This workstream is likely **2–3 engineer-weeks** for one engineer, excluding the
general Neon document schema/API and Better Auth migration:

| Work | Likely effort |
| --- | ---: |
| Asset store port, schema, signed upload/read routes, validation | 4–6 days |
| Reachability, leases, deletion/expiry/inventory workers | 3–5 days |
| Neon email outbox, Resend worker, webhook, retention | 4–6 days |
| Cron configuration, observability, fault-injection and integration tests | 3–5 days |

Optimistic completion is about 2 weeks if the general API/auth seams already
exist. Pessimistic completion is 4 weeks if SvelteKit adapter behavior, private
Blob signed URLs, or failure-injection tests expose integration gaps. The
critical path is the shared Neon transaction/repository layer, then asset claim
and outbox workers, then provider and production verification.

## Rejected options

- **Public Blob with unguessable URLs:** authorization by URL secrecy weakens
  the current owner/document checks.
- **Server-uploaded images:** the 10 MiB product cap exceeds Vercel's 4.5 MB
  Function body limit and adds avoidable transfer cost.
- **Blob URLs/pathnames as domain IDs:** leaks provider details and makes storage
  replacement and authorization harder.
- **Immediate delete inside a document transaction:** an external Blob call
  cannot share Neon atomicity and leaves unrecoverable split states.
- **Cron as the retry mechanism:** Vercel does not retry failures and can
  duplicate or overlap invocations.
- **`waitUntil` as a queue:** it terminates with the Function and has no durable
  retry record.
- **Direct Resend call in the signup transaction/request:** Neon cannot roll
  back an accepted external email, and a committed signup can lose a failed
  send.
- **Vercel Queues/Workflow as mandatory infrastructure now:** no current
  workload requires their extra abstraction; Queues is beta and has a 24-hour
  maximum retention/no built-in DLQ.

## Final conclusion

The agreed Vercel-centered architecture can completely replace the scoped
Convex capabilities without sacrificing scalability or maintainability, but
only if Neon becomes the durable control plane around Blob and Resend.

The key boundary is:

> Vercel Cron wakes work, Vercel Functions execute bounded work, Blob stores
> immutable bytes, Resend performs delivery, and Neon owns every authorization,
> lifecycle, lease, retry, idempotency, and audit decision.

That boundary is portable by design: the application can later replace Blob,
Cron, or the email executor behind adapters without changing the product
model.
