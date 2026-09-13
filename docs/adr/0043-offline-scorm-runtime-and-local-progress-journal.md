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

Offline operation requires deterministic package delivery, locally recoverable
progress and a protocol that remains valid when the browser does not run a
background task. Browser storage APIs cannot promise survival of every sudden
device failure, so learner-facing acknowledgements must distinguish synchronous
staging, committed trusted storage and server receipt. The runtime must continue
supporting the repository's bounded Rise 360 SCORM 1.2 profile rather than
implying general SCORM compatibility.

## Decision

Create a versioned trusted offline SCORM player and storage runtime on the
learning origin. Execute the package and its minimal SCORM 1.2 `window.API`
proxy on a distinct, uncredentialed package-execution origin unique to the exact
offline attempt. The proxy retains the synchronous API expected by supported
packages. It keeps the current bounded working snapshot in memory and uses the
two-stage local persistence boundary described below; package code does not call
the network directly.

On the exact-attempt, cookie-isolated package site, cache package files under a
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
- trusted per-launch session-time high-water validation state;
- package download and integrity state; and
- synchronisation receipts and last error classification.

Each journal record has a random commit identifier, entitlement identifier,
attempt identifier, monotonically increasing client sequence, the entitlement's
immutable history-base server revision, runtime version, reason (`commit`,
`finish`, `checkpoint` or `pagehide`), bounded SCORM snapshot, opaque
launch-session identifier, non-overlapping session-time delta and device
signature. It also records a client-observed instant and cumulative session
elapsed duration for diagnostics; client wall-clock time is not authoritative.
The history base anchors the complete offline journal and does not change after
each local checkpoint; ADR 0044's server-owned reconciliation cursor determines
whether later contiguous records still extend that same history.

The package proxy implements getters and setters synchronously against its
bounded in-memory snapshot. On `LMSCommit` or `LMSFinish`, it serializes one
self-contained bounded checkpoint and appends it with one synchronous
`localStorage.setItem` on the exact-attempt package origin. A successful call is
the SCORM acknowledgement that the complete checkpoint was synchronously staged
in the browser's observable Web Storage area. It is not a claim that the browser
physically flushed the value to disk; an immediate browser, renderer, operating
system or device failure may lose that latest staged checkpoint. The trusted
shell shows **Saving locally** until import commits in learning-origin IndexedDB
and must not label the checkpoint protected or synchronized before then. Each
spool entry contains only the package-visible snapshot, reason,
opaque launch-session identifier, cumulative session elapsed duration,
incremental session delta, diagnostic client instant, a stable random
spool-entry identifier and a local ordinal; it contains no
entitlement, device key, signature or identity beyond the SCORM values already
exposed to that package. The per-attempt spool has strict byte and record
limits. Serialization, quota or storage failure returns an appropriate SCORM
failure and shows a persistent learner-facing warning rather than claiming that
progress was saved.

The trusted runtime creates a fresh random launch-session identifier whenever a
player initializes and gives it to the exact-attempt proxy through the bound
launch channel. Within that launch, `cmi.core.session_time` is cumulative. The
proxy therefore maintains a persisted cumulative high-water mark and writes
only the non-overlapping difference between the normalized current value and
that mark as the checkpoint's session delta. The spool queue and its high-water
mark are one bounded serialized state object, so the proxy appends the
checkpoint and advances the mark atomically with the same synchronous
`localStorage.setItem`; a failed write advances neither. Repeated equal values
produce a zero delta; a value below the high-water mark or outside the supported
bounds fails the SCORM operation and enters **Needs attention** rather than
subtracting time or starting another interval. A later player initialization
uses a new launch-session identifier and a zero high-water mark. Import
atomically advances trusted high-water validation state and validates that
ordinals, cumulative values and deltas form one contiguous, non-regressing
history for each launch session before signing them. That trusted validation
state remains until the launch is closed and all of its spool and journal
entries receive committed import or durable server acknowledgements.

After each spool write, the package proxy asynchronously notifies the trusted
learning-origin runtime over its launch-specific channel. The trusted runtime
imports entries in order, validates and normalizes every field, and computes a
canonical fingerprint over the spool identifier, ordinal and normalized
checkpoint. Import uses a serialized reservation, signing and finalisation
protocol because Web Crypto signing is asynchronous and must not be awaited
inside a normal IndexedDB transaction:

1. A short reservation transaction looks up the attempt-bound spool identifier.
   A new identifier atomically stores its fingerprint, assigns the next client
   sequence and entitlement-bound commit identifier, and records a `signing`
   reservation containing the complete canonical unsigned record. An existing
   identifier with a different fingerprint fails closed as corruption.
