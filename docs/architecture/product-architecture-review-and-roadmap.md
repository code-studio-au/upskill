# Product Architecture Review and Roadmap

**Status:** Living review and implementation roadmap\
**Repository:** `code-studio-au/upskill`\
**Scope:** Current architecture, product fit, risks, missing
capabilities, and recommended implementation sequence

## Executive Summary

Upskill has a strong engineering foundation and should evolve rather
than be rewritten. The modular monolith, PostgreSQL/Kysely transactional
model, immutable learning versions, isolated SCORM runtime,
transactional outbox, Stripe reconciliation, audit model, and
verification discipline are appropriate for the product.

The next major challenge is **product-domain expansion**, particularly
first-class events, enterprise entitlements, scoped event roles,
communications, and reporting. The architecture can support these
additions without changing the core stack.

Overall architectural maturity is high for the current product stage.
The highest-value work is to preserve existing invariants while
formalising domain concepts that are currently implicit.

## Product Lens

Upskill currently serves individual healthcare professionals and healthcare
organisations through self-paced learning, individual purchases and fixed-seat
access grants. The target product also serves enterprise/government customers
through broad workforce access and delivers instructor-led physical/virtual
events containing pre-work, surveys, resources, attendance and post-work.

The architecture should therefore optimise for:

- accurate historical professional-learning records;
- flexible commercial access models;
- reusable learning activities;
- event operations and attendance;
- clear scoped staff responsibilities;
- reliable certificates and communications;
- strong support tooling; and
- low operational complexity.

## Architecture Strengths to Protect

### Modular monolith

The current modular-monolith approach is the correct trade-off.
Payments, entitlements, enrolments, completion, audit, and outbox work
benefit from one PostgreSQL transactional boundary. Microservices would
currently add coordination and operational cost without solving a
demonstrated scaling problem.

### Immutable learning versions

Stable course/content identities separated from immutable published
versions are one of the strongest domain decisions. Existing learners
remain pinned to exact versions, preserving historical accuracy and
supportability.

### Transactional commerce

Stripe webhook fulfilment is authoritative rather than browser
redirects. Order locking, amount/currency checks, exact course-version
snapshots, and idempotent fulfilment are appropriate financial controls.

### Capacity-safe access grants

Organisation code redemption uses database serialization to prevent
capacity oversubscription. Preserve this approach as access models
expand.

### Transactional outbox

The outbox provides reliable hand-off from committed domain changes to
SQS/worker processing and is an excellent foundation for future
notifications, projections, and domain events.

### SCORM isolation

SCORM content runs on a separate learning origin with short-lived
credentials and attempt sessions, preventing third-party package
requirements from weakening the primary application's security boundary.

### Verification discipline

The repository has unusually strong verification for its age: strict
typing/linting, dead-code checks, dependency/security gates, coverage,
production builds, bundle budgets, browser testing, database-domain
verifiers, and CDK verification.

## Current Capability Assessment

