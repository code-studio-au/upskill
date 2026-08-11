# Learning Domain and Learning Activities

**Status:** Living architecture document\
**Scope:** Educational delivery, learning composition, enrolment,
progress, completion, evidence, and learning activities\
**Audience:** Product, engineering, content administrators, platform
administrators, and future contributors

## Purpose

This document defines the learning domain within Upskill: educational
delivery, learning composition, enrolment, progress, completion,
evidence, and the reusable learning activities from which courses and
blended experiences are built.

> **Learning owns educational delivery and evidence. It consumes access
> rights, but does not need to understand how those rights were
> purchased or granted.**

## Architecture Horizons

- **Current Product:** exact course-version enrolments composed through common
  Learning Activity/Version identities with SCORM, survey and PDF-resource
  content, evidence-derived section/course completion, administrator overrides
  and certificates.
- **Target Product:** extend the common activity vocabulary to attendance and
  pre/post-event learning, and introduce the broader Learning Offering concept
  where implementation benefit justifies it.
- **Future Possibilities:** weighted requirements, assessments, acknowledgements,
  media and multi-offering programs/journeys when justified.

## Product Context

Upskill delivers professional education primarily to healthcare workers
developing or refreshing eating-disorder skills. The current learning model
combines self-paced courses, SCORM e-learning, surveys and PDF resources. The
target model extends that composition to face-to-face or virtual events,
pre-event requirements, attendance and post-event activities.

The architecture must therefore not equate learning with either SCORM or
courses. Those are parts of a broader model.

## Domain Philosophy

### Learning is independent of commerce

Learning receives an authenticated learner and valid access/enrolment
state. It does not care whether access came from Stripe, an organisation
code, a blanket government contract, complimentary access, or a future
commercial model.

### Learning is composed from activities

A **learning activity** is a unit of educational work or evidence with
its own access, interaction, evidence, progress, and completion rules.

Current activity types are:

- SCORM module;
- survey;
- resource.

Likely future types include attendance, assessment, media,
acknowledgement, reflective exercise, assignment, or external learning.

Courses and events compose activities rather than implementing separate
versions of each content system.

## Composition Model

```text
Learning Offering
    |
    +-- Section
    |     +-- Learning Activity Item
    |     +-- Automated Email Item (administration timeline only)
    |     +-- Learning Activity Item
    |
    +-- Section
          +-- Learning Activity Item
```

A self-paced course might contain only SCORM. Another may combine SCORM,
surveys and resources. An event may combine pre-event SCORM, surveys and
resources, attendance, then post-event surveys/resources.

The common progress model should remain coherent across all
combinations.

## Current Product

### Immutable course versions

Stable courses are separated from immutable course versions. Published
versions retain the exact structure received by enrolled learners.
Structural changes require a new version. This is a major architectural
strength and should be preserved.

### Course sections and items

Course versions contain ordered sections and ordered items. Each item stores one
exact `learning_activity_version` identifier and matching kind. The common
version envelope is backed by a validated SCORM, survey or resource child table,
so composition is generic without weakening type-specific integrity.

### Learning Activity and Learning Activity Version

`learning_activity` is the stable administrative identity across revisions.
`learning_activity_version` identifies the exact delivery snapshot, publication
state and type. The version encompasses all content and intrinsic completion
semantics needed to deliver and later interpret that revision through its
type-specific child contract and immutable object references.

Published Course Versions point to exact Learning Activity Versions. Publishing
a later activity version cannot retarget an existing course version, enrolment
or evidence record.

### SCORM

SCORM package versions are immutable. Uploads are quarantined,
asynchronously validated/extracted, and delivered from a dedicated
learning origin. Attempts are enrolment-scoped; short-lived launch
credentials are stored as digests and exchanged for attempt sessions.
Progress commits recheck access.

### Surveys

Published survey versions are immutable. Responses are associated with
the learner's exact course-version item and survey version, providing
stable evidence that contributes to progress.

Event prerequisite recovery follows the same rule: authenticated, OTP-backed
event-task and facilitated submissions all resolve the exact participant,
offering item and Survey Version before accepting answers. Evidence records a
bounded completion/authorization provenance such as authenticated or
`facilitated_registered_email`, but never the OTP, capability token or unrelated
identity data. A facilitated response cannot be reassigned later by fuzzy email
matching or satisfy another participant/activity.

### Resources

