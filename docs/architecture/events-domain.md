# Events Domain

**Status:** Living architecture document\
**Scope:** Instructor-led and blended events, registration, assignments,
sessions, attendance, event learning requirements, completion, and
administration\
**Audience:** Product, engineering, platform administrators, event
coordinators, presenters, and future contributors

## Purpose

This document defines the Events domain within Upskill and the
recommended implementation direction for instructor-led professional
education.

Upskill events are not simply calendar entries. An event is a scheduled
learning experience that may combine registration, approval, pre-event
learning, face-to-face or virtual delivery, attendance, post-event
activities, completion, and certification.

> **Events own scheduling, registration, participation, attendance, and
> event workflow. They compose reusable learning activities rather than
> creating event-specific versions of SCORM, surveys, and resources.**

## Architecture Horizons

- **Current Product:** a first-class relational Event foundation now models
  immutable Event Template Versions, exact-version occurrences, sessions,
  ordered Sections and reusable learning activities, regions, staff assignments,
  registration, participation and attendance. Platform Administrators can
  create a blank Template, explicitly select its default instance
  administrators, author multi-session and blended-learning content, configure
  regional Coordinator and session Presenter defaults, publish immutable
  versions, create successor versions, and schedule and publish occurrences.
  The first Event Instance operations workspace now supports authenticated
  learner registration and withdrawal, region selection, administrator-added
  registrations with explicit restricted-domain override, retained registration
  transitions, regional review and list locking, capacity-safe final selection,
  waitlisting and cancellation, attendance recording, and occurrence lifecycle
  transitions. A separate assigned-events workspace now resolves active Event
  Administrator, occurrence-region Coordinator and occurrence/Session Presenter
  assignments; its reads and mutations are constrained to the exact assigned
  regions and Sessions instead of exposing the broader Administration area. A
  published occurrence is rescheduled through an explicit command that keeps or
  replaces future registration deadlines, or reopens registration into a new
  retained regional review round. The command snapshots current region and
  Coordinator coverage and exposes retained schedule history to administrators.
  Administrators can add regions with named Coordinators or retire regions after
  reviewing affected active/confirmed counts, while explicitly preserving
  existing registrations or cancelling active registrations and releasing
  confirmed capacity. Open-entry guest check-in, staged Event learning and
  automated communications remain target workflows.
- **Target Product:** the Event domain described in this document, including
  regional Coordinator review, assigned standard-administrator selection,
  capacity-safe registration, attendance and blended learning. Every in-person
  or virtual occurrence can be
  open-entry with no registration, require unrestricted registration, or require
  registration restricted to one or more verified email domains.
- **Future Possibilities:** waitlists, advanced scheduling, external
  calendar/video integrations and scale-driven read models.

## Product Context

The target Upskill product delivers instructor-led training in addition to the
current self-paced e-learning experience. Events may be physical or virtual and
may require learning before and after attendance.

```text
Discover event
  -> register
  -> regional Coordinator review / candidate approval
  -> regional list lock
  -> assigned administrator final selection
  -> pre-event SCORM / survey / resources
  -> attend workshop session(s)
  -> attendance recorded
  -> post-event survey / resources
  -> completion
  -> certificate where applicable
```

Some Events may instead be open-entry experiences with no formal registration
record. Open entry is distinct from **registration required, unrestricted**,
which creates a registration but does not restrict it by email domain. All modes
share one Event domain rather than becoming separate platforms.

## Current Implementation Boundary

The implemented foundation deliberately establishes the breaking relational
boundaries before adding broad UI workflows:

- Event Instances are occurrences pinned to one immutable Event Template
  Version;
- delivery, registration and approval modes are independent values rather than
  one overloaded Event type;
- occurrence sessions and administrator, regional Coordinator and Presenter
  assignments are durable snapshots with historical assignment intervals;
- registration, participation and attendance are separate records; and
- restricted occurrences store normalized eligible domains independently of
  open-entry and unrestricted registration modes.

Template creation intentionally creates no implicit Session. The version
designer requires explicit instance administrators and supports ordered titled
Sections containing Sessions, SCORM, Surveys and PDF resources, with regional
Coordinator and session Presenter defaults. Published versions are read-only;
an administrator creates a cloned successor version before changing them.
Authenticated registration-required Events are surfaced on the learner dashboard
and the administrator operations workspace supports review, selection and
attendance. Published-occurrence schedule edits use the explicit reschedule
policy boundary; prior schedules, covered regions and active Coordinator
assignments are retained, locked review rounds are not rewritten, and reopening
creates another review round. The same workflow supports region addition,
Coordinator reassignment and region retirement with an affected-registration
preview and a future-only or cancel-active disposition. Cancellation retains
participation and Attendance evidence. Public promotion/registration pages,
open-entry check-in and the full staged learner Event workspace should not be
described as implemented yet.

## Domain Philosophy

### An event is a scheduled learning offering

An event has time and delivery constraints that a self-paced course does
not: schedule, venue or virtual location, capacity, registration window,
sessions, assigned staff, and attendance.

