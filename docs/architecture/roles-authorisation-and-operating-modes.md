# Roles, Authorisation, and Operating Modes

**Status:** Living architecture document\
**Scope:** Application permissions, global capabilities, resource-scoped
assignments, operating modes, support access, and future impersonation\
**Audience:** Product, engineering, platform administrators, security
reviewers, and future contributors

## Purpose

Upskill users do not fit one mutually exclusive role. The same person
may be a learner, platform administrator, coordinator for one event, and
presenter for another.

The recommended model separates:

1.  **Capabilities** --- what a user may do.
2.  **Resource-scoped assignments** --- where that capability applies.
3.  **Operating modes** --- the focused UX used for the current job.

> **Authorisation follows capability and scope. User experience follows
> the job being performed. Multiple responsibilities must not require
> combined roles.**

## Architecture Horizons

- **Current Product:** learner ownership, explicit platform-administrator
  assignment, organisation roles and server-authorised administrator commands.
- **Target Product:** named capability vocabulary plus grant/contract Access
  Owner and regional Coordinator/Presenter assignments, with standard Platform
  Administrators recorded as shared operational owners of Event Instances.
- **Future Possibilities:** separated global support capabilities and tightly
  controlled impersonation after dedicated support inspection tools.

## Product Context

Core personas are learner, Platform Administrator, Access Owner, regional Event
Coordinator, Event Presenter, and a future highly privileged global support
administrator.

Valid combinations include an administrator who is also a learner, an
administrator coordinating one event and presenting another, or a
learner who presents a workshop. Do not create roles such as
`admin_presenter_learner`; represent each responsibility independently.

## Principles

### Roles describe responsibilities; capabilities grant actions

Human labels such as Presenter and Coordinator are useful, but security
checks should answer concrete questions such as "may this user review
registrations for this event?" or "may this user record attendance for
this session?"

### Scope matters

A coordinator for Event A does not gain coordinator access to Event B. A
presenter for one session does not gain global participant access.

### Administrative power is not operating context

An administrator may have broad support power without ordinarily acting
as a learner, coordinator, or presenter. The UI should remain focused on
the current job.

### Server authorisation is authoritative

Hidden buttons and route guards improve UX only. Sensitive reads and
writes re-evaluate authenticated identity, resource scope, and domain
state on the server.

### Authority changes must not rewrite history

Users, capabilities and assignments have different lifecycles. Ending a role or
scoped assignment removes future access but retains the stable user attribution,
assignment interval and domain records created while it was active. A former
presenter therefore remains listed on the event occurrence/session they
presented without retaining presenter access. Current authorization must never
be inferred from that historical attribution.

## Current Product

The repository already has a strong base: Better Auth owns
identity/session state; application tables own business permissions;
learner reads are ownership-scoped; administration uses explicit server
boundaries; and significant mutations are audited.

The existing organisation role ranking can remain where a genuine
organisation hierarchy exists. It should not become the universal model
for events, support, and learning operations.

## Target Product

### Global capabilities

Global capabilities apply platform-wide. Initially many may remain
bundled as `platform_admin`, but the architecture should allow later
separation of capabilities such as course management, survey/resource
management, access-grant management, event management, learner support,
audit/report access, and impersonation.

### Resource-scoped assignments

Assignments should be first-class records, for example:

```text
user -> coordinator -> event occurrence + coordination region
user (must be Platform Administrator) -> responsible administrator -> event instance
user -> presenter   -> event occurrence
user -> presenter   -> event session
user -> access owner -> access grant
user -> access owner -> enterprise contract
```

Useful assignment metadata includes user, assignment type, resource
identity, assigned-by, assigned-at, ended/revoked-at, and audit
evidence.

Assignments are ended rather than deleted when they are needed to explain
historical delivery, registration, attendance or other domain records. A
responsible-administrator assignment controls operational ownership and
notification routing only; it is not an authorization grant.

### Ownership permissions

Learners access their own enrolments, registrations, progress,
resources, and certificates because authoritative records belong to
them. Never trust a client-provided user ID as proof of ownership.

### Contextual permissions

Capability is combined with domain state. A presenter assignment may
permit attendance entry only while the session is editable; a
coordinator assignment does not necessarily permit registration
acceptance after a terminal event state.

## Learner

