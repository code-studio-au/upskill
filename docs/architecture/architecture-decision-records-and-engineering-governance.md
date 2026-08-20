# Architecture Decision Records and Engineering Governance

**Status:** Living engineering-governance document\
**Scope:** Architecture handbook maintenance, ADR practice, design
review, invariants, implementation alignment, documentation ownership,
and change governance

## Purpose

Upskill now has a growing architecture handbook describing both the
current repository and the intended product direction. This document
defines how that material should remain useful as implementation
changes.

The goal is not to create bureaucracy. The goal is to prevent a familiar
failure mode: the code evolves, architectural assumptions change, and
six months later nobody can tell which documentation is still true or
why an important decision was made.

> **Architecture documentation is part of the implementation. A
> significant change is not complete until the code, tests, and
> architectural record agree.**

## Documentation Layers

Upskill should maintain several kinds of documentation with different
purposes.

### Project Overview

Explains what Upskill is, who it serves, commercial models, learning
models, personas, and the high-level architecture.

This is the recommended first read for a new contributor.

### Domain Model

Defines bounded contexts, major concepts, relationships, lifecycles, and
cross-domain invariants.

This is the shared vocabulary for product and engineering.

### Domain Design Documents

Provide deeper guidance for specific areas such as:

- Commerce and Entitlements;
- Learning and Learning Activities;
- Events;
- Roles and Authorisation;
- Organisations and Enterprise Contracts;
- Notifications;
- Content Authoring/Versioning;
- Reporting and Observability;
- Transactional Outbox; and
- Security Architecture.

### Product Architecture Review and Roadmap

Evaluates the current repository against product vision and prioritises
implementation work.

### Future Architecture Ideas

Records possible improvements and, importantly, the trigger conditions
that would justify their complexity.

### Architecture Decision Records

Record durable decisions where alternatives existed and future
contributors need to understand why the chosen direction was selected.

## Source-of-Truth Hierarchy

When documentation conflicts, use this reasoning order:

1.  **Production behaviour and authoritative tests** describe what the
    system currently does.
2.  **Current Product sections** describe the verified implementation in
    architecture language.
3.  **ADRs** explain why durable choices were made; an accepted ADR may be an
    implementation target when its status says implementation is pending.
4.  **Roadmap/future documents** describe proposed rather than
    implemented state.

A conflict between code and current-state documentation is a defect in
one of them and should be resolved explicitly.

Do not silently reinterpret a roadmap recommendation as if it is already
implemented.

## Current State vs Target State

Every architecture document that spans current and future behaviour
should distinguish them clearly.

Use these headings consistently:

```text
Current Product
Target Product
Future Possibilities
```

Add an implementation sequence inside Target Product when staged delivery is
material. Do not use "future" for an accepted near-term target merely because it
has not shipped yet.

Avoid ambiguous statements such as "Upskill uses enterprise
entitlements" when the repository currently only has course-specific
access grants and the entitlement model is still a recommendation.

## Architecture Decision Records

An ADR captures one significant architectural decision.

Use ADRs for choices that are:

- difficult or costly to reverse;
- cross-cutting;
- security/reliability significant;
- likely to be questioned later;
- made between credible alternatives; or
- important to preserving domain invariants.

Do not create ADRs for every component, CSS choice, or routine
implementation detail.

## Recommended ADR Format

```markdown
# ADR-NNN: Decision title

## Status

Proposed | Accepted | Accepted; implementation pending | Superseded | Deprecated
Date: YYYY-MM-DD

## Context

What problem/constraint caused this decision?

## Decision

What are we choosing?

## Rationale

Why is this the best fit for Upskill now?

## Alternatives Considered

What credible alternatives were rejected and why?

## Consequences

What becomes easier, harder, or constrained?

## Invariants / Guardrails

What must remain true in implementations of this decision?

## Follow-up / Triggers

What would cause us to revisit the decision?

## Related Documents

Links/references to domain docs, issues, PRs, or earlier ADRs.
```

## ADR Alignment

Accepted decisions live in the [ADR collection](../adr/README.md), outside the
handbook directory so the current specification, domain guidance and decision
history remain distinct.