### Events compose learning; they do not reimplement it

Pre-event SCORM remains SCORM. A survey remains a survey. A training
manual remains a resource. Events reference reusable learning activities
and organise them into the same ordered, titled Sections used by Courses.

### Workflow and progress are distinct

Registration state answers whether someone has applied or been accepted.
Learning progress answers what educational requirements they completed.
Attendance records participation in scheduled delivery. These states
interact but should not be collapsed into one status field.

## Bounded Context and Ownership

The Events domain owns event identity and scheduled occurrences,
schedule, venue/virtual delivery information, capacity, registration
rules/windows, registrations, regional review and final selection, sessions/days,
standard-admin responsibility plus Coordinator/Presenter assignments,
attendance, lifecycle, participant
operational views, and event completion orchestration where attendance
is part of completion.

It does not own Stripe, organisation contract rules, SCORM runtime,
survey question/response implementation, resource storage, generic
identity/session management, or global audit infrastructure.

It collaborates with Commerce and Entitlements, Learning Activities,
Identity/Authorisation, Notifications, Certificates, and the
Transactional Outbox.

## Core Concepts

### Event

The stable identity of an instructor-led or blended educational offering. In
administration this is the reusable **Event Template** identity. Event Templates
are internal authoring records and do not own public URL slugs.

### Event Template Version

An immutable published future-instance definition containing exact ordered
Sections/items, Learning Activity and Automated Email versions, release and
completion rules, registration/region defaults, communication rules and one or
more default standard Platform Administrators, one or more default Coordinators
for every configured region and one or more default Presenters for each
presenter-required occurrence/Session definition. Editing creates a new
draft/version; it never mutates an existing occurrence or published version.

### Event occurrence

A scheduled delivery of one exact Event Template Version. It snapshots that
version's configuration and default administrator/Coordinator/Presenter
assignments, then adds dates, timezone, delivery mode, venue/virtual details,
capacity, registration window, Sessions and occurrence-local permitted
overrides. Each occurrence owns a required unique friendly slug for its public
promotion, registration and access URL.

### Event session

An attendance unit within an occurrence. A two-day workshop may have two
sessions; more complex events may have multiple sessions per day.
Attendance should be recorded at the appropriate granularity.

### Registration

A person's request or intent to participate. Registration is not
enrolment and not attendance. States may include pending, accepted,
declined, waitlisted, withdrawn, or cancelled.

Each occurrence has an explicit participation/registration mode:

- **Open entry** requires no registration record.
- **Registration required, unrestricted** requires a registration but permits
  any otherwise eligible authenticated learner regardless of email domain.
- **Registration required, restricted** requires a registration and the
  learner's verified email domain to match one of the occurrence's configured
  allowed domains.
- **Administrator restriction override** still requires a registration but
  allows an authorised platform administrator to enter name/email, provision or
  reuse the same soft account used by other administrator-add/open-entry flows,
  and add that specific user despite not matching the occurrence's allowed
  domains.

This mode is independent of in-person/virtual delivery, price or
entitlement, capacity, registration dates, and automatic or manual approval.

### Event participation

Once accepted or otherwise eligible, a participant receives access to
event learning requirements. Reuse the learning-domain
enrolment/progress concepts rather than building a second progress
system.

### Coordination region

A configurable hierarchical directory used to allocate operational
responsibility. A **region group** is an organisational parent such as New South
Wales or Victoria; it provides navigation and reporting context but is not
selected for registration or Coordinator assignment. An **operational region**
is a selectable leaf such as a NSW Health LHD, Victorian region, district or
customer-defined service area. Operational regions may belong to a group or be
ungrouped when no parent taxonomy is useful.

An Event Template selects any combination of operational regions, including
regions from multiple groups. For example, one Template may cover NSW regions
A, B and C together with Victorian regions X, Y and Z. Each selected operational
region has its own one-or-more default Coordinator selections, regional review
list and occurrence assignment snapshot. Selecting a parent group never
implicitly selects all current or future children, so adding a new regional
directory entry cannot silently broaden an already published Template or Event
Occurrence.

The editable Event Staff roster marks who is eligible for future selection.
Presenter eligibility is global to the roster; Coordinator eligibility is
granted independently for each operational region. Eligibility does not grant
runtime access. Runtime Coordinator authority still requires an active
occurrence-and-region assignment, and runtime Presenter authority still
requires an active occurrence/session assignment. Ending eligibility prevents
new default selections without erasing historical versions or assignments.

### Registration region snapshot

The region confirmed by the learner when registering. It is initialized from
their user-updateable onboarding/profile region but retained with the
Registration so a later move does not rewrite or reroute current or historical
decisions.

### Regional review list

The occurrence-and-region collection collaboratively reviewed by that region's
assigned Coordinators. It owns provisional approval decisions, optional numeric
priority and manual/deadline lock state.

### Coordinator assignment

A resource-scoped assignment granting operational responsibility for a
specific event occurrence: registration review, participant contact,
progress monitoring, attendance visibility, and event-specific
administration.

