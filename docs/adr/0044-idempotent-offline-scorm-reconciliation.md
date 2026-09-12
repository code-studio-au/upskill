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
- a unique receipt for each `(entitlementId, commitId)`;
- the highest contiguous accepted client sequence; and
- a sanitized outcome and server receipt instant.

In one transaction, reconciliation locks the entitlement and attempt, verifies
the entitlement, device signature, exact package and offering-item bindings,
sequence, payload bounds and hard-revocation state, then processes records in
client-sequence order. Duplicate commit identifiers return their existing
receipt without reapplying state. A missing sequence produces a retryable gap
response rather than skipping evidence.

Because ADR 0042 permits only one offline writer, a base-revision mismatch is
not silently merged. The server returns the authoritative snapshot and an
explicit conflict outcome. The normal expected resolution is:

- acknowledge already-applied records by receipt;
- accept a strict continuation from the entitlement's recorded base or last
  accepted revision;
- preserve server completion when a delayed snapshot is incomplete; and
- require learner or support action when the server contains a competing
  mutation that cannot be proven to be the same journal history.

Progress fields follow these rules for accepted ordered commits:

- lesson completion is monotonic;
- location, suspend data and scores come from the latest accepted sequence;
- total time advances only by validated non-negative session deltas not already
  represented by an accepted commit; and
- `completedAt` is the server receipt instant of the first accepted completing
  commit, while the client-observed instant remains non-authoritative metadata.

After applying the batch, use the existing transaction boundaries to derive
item, section, enrolment or Event Participation completion. Emit the existing
completion audit and outbox transition only when authoritative completion first
changes. Certificates remain unavailable until this transaction confirms
completion.

Commits may arrive during the entitlement's 30-day transport grace after the
captured access expiry. Ordinary access removal after the entitlement was issued
does not invalidate otherwise valid evidence delegated until that expiry. The
entitlement expiry bounds offline launch. A hard-revoked entitlement is
rejected. Rejected or conflicted evidence is retained as a bounded receipt and
reason, without copying learner SCORM values into global audit logs.

The client deletes or compacts journal entries only after it receives durable
receipts through a successfully authenticated response. Losing the response is
safe: retrying the same commit identifiers returns the same receipts. A manual
**Sync now** action and automatic foreground sync use the same command.

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
- **Reject every commit after current enrolment access ends.** Rejected because
  it would contradict the bounded authority deliberately delegated for offline
  use and penalise a learner who reconnects after legitimate offline work.

## Consequences

Reconciliation requires new forward-only tables or columns, focused database
verification and an explicit conflict-support view. Receipt retention adds
storage but makes retry and dispute behaviour reconstructable. The server will
accept some evidence after ordinary access has ended when it belongs to a valid
previously issued entitlement; that delayed authority is bounded and visible.

The PWA can display local completion immediately but must label it as pending
until the server returns a receipt and confirmed projection. Other browser
sessions see completion after reconciliation without any special refresh path.

## Invariants / Guardrails

- PostgreSQL remains authoritative for confirmed progress and completion.
- Every accepted offline commit is exact-version, exact-attempt and
  exact-device bound.
- Applying the same commit more than once has no additional domain effect.
- Records are applied in contiguous client-sequence order.
- Incomplete or stale evidence cannot regress a completed attempt.
- Course and Event completion, audit and outbox transitions occur in the same
  transaction as the accepted attempt change.
- Client time cannot establish access validity or authoritative completion time.
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