| Capability                         | Current maturity                                  | Direction                                                                  |
| ---------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| Public course catalogue            | Strong                                            | Continue incremental UX/product growth                                     |
| Individual course checkout         | Strong                                            | Preserve transaction and idempotency model                                 |
| Learner enrolment/workspace        | Common activity-version foundation                | Extend the model to Events and attendance                                  |
| SCORM delivery                     | Strong                                            | Preserve isolation and immutable versions                                  |
| Surveys                            | Strong foundation                                 | Reuse in courses and target Events                                         |
| Resources                          | Strong foundation                                 | Broaden beyond PDF when required                                           |
| Certificates                       | On-demand rendering implemented                   | Reuse the common completion-eligibility boundary                           |
| Organisation access codes          | Strong encrypted lifecycle                        | Evolve toward explicit entitlements/contracts                              |
| Customer Access Owner portal       | Target design                                     | Add scoped invitations, utilisation views and eligible capacity extensions |
| Enterprise blanket access          | Partial concept                                   | Add a first-class contract/coverage model                                  |
| Course administration              | Strong foundation                                 | Add authoring workflow maturity as needed                                  |
| Learner administration             | Strong foundation                                 | Add richer support tooling over time                                       |
| Events                             | Relational foundation and initial admin authoring | Extend into registration, attendance and learner workflows                 |
| Coordinator workflows              | Missing                                           | Add resource-scoped event operations                                       |
| Presenter workflows                | Missing                                           | Add a narrow attendance-focused mode                                       |
| Attendance                         | Missing                                           | Add a durable evidence model                                               |
| Authenticated user onboarding      | Accepted target                                   | Add Survey-backed version assignment, privacy-scoped response and gating   |
| Open-entry guest check-in          | Target design                                     | Guard virtual links and create provisional-user/check-in evidence          |
| Passwordless prerequisite recovery | Target design                                     | Add SMS/email OTP, task sessions and scoped facilitated Survey fallback    |
| Staged Event release               | Target design                                     | Add final registration lock-in and time-anchored Section availability      |
| Regional Event selection           | Target design                                     | Add regional review/lock, cross-region selection and late invitations      |
| Automated email/notifications      | Accepted target                                   | Add Email Designer, Section plans, occurrence overrides and delivery       |
| Reporting/visual analytics         | Basic read boundaries                             | Add filtered charts/tables; project only when justified                    |
| Global support/impersonation       | Future possibility                                | Add carefully with audit safeguards                                        |
| Operational observability          | Partial                                           | Treat as a production-hardening priority                                   |

## Priority 0/1 --- Production Reliability

### Deployment success verification

The deployment workflow sends SSM commands to tagged EC2 instances but
needs stronger end-to-end confirmation that every target actually
installed and started the requested release.

Recommended implementation:

1.  capture SSM command ID;
2.  resolve all intended target instances;
3.  wait for every invocation;
4.  fail deployment if any invocation fails/times out;
5.  expose deployed release SHA/version;
6.  verify health/readiness through the ALB after deployment; and
7.  eventually consider immutable rolling instance replacement if
    deployment complexity grows.

**Benefit:** GitHub deployment success becomes trustworthy rather than
meaning only that a deployment command was submitted.

### Distributed authentication rate limiting

Better Auth currently uses process-memory rate limiting. With multiple
production instances, counters are instance-local and reset on restart.

Recommended direction: coarse AWS WAF rate limiting at the edge plus an
appropriate shared/account-aware mechanism where finer controls are
required.

The same boundary must protect password, email OTP and verified-mobile SMS OTP
challenges, resends and verification. Add normalized verified mobile numbers,
provider-neutral SMS delivery, signed exact-route return state and short-lived
event-task sessions under [ADR 0024](../adr/0024-event-prerequisite-recovery-and-passwordless-access.md).

**Benefit:** consistent abuse protection across horizontal scaling.

### Access-code protection — delivered

Human-readable access codes remain intentionally retrievable. ADR 0019 is
implemented:

```text
submitted code -> embedded public lookup ID -> indexed PostgreSQL row
selected ciphertext -> authenticated decryption -> full-code comparison
encryption key material -> Secrets Manager / KMS boundary
```

Authorised repeated recovery remains possible while reducing database-only
compromise impact. Preserve this boundary as grants evolve into explicit
entitlements and Access Owner views.

### Operational observability

Add metrics and alerts for outbox age, SQS age, DLQ depth, worker
failures, certificate-render errors/latency, SCORM processing/rejections, RDS
health/connections, ALB errors, and deployment version.

**Benefit:** failures are discovered by the platform before users report
them.

## Priority 1 --- First-Class Events

Events are a core product delivery mode and should be the next major
domain expansion.

Implement:

- stable Event Template identity, immutable versions and exact-version Event
  Instances;