| Area                                                 | Governing ADRs                                                                                                                                                                                                                                                                                                                                                                 | Alignment                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Application model and runtime                        | [0001](../adr/0001-tanstack-start-application-model.md), [0006](../adr/0006-runtime-and-dependency-cohorts.md), [0013](../adr/0013-tanstack-form-and-client-budget.md)                                                                                                                                                                                                         | Implemented                                                                       |
| Identity, commerce and authorization                 | [0002](../adr/0002-identity-commerce-authorization.md), [0022](../adr/0022-stable-identity-and-historical-attribution.md)                                                                                                                                                                                                                                                      | Current identity implemented; historical-attribution adoption is feature-specific |
| Versioned learning and content                       | [0003](../adr/0003-versioned-learning-domain.md), [0010](../adr/0010-versioned-course-authoring-and-section-progress.md), [0011](../adr/0011-versioned-surveys-and-response-evidence.md), [0012](../adr/0012-versioned-pdf-resource-library.md), [0020](../adr/0020-learning-activity-versions.md), [0030](../adr/0030-standard-survey-question-types-and-option-authoring.md) | Common envelope implemented; expanded Survey types are target work                |
| SCORM, storage and asynchronous delivery             | [0004](../adr/0004-scorm-and-object-storage.md), [0008](../adr/0008-sqs-worker-delivery.md)                                                                                                                                                                                                                                                                                    | Implemented for the current work-command allowlist                                |
| Mantine, CSP and responsive UI                       | [0005](../adr/0005-mantine-csp-responsive-ui.md)                                                                                                                                                                                                                                                                                                                               | Implemented                                                                       |
| AWS deployment and local delivery fidelity           | [0007](../adr/0007-aws-deployment-and-verification.md), [0017](../adr/0017-local-tls-and-http-compression.md)                                                                                                                                                                                                                                                                  | Implemented foundation; deployment completion verification remains roadmap work   |
| Audit, logging and progress corrections              | [0009](../adr/0009-structured-logging-and-durable-audit.md), [0018](../adr/0018-audited-progress-overrides.md)                                                                                                                                                                                                                                                                 | Implemented                                                                       |
| Certificates                                         | [0014](../adr/0014-completion-certificate-issuance.md)                                                                                                                                                                                                                                                                                                                         | Implemented                                                                       |
| Administrator enrolment and access-grant lifecycle   | [0015](../adr/0015-administrator-enrollment-lifecycle.md), [0016](../adr/0016-administrator-access-grant-lifecycle.md)                                                                                                                                                                                                                                                         | Implemented lifecycle                                                             |
| Encrypted recoverable access codes                   | [0019](../adr/0019-encrypted-recoverable-access-codes.md)                                                                                                                                                                                                                                                                                                                      | Implemented                                                                       |
| Database migration policy                            | [0007](../adr/0007-aws-deployment-and-verification.md), [0021](../adr/0021-pre-production-schema-rebaselining.md)                                                                                                                                                                                                                                                              | Resettable pre-production baseline; forward-only after production trigger         |
| Onboarding and open-entry guest check-in             | [0022](../adr/0022-stable-identity-and-historical-attribution.md), [0023](../adr/0023-onboarding-and-open-entry-guest-check-in.md), [0029](../adr/0029-survey-backed-versioned-user-onboarding.md)                                                                                                                                                                             | Onboarding and initial open-entry guest access implemented                        |
| Event prerequisite recovery and passwordless auth    | [0024](../adr/0024-event-prerequisite-recovery-and-passwordless-access.md)                                                                                                                                                                                                                                                                                                     | Accepted target; implementation pending                                           |
| Event registration finalisation and Section release  | [0025](../adr/0025-event-registration-finalisation-and-section-release.md)                                                                                                                                                                                                                                                                                                     | Implemented                                                                       |
| Entitlements and Access Owner commerce               | [0034](../adr/0034-source-neutral-entitlements-and-access-owner-disclosure.md), [0035](../adr/0035-bulk-order-checkout-and-refund-preservation.md)                                                                                                                                                                                                                             | Implemented for course sources and assigned grants                                |
| Regional Event review, selection and late invitation | [0026](../adr/0026-regional-event-registration-selection.md)                                                                                                                                                                                                                                                                                                                   | Regional review implemented; expiring late invitations pending                    |
| Section-embedded automated emails                    | [0027](../adr/0027-section-embedded-automated-emails.md)                                                                                                                                                                                                                                                                                                                       | Section plans implemented; durable scheduling and delivery pending                |
| Versioned Event Templates and resilient staff cover  | [0028](../adr/0028-versioned-event-templates-and-admin-ownership.md)                                                                                                                                                                                                                                                                                                           | Accepted; relational foundation and initial authoring implemented                 |

