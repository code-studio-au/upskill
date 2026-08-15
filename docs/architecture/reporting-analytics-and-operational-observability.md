# Reporting, Analytics, and Operational Observability

**Status:** Living architecture document\
**Scope:** Product reporting, dashboards, projections, operational
metrics, alerts, audit boundaries, and analytics evolution

## Purpose

This document separates three concerns: business/product reporting,
operational observability, and durable audit evidence.

> **Reporting explains the business. Observability explains the running
> system. Audit explains accountable change.**

A course completion dashboard is reporting; certificate-render latency is
observability; an administrator completion override is audit evidence.

## Architecture Horizons

- **Current Product:** PostgreSQL read boundaries, structured JSON logs, durable
  audit evidence, health endpoint, domain verifiers, basic administrator and
  learner views, and an evidence-derived Event participant/Section progress
  matrix with region-scoped filtered/all-authorized CSV export.
- **Target Product:** production metrics/alerts, deployment identity/readiness,
  queue/outbox/DLQ visibility, purpose-built event/enterprise/support read
  models and responsive visual learning analytics with validated selectable
  filters plus complete filtered/unfiltered CSV export within authorization
  scope.
- **Future Possibilities:** rebuildable projections, product analytics and a
  warehouse only when transactional reporting demonstrates real pressure.

## Current Direction

Upskill already has PostgreSQL as authoritative domain storage,
structured logging, durable audit events, a transactional outbox, SQS
workers, health infrastructure, domain verification scripts, and
immutable learning evidence. Mature these incrementally rather than
introducing a warehouse or complex analytics stack prematurely.

## Reporting Principles

Source-of-truth records remain in their owning domains. Start with
purpose-built PostgreSQL read models. Introduce event-fed projections
only when aggregate queries become expensive or operationally
disruptive. Projections are eventually consistent and must never make
transactional capacity, access, or security decisions.

## Learner Reporting

Learner-facing views should cover the learner's own active enrolments,
progress, completed learning, certificates, upcoming events, outstanding
pre/post-event requirements, and learning history. These are
ownership-scoped and should not expose unnecessary commercial/admin
detail.

## Administrator Reporting

Useful platform views include enrolments and completion by offering/version,
active/expired/removed enrolments, access-grant utilisation,
enterprise-contract utilisation, Event registration/attendance, certificate
eligibility/downloads, and commercial fulfilment exceptions. Reporting
permissions should be explicit.

## Visual Learning Analytics Workspace

The target administration experience includes interactive charts rather than
only tabular lists or exports. A shared filter bar drives KPI cards, trends,
stacked complete/incomplete comparisons, regional distributions and Event funnel
charts, with an accessible detail table representing the same authorized query.

Supported filter dimensions include:

- offering class: Courses, Events or both;
- Event type/delivery mode and registration mode;
- stable Course or Event Template;
- exact Course Version or Event Instance;
- an explicitly labelled date basis and range, such as enrolment date,
  registration date, Event/Session date or completion date;
- learner outcome: completed, incomplete, not started, in progress, overridden
  and, for Events, not-yet-fully-available/up-to-date;
- exact Section/phase and derived Section state, including complete, incomplete,
  locked/not-yet-due and in progress;
- one or more hierarchical Coordination Regions; and
- other authorized dimensions such as organisation, access source or attendance
  state when the view requires them.

Filters are composable, URL/search-param backed, schema validated and rendered as
clear removable active-filter controls. Dependent options narrow coherently: an
Event Template limits its Event Instance choices, while a Course limits its
Course Version choices. Empty and zero-denominator states remain explicit rather
than displaying misleading percentages.

### Date and completion semantics

"Between dates" is never an unlabeled generic constraint. The request carries
the selected date dimension, inclusive/exclusive boundary policy and reporting
timezone. A chart for Events occurring in August and a chart for completions
recorded in August are different queries and must have different labels.

Completion is evidence-derived for the exact Course Version or Event Instance.
Event charts must not collapse a participant who has completed all currently
available work but has locked future requirements into ordinary overdue
incomplete. Every chart exposes its denominator and effective as-of time so a
percentage remains explainable.