An occurrence may assign one or more Coordinators to each applicable region.
Their review authority is limited to that occurrence and region.

Every active region requires at least one active Coordinator, with multiple
assignments supported for shared responsibility/leave cover. Revocation or User
disable preserves prior actions and leaves other Coordinators operating. A
sole-Coordinator gap triggers replacement or standard-administrator fallback and
an urgent alert; it never strands the list. Current Event Templates receive a
new version removing the disabled default Coordinator, while old versions and
existing occurrence provenance remain unchanged.

### Assigned Event Instance administrator

One of one or more standard Platform Administrators recorded as an Event
Instance's operational owners. The assignment drives responsibility,
notifications and focused views but grants no authority independently of the
standard role. Assigned administrators consolidate locked regional lists, make
capacity-aware final decisions, manage late invitations and provide shared/leave
cover. Any Platform Administrator retains audited backstop access.

Disabling the standard administrator role immediately ends that User's usable
owner assignments without deleting their history. Instances continue under
other assigned administrators or urgent Platform Administrator backstop. The
revocation workflow assigns a replacement where supplied and publishes a new
Event Template Version removing the disabled default (and adding the replacement
when required); old versions and existing instance provenance remain immutable.
Without an available replacement, affected instances are flagged for attention
but learner/Event operation continues, and new instance creation is blocked until
the Template has a valid default administrator set.

### Presenter assignment

A narrower resource-scoped assignment allowing access to assigned
event/session details, attendance lists, attendance marking, and offline
attendance export.

Every presenter-required occurrence/Session has one or more active Presenters,
supporting shared delivery and leave cover. Revocation/disable immediately ends
future scoped access but retains the Presenter listing, assignment interval,
Attendance and recovery-action attribution. Other Presenters continue. A sole
gap triggers replacement or `presenter_attention_required`; standard Platform
Administrators retain digital operational fallback without being recorded as
Presenters. Current Event Templates receive a successor version without the
disabled default Presenter, while historical versions/instances remain exact.

### Attendance

Durable participation evidence identifying occurrence/session,
participant, attendance state, actor, timestamp, and correction history
where required.

For open-entry guests, distinguish `details_submitted`, `join_disclosed`,
`checked_in` and `attended`. Page access or early meeting-link disclosure is not
attendance. A Join action within the configured session window is a
`self_check_in` signal; occurrence policy decides whether it is immediately
authoritative or awaits staff confirmation.

## Event Types

### Registered event

Requires registration before participation; acceptance may be automatic
or reviewed.

### Approval-based event

Registration remains pending until an authorised coordinator or
administrator accepts or declines it.

### Open-entry event

Uses the same event/schedule/activity model but a lighter participation
workflow with no formal registration record. A normal virtual flow sends an
occurrence-scoped Upskill guest link rather than exposing the Zoom/Teams URL
directly. The mobile-first landing page collects name and email, creates guest
participation/check-in evidence, then reveals the protected Join action. It does
create or reuse a user identity with onboarding incomplete, but does not grant an
authenticated session, claim email verification or require onboarding before
joining. New soft accounts use the same name/email provisioning boundary as an
administrator-added account and receive a deduplicated, expiring account-setup
email asynchronously. It must not become a separate event subsystem or be confused with
registration-required unrestricted Events.

### Delivery mode

Model face-to-face/in-person and virtual delivery explicitly. Public event
information may expose a venue summary while sensitive virtual meeting
credentials remain restricted to accepted participants and authorised
staff.

Delivery mode does not determine participation/registration mode. An in-person
or virtual occurrence can independently use open entry, unrestricted
required registration, or restricted required registration.

## Event Lifecycle

A recommended conceptual lifecycle is:

```text
draft -> published -> registration open -> registration closed -> in progress -> completed -> archived
```

Some states may be derived from dates rather than stored, but their
business semantics should remain explicit.

Draft allows configuration. Published enables discovery. For
registration-required Events, registration-open accepts applications and
registration-closed blocks ordinary new registrations. Open-entry Events use an
equivalent participation/check-in window without creating registration records.
In-progress prioritises attendance workflows. Completed retains participation
while allowing post-event work. Archived removes the occurrence from active
views while preserving history.

## Regional Registration Workflow

Large occurrences may divide review across state, national or international
coordination regions. For example, a NSW Health occurrence may use LHDs; another
occurrence may use states, countries or customer-defined areas. The taxonomy is
configurable and may be hierarchical.

Only operational regions participate in registration routing. Groups remain
stable reporting and navigation labels. A multi-group occurrence presents each
selected operational region explicitly, takes a point-in-time region snapshot
on Registration, and limits each Coordinator to the lists for the exact regions
assigned to them.

A regional approval flow is:

```text
registration submitted
  -> assigned from confirmed Registration Region Snapshot
  -> Coordinator approved | Coordinator not approved
  -> regional list locked (manual | deadline)
  -> assigned administrator selected | waitlisted | not selected
  -> confirmed / locked in
```

The learner's current profile region is user-updateable, but registration stores
the confirmed point-in-time region. A later move applies to future registrations
only. Correcting an active Registration's region is an explicit retained and
audited assigned-administrator action.