New Events, enterprise-entitlement, notification and scoped-assignment
decisions should receive ADRs when their implementation design is accepted.

## ADR Status Lifecycle

### Proposed

Decision is being reviewed and should not yet be treated as settled
architecture.

### Accepted

Decision is current and should guide implementation.

An accepted decision may be explicitly marked `implementation pending`. In that
case it governs the target design but must not be presented as current runtime
behaviour until its migration and verification are complete.

### Superseded

A newer ADR replaces it. Keep the old ADR for historical context and
link to the replacement.

### Deprecated

Decision is no longer recommended but may still exist in parts of the
code while migration occurs.

Never rewrite an old accepted ADR to make it look as though a later
decision was always the original decision.

## When a Feature Needs Design Review

A feature should receive explicit architectural review when it:

- introduces a new bounded context or major domain concept;
- changes an invariant;
- changes published-content versioning;
- changes payment/entitlement semantics;
- adds a new privileged capability;
- changes event registration/attendance/completion semantics;
- introduces a new external service;
- introduces a new queue/event contract;
- changes data retention/privacy exposure;
- changes deployment/topology; or
- materially changes failure/concurrency behaviour.

Small UI changes and straightforward additions inside established
patterns usually do not need formal architecture review.

## Feature Design Record

For significant features, capture a lightweight design before
implementation.

Suggested structure:

```text
Problem / user need
Owning bounded context
Current behaviour
Proposed behaviour
Concepts and lifecycle
Invariants
Authorisation and data scope
Versioning / historical impact
Evidence / completion impact
Transaction boundaries
Async / outbox events
Audit requirements
Privacy/security
Failure and concurrency cases
Migration/backwards compatibility
Testing strategy
Operational metrics
Rollout / rollback
Related ADRs/docs
```

This may live in a design document, issue, or PR description depending
on the size of the change.

## Invariant-First Development

Before designing tables or components, identify the rules that must
remain true.

Examples:

```text
A published course version cannot mutate.
A final organisation seat cannot be redeemed twice.
A coordinator for Event A cannot access Event B.
A certificate cannot be rendered without current verified completion.
A refund cannot silently erase learning evidence.
Committed required async work cannot be forgotten.
```

Important invariants should be reflected in database constraints, server
boundaries, tests, or multiple layers where appropriate.

Documentation alone is not enforcement.

## Repository Verification as Governance

The repository's verification gates are part of architectural
governance.

The current scripts include formatting/linting, type checking, dead-code
verification, security/dependency checks, coverage, production
build/bundle verification, database-domain verification, and CDK
verification.

The current `verify:ci` pipeline composes these gates and should remain
the baseline for changes affecting production architecture.

When a new domain gains a critical invariant, add verification rather
than relying only on prose.

Examples:

- event capacity verifier;
- event scoped-authorisation verifier;
- enterprise contract/entitlement verifier;
- notification idempotency verifier;
- deployment/release verification.

## Test Pyramid for Domain Changes

Use the cheapest layer that proves the rule while retaining enough
integration coverage.

### Unit tests

Pure policy, validation, state transition, formatting, and calculation
logic.

### Database integration tests

Transactions, constraints, row locks, authorisation queries, immutable
versioning, idempotency, and concurrency. The complete database gate owns a
uniquely named, migrated localhost PostgreSQL database and drops it in a
`finally` boundary instead of creating verification fixtures in the normal
development database.

### Worker/integration tests

Outbox dispatch, queue message validation, retries, duplicate delivery,
and external adapter boundaries.

