# Future Architecture Ideas

**Status:** Living architectural backlog\
**Scope:** Potential improvements and future capabilities to introduce
only when their trigger conditions are met

## Purpose

This is a forward-looking backlog, not a commitment to implement every
idea.

> **Architecture should evolve in response to real product and
> operational pressure, not fashion.**

Each idea records why it matters, the proposed direction, and when the
additional complexity becomes justified.

## Guiding Principles

- Prefer evolution over rewrites.
- Keep the modular monolith until independent scaling/deployment
  solves a demonstrated problem.
- Preserve PostgreSQL transactional guarantees.
- Keep commerce/access separate from learning evidence.
- Prefer reusable domain concepts over feature-specific duplication.
- Make failures visible before adding complexity to avoid them.
- Introduce infrastructure only for measured needs.

## Multi-instance deployment

**Priority:** Trigger-based\
**Primary benefit:** Availability and capacity\
**Trigger:** Measured load or availability requirements exceed one host

Add an ALB, at least two instances and rolling replacement. Preserve the
existing invariant that deployment waits for every target and verifies
readiness plus the deployed SHA.

## Distributed auth rate limiting

**Priority:** Near-term\
**Primary benefit:** Security\
**Trigger:** Before substantial public traffic

PostgreSQL already supplies shared/account-aware counters. Add WAF only when
edge attack volume justifies its cost.

## Operational observability

**Priority:** Near-term\
**Primary benefit:** Operations\
**Trigger:** Before meaningful production scale

Baseline alarms cover outbox/queue age, DLQ, worker heartbeat, uncertain
delivery, RDS/EC2 pressure and release readiness. Add SCORM, certificate,
Stripe and HTTP telemetry as those operational paths mature.

## Richer domain events

**Priority:** Medium\
**Primary benefit:** Extensibility\
**Trigger:** When transitions gain multiple independent reactions

Keep the outbox; distinguish commands from facts such as
enrolment.completed or registration.accepted.

## Notifications capability

**Priority:** Medium\
**Primary benefit:** Product/operations\
**Trigger:** Alongside Events

Consume committed events for registration decisions, reminders,
pre-work, cancellations, post-work and completion messages that may mention
current certificate eligibility.

## Enterprise contract model

**Priority:** Medium\
**Primary benefit:** Product fit\
**Trigger:** Before true blanket multi-course contracts

Represent organisation coverage, dates, eligibility and scope; contracts
authorise entitlements rather than learning records.

## Event read models

**Priority:** Medium\
**Primary benefit:** Coordinator UX\
**Trigger:** During Events implementation

Join authoritative registration, learner, progress and attendance data
first; project later only if necessary.

## Capability vocabulary

**Priority:** Medium\
**Primary benefit:** Security/maintainability\
**Trigger:** With coordinator/presenter roles

Keep human-friendly roles but define action-oriented capabilities and
resource scope; avoid a heavyweight policy engine.

## Support inspection tools

**Priority:** Medium\
**Primary benefit:** Support/security\
**Trigger:** Before impersonation

Build admin views of enrolments, attempts, progress, attendance,
certificates and audit evidence before adding impersonation.

## Reporting projections

**Priority:** Later\
**Primary benefit:** Reporting/performance\
**Trigger:** When transactional reporting becomes expensive

Feed read-optimised projections from domain events while source records
remain authoritative.

## Content lifecycle workflow

**Priority:** Later\
**Primary benefit:** Content operations\
**Trigger:** When authoring team/frequency grows

Add review, scheduled publish, diff, preview and archive workflows
without weakening immutable publication.

## Learning programs/journeys

**Priority:** Later\
**Primary benefit:** Product flexibility\
**Trigger:** When a real multi-offering pathway exists

Compose courses/events after both share stable activity/evidence
semantics; do not start with a generic workflow engine.

## Broader resource formats

**Priority:** Later\
**Primary benefit:** Product flexibility\
**Trigger:** When non-PDF materials are needed

Support slides, manuals, worksheets and reference files while preserving
private immutable versioning.

## Separate web/worker compute

**Priority:** Scale-triggered\
**Primary benefit:** Scalability\
**Trigger:** When worker load affects web latency

Scale background work independently while retaining outbox/SQS
contracts.

## EventBridge/SNS fan-out

**Priority:** Scale-triggered\
**Primary benefit:** Extensibility\
**Trigger:** When events routinely have several consumers

Layer fan-out after the transactional outbox rather than replacing it.

## DB connection proxying

**Priority:** Scale-triggered\
**Primary benefit:** Scalability\
**Trigger:** When connection budgets show pressure

