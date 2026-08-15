# ADR 0025: Event registration finalisation and staged section release

## Status

Accepted target; implementation pending.

## Context

Registered Events normally require Coordinator review followed by an assigned
standard Platform Administrator's final selection. Once finally accepted,
participants need a stable place and a
single Event link on their learner dashboard. Learning must then open in stages:
pre-event work after confirmation, Session content on the relevant day,
post-event work shortly before delivery finishes, and follow-up work at a later
configured interval.

Open-entry participants do not pass through registration approval and may first
appear shortly before or during delivery. Their soft account and Event
participation still need the same staged learning model without pretending they
had a pre-event registration period.

## Decision

### Registered Event finalisation

A registration-required occurrence uses explicit candidate review followed by
final selection:

```text
submitted
  -> coordinator_approved candidate
  -> assigned Event Instance Administrator selected and confirmed (locked in)
```

Decline, waitlist and withdrawal/cancellation remain explicit retained states as
product policy permits. Coordinator approval is provisional and does not reserve
a place. For regionally coordinated Events, Coordinators first produce locked
regional candidate lists under
[ADR 0026](0026-regional-event-registration-selection.md). Confirmation by an
assigned Event Instance Administrator is the final acceptance boundary: it materializes participant
access, records `lockedInAt`, and emits the confirmation-notification fact. From
that point, a Coordinator cannot decline, withdraw, move or otherwise change the
Registration status. An assigned Event Instance Administrator or any standard
Platform Administrator acting as audited backstop may make a later correction
through an explicit command. Event cancellation is a separate occurrence-level
transition.

The participant receives one confirmation email only after assigned-administrator
confirmation. It links to the exact Event Occurrence on the learner dashboard,
using a safe application route rather than embedding a privileged token. A
provisional user completes account setup and onboarding as required before the
ordinary learner dashboard is exposed.

Capacity is reserved transactionally at final assigned-administrator selection.
The implementation must not infer a final place from UI state or allow
concurrent decisions to oversubscribe an occurrence.

### Section phases and release rules

Courses and Events continue to share ordinary ordered, titled Sections. Event
Sections additionally carry an availability phase/rule; labels such as
"Pre-Event Tasks" remain titles rather than schema types. Supported phase intent
includes `pre_event`, `session`, `post_event` and `follow_up`.

An exact published Event composition stores each Section's release rule:

- an anchor such as final administrator confirmation, occurrence start/end, a
  particular Session start/end, final Session end, or participation creation;
- a signed offset and explicit unit, supporting hours, days, weeks and calendar
  months;
- the occurrence timezone and daylight-saving interpretation;
- optional availability end/window; and
- whether predecessor completion is also required.

Examples are:

```text
Pre-Event Tasks  -> final administrator confirmation + 0
Session 1        -> Session 1 local day/start + configured offset
Post-Event Tasks -> final Session end - 2 hours
One-Month Review -> final Session end + 1 calendar month
```

Time release and prerequisite completion are independent conditions. Incomplete
pre-event work does not block a participant from the live Session unless the
author explicitly configures a hard prerequisite. This preserves the real-world
recovery workflow in ADR 0024.

Availability is authorized and derived server-side on every read and mutation.
A scheduler/worker may materialize release instants and send notifications, but
worker delay must never keep an otherwise due Section locked. A locked Section
cannot be launched or accept evidence merely because a client displays or calls
its route. The learner UI shows the lock reason and release time in the Event's
timezone; progress distinguishes `locked`, `available`, `in_progress` and
`completed`.

### Registered participant experience

After final administrator confirmation, Pre-Event Sections are available immediately.
Future Session, Post-Event and Follow-up Sections remain visible but locked when
configured for display. Each Session Section releases from its own Session rule.
Post-Event work may release a configured number of hours before the relevant or
final Session ends, allowing a Presenter to use spare delivery time. Follow-up
Sections release at their configured duration after the relevant Event anchor.
Release can trigger an idempotent notification, but access does not depend on
notification delivery.

### Open-entry participant experience

Creating/reusing the soft account and Event participation is the open-entry
activation boundary. Pre-Event work becomes available immediately. The currently
joinable Session also becomes available immediately; future Sessions retain
their scheduled rules. Any Post-Event or Follow-up release time already reached
is available, while future stages remain locked until due. Thus a late joiner can
complete pre-event work during opening minutes or breaks without moving future
stages or rewriting the Event schedule.

The same exact activity evidence and completion rules apply to registered and
open-entry participants. Participation mode changes how access begins, not the
meaning of a Section, Survey, SCORM attempt, Attendance or completion.

### Versioning and schedule changes

Release-rule definitions belong to the exact published Event composition;
occurrence and Session dates resolve their concrete release instants. Authorized
rescheduling recalculates not-yet-released instants and corresponding scheduled
notifications with retained change provenance. It never relocks a Section for a
participant who already legitimately accessed or completed it unless an explicit
administrator correction policy is invoked.

Release definitions store an amount and explicit unit. Minutes/hours mean
elapsed time; days/weeks/months mean calendar time in the occurrence timezone.
The local schedule, timezone and resolved exact instant follow
[ADR 0032](0032-typed-time-model.md).

Registration windows are not implicitly derived from the new Session dates. The
reschedule command explicitly keeps, replaces or reopens registration and the
Coordinator lock deadline under
[ADR 0026](0026-regional-event-registration-selection.md). Reopening after a
regional list has locked creates another review round rather than rewriting the
earlier decisions or confirmed participants.

## Consequences

Learners receive a predictable staged Event workspace, Presenters can use early
post-event release intentionally, and follow-up work can occur weeks or calendar
months later. Open-entry late joiners enter the same model without artificial
registration history. Registration authority is unambiguous after final
administrator acceptance, and section access remains correct even if background
notification processing is delayed.
