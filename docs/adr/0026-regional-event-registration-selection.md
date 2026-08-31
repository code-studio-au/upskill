# ADR 0026: Regional Event registration review, lock-in and late invitations

## Status

Accepted and implemented, including regional review/lock notifications and
expiring user-specific late invitations.

## Context

Large Event Occurrences may recruit across a state, country or several
countries. One coordinator cannot fairly or practically review every
registration. Current delivery may, for example, assign one Coordinator to each
NSW Health Local Health District (LHD), while another customer may use states,
countries or its own service areas.

The operational process has two distinct approval layers. Regional Coordinators
approve candidates within their area and optionally rank the approved candidates
when demand exceeds capacity. A standard Platform Administrator assigned to the
Event Instance then selects the final attendees across all regional candidate
lists. Calling both transitions
"acceptance" obscures who owns capacity, when a place is actually confirmed and
which decisions are still editable.

Ordinary registration and regional review also have different deadlines. Late
registration must be possible for a specifically invited person without
reopening a public registration form or silently modifying an already locked
regional list.

## Decision

### Occurrence-scoped regions and staff

Upskill will model a configurable hierarchical **Coordination Region** taxonomy.
It may represent country, state/territory, LHD, district or a customer-defined
area; NSW LHD values are configuration, not schema or authorization concepts.

An Event Occurrence selects the applicable regions and assigns one or more
Coordinators to each. Coordinators assigned to the same region collaborate on
one occurrence-and-region review list. The occurrence also has one or more
standard Platform Administrators assigned as **Event Instance Administrators**
responsible for the cross-region decision and shared operational cover. This is
an ownership assignment, not a separate authorization role; any Platform
Administrator retains an audited backstop under ADR 0028.

A user's current region is captured during onboarding and may be updated when
they move. Registration submission requires the learner to select one of the
occurrence's offered regions and stores that choice as the immutable
**Registration Region Snapshot** used for Coordinator routing. The live profile
region is a comparison signal, not an authorization boundary: a learner with no
profile region or with a region outside the occurrence may still select an
offered registration region. Later profile changes affect future registrations
only. An assigned Event Instance
Administrator may explicitly reassign a still-active Registration when the
snapshot was wrong; this retains the old and new region, actor, time and reason
category in audit evidence. Assigned Coordinators can see a current-profile
mismatch on registrations in their own list, but cross-region movement remains
administrator-only. The administrator may instead acknowledge that the
Registration Region Snapshot remains correct; that decision is retained and
becomes stale automatically if the live profile region changes again.
Moving the snapshot to the live profile region is also retained as a confirmed
region-review decision. Both outcomes remain reviewable and are presented as
resolved region decisions rather than as another administrator-review warning.
When the live profile has no region, the administrator may instead confirm the
Registration as a **region guest**. When the live profile belongs to a region
outside this occurrence, the administrator may confirm an **outside-region
guest**. Both decisions retain the selected Registration Region Snapshot and its
Coordinator decisions; they separately snapshot the attendee's reporting
classification and current region identity. Alternatively, the administrator
may explicitly update the learner profile to the registered region; that
audited profile change applies to future registrations as well.

Attendance and completion reporting uses the retained reporting classification,
not the mutable current profile. It can therefore group attendees under an
offered Event region, an outside operational region (including its parent Region
Group), or **No region guest**, while preserving which regional Coordinator list
processed the Registration. A later administrator decision supersedes the
current reporting decision without deleting its history.

Moving a non-final Registration into an already locked destination list
requires a separate explicit confirmation. The system clears the prior
Coordinator decision and priority, records that regional review was waived and
routes the Registration directly to the assigned Event Instance Administrator's
final attendee-selection queue. This pending final decision is separate from
the already confirmed region decision. It does not silently reopen either
regional list. A finalised
Registration uses the existing exceptional confirmation and retains its final
decision and Learning/Attendance evidence.