- one or more versioned default standard administrators and default Coordinators
  per configured region plus default Presenters per presenter-required scope,
  automatically snapshotted into new instances;
- immediate role/assignment revocation with retained attribution, replacement or
  standard-admin fallback, and successor Template versions that remove disabled
  administrator/Coordinator/Presenter defaults;
- scheduled occurrences;
- in-person/virtual delivery;
- sessions/days;
- capacity and registration windows;
- occurrence-level open entry, required unrestricted registration or required
  verified-domain-restricted registration, independent of delivery mode;
- guarded open-entry guest links that collect point-in-time name/email, create
  or reuse a provisional not-onboarded user without Registration/authentication,
  and distinguish check-in from attendance;
- exact-prerequisite QR recovery using password/email OTP/SMS OTP first, with
  shared-device task sessions and a last-resort one-survey email-match capability;
- an Event Occurrence-owned QR catalogue for every contained Survey item,
  optional Session scope and Presenter full-screen display;
- learner-specific, audited platform-administrator override of a domain
  restriction without changing the occurrence allowlist, using the shared
  name/email soft-account provisioning and setup flow;
- registration lifecycle and approval;
- configurable hierarchical Coordination Regions and occurrence-region
  Coordinator assignments, including multiple Coordinators per region;
- learner-confirmed Registration Region Snapshots that survive later profile
  moves;
- provisional Coordinator candidate decisions, optional descending numeric
  priority and regional-list manual/deadline lock;
- one or more standard Platform Administrators recorded as shared Event Instance
  owners, with consolidated capacity-safe cross-region final selection;
- high-entropy user-specific late-registration invitations that bypass only the
  public cutoff and enter a separate administrator-owned candidate queue;
- rescheduling options to keep/replace registration cutoffs or open a new
  retained regional review round without disturbing confirmed attendees;
- mandatory reschedule-time reconfirmation of applicable regions and Coordinator
  assignments, including newly reachable regions without erasing retired-region
  history;
- explicit retired-region disposition, with impact preview and participant-level
  cancellation rather than accidental whole-Event cancellation;
- transaction-safe capacity;
- standard-admin Event Instance ownership, occurrence-and-region Coordinator and
  occurrence/session Presenter assignments;
- attendance evidence;
- ordered, titled Event Sections containing pre-event, live-event and post-event
  activities;
- Section release rules for immediate, relative pre/post Session and delayed
  Follow-up access, with open-entry late-join semantics;
- common event completion; and
- certificate integration.

Do not build separate event-specific SCORM/survey/resource systems.
Reuse learning activities.

**Benefit:** enables Upskill's instructor-led business model without
creating a second LMS.

## Priority 1 --- Hybrid Authorisation

Formalise global capabilities, ownership-based learner access, and
resource-scoped event assignments.

Do not replace product personas; use them as understandable capability
bundles. Do not create combined roles for every possible responsibility
combination.

Build focused operating modes for Learning, Administration, Coordinator,
and Presenter.

**Benefit:** users can hold overlapping responsibilities without
over-permissioning or confusing UI.

## Priority 1/2 --- Explicit Entitlements and Enterprise Contracts

The existing `access_grant` model works well for course-specific
capacity codes but should not absorb every future commercial model.

Introduce explicit entitlement semantics incrementally:

```text
commercial source -> entitlement -> enrolment -> learning
```

Add a first-class enterprise agreement model when blanket multi-course
access is implemented, covering organisation, effective/renewal dates,
covered offerings, eligibility, unlimited/capped access, and audit
history.

Add Access Owner assignments at bulk-grant/contract creation. Bind invited
emails to verified accounts, provide a narrow assigned-source dashboard and
allow Stripe-backed additional-use purchases only for eligible finite grants.
This is resource-scoped customer self-service, not organisation-wide or
platform administration.

**Benefit:** individual purchases, 20-seat organisation purchases, and
whole-workforce government contracts converge on one learning access
model.

## Implemented Foundation --- Learning Activity Abstraction

