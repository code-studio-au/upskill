# Notifications and Communications Architecture

**Status:** Living domain design document\
**Scope:** Transactional notifications, reminders, templates,
scheduling, delivery, preferences, retries, audit, and integration with
domain events

## Purpose

This document defines how Upskill should implement learner, event,
organisation, and administrative communications without coupling domain
transactions to email or messaging providers.

The central rule is:

> **Domains decide that a meaningful event occurred. Notifications
> decide whether, when, how, and to whom that event should be
> communicated.**

Notification delivery is a side effect of committed domain state and
should therefore build on the transactional outbox and idempotent worker
architecture.

## Architecture Horizons

- **Current Product:** durable notification intents, deduplication keys,
  delivery-attempt history, a provider-neutral email boundary and outbox/SQS
  worker delivery are implemented for provisional accounts created by an Event
  administrator. Development and test use an idempotent database capture
  provider by default; explicit local opt-in and deployed environments use
  Mailgun. A governed Email Designer provides separate System/Offering
  catalogues, typed variables, fixture preview, immutable publication,
  active-version rollback and exact version/render snapshot history. The
  code-owned Account Setup contract is seeded and delivered through this path.
  Provisional accounts receive a 72-hour, single-use setup link, set a Better
  Auth credential, become verified/active and can sign in. Administrators can
  supersede an outstanding link and queue a replacement. Course/Event Template
  communication plans, Section/Session placement, exact Email Design Version
  binding, new-version inheritance, Event Occurrence materialization and
  revisioned local override/reset are implemented. Occurrence-anchored
  `event_start`, `event_end` and `session_start` plans materialize durable
  PostgreSQL schedules when an Occurrence is published; edits, rescheduling,
  overrides and cancellation supersede stale unsent work. Course enrolment
  creation, incomplete/expiry reminders and completion, plus Event registration
  submission/selection, Section release and Event completion all create exact,
  deduplicated notification intents in the authoritative domain transaction.
  Authored offsets become durable outbox availability times. Delivery rechecks
  current occurrence, registration, participation, Section-release and
  enrolment state before contacting the provider, suppressing work that is no
  longer applicable. Every trigger currently available in Course and Event
  communication-plan authoring is executable.
  Course triggers remain enrolment-scoped: `active_enrollees` is an eligibility
  boundary for the affected enrolment, not a fan-out to unrelated learners. A
  Platform Administrator delivery-operations workspace now exposes bounded
  health totals, overdue schedule/outbox age, searchable notification history
  and provider-attempt detail without exposing retained message bodies or
  payload credentials. Failed deliveries can be atomically requeued only from
  their failed state; cumulative attempts are retained and the operation writes
  durable audit evidence. Production infrastructure alarms on sustained SQS
  age/backlog and any dead-lettered work item.
  Security SMS delivery stores an immutable recipient User and name snapshot,
  provider acceptance and signed TextBee delivery updates. Moving a verified
  mobile number to another account therefore does not relabel historical rows.
  The displaced-account notification is a durable, governed System Email queued
  in the same transaction as the ownership transfer.
- **Target Product:** committed domain-event subscriptions create idempotent
  notification records, resolve bounded recipients/templates and deliver
  transactional email with observable retry/failure behaviour. A governed Email
  Designer provides immutable Offering/System Email versions, Section-embedded
  automation plans, occurrence overrides and reproducible delivery history.
- **Future Possibilities:** additional channels, user preference centres,
  campaign-style communications and managed scheduling/fan-out when required.

## Product Context

As Upskill grows beyond self-paced courses, communications become a core
product capability.

Likely use cases include:

- purchase/access confirmation;
- access-code delivery or organisation instructions;
- registration received;
- regional review reminders and regional-list lock notices;
- assigned Event Instance administrator final confirmation/waitlist/decline;
- user-specific late-registration invitations;
- event reminders;
- venue or virtual attendance details;
- schedule changes and cancellations;
- incomplete pre-event learning reminders;
- post-event survey reminders;
- course/event completion;
- completion with certificate-download eligibility where applicable;
- enterprise contract/access notices;
- Access Owner invitation/account-setup and capacity-extension receipts;
- provisional user account setup from administrator addition or open-entry
  check-in;
- organisation capacity warnings;
- administrative/support communications; and
- Event Instance administrator/Coordinator/Presenter reassignment and urgent
  unowned instance/region/session/template alerts after permission revocation.

These communications should not be implemented as one-off email calls
scattered through checkout, event and learning services.