### Browser/E2E tests

Critical user journeys and security boundaries that require the complete
browser/server interaction. Each invocation owns a uniquely named, migrated and
seeded localhost PostgreSQL database and new application origins. Cleanup drops
the complete test database in a `finally` boundary, including after a failed
journey. Playwright must not reuse a developer server because that can route UI
mutations to the normal local database even when the test process uses a
different connection string.

Do not attempt to prove every database invariant through Playwright.

## Failure-Oriented Review

For important features, explicitly ask:

- What if the request is sent twice?
- What if two users act concurrently?
- What if the process dies before commit?
- What if it dies after commit?
- What if SQS delivers twice?
- What if the external provider is unavailable?
- What if the user's permission changes mid-flow?
- What if content/contract/event state changes before async work
  executes?

Architecture review should consider failure paths as first-class
behaviour.

## Security Review Triggers

Require deliberate security review for changes involving:

- authentication/session behaviour;
- global/scoped permissions;
- impersonation;
- access codes or other credentials;
- Stripe/payment flows;
- file uploads or new renderable formats;
- SCORM/runtime execution;
- new third-party providers;
- PII exports/reporting;
- encryption/key management;
- secrets/IAM/networking; or
- data retention/deletion.

Update the Security Architecture document when the trust model changes.

## Database Migration Governance

Upskill currently has no non-disposable environment or real user data. Under
[ADR 0021](../adr/0021-pre-production-schema-rebaselining.md), an accepted
breaking domain change may therefore rebase existing migration files and reset
local/CI PostgreSQL data. Fresh-database construction, complete database
behaviour verification, current generated types and removal of the obsolete
model are required. This is a temporary flexibility policy, not a production
migration technique.

At the production-baseline trigger in ADR 0021, executed migrations freeze.
From that point migrations must be forward-safe and deployable with the
application release strategy.

For high-risk schema changes:

1.  prefer additive schema first;
2.  deploy code that can tolerate old/new states where needed;
3.  backfill asynchronously or in bounded operations if large;
4.  switch reads/writes deliberately;
5.  verify data/invariants; and
6.  remove obsolete schema in a later release.

After that trigger, avoid a migration that requires every application instance
to switch atomically unless deployment guarantees that behaviour. Never use the
pre-production reset permission to weaken published-content, evidence or audit
immutability inside the product model.

## Message Contract Governance

Every queued/outbox contract should be versioned.

Breaking message changes follow expand/contract deployment:

1.  consumers accept old + new;
2.  producers emit new;
3.  old messages drain;
4.  old support is removed later.

Unknown versions fail safely and visibly.

## API / Server Function Governance

Server functions should remain domain-oriented rather than exposing
arbitrary table CRUD.

Prefer operations such as:

```text
acceptEventRegistration()
redeemAccessGrant()
publishCourseVersion()
overrideLearningActivityCompletion()
```

rather than generic update endpoints that push invariant enforcement
into clients.

## Documentation Update Rules

A change should update documentation when it changes:

- a domain concept;
- a lifecycle/state transition;
- an invariant;
- a trust boundary;
- a significant integration;
- a deployment/runtime assumption;
- a user capability/scope;
- a commercial access model; or
- the recommended implementation sequence.

Do not update every document for every feature. Update the smallest set
that owns the changed truth and ensure cross-references remain valid.

## Documentation Review Cadence

At minimum, review the architecture handbook:

- before major product-domain implementation;
- after major architectural changes land;
- before significant production launches; and
- periodically as part of technical planning.

The Product Architecture Review/Roadmap should be refreshed more
frequently than stable ADRs.

## Avoiding Documentation Drift

Useful practices include:

- link docs from README/contributor onboarding;
- cross-reference domain docs from relevant code modules where
  appropriate;
- include "docs/ADR updated?" in significant PR checklists;
- make architecture review part of feature kickoff rather than
  post-hoc documentation;
- mark proposed/future behaviour explicitly;
- remove obsolete recommendations or mark them superseded; and
- add executable tests for critical documented invariants.

## Ownership

Architecture documents should have collective engineering/product
ownership rather than depending on one person remembering to maintain
them.