The repository now has explicit stable `learning_activity` identities and
common `learning_activity_version` envelopes. Course-version items hold one
exact version reference plus its discriminating kind, while SCORM, surveys and
resources retain validated type-specific content and evidence tables.

Each activity kind is standardised around:

- exact immutable version;
- access/launch;
- evidence;
- completion rule;
- required/optional state;
- override semantics; and
- common progress state.

The next extension is to use the same model for event attendance and other
Event Section requirements. That should add a typed child-content/evidence
contract rather than another set of polymorphic course/event columns.

**Benefit:** future learning types can be added without rewriting
course/event progress.

## Priority 2 --- Notifications

Events and enterprise learning will make communications increasingly
important.

Create a notification capability that reacts to committed domain events rather
than embedding email sends in transactions. Add a governed Email Designer with
immutable Offering/System Email versions, typed variables, preview, publication
and rollback. System administrators may revise content without changing
code-owned trigger, recipient or security behavior.

Event/Course authors insert compatible Automated Email Items among the
administration view of Section items. Each item uses an explicit trigger/timing
and audience; it is not a Learning Activity and cannot affect completion.
Publishing pins exact email versions. Event Occurrences snapshot a Communication
Plan whose assigned standard Platform Administrators can override locally for
eligible unsent messages only.

Initial use cases:

- registration received/accepted/declined;
- event reminders;
- incomplete pre-work reminders;
- event changes/cancellation;
- post-event survey reminders;
- completion messages with conditional certificate-download guidance; and
- selected access/enrolment communications.

Delivery history pins the exact immutable email/override version and reproducible
rendered subject/body received at that time. New publication never silently
rewrites published offerings, existing plans, queued intents or sent history.

Use the transactional outbox for reliable hand-off and idempotent
notification delivery.

**Benefit:** communications become reliable, reusable, and decoupled
from core domain transactions.

## Priority 2 --- Support Tooling

Before implementing impersonation, build strong administrator inspection
views for common support scenarios:

- enrolment/access state;
- SCORM attempts;
- survey/resource completion;
- event registration;
- attendance;
- completion and current certificate eligibility; and
- relevant audit history.

Then add impersonation only for cases requiring reproduction of the
exact user experience.

**Benefit:** solves most support problems with lower security risk.

## Priority 2 --- Visual Learning Analytics

Build a responsive Platform Administrator analytics workspace with URL-backed,
schema-validated filters for Course/Event class, stable offering, exact Course
Version/Event Instance, explicit date dimension/range, completion state and
hierarchical region. Provide KPI, trend, stacked completion and regional charts
with an accessible table/drill-down using the same authorized semantic query.

Expose denominator/as-of/timezone labels. Distinguish current User region from
participation-time Event Registration/Course Enrolment Region Snapshots and
distinguish Event incomplete from up-to-date work with locked future
requirements. Lazy-load charting code and retain bundle/CSP/mobile constraints.

**Benefit:** administrators can explore outcomes visually without ambiguous
spreadsheets or misleading historical cohorts.

Provide filtered and all-authorized CSV export from the same semantic query.
Versioned Course/Event datasets cover enrolment/participation summaries, overall
progress/completion, normalized Section/activity progress and Event Session
Attendance. Full learning export may bundle those CSVs with a manifest rather
than flattening one-to-many data. Large exports use durable streaming jobs and
private expiring downloads with formula-injection protection.

## Priority 2/3 --- Reporting Projections

Keep PostgreSQL transactional records authoritative. Continue bounded
reporting queries initially.

When dashboards become expensive, build read-optimised projections fed
from domain events for areas such as:

- organisation utilisation;
- access-code redemption/capacity;
- event registration funnel;
- attendance;
- pre-work completion;
- course completion;
- certificate-render demand/failures; and
- operational queue health.

**Benefit:** fast reporting without contaminating write models or
prematurely introducing a data warehouse.