2. After that transaction commits, the runtime signs the reserved canonical
   record asynchronously with the device key.
3. A short finalisation transaction re-reads the immutable reservation, verifies
   its status and canonical fingerprint, stores the signature and changes it to
   a reconciliation-eligible `pending` journal entry. It cannot allocate or
   alter the reserved sequence.

An existing `pending` or acknowledged identifier with the same fingerprint
returns its original committed import acknowledgement. An existing `signing`
reservation is resumed rather than assigned another commit or sequence. Startup
and pre-sync recovery scans `signing` reservations in sequence order, signs and
finalises them before later records can reconcile. If signing cannot be
completed, the attempt enters **Needs attention** and later sequences remain
blocked; the reservation is never silently skipped or renumbered. Only a
finalised trusted journal record is eligible for server reconciliation.

A committed import acknowledgement permits the package host to delete the
matching spool entry. If the bridge or learning frame closes after the IndexedDB
transaction but before acknowledgement, the spool remains; the next drain
recovers the same acknowledgement through the stable identifier rather than
creating another journal record. Package-origin state is therefore a recoverable
staging queue, not trusted evidence or the canonical journal.

The learning-origin IndexedDB package registry stores the exact drain URL and
origin for every installed attempt package with unacknowledged or potentially
unimported progress. PWA startup, automatic foreground sync and **Sync now**
first enumerate that registry; at the trusted runtime's request, the top-level
application coordinator loads each exact-attempt package site's cached minimal
drain host as a restricted direct-child sibling of the learning frame. After
checking the expected window and exact origin, the coordinator performs the same
fresh attempt-scoped `MessageChannel` handoff used for playback; no bearer
credential or attempt selector is sent to the package site. The drain host
acquires the same exact-attempt Web Lock used by the player, enumerates its
bounded spool in ordinal order and resends entries until each receives a
committed IndexedDB import acknowledgement. An active player therefore delays
draining rather than racing it. The trusted runtime completes `signing` recovery and
must drain every registered spool for an attempt before submitting that
attempt's journal for server reconciliation. An unavailable host, busy lock,
failed handshake or remaining spool aborts reconciliation for that attempt,
keeps it registered, reports **Needs attention** or pending sync, and prevents
the application from claiming that synchronization is complete.

The runtime also requests checkpoints of dirty state while visible and on
`pagehide` where possible. These use the same synchronous spool write; their
subsequent import remains asynchronous. `sendBeacon` may trigger an online sync
attempt but is not the durability mechanism.

Before every player initialization, including reopening a module while the PWA
has remained in the foreground, the exact-attempt package host acquires the
exclusive Web Lock specified by ADR 0042 and drains its complete spool through
the trusted import protocol. Trusted code completes any `signing` recovery and
rebuilds the resume snapshot only after all drained entries have committed
import acknowledgements. The host then initializes the SCORM API and retains
that same lock until the player closes, so no context can write between the drain and
resume-state construction. A failed or incomplete drain blocks launch and shows
**Needs attention**; the runtime never resumes from an older journal snapshot
while a newer recoverable checkpoint remains staged. Consequently only one
context can evolve the in-memory snapshot, generate local ordinals or accrue a
session-time delta for that attempt. A second local context never initializes
its SCORM API while the lock is held.

The local materialised state resumes from the latest browser-committed journal
record.
Total time is derived from the server base plus accepted non-overlapping launch
session deltas so repeated cumulative checkpoints, retries, reloads and
synchronisation do not double count time.
Completion is monotonic within an attempt: once a local snapshot reports
`completed` or `passed`, a later local snapshot cannot regress it. Administrator
overrides remain server-side overlays and never rewrite local or server SCORM
evidence.

The top-level application shell frames the trusted learning runtime and a
sandboxed package host from the distinct exact-attempt package site as direct
siblings. The package host and its nested same-origin vendor content share only
that uncredentialed, cookie-isolated context, so vendor code can locate the
SCORM API in its parent as it does today. Package code can inspect or damage only
the working state and spool for its own attempt, which it can already influence
through the SCORM API; it cannot reach another attempt or trusted evidence. The
host exposes no entitlement or attempt selector.

