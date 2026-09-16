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

The major product-domain expansion into Events, enterprise entitlements,
scoped staff roles and governed communications is now implemented. The next
high-value work is **product insight and measured operational maturity**:
visual analytics/export datasets, privacy/retention operations, selected Event
recovery improvements and richer domain telemetry. Offline SCORM and automatic
attendance remain explicit decisions. Offline SCORM is now an accepted,
bounded delivery program; the application-shell foundation is its first slice.

Overall architectural maturity is high for the current product stage.
The highest-value work is to preserve existing invariants, keep executable and
documented state aligned, and deliver the remaining gaps as bounded slices.

## Product Lens

Upskill serves individual healthcare professionals, healthcare organisations
and enterprise/government customers through self-paced learning,
instructor-led physical/virtual Events, individual and bulk purchases,
fixed-seat grants and broad workforce contracts. Events compose pre-work,
Surveys, resources, attendance and post-work through the same versioned learning
model.

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

| Capability                         | Current maturity                                                            | Direction                                                                |
| ---------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Public course catalogue            | Strong                                                                      | Continue incremental UX/product growth                                   |
| Individual course checkout         | Strong                                                                      | Preserve transaction and idempotency model                               |
| Learner enrolment/workspace        | Course and staged Event learning implemented                                | Continue incremental UX/support maturity                                 |
| SCORM delivery                     | Strong                                                                      | Preserve isolation and immutable versions                                |
| PWA/offline SCORM                  | Mobile installable public shell foundation in progress                      | Deliver staged mobile offline learning                                   |
| Surveys                            | Reused across Courses, Events, onboarding and registration questionnaires   | Add privacy operations where required                                    |
| Resources                          | Strong foundation                                                           | Broaden beyond PDF when required                                         |
| Certificates                       | On-demand rendering implemented                                             | Reuse the common completion-eligibility boundary                         |
| Organisation access codes          | Encrypted shared/single-use Course and Event grants                         | Preserve capacity, consent and recovery controls                         |
| Customer Access Owner portal       | Grant/contract utilisation, CSV, invoices and capacity extensions           | Add richer reporting only when required                                  |
| Enterprise blanket access          | First-class lifecycle, eligibility, Course/Event coverage and claims        | Add dynamic collections/SSO only on demonstrated demand                  |
| Course administration              | Strong foundation                                                           | Add authoring workflow maturity as needed                                |
| Learner administration             | Course and Event support evidence views implemented                         | Add broader cross-domain support timelines as justified                  |
| Events                             | Public commerce, authoring, registration, learning and lifecycle operations | Add measured recovery/reporting refinements                              |
| Coordinator workflows              | Region-scoped review, progress, selection and Survey QR operations          | Add alerts only where delivery practice requires them                    |
| Presenter workflows                | Attendance/QR plus LiveKit green-room, media, admission and recording       | Add printable/minimal export if required                                 |
| Attendance                         | Durable evidence, corrections, review filters and audited CSV exports       | Add offline/minimal presenter export only if required                    |
| LiveKit webinars and recording     | Controlled admission, automatic attendance, admin-only recordings           | Complete recovery drills and production guardrails                       |
| Authenticated user onboarding      | Versioned Survey-backed flow, contact verification and gating               | Add privacy/retention and optional bulk campaign operations              |
| Open-entry guest check-in          | Guarded Event and LiveKit lobby workflow implemented                        | Add support controls only where required                                 |
| Passwordless prerequisite recovery | Email/SMS OTP and exact-Survey task sessions implemented                    | Add scoped facilitated Survey fallback                                   |
| Staged Event release               | Implemented with open-entry semantics and notifications                     | Preserve server-owned release decisions                                  |
| Regional Event selection           | Review, deadline locks and late invitations implemented                     | Add broader recovery controls only when operational need is demonstrated |
| Automated email/notifications      | Governed design, schedules, suppression and audited delivery operations     | Add retention controls and justified message types                       |
| Reporting/visual analytics         | Basic read boundaries                                                       | Add filtered charts/tables; project only when justified                  |
| Global support/impersonation       | Future possibility                                                          | Add carefully with audit safeguards                                      |
| Operational observability          | Release/readiness, EC2/RDS, outbox/SQS/DLQ and delivery alarms implemented  | Add HTTP, SCORM and certificate telemetry                                |