## Priority 3 --- Content Lifecycle Maturity

Immutable published versions are already correct. As authoring volume
grows, add workflow rather than weakening immutability:

- draft review;
- scheduled publication;
- version comparison/diff;
- clear archive rules;
- preview environments; and
- potentially approval workflow if multiple content roles emerge.

**Benefit:** safer non-technical authoring and clearer change
management.

## Priority 3 --- Learning Programs/Journeys

Only after courses and events share clean activity/evidence semantics,
consider a higher-level program that composes multiple offerings.

Example:

```text
Foundation course -> workshop -> post-event evaluation -> advanced course
```

Do not implement this early as a generic workflow engine.

**Benefit:** supports structured professional-development pathways
without creating another learning subsystem.

## Infrastructure Evolution Triggers

### Split web and worker compute when

- SCORM/PDF jobs materially affect web latency;
- queue workload scales differently from HTTP traffic; or
- independent worker scaling provides clear cost/reliability value.

### Add EventBridge/SNS fan-out when

- domain events have several genuinely independent consumers; and
- direct SQS work-command routing becomes awkward.

Keep the PostgreSQL outbox as the transactional hand-off.

### Add RDS Proxy/PgBouncer when

- connection-count modelling shows pool pressure from web + worker
  scaling.

Do not add these components pre-emptively.

## Database and Concurrency Review

Continue using explicit database locks/constraints for
capacity-sensitive and replay-sensitive workflows.

Model production connection budgets as:

```text
max web instances * web pool
+ worker processes * worker pool
+ migration/operations headroom
```

Add concurrency tests for:

- final access-grant seat redemption;
- final event capacity acceptance;
- duplicate Stripe webhook fulfilment;
- simultaneous progress/completion changes;
- attendance corrections; and
- outbox dispatcher claims.

## Frontend Direction

The current TanStack Router/Start + TanStack Form + Zod + Mantine
approach is coherent.

Continue using router-backed GET state for catalogue/search and typed
form state for interactive mutations.

Keep route splitting and critical-route bundle budgets, but avoid
allowing a single arbitrary global JavaScript byte cap to distort
component architecture. User-centric critical-route budgets matter more
than the sum of every lazy admin chunk.

Operating-mode navigation will become important once coordinator and
presenter experiences are added.

## Testing Roadmap

Preserve existing unit, database integration, browser, bundle, and CDK
gates.

Add more failure-oriented testing:

- SQS send succeeds then dispatcher crashes;
- worker dies during long SCORM processing;
- duplicate notification event;
- registration capacity race;
- access-code capacity race;
- access removed during active SCORM attempt;
- event attendance corrected after completion;
- completion revoked/re-established around on-demand certificate access; and
- rolling deployment with old/new message consumers.

The architecture already claims resilience to many of these scenarios;
tests should prove it.

## Documentation and ADR Practice

Treat the architecture handbook as a first-class repository artifact.

A significant feature should update the relevant domain document. Add an
ADR when a durable architectural choice is made, recording context,
decision, consequences, and alternatives rejected.

This prevents future contributors from seeing only what the code does
without understanding why.

## Recommended Implementation Phases

### Phase A --- Production hardening

- deployment verification;
- distributed rate limiting;
- operational metrics/alerts;
- release/readiness visibility;
- failure-injection coverage.

### Phase B --- Event foundation

- Event Template identity/version, default-owner/Coordinator/Presenter and
  exact-version occurrence/session schema (implemented foundation);
- separate registration, participation and attendance records plus capacity
  constraints (implemented schema; operational workflows pending);
- blank Template creation with explicit default administrators, multi-session
  and region/assignment authoring, ordered learning activities, immutable
  publication and successor versions (implemented);
- multi-owner standard-admin Event responsibility plus multi-Coordinator regional
  and Presenter assignments, including revocation/replacement workflows;