Learners browse offerings, purchase/redeem access, view their own
enrolments, complete learning activities, register for events, view
their own event state and history, and download eligible certificates.

Learner access is ownership-scoped. Changing an identifier must never
expose another person's learning or event data.

## Platform Administrator

Platform administrators manage courses and versions, SCORM, surveys,
resources, access grants, learner support/enrolment corrections, events,
staff assignments, registration/attendance backstops, certificates, and
administrative reporting.

Platform Administrators may use the visual learning-analytics workspace across
Courses and Events, with explicit exact-version/instance, date, completion and
current-versus-snapshotted-region filters. Chart drill-down remains an authorized
server read rather than an implication of seeing an aggregate.

They may export filtered or all-authorized versioned Course/Event CSV datasets,
including overall and Section/activity progress. Broad unfiltered export is an
explicit audited action and never includes fields outside the export contract.

A separately checkable system-communication capability permits access to the
Email Designer's protected System Emails catalogue. Within fixed code-owned
trigger, audience, required-variable and security contracts, its holder may
preview, draft, publish and roll back immutable content versions and inspect
privacy-bounded delivery history. This capability cannot disable mandatory
messages or rewrite what was already sent.

For a registration-required restricted Event, a platform administrator may use
a dedicated audited command to enter a specific person's name/email, create or
reuse the shared provisional account, and add them despite not matching the
allowed email domains. A new soft account receives the ordinary setup email and
remains unverified/not-onboarded. This does not edit the Event policy or grant
broader organisation/contract eligibility. Capacity and lifecycle rules still
apply.

Event Instance administration is part of this standard role because it requires
ordinary user-account troubleshooting, user lookup/provisioning, invitations,
registration correction and Event management. There is no separate Event
Administrator role. Any Platform Administrator retains audited backstop access.

Each Event Instance records one or more Platform Administrators as its assigned
operational owners. Those assignments drive focused dashboards, responsibility,
notifications and leave cover, but grant no authority by themselves. Assigned
administrators may jointly configure regions, receive locked lists, perform
capacity-safe final selection, invite users, inspect the Communication Plan,
publish occurrence-only eligible-unsent email overrides and apply permitted
corrections. Each action records the individual actor.

An instance assignment is usable only while its User remains a Platform
Administrator. Revoking that standard role removes access immediately while
retaining historical attribution. Published/operational instances require at
least one active assigned administrator; standard administrators can add/end
assignments through audited commands.

Standard-role revocation always takes effect immediately. Its impact workflow
ends the disabled User's owner assignments, preserves attribution, uses a
selected active replacement for sole-owner instances, and creates successor
Event Template Versions without that default administrator. If no replacement is
available, global Platform Administrator backstop keeps the Event operable while
the instance/template is flagged for urgent reassignment; revoked authority is
never restored automatically.

Administration is a job function, not an assumption that the person is
currently acting as every other persona. Sensitive/destructive actions
remain explicit and audited.

## Event Coordinator

A Coordinator operates only their assigned Event Occurrence and Coordination
Region. Every active region has one or more collaborating Coordinators for
shared responsibility and leave cover. Within scope they may review
registrations routed to their region, provisionally approve or not approve
candidates, assign optional occurrence-defined numeric priority, see relevant
capacity context, access operational contact details, monitor pre-event progress,
attendance, and post-event requirements.

Coordinator approval only advances a learner to the region's candidate list; it
does not reserve a place or confirm attendance. A Coordinator may edit decisions
and rankings until their regional list is manually locked or the occurrence's
Coordinator lock deadline is reached. They may lock the list early, which
notifies the assigned Event Instance Administrators. Once locked, only a
Platform Administrator can reopen it under the defined audited workflow.
Coordinators cannot change final administrator selection or confirmation.

Coordinator roster eligibility is recorded per Coordination Region and only
constrains who may be selected as a default for that region on new Template
Versions. A User may be eligible in multiple regions. Roster eligibility grants
no Event or participant access; that authority begins only with an active
occurrence-and-region Coordinator assignment.

Ending/revoking a Coordinator assignment or disabling its User immediately
removes future access without removing historical actions. Other assigned
Coordinators continue. A sole-Coordinator impact requires a replacement; until
resolved, the region is flagged, assigned instance administrators are alerted
and standard Platform Administrator fallback keeps the regional workflow
operable. Versioned Event Template defaults receive a successor version without
the disabled Coordinator.