Private resources are versioned and tied to exact course-version items.
Learner access is re-authorized before delivery. The domain concept
should broaden beyond PDF to slide decks, manuals, worksheets and other
reference files without changing the learning model.

### Completion and certificates

Course completion derives from required evidence. Certificate creation is an
authenticated on-demand rendering from the learner's current completion,
exact course version and completion timestamp. No certificate state is stored.
Completion and document rendering remain separate.

## Target Product

### Learning offering

A learning offering is something a learner can be enrolled in and
progress through. Today the main example is a course version; events
will become another structured offering. This concept need not
immediately become a single database table.

### Learning activity extensions

The common Learning Activity and Learning Activity Version contract is current
and governed by [ADR 0020](../adr/0020-learning-activity-versions.md). The target
is to extend that existing contract to attendance and future activity kinds,
not to introduce a second composition model.

### Event Section availability

The Events domain owns each exact Section's phase and release rule; Learning owns
activity evidence/progress after access is available. A locked item rejects
launch/submission server-side. Time release is independent of predecessor
completion unless the Event author explicitly combines them. Progress read
models distinguish locked from incomplete and can report a participant as up to
date for all currently available work without claiming final Event completion.

Registered access begins at final assigned-administrator confirmation. Open-entry activation
opens Pre-Event and the currently joinable Session immediately while later
Post-Event/Follow-up stages remain scheduled. Both paths produce identical exact
activity evidence once an item is available.

Each Learning Activity Version defines:

- a discriminating activity kind and version-content schema;
- immutable type-specific content/configuration or exact object references;
- launch/access behaviour;
- evidence produced;
- intrinsic completion semantics;
- override semantics;
- learner-visible state; and
- audit/security requirements.

Offering composition owns placement, order and required/optional status. Those
properties may differ when the same Learning Activity Version is reused and are
not silently written back into its immutable content.

### Learning activity version content

Version content means everything required to deliver and later interpret that
specific revision, whatever its activity kind. It is a validated discriminated
contract, not an untyped catch-all payload:

- SCORM owns its manifest, launch metadata, content hash and immutable object
  prefix;
- a survey owns its sections, questions, instruction blocks and response rules;
- a resource owns its immutable object reference, hash, media type and display
  metadata; and
- attendance or a future activity owns its type-specific requirement
  configuration.

Large files remain in private object storage. The version encompasses them by
owning the exact immutable reference, integrity metadata and delivery rules; it
does not need to embed their bytes in PostgreSQL. Type-specific tables are valid
implementation details behind the common version contract.

### Section

Both Courses and Events compose ordered, titled Sections, and each Section
contains ordered authored items. In the implemented Course model these are exact
Learning Activity Version items. The target authoring model also permits an
administration-only Automated Email Item among them under ADR 0027. Section
titles communicate their purpose rather than selecting a different structural
type; examples include "Pre-eLearning Survey", "Pre-Event Survey", "Workshop
Activities" and "Post-Event Resources". Event Sessions remain separate scheduled
attendance units and may be referenced by attendance activity semantics where
required.

An Automated Email Item is deliberately outside the Learning Activity contract.
It has notification trigger/delivery state rather than learner evidence, is not
rendered as a learner activity and is excluded from Section/offering progress and
completion. Its position helps an author see the communication journey but never
implicitly means "after the adjacent activity"; that dependency requires an
explicit typed trigger on the exact activity/domain fact. Notifications owns the
Email Design, schedule, occurrence override and delivery history.

### Enrolment

An enrolment connects a learner to exact delivered learning and anchors
access state, progress, evidence, completion, overrides, and certificate
eligibility. It remains historically traceable even if commercial access
later ends.

### Learning evidence

Evidence, rather than a mutable percentage, should be authoritative.
Examples include SCORM attempts, survey responses, resource completion,
attendance, future assessment results, and explicit administrative
overrides.

## Activity Contract

Every activity should answer the same core questions:

```text
Can the learner access it?
How is it launched or rendered?
What evidence does it produce?
When is it complete?
Can completion be overridden?
What learner-visible state does it expose?
```

This does **not** require a generic plugin framework. Typed domain
contracts and consistent server boundaries are preferable until real
product complexity justifies more machinery.

## Progress Model

### Evidence first

Underlying activity evidence is authoritative. Progress summaries are
derived state or carefully maintained projections.

### Activity progress

Where practical, activities expose a common vocabulary: not started, in
progress, completed, unavailable, and overridden where relevant.

### Section completion