Section analytics derives status from the required Learning Activity Items in
that exact Course/Event Section. A Section is complete only when those activities
satisfy their individual completion rules; incomplete/in-progress reflects their
current evidence. Optional items follow configured requirement semantics, and
administration-only Automated Email Items never contribute. Event Section
release state remains a separate dimension, so locked/not-yet-due is not counted
as overdue incomplete. Labels such as **Pre-eLearning Tasks**, **Pre-Event
Tasks** and **Post-Event Tasks** remain ordinary versioned Section titles.

### Region semantics

Region filters offer an explicit basis:

- **Current user region** answers current operational workforce/location
  questions; and
- **Participation-time region** answers historical cohort questions from an
  immutable Event Registration Region Snapshot or target Course Enrolment Region
  Snapshot.

The selected basis is shown in the chart title/summary. A learner moving region
therefore changes current-region analytics but not historical participation-time
charts. Region hierarchy supports appropriate aggregation such as country,
state/territory, LHD/district or customer-defined areas without hard-coding NSW
LHD semantics.

### Interaction, accessibility and delivery

Charts support hover/focus values, legends, accessible colour contrast and
patterns/labels that do not rely on colour alone. Each chart has a table view;
authorized users can drill into the bounded matching learner/participation list
without receiving fields outside their role. Filter controls and chart layouts
are mobile responsive.

The analytics route and chart renderer are lazy loaded so charting dependencies
do not inflate catalogue, authentication or learner bundles. They remain subject
to the existing deterministic route/chunk budgets and strict CSP; implementation
must not solve charting by adding unsafe inline script/style behavior.

### Query and projection model

Initial charts use named, server-authorized PostgreSQL aggregate/read-model
queries with typed filter contracts. Counts, rates and drill-down use one shared
semantic query definition so the chart cannot disagree with its table. Add
indexes from measured query plans. Introduce rebuildable event-fed projections
only when actual query cost or concurrency justifies them; a warehouse is not a
prerequisite for visual analytics.

## CSV Export

Every exportable analytics/reporting dataset supports two clear actions:

- **Export filtered CSV** exports every authorized detail row matching the exact
  active filter contract; and
- **Export all authorized CSV** ignores optional analytics filters and exports
  every row in that selected dataset that the current user is authorized to
  access.

"All" bypasses UI pagination, not authorization, field minimisation, retention or
dataset boundaries. A regional Coordinator's unfiltered export still contains
only assigned occurrence/regions; an Access Owner still receives only learners
from assigned access sources. A Platform Administrator can export the full
authorized platform dataset for that export type. The UI shows the dataset,
scope, active/ignored filters and estimated/known row count, and requires explicit
confirmation for broad unfiltered exports.

Do not create one ambiguous denormalized CSV combining unrelated domain records.
Provide versioned, documented export datasets such as:

- Course enrolment summary;
- Course Section/activity progress;
- Event registration/final-decision summary;
- Event participation/completion summary;
- Event Section/activity progress;
- Session Attendance;
- regional review status; and
- access-grant/contract utilisation.

The **Course enrolment summary** has one row per learner enrolment and includes
the stable Course, exact Course Version, learner identity/contact fields allowed
for the requester, enrolment/access source and dates, current enrolment state,
overall progress projection, completed/incomplete state, completion timestamp
and authorized override indicator. The **Course Section progress** dataset has
one row per enrolment and exact Section, including order/title, availability,
required-item counts, completed-item counts, progress and Section completion
timestamp/state. The state is rolled up from contained required Learning Activity
evidence rather than a separate mutable Section flag. Optional activity detail
uses one row per exact Section Item and does not include Survey answers or
Automated Email Items.

The **Event participation summary** has one row per learner and exact Event
Instance, including Event Template/Version, registration/final-decision state,
Registration Region Snapshot, participation mode, relevant Session Attendance
summary, overall available-work progress, up-to-date/final completion state and
completion timestamp. The **Event Section progress** dataset has one row per
participant and exact Event Section, including phase, release/availability,
progress, required/completed activity counts, completed/incomplete/locked state
and completion timestamp. Its completion is likewise rolled up from the exact
contained required Learning Activities; lock state is reported separately.
Session Attendance and activity-level progress remain normalized datasets so
multi-day Events do not create ambiguous duplicated totals.