The application shell validates readiness against each expected frame's exact
origin and `WindowProxy`, creates a fresh `MessageChannel`, and transfers one
port to each sibling. The learning runtime accepts that port only after it has
independently resolved the entitlement from trusted storage and matched its
exact attempt, package site and immutable package version. Calls then travel
directly between the siblings using a fixed discriminated schema, bounded
values, request identifiers and response matching; neither wildcard origins nor
bearer credentials cross the channel. The same direct-child package frame is
used for visible playback, pre-launch recovery and hidden spool drains. Sandbox
permissions remain limited to the supported package behaviours and deny
top-level navigation and access to the application or learning origin.

The offline workspace distinguishes:

- **Ready offline**: complete package and currently valid local entitlement;
- **Saving locally**: a synchronous spool write awaits trusted import and may be
  lost by an immediate browser or device failure;
- **Progress protected on this device**: a browser-committed trusted journal
  record awaits server acknowledgement;
- **Completed on this device**: local SCORM completion awaits reconciliation;
- **Completed and synced**: server-authoritative completion is confirmed; and
- **Needs attention**: storage, entitlement, integrity or sync requires learner
  action.

## Rationale

An append-only local journal supports recovery within the browser's persistence
contract and makes retry behaviour observable. Full bounded snapshots match the
current server contract and avoid
replaying arbitrary SCORM API calls. Content-addressed storage aligns with
immutable package versions and makes corruption and partial downloads
detectable. A per-attempt, cookie-isolated package site preserves synchronous parent API
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
migrations and recovery tests. The API can truthfully acknowledge only
synchronous browser staging, while trusted import and signing complete
asynchronously. The shell separately reports when import has committed and
keeps finalising work visible after `LMSFinish`; no web-only status claims
immunity from sudden device failure. Support tooling can distinguish spool,
trusted-journal and server-sync failures without logging SCORM state.

The package API proxy and trusted runtime form a versioned protocol that must be
compatibility-tested with supported Rise packages. Spool capacity, crash
recovery, tamper rejection, import acknowledgement and cleanup require browser
coverage across the supported offline matrix. Per-attempt package contexts must
be provisioned with distinct registrable-site/cookie boundaries, deployed
without application or learning credentials, and use their own least-privilege
CSP, framing and service-worker scope. Sibling origins beneath one registrable
domain do not meet this boundary.

Browser storage corruption or eviction can still remove unsynchronised work.
The application must surface that risk, detect missing objects and never derive
server completion merely from a locally displayed state.

## Invariants / Guardrails

- `LMSCommit` and `LMSFinish` do not return success before a complete bounded
  checkpoint is synchronously staged in the exact-attempt Web Storage spool;
  that return value is not described as a physical disk-flush guarantee.
- Learner-facing status distinguishes synchronously staged, browser-committed
  trusted-journal and durably server-receipted progress.
- Journal records are append-only until acknowledged and safely compacted.
- Importing the same spool identifier and fingerprint more than once returns the
  original acknowledgement and never assigns another commit identifier,
  sequence or session delta; identifier reuse with different content fails
  closed.
- Sequence allocation and the immutable unsigned record commit in a short
  IndexedDB reservation transaction; asynchronous signing happens only after it
  closes, and a second short transaction finalises that exact reservation.
- Crash recovery resumes `signing` reservations in sequence order and never
  skips or reallocates their sequence.
- One browser-enforced exact-attempt Web Lock covers the complete player
  lifetime and prevents competing local snapshots and session deltas.
- Each launch session uses one persisted cumulative session-time high-water
  mark; only its non-overlapping increments enter journal records.
- Startup and every foreground or manual sync drain all reachable registered
  exact-attempt spools before reconciliation and never report complete while a
  spool remains, is busy or cannot be reached.
- Every player initialization drains and imports its exact-attempt spool before
  constructing resume state, then retains the same Web Lock for the session.
- Spool entries are not trusted evidence; only validated, normalized and
  device-signed learning-origin journal records may be reconciled.
- Every record is bounded by the existing validated progress limits.
- Client timestamps are diagnostic, not authoritative access or completion
  clocks.
- Completion cannot regress within one attempt.
- Package cache keys include the exact immutable version and digest.
- Partial or digest-invalid packages never launch offline.
- SCORM package code cannot read offline credentials, device keys, the trusted
  journal, another attempt's cookies or spool, or a credentialed origin's
  storage.
- Every package bridge is a fresh exact-origin channel bound by trusted code to
  one already-authorised entitlement and attempt; package input cannot select
  that binding.
- The application hosts learning and package frames as direct siblings and
  transfers their channel only after exact-origin, exact-`WindowProxy` and
  trusted entitlement/package checks; qualification tests use this topology.
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
