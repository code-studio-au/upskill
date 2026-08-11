# Transactional Outbox and Asynchronous Work

**Status:** Living architecture document\
**Scope:** Reliable post-transaction work, outbox dispatch, SQS,
idempotency, retries, failure recovery, monitoring, and future domain
events

## Purpose

Upskill's transactional outbox ensures that when a committed domain
change requires asynchronous work, the instruction to perform that work
is committed in the same PostgreSQL transaction.

> **If the business change commits, the system must durably remember its
> required asynchronous work.**

## Why It Exists

Without an outbox, a process can commit an enrolment and crash before
sending an email or queue message. Sending externally before commit
creates the opposite failure: the side effect happens even if the
database rolls back.

The outbox stores asynchronous intent beside the domain change:

```text
BEGIN
  update domain state
  record audit evidence
  insert outbox_event
COMMIT
       -> dispatcher -> SQS / log sink -> idempotent worker
```

Rollback means neither state nor work exists. Commit means both exist
durably.

## Architecture Horizons

### Current Product

PostgreSQL commits audit projections, versioned work commands and selected
enrolment facts with domain state. The dispatcher currently routes only the
explicit audit, resource and SCORM topic allowlist. SQS workers
consume the supported work commands idempotently.

`enrollment.created` and `enrollment.completed` are currently persisted as
domain facts but are not claimed by the dispatcher and have no downstream
subscriber. They must not be described as dispatched work or counted as stuck
work until a routing/subscription policy is implemented.

### Target Product

System/domain events become dispatchable contracts distinct from work commands.
They provide soft coupling for post-transition reactions such as notifications,
reporting projections or sequenced workflow steps. Adding dispatch requires an
explicit subscriber/routing model, per-reaction idempotency and completion
semantics that do not mark a multi-subscriber event finished prematurely.

### Future Possibilities

When one fact routinely has several independent consumers, fan-out may move to
EventBridge, SNS or another managed routing boundary. PostgreSQL remains the
transactional hand-off and source of durable event identity; infrastructure
changes only after the current dispatcher/subscriber model demonstrates real
pressure.

## Current Repository Architecture

The repository stores work and selected domain facts in PostgreSQL
`outbox_event`. For its supported topic allowlist, the dispatcher claims
available rows with `FOR UPDATE SKIP LOCKED`, increments attempts, and moves
`availableAt` forward as a lease. It then emits a committed audit projection or
validates and sends a versioned work message to SQS.

Successful dispatch sets `processedAt`. Failure moves `availableAt`
forward with bounded exponential backoff.

This is a strong design and should be preserved.

## Why Polling Is Intentional

Polling asks PostgreSQL: **which committed pieces of work have not been
dispatched?** It is restart-safe, transactionally coupled to business
state, independent of request-process lifetime, horizontally
dispatchable, and compatible with SQS at-least-once delivery.

## Delivery Semantics and Idempotency

Design explicitly for **at-least-once delivery**.

A dispatcher can successfully send to SQS and crash before marking the
outbox row processed. The row later retries and can publish a duplicate.
This is expected.

> **Duplicate work that reaches the same terminal state is acceptable.
> Lost work is not.**

Every handler must therefore be idempotent using domain-appropriate
mechanisms: unique constraints, terminal-state checks, stable event IDs,
conditional object writes, or processed-message records.

Examples include resource deletion succeeding when an object is already gone,
and
duplicate SCORM ingestion resolving to the same immutable outcome.

## Message Contract

Outbox work should have stable event ID, explicit schema version, topic,
aggregate ID, bounded payload, available time, attempt count, processed
time, and creation time. Identity remains stable across retries.

Payloads contain the minimum necessary data. Prefer identifiers that let
an authorised worker retrieve current state; never use generic queue
payloads as a store for access codes, secrets, sensitive survey answers,
or unnecessary personal data.

## Commands vs Domain Events

A **work command** requests a specific side effect:

```text
resource.delete
scorm.ingest
reporting.export.generate
```

A **domain event** records a fact that already happened:

```text
enrolment.completed
event.registration.accepted
event.attendance.recorded
entitlement.issued
```