The UI may offer a **Full Course learning** or **Full Event learning** export
bundle containing the applicable versioned CSV datasets plus a machine-readable
manifest. This preserves complete enrolment, progress, Section, activity and
Attendance detail without flattening one-to-many relationships into a misleading
mega-CSV. Filtered bundles apply the same filter contract to every file;
unfiltered bundles include all authorized rows in each included dataset.

Where useful, offer both an aggregate chart-summary CSV and a detailed-row CSV;
**full export** refers to the detailed dataset. Each schema has stable column
names/versioning, explicit identifiers plus readable labels, ISO 8601 timestamps,
timezone/region-basis semantics and empty-value rules. The export audit record
retains dataset/schema version, normalized filters, authorization scope, as-of
time, requester, row count, output digest and lifecycle state so the result is
explainable later.

### Export execution and download

Small exports may stream from a server-authorized query. Large/full exports use
a durable asynchronous job: commit export intent, stream/query without loading
all rows into memory, write a private object to S3/MinIO, then expose a short-lived
authenticated exact-object download. Files expire under an explicit retention
policy and can be regenerated; object keys/URLs never become authorization.
Generation is idempotent/retryable and produces operational status/failure
visibility. An optional automatic email can announce readiness using a safe
authenticated application link rather than attaching sensitive data.

CSV output follows a documented UTF-8/RFC 4180-compatible dialect and neutralizes
spreadsheet formula injection for cells beginning with dangerous formula
characters. It correctly quotes commas, quotes and newlines; prevents CRLF/header
injection; and avoids secrets, access codes, sensitive Survey answers, onboarding
demographics or internal notes unless a separately authorized export explicitly
requires them.

## Organisation Reporting

Organisation views may include purchased/redeemed capacity, active
learners, covered enrolments, completion, covered event participation,
contract utilisation, and renewal/expiry. Purchasing seats does not
automatically grant access to sensitive survey answers or unrelated
learner history.

## Event Reporting

Regional Coordinators need operational read models such as registrations in
their occurrence/region, pending review, approved/not-approved decisions,
optional priority scores, regional lock state/deadline, incomplete pre-work,
attendance by session, post-event requirements and completion. A participant
matrix should combine authoritative registration, learning, and attendance
evidence rather than creating a second progress store.

Assigned Event Instance administrators need a cross-region selection view
showing each region's lock status, approved ranked/unranked candidates, missing
reviews, submission timing, late-candidate queue, total capacity and
final-decision counts. Reports must preserve the Registration Region Snapshot
and decision provenance rather than grouping historical decisions by the user's
current profile region.

Operational views also show active assigned-administrator coverage, one-or-more
Coordinator coverage per region and one-or-more Presenter coverage per
presenter-required occurrence/Session. They include revoked/ended historical
assignments, replacement state and `administrator_attention_required`,
`coordinator_attention_required` or `presenter_attention_required` alerts.
Template-default health is reported separately from current instance assignments
so a fixed instance cannot conceal a Template that would strand future creation.

Event reporting should distinguish submitted, Coordinator-approved,
regional-list-locked, administrator-selected/waitlisted/not-selected and
finally confirmed Registrations. Learner/support views distinguish
locked, available, in-progress and completed Sections and show the effective
release anchor/time. "Up to date" means all currently available requirements are
complete; it must not falsely claim overall Event completion while required
Post-Event or Follow-up stages remain locked.

## Commerce and Entitlement Reporting

Commerce reports may include order state, paid/refunded amounts, product
revenue, quantities, fulfilment exceptions, and organisation purchases.
Entitlement reports may include grant capacity/redemption,
active/revoked/expired grants, enterprise issuance, and utilisation.
Never expose access codes, encrypted code values, public lookup IDs or key material
in generic reporting.

## Learning and Survey Reporting

Learning reporting should be evidence-derived: activity state,
Section completion, Course/Event completion, current certificate eligibility, and
authorised overrides. Treat percentages as projections. Survey
completion may appear in learning reports, but survey response content
requires a separate privacy/product decision.