Coordinator approval is provisional candidacy, not acceptance into the Event.
Only Coordinator-approved registrations advance from a regional list. A region
may legitimately submit an empty list. An approved candidate may receive a
nullable integer priority; larger values indicate higher priority under the
occurrence's documented scale. Ranking is optional, so unranked approved
candidates remain eligible and visible as unranked.

Each occurrence has a public `registrationClosesAt` and a normally later
`coordinatorLockAt`, both interpreted in its explicit timezone. Coordinators may
lock their region early, notifying all assigned Event Instance Administrators. At the
second deadline, every outstanding regional list is server-effectively locked
with its current decisions even if a background worker is delayed. Unreviewed
registrations do not become approved and absent rankings remain null. Once
locked, a Coordinator cannot edit the list; a Platform Administrator may use an
explicit audited reopen/correction command before final selection.

The assigned Event Instance Administrators share one consolidated cross-region view.
Ranked candidates are normally considered by descending score; the administrator
then applies accountable best-fit judgement to ties, unranked candidates and
remaining capacity. This is a human decision rather than an opaque automatic
allocation. Final selection transactionally reserves capacity, materializes
participant access, records `lockedInAt`, emits committed events and sends one
confirmation email linking to the exact Event workspace. Coordinators cannot
change the decision after this boundary. A Platform Administrator may make a
later explicit audited correction under capacity and lifecycle rules.

Withdrawal/cancellation and waitlist/not-selected states are retained rather
than represented by deletion. Event cancellation remains a separate occurrence
transition. Full semantics are defined by
[ADR 0026](../adr/0026-regional-event-registration-selection.md).

### User-specific late registration

After public registration closes, an assigned Event Instance Administrator may invite a
specific existing or provisional User. The high-entropy, expiring, single-use
invitation routes the recipient through setup/login and then exposes the invited
Event on their dashboard to complete registration. It bypasses only the public
cutoff: domain restrictions, capacity, cancellation and final selection still
apply, with a separate restriction override required when appropriate.

A resulting late Registration retains its own region snapshot but enters an
assigned-administrator-owned late-candidate queue rather than silently reopening or
modifying a locked regional list. Generic public late-registration forms are not
part of the target model.

### Rescheduling registration options

Rescheduling an occurrence presents an explicit registration policy: keep the
existing windows, replace still-future cutoffs, or reopen registration with a
new public cutoff and a later Coordinator lock cutoff. Date movement alone never
reopens registration. The server validates deadline ordering in the occurrence
timezone and records the schedule plus registration-window decision atomically.

The reschedule workflow also requires explicit confirmation of applicable
Coordination Regions and their Coordinator assignments. The assigned administrator
may keep coverage, add regions made practical by the new schedule/location, or
retire regions from future submissions. An active region must have assigned
Coordinators or a deliberate Platform Administrator fallback. Region changes alone
do not reopen a closed registration window.

Before regional lock, revised dates may extend the current review. After any
regional list locks or final selection starts, reopening creates a new regional
review round for new or explicitly carried-forward candidates. Earlier lists,
rankings, not-selected/waitlist decisions and confirmed attendees remain stable;
the new round allocates only remaining/released capacity. Prior candidates are
not silently reconsidered and old regional lists are not unlocked.

The new round snapshots its regional coverage and assignments. Added regions
receive new lists; retired regions accept no new routing but retain their prior
lists and participant history. Existing active candidates move region only
through an explicit audited reassignment.

Retiring a region requires an assigned Event Instance Administrator to choose whether it affects
future registrations only or explicitly cancels selected/all existing
Registrations whose Region Snapshot matches. The UI displays affected pending,
waitlisted and confirmed counts before confirmation. Participant cancellation is
not occurrence cancellation: a confirmed learner sees **Registration cancelled**
on their dashboard while the Event may continue for other regions. The command
withdraws future access as policy requires but retains completed learning,
Attendance and decision history. Re-adding a region never silently restores a
cancelled Registration.

## Registration Mode and Domain Eligibility

Registration mode is occurrence policy, not an organisation role or an
access-code requirement.

| Dimension         | Options                                                | Independent of                          |
| ----------------- | ------------------------------------------------------ | --------------------------------------- |
| Delivery mode     | In-person, virtual                                     | Registration mode                       |
| Registration mode | Open entry; required/unrestricted; required/restricted | Delivery mode and approval workflow     |
| Approval workflow | Automatic, manual approval                             | Delivery mode and registration mode     |
| Commercial access | Free, paid, entitlement-covered                        | Registration mode and approval workflow |

A registration-required restricted occurrence stores one or more normalised
allowed domains. The server requires a verified learner email and performs an
exact normalised domain match when registration is submitted. If acceptance is
a later manual transition, eligibility is rechecked at acceptance so changed
identity or policy cannot bypass the restriction. Client visibility or a
disabled button is never the authorisation boundary.

Every required registration retains an eligibility source such as
`unrestricted`, `verified_domain`, or `administrator_override`. Open-entry
participation has no registration eligibility source because it has no
registration record.