## Domain Boundaries

### Source domains own

The business fact and its transaction.

Examples:

```text
Commerce: order paid
Entitlements: access issued
Events: registration finally selected
Events: event rescheduled
Learning: enrolment completed
Organisations: contract approaching expiry
```

### Notifications owns

- notification policy;
- template selection;
- recipient resolution;
- scheduling;
- delivery channel;
- delivery attempts;
- idempotency/deduplication;
- provider integration;
- delivery status; and
- notification-specific operational metrics.

### Notifications does not own

- whether a registration is actually accepted;
- whether learning is complete;
- whether a contract is active;
- whether the learner is currently eligible to render a certificate; or
- the underlying learner/event/order truth.

It consumes those facts from authoritative domains.

## Architectural Flow

```text
Domain transaction
  -> update authoritative state
  -> insert domain event / notification-relevant outbox event
COMMIT

Outbox dispatcher
  -> queue / event routing

Notification consumer
  -> resolve notification policy
  -> create notification delivery record
  -> render template
  -> deliver via provider
  -> record terminal/transient outcome
```

The originating transaction does not wait for the external email
provider.

## Domain Events

Prefer meaningful events rather than provider-specific commands where
multiple communication behaviours may evolve.

Examples:

```text
order.paid
enrolment.created
enrolment.completed
event.registration.submitted
event.registration.coordinator_approved
event.registration.regional_list_locked
event.registration.finally_selected
event.registration.waitlisted
event.registration.not_selected
event.registration.late_invited
event.registration.cancelled
event.rescheduled
event.cancelled
event.attendance.recorded
enterprise.contract.expiring
authorization.platform_admin.revoked
event.instance.administrator_attention_required
event.region.coordinator_attention_required
event.session.presenter_attention_required
```

The notification policy maps events to communications.

For very simple cases, a direct work command such as `notification.send`
may be sufficient, but the domain event should remain the source of
truth where several reactions are likely.

## Notification Record

A durable notification record should represent the intended
communication independently of a provider API request.

Useful fields/concepts include:

- notification ID;
- source event ID;
- notification type;
- recipient user/contact reference;
- channel;
- template/version;
- scheduled time;
- status;
- attempt count;
- provider message ID where available;
- sent/delivered/failed timestamps where supported;
- terminal failure reason; and
- creation/update timestamps.

Do not store unnecessary sensitive rendered content forever merely for
convenience. Retention should match support/audit requirements.

## Notification Identity and Idempotency

At-least-once event delivery means the notification consumer may see the
same source event more than once.

Use a deterministic uniqueness boundary such as:

```text
(sourceEventId, notificationType, recipientId, channel)
```

or another policy-appropriate key.

This prevents a dispatcher retry from sending the same logical email twice.

A deliberately recurring reminder must use a different logical
notification occurrence/schedule identity rather than bypassing
idempotency.

## Templates

Templates should be versioned or historically identifiable once used for
important transactional communications.

A template may contain:

- subject;
- HTML/text body;
- supported variables;
- locale where localisation is introduced; and
- version/status metadata.

The UI may render friendly variable tokens such as `[User full name]`, but the
immutable design stores stable typed keys such as `user.fullName`. The variable
contract is versioned independently of display labels. Removing or changing a
key requires reference verification and an explicit compatible migration/rebase;
published bindings, queued intents and delivery reproduction cannot be broken by
a label/schema edit.

Do not allow arbitrary domain objects to be injected into templates.
Define bounded template data contracts per notification type.

Example:

```text
EventRegistrationAcceptedTemplateData
  learnerName
  eventTitle
  eventDate
  venueSummary
  eventWorkspaceUrl
```

This makes templates testable and prevents accidental leakage of
unrelated data.

## Template Ownership

The Email Designer owns two catalogues. Offering Emails are reusable content
selected by Event/Course authors. System Emails have stable code-owned keys and
behavior contracts but administrator-managed versioned content.

Each catalogue has a persisted, administrator-controlled sequence. New designs
append to the end of their catalogue, and moving a design up or down swaps it
with the adjacent design in that same catalogue. Reordering is audited and does
not alter published design versions or queued delivery intents.

A Platform Administrator needs a dedicated communication-management capability
to view fixture/context previews, edit drafts, publish a compatible new immutable
version, activate a previous version for rollback and inspect bounded delivery
history. Publishing cannot change the system trigger, authoritative recipient
resolver, mandatory variables, preference class or security constraints.