One event may eventually have several independent reactions such as
notification, analytics, and reporting. Both
commands and events can use the same transactional outbox while
retaining different semantics.

## Current Product Uses

Current dispatched asynchronous work covers SCORM ingestion/deletion, resource
cleanup and committed audit projections. Enrolment
creation/completion facts are transactionally recorded but are not currently
dispatched.

## Target Product Uses

Target dispatchable domain events cover event registration transitions,
attendance and enrolment/completion facts. Post-event workers may use those
facts for notifications, incomplete pre-work reminders, post-event activities,
enterprise provisioning and reporting projections. Large/full CSV exports use a
versioned `reporting.export.generate` command that carries the export-record ID,
not raw rows or sensitive filters, and writes a private expiring S3/MinIO object
through an idempotent streaming worker.
Sequenced workflows must model prerequisites and idempotent state transitions;
they must not depend on queue delivery order alone.

## Future Possibilities

Additional uses may include analytics, cache/search invalidation, scheduled
communications, bulk imports and integration webhooks. Managed fan-out
becomes an option only when several independent consumers justify it.

Use the outbox when work must reliably follow a committed domain
transition or benefits materially from asynchronous execution. Do not
make every operation asynchronous by default.

## SQS and Worker Boundary

SQS is the deployed transport; ElasticMQ provides a compatible local
boundary. Workers validate version/schema, recheck authoritative state,
perform idempotent work, extend visibility for long jobs, delete
messages only after terminal success, and allow transient failures to
redeliver.

Long-running work such as SCORM extraction should heartbeat/extend
visibility. This reduces duplicate expensive execution but never
replaces idempotency.

Poison work should eventually reach the dead-letter queue rather than
retry invisibly forever.

## Retry and Failure Classification

Transient failures include temporary S3/network/database problems or
throttling and should retry with bounded backoff.

Permanent failures include malformed payloads, unsupported versions,
impossible invariants, or permanently invalid content. They should reach
a rejected/dead-letter path with operational visibility.

As topic count grows, expose outbox rows exceeding a meaningful attempt
threshold rather than allowing silent indefinite retry.

## Dead-Letter Queue

A DLQ message means work did not reach a terminal result after repeated
attempts. Operations should know its topic, age, failure reason, and
whether replay is safe after remediation. DLQ growth should alert
immediately.

## Observability

Monitor both the PostgreSQL outbox and SQS/worker layer.

Useful outbox metrics:

- unprocessed row count;
- age of oldest available row;
- attempts/retries by topic;
- dispatch latency;
- batch-limit saturation; and
- high-attempt rows.

Useful queue/worker metrics:

- visible messages;
- age of oldest message;
- redelivery rate;
- processing duration/failures by topic;
- visibility extensions; and
- DLQ depth/age.

Age is often more important than count: a large backlog draining quickly
can be healthy, while one old command retrying for hours is not.

A lightweight internal operations page may show outbox age, queue age,
DLQ count, processing jobs and worker heartbeat.
CloudWatch/Datadog remains the full monitoring system.

## Audit and Logging

The PostgreSQL audit ledger remains the durable business/security system
of record. Structured logs are operational telemetry.

Projecting committed audit events through the outbox lets observability
receive the same committed facts without making Datadog or another
external service part of the business transaction.

## Ordering

Do not assume global ordering. Consumers should recheck current
authoritative state and whether an event remains applicable. Where
aggregate ordering truly matters, use aggregate serialization or
explicit sequence/version numbers.

## Schema Versioning and Deployments

Every queued contract has an explicit schema version. Consumers parse
known versions strictly and reject unsupported versions safely.

Rolling deployments mean old and new workers may briefly coexist. Prefer
additive/backwards-compatible message changes.

For breaking evolution:

1.  deploy consumers that understand old and new forms;
2.  deploy new producers;
3.  allow old messages to drain;
4.  remove compatibility later.

This is safer than assuming an instantaneous deployment.

## Failure Scenarios

- **Server dies before commit:** no domain state or outbox work
  commits.
- **Server dies after commit:** outbox row remains and is later
  dispatched.
- **Dispatcher dies before publish:** lease expires and row retries.
- **Dispatcher publishes then dies before acknowledgement:** duplicate
  publish is possible; idempotency protects the domain.