Add RDS Proxy/PgBouncer only after modelling web + worker pool demand.

## Dedicated search

**Priority:** Scale/product-triggered\
**Primary benefit:** Search UX\
**Trigger:** When PostgreSQL search is demonstrably insufficient

Avoid search infrastructure until relevance, typo tolerance, faceting or
catalogue scale requires it. \# Reliability and Testing Ideas

## Failure Injection

Deliberately test process crashes and duplicate delivery around Stripe
fulfilment, outbox dispatch and SQS processing, plus certificate rendering,
SCORM ingestion, event capacity, and attendance/completion. The
architecture claims fault tolerance; failure tests should prove it.

## Concurrency Tests

Target final-seat access-code redemption, final event-place acceptance,
duplicate webhooks, simultaneous corrections, and competing outbox
dispatchers. These bugs are uncommon locally and expensive in
production.

## Domain Invariant Tests

Encode key architecture rules in tests: published versions cannot
mutate, scoped roles cannot cross resource boundaries, certificates
cannot render without current completion, and commercial changes cannot erase
historical evidence.

# Product-Aware Operations Ideas

## Internal Operations Dashboard

A small privileged view can show outbox age, queue age, DLQ depth,
certificate-render failures, SCORM jobs, worker heartbeat, and recent failures.
It complements---not replaces---CloudWatch/Datadog.

## Release Diagnostics

Expose safe release SHA/build identity and readiness information so
operations can quickly confirm what is running after deployment.

## Safe Replay Tooling

Provide privileged inspection and replay of failed asynchronous jobs
after remediation, with audit evidence of the replay. This is safer than
manual database/queue manipulation.

# Ideas to Avoid Until Justified

## Microservices

Bounded contexts do not require separate services. Current cross-domain
PostgreSQL transactions are valuable and distributed coordination would
add cost without a demonstrated need.

## Kafka

Do not replace SQS/outbox for architectural signalling. Kafka addresses
different streaming, retention and throughput requirements than Upskill
currently has.

## Generic Workflow Engine

Do not force courses/events into a generic DSL before real variation
requires it. Explicit typed activities and titled Sections are easier to understand
and validate.

## Generic Permission Policy Engine

Do not adopt heavyweight ABAC while explicit server-side
capability/scope helpers remain easy to reason about.

## Premature Data Warehouse

Start with transactional read models, then projections, and introduce a
warehouse only if real business analytics requirements justify it.

# Prioritisation Summary

| Idea                           | Priority                | Trigger                                              |
| ------------------------------ | ----------------------- | ---------------------------------------------------- |
| Deployment verification        | Near-term               | Before serious production rollout                    |
| Distributed auth rate limiting | Near-term               | Before substantial public traffic                    |
| Operational observability      | Near-term               | Before meaningful production scale                   |
| Richer domain events           | Medium                  | When transitions gain multiple independent reactions |
| Notifications capability       | Medium                  | Alongside Events                                     |
| Enterprise contract model      | Medium                  | Before true blanket multi-course contracts           |
| Event read models              | Medium                  | During Events implementation                         |
| Capability vocabulary          | Medium                  | With coordinator/presenter roles                     |
| Support inspection tools       | Medium                  | Before impersonation                                 |
| Reporting projections          | Later                   | When transactional reporting becomes expensive       |
| Content lifecycle workflow     | Later                   | When authoring workflow team/frequency grows         |
| Learning programs/journeys     | Later                   | When a real multi-offering pathway exists            |
| Broader resource formats       | Later                   | When non-PDF materials are needed                    |
| Separate web/worker compute    | Scale-triggered         | When worker load affects web latency                 |
| EventBridge/SNS fan-out        | Scale-triggered         | When events routinely have several consumers         |
| DB connection proxying         | Scale-triggered         | When connection budgets show pressure                |
| Dedicated search               | Scale/product-triggered | When PostgreSQL search is demonstrably insufficient  |

# How to Use This Document

When considering an item, verify its trigger has actually occurred. If
not, leave it here rather than implementing it pre-emptively.

When an idea becomes committed work, move detailed design into the
relevant domain document and create an ADR for durable architectural
decisions. Keep this document as the record of the broader opportunity
and why it was considered.

# Summary

Upskill already has a strong foundation. The most valuable future
architecture work is not replacing the stack; it is selectively maturing
reliability, event-driven reactions, enterprise access, event
operations, reporting, and support as product demand appears.

The default decision should remain: **use the simplest architecture that
preserves the domain invariants and operational guarantees already
established.**
