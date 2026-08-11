# Upskill Project Overview

**Status:** Living product and architecture overview\
**Audience:** Engineers, product contributors, administrators,
designers, contractors, and anyone onboarding to the repository

## Purpose

This document explains what Upskill is, who it serves, how the business
operates, the major user experiences the platform must support, and the
architectural principles that shape the implementation.

It is intentionally more product-oriented than `architecture.md`. A
contributor should be able to read this document first and understand
**why the system exists and what real-world workflows the code is
modelling**.

## Product Précis

Upskill is a professional education platform focused primarily on helping
healthcare professionals develop, refresh, and maintain skills in
eating-disorder care. The current product delivers self-paced e-learning and
direct course access. The target product expands that foundation into
instructor-led training and broad enterprise access without rewriting the
existing learning system.

Across those horizons, learning may include SCORM modules, surveys, reference
resources, face-to-face or virtual workshops, attendance requirements,
post-event activities, and completion certificates. Upskill serves both
individual healthcare professionals and large organisational customers.

The product vision is therefore not only an LMS and not only an e-commerce
site. It combines professional learning delivery, direct-to-consumer course
sales, organisation access, immutable learning records, certification and
reliable asynchronous processing today, with enterprise agreements,
instructor-led event operations and scoped staff workflows as accepted target
capabilities.

## Product Scope by Horizon

### Current Product

- Public course catalogue and individual course checkout.
- Exact-version enrolments created through purchase, access-code redemption or
  administrator action.
- Organisation-aware, capacity-limited access grants with optional domain
  eligibility, expiry and revocation.
- AES-256-GCM encrypted, individually recoverable human-readable access codes
  with indexed public lookup identifiers and audited administrator retrieval.
- Versioned SCORM, surveys and private PDF resources arranged in course
  sections.
- Evidence-derived progress, completion, administrator corrections and
  completion certificates.
- Platform administration, structured logging, durable audit evidence,
  transactional outbox records and SQS-backed work commands.
- A first-class Event relational foundation with immutable Template Versions,
  exact-version occurrences, sessions, regions, staff assignment history,
  registration, participation and attendance records. Platform Administrators
  can create a blank Template with explicit default administrators, author and
  publish multi-session versions, create successor versions, and schedule an occurrence; the
  broader Event operational and learner workflows remain target work.

### Target Product

- Instructor-led physical and virtual events, including occurrences, sessions,
  registration, capacity and attendance. Each delivery mode supports open entry
  with no registration, required unrestricted registration, or required
  registration limited to configured verified email domains.
- Configurable regional coordination, optional cross-region priority ranking,
  regional list lock deadlines and assigned standard-administrator final
  selection.
- Stable Event Templates with immutable versions, one or more versioned default
  Platform Administrators, one or more default Coordinators per configured
  region, one or more default Presenters per presenter-required scope and
  exact-version Event Instance creation.
- Pre-event and post-event learning composed from the existing activity model.
- Standard Platform Administrators recorded as shared Event Instance owners,
  plus regional Coordinator and Presenter assignments scoped to the resources
  they operate.
- Explicit source-neutral entitlements and blanket enterprise/government
  contracts.
- Access Owner assignments created with bulk grants/contracts, invitation-based
  account activation and a narrow allocation/utilisation dashboard.
- Email Designer-managed reusable/system messages, Section-embedded automated
  email plans, Event Occurrence overrides, event/enterprise notifications,
  operational views and reporting.
- Responsive visual analytics with selectable Course/Event, exact-version/
  instance, date-range, completion and current/historical region filters.
- Complete filtered or all-authorized Course/Event CSV exports covering
  enrolment/participation summaries, progress, Section completion, activity
  state and Event Attendance through explicit versioned datasets.

### Future Possibilities

- Open-entry Event variations with no formal registration record where product
  demand justifies them.