The assignment does not grant access to other regions in the occurrence,
unrelated Events, general course authoring, access grants, or a global learner
directory.

Any visual analytics exposed in Coordinator mode is constrained to assigned
occurrence/regions and bounded participant fields; changing URL filters cannot
broaden that scope.

Coordinator CSV export follows the same scope: removing filters exports all rows
within assigned occurrence/regions, not all platform Event data.

## Access Owner

An Access Owner operates only the access grants and/or enterprise contracts to
which they are explicitly assigned. An assignment begins as an email invitation
record with normalized recipient, target resource, inviter, timestamps and
single-use activation state. An existing verified account can accept it; a new
person follows the future account-setup/password flow. Merely knowing the email
address or access code does not activate owner capability.

Within scope, the role may:

- view the assigned purchase or contract and covered offering;
- retrieve the applicable human-readable access code through an audited read;
- see total, used and remaining uses for capped grants, or utilisation for
  blanket coverage;
- see name, email, course/offering, bounded progress and completion state only
  for users whose access originated from the assigned source; and
- start a server-authorised capacity-extension checkout for a capped,
  customer-extendable grant.

It cannot edit grant eligibility, reduce/revoke capacity, change contract terms,
read survey answers or unrelated learning history, administer other grants, or
act as a platform/organisation administrator. Revoking the assignment removes
future dashboard access without changing learner entitlements or history.

## Event Presenter

A presenter gets a narrow delivery experience: assigned schedule/location,
attendance-oriented participant list, attendance marking, minimal offline
attendance export, and in-session prerequisite recovery. Every
presenter-required occurrence/Session supports one or more Presenters for shared
delivery and leave cover.

Within an assigned occurrence/session, a Presenter may open the time-bounded
prerequisite QR catalogue, see aggregate/incomplete status and display any
in-scope pre-session, Session or post-session Survey QR full screen. Presentation
mode contains no participant data or unrelated controls. For a participant whose
email differs from their Registration, the Presenter may use an explicit
assisted-completion command to select that participant and issue a one-survey
capability. The command is audited and reveals no unrelated learning or Survey
answers. It does not grant impersonation or a general learner session.

Presenter assignment does not grant registration approval, broad learner
history, course authoring, organisation administration, or unrelated
attendance access.

The administrative Event Staff roster is a selection constraint, not an
authorisation grant. It identifies Users who may be chosen as Presenter defaults
and records Coordinator eligibility per Coordination Region without exposing the
entire User directory in each editor. Only occurrence/session Presenter and
occurrence/region Coordinator assignments grant the narrow operating access
described above. Removing roster eligibility blocks new defaults and future
instance creation from an invalid default, but it does not erase historical
Template Versions or assignments and does not silently end an already-active
scoped assignment.

Ending/revoking a Presenter assignment or disabling its User immediately removes
future access while retaining the historical assignment and individually
attributed Attendance/recovery actions. Other Presenters continue. A sole gap
requires replacement or raises `presenter_attention_required` to assigned
standard administrators; Platform Administrator fallback keeps digital
operations accessible but is never recorded as presentation/Attendance evidence.
Versioned Event Template defaults receive a successor version without the
disabled Presenter.

## Global Support Administrator

A future global support capability is an exceptional backstop for
troubleshooting. It may permit broad inspection, authorised access
corrections, viewing role-specific experiences, and initiating
impersonation.

It should be held by very few trusted staff and should not replace
normal scoped workflows.

## Operating Modes

Operating modes are UX, not security. Suggested modes are:

- **Learning** --- personal learning/events/certificates;
- **Administration** --- platform configuration/support;
- **Assigned Events** --- standard-administrator view prioritising owned Event
  Instances, regional lock state and final attendee selection;
- **Access Management** --- assigned purchases/contracts and utilisation;
- **Coordinator** --- assigned event operations;
- **Presenter** --- assigned sessions/attendance;
- **Support / Impersonation** --- exceptional troubleshooting.

A mode never grants permission; it presents already-authorised
capabilities coherently.

A person who is both administrator and learner might see `My Learning`
and `Administration`. If also assigned as a presenter, `My Presenting`
becomes available without weakening or combining the underlying
permission model.