System defaults are seeded/versioned and remain active if a draft fails
validation. Never make an invalid admin edit capable of disabling account setup,
OTP, cancellation or another mandatory communication.

## Email Version Activation and Delivery Evidence

New immediate notifications select the then-active compatible version. Published
offering bindings, Occurrence Communication Plans, scheduled notifications and
created delivery intents pin an exact Email Design Version. New publication does
not silently rewrite them; rebasing eligible unsent items is explicit and
previewed.

Each delivery retains its exact design version, trigger/schedule, recipient,
render time, provider ID and complete rendered subject/body snapshot or
equivalently complete immutable render inputs. This preserves what the recipient
actually received even after template variables, user details or Event dates
change. Retention and access to rendered personal content remain privacy-scoped;
a digest alone cannot reproduce a message.

## Section-Embedded Automated Emails

Event and Course Template Sections may contain **Automated Email Items** beside
their Learning Activity Items in the administration timeline. Each email item
references an exact published Offering Email Version and defines a typed
recipient resolver, committed-event or scheduled trigger, offset and bounded
send conditions.

Placement communicates journey context to the author; it is not an execution
language. An email adjacent to a Survey sends after that Survey only when its
explicit trigger references that exact Survey item/fact. Automated Email Items
are absent from learner activity lists and are excluded from activity, Section
and offering progress/completion.

The insert control lists only published designs compatible with the offering
context and required variable contract. Authors can reorder, configure and
preview the item in its Section. Publishing the offering template pins both its
Email Design Version and automation policy.

## Occurrence Communication Plans and Overrides

Creating an Event Occurrence materializes an Occurrence Communication Plan from
the exact Event Template Version. Automated Email cards remain visible among the
Occurrence Sections to assigned standard Platform Administrators. Each card shows inherited
or overridden state, trigger/timing, audience and aggregate scheduled/sent/failed
status without exposing unrelated recipient content.

An assigned Event Instance administrator may preview resolved occurrence content and publish a
local subject/body or permitted timing override. This produces a new immutable
occurrence-local revision and updates only eligible unsent schedules in one
authorized transaction. It cannot mutate the reusable Email Design, Event
Template, another occurrence or sent/terminal delivery. Resetting to inherited
content and adopting a later reusable version are explicit previewed actions.

Preview has three modes: labelled fixture data in the Email Designer, validated
sample context in an Event/Course Template, and authorized resolved context for
an explicit example recipient in an Event Occurrence. Preview never creates a
notification intent or delivery.

## Trigger, Schedule and Audience Registry

Automation policy comes from an allowlisted registry rather than arbitrary
expressions. Supported policy families include:

- committed domain-event facts for one affected recipient;
- occurrence/Session/Section anchors plus signed time offsets;
- exact activity state/completion facts; and
- current-state cohorts such as confirmed participants with incomplete
  pre-work.

Recipient resolvers are likewise typed: affected learner, eligible/confirmed
participants, assigned regional Coordinators, Presenters, assigned Event
Instance administrators
or another explicitly approved audience. Every due send rechecks current domain
state, recipient eligibility, cancellation/supersession and preference class.
Durable schedule IDs and per-recipient idempotency prevent duplicate delivery.

## Recipient Resolution

The source domain should normally emit stable identifiers, not arbitrary
destination addresses.

The notification consumer can resolve the current authorised delivery
address from identity/contact data where appropriate.

However, some transactional communications may need the address captured
at the time of the transaction. That should be an explicit
domain/product decision.

Recipient rules should avoid sending organisation-sensitive or
learner-sensitive information to addresses that are no longer
verified/appropriate.

## Delivery Channels

Start general product notifications with email if that is the actual product
need. This does not defer SMS authentication: verified-mobile SMS OTP is an
accepted identity requirement under ADR 0024 and has separate security,
rate-limit and delivery semantics from reminder/marketing messages.

The architecture can model channel explicitly without implementing
SMS/push prematurely.

Notification channels:

- email;
- in-app notifications;
- SMS reminders only when separately justified and consented; and
- organisation/admin operational alerts.

Each channel should have independent delivery adapters and retry
semantics.

## Event Notifications

Events are likely the largest initial notification consumer.

### Registration submitted

Confirm receipt and explain whether approval is pending.

### Regional review and final selection

Coordinator approval is provisional and does not send the final participant
confirmation. Manual or deadline regional-list lock notifies the assigned Event
Instance administrators idempotently. After final administrator selection locks
the Registration, send one idempotent Event confirmation containing a safe link to
the exact Event workspace on the learner dashboard and explain any account
setup/onboarding requirement. Waitlist and not-selected outcomes use distinct
product-approved communications.