- Broader resource/activity formats, assessments and acknowledgements.
- Multi-offering learning programs or journeys.
- Promotions, subscriptions and additional commercial entitlement producers.
- Highly privileged support inspection or impersonation after dedicated support
  views.
- Scale-triggered infrastructure such as event fan-out, connection proxying,
  dedicated search or separate compute pools.

## Primary Audience

The main learner audience is healthcare professionals who need to
upskill or retrain in new and emerging eating-disorder skills.

Examples may include clinicians and other healthcare staff completing
professional-development education independently or through their
employer.

The platform must therefore prioritise:

- clear learner journeys;
- trustworthy completion records;
- accessible mobile-first experiences;
- reliable access to purchased/allocated learning;
- professional certificates; and
- supportability when learners encounter problems.

## Commercial Models

Upskill supports several access models that lead into the same learning
platform.

### Individual consumer purchase

An individual healthcare professional discovers a course, purchases it
directly, receives access, completes the learning, and may receive a
certificate.

Stripe handles payment processing. Upskill remains authoritative for
orders, fulfilment, access, enrolment, learning progress, and
certificates.

### Organisation bulk-seat purchase

A healthcare organisation may purchase a fixed number of learner places
in a course, for example 10, 20, or 100 seats.

Upskill provides an access code representing that grant/capacity. Staff
redeem the code to obtain individual access until the purchased capacity
is exhausted.

This allows the organisation to distribute access without Upskill
needing to pre-create every staff enrolment.

### Enterprise and government agreements

Large customers may purchase blanket contractual access for an eligible
workforce, commonly for a defined annual period.

For example, a government health entity may purchase access covering all
eligible staff and all covered Upskill courses. A shared code can
establish eligibility so staff receive 100% covered access without
individual payment.

The long-term architecture should model this as an enterprise
entitlement/contract rather than forcing blanket access into many
unrelated course-specific special cases.

## Learning Delivery Models

### Self-paced e-learning

A self-paced course may contain one or more sections and learning
activities.

Current activity types include:

- SCORM modules;
- surveys; and
- resources such as PDFs.

The resource concept should broaden over time to support other
professional-learning material such as slide decks, reference documents,
training manuals, and worksheets.

### Instructor-led events

The target product also delivers scheduled professional training, physically
and virtually. This workflow is product context for the Events target; it is not
implemented in the current repository.

A typical event may involve:

```text
Event discovery
  -> registration
  -> verified-domain eligibility check where configured
  -> regional Coordinator candidate approval and optional priority
  -> regional list lock
  -> assigned administrator cross-region selection / Registration locked in
  -> Event confirmation and dashboard link
  -> pre-event e-learning
  -> pre-event survey
  -> pre-event resources
  -> attend physical/virtual training
  -> attendance recorded
  -> post-event survey/resources
  -> completion
  -> certificate where applicable
```

Events may span one or multiple sessions/days.

Registered participants receive immediate Pre-Event access after final
administrator confirmation. Session Sections release on their configured Session day/time;
Post-Event work may open a configured number of hours before delivery ends; and
Follow-up Sections may open days, weeks or calendar months later. The server
enforces those release rules independently of notification workers.

For open entry, soft-account participation immediately opens Pre-Event work and
the currently joinable Session. Future Session, Post-Event and Follow-up stages
remain on the same schedule, so a late joiner can catch up during opening minutes
or breaks without prematurely opening future learning.

Participation/registration mode is independent of delivery mode. Any physical,
virtual Event may use open entry with no registration, require
unrestricted registration, or require registration restricted to one or more
configured verified email domains. This is also independent of capacity,
payment/entitlement and whether acceptance is automatic or manually reviewed.

For an exceptional learner who does not match a restricted Event's domains, an
authorised platform administrator may add that learner through an explicit,
audited restriction override. It applies only to that learner and occurrence;
it does not modify the Event allowlist or waive capacity and lifecycle rules.