Domain configuration should follow the access-grant discipline: support
multiple domains, avoid substring matching, define subdomain behaviour
explicitly, audit administrative changes, and return a bounded rejection that
does not unnecessarily enumerate configured domains.

Changing an occurrence's allowed domains affects new registrations and pending
registrations when they are reviewed. It does not silently delete or rewrite an
accepted registration; removing an accepted participant is a separate,
authorised and audited transition. The registration retains enough eligibility
decision context to explain why it was accepted.

### Administrator restriction override

An authorised platform administrator may enter name/email and manually create or
accept a Registration for one specific user who does not satisfy a restricted
Event's domain policy. Name/email resolves through the same idempotent soft-account
boundary as other administrator-add/open-entry flows and a newly created
provisional user receives the normal setup email. This dedicated server command
does not alter the user's verified email, add a domain to the occurrence
allowlist, or make any other user eligible.

The registration records `administrator_override` as its eligibility source,
together with the acting administrator, learner, occurrence and timestamp. It
then follows the ordinary registration/participation workflow and emits the same
committed events and notifications. Repeating the command must not create a
duplicate registration.

This override bypasses only the domain restriction. Capacity, occurrence
lifecycle, cancellation and duplicate-registration rules remain authoritative.
Any future ability to override those constraints requires a separate explicit
decision and command. A free-text reason is not required; structured audit
evidence records what was overridden and by whom.

## Capacity

Capacity-sensitive acceptance must be transactionally safe. If two Event
Administrators select registrations concurrently for the final place, the
database must prevent over-allocation.

Use a locked occurrence/capacity row or equivalent
constraint/serialization boundary. Never trust the UI's displayed
remaining places as authoritative. A reliable capacity model also
enables future waitlists.

## Learning Sections

Events compose reusable Learning Activity Versions into ordered, titled
Sections, using the same learning structure as Courses. In the target
administration timeline, Sections may also contain Automated Email Items that
support the surrounding journey without becoming learner activities. A title
expresses the section's learner-facing purpose; it is not a schema discriminator.
Examples include:

- **Pre-Event Survey** --- surveys, SCORM, resources, acknowledgements or future
  prerequisites;
- **Live Workshop** --- attendance requirements associated with scheduled Event
  Sessions; and
- **Post-Event Resources** --- evaluation surveys, follow-up SCORM, resources,
  reflection or future assessments.

The Events domain controls Section/item availability and its relationship to
the occurrence lifecycle. The Learning domain controls Section progress and
activity semantics. Event Sessions remain separate scheduled attendance units,
not a replacement name for Sections.

An author inserts an Automated Email Item from a dropdown of compatible
published designs created in the separate Email Designer. Its explicit
domain-event/timing/audience policy controls delivery; adjacency to an activity
has no implicit execution meaning. Learners do not see the item in their activity
list and it produces no evidence or progress. See
[ADR 0027](../adr/0027-section-embedded-automated-emails.md).

Event Sections also carry release intent such as `pre_event`, `session`,
`post_event` or `follow_up`, plus a rule anchored to final administrator confirmation,
participation creation, occurrence/session start or end, or final Session end.
Signed offsets support X hours/days/weeks before or after and calendar-month
follow-ups. Titles remain free learner-facing text; the phase is policy metadata,
not a replacement Section type.

## Gating and Prerequisites

Gating should be explicit configuration, not hard-coded assumptions.
Examples include accepted registration before pre-work, post-event
survey unlocking after attendance, or certificate eligibility requiring
attendance plus post-work.

Distinguish a hard technical gate from an operational warning. A
coordinator may need to see incomplete pre-work without the platform
automatically cancelling a participant.

Time availability and predecessor completion are separate conditions. Unless an
author explicitly configures a hard prerequisite, incomplete Pre-Event work does
not block live Session access. Registered participants receive immediate
Pre-Event access after final administrator confirmation; each Session releases from its
own schedule; Post-Event work may release a configured number of hours before the
relevant/final Session ends; and Follow-up work releases after a configured
duration such as one calendar month.

Open-entry participation releases Pre-Event work and the currently joinable
Session immediately when the soft account/participation is created. Future
Sessions, Post-Event work and Follow-ups continue to use the same schedule; any
release time already passed is available immediately. This lets late joiners use
opening minutes or breaks for missed pre-work without unlocking future stages.

The server derives and authorizes availability on every read and mutation.
Notifications may be scheduled when a stage releases, but delayed background
work cannot keep due content locked. Learners see locked stages with the release
time and occurrence timezone. Rescheduling recalculates only not-yet-released
instants and never silently relocks legitimately accessed/completed work. See
[ADR 0025](../adr/0025-event-registration-finalisation-and-section-release.md).

## In-Session Prerequisite Recovery

Presenters regularly encounter registered participants who have not completed
required pre-event learning and cannot readily authenticate because of forgotten
passwords, email/2FA delivery problems, restricted corporate devices, poor
connectivity or device sharing. The current manual workaround—anonymous Survey
QR responses followed by coordinator email matching—is ambiguous and should not
become product architecture.

