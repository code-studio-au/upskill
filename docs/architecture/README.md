# Upskill Architecture Handbook

**Status:** Living handbook index\
**Purpose:** Recommended entry point and reading order for Upskill
product and engineering architecture

## Start Here

This handbook documents both the current Upskill repository and the
recommended direction for future product development. It distinguishes
**current state**, **target model**, and **future trigger-based ideas**
so proposed architecture is not mistaken for implemented behaviour.

The concise [implemented architecture specification](../architecture.md) and
[accepted ADR collection](../adr/README.md) remain authoritative companions to
this broader product and domain handbook.

## Architecture Horizons

The handbook uses three explicit horizons:

- **Current Product** describes behaviour present in the repository and backed by
  authoritative verification.
- **Target Product** describes accepted product/domain direction that still
  requires implementation. An accepted ADR may belong here while its rollout is
  pending.
- **Future Possibilities** describes trigger-based options rather than
  commitments.

Where a document spans horizons, its headings and language must identify the
horizon. Product vision does not make a target capability current, and a future
idea does not override an accepted ADR.

## Recommended Reading Order

1.  [Upskill project overview](upskill-project-overview.md) --- product, users, commercial models,
    learning modes, and architecture overview.
2.  [Upskill domain model](upskill-domain-model.md) --- bounded contexts, concepts,
    relationships, lifecycles, and invariants.
3.  [Commerce and entitlements](commerce-and-entitlements.md) --- purchases, access grants, codes,
    entitlements, Stripe, refunds, and access boundaries.
4.  [Learning domain and activities](learning-domain-and-activities.md) --- enrolments, SCORM, surveys,
    resources, evidence, progress, and completion.
5.  [Events domain](events-domain.md) --- occurrences, sessions, registration,
    capacity, attendance, coordinators, presenters, and blended
    learning.
6.  [User onboarding](user-onboarding.md) --- versioned pre-dashboard
    questionnaires, soft-account transition, profile initialisation, privacy,
    and completion.
7.  [Roles, authorisation, and operating modes](roles-authorisation-and-operating-modes.md) --- multiple
    capabilities, ownership, scoped assignments, global admin, and
    impersonation.
8.  [Organisations and enterprise contracts](organisations-and-enterprise-contracts.md) --- bulk seats, blanket
    agreements, eligibility, coverage, utilisation, and enterprise
    entitlements.
9.  [Content authoring, versioning, and publication lifecycle](content-authoring-versioning-and-publication-lifecycle.md) ---
    drafts, immutable publication, preview, archive, rollback, and
    content lifecycle.
10. [Transactional outbox and asynchronous work](transactional-outbox-and-asynchronous-work.md) --- reliable async
    work, SQS, retries, idempotency, DLQ, and domain events.
11. [Notifications and communications architecture](notifications-and-communications-architecture.md) --- event-driven
    notifications, reminders, scheduling, templates, and delivery.
12. [Reporting, analytics, and operational observability](reporting-analytics-and-operational-observability.md) --- business
    reporting, projections, system health, alerts, audit boundaries, and
    analytics.
13. [Security architecture and threat boundaries](security-architecture-and-threat-boundaries.md) --- auth, SCORM
    isolation, Stripe, codes, uploads, secrets, IAM, CI/CD, and threat
    model.
14. [Product architecture review and roadmap](product-architecture-review-and-roadmap.md) --- current maturity,
    gaps, priorities, and implementation phases.
15. [Future architecture ideas](future-architecture-ideas.md) --- trigger-based future options that
    are not automatic commitments.
16. [Architecture decision records and engineering governance](architecture-decision-records-and-engineering-governance.md) ---
    ADRs, review triggers, documentation governance, and definition of
    done.

## Handbook Map

```text
Project Overview -> Domain Model
                      |
                      +-> Commerce / Entitlements -> Organisations / Contracts
                      +-> Learning / Activities -> Content Lifecycle -> Events
                      +-> User Onboarding -> Identity / Profile
                      +-> Roles / Authorisation
                      +-> Transactional Outbox -> Notifications
                      +-> Reporting / Observability
                      +-> Security
                      |
                      v
              Architecture Review / Roadmap
                      |
                      v
              Future Architecture Ideas

Engineering Governance + ADRs apply across all domains.
```

## Core Invariants

1.  Published educational content remains historically immutable.
2.  Existing enrolments stay pinned to exact delivered versions.
3.  Commercial access and learning evidence remain separate.
4.  Every enrolment/access path remains traceable to its origin.
5.  Completion derives from evidence and explicit rules.
6.  Events reuse learning activities rather than cloning learning
    systems.
7.  Physical, virtual and hybrid Event delivery remains independent of open
    entry, required unrestricted registration or required
    verified-domain-restricted registration policy.
8.  Users may hold multiple capabilities; scoped permissions remain
    scoped.
9.  Sensitive authorisation is enforced server-side from authoritative
    state.
10. Required asynchronous intent commits atomically through the outbox.
11. Queue delivery is at least once and consumers are idempotent.
12. Audit, observability, and reporting remain distinct.
13. Infrastructure complexity is introduced only for demonstrated need.

## Repository Layout

```text
docs/
  architecture.md
  architecture/
    README.md
    <handbook documents>
  adr/
    README.md
    0001-...
```

## Maintaining the Handbook

Update the owning document when a significant feature changes a domain
concept, invariant, lifecycle, trust boundary, permission scope,
integration, or runtime assumption. Use an ADR when a durable
architectural choice is made between credible alternatives.

The repository and authoritative tests remain the final description of
executable current behaviour. If code and current-state documentation
conflict, resolve the mismatch explicitly.

## Contributor Workflow

For significant work: read the overview/domain model, read the owning
domain document, identify invariants, define
authorisation/versioning/transactions/async/audit/privacy/failure
behaviour, implement and test those rules, update the architecture
document, and add/update an ADR when warranted.