### Late registration invitation

Send the intended person an expiring setup/login link for the exact invited
Event. Delivery does not register or accept the recipient; the server rechecks
invitation identity, lifecycle, eligibility and capacity when they act.

Section-release communications are separate. Pre-Event access is already
available at final confirmation. Session, Post-Event and Follow-up notifications
may be scheduled from their exact release rules, but content access is derived
server-side and never waits for message delivery.

### Registration declined

Communicate the decision using product-approved wording without leaking
internal coordinator notes.

### Event reminder

Send before the event according to configured timing.

### Incomplete pre-work

Notify learners who are accepted but have outstanding required pre-event
activities.

The reminder/deep link should identify an exact safe prerequisite destination.
At the session, the same destination may be exposed as a QR code and resumed
after password, email OTP or SMS OTP authentication. OTP delivery is an Identity
operation rather than a notification preference; reminder opt-out must not
disable a requested security code.

### Event rescheduled/cancelled

These are high-priority communications and should create durable
notification work for affected participants. A reschedule communication also
states whether registration remained closed, had its cutoffs changed or
reopened, including the new registration and Coordinator lock deadlines where
applicable. Assigned regional Coordinators and Event Instance administrators receive
their relevant review-round, regional coverage, assignment and deadline changes.
If the reschedule explicitly cancels registrations from a retired region, each
affected learner receives a participant-level registration-cancellation notice;
communications must not claim that the entire Event was cancelled.

The cancellation transaction commits `event.registration.cancelled` to the
outbox for every affected Registration. Notification delivery is automatic,
idempotent and retryable; a provider outage does not undo the cancellation. The
message identifies the Event Occurrence, explains that the learner's
Registration/place was cancelled, provides the appropriate support route and
does not expose other regional participants or internal selection detail.

### Post-event requirements

Remind attendees about required surveys or learning after attendance.

## Reminder Scheduling

Reminders differ from immediate event-driven notifications because they
depend on future time and current state.

A robust approach is to persist scheduled notification work or scheduled
reminder records rather than relying on in-process timers.

For example:

```text
registration finally selected
  -> create reminder schedule for event - 7 days
  -> create reminder schedule for event - 1 day

scheduler/worker reaches due record
  -> recheck event + participant state
  -> if still applicable, create/send notification
  -> otherwise mark skipped
```

Rechecking state is important because the event may have been cancelled,
the learner may have withdrawn, or the required pre-work may already be
complete.

## Scheduling Infrastructure

At Upskill's current scale, scheduled records in PostgreSQL polled by a
worker can be simpler than introducing a dedicated scheduling platform.

A future AWS scheduler/event service can be introduced if volume or
scheduling precision requires it.

Do not use process-memory timers for durable reminders.

## Preferences and Mandatory Communications

Not all notifications have the same preference semantics.

Distinguish:

### Transactional/operational

Examples include registration decisions, event cancellations, security
notices, and important access changes. These may be necessary to deliver
the service and may not be optional in the same way as marketing.

### Reminder/product communications

Some reminders may be configurable depending on product policy.

### Marketing

Marketing communications should remain clearly separate and follow
applicable consent/unsubscribe requirements. Do not silently reuse
transactional notification infrastructure as marketing consent.

The exact legal/privacy policy should be defined with appropriate
business/legal review.

## Provider Integration

Keep provider-specific code behind a small adapter.

Conceptually:

```text
NotificationDeliveryService
  -> EmailProviderAdapter
```

Domain code should not import the provider SDK.

Provider adapter responsibilities include request mapping, provider
message IDs, transient/permanent error classification, and
provider-specific telemetry.

This makes provider replacement/testing straightforward.

## Retry Strategy

### Transient failures

Network failures, provider throttling, and temporary provider errors
should retry with bounded backoff.

### Permanent failures

Invalid addresses, rejected payloads, or unsupported template contracts
should reach a terminal failure state rather than retry forever.

Provider-specific bounce/delivery events can update delivery status
asynchronously if needed.

## Dead-Letter and Failed Notifications

Repeated terminal failures should be operationally visible.

Support should be able to inspect:

- notification type;
- recipient reference;
- source event;
- attempts;
- last failure;
- provider ID; and
- whether replay is safe.

Do not expose sensitive template data unnecessarily in generic
operational tooling.

