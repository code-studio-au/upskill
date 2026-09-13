# ADR 0044: Idempotent offline SCORM reconciliation

## Status

Proposed.
Date: 2026-09-12

## Context

The existing progress endpoint accepts a current SCORM snapshot under a live
attempt session, locks the session, updates the attempt and transactionally
derives enrolment or Event Participation completion. Repeated final online
commits cannot duplicate completion transitions. Offline journals introduce
delayed, repeated and potentially out-of-order submissions, expired
entitlements, application upgrades and interrupted acknowledgement.

Treating synchronisation as a last-write-wins update would permit stale state
to regress progress. Treating every retry as new evidence would double count
time and create misleading audit or outbox events. The server must remain the
only authority for confirmed completion, certificates and downstream events.

## Decision

Add a versioned offline reconciliation command on the learning origin. It
accepts a bounded batch for one entitlement and attempt. Authentication proves
the current learner when available; the signed entitlement and device-signed
records prove the delegated offline context. The command independently parses
all identifiers and payloads and resolves the authoritative attempt context.

Persist server reconciliation state with:

- an attempt progress revision incremented for every accepted material change;
- an offline entitlement lifecycle and its device public key;
- a unique receipt for each `(entitlementId, commitId)` with the server-computed
  canonical request fingerprint;
- the highest contiguous accepted client sequence;
- a reconciliation cursor containing the attempt revision produced by the last
  accepted sequence for this entitlement; and
- a sanitized outcome and server receipt instant.

Reconciliation first parses the record, resolves the retained entitlement and
device public key, verifies the signature and immutable package and
offering-item bindings, validates the payload bounds, and computes a SHA-256
fingerprint over a versioned canonical encoding of every signed semantic
request field. Those fields include entitlement and attempt identifiers, commit
identifier, client sequence, base revision, runtime version, reason, normalized
bounded snapshot, validated session delta and diagnostic client instant. The
signature bytes are excluded from the fingerprint.

When `(entitlementId, commitId)` already exists, an equal fingerprint returns
the existing receipt without reapplying state, even when the current time is
past the acceptance deadline or the entitlement was subsequently hard-revoked.
This is receipt recovery for an already-applied effect, not acceptance of new
evidence. A different fingerprint returns a terminal `commit_id_reused`
conflict, applies no state, and explicitly tells the client that the local entry
is not acknowledged or eligible for compaction.

Only a new commit proceeds to the state-changing transaction. Reconciliation
then locks the entitlement and attempt and immediately rechecks
`(entitlementId, commitId)` and its canonical fingerprint while holding those
locks, before evaluating any current lifecycle gate. If a concurrent request
created an equal receipt, this request returns it without another effect even
if the deadline or revocation state changed while it waited for the locks; a
different fingerprint returns `commit_id_reused`. Only when no receipt exists
under lock does reconciliation enforce the current lifecycle,
commit-acceptance deadline, hard-revocation state and contiguous sequence and
process records in client-sequence order.

A missing sequence produces a retryable gap response rather than skipping
evidence. A gap response is not a durable idempotency receipt and does not
reserve or consume the commit identifier. After the missing sequence is
accepted, an exact retry is evaluated again and may proceed normally. Optional
gap diagnostics are operational and must not participate in receipt lookup or
client compaction.

The signed base revision anchors the entitlement's complete offline journal,
not each individual checkpoint. For the first previously unaccepted sequence,
the server requires the locked attempt revision to equal that immutable history
base. After accepting a sequence, the same transaction records the resulting
attempt revision in the entitlement's reconciliation cursor. Each next
contiguous sequence requires the locked attempt revision to equal the cursor,
then advances the cursor to the revision produced by that commit. This applies
identically when processing multiple records in one batch or records arriving
across later requests, so accepting an earlier record does not make the next
ordinary offline checkpoint conflict with its shared history base.

Because ADR 0042 permits only one offline writer, a mismatch against the
applicable history base or reconciliation cursor proves that another server-side
mutation intervened and is not silently merged. The server returns the
authoritative snapshot and an explicit conflict outcome. The normal expected
resolution is:

- acknowledge already-applied records by receipt;
- accept a strict contiguous continuation from the entitlement's history base
  and then its server-owned reconciliation cursor;
- preserve server completion when a delayed snapshot is incomplete; and
- require learner or support action when the server contains a competing
  mutation that cannot be proven to be the same journal history.

Progress fields follow these rules for accepted ordered commits:

- lesson completion is monotonic;
- location, suspend data and scores come from the latest accepted sequence;
- total time advances only by validated non-negative, non-overlapping
  launch-session deltas not already represented by an accepted commit; repeated
  cumulative session-time values therefore cannot be summed as new durations;
  and
- `completedAt` is the server receipt instant of the first accepted completing
  commit, while the client-observed instant remains non-authoritative metadata.

After applying the batch, use the existing transaction boundaries to derive
item, section, enrolment or Event Participation completion. Emit the existing
completion audit and outbox transition only when authoritative completion first
changes. Certificates remain unavailable until this transaction confirms
completion.