Every active occurrence-region has one or more active Coordinators so work can
be shared and covered during leave. Each Coordinator action retains its
individual actor. Any assigned Coordinator may review/rank and, subject to the
normal confirmation control, lock their shared regional list; one Coordinator's
absence does not create a separate list or stop the others.

Ending/revoking an assignment or disabling a Coordinator immediately removes
future access but never erases their prior decisions, rankings, lock actions or
assignment interval. Other active Coordinators continue unchanged. For a
sole-Coordinator region, the impact workflow assigns the selected replacement or
flags `coordinator_attention_required`, notifies the assigned Event Instance
administrators and permits standard Platform Administrator fallback so the
region is never stranded. Future instance creation requires valid configured
coverage.

Where that Coordinator is a default in current Event Template Versions, the
workflow publishes a successor version removing the disabled default and adding
the selected replacement where required. Older versions and existing instance
provenance remain immutable. Existing drafts must rebase before publication.

### Regional review and ranking

For an occurrence using regional selection, the workflow is:

```text
registration submitted
  -> assigned to snapshotted regional review list
  -> coordinator approved | coordinator not approved
  -> regional list locked (manual | deadline)
  -> assigned administrator selected | waitlisted | not selected
  -> confirmed and locked in
```

Coordinator approval means only that the learner advances as a candidate from
that region. It does not reserve capacity, grant participant access or send the
final Event confirmation. Only Coordinator-approved registrations advance to
final administrator selection. If a region approves nobody, its candidate list
is valid and empty.

A Coordinator may assign an approved candidate a nullable integer priority
score. Larger values mean higher priority. Each occurrence publishes the scale
and ranking guidance so scores can be compared across regions. Ranking is
optional: an approved candidate with no score remains eligible but is clearly
shown as unranked. The review UI sorts scores descending and applies stable
tie-breaking for display, but does not convert that ordering into an automatic
entitlement to a place.

### Registration and regional lock deadlines

Each occurrence records both deadlines in its explicit timezone:

- `registrationClosesAt` ends ordinary public registration; and
- `coordinatorLockAt`, normally later, ends regional review and ranking.

An assigned Coordinator may manually lock their regional list before the second
deadline. This freezes the current decisions and rankings and emits an
idempotent notification to all assigned Event Instance Administrators. At
`coordinatorLockAt`, every still-open regional list is server-effectively locked
with source `deadline`; a worker may materialize and notify that transition, but
worker delay cannot leave the list editable. Missing rankings remain null and
unreviewed registrations do not become approved. A Coordinator who approved
nobody therefore submits an empty approved list.

After a regional list is locked, its Coordinators cannot edit it. Before final
attendee confirmation, an assigned Event Instance Administrator may use an explicit audited
reopen/correction command when operationally necessary. Deadline and display
logic use the occurrence timezone with the reject-on-ambiguity
daylight-saving policy defined by [ADR 0032](0032-typed-time-model.md).

### Rescheduling and registration windows

Rescheduling an occurrence requires an explicit registration-window choice. The
authorized administrator may:

- leave registration and Coordinator deadlines unchanged;
- replace still-future deadlines with explicitly reviewed dates; or
- reopen registration with a new `registrationClosesAt` and later
  `coordinatorLockAt`.

The command validates deadline order, occurrence timezone and lifecycle/capacity
constraints and records the chosen policy with the schedule change. It never
reopens registration merely because Session dates moved.

The same reschedule workflow requires the administrator to reconfirm regional
coverage and Coordinator assignments. They may retain the current regions, add
regions that the new schedule/location makes eligible, or retire regions from
future submissions. Each active region must have an explicit review owner or be
deliberately assigned to standard Platform Administrator fallback; it cannot be left
silently unstaffed.

When registration is reopened, the new Regional Review Round snapshots its
applicable regions and Coordinator assignments. Newly added regions receive new
lists under the new deadlines. Retiring a region prevents new routing to it but
does not delete its earlier list, decisions, candidates or confirmed attendees.
Moving an existing active candidate between regions remains an explicit retained
reassignment. To accept ordinary registrations from newly added regions, the
administrator must choose the reopen option; changing regional coverage alone
does not bypass a closed registration window.