## Priority 0/1 --- Production Reliability

### Deployment success verification --- delivered

The workflow creates and independently verifies one immutable checksummed
artifact, resolves exactly one tagged environment instance, captures and waits
for the SSM invocation, and fails unless installation succeeds. The installer
runs migrations before activation, switches the release symlink atomically,
checks the worker and the database-backed readiness endpoint against the commit
SHA, and restores the previous symlink on failed activation.

### Distributed authentication rate limiting --- delivered foundation

Better Auth stores its rate-limit counters in PostgreSQL, so restart or future
horizontal scaling does not reset or split the application-level counters.
AWS WAF remains a later coarse edge control if public traffic or attack volume
justifies its recurring cost.

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

Notification delivery now has a privileged database-health workspace for
pending/failed/stale/uncertain delivery, overdue schedules and due outbox work.
Staging and production alarm to an operations-owned SNS/email destination for
EC2 and RDS pressure, sustained SQS age/backlog, non-empty DLQ, worker heartbeat,
outbox age and uncertain deliveries. Continue with HTTP, certificate-render and
SCORM domain metrics.

**Benefit:** failures are discovered by the platform before users report
them.

## Delivered Foundation --- First-Class Events

Events are a current core product delivery mode. The implemented domain
includes:

- stable Event Template identity, immutable versions and exact-version Event
  Instances;
- one or more versioned default standard administrators and default Coordinators
  per configured region plus default Presenters per presenter-required scope,
  automatically snapshotted into new instances;
- retained staff eligibility and assignment history, with Coordinator
  eligibility revocation currently closing matching active Coordinator
  assignments;
- scheduled occurrences;
- in-person/virtual delivery;
- sessions/days;
- capacity and registration windows;
- occurrence-level open entry, required unrestricted registration or required
  verified-domain-restricted registration, independent of delivery mode;
- guarded open-entry guest links that collect point-in-time name/email, create
  or reuse a provisional not-onboarded user without Registration/authentication,
  and distinguish check-in from attendance;
- exact-prerequisite QR recovery using password/email OTP/SMS OTP with
  shared-device exact-Survey task sessions;
- an Event Occurrence-owned QR catalogue for every contained Survey item and
  participant-free staff presentation (implemented occurrence scope; explicit
  Session binding remains target work);
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

Remaining work is deliberately narrower: facilitated Survey recovery,
printable/minimal attendance export, selected assignment alerts, complete
analytics datasets and any explicitly approved connection-derived attendance
policy.

**Benefit:** enables Upskill's instructor-led business model without
creating a second LMS.

## Delivered Foundation --- Hybrid Authorisation

Global capabilities, ownership-based learner access and resource-scoped Event
and Access Owner assignments are implemented.

Do not replace product personas; use them as understandable capability
bundles. Do not create combined roles for every possible responsibility
combination.

Preserve focused operating modes for Learning, Administration, Coordinator and
Presenter as their operational surfaces mature.

**Benefit:** users can hold overlapping responsibilities without
over-permissioning or confusing UI.

## Implemented foundation / Priority 1 --- Entitlements and Enterprise Contracts

The existing `access_grant` model works well for course-specific
capacity codes but should not absorb every future commercial model.

Course access now follows explicit entitlement semantics:

```text
commercial source -> entitlement -> enrolment -> learning
```

The first-class enterprise agreement model now covers organisation, effective
periods, immutable Course and exact Event Occurrence coverage, verified-domain
or uploaded-employee eligibility, blanket access claims, lazy or optional
automatic exact-version entitlements, lifecycle, renewal, code rotation,
contract Access Owners, audited utilisation exports and durable audit history.