Commits may arrive until the entitlement's immutable commit-acceptance deadline,
which is no more than 30 days after its intended launch expiry. This window is
extended delegated server authority: a client timestamp cannot prove that work
was authored before intended launch expiry. The server therefore uses its
receipt instant as the hard boundary and rejects a commit received after the
acceptance deadline. Ordinary access removal after issuance does not invalidate
the still-bounded delegated acceptance authority. The local runtime separately
refuses launches after intended launch expiry, and new evidence for a
hard-revoked entitlement is rejected. An exact retry may still recover the
durable receipt for its previously accepted effect. Accepted effects and
terminal rejections or conflicts are retained as bounded receipts and reasons,
without copying learner SCORM values into global audit logs. Retryable
conditions, including sequence gaps and transient server failures, do not
create terminal receipts.

The client deletes or compacts journal entries only after it receives durable
receipts through a successfully authenticated response. Losing the response is
safe: retrying the same commit identifiers returns the same receipts. Before a
manual **Sync now**, PWA startup or automatic foreground sync invokes this
command, the trusted runtime performs ADR 0043's registered exact-attempt spool
drain and signing recovery. It submits an attempt's trusted journal only after
every registered spool for that attempt has been drained. A busy or unreachable
registered spool, or one that still contains an unacknowledged entry, aborts
that attempt's reconciliation and reports it as pending or **Needs attention**
rather than synchronized.

## Rationale

Server receipts and ordered sequences extend the repository's established
idempotency model to an intermittently connected client. A single-writer lease
turns most syncs into linear continuation and makes the remaining conflicts
explicit. Reusing existing completion transactions preserves audit, outbox and
certificate invariants.

## Alternatives Considered

- **Last write wins.** Rejected because stale offline state could overwrite a
  newer suspend location, score or completion.
- **Merge opaque suspend data.** Rejected because its schema belongs to the
  package vendor and is not generally mergeable.
- **Trust client completion immediately.** Rejected because access,
  entitlement, sequence and package bindings require server verification.
- **Use SQS directly from the browser.** Rejected because it would expose an
  infrastructure boundary and would not provide the required synchronous
  validation and durable receipt contract.
- **Reject every commit after intended launch access ends.** Rejected because
  the server cannot distinguish a delayed upload from work authored after that
  instant using an untrusted client clock. The entitlement instead makes the
  later, server-enforced acceptance deadline explicit delegated authority.

## Consequences

Reconciliation requires new forward-only tables or columns, focused database
verification and an explicit conflict-support view. Receipt retention adds
storage but makes retry and dispute behaviour reconstructable. The server will
accept some evidence after ordinary access has ended when it belongs to a valid
previously issued entitlement; that delayed authority is bounded by the
server-checked acceptance deadline and visible. It cannot be represented as
proof that the learner authored the evidence before intended launch expiry.

The PWA can display local completion immediately but must label it as pending
until the server returns a receipt and confirmed projection. Other browser
sessions see completion after reconciliation without any special refresh path.

## Invariants / Guardrails

- PostgreSQL remains authoritative for confirmed progress and completion.
- Every accepted offline commit is exact-version, exact-attempt and
  exact-device bound.
- Applying the same commit more than once has no additional domain effect.
- Commit identity is idempotent only when its canonical request fingerprint
  matches; reuse with different semantics is a terminal non-acknowledging
  conflict.
- An authenticated, validly signed exact retry recovers its existing receipt
  before current deadline and revocation gates; it cannot apply another effect.
- Receipt identity and fingerprint are checked again while holding the
  entitlement and attempt locks, before lifecycle gates, sequence validation or
  any state change.
- Records are applied in contiguous client-sequence order.
- One immutable history-base revision anchors all records from an entitlement;
  the server-owned reconciliation cursor advances transactionally after each
  accepted sequence and detects intervening server mutations.
- Total time uses validated non-overlapping increments from each launch
  session's cumulative high-water history; cumulative checkpoints are never
  independently summed.
- A retryable sequence gap creates no terminal idempotency receipt; the same
  commit is re-evaluated after its predecessor is accepted.
- Incomplete or stale evidence cannot regress a completed attempt.
- Course and Event completion, audit and outbox transitions occur in the same
  transaction as the accepted attempt change.
- Client time cannot establish access validity, pre-expiry authorship or
  authoritative completion time.
- The server receipt instant must not exceed the entitlement's immutable
  commit-acceptance deadline.
- Certificates require server-confirmed completion.
- Sync logs and global audit projections contain identifiers and outcomes, not
  SCORM suspend data, learner answers or bearer material.

## Follow-up / Triggers

Specify the exact reconciliation schema and impact matrix before implementation,
including enrolment and Event Participation paths, ordinary and hard revocation,
expiry, retries, gaps, duplicate batches, administrator overrides and device
replacement. Revisit exclusive-writer reconciliation only if product evidence
justifies multi-device offline attempts.

## Related Documents

- [ADR 0008: SQS worker delivery](0008-sqs-worker-delivery.md)
- [ADR 0009: Structured logging and durable audit projection](0009-structured-logging-and-durable-audit.md)
- [ADR 0010: Versioned course authoring and section progress](0010-versioned-course-authoring-and-section-progress.md)
- [ADR 0014: On-demand completion certificates](0014-completion-certificate-issuance.md)
- [ADR 0018: Audited progress overrides](0018-audited-progress-overrides.md)
- [ADR 0042: Device-bound offline learning entitlements](0042-device-bound-offline-learning-entitlements.md)
- [ADR 0043: Offline SCORM runtime and local progress journal](0043-offline-scorm-runtime-and-local-progress-journal.md)
- [Transactional outbox and asynchronous work](../architecture/transactional-outbox-and-asynchronous-work.md)