Large occurrences may assign several Coordinators by configurable region, such
as country, state or NSW Health LHD. Registration snapshots the learner-confirmed
current region rather than following later profile changes. Each Coordinator
approves candidates only in their assigned occurrence/region and may add an
optional numeric priority. They lock their list manually or it auto-locks at the
separate Coordinator deadline. The assigned Event Instance Administrators then compare
all approved candidates across regions, considers priority descending and uses
accountable judgement for unranked candidates and remaining capacity.

Every region and Event Instance supports multiple responsible people for leave
cover. Disabling a standard administrator or ending a Coordinator assignment
removes access immediately without erasing their actions. Other assignees
continue; sole-owner gaps use standard-admin fallback and urgent reassignment.
Current Event Templates receive a new immutable version without the disabled
default, while prior versions and existing instance provenance remain unchanged.

Presenter-required occurrences/Sessions likewise support one or more active
Presenters. Disabling/revoking one preserves their historical delivery and
Attendance attribution, leaves co-Presenters operating, and triggers replacement
or administrator attention for a sole gap. A successor Template version removes
the disabled default Presenter without rewriting older instances.

After public registration closes, an assigned Event Instance Administrator may issue a specific,
expiring invitation that takes its recipient through setup/login and exposes the
Event on their dashboard. The resulting late Registration is administrator-owned
and does not reopen a locked regional list or bypass other eligibility/capacity
rules.

### Open-entry events

Some events may not require a formal registration/approval process.

These should reuse the same event, session, learning-activity, and
attendance concepts while using a lighter participation workflow. For a virtual
occurrence, Upskill normally supplies a high-entropy occurrence link instead of
the raw Zoom/Teams link. A visitor submits name and email on a
mobile-first event page before the protected Join action is revealed. This
creates or reuses a provisional user with `userOnboarded = false` and records
guest participation/check-in evidence, but it does not create a Registration,
verify the email or grant an authenticated session. The same shared boundary used
when an administrator adds a person by name/email idempotently creates the soft
account and queues one expiring "set up your account" email.

If progress, survey responses, attendance, or certificates must be
attributed to an individual, the platform still needs a stable
participant identity even when formal registration is omitted.

Open entry is not the same as registration required/unrestricted, which creates
an ordinary registration without an email-domain restriction.

Submitting guest details or accessing the Join action before the attendance
window does not mark attendance. An in-window self-check-in may either count as
attendance under explicit occurrence policy or remain pending staff
confirmation. Source/timestamp evidence survives corrections, and a later
verified account claim may link the guest record without rewriting the captured
event details.

### Authenticated user onboarding

New authenticated users complete the current versioned onboarding flow before
entering the learner dashboard. It may contain demographic,
professional-context and baseline self-rated-knowledge questions, with explicit
required/optional fields, privacy purpose and retention. The flow reuses an exact
immutable Survey Version for its questionnaire, Sections and instruction blocks,
but is not a Learning Activity and never contributes to learning progress.

An assignment pins the User to the exact Onboarding Definition/Survey Version
they started. Publishing revised questions applies to new/incomplete Users by
default; re-onboarding existing Users is a separate audited decision. Provisional
open-entry users skip onboarding when accessing the Join action. After they
verify/setup the account and authenticate, normal onboarding gates their learner
dashboard. Confirmed or policy-established Attendance already attached to the
stable user then appears in their Event history without manual matching. See
[User Onboarding](user-onboarding.md).

## Learning Content Model

Upskill should think in terms of **learning activities**, not only
SCORM.

A learning activity is a unit of educational work/evidence with its own
completion semantics.

Current activities:

```text
SCORM
Survey
Resource
```

Event learning introduces:

```text
Attendance
```

Future activities might include assessments, acknowledgements,
reflection exercises, videos, assignments, or external learning
requirements.

Courses and events compose these activities rather than creating
separate versions of each subsystem.

## Historical Accuracy

Professional education records must remain understandable after content
changes.

Upskill therefore separates stable content identities from immutable
published versions.