## Read Models and Projections

Prefer named server read models such as `getOrganisationUtilisation` or
`getEventCoordinatorParticipantMatrix` so authorisation, field
minimisation, and query tuning are centralised. When direct queries stop
scaling, consume committed domain events into rebuildable, idempotent
reporting projections.

## Operational Observability Goals

Operations should quickly answer: Is the app serving traffic? Is it the
intended release? Can it reach required dependencies? Are asynchronous
jobs flowing? Is work stuck? Are users seeing elevated errors? Is
PostgreSQL under pressure? Are Stripe or other integrations failing?

## Liveness, Readiness, and Release Identity

Liveness answers whether the process is alive; keep it cheap. Readiness
answers whether an instance can serve normal traffic and may check
essential dependencies/configuration. Expose a safe build SHA/release
identifier so multi-instance deployment success can be verified.

## HTTP and Database Metrics

Monitor request volume/latency, 4xx/5xx, ALB unhealthy targets, and
route-level failures where useful. For PostgreSQL monitor connections
versus budget, CPU, storage, I/O latency, long queries, deadlocks, and
transaction failures. Model the connection budget across web pools,
workers, migrations, and headroom.

## Outbox, Queue, and Worker Metrics

Monitor outbox unprocessed count, oldest age, dispatch latency, retries,
high-attempt rows, and dispatcher heartbeat. Monitor SQS visible
messages, oldest age, redelivery, processing duration/failure by topic,
visibility extensions, worker heartbeat, and DLQ depth/age. Age is often
more actionable than raw count.

## SCORM, Certificate Downloads, Stripe, and Notifications

SCORM metrics should cover ingestion state/duration, rejection/failure,
deletion, launch and progress errors. Certificate metrics may cover authorised
render attempts, latency and failures; there is no certificate backlog. Stripe
metrics should cover webhook/fulfilment failures and
payment-to-fulfilment latency. Notifications should later track backlog,
send latency, provider failures, retries, terminal failures, and
duplicate suppression. Track Email Design publish/rollback outcomes, scheduled
versus sent counts by automation item/revision, suppressed/superseded sends,
occurrence override adoption and exact-version attribution without placing
rendered subjects/bodies or variables in metrics.

Assigned Event Instance administrators need bounded per-occurrence communication status:
inherited/overridden item, audience/trigger summary, pending/sent/failed counts
and actionable terminal failures. Platform communication administrators need
System/Offering Email version and delivery health views. Access to a recipient's
exact rendered delivery snapshot is a separate privacy-scoped support read, not
ordinary analytics.

## Deployment Observability

Record intended release SHA, target instances, SSM result per target,
service restart result, readiness, ALB health, and actual running
release identity. A deployment workflow should fail when it cannot prove
all intended targets are healthy on the intended release.

## Product-Aware Operations Dashboard

A small privileged operations view can show release, healthy targets,
outbox age, queue age, DLQ, SCORM jobs, certificate-render failures,
notification backlog, database connections, and worker heartbeat. It
complements CloudWatch/Datadog rather than replacing them.

## Alerting

Alert on actionable conditions: insufficient healthy targets, sustained
5xx, queue/outbox age above service thresholds, non-empty DLQ,
repeated certificate-render failures, RDS connection pressure, sustained Stripe
fulfilment failures, or mixed release identities. Avoid paging on
ordinary transient retries.

## Logging and Audit Boundary

Structured logs should carry useful IDs such as request, event,
aggregate, topic, and release SHA while excluding secrets, access codes,
sensitive survey answers, raw payment data, and unnecessary PII. Audit
remains durable PostgreSQL evidence of accountable business/security
change and may be projected to observability after commit.

## Product Analytics

Product analytics may later answer catalogue conversion, learner
drop-off, activity usage, and event funnel behaviour. It must have
explicit privacy/data-minimisation rules and never replace learning
evidence or commercial truth. Client analytics can complement reliable
server-side domain events but is not authoritative.

## Warehouse Trigger

Consider a warehouse only when there is demonstrated need for complex
cross-domain historical analysis, large longitudinal datasets,
finance/product joins, BI self-service, or query workloads unsuitable
for the transactional database. Until then, direct read models and
projections are simpler.