Retiring a region therefore requires an explicit disposition for existing
Registrations in that Region Snapshot:

- **future registrations only** preserves pending/final decisions and all
  confirmed participants; or
- **cancel affected registrations** applies an explicit participant-level
  cancellation to selected or all affected Registrations.

The reschedule review shows affected counts and requires confirmation before the
second option. Confirmed learners then see **Registration cancelled** on the
Event in their dashboard, not **Event cancelled**, because the occurrence may
continue in other regions. Future Event/meeting access is withdrawn according to
cancellation policy, while prior registration, completed learning, Attendance
and decision evidence remain retained. Cancellation sends an idempotent notice.
Re-adding the region does not silently reinstate anyone; reinstatement is a
separate capacity-safe, audited action.

If regional lists have not yet locked, reviewed future deadlines may extend the
current review period. If any list has locked or final selection has begun,
reopening creates an additional regional review round for newly submitted or
explicitly carried-forward candidates. It preserves earlier lists, rankings,
decisions and already confirmed attendees. New candidates use fresh regional
lists and the new Coordinator lock deadline; final selection allocates only
remaining/released capacity. Reopening does not revoke confirmations, silently
unlock an old list or turn prior not-selected candidates back into candidates.
Those actions require explicit retained choices.

Affected staff and learners receive communications describing the new schedule,
whether registration reopened, applicable coverage/assignment changes and the
new cutoffs. Scheduled reminders are cancelled/recomputed idempotently from
current authoritative state.

### Cross-region final selection

The assigned Event Instance Administrators receive a consolidated view of all
locked regional lists, including region, coordinator decision, priority score or
unranked state, submission time and total remaining capacity. The normal policy
is to consider ranked approved candidates by descending numeric priority across
regions, then use documented human judgement for ties, unranked approved
candidates and best-fit allocation of remaining places.

Final selection is an accountable human decision, not an opaque automated
ranking algorithm. The database transition is capacity-safe and records the
actor and decision source. Selected registrations become confirmed and locked
in, materialize Event participation/access and trigger one confirmation message
with the exact dashboard Event link. Other candidates enter explicit waitlisted
or not-selected states. Coordinators cannot change a final decision; an assigned
assigned Event Instance Administrator or another Platform Administrator acting
as backstop may make a later audited correction under defined lifecycle and
capacity rules.

### User-specific late registration invitations

After ordinary registration closes, an assigned Event Instance Administrator may
create a user-specific **Late Registration Invitation** rather than reopening a generic
public form. The administrator selects an existing User or enters name/email
through the shared idempotent soft-account provisioner. The invitation is
high-entropy, expiring, single-use and bound to the occurrence and intended
identity. Its message directs the recipient to account setup or login; once
authenticated and onboarded as required, the invited Event is visible on their
dashboard and they complete the normal registration details.

The invitation bypasses only `registrationClosesAt`. It does not bypass domain
eligibility, capacity, cancellation or final selection. A mismatched restricted
Event requires the separate learner-specific restriction override. Because
regional lists may already be locked, a late registration enters an explicit
assigned-administrator-owned late-candidate queue with its own region snapshot. It
is never silently inserted into or used to reopen a regional list. The Event
assigned administrator may seek regional advice, but owns the late decision.

## Consequences

Regional teams can recruit and assess the people they know while one assigned
assigned standard administrators retain accountable control of scarce capacity. Deadlines
remain effective even if a worker is delayed, rankings remain useful without
becoming an unexplained algorithm, and learner moves do not rewrite historical
selection evidence. Late access becomes traceable and user-specific instead of
reopening an uncontrolled public registration path.

The target domain requires Coordination Regions, occurrence-region assignments,
regional review lists, retained decision transitions, priority scores, Event
instance administrator assignments, deadline enforcement and late invitations.
Those assignments use the standard Platform Administrator role and versioned
Event Template defaults under ADR 0028. ADR 0025
continues to govern staged Section release after final confirmation; this ADR
refines its registered-Event finalisation boundary.