- **Worker dies mid-job:** SQS visibility expires and work redelivers.
- **External dependency fails temporarily:** retry/backoff handles it.
- **Message is permanently invalid:** it reaches terminal
  rejection/DLQ and requires operational attention.

These behaviours should be deliberately tested, not merely inferred.

## Testing Strategy

Important integration/failure tests include:

- rollback creates no outbox event;
- committed transitions always create required work;
- multiple dispatchers do not claim one row concurrently;
- dispatch failure remains retryable;
- duplicate queue delivery is harmless;
- long jobs extend visibility;
- poison messages reach the DLQ;
- replay after remediation is safe;
- unsupported versions fail safely; and
- retries do not duplicate notifications or other
  domain effects.

Real PostgreSQL plus SQS-compatible local infrastructure is valuable for
these tests.

## Domain Events as the Platform Grows

Do not replace the outbox with Kafka or RabbitMQ merely for
architectural fashion. The current PostgreSQL/SQS approach is mature and
appropriate for Upskill's scale.

As more independent consumers appear, the outbox can publish richer
domain events. If true fan-out becomes necessary, EventBridge or SNS/SQS
can be layered after the outbox. The PostgreSQL transactional hand-off
remains intact.

This lets features such as registration acceptance or learning
completion trigger independent notification, reporting and analytics consumers
without coupling those features inside the
original transaction.

## Worker Scaling

`SKIP LOCKED` allows multiple dispatchers to claim different rows.
Worker concurrency should be bounded by workload characteristics.

SCORM extraction has a different CPU/memory profile from lightweight
notifications. If background work eventually affects
web latency, split web and worker compute into independently scalable
groups while retaining the same outbox/SQS contracts.

## Domain Invariants

1.  **Required asynchronous intent commits atomically with its domain
    change.**
2.  **Committed work never depends on the originating request process
    surviving.**
3.  **Delivery is at least once and consumers are idempotent.**
4.  **Event identity remains stable across retries.**
5.  **Workers validate versioned messages.**
6.  **Messages are deleted only after terminal success.**
7.  **Permanent failures become operationally visible.**
8.  **Queue payloads minimise sensitive data.**
9.  **PostgreSQL remains the audit system of record even when
    projections are emitted.**
10. **Future messaging infrastructure preserves the transactional
    PostgreSQL hand-off.**

## Recommended Evolution

### Now

- Preserve PostgreSQL outbox + SQS.
- Keep all payloads strictly versioned/validated.
- Maintain idempotency for every handler.
- Add metrics/alerts for outbox age, queue age, retry rate, and DLQ.
- Add explicit high-attempt/stuck-work visibility.

### Next

- Clearly classify topics as commands or domain events.
- Add meaningful events for registration, attendance, entitlement, and
  learning completion where multiple reactions are useful.
- Build safe failed-work inspection/replay tooling.
- Add deliberate failure-injection tests.

### Later

- Add EventBridge or SNS fan-out only when multiple independent
  consumers justify it.
- Split worker/web compute when workload contention appears.
- Add reporting projections driven by events when transactional
  reporting becomes expensive.

## Design Checklist

For new asynchronous work, ask:

1.  What committed domain transition creates this work?
2.  Is this a command or a domain event?
3.  Is the outbox insert inside the same transaction?
4.  What is the stable event/aggregate identity?
5.  What is the schema version?
6.  Is the payload minimal and safe?
7.  How does the consumer behave on duplicate delivery?
8.  Which failures are transient versus permanent?
9.  What metric/alert reveals stuck work?
10. How is replay performed safely?

## Related Architecture Documents

Read this alongside the Domain Model, Commerce and Entitlements,
Learning Domain, Events Domain, Roles and Authorisation, and Product
Architecture Review.

## Summary

The transactional outbox is one of Upskill's strongest architectural
foundations. It gives the platform fault tolerance without requiring
distributed transactions: PostgreSQL records both the business change
and the promise of follow-up work, SQS provides durable at-least-once
transport, and idempotent consumers make retries safe.

The right future direction is to mature this system with observability,
failure tooling, and richer domain events---not to replace it with
heavier messaging infrastructure before the product needs it.