A Section completes when all required activities satisfy their completion
rules. Optional activities do not block completion unless configured otherwise.
Non-learning administration items such as Automated Emails are not counted.

### Offering completion

An offering completes when its configured requirements are satisfied.
Completion is a domain transition, not merely a client-side percentage
calculation.

### Percentage progress

Percentages are useful UX projections but should not define completion.
Future offerings may include weighted activities, attendance, or
mandatory gates for which simple item counts are misleading.

## Completion Semantics

Completion is historically durable. Later commercial changes must not
erase genuine learning evidence.

Administrator corrections are useful, but should remain explicit audited
overrides rather than silent mutation of original SCORM, survey,
resource, or attendance evidence.

When evidence or an authorised override changes, parent section/offering
completion must be reassessed deterministically using the same rules
regardless of which activity type caused the change.

## Published Content and Versioning

Published educational content is immutable. Enrolments identify the
exact offering version received, and each activity resolves to exact
immutable content versions.

More precisely, every published offering item references one exact Learning
Activity Version. Learner evidence identifies both the offering item and that
activity version. A later activity revision creates a new version and never
retargets the published offering or evidence already held by a learner.

This protects historical accuracy, learner support, certificates,
professional-development evidence, auditability, and reproducibility.
New revisions create new drafts/versions rather than changing content
beneath existing learners.

## SCORM as an Activity Type

SCORM remains a specialised activity implementation, not the
architecture of the whole learning domain.

Preserve these boundaries:

- immutable package versions;
- enrolment/activity-scoped attempts;
- short-lived launch credentials;
- re-authorized content access and progress commits;
- idempotent completion side effects; and
- isolation from the primary application's authentication cookies and
  CSP.

## Surveys as an Activity Type

A survey activity references an exact published survey version. The
activity connects the learner's offering to that survey, while the
survey domain owns question structure and response validation.

Events should reuse the same survey implementation rather than create a
second event-specific questionnaire system.

The current implementation supports written, single-choice and multiple-choice
questions. The accepted target standardises Short text, Long text, Single
choice, Multiple choice, searchable Dropdown/combobox, labelled
Checkbox/acknowledgement, Number, Date and Rating/Likert questions. Yes/No is a
Single-choice preset; email/phone/URL are typed Short-text validation modes.
Instruction Blocks remain non-answer items.

All option-based answers store immutable option IDs. Administrators can maintain
options individually or bulk paste one spreadsheet row per option, with preview,
ordering, duplicate validation and a bounded maximum. Published versions retain
the exact list. Canonical profile fields such as region require explicit mapping
from options to domain Region IDs rather than label matching. See
[ADR 0030](../adr/0030-standard-survey-question-types-and-option-authoring.md).

## Resources as an Activity Type

A resource activity references an immutable resource version.
Storage/media details belong to the resource implementation; learning
cares about the stable version and completion semantics.

Whether viewing or downloading constitutes completion should be explicit
per activity rather than globally assumed.

## Events and Blended Learning

Events demonstrate why the activity abstraction matters:

```text
Registration finally selected
  -> pre-event SCORM
  -> pre-event survey
  -> pre-event resource
  -> attendance at session/day(s)
  -> post-event survey
  -> post-event resource
  -> completion / certificate
```

SCORM, surveys and resources should be reused directly. Attendance
becomes another evidence/activity type with its own rules. Coordinator
views can then show requirement-by-requirement participant progress
using the same underlying model.

## Learning Journeys and Programs

A higher-level journey/program may later compose multiple offerings, for
example a foundation course, live workshop, post-workshop survey, and
advanced course.

Do not introduce this prematurely. First make courses and events share
clean activity/progress semantics; a future journey can then compose
existing offerings instead of becoming a competing learning system.

## Certificates

Certificates are outputs of verified completion, never the source of
completion.

```text
Authenticated learner download
  -> recheck exact enrolment ownership and current completion
  -> render PDF on demand
  -> return private, non-cacheable bytes
```

Certificates should identify exact completed learning and completion
time. They have no persisted row or object; the authoritative completion and
its evidence survive later commercial changes. Current access policy is checked
when the document is requested.

## Administrative Overrides

Overrides are a controlled support backstop. They should be explicit,
actor/timestamp identified, auditable, preserve original evidence,
trigger deterministic progress reassessment, and avoid pretending the
underlying learning evidence itself changed.

The same model can later support attendance and future activity
corrections.

