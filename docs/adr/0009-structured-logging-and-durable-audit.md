# ADR 0009: Structured logging and durable audit projection

Status: Accepted

## Decision

Keep PostgreSQL as the authoritative audit boundary for low-volume business and
security transitions: purchases, failed or exceptional payment fulfilment,
access-code redemption, SCORM-derived enrolment completion, package upload and
administrator package removal. These records commit in the same transaction as
the state they describe.

Administrator progress corrections remain authoritative in the dedicated
append-only `learning_progress_override` table and are not duplicated in the
global audit table. SCORM launch issuance and automated package ready/rejected
transitions are reconstructable from their domain tables and are operational
logs rather than durable global audit rows. Legacy rows using those event names
remain valid history.

All new durable audit writes pass through one typed writer. The writer inserts
the audit row and a versioned, sanitized log projection into the transactional
outbox. The worker emits the projection after commit with a stable event ID.
Delivery is at least once; downstream systems may deduplicate by that ID.

Application and worker telemetry uses a centralized structured logger. It emits
bounded JSON with reviewed scalar fields, classifies thrown values without
serializing messages, stacks, headers or response bodies, and never changes
application behaviour when logging fails. `UPSKILL_LOG_LEVEL` controls
operational verbosity; audit projections are not suppressed by that setting.

The EC2 services write stdout and stderr to journald with distinct service
identifiers. A future Datadog Agent will collect the journal stream. Application
mutations do not call Datadog directly, and Datadog is not the audit system of
record.

Runtime releases exclude source maps. Future Datadog error symbolication must
generate and upload private client, server and worker maps under the exact
deployment/release identifier before those maps are removed and the runtime
artifact is packaged. Without that separate upload, production stack traces
cannot identify the original TypeScript file and line number.

The audit table accepts only known action names, has actor/action/subject time
indexes, and rejects updates or deletes unless an explicit transaction-local
maintenance setting is enabled. Verification cleanup uses that setting inside
its own database transaction; production request and worker code has no such
path. The sole non-maintenance update is PostgreSQL's existing actor foreign-key
transition from a user ID to null during user deletion; the trigger verifies
that every other field remains unchanged.

The worker drains a bounded batch of available outbox rows before checking SQS.
When it found outbox work, the SQS receive is non-blocking so a long poll cannot
cap audit-projection throughput. Empty-outbox iterations retain SQS long polling,
and the bounded batch preserves queue fairness under sustained audit traffic.

## Consequences

Audit evidence cannot claim success for a rolled-back mutation, while operators
receive the same committed events in their normal log tooling. Temporary log
loss, retention changes or an unavailable observability vendor do not erase the
authoritative business record. Logging fields must be reviewed before being
added, and audit/outbox storage requires a separately designed retention policy.