## Security and Privacy

Reporting/observability can become accidental exfiltration surfaces.
Apply explicit authorisation, organisation/event scope, field
minimisation, bounded exports, safe logging, audited privileged exports
where appropriate, and retention appropriate to each data class.
Presenter, coordinator, organisation-admin, and platform-admin views
should not all receive the same learner object.

## Testing Strategy

Test organisation and event scope, Presenter field minimisation, learner
ownership, filter-combination/search-param validation, date-dimension/timezone
boundaries, current versus snapshotted region semantics, completion/as-of and
zero-denominator correctness, chart/table agreement, drill-down authorization,
accessible non-colour-only presentation, idempotent projection consumption,
filtered versus all-authorized export parity, pagination independence,
schema/version stability, CSV quoting/formula-injection safety, large-export
streaming/retry/expiry, private-download reauthorization, projection rebuild
consistency, readiness versus liveness behaviour, absence of sensitive
metric/log values, and deployment detection of failed or mixed target releases.

## Domain Invariants

1.  **Transactional domain records remain authoritative.**
2.  **Reporting projections never make capacity/access/security
    decisions.**
3.  **Audit, observability, reporting, and analytics remain distinct
    responsibilities.**
4.  **Scoped users receive only authorised rows and fields.**
5.  **Analytics never replaces authoritative learning evidence.**
6.  **Projection consumers are idempotent and eventually consistent.**
7.  **Stuck asynchronous work is operationally visible.**
8.  **Logs/metrics exclude secrets and unnecessary sensitive data.**
9.  **Deployment health includes actual release identity.**
10. **New analytics infrastructure requires demonstrated need.**
11. **Every visual metric exposes its filters, denominator, as-of time and date/
    region basis.**
12. **Chart and detail-table results share one authorized semantic query.**
13. **Heavy charting code remains route-split and within deterministic client
    budgets.**
14. **Filtered CSV and chart/table detail share one authorized semantic query;
    unfiltered export removes filters but never scope.**
15. **Full export means all authorized rows in one explicit versioned dataset,
    not a database dump or cross-domain mega-CSV.**
16. **Generated export objects are private, expiring and reauthorized at
    download.**

## Implementation Sequence

### Phase 1 --- Production observability

Add release identity, liveness/readiness separation, HTTP/ALB errors,
RDS health/connections, outbox/SQS/DLQ, SCORM worker and certificate-route
metrics, and actionable alerts.

### Phase 2 --- Product-aware operations

Add operations pulse, failed-job inspection/replay, and Stripe
fulfilment exception views.

### Phase 3 --- Business reporting

Add responsive visual learning analytics, validated filters, exact-version and
date/region semantics, accessible chart/table views, Event participant matrices,
organisation/contract utilisation, Event attendance reporting, and improved
Platform Administrator learning views. Add complete filtered/all-authorized CSV
exports with versioned schemas, safe streaming/asynchronous generation and
private expiring downloads.

### Phase 4 --- Projections

Add read-optimised event-fed projections only for dashboards proven
expensive or complex.

### Later

Introduce product analytics and/or a warehouse only with explicit
BI/privacy requirements.

## Design Checklist

For a new dashboard, report, metric, or alert ask: Is it reporting,
observability, audit, or analytics? Which domain owns the fact? Does it
require transactional consistency? Who may see each field? Can
PostgreSQL read models satisfy it? If projected, how is it
rebuilt/idempotent? What privacy/retention applies? What threshold
requires action? Does it expose sensitive data? Is new infrastructure
justified?

## Related Documents

Read this alongside the Domain Model, Transactional Outbox, Events
Domain, Organisations and Enterprise Contracts, Notifications, Roles and
Authorisation, and Product Architecture Review.

## Summary

Mature Upskill reporting and observability in layers: authoritative
PostgreSQL records for truth, purpose-built read models for current
dashboards, projections only when needed, and a warehouse only for
genuine analytical requirements. In parallel, production operations
should gain release identity, readiness, queue/outbox/DLQ metrics,
worker/database health, and actionable alerts.