For reusable educational work, a **Learning Activity** is the stable identity
across revisions and a **Learning Activity Version** is the complete delivery
snapshot for one revision. That version encompasses whatever content the type
requires: for example SCORM launch metadata and object references, survey
structure and response rules, or resource metadata and immutable object
references. Large bytes can remain in object storage while the version owns the
exact key and integrity metadata.

An enrolment remains tied to the exact Course Version, whose items reference
exact Learning Activity Versions. Publishing a new course or activity version
does not silently change existing learner history.

The same structure applies to Events: an Event Template is stable, while an
immutable Event Template Version contains the exact Sections/items, workflow,
communication and default-staff configuration used to create future instances,
including default Coordinator coverage per configured region. An
Event Template Version also records default Presenter coverage for each
presenter-required scope. An Event Instance pins and snapshots one exact version. Later
Template versions do not change it; its operational owner assignments can be
managed locally without changing Template defaults.

The same principle applies to future attendance/activity types and event
learning-stage configurations wherever historical reconstruction matters.

## Core User Personas

### Learner

Learners discover/access education, complete activities, register for
events, track their own progress, and obtain certificates.

### Platform Administrator

Platform administrators manage the platform's educational and
operational configuration, including courses, SCORM, surveys, resources,
access grants, learner support, events, staff assignments, and
administrative reporting.

Event Instance administration uses this same standard role because it requires
ordinary account troubleshooting, user lookup/provisioning, invitations and
corrections. An instance records one or more Platform Administrators as shared
operational owners for responsibility and leave cover; that record is not a
separate role or authority grant.

Administration is a job function rather than an assumption that the
person is currently acting as every other persona.

### Access Owner

An Access Owner is the customer-side contact assigned to one or more specific
bulk access grants or enterprise contracts. The assignment is invited by email
when the grant/contract is created and becomes usable only after the person
authenticates as the verified invited identity.

Their narrow dashboard shows the assigned purchase/contract, its human-readable
access code where applicable, capacity used/remaining and only the learners
whose access came from that assigned source. Learner visibility is limited to
name, email, offering, bounded progress and complete/incomplete state; it does
not include survey answers or unrelated learning history.

For a capped grant explicitly configured as customer-extendable, the Access
Owner may purchase additional uses through a server-priced Stripe Checkout
flow. Blanket or 100%-covered contracts expose utilisation rather than a
capacity-purchase action.

### Event Coordinator

A Coordinator is assigned to an Event Occurrence and Coordination Region and
receives scoped operational access. Several Coordinators may collaborate on the
same regional list.

They may review registrations, provisionally approve/not approve applicants,
assign optional priority, lock their regional candidate list, view participant
contact details needed for coordination, monitor pre-event requirements, view
attendance, and monitor post-event completion.

A Coordinator's access is limited to assigned occurrences and regions, and ends
for selection purposes once the regional list is locked.

### Event Presenter

A presenter is assigned to deliver an event or session.

Their interface is intentionally narrow: assigned schedule/location,
attendance list, attendance marking, and an offline attendance list
where required.

### Global Support Administrator

A future highly privileged support capability may provide broad
troubleshooting access and audited impersonation.

This is a backstop for exceptional support, not the normal operating
mode for routine administration.

## Multiple Responsibilities

A person may hold multiple responsibilities simultaneously.

For example:

```text
Person A
  -> Platform Administrator
  -> Learner

Person B
  -> Platform Administrator
  -> Coordinator for Event X
  -> Presenter for Event Y

Person C
  -> Learner
  -> Access Owner for Grant Z
```

Upskill should not create combined roles such as
`admin_presenter_learner`.

Instead, global capabilities, ownership, and resource-scoped assignments
are combined at authorisation time.

The UI may expose focused operating modes such as My Learning,
Administration, Coordinator, and Presenter.

## Commerce and Entitlements

Upskill separates **why a person may learn** from **what they do while
learning**.

