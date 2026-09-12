# ADR 0043: Offline SCORM runtime and local progress journal

## Status

Proposed.
Date: 2026-09-12

## Context

The current custom SCORM 1.2 runtime loads initial state from PostgreSQL, keeps
working values in memory, and sends a complete progress snapshot to the server
on `LMSCommit`, `LMSFinish` and `pagehide`. A failed request sets SCORM error
101 but does not durably retain the commit. Package responses are deliberately
`no-store` and are authorised against the attempt session on every request.

Offline operation requires deterministic package delivery, crash-safe local
progress and a protocol that remains valid when the browser does not run a
background task. It must continue supporting the repository's bounded Rise 360
SCORM 1.2 profile rather than implying general SCORM compatibility.

## Decision

Create a versioned offline SCORM player and runtime on the learning origin. The
runtime retains the existing synchronous SCORM 1.2 `window.API` surface but
persists through a learning-origin storage service instead of calling the
network directly.

Cache package files under a content-addressed namespace containing the exact
package-version identifier and SHA-256 digest. Cache the player shell and
runtime separately by runtime version. Installation verifies the server-issued
file inventory and each response before atomically publishing the downloaded
package as ready. Updating application code does not mutate a downloaded
package version. Removing or replacing a package deletes only its exact
namespaced objects after no active local entitlement references them.

Use IndexedDB, not Local Storage, for personalised state. Maintain:

- the verified entitlement and device-key reference;
- the server base revision and initial SCORM snapshot;
- the current materialised local snapshot;
- an append-only commit journal;
- package download and integrity state; and
- synchronisation receipts and last error classification.

Each journal record has a random commit identifier, entitlement identifier,
attempt identifier, monotonically increasing client sequence, base server
revision, runtime version, reason (`commit`, `finish`, `checkpoint` or
`pagehide`), bounded SCORM snapshot and device signature. It also records a
client-observed instant and session elapsed duration for diagnostics; client
wall-clock time is not authoritative.

`LMSCommit` succeeds only after the new snapshot and journal entry commit to
IndexedDB. `LMSFinish` uses the same durable write before closing the runtime.
The runtime periodically checkpoints dirty state while visible and checkpoints
on `pagehide` where possible. `sendBeacon` may trigger an online sync attempt
but is not the durability mechanism. A storage failure returns an appropriate
SCORM failure and shows a persistent learner-facing warning; the runtime must
not claim that progress was saved.

The local materialised state resumes from the latest durable journal record.
Total time is derived from the server base plus completed local session
durations so retries, reloads and synchronisation do not double count time.
Completion is monotonic within an attempt: once a local snapshot reports
`completed` or `passed`, a later local snapshot cannot regress it. Administrator
overrides remain server-side overlays and never rewrite local or server SCORM
evidence.

The package iframe remains sandboxed. Vendor content locates the SCORM API in
its parent as it does today, but cannot access the entitlement, device key,
journal database or service-worker control channel. All messages crossing
frames or origins use fixed origins, discriminated schemas, size limits and
request identifiers.

The offline workspace distinguishes:

- **Ready offline**: complete package and currently valid local entitlement;
- **Progress saved on this device**: durable journal entries await server
  acknowledgement;
- **Completed on this device**: local SCORM completion awaits reconciliation;
- **Completed and synced**: server-authoritative completion is confirmed; and
- **Needs attention**: storage, entitlement, integrity or sync requires learner
  action.

## Rationale

An append-only local journal survives crashes and makes retry behaviour
observable. Full bounded snapshots match the current server contract and avoid
replaying arbitrary SCORM API calls. Content-addressed storage aligns with
immutable package versions and makes corruption and partial downloads
detectable.

## Alternatives Considered

- **Use the Cache API for progress.** Rejected because it models request and
  response caching, not transactional structured state or ordered mutations.
- **Use Local Storage.** Rejected because it is synchronous, size-constrained
  and unsuitable for transactional journal writes.
- **Queue only the final completion state.** Rejected because suspend location,
  scores and recoverable in-progress state would be lost.
- **Replay every `LMSSetValue` call.** Rejected because it produces a larger,
  vendor-coupled protocol without improving the server's snapshot model.
- **Treat `sendBeacon` as durable persistence.** Rejected because delivery is
  not guaranteed and it cannot support offline correctness.

## Consequences

The runtime becomes an explicit versioned client component with schema
migrations and recovery tests. IndexedDB writes add latency to `LMSCommit`, but
the API can truthfully acknowledge persistence. Support tooling can distinguish
download, local-save and server-sync failures without logging SCORM state.

Browser storage corruption or eviction can still remove unsynchronised work.
The application must surface that risk, detect missing objects and never derive
server completion merely from a locally displayed state.

## Invariants / Guardrails

- `LMSCommit` and `LMSFinish` do not return success before local durability.
- Journal records are append-only until acknowledged and safely compacted.
- Every record is bounded by the existing validated progress limits.
- Client timestamps are diagnostic, not authoritative access or completion
  clocks.
- Completion cannot regress within one attempt.
- Package cache keys include the exact immutable version and digest.
- Partial or digest-invalid packages never launch offline.
- SCORM package code cannot read offline credentials, device keys or journal
  records.
- SCORM values and suspend data never enter operational logs or analytics.

## Follow-up / Triggers

Define storage schema migrations before implementation and retain fixtures for
each shipped runtime schema. Revisit snapshot journalling only if a supported
SCORM package demonstrates a correctness requirement that cannot be represented
by the bounded current state contract.

## Related Documents

- [ADR 0003: Versioned learning domain](0003-versioned-learning-domain.md)
- [ADR 0004: SCORM and object storage](0004-scorm-and-object-storage.md)
- [ADR 0009: Structured logging and durable audit projection](0009-structured-logging-and-durable-audit.md)
- [ADR 0036: Initial authenticated SCORM content delivery](0036-initial-scorm-content-delivery.md)
- [ADR 0041: Progressive web application and offline SCORM delivery](0041-progressive-web-app-and-offline-scorm-delivery.md)
- [ADR 0042: Device-bound offline learning entitlements](0042-device-bound-offline-learning-entitlements.md)