## Roles and Learning UX

Capability and operating experience are distinct. A user may hold
multiple capabilities, but administration should not automatically
become their learner experience.

Learner mode focuses on personal enrolments, activities, progress,
events, and certificates. Administration provides support and correction
tools. Future impersonation should be a separate highly privileged,
visibly signposted and audited support capability.

## Domain Invariants

1.  **An enrolment identifies exact delivered learning.** Later
    publication never silently migrates an existing learner.
2.  **Published content is immutable.** Structural changes require a new
    version.
3.  **Evidence belongs to the learner's enrolment/activity context.** It
    cannot satisfy another learner or offering.
4.  **Completion derives from explicit requirements and evidence.**
    Client-supplied percentages are not authoritative.
5.  **Commercial state does not rewrite historical learning evidence.**
    Access and history are distinct.
6.  **Sensitive activity boundaries re-authorize access.** Possessing a
    URL or identifier is insufficient.
7.  **Administrative corrections preserve original evidence and audit
    history.**
8.  **Certificates derive from completion.** On-demand rendering never creates
    completion or persists a parallel certificate lifecycle.
9.  **New activity types integrate through the common model.** They do
    not create parallel learning systems.
10. **Parent completion is deterministic.** The same evidence produces
    the same result regardless of trigger.
11. **Every Survey response resolves its participant and exact activity before
    submission.** Later manual email matching is not evidence attribution.

## Current Strengths to Preserve

- stable identities separated from immutable published versions;
- exact-version enrolments;
- server-side learner authorization;
- isolated SCORM origin and attempt sessions;
- immutable survey versions and response evidence;
- private versioned resources;
- derived section/course progress;
- audited administrator overrides;
- authenticated on-demand completion certificates; and
- transactional outbox integration for completion side effects.

Future work should evolve these patterns rather than replace them with a
generic LMS framework.

## Recommended Evolution

### Now --- formalise the common language

- Treat `learning activity` as the parent concept for SCORM, surveys,
  and resources.
- Treat `learning activity version` as the complete immutable, type-discriminated
  delivery snapshot described by ADR 0020.
- Keep the existing course-version item implementation while aligning
  services and terminology around the common activity contract.
- Ensure every activity exposes consistent progress/completion state.
- Keep exact content-version references explicit.
- Keep completion derivation centralized.

### Next --- support event learning cleanly

- Reuse SCORM, survey, and resource activities in Event Sections.
- Introduce attendance as explicit evidence/activity semantics.
- Give coordinators participant progress read models showing each
  requirement.
- Allow event completion requirements to combine learning evidence and
  attendance.
- Reuse on-demand certificate eligibility from the common completion boundary where
  appropriate.

### Later --- richer composition

- Add new activity types only for demonstrated product needs.
- Consider prerequisite/gating rules when required.
- Consider a program/journey layer only after courses and events share
  stable semantics.
- Add reporting projections when aggregate learning queries begin to
  pressure transactional paths.

## Design Guidance for New Features

Before implementing a learning feature, ask:

1.  Is this a new activity type, a new offering/container, or a change
    to existing evidence?
2.  What exact immutable content/version does it reference?
3.  What evidence does it produce?
4.  What constitutes completion?
5.  Is it required or optional?
6.  How is access re-authorized?
7.  How does it affect parent progress/completion?
8.  Can an administrator correct it without destroying original
    evidence?
9.  Does it trigger asynchronous work through the outbox?
10. Does it preserve exact historical learning for existing learners?

If a feature needs a separate progress system instead of integrating
with these concepts, reconsider the design before implementation.

## Related Architecture Documents

Read this alongside the Project Overview, Domain Model, Commerce and
Entitlements, Events Domain, Roles and Authorisation, Transactional
Outbox, and Product Architecture Review.

Significant changes to learning composition, evidence, completion, or
versioning should update the relevant architecture document and, where
appropriate, an ADR.

## Summary

Upskill already has strong learning foundations: immutable published
versions, exact-version enrolments, isolated SCORM execution, versioned
surveys/resources, derived progress, audited corrections, certificates,
and reliable asynchronous work.

The next step is evolutionary: make **learning activity** the explicit
common language for SCORM, surveys, resources, attendance, and future
educational requirements. Courses and events can then compose those
activities while sharing one evidence and completion model.

That gives Upskill room to grow from a self-paced course platform into a
coherent professional-education platform without creating a separate
subsystem for every new delivery format.