For major domains, identify a practical reviewer/owner who understands
both product behaviour and implementation, but keep the documents
accessible for team contribution.

## PR Expectations

A significant PR should explain:

- the user/business problem;
- relevant domain/invariant;
- implementation approach;
- migration/compatibility implications;
- security/privacy impact;
- failure/concurrency behaviour;
- tests added/updated;
- architecture docs/ADR changed; and
- rollout/rollback considerations where relevant.

The PR should not need to reproduce entire architecture documents; it
should point to them and explain the delta.

## Review Questions

Reviewers should ask:

1.  Does this belong in the chosen bounded context?
2.  Does it preserve documented invariants?
3.  Is historical state still reconstructable?
4.  Is authorisation server-side and correctly scoped?
5.  Are transactions/concurrency correct?
6.  Is required async work transactionally recorded?
7.  Are workers idempotent?
8.  Is sensitive data minimised?
9.  Are failure modes observable?
10. Do the docs/tests now match the implementation?

## Definition of Done for Significant Architecture Work

A significant architecture/domain change is complete when:

- implementation is merged;
- migrations are safe/applied;
- tests prove important invariants;
- security/privacy implications are addressed;
- operational signals exist where needed;
- relevant domain docs reflect current state;
- ADR is accepted where warranted; and
- obsolete recommendations are marked or removed.

## Anti-Patterns

### Documentation after the fact only

Writing architecture documentation after implementation often records
accidental design rather than deliberate design. Use documents to shape
significant work before code where practical.

### ADR for everything

Too many trivial ADRs make important decisions impossible to find.
Record decisions with durable architectural consequence.

### Immutable documentation

Architecture documents themselves must evolve. Historical decisions
belong in ADR history; current domain docs should describe
current/target truth clearly.

### Architecture by aspiration

Do not document Kafka, microservices, a warehouse, or a generic workflow
engine as current architecture merely because they are possible future
ideas.

### Invariants only in prose

If violating a rule would damage data, money, security, or learning
history, enforce/test it in code/database as well.

## Repository Documentation Structure

The repository uses:

```text
docs/
  architecture.md
  architecture/
    README.md
    <product and domain handbook documents>
  adr/
    README.md
    0001-...
```

`architecture.md` is the concise implemented-system specification. The
`architecture/` directory distinguishes current product, accepted target and
future possibilities. The `adr/` directory preserves durable decision history
and status.

## Governance Invariants

1.  **Current-state documentation must not present future
    recommendations as implemented fact.**
2.  **Durable architectural decisions retain historical ADR context.**
3.  **Significant invariant changes require explicit review.**
4.  **Critical invariants are enforced/tested, not only documented.**
5.  **Message changes remain deployable across rolling versions; database
    schema changes do so after the production-baseline trigger.**
6.  **Security trust-boundary changes trigger security review/document
    updates.**
7.  **Roadmap documents may evolve; accepted ADR history is preserved.**
8.  **Architecture work includes operational and failure behaviour, not
    only happy-path code structure.**
9.  **Documentation is discoverable from contributor onboarding.**
10. **The simplest architecture that satisfies current product
    constraints remains preferred.**

## Recommended Next Steps

1.  Freeze the migration baseline and enable forward-only enforcement before
    the first non-disposable environment or external user.
2.  Keep current product, target product and future possibilities explicit in
    every document that spans more than one horizon.
3.  Add documentation/ADR prompts to significant PR templates.
4.  Add executable verification for new Events, entitlement,
    notification, and scoped-authorisation invariants as those domains
    are implemented.
5.  Add deterministic internal-link and ADR-index verification to CI.
6.  Review the Product Architecture Roadmap at major planning
    milestones.

## Summary

Upskill's architecture handbook should be treated as an active
engineering tool rather than a one-time documentation project.

Domain documents explain what the system means. ADRs explain why durable
choices were made. Tests and database constraints enforce the rules that
cannot be broken. The roadmap describes where the product is heading
without pretending future work already exists.

That combination gives future contributors enough context to evolve
Upskill deliberately without repeatedly rediscovering the reasoning
behind its strongest architectural decisions.
