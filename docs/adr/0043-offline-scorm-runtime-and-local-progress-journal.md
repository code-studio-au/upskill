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

Create a versioned trusted offline SCORM player and storage runtime on the
learning origin. Execute the package and its minimal SCORM 1.2 `window.API`
proxy on a distinct, uncredentialed package-execution origin unique to the exact
offline attempt. The proxy retains the synchronous API expected by supported
packages. It keeps the current bounded working snapshot in memory and uses the
two-stage local durability boundary described below; package code does not call
the network directly.

On the exact-attempt package origin, cache package files under a
content-addressed namespace containing the exact package-version identifier and
SHA-256 digest. That origin also caches the minimal API proxy, separately by
runtime version, and owns only its attempt's bounded checkpoint spool. The
learning origin caches the trusted player and storage runtime. Installation
verifies the server-issued file inventory and each response before atomically
publishing the downloaded package as ready. Updating application code does not
mutate a downloaded package version. Removing or replacing a package deletes
only its exact namespaced objects after no active local entitlement references
them.

Use learning-origin IndexedDB, not Local Storage, for personalised state.
Maintain:

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

The package proxy implements getters and setters synchronously against its
bounded in-memory snapshot. On `LMSCommit` or `LMSFinish`, it serializes one
self-contained bounded checkpoint and appends it with one synchronous
`localStorage.setItem` on the exact-attempt package origin. A successful call is
the SCORM acknowledgement that the checkpoint is durably recoverable on this
device. Each spool entry contains only the package-visible snapshot, reason,
session delta, diagnostic client instant and a local ordinal; it contains no
entitlement, device key, signature or identity beyond the SCORM values already
exposed to that package. The per-attempt spool has strict byte and record
limits. Serialization, quota or storage failure returns an appropriate SCORM
failure and shows a persistent learner-facing warning rather than claiming that
progress was saved.

After each spool write, the package proxy asynchronously notifies the trusted
learning-origin runtime over its launch-specific channel. The trusted runtime
imports entries in order, validates and normalizes every field, enforces bounded
and monotonic state, assigns the entitlement-bound commit identifier and client
sequence, signs the record with the device key, and commits it to the IndexedDB
journal. Only that trusted record is eligible for server reconciliation. A
durable import acknowledgement permits the package host to delete the matching
spool entry. If the bridge or learning frame closes first, the spool remains;
the trusted runtime drains and validates it before the next package launch.
Package-origin state is therefore a recoverable staging queue, not trusted
evidence or the canonical journal.

The runtime also requests checkpoints of dirty state while visible and on
`pagehide` where possible. These use the same synchronous spool write; their
subsequent import remains asynchronous. `sendBeacon` may trigger an online sync
attempt but is not the durability mechanism.

The local materialised state resumes from the latest durable journal record.
Total time is derived from the server base plus completed local session
durations so retries, reloads and synchronisation do not double count time.
Completion is monotonic within an attempt: once a local snapshot reports
`completed` or `passed`, a later local snapshot cannot regress it. Administrator
overrides remain server-side overlays and never rewrite local or server SCORM
evidence.

The learning-origin player frames a sandboxed package host from the distinct
exact-attempt package origin. The package host and nested vendor content share
only that uncredentialed origin so vendor code can locate the SCORM API in its
parent as it does today. Package code can inspect or damage only the working
state and spool for its own attempt, which it can already influence through the
SCORM API; it cannot reach another attempt or trusted evidence. The host exposes
no entitlement or attempt selector. For each authorised launch, trusted code
binds a fresh channel to the already resolved entitlement and attempt using the
exact package origin. Calls use a fixed discriminated schema, bounded values,
request identifiers and response matching; neither wildcard origins nor bearer
credentials cross the channel. Sandbox permissions remain limited to the
supported package behaviours and deny top-level navigation and access to the
learning origin.

The offline workspace distinguishes:

- **Ready offline**: complete package and currently valid local entitlement;
- **Progress saved on this device**: a durable local checkpoint awaits trusted
  import or server acknowledgement;
- **Completed on this device**: local SCORM completion awaits reconciliation;
- **Completed and synced**: server-authoritative completion is confirmed; and
- **Needs attention**: storage, entitlement, integrity or sync requires learner
  action.

## Rationale

An append-only local journal survives crashes and makes retry behaviour
observable. Full bounded snapshots match the current server contract and avoid
replaying arbitrary SCORM API calls. Content-addressed storage aligns with
immutable package versions and makes corruption and partial downloads
detectable. A per-attempt package origin preserves synchronous parent API
discovery and the browser's only broadly supported synchronous local write
without giving vendor scripts the origin that owns entitlements, keys, trusted
progress or another attempt.

## Alternatives Considered

- **Use the Cache API for progress.** Rejected because it models request and
  response caching, not transactional structured state or ordered mutations.
- **Use Local Storage as the canonical journal.** Rejected because it is
  size-constrained, package-readable and unsuitable for transactional trusted
  state. It is used only as a strictly bounded, per-attempt synchronous spool
  before validated import into IndexedDB.
- **Queue only the final completion state.** Rejected because suspend location,
  scores and recoverable in-progress state would be lost.
- **Replay every `LMSSetValue` call.** Rejected because it produces a larger,
  vendor-coupled protocol without improving the server's snapshot model.
- **Treat `sendBeacon` as durable persistence.** Rejected because delivery is
  not guaranteed and it cannot support offline correctness.

## Consequences

The runtime becomes an explicit versioned client component with schema
migrations and recovery tests. The API can truthfully acknowledge a recoverable
local checkpoint synchronously, while trusted import and signing complete
asynchronously. Support tooling can distinguish spool, trusted-journal and
server-sync failures without logging SCORM state.

The package API proxy and trusted runtime form a versioned protocol that must be
compatibility-tested with supported Rise packages. Spool capacity, crash
recovery, tamper rejection, import acknowledgement and cleanup require browser
coverage across the supported offline matrix. Per-attempt package origins must
be provisioned on a dedicated cookie-free site, deployed without application or
learning credentials, and use their own least-privilege CSP, framing and
service-worker scope.

Browser storage corruption or eviction can still remove unsynchronised work.
The application must surface that risk, detect missing objects and never derive
server completion merely from a locally displayed state.

## Invariants / Guardrails

- `LMSCommit` and `LMSFinish` do not return success before a complete bounded
  checkpoint is durably appended to the exact-attempt spool.
- Journal records are append-only until acknowledged and safely compacted.
- Spool entries are not trusted evidence; only validated, normalized and
  device-signed learning-origin journal records may be reconciled.
- Every record is bounded by the existing validated progress limits.
- Client timestamps are diagnostic, not authoritative access or completion
  clocks.
- Completion cannot regress within one attempt.
- Package cache keys include the exact immutable version and digest.
- Partial or digest-invalid packages never launch offline.
- SCORM package code cannot read offline credentials, device keys, the trusted
  journal, another attempt's spool or a credentialed origin's storage.
- Every package bridge is a fresh exact-origin channel bound by trusted code to
  one already-authorised entitlement and attempt; package input cannot select
  that binding.
- Per-attempt spool byte and record limits fail closed before browser quota is
  exhausted; acknowledged entries are removed only after trusted import.
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