The current application implements this boundary as `Event operations`:
authenticated users with an active occurrence administrator, occurrence-region
Coordinator, or occurrence/Session Presenter assignment can open a focused
assigned-events list. Coordinators see and act only on registrations in their
regions; Presenters see and record attendance only in their Sessions (or their
explicit whole-occurrence scope). Platform Administrators retain broader
occurrence access; active occurrence assignments determine their focused event
list but do not preserve authority if the underlying administrator role is
revoked. Server-side assignment checks are repeated for every mutation, so
navigation visibility is not relied upon as authority.

## Permission Evaluation

A sensitive server request should:

1.  authenticate;
2.  identify the requested action;
3.  resolve the target resource;
4.  evaluate global capability;
5.  evaluate ownership where relevant;
6.  evaluate resource-scoped assignments;
7.  apply lifecycle/business constraints; and
8.  allow or reject without trusting client role state.

Conceptually:

```text
allow = globalCapability(action)
     OR ownsResource(action, resource)
     OR scopedAssignment(action, resource)
```

Domain constraints are applied in addition to this decision.

## Capability Naming and Role Bundles

Prefer action-oriented names when finer capabilities become necessary,
for example:

```text
course.manage
event.manage
event.registration.restriction_override
event.registration.review
event.attendance.record
event.attendance.export
learner.progress.read
learner.progress.override
access_grant.manage
access_grant.assigned.read
access_grant.assigned.capacity_purchase
access_grant.assigned.learners.read_status
support.impersonate
```

Do not build a generic RBAC/ABAC engine prematurely. Human-friendly role
bundles can map to these capabilities as product complexity grows.

```text
Platform Administrator
  -> broad management/support capabilities

Event Coordinator (scoped)
  -> registration review
  -> participant/event progress read
  -> attendance read

Presenter (scoped)
  -> attendance read/record/export

Access Owner (scoped)
  -> assigned grant/contract read
  -> assigned learner status read
  -> eligible capacity-extension checkout
```

Users receive the union of their valid capabilities, constrained by
resource scope and domain state.

## Impersonation

Impersonation is distinct from role/mode switching and should be treated
as highly privileged.

An impersonation session retains original administrator identity,
impersonated user identity, start/end timestamps, reason/reference where
required, request/session correlation, and durable audit evidence.

The UI must make impersonation unmistakable with a persistent banner and
prominent exit action.

Consider blocking or requiring re-authentication for especially
sensitive actions while impersonating, such as credential changes,
financial actions, or irreversible administration.

Audit records must retain the true administrator actor rather than
pretending the impersonated learner performed the action.

## Prefer Support Views Before Impersonation

Common support tasks should have dedicated admin inspection views:
enrolment state, activity progress, SCORM attempts, survey/resource
completion, event registration, attendance, and current certificate eligibility.

Use impersonation when reproducing a user-experience problem genuinely
requires acting through that user's interface.

## Data Minimisation

Permission to open a workflow does not imply permission to receive every
field.

A presenter may need participant name for attendance but not full
learning history. A coordinator may need name, email, registration
details, and event-specific progress but not unrelated enrolments.

Server read models should select only fields required for the authorised
responsibility.

## Audit Requirements

Consider durable audit evidence for global capability changes, event
staff assignments, Access Owner invitation/activation/revocation, assigned code
retrieval, capacity-extension purchase fulfilment, access/enrolment overrides,
attendance corrections, privileged exports, sensitive learner corrections,
impersonation start/end, and other security-sensitive support actions.

Operational logs and durable audit records remain separate concepts.

## Organisation Roles

Organisation roles such as owner, admin, manager, and learner may remain
where they represent a real organisation hierarchy. Do not stretch them
to represent unrelated platform/event responsibilities unless an
explicit product rule connects them.

## Server Authorisation Patterns

Prefer explicit domain-oriented helpers, conceptually:

```text
requirePlatformAdmin(user)
requireAccessOwner(user, accessGrantOrContractId)
requireEventCoordinator(user, eventOccurrenceId)
requirePresenterForSession(user, sessionId)
requireEnrollmentOwner(user, enrollmentId)
canReadEventParticipant(user, eventOccurrenceId, participantId)
```

Resolve authoritative database state inside or beneath these boundaries.
Centralise reusable policy decisions as complexity grows, but avoid
introducing a generic policy engine before necessary.