Each recovery QR identifies the exact occurrence and prerequisite item. The
preferred flow offers password, email OTP and verified-mobile SMS OTP, then
returns the authenticated participant directly to that item. A verified
short-lived event-task session is available on shared devices so the participant
does not expose their broader account.

As a last resort, an occurrence may enable a presenter-window email-match route
for selected non-sensitive Surveys. Exact normalized email matching must resolve
an accepted Registration before a one-survey capability is issued. That
capability is already bound to the User, Registration, occurrence, course/Event
item and exact Survey Version, so submission records correctly attributed
evidence immediately and requires no later matching.

Different-email and exceptional cases use an authenticated, audited
Presenter/Coordinator selection of the correct participant; never fuzzy email
matching. The email-only route grants no account session or other participant
data and does not apply to SCORM. Shared-device completion invalidates the token,
clears local participant state and returns to a neutral start screen. The full
decision and risk controls are in
[ADR 0024](../adr/0024-event-prerequisite-recovery-and-passwordless-access.md).

### Occurrence Survey QR catalogue

Every Event Occurrence owns a persisted access record for each exact Survey item
in its Sections. If a Survey item is associated with a specific Session, its QR
record carries that Session scope; otherwise it remains occurrence-scoped. The
catalogue groups pre-event, individual-Session and post-event Surveys and retains
window, policy and rotation/revocation state.

Occurrence creation/publication generates the complete set idempotently from the
exact composed items. Draft changes reconcile draft records; published changes
follow Event versioning rather than silently retargeting an existing QR.
Cancellation/archive disables access without making already-attributed Survey
evidence uninterpretable.

The photographed QR contains an opaque public reference, not an email address or
raw database identifier. Server resolution supplies the occurrence, optional
Session, Event item and exact Survey Version. The landing flow then captures the
submitted email and authentication/fallback method, so the response evidence is
stored with User, Registration, occurrence, Session, item, Survey Version and
provenance before completion is accepted.

Presenters and Coordinators can browse only the QR catalogue within their active
scope and display an individual QR full screen. Presentation mode shows the
Survey title, instructions, availability/countdown and scannable code while
hiding participant information and administrative controls. QR display does not
bypass survey availability, registration or identity checks.

## Progress and Completion

Event progress should reuse the Learning domain's evidence-first model.

| Participant    | Pre SCORM | Pre Survey | Day 1 | Day 2 | Post Survey |
| -------------- | --------- | ---------- | ----- | ----- | ----------- |
| Alex Example   | Complete  | Complete   | Yes   | Yes   | Complete    |
| Jordan Example | Complete  | Missing    | Yes   | No    | Locked      |

This should be a read model over learning and attendance evidence, not a
second event-specific progress store.

Event completion may combine required pre-work, attendance sessions,
post-work, and explicit authorised corrections. Completion should be
deterministic and able to reuse the common on-demand certificate-eligibility
boundary.

## Attendance Model

A minimal confirmed-attendance vocabulary is `not_recorded`, `attended`, and
`absent`. Open-entry guests may additionally be `checked_in` pending
confirmation. Add partial/excused states only for demonstrated business
requirements.

Guest entry captures source and time separately from the final attendance
decision. Before the attendance window, submitting details or opening the
protected Join action must not mark attendance. Inside the window, an occurrence
may explicitly accept self-check-in as attended or require presenter/coordinator
confirmation. This policy is visible to staff and remains correctable with
provenance.

Presenters and coordinators may record attendance only within authorised
scope; platform administrators provide a support backstop. Writes
capture actor and timestamp. Corrections should preserve sufficient
audit history, particularly when attendance contributes to
professional-development evidence or certificates.

## Offline Attendance

Presenters may need a downloadable/printable attendance list where
connectivity is limited. Exports should contain only fields required for
attendance and avoid unnecessary profile or learning data.

Offline export is a privileged disclosure of personal information and
may warrant an audit event. Start with printable/exportable lists plus
later online entry; only add offline upload/reconciliation if real
operational use justifies the complexity.

## Coordinator Experience

The coordinator UI should be a focused operational workspace, not a
reduced copy of the full platform-admin app. Prioritise assigned events,
pending registrations, capacity, required participant contact
information, pre-event progress, attendance, post-event progress, and
operational warnings.

A coordinator assigned to one event must not gain access to unrelated
events.

## Presenter Experience

The presenter UI should be narrower still: assigned events/sessions,
schedule/location, attendance list, attendance marking, and offline
attendance export.

Do not expose registration decisions, unrelated learner history,
organisation administration, access grants, or course authoring unless a
separately held capability allows it.

## Platform Administrator Experience

Platform administrators create/configure events, assign
coordinators/presenters, inspect registrations, provide authorised
overrides, troubleshoot requirements, and access broader reporting.

Administrator capability should not erase operating context. An
administrator who is also a presenter should still have the focused
presenter workflow available when performing presenter duties.

## Hybrid Authorisation

Use global capabilities for broad administration/support and
resource-scoped assignments for event responsibilities.