## Cancellation and Supersession

Scheduled notifications must be able to become irrelevant.

Examples:

- learner withdraws before an event reminder;
- event is cancelled before an ordinary reminder;
- pre-work is completed before an incomplete-work reminder;
- certificate is already downloaded, if product policy suppresses
  further reminders.

Workers should recheck current authoritative state before delivery.

Some notifications may explicitly supersede others. An event
cancellation should prevent a later "see you tomorrow" reminder.

## Event Rescheduling

Rescheduling is a good example of why notifications should consume
domain events.

The Events domain commits the new schedule and an `event.rescheduled`
event atomically. Its bounded payload identifies the explicit
registration-window policy and any new review-round/cutoff references.
Notifications then determines affected recipients, cancels or supersedes stale
reminders and sends the appropriate communication.

The event update remains valid even if the email provider is temporarily
unavailable; delivery retries independently.

## Access-Code Communications

Organisation access codes are credentials and should be treated
carefully.

Where codes are sent electronically:

- minimise recipients;
- avoid placing codes in broad operational logs;
- use appropriate template/data handling;
- record significant administrative retrieval/rotation separately; and
- consider whether secure admin retrieval is preferable to repeated
  email delivery for high-value blanket codes.

## Certificate Communications

There is no certificate-generation lifecycle or separate readiness event.
When the exact completed learning version supports a certificate, the
`enrolment.completed` communication may say that an authenticated on-demand
download is available. The download endpoint still rechecks current completion
at request time, so the message itself is not authorization.

```text
enrolment.completed
  -> completion notification with conditional certificate-download guidance
```

## Organisation and Contract Communications

Future enterprise communications may include contract-expiry warnings,
capacity thresholds, code rotation, or customer-admin invitations.

These should use organisation-authorised contacts and avoid exposing
individual learner information unless the contract/product permissions
explicitly allow it.

## In-App Notifications

An in-app inbox may become useful later, particularly for learners with
upcoming events or outstanding requirements.

If implemented, treat it as another channel/view over durable
notification state rather than building a separate unrelated alert
system.

Do not introduce it before the learner UX has a demonstrated need.

## Privacy and Data Minimisation

Notification payloads and templates should contain only data required
for the communication.

Avoid sending sensitive survey answers, excessive learner history,
access credentials, or internal administrator notes.

Queue messages should generally carry stable IDs rather than full
rendered personal content.

Rendered content retention should be bounded according to support,
audit, and privacy needs.

## Audit vs Notification History

Notification delivery history is operational/product evidence, but it is
not automatically the durable security audit ledger.

Important administrative actions that caused the notification may have
their own audit event.

For example:

```text
admin changes event schedule -> audit event
event.rescheduled -> domain event
notification delivery -> notification history
```

Keep these responsibilities distinct.

## Observability

Useful notification metrics include:

- pending scheduled notifications;
- age of oldest due notification;
- sends by type/channel;
- success/failure rate;
- retry count;
- terminal failures;
- provider latency;
- duplicate suppression count;
- bounce/rejection rate where available; and
- event-to-notification latency.

Alert on sustained terminal failure or a growing overdue notification
backlog.

## Testing Strategy

Test:

- duplicate source event produces one logical notification;
- immediate notification follows committed state only;
- scheduled reminder rechecks current state;
- cancelled/withdrawn events suppress obsolete reminders;
- provider transient failure retries;
- permanent failure terminates safely;
- template data contract rejects missing/invalid values;
- System Email publish rejects a draft that changes fixed behavior or omits a
  mandatory variable/content constraint while the prior active version remains
  usable;
- publishing a new design version leaves existing bindings/intents pinned, and
  rollback activates an immutable prior version;
- Section email placement does not affect learning progress and adjacency alone
  does not trigger delivery;
- Event Occurrence override cannot change another occurrence or a sent/terminal
  delivery;
- preview never enqueues delivery and enforces resolved-recipient scope;
- delivery history reproduces the exact version/render received after later
  profile, Event or design changes;
- wrong recipient cannot receive another learner's information;
- certificate-download guidance is included only for a qualifying completion;
- rolling deployments remain compatible with queued notification
  versions; and
- variable-contract evolution cannot remove a key referenced by published
  bindings, queued intents or retained delivery reproduction.

Use a fake/local provider adapter in automated tests rather than sending
real email.

## Domain Invariants

1.  **Notification delivery never determines the underlying domain
    truth.**
2.  **Required notification intent is created only from committed domain
    state.**