Bulk/enterprise grant creation adds email-bound Access Owner assignments, uses
provisional account setup where needed, and provides a narrow consent-filtered
assigned-source dashboard with CSV export. Course-version quantity tiers,
initial shared/single-use bulk Checkout, replay-safe capacity extensions,
invoice/payment history and refund-safe code preservation are implemented.
The blanket-contract vertical and its customer operations are implemented.
SSO-backed eligibility remains deliberately deferred; uploaded employee lists
provide exact-email eligibility without provisioning accounts.
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

Events reuse the common activity/version model for SCORM, Surveys and resources,
while Attendance remains distinct occurrence/session evidence. Future activity
kinds should add a typed child-content/evidence contract rather than another set
of polymorphic Course/Event columns.

**Benefit:** future learning types can be added without rewriting
course/event progress.

## Delivered Foundation --- Notifications

Events and enterprise learning make communications a core current capability.

The notification capability reacts to committed domain events rather than
embedding email sends in transactions. Its governed Email Designer provides
immutable Offering/System Email versions, typed variables, preview, publication
and rollback. System administrators may revise content without changing
code-owned trigger, recipient or security behavior.

Event/Course authors insert compatible Automated Email Items among the
administration view of Section items. Each item uses an explicit trigger/timing
and audience; it is not a Learning Activity and cannot affect completion.
Publishing pins exact email versions. Event Occurrences snapshot a Communication
Plan whose assigned standard Platform Administrators can override locally for
eligible unsent messages only.

Implemented use cases:

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

The transactional outbox provides reliable hand-off and idempotent notification
delivery.

**Benefit:** communications become reliable, reusable, and decoupled
from core domain transactions.

## Delivered Foundation / Priority 2 --- Support Tooling

Strong administrator inspection views cover common support scenarios:

- enrolment/access state;
- SCORM attempts;
- survey/resource completion;
- event registration;
- attendance;
- completion and current certificate eligibility; and
- relevant audit history.

Add impersonation only if remaining cases genuinely require reproduction of the
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

Preserve focused operating-mode navigation as Coordinator and Presenter
experiences continue to mature.

### Long-term user locale preferences

**Future possibility:** add an explicit locale preference to each user account.
That preference should control presentation only, including date order,
date/time wording, number formatting and currency display. It must not change
the stored ISO date/time values, Event Instance IANA timezone, currency code or
minor-unit monetary amount.

Until user locale preferences exist, administrative date/time entry uses the
Australian `DD/MM/YYYY HH:mm` display and monetary values use the product's
current Australian-dollar presentation. Event schedules continue to store a
timezone-free local ISO date/time together with the selected IANA timezone so
daylight-saving conversion remains deterministic.

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

### Phase A --- Production hardening (delivered foundation)

- deployment verification;
- distributed rate limiting;
- operational metrics/alerts;
- release/readiness visibility;
- failure-injection coverage.

### Phase B --- Event foundation (delivered)

- Event Template identity/version, default-owner/Coordinator/Presenter and
  exact-version occurrence/session schema (implemented foundation);
- separate registration, participation and attendance records plus capacity
  constraints and operational workflows (implemented);
- blank Template creation with explicit default administrators, multi-session
  and region/assignment authoring, ordered learning activities, immutable
  publication and successor versions (implemented);
- multi-owner standard-admin Event responsibility plus multi-Coordinator
  regional and Presenter assignment foundations (implemented; staff
  revocation/replacement automation remains in the Phase B follow-on);
- registration selection and attendance-taking workflows (implemented);
- explicit published-occurrence rescheduling with retained schedules,
  keep/replace/reopen window policy, responsibility snapshots and new review
  rounds after a lock (implemented);
- reschedule-time region addition, Coordinator reassignment and regional
  retirement with affected-registration preview, future-only preservation or
  active-registration cancellation and confirmed-capacity release (implemented).

### Phase B follow-on --- Staff lifecycle resilience (pending)

- Platform Administrator revocation impact handling for Event ownership and
  current Template defaults;
- Coordinator sole-coverage repair, replacement/attention notifications and
  successor Template automation after eligibility loss; and
- Presenter active-assignment revocation, coverage repair,
  replacement/attention notifications and successor Template automation.

### Phase C --- Blended event learning (delivered)