Commercial sources such as Stripe purchases, organisation seat grants,
government contracts, promotions, or future subscriptions should
ultimately produce or authorise an entitlement/access right.

Learning consumes that access without needing to understand the payment
mechanism.

Conceptually:

```text
Individual purchase -------+
Organisation seats --------+
Enterprise contract -------+--> Entitlement --> Enrolment --> Learning
Future promotion ----------+
Manual support access -----+
```

This boundary keeps future commercial models from contaminating the
learning implementation.

## Events as a First-Class Product Capability

Events should not be modelled as calendar metadata attached to courses.

An event is a scheduled learning experience with its own:

- occurrence/schedule;
- sessions;
- delivery mode;
- registration workflow;
- capacity;
- shared standard-admin ownership plus regional Coordinator/Presenter
  assignments;
- attendance;
- ordered, titled Sections containing pre-event, live-event and post-event
  Learning Activity Items plus administration-only Automated Email Items; and
- completion requirements.

Events reuse learning activities such as SCORM, surveys, and resources.
Automated Emails appear among them in authoring so the full journey is visible,
but use explicit notification triggers and never affect learner progress.

A separate Email Designer owns immutable reusable Offering and governed System
Email versions. Event Template publication pins exact versions. Each Event
Occurrence receives a Communication Plan that its assigned standard Platform
Administrators can preview and override locally for eligible unsent messages
without changing the template, other occurrences or historical deliveries. A
delivery retains the exact rendered message/version the recipient received.

## Progress and Completion

Upskill should prefer durable learning evidence over arbitrary mutable
percentages.

Examples of evidence include:

- SCORM attempt/completion state;
- survey responses;
- resource completion;
- attendance; and
- explicit administrator overrides.

Section, course, and event completion derive from configured
requirements and this evidence.

A progress percentage can be displayed to users, but it is a projection
rather than the source of truth.

## Certificates

Certificates are non-persisted outputs rendered from verified completion.

Completion occurs first. An authenticated request rechecks current eligibility
and renders a PDF from the exact learner, learning version and completion
timestamp. There is no certificate row, stored PDF or worker lifecycle.

Certificates should not be the mechanism that determines whether
learning is complete.

## Security Model

Better Auth owns identity and sessions. Upskill application data owns
business authorisation.

Learners may authenticate with password, email OTP or a code sent to a verified
mobile number. Event prerequisite QR links preserve an exact safe return target,
so successful authentication resumes the required activity. Borrowed/shared
devices use a short-lived OTP-verified event-task session rather than exposing
the full account. A final facilitated Survey fallback matches an accepted
Registration email before issuing one exact activity capability; it is not a
general login and eliminates later response matching.

Each Event Occurrence owns a persisted QR access catalogue for all exact Survey
items in its Sections, with optional Session scope for multi-session delivery.
Presenters can select and display pre-session, Session or post-session QR codes
full screen. The code contains only an opaque public reference; participant email
and complete occurrence/Session/item/Survey attribution are captured server-side
after scanning.

Security principles include:

- server-side authorisation on sensitive reads/writes;
- ownership-scoped learner access;
- global administrative capabilities where justified;
- resource-scoped event assignments;
- data minimisation for coordinators/presenters;
- strict isolation of SCORM execution from the main application
  origin;
- audited privileged mutations; and
- future impersonation as a distinct highly privileged capability.

Route guards and hidden UI controls improve usability but do not replace
server-side checks.

## SCORM Security

Third-party SCORM packages may require browser capabilities that should
not be granted to the main authenticated application origin.

Upskill therefore runs SCORM from a dedicated learning origin, uses
short-lived launch credentials and attempt-scoped sessions, and
re-authorises learning access before exposing private content/progress
endpoints.

This isolation is an architectural strength that should be preserved.

## Reliable Background Work

Upskill uses a PostgreSQL transactional outbox and SQS-compatible worker
architecture.

