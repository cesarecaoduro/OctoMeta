---
module: Cloud Version Persistence
date: 2026-07-23
problem_type: best_practice
component: database
symptoms:
  - "A lost save response could create a duplicate immutable version"
  - "Edits made during an upload could be mistaken for content already saved to Main"
  - "Cloud snapshots could accidentally include browser undo or presentation state"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [convex, immutable-versions, idempotency, chunking, local-first]
---

# Troubleshooting: Explicit cloud saves can acknowledge the wrong local generation

## Problem

An explicit cloud save spans local flushing, integrity checks, asset verification,
network I/O, and a Convex transaction. Rebuilding retry input from the live working
copy or marking the current generation clean after the response can duplicate a
version or hide edits made while the request was in flight.

## Solution

Capture one durable local generation and canonicalize an authored-only bundle. Store
the exact bundle bytes, operation ID, operation-input hash, expected Main head, and
captured generation in IndexedDB before network I/O.

Convex checks the operation receipt before the expected head. A matching operation ID
and input hash returns the original version; incompatible reuse fails closed. New
content advances Main by exactly one, while a matching bundle hash returns
`unchanged`. Canonical bytes are split at a 700 KiB target and every contiguous chunk
plus the concatenated bundle is SHA-256 verified.

After acknowledgement, update only the cloud base generation recorded by the pending
operation. Never replace the live local content:

```ts
cloudBase: {
  version: result.version,
  bundleHash: result.bundleHash,
  generation: pending.capturedGeneration
}
```

If the working copy advanced from generation `G` to `G+1` during upload, it therefore
remains visibly dirty against the saved base `G`.

## Prevention

- Give cloud bundles an authored-only type that cannot encode undo or UI preferences.
- Persist exact retry input before the first request.
- Check operation ID plus input hash before expected-head comparison.
- Acknowledge the captured generation, not the generation current when the response arrives.
- Verify chunk indexes, per-chunk hashes, total byte length, and the complete bundle hash on load.
- Keep incomplete calculations and broken references as warnings; block structural corruption and missing assets.

## Related Issues

- [ADR 0010: Store versions as authored bundle chunks](../../adr/0010-store-versions-as-authored-bundle-chunks.md)
- [ADR 0011: Keep one local history per working copy](../../adr/0011-one-local-history-per-working-copy.md)
- [Issue #10: Save immutable cloud versions explicitly](https://github.com/cesarecaoduro/OctoMeta/issues/10)