```text
user A -> coordinator -> occurrence X
user A -> presenter   -> occurrence Y
user B -> presenter   -> session Z
```

Users may hold multiple capabilities simultaneously. Permission checks
remain server-side and resource-specific; navigation visibility is UX,
not the security boundary.

## Global Administration and Impersonation

A highly privileged global administrator may need broad backstop access
for troubleshooting. Future impersonation should remain a separate
capability with explicit initiation, prominent 'viewing as' UI, retained
original administrator identity, start/end timestamps, durable audit
evidence, and restrictions around sensitive actions where appropriate.

Impersonation is a support tool, not the ordinary coordinator/presenter
workflow.

## Notifications

Events generate time-sensitive communication: registration
received/accepted/declined, reminders, incomplete pre-work,
venue/virtual details, schedule changes, cancellation, post-event
requirements, and certificate availability.

The Events domain should emit meaningful domain events. Notification
delivery should be asynchronous through the transactional outbox rather
than email being sent inside registration transactions. Templates,
preferences, scheduling, and channels belong to a Notifications
capability.

Publishing an Event Template pins exact Automated Email Item designs and rules.
Creating an occurrence materializes its own Communication Plan. Its assigned
standard Platform Administrators see those email cards in the occurrence
Sections, can preview resolved content and may publish an occurrence-only
content/permitted timing override. Overrides update only eligible unsent
schedules and never alter the Event Template, sibling occurrences or sent
delivery history. System-owned mandatory cancellation/security behavior remains
outside occurrence override authority.

## Audit and Privacy

Consider durable audit evidence for event lifecycle changes, staff
assignments, significant registration decisions, attendance
entry/correction, capacity overrides, privileged participant changes,
offline personal-data exports where policy requires it, and impersonated
actions.

Scoped event roles receive only data needed for their responsibilities.
Coordinators may need participant name, email, registration details, and
event-relevant progress. Presenters should usually receive a narrower
attendance-oriented view. Every exposed participant field should have an
operational reason.

## Open-Entry Events

Open-entry Events share event identity, schedule, sessions, activities and
attendance semantics; only the participation workflow differs.

Possible models include public information with no learner record,
authenticated self-join, or provisional-user guest check-in. For the ordinary
virtual guest flow, the occurrence link collects name/email before revealing the
Join action, creates or reuses the stable user identity with onboarding
incomplete, and retains point-in-time attribution plus access timestamps. It
creates participation/check-in evidence, not a formal Registration, verified
email, authenticated session or entitlement. A later email-verification/account
setup flow proves control and ordinary onboarding gates the learner dashboard.
Confirmed or policy-established Attendance then appears through the already-linked
user on the learner dashboard without manual matching; unconfirmed check-in
remains distinct.
'No registration' should not accidentally mean 'no identity' when durable
evidence is needed. Registration required/unrestricted, by contrast, still
creates an ordinary Registration and only means that no email-domain allowlist
applies.

## Commerce and Entitlements

Paid event registration and organisation/enterprise event access should
use the same commerce-entitlement boundary as courses.

Events consume a right to participate; they do not interpret Stripe
payment state. An enterprise contract may cover both courses and
eligible events without either learning subsystem understanding contract
mechanics.

## Certificates

Where an event grants a certificate, eligibility derives from
deterministic event completion requirements such as attendance plus
required pre/post activities. Reuse the common authenticated on-demand
certificate renderer rather than creating event-specific persisted certificate
state or a PDF pipeline.

## Reporting

Initial event reporting can query transactional data with bounded read
models. Useful views include registration funnel, capacity utilisation,
attendance, incomplete pre-work, completion, and post-event response
rates.

As volume grows, event/reporting projections can be fed from domain
events. Avoid introducing a separate analytics platform before
transactional queries demonstrate real pressure.

## Domain Invariants

1.  **Registration, participation, attendance, and learning progress are
    distinct concepts.**
2.  **Scoped assignments never grant access outside their assigned
    event/session.**
3.  **Capacity-sensitive acceptance cannot oversubscribe the event.**
4.  **Open entry, unrestricted required registration and restricted required
    registration are distinct modes independent of delivery mode, commercial
    access and approval workflow.**
5.  **Restricted required registration uses authoritative verified identity and
    exact normalised domain matching.**
6.  **An administrator restriction override is learner-specific, auditable and
    bypasses only the domain criterion.**
7.  **Events reuse learning activities rather than duplicate
    SCORM/survey/resource systems.**
8.  **Attendance is durable evidence with actor/timestamp provenance.**
9.  **Historical completed events and participation records are not
    silently rewritten by later event edits.**
10. **Sensitive participant data is exposed only for an operational
    purpose.**
11. **Event completion is deterministic from configured requirements and
    evidence.**
12. **Notifications are side effects of committed domain changes, not
    part of the transaction's external delivery path.**
13. **Global support power does not replace resource-scoped operating
    workflows.**
14. **Administrator confirmation locks a registered participant against later
    Coordinator status changes.**
15. **Section release is server-derived from exact time/prerequisite rules and
    never depends on notification delivery.**