When committed business state requires follow-up work, the outbox record
is committed in the same database transaction.

Examples include SCORM ingestion, content deletion, audit
projections, and future notifications/reporting events.

This means process failure does not cause Upskill to forget committed
work.

Workers are designed for at-least-once delivery and must be idempotent.

## Technology and Architecture

The current platform is a modular monolith built around:

- TanStack Start/Router;
- React;
- Mantine;
- TanStack Form;
- Zod;
- Better Auth;
- PostgreSQL;
- Kysely;
- Stripe;
- AWS S3;
- AWS SQS;
- AWS CDK;
- nginx/EC2; and
- Playwright/Vitest-based verification.

The modular monolith is intentional. Strong PostgreSQL transactions are
valuable for payments, entitlements, enrolments, progress, audit, and
outbox work.

Do not split the system into microservices without a demonstrated
operational or organisational need.

## Architectural Strengths to Preserve

- modular monolith and explicit server boundaries;
- PostgreSQL as authoritative domain store;
- immutable published learning versions;
- exact-version enrolments;
- Stripe webhook-based fulfilment rather than browser fulfilment;
- serialized capacity redemption;
- transactional outbox;
- idempotent worker design;
- isolated SCORM origin;
- durable audit evidence;
- route-level code splitting and bundle budgets;
- strict type/lint/test gates; and
- infrastructure as code.

## Product Areas Still to Grow

The strongest future product work is expected around:

- first-class events and event occurrences;
- assigned standard-admin/Coordinator/Presenter workflows;
- attendance;
- blended pre/post event learning;
- explicit enterprise contracts/blanket entitlements;
- versioned System/Offering Emails, automated Section plans, occurrence
  overrides, notifications and reminders;
- visual chart/table analytics with validated filters and richer
  reporting/operational views;
- safe filtered/unfiltered Course and Event CSV exports;
- global support/impersonation;
- broader resource formats; and
- potentially later learning programs/journeys.

These are product/domain expansions, not reasons to replace the current
stack.

## Engineering Priorities

Important production-hardening priorities identified during repository
review include:

1.  deployment verification that waits for and validates all
    target-instance deployment results;
2.  distributed authentication abuse/rate limiting rather than
    process-local counters alone;
3.  operational metrics/alerts for outbox, queue, DLQ, worker,
    certificate rendering, SCORM, database, and HTTP health;
4.  explicit readiness/version visibility for deployments;
5.  failure/concurrency testing around payment, enrolment, event
    capacity, outbox, and workers; and
6.  continued alignment between security documentation and the actual
    implementation.

## Documentation Handbook

The [architecture handbook index](README.md) links the current set of product,
domain, security, operations and governance documents and gives their reading
order. Significant decisions remain in the separate
[ADR collection](../adr/README.md). Notifications, organisations/contracts and
reporting/observability now have dedicated target-design documents; their
existence does not imply those target capabilities are implemented.

## Guidance for Contributors

Before implementing a significant feature:

1.  read this overview and the Domain Model;
2.  identify the owning bounded context;
3.  read the relevant detailed domain document;
4.  identify the invariants that must remain true;
5.  decide whether historical versioning matters;
6.  define server-side authorisation and data minimisation;
7.  identify transactional and asynchronous boundaries;
8.  identify audit and observability requirements;
9.  test failure/concurrency cases; and
10. update the architecture documentation/ADR when the design changes.

## Product Vision

Upskill should evolve into a coherent professional-education platform
where an individual learner, a healthcare organisation buying staff
seats, and a government customer funding broad workforce access all use
the same underlying learning system.

Courses and events should share reusable learning activities and
evidence. Commerce should grant access without leaking payment logic
into education. Staff responsibilities should be scoped without forcing
people into one role. Historical learning should remain accurate.
Background work should survive failures.

The goal is not architectural novelty. The goal is a platform that
remains understandable, reliable, secure, and adaptable as Upskill's
professional-education offerings grow.