## Error Behaviour

Internally distinguish unauthenticated from unauthorised requests, while
avoiding resource-existence leaks where sensitive. Unauthorised users
should not be able to infer another learner's participation or identity
from differential error messages.

## Testing Strategy

For each sensitive capability, directly test global authorised user,
correctly scoped user, same role on wrong resource, ordinary learner,
unauthenticated request, revoked assignment, and relevant lifecycle edge
cases.

Examples:

```text
Coordinator for Event A can review Event A registration.
Coordinator for Event A cannot review Event B registration.
Presenter for Session A can mark Session A attendance.
Presenter for Session A cannot mark Session B attendance.
Access Owner for Grant A can view Grant A utilisation but not Grant B.
Access Owner cannot view a learner whose access did not originate from an assigned source.
Learner can read own enrolment but not another learner's.
Platform admin can perform documented support backstop actions.
```

## Domain Invariants

1.  **A user may hold multiple capabilities simultaneously.**
2.  **Resource-scoped assignments never silently become global
    permissions.**
3.  **Operating mode does not grant capability.**
4.  **Server-side authorisation is authoritative.**
5.  **Ownership comes from authoritative records, not client claims.**
6.  **Global administrative power remains distinguishable from routine
    scoped workflows.**
7.  **Impersonation retains the true administrator identity.**
8.  **Scoped roles receive only data needed for their responsibility.**
9.  **Role names do not substitute for domain lifecycle rules.**
10. **Permission changes and highly privileged actions remain
    auditable.**
11. **An invited email is not an active Access Owner until verified account
    activation binds the assignment.**
12. **Administrator, Coordinator and Presenter revocation removes future access
    immediately without erasing attribution or stranding owned operational
    scopes.**

## Recommended Implementation Sequence

### Now

- Preserve current platform-admin and learner ownership boundaries.
- Document explicit permission checks around existing server
  functions.
- Avoid adding mutually exclusive `user.role` assumptions.

### Events implementation

- Add Event Instance operational-owner records restricted to standard Platform
  Administrators, plus occurrence-and-region Coordinator and occurrence/session
  Presenter assignments.
- Add versioned Event Template administrator/Coordinator defaults, multi-owner
  and Presenter defaults, multi-owner/required-scope coverage checks and
  revoke/replace/successor-version workflows.
- Add resource-scoped server authorisation helpers and matrix tests.
- Build focused assigned-Event/Coordinator/Presenter operating views.
- Apply field-level data minimisation.

### Next

- Add invitation-backed Access Owner assignments and the narrow Access
  Management dashboard with scope-matrix tests.
- Add webhook-fulfilled capacity-extension checkout only for eligible capped
  grants.
- Introduce capability names as complexity justifies them while
  keeping human-friendly bundles.
- Add role/capability administration only when product needs require
  finer delegation.
- Add dedicated support read models.

### Later

- Introduce global support/impersonation only with strong audit and UX
  safeguards.
- Consider a more formal policy layer only if explicit helpers become
  difficult to reason about.

## Design Checklist

For a new protected feature, ask:

1.  What exact action is being authorised?
2.  Is permission global, ownership-based, or resource-scoped?
3.  What resource defines the scope?
4.  What domain lifecycle conditions also apply?
5.  What fields does the user genuinely need?
6.  Does an administrator require a support backstop?
7.  Should the action be audited?
8.  What happens when an assignment is revoked?
9.  Have wrong-resource and unauthorised cases been tested?
10. Is the UI merely reflecting permission rather than defining it?

## Related Architecture Documents

Read this alongside the Project Overview, Domain Model, Commerce and
Entitlements, Learning Domain and Activities, Events Domain,
Transactional Outbox, and Product Architecture Review.

Significant changes to global permissions, scoped assignments, operating
modes, or impersonation should update this document and, where
appropriate, an ADR.

## Summary

Upskill should not force people into one permanent role. The product's
real-world responsibilities overlap.

The durable model is a hybrid: broad global capabilities where justified,
ownership-based learner access, resource-scoped Coordinator/Presenter
assignments, standard-admin Event Instance responsibility records, and focused
operating modes that keep the interface understandable.

This gives administrators the backstop power needed to support the
platform while keeping day-to-day learner, coordinator, and presenter
workflows appropriately narrow and secure.