- registration selection and attendance-taking workflows.
- explicit published-occurrence rescheduling with retained schedules,
  keep/replace/reopen window policy, responsibility snapshots and new review
  rounds after a lock (implemented);
- reschedule-time region addition, Coordinator reassignment and regional
  retirement with affected-registration preview, future-only preservation or
  active-registration cancellation and confirmed-capacity release (implemented).

### Phase C --- Blended event learning

- ordered, titled Event Sections (implemented);
- reusable SCORM/survey/resource activities (implemented);
- evidence-derived, region-scoped Coordinator progress views and Event Section
  progress CSV (implemented);
- event completion (implemented);
- certificates (implemented).

### Phase D --- Enterprise access

- explicit entitlement semantics;
- enterprise contracts;
- multi-course coverage;
- organisation utilisation reporting;
- Access Owner invitation and narrow customer dashboard;
- capped-grant capacity-extension checkout and webhook fulfilment;

### Phase E --- Communications and support

- Email Designer with Offering/System catalogues and immutable versions;
- polymorphic administration Section items for Automated Emails without learning
  progress semantics;
- Event/Course Template communication plans, occurrence snapshots and local
  assigned-administrator overrides;
- notification domain, durable schedules, exact delivery snapshots and
  event/access reminders;
- support read models;
- carefully audited impersonation if still needed.

### Phase F --- Visual analytics

- authorized semantic aggregate queries and drill-down;
- responsive accessible charts/tables with selectable filters;
- exact date, completion, version/instance and region-snapshot semantics;
- filtered/all-authorized versioned CSV datasets and full Course/Event export
  bundles;
- route-level chart-library splitting and bundle gates.

### Phase G --- Scale-driven evolution

- reporting projections;
- worker/web separation;
- messaging fan-out;
- connection proxying;
- learning programs/journeys;
- richer content workflow.

Only enter this phase in response to demonstrated product or operational
pressure.

## What Not to Do

Do not rewrite around another web framework simply because the product
is growing.

Do not replace Kysely/PostgreSQL with an ORM/database that weakens
explicit transactional control.

Do not split the system into microservices prematurely.

Do not add Kafka/RabbitMQ merely to make the architecture look more
event-driven.

Do not build a generic workflow engine before events/courses share
stable activity semantics.

Do not duplicate SCORM, survey, resource, progress, or certificate
systems inside the Events domain.

Do not encode every user responsibility combination as a role.

## Architecture Scorecard

### Domain modelling --- Strong

Immutable versions, exact enrolments, explicit access, audit, and
event-ready activity concepts provide a strong base.

### Transactional correctness --- Strong

Stripe fulfilment, capacity locking, audit coupling, and outbox design
are mature patterns.

### Security boundaries --- Strong with hardening items

SCORM isolation, encrypted recoverable access codes and server-only boundaries
are strong. Distributed auth abuse protection still deserves production
hardening.

### Operational maturity --- Growing

Infrastructure is thoughtfully designed, but deployment verification and
observability need to reach the same maturity as the domain code.

### Product completeness --- Growing

Self-paced learning is comparatively mature. Events, enterprise blanket
access, notifications, and scoped staff workflows are the major missing
product layers.

### Maintainability --- Strong

The modular monolith and verification gates are appropriate. The main
risk is rapid domain expansion without keeping the architecture handbook
and invariants current.

## Final Recommendation

Continue building on the existing architecture.

The repo does not need a new foundational stack. It needs the next
product layer: first-class events, explicit enterprise access, hybrid
scoped authorisation, notifications, and operational maturity.

The most important design discipline is to keep the existing boundaries
intact while those features are added:

```text
Commerce -> Entitlement -> Learning
Events -> compose Learning Activities
Capabilities + Scope -> Authorisation
Domain transaction -> Outbox -> Async work
Evidence -> Completion -> Certificate
```

If those relationships remain clear, Upskill can grow substantially
without losing the transactional correctness and historical accuracy
already present in the repository.