3.  **Duplicate event delivery does not create duplicate logical
    notifications.**
4.  **Scheduled reminders recheck current state before sending.**
5.  **Provider failures do not roll back already committed business
    state.**
6.  **Notification payloads minimise sensitive/personal data.**
7.  **Transactional and marketing communication semantics remain
    distinct.**
8.  **Templates consume explicit bounded data contracts.**
9.  **Terminal delivery failures become operationally visible.**
10. **Notification provider SDKs do not leak into source domain
    services.**
11. **Published Email Design Versions and sent render snapshots are immutable.**
12. **Automated Email Items never produce Learning Evidence or affect
    progress/completion.**
13. **Occurrence overrides affect only explicitly eligible unsent deliveries.**
14. **System-email content may be revised only within its code-owned behavior
    and security contract.**

## Recommended Implementation Sequence

### Phase 1 --- Email foundation

- notification table/state model; **foundation implemented**
- provider adapter interface; **implemented with local/test capture and Mailgun adapters**
- Email Designer with Offering/System catalogues, immutable publication,
  contract validation, preview and rollback; **implemented**
- seeded safe Account Setup System Email and Platform Administrator boundary;
  **implemented**
- idempotent immediate and scheduled delivery worker; **implemented for account
  setup and every authorable Course/Event communication-plan trigger**
- delivery attempt/status recording; **implemented**
- expiring one-time provisional-account activation and administrator resend;
  **implemented**
- exact version/render-snapshot persistence; **implemented for delivery records
  and privacy-bounded support history; retention controls remain pending**
- metrics and failure visibility; **implemented for database notification,
  schedule and outbox health plus production SQS age/backlog/DLQ alarms;
  provider-rate and worker-heartbeat telemetry remain pending**.

### Phase 2 --- Event communications

- registration submitted; **implemented**. Coordinator review reminders before
  the lock deadline remain a separate, not-yet-authorable communication type;
- manual/deadline regional-list lock notices to assigned Event Instance
  administrators,
  deduplicated per occurrence and region;
- final assigned-administrator confirmation; **implemented for newly selected
  affected learners; waitlist, not-selected and corrected decisions remain**
- expiring user-specific late-registration invitations and account-setup/login
  routing;
- cancellation/reschedule;
- event/session reminders; **durable `event_start`, `event_end` and
  `session_start` execution implemented**
- incomplete pre-work reminders;
- Section release and Event completion notices; **implemented for authored
  `section_release` and `event_completed` plans**. Broader follow-up message
  types remain future work;
- Section-embedded Automated Email Items, Event Template publication snapshots,
  Occurrence Communication Plans and assigned-administrator local overrides.

### Phase 3 --- Scheduling and preferences

- durable scheduled reminders; **implemented for every authorable Course/Event
  trigger through occurrence schedules or delayed notification outbox work**
- state recheck/suppression; **implemented for occurrence schedules and delayed
  learner-specific notifications, including reschedule, override, cancellation,
  registration and enrolment applicability**
- preference model where product policy requires it;
- organisation/customer communications.

### Later

- in-app notification centre;
- SMS or other channels only if justified;
- more sophisticated provider delivery/bounce processing.

## Design Checklist

For a new communication, ask:

1.  What committed domain fact triggers it?
2.  Is it immediate or scheduled?
3.  Is it transactional, reminder, or marketing communication?
4.  Who is the authoritative recipient?
5.  What minimum data does the template require?
6.  What is the idempotency key?
7.  What state must be rechecked before sending?
8.  What failures are transient versus permanent?
9.  Can it be cancelled/superseded?
10. What metric tells us it is stuck or failing?
11. Is it an Offering Email or a fixed-behavior System Email?
12. Which immutable version and rendered snapshot prove what was sent?

## Related Architecture Documents

Read this alongside Transactional Outbox and Asynchronous Work, Events
Domain, Commerce and Entitlements, Organisations and Enterprise
Contracts, Learning Domain, Roles and Authorisation, and the Domain
Model.

## Summary

Notifications should become a reusable asynchronous platform capability
rather than a collection of email calls inside business services.

Domain transactions commit facts. The outbox makes those facts reliably
available. Notifications decides communication policy, scheduling,
templates, recipients, provider delivery, retries, and operational
visibility.

This keeps checkout, events, learning, contracts, and certificates
reliable even when an external communication provider is slow or
unavailable, while giving Upskill one coherent place to evolve reminders
and learner communications.