16. **Open-entry activation opens Pre-Event/current Session access without
    advancing future Post-Event or Follow-up stages.**
17. **Every Event Occurrence references one exact immutable Event Template
    Version; later template publication never silently changes it.**
18. **Event Instance administrator assignment requires the standard Platform
    Administrator role, grants no separate authority and supports one or more
    active owners.**
19. **A new Event Instance snapshots the exact template version's default
    administrators; assignment/template changes never propagate implicitly in
    either direction.**
20. **Every presenter-required occurrence/Session supports one or more active
    Presenters; revocation preserves history and triggers replacement/attention
    rather than stranding digital delivery operations.**

## Recommended Implementation Sequence

### Phase 1 --- Event foundation

- Stable Event Template identity, immutable versions and exact-version Event
  Instance provenance.
- Versioned default administrator/Coordinator/Presenter sets, automatic instance
  assignment, active-role validation and required-scope coverage enforcement.
- Event occurrence model and lifecycle.
- In-person or virtual schedule and location.
- Sessions/days.
- Open entry, unrestricted required registration or verified-domain-restricted
  required registration for every delivery mode.
- Registration with region snapshots, Coordinator candidate decisions, optional
  priority, regional-list manual/deadline lock and assigned standard-administrator
  final selection/lock-in.
- User-specific late-registration invitations and a distinct
  assigned-administrator-owned late-candidate queue.
- Idempotent, audited platform-administrator addition of a learner who does not
  satisfy an occurrence's domain restriction, including shared name/email soft
  account provisioning and setup delivery.
- Transaction-safe capacity.
- Standard Platform Administrator Event management plus one or more operational
  owners per instance.

### Phase 2 --- Scoped operations

- Extend the first assigned-events dashboard with progress warnings, QR
  presentation/recovery, filtered exports and assignment lifecycle alerts.
- Assigned-administrator consolidated final-selection controls in the focused
  workspace (the current full final-selection controls remain in Administration).
- Presenter printable/minimal attendance export and time-windowed QR actions.
- Administrator/Coordinator/Presenter revoke, replacement, attention and
  successor-Template workflows.
- Attendance evidence and corrections.
- Minimal offline attendance export.
- Presenter-controlled exact-prerequisite QR recovery windows.
- Password/email OTP/verified-mobile SMS OTP return to the exact activity.
- Shared-device event-task sessions and audited one-survey assisted fallback.
- Server-side resource-scoped authorisation tests.

### Phase 3 --- Blended learning

- Ordered, titled Event Sections for pre-event, live-event and post-event
  learning.
- Time-anchored Section release rules for Sessions, early Post-Event work and
  delayed Follow-ups, including open-entry late-join behaviour.
- Reuse SCORM, surveys, and resources as activities.
- Participant progress projection for coordinators.
- Attendance as completion evidence.
- Event completion and certificate integration.

### Phase 4 --- Communications and maturity

- Email Designer with immutable Offering/System Email versions and safe typed
  variables.
- Section-embedded Automated Email Items, occurrence Communication Plans,
  previews and assigned-administrator local overrides.
- Notification domain/events, durable schedules, idempotent delivery and exact
  rendered-message history.
- Waitlists if required.
- Cancellations/rescheduling workflows.
- Event reporting projections where justified.
- Global support/impersonation capability if required.

### Later

- Recurring event templates.
- Complex multi-session presenter assignment.
- Calendar integrations.
- More sophisticated offline workflows.
- Learning programs/journeys that compose courses and events.

## Design Guidance for New Event Features

Before implementing an event feature, ask:

1.  Is this event workflow, learning activity behaviour, commerce,
    identity, or notification behaviour?
2.  Does it belong to the stable event or a scheduled
    occurrence/session?
3.  What lifecycle transition does it introduce?
4.  Is it capacity/concurrency sensitive?
5.  Which users may perform it, and is permission global or resource
    scoped?
6.  What participant data is genuinely required?
7.  Does it create durable evidence such as attendance?
8.  Does it affect completion?
9.  Does it trigger asynchronous work through the outbox?
10. Will historical completed events remain understandable after future
    edits?

If the feature requires duplicating an existing learning subsystem
inside Events, reconsider the boundary.

## Related Architecture Documents

Read this alongside the Project Overview, Domain Model, Commerce and
Entitlements, Learning Domain and Activities, Roles and Authorisation,
Transactional Outbox, and Product Architecture Review.

Significant changes to event lifecycle, registration, attendance, scoped
permissions, or blended-learning composition should update this document
and, where appropriate, an ADR.

## Summary

Events should become a first-class Upskill domain because instructor-led
and blended training are core product capabilities, not peripheral
calendar functionality.

The model should keep event operations focused: scheduling,
registration, capacity, staff assignments, attendance, and event
workflow. Educational content remains reusable through the Learning
Activity model, commerce remains behind entitlements, and asynchronous
communications remain behind the transactional outbox.

This creates a coherent path from simple workshops to rich blended
professional-development experiences without building a second LMS
inside the event feature.