- ordered, titled Event Sections (implemented);
- reusable SCORM/survey/resource activities (implemented);
- evidence-derived, region-scoped Coordinator progress views and Event Section
  progress CSV (implemented);
- persisted exact-Survey QR references, scoped staff catalogue/presentation and
  authenticated selected-participant resolution (implemented);
- event completion (implemented);
- certificates (implemented).

### Phase D --- Enterprise access (delivered)

- explicit course entitlement semantics (implemented);
- enterprise contracts (implemented);
- multi-course and exact Event Occurrence coverage (implemented);
- organisation utilisation reporting (implemented for assigned grants and
  contracts);
- Access Owner assignment and narrow customer dashboard (implemented for grants
  and contracts);
- capped-grant capacity-extension checkout and webhook fulfilment (implemented);

### Phase E --- Communications and support (delivered foundation)

- Email Designer with Offering/System catalogues and immutable versions
  (implemented foundation);
- polymorphic administration Section items for Automated Emails without learning
  progress semantics (implemented);
- Event/Course Template communication plans, occurrence snapshots and local
  assigned-administrator overrides (implemented authoring/versioning foundation);
- notification domain, exact delivery snapshots, all authorable Course/Event
  trigger execution, durable occurrence schedules and delivery-time suppression
  (implemented);
- cancellation, reschedule, final waitlist/not-selected/cancelled outcomes,
  incomplete pre-work and post-event requirement reminders, regional
  review/lock notices, and expiring late invitations (implemented);
- support read models (implemented for onboarding, Course enrolment/progress,
  Event registration/region snapshots, attendance, completion and audit
  history);
- carefully audited impersonation if still needed.

### Delivered cross-cutting phase --- LiveKit virtual delivery

- versioned provider policy and room lifecycle;
- presenter green room, media and moderation;
- attendee lobby, controlled admission and recovery;
- managed recording, signed receipt reconciliation, private playback/download
  and retention;
- open-entry virtual participation; and
- durable attendee connection evidence in the staff roster.

Automatic Attendance from provider connection evidence remains a separate
conditional product decision. Production hardening tasks remain operationally
triggered and do not reopen the delivered webinar foundation.

### Cross-cutting delivery --- PWA and offline SCORM (in progress)

- mobile-only installable application shell and static public offline fallback
  (first slice);
- dormant server entitlement/reconciliation model and central writer policy;
- trusted local runtime and isolated exact-attempt package prototype;
- one complete Course path before Event reuse and support operations; and
- browser qualification, operational controls and deliberate activation.

The [offline SCORM delivery plan](offline-scorm-delivery-plan.md) owns the impact
matrix and reviewable slice boundaries. No current interface may imply that
course downloads, offline progress or server-confirmed completion exist before
their complete slice is activated.

### Phase F --- Visual analytics (next product slice)

- authorized semantic aggregate queries and drill-down;
- responsive accessible charts/tables with selectable filters;
- exact date, completion, version/instance and region-snapshot semantics;
- filtered/all-authorized versioned CSV datasets and full Course/Event export
  bundles;
- route-level chart-library splitting and bundle gates.

### Phase G --- Scale-driven evolution (trigger-based)

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

SCORM isolation, encrypted recoverable access codes, server-only boundaries,
shared authentication rate limiting and separate least-privilege runtime
database identities are strong. WAF may later supplement application controls
when traffic justifies it.

### Operational maturity --- Growing

The low-cost single-host topology now has verified immutable deployment,
readiness/release identity, rollback and baseline operational alarms. Richer
HTTP and domain telemetry remains incremental work.

### Product completeness --- Broad foundation delivered

Self-paced learning, Events, enterprise blanket access, notifications and scoped
staff workflows are implemented. Visual analytics, privacy/retention operations
and measured Event/support refinements remain the main product gaps.

### Maintainability --- Strong

The modular monolith and verification gates are appropriate. The main
risk is rapid domain expansion without keeping the architecture handbook
and invariants current.

## Final Recommendation

Continue building on the existing architecture.

The repo does not need a new foundational stack or another broad product-domain
layer. It needs focused insight and operational slices that build on the
implemented Event, enterprise, authorisation and notification boundaries.

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
