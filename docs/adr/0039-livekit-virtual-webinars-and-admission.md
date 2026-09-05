# ADR 0039: LiveKit Cloud virtual webinars, controlled admission, recording and connection attendance

- **Status:** Accepted; Slices 1–3 implemented, later slices pending
- **Date:** 2026-08-31

## Context

Upskill currently models virtual Event Occurrences and Event Sessions by storing
an external join URL. Registered learners and open-entry guests can receive that
URL at the appropriate point in the existing event flow. This is suitable for an
externally hosted meeting, but it cannot provide an application-owned waiting
room, presenter admission, narrowly scoped participant permissions, reliable
session lifecycle controls, or connection-derived attendance evidence.

The virtual-event feature must support webinar delivery without weakening the
existing Event registration, selection, prerequisite, role, privacy, audit, and
historical-evidence boundaries. In particular:

- clicking a link early must not connect an attendee to the webinar or disclose
  reusable meeting credentials;
- presenters need a private place to test devices before the attendee room is
  opened;
- a registered attendee who cannot sign in must be able to prove control of the
  email address or verified mobile number already associated with their Event
  participation;
- presenters must be able to admit attendees manually or enable automatic
  admission;
- LiveKit connection evidence may assist attendance administration, but a
  connection alone is not proof that a person was attentive; and
- the browser must continue to satisfy Upskill's strict CSP, static styling,
  accessibility, responsive-layout, authorization, and bundle-budget rules.

Upskill will use LiveKit Cloud for WebRTC media transport and managed Egress.
Upskill owns the event workflow, admission decisions, identity recovery,
recording policy, attendance policy, and durable evidence; LiveKit Cloud owns
the room media plane, connectivity infrastructure, capacity, and recording
execution.

## Decision summary

Upskill will add `livekit` as an explicit virtual-delivery provider while
retaining the existing external-URL provider. The delivery value represents the
application contract rather than a reusable provider URL; the accepted initial
service is LiveKit Cloud with separate projects and credentials for each
environment. A LiveKit room maps to one exact Event Session, not to the whole
Event Occurrence.

The feature has two deliberately separate pre-session experiences:

1. The **attendee lobby** is an Upskill page. Entering it creates no LiveKit
   connection and reveals no LiveKit URL, room name, API credential, or join
   token. It supports normal authentication and narrow passwordless recovery.
2. The **presenter green room** is a LiveKit connection available only to an
   assigned Presenter or authorised administrator within a bounded preparation
   window. It permits device checks and presenter coordination before attendees
   are admitted.

An attendee may receive a short-lived LiveKit join token only when all three
server-side predicates are true:

```text
eligible for this Event Session
AND admitted to this room generation
AND meeting door is open
```

The token endpoint re-evaluates all three predicates on every issuance. UI
state, a previously viewed page, a lobby capability, a scheduled time, or a
client-supplied role is never sufficient by itself.

The initial audience format is a webinar: attendees subscribe to presenter
media but cannot publish camera, microphone, screen share, or arbitrary data.
Presenter publishing and moderation are separately authorised. Policy-controlled
composite recording is included through managed LiveKit Cloud Egress.
Interactive meetings, attendee publishing, persistent chat, breakout rooms, and
end-to-end encryption are deferred decisions.

## Terminology and boundaries

- **Event Occurrence:** the scheduled delivery of an Event Template for a
  selected cohort.
- **Event Session:** one scheduled segment within an occurrence. Each LiveKit
  room belongs to exactly one session.
- **Room generation:** an immutable incarnation of a session room. Revoking or
  replacing a room creates a new generation so old capabilities and tokens
  cannot be reused against the replacement.
- **Meeting door:** the application-owned lifecycle controlling attendee token
  issuance: `scheduled`, `open`, `locked`, or `ended`.
- **Lobby entry:** the attendee's durable, server-authorised request to join one
  room generation.
- **Admission:** permission for an eligible lobby entry to receive an attendee
  token while the meeting door is open.
- **Green room:** an early LiveKit connection for assigned presenters and
  authorised administrators. It is not the attendee lobby.
- **Join capability:** an opaque, short-lived Upskill session established after
  passwordless verification. It is not a LiveKit token.
- **Join token:** a short-lived LiveKit JWT generated only after the complete
  token gate succeeds.
- **Connection evidence:** append-only intervals derived from LiveKit participant
  activity and reconciliation. It is not, by itself, proof of attention.

## Product scope

The first complete slice includes:

- LiveKit Cloud webinar delivery for an exact Event Session;
- an opaque attendee lobby link;
- authenticated and passwordless attendee lobby access;
- an explicit meeting-not-started state enforced by the token backend;
- a presenter green room and device preview;
- manual, bulk, and automatic attendee admission;
- start, lock, reopen, and end controls;
- subscribe-only attendee grants and publisher presenter grants;
- automatic connection capture and configurable attendance promotion;
- webhook ingestion plus provider reconciliation;
- optional managed composite recording to private application-controlled
  storage, including consent, status, retention, and access controls;
- administrator authoring, operational oversight, audit, and provider health;
- backward-compatible external virtual URLs; and
- focused operational metrics, alerts, and recovery paths.

The initial implementation does not include:

- recording transcription, AI summaries, editing, or public recording links;
- attendee camera, microphone, screen share, hand raising, reactions, or chat;
- breakout rooms, SIP, external livestreaming, or AI participants;
- application-operated media nodes, custom media routing, or provider-region
  failover controls;
- end-to-end media encryption and its application-owned key distribution;
- a general anonymous meeting product outside the Event participation model; or
- Server-Sent Events (SSE) for lobby updates. SSE is a one-way persistent HTTP
  stream from server to browser; bounded polling is simpler for the initial
  admission queue and can be replaced later without changing the state model.

## Cross-cutting impact matrix

The implementation uses the repository's cross-cutting feature delivery
workflow. The following matrix is the durable inventory for capability-granting
entry points and evidence consumers. Each implementation pull request updates
the applicable rows and names the authoritative test that proves them.

| Actor or entry path                                                            | Qualification and scope                                                                                         | Expected server outcome                                                                                                                                                 | Downstream effects and primary proof                                                            |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Selected learner from the Event workspace, notification, or opaque direct link | Active participation, selected registration, completed registration questionnaire and exact-session eligibility | Enter the application lobby; issue a token only after admission while the door is open                                                                                  | Workspace and notification links resolve to the same policy; pure policy and browser journey    |
| Learner with an incomplete registration questionnaire                          | Active participation but incomplete questionnaire                                                               | Redirect directly to the required registration form; do not create room access                                                                                          | Registration remains the prerequisite authority; server integration and learner browser journey |
| Early or pre-admitted learner                                                  | Otherwise eligible, but the door is `scheduled`                                                                 | Return `meeting_not_started`; reveal no provider URL, room name or token                                                                                                | Lobby may show admission readiness without connecting; policy and response-shape tests          |
| Passwordless learner                                                           | Control of the verified email or verified E.164 mobile already bound to the exact participation                 | Issue a narrow lobby capability, never a general authenticated session                                                                                                  | Lobby status and attendee-token requests only; recovery boundary and adversarial tests          |
| Eligible open-entry guest                                                      | Session policy permits guests and the provisional participation is valid                                        | Provision or resume participation, then use the same lobby and token policy                                                                                             | No guest bypass of capacity, consent or session qualification; database and browser tests       |
| Assigned Presenter                                                             | Active exact-session assignment, including an active whole-occurrence assignment resolved to that session       | Permit the green room during the preparation window and exact-session operations                                                                                        | Presenter token and moderation remain server-authorised; policy and presenter browser tests     |
| Occurrence or Platform Administrator                                           | Existing occurrence administration scope or audited platform backstop                                           | Permit operational oversight and exact-session controls; never impersonate an attendee                                                                                  | Audit every mutation; authorization integration tests                                           |
| Coordinator                                                                    | Existing region-scoped Event operations authority                                                               | Preserve registration and attendance operations, but grant no LiveKit admission, moderation or presenter token unless separately assigned as Presenter or Administrator | Existing coordinator behaviour remains intact; negative authorization tests                     |
| Withdrawn, cancelled, terminal or no-longer-eligible attendee                  | Participation or occurrence is no longer eligible                                                               | Revoke lobby access, deny token reissuance and remove an active participant when policy requires                                                                        | Preserve revocation and provider-operation evidence; lifecycle and concurrency tests            |
| Forged, stale or cross-scope reference                                         | Participation, session, generation or public reference does not match                                           | Return an enumeration-safe denial with no cross-scope disclosure                                                                                                        | No credential or resource leak; adversarial policy and database tests                           |
| Duplicate, delayed or out-of-order provider event                              | Valid provider signature and exact known room/generation scope                                                  | Accept idempotently even when new token issuance has stopped or the meeting has ended                                                                                   | Append-only connection and recording evidence; webhook and reconciliation tests                 |
| Provider outage, quota failure or interrupted operation                        | The application decision remains authoritative but the media mutation cannot complete                           | Preserve lobby/operational state, return a typed retryable failure and reconcile later                                                                                  | No fallback credential exposure or duplicated mutation; provider-fake and failure-drill tests   |

The matrix deliberately separates capability authorisation from provider
evidence. Attendance, recording reconciliation, audit projection and reporting
must not re-run the join-token policy because their retry and lifecycle rules
continue after admission and token issuance have ended.

## Event configuration and publication

### Delivery provider

A virtual occurrence selects one delivery provider:

- `external_url` preserves the current behaviour; or
- `livekit` enables the managed LiveKit Cloud workflow in this ADR.

Existing virtual occurrences are backfilled to `external_url` and are never
silently converted. In-person occurrences have no virtual provider. Published
Event Template versions and their contractual snapshots remain immutable.

LiveKit policy defaults are authored with the versioned template session and
snapshotted into each exact occurrence session. Operational changes that are
expected during delivery, such as switching admission mode, are recorded
against the room generation with actor, timestamp, previous value, and reason.
They do not rewrite the template snapshot.

### Initial session policy

Each LiveKit-backed session captures:

- admission mode: `manual` or `automatic`;
- attendance mode: `manual`, `automatic_check_in`, or
  `automatic_duration`;
- the minimum connected minutes when duration promotion is enabled;
- a presenter preparation-window duration, initially 60 minutes;
- attendee rejoin grace after a door lock;
- room capacity including presenter and administrative headroom;
- whether eligible open-entry guests may use the lobby;
- recording mode: `off` or `automatic`, defaulting to `off`; and
- the recording retention duration when recording is enabled.

Automatic admission is the normal webinar default. Manual admission is
available for private, sensitive, or tightly moderated delivery. Recording
defaults to off. Attendance thresholds and recording policy become fixed when
the meeting is started so a later edit cannot rewrite the rules under which
evidence or media was gathered.

### Room creation

Room metadata is prepared when the occurrence is scheduled, but provider room
creation is lazy and idempotent. The server explicitly creates the room when an
authorised presenter enters the green room or starts the meeting. The room name
is opaque, environment-specific, unique, and contains no learner, organisation,
Event, email, or phone data.

The room's maximum-participant setting includes the published capacity plus a
bounded staff allowance. Capacity in LiveKit is a safety backstop; Upskill's
selection, registration, withdrawal, cancellation, waitlist, and eligibility
rules remain authoritative.

## Meeting and admission state models

### Meeting door

The server owns the following transitions:

```text
scheduled --start--> open --lock--> locked --reopen--> open --end--> ended
scheduled ----------------------------------------------------end--> ended
```

- `scheduled`: the learner sees “Meeting has not started”. No attendee join
  token can be issued, even after admission or the scheduled start time.
- `open`: admitted eligible attendees may obtain a token and explicitly join.
- `locked`: no first-time attendee joins are allowed. A previously connected,
  still-admitted attendee may rejoin within the configured short grace period.
- `ended`: attendee and presenter token issuance stops and final attendance
  reconciliation begins. The state is terminal for that room generation.

Only an assigned Presenter for the exact session, an authorised occurrence
administrator, or a Platform Administrator backstop may perform these
transitions. Starting, locking, reopening, and ending are audited operations.
Scheduled timestamps inform the UI but never automatically open the door.

An accidental or failed generation is not resurrected. An administrator may
perform an explicit audited recovery that ends the old generation, creates a
new generation, and invalidates every old lobby capability and token binding.

### Lobby entry

A lobby entry progresses through these meaningful states:

```text
waiting -> admitted -> token_issued -> connected -> left
   |          |             |
   +-------> declined <------+-----> revoked
```

The stored state supports operational display, but authoritative eligibility,
door state, and token expiry are always rechecked. A person may be pre-admitted
while the door is `scheduled`; this changes the lobby state but does not issue a
token. The learner sees that admission is ready and continues to see “Meeting
has not started” until a presenter opens the door.

Withdrawal, cancellation, lost selection, revoked access, or a room-generation
change revokes the lobby entry. Declining a lobby request does not mutate the
person's historical registration or participation record.

### Admission modes

In `manual` mode, a presenter may admit one attendee, admit a selected group,
admit all currently eligible waiting attendees, or decline a request. Each
operation performs eligibility checks within the transaction and records its
actor and outcome.

When an authorised presenter enables `automatic` mode:

1. all currently waiting and still-eligible entries are admitted in bounded,
   transactional batches; and
2. future eligible lobby entries are admitted when created.

Automatic admission never admits withdrawn, cancelled, waitlisted, ineligible,
or otherwise unauthorised participants. Toggling the mode is audited and does
not itself issue LiveKit tokens while the door is closed.

## Learner and attendee experience

### Link and arrival

Invitations, dashboards, and Event workspaces expose an opaque lobby URL rather
than a provider room URL. It contains a high-entropy public reference and no
database identifier, email address, phone number, LiveKit room name, or token.
The public reference is revocable and bound to one exact Event Session and room
generation.

Opening the URL displays Event name, session name, scheduled date/time in the
Event time zone and Australian display format, a privacy notice, accessibility
information, and a status panel. Before identity is established it does not
reveal whether a supplied email address or phone number is registered.

### Normal authenticated flow

1. A signed-in user opens the lobby link.
2. The server resolves the opaque reference and checks the user's exact Event
   participation, current selection, registration state, and session access.
3. The server creates or resumes an idempotent lobby entry for the current room
   generation.
4. The user performs a browser device/network preflight that does not connect to
   LiveKit. For the subscribe-only webinar this checks audio output and browser
   support without requesting camera or microphone permission.
5. The lobby shows one of: not yet eligible, meeting not started, waiting for
   admission, admitted and waiting for start, ready to join, doors locked,
   meeting ended, or an actionable provider/service error.
6. If recording is enabled, the attendee reviews and acknowledges the recording
   notice. No token is issued without the required acknowledgement.
7. When the door is open and the entry is admitted, a clearly labelled **Join
   webinar** control becomes available. Upskill does not auto-connect merely
   because state changed.
8. Activating the control calls the token endpoint. The server rechecks every
   condition and returns a short-lived, single-purpose LiveKit token.
9. The attendee client is loaded lazily, connects, and presents presenter media
   with accessible audio controls, captions controls when provider tracks make
   them available, connection status, reconnect feedback, a persistent recording
   indicator when applicable, and a leave control.
10. Leaving returns the attendee to the Upskill lobby, where rejoin eligibility
    is evaluated again.

### Passwordless recovery flow

Normal authentication remains preferred. Recovery exists for a registered
attendee who has trouble signing in; it does not create a general bearer link
or confer staff capabilities.

1. The attendee chooses email or SMS recovery and supplies the identifier.
2. The server returns the same enumeration-safe response whether or not an
   eligible participation exists.
3. Email delivery is allowed only to the email already bound to the exact
   participation or stable user identity. SMS delivery is allowed only to an
   existing verified E.164 mobile number. A typed phone number is not treated as
   verified merely because the requester can receive a code on it.
4. A rate-limited, six-digit, one-use OTP is delivered. Only digests of the OTP,
   request identifier, and target identifier are stored. Attempts, resends,
   expiry, delivery outcome, and consumption are bounded and audited without
   logging the code or destination.
5. Successful verification issues an opaque join capability in an `HttpOnly`,
   `Secure`, `SameSite=Lax` cookie restricted to the lobby route. The initial
   lifetime is 30 minutes with a 10-minute idle limit, matching the existing
   Event task-access pattern.
6. The capability is bound to the exact Event Session, Event participation,
   user when one exists, public lobby reference, and room generation. It permits
   lobby status and attendee-token requests only.
7. The capability establishes control for this join task. It does not silently
   verify or change the user's durable account email/mobile status and cannot be
   exchanged for a normal login session.
8. A consumed, expired, idle, revoked, or generation-mismatched capability must
   be verified again.

The LiveKit JWT is returned only after admission and start. It remains in
browser memory and is never placed in a URL, HTML document, log, analytics
event, local storage, or persistent application database.

### Open-entry guests

An administrator may allow the existing open-entry guest workflow to target a
LiveKit lobby. The guest must first complete the existing name, email, privacy,
and provisional-participation flow. The lobby labels this access as unverified
unless the configured email/SMS recovery step has also succeeded.

Guest admission is a separately configurable policy and is off by default for
manual/private webinars. Open-entry access never bypasses capacity, session
state, privacy acknowledgement, room generation, or admission checks.

### Early, locked, ended, and failure behaviour

- Before presenter start, the response contains no provider credentials and the
  page says the meeting has not started.
- A recording-enabled session displays its notice before admission or join and
  never treats consent as implied by merely opening the lobby link.
- If admitted before start, the attendee can see that they are approved but
  still cannot join.
- While waiting for manual admission, the page refreshes status with bounded
  polling, initially every 3–5 seconds with background-tab backoff and jitter.
- If the door is locked, a first-time attendee cannot join. A previously
  connected attendee receives only the configured rejoin grace.
- If the meeting ends while connected, the provider room is closed and the
  learner returns to a completed-session state.
- If provider creation or token issuance is unavailable, the UI preserves the
  lobby position, shows a retryable message, and does not reveal an emergency
  external URL unless an administrator explicitly switched providers before
  start.

## Presenter experience

### Access and preparation

Presenters use normal authenticated accounts. Passwordless attendee recovery
can never grant presenter, moderation, or administrative access. The server
requires an active Presenter assignment for the exact Event Session on every
operation; occurrence-wide or template-wide visibility alone is insufficient.

Within the configured preparation window, the presenter workspace shows:

- session schedule and delivery status;
- provider readiness and any region/connection warning;
- an **Enter green room** action;
- camera, microphone, speaker, and screen-share checks;
- other connected presenters and authorised administrators;
- the attendee lobby queue and admission mode;
- recording policy and current recording state; and
- explicit start, lock/reopen, and end controls.

Entering the green room lazily creates the provider room when needed and issues
a short-lived presenter token. A presenter may publish camera, microphone, and
screen tracks and subscribe to room media. The browser token does not receive
LiveKit room-administration grants. Kicking a participant, closing a room, or
other moderation calls go through an Upskill server function that repeats
authorization and invokes the provider Room Service API server-side.

### Starting and operating the webinar

1. The presenter confirms the correct exact session and enters the green room.
2. Device checks happen without exposing presenter media to attendees because
   no attendee token can yet be issued.
3. In manual mode, attendees appear in the queue with the minimum information
   needed to identify their Event participation and eligibility. Sensitive
   contact details are not displayed unless an existing role permits them.
4. The presenter admits attendees individually, by selection, or with **Admit
   all eligible**; alternatively they enable automatic admission.
5. The presenter activates **Start webinar** and confirms the action. The server
   transactionally changes `scheduled` to `open`, records the actor and time,
   makes tokens obtainable for admitted attendees, and idempotently starts the
   managed recording when the session policy requires it. Recording never
   starts merely because a presenter entered the green room.
6. During delivery, the presenter sees lobby counts, admitted/connecting/
   connected/disconnected states, connection duration, attendance-policy
   qualification, and reconciliation warnings.
7. **Lock doors** prevents new first-time connections. **Reopen doors** resumes
   normal admission/token rules.
8. **End webinar** requires confirmation. It makes the generation terminal,
   stops new token issuance and any active recording, closes the provider room
   through idempotent server operations, and triggers final attendance and
   recording reconciliation.

The presenter can remove a connected attendee only through an audited server
operation. Removal revokes the attendee's lobby admission for the current
generation before disconnecting the provider participant, preventing immediate
token reissuance.

### Presenter loss and handover

Multiple assigned presenters may enter the green room and operate the session.
The room does not automatically end when one presenter disconnects. A newly
assigned replacement presenter gains access only after the normal resilient
staff-coverage workflow has created the exact assignment. An authorised
administrator can act as the operational backstop, with every intervention
attributed in the audit history.

## Administrator experience

### Authoring and scheduling

The versioned Event Template session editor adds a virtual-delivery policy with
shared controls and validation for:

- external URL or LiveKit Cloud;
- manual or automatic admission;
- attendance mode and, when applicable, minimum connected minutes;
- presenter preparation and attendee rejoin windows;
- expected capacity and staff headroom; and
- whether open-entry guests may request admission;
- recording off/automatic policy and retention duration; and
- the required attendee and presenter recording notice.

Occurrence scheduling snapshots these policies into each exact session. The
editor explains that LiveKit is a webinar in the first release and that
attendees cannot publish media. Validation prevents publication when LiveKit is
not configured for the environment, capacity exceeds the supported plan, a
duration threshold exceeds the scheduled session duration, or the occurrence
lacks an eligible Presenter/administrator coverage path.

### Operational workspace

An authorised occurrence administrator receives the same live operational
panel as a presenter plus:

- provider-room creation and health state;
- current generation and lifecycle timestamps;
- admission-policy changes and actor history;
- token-denial reason counts without token values or attendee contact details;
- webhook receipt lag, duplicate handling, and reconciliation state;
- room capacity and connected participant counts;
- attendance evidence, automatic decisions, and manual corrections;
- recording state, storage completion, retention deadline, and access history;
- explicit recovery by replacing a failed room generation; and
- an audited pre-start switch to a configured external URL.

The emergency external-URL switch is allowed only before the LiveKit meeting is
opened. It is never automatic and never exposes a fallback URL merely because a
provider check failed. After a meeting has started, changing providers would
fragment connection and attendance evidence and therefore requires a separate
future recovery design.

Platform Administrators retain an audited backstop. Coordinators remain bounded
by their existing occurrence and region authorization. A Presenter is bounded
to assigned sessions and cannot edit authoring policy or historical attendance
outside the existing presenter-attendance permissions.

### Post-session review

The administrator sees connection evidence separately from the attendance
decision. They can inspect intervals, total qualifying connected time,
reconciliation warnings, automatic promotion reason, and any staff correction.
Manual attendance correction uses the existing audited attendance boundary and
does not delete or rewrite provider evidence.

When recording was enabled, the administrator also sees recording status,
duration, size, retention deadline, processing or upload failure, and authorised
playback/download controls. Deleting a recording is a confirmed, audited
operation that records deletion evidence and does not erase the historical fact
that recording occurred.

Exports identify connection-derived values as such. They must not imply that a
WebRTC connection proves identity, attention, participation quality, or viewing
of the entire webinar.

## Frontend architecture

### Routes and splitting

The implementation adds route-level features for:

- the public/authenticated attendee lobby;
- passwordless recovery within that lobby;
- the learner webinar room loaded after an explicit join;
- the presenter operational workspace and green room; and
- the administrator authoring and operational panels.

The LiveKit browser SDK and media UI are loaded only after an attendee activates
**Join webinar** or staff activates **Enter green room**. No LiveKit dependency
enters the root layout, general Event workspace, or initial lobby bundle.

The stock LiveKit `VideoConference` prefab is not adopted because its current
implementation uses inline style attributes that conflict with Upskill's UI
policy and strict-CSP verification. The UI will compose audited lower-level
LiveKit primitives or client hooks behind an Upskill compatibility boundary,
with CSS Modules/static CSS and shared Mantine wrappers.

### Responsive and accessible behaviour

All attendee, presenter, and administrator views are mobile-first. Controls use
semantic buttons and forms, visible focus, meaningful status text, live-region
announcements for admission/status changes, labelled media controls, keyboard
operation, sufficient touch targets, and layouts that do not horizontally
overflow at narrow widths.

Presenter queue actions remain usable without relying on colour, hover, or a
wide data table. Large operational attendance datasets may use TanStack Table
with server-side pagination and URL-backed filters; the small live admission
queue uses a workflow-oriented semantic list.

The attendee room does not request camera or microphone permission. Presenter
permissions are requested only after the presenter explicitly enters the green
room and chooses the relevant device action.

### Client/server state

Lobby state is server-authoritative. Initial delivery uses short, cache-disabled
status requests with jittered polling and visibility-aware backoff. Mutations
return the resulting state and polling repairs missed updates. This avoids
introducing a long-lived SSE connection before operational need is demonstrated.

LiveKit participant events improve in-room responsiveness but do not authorise
admission, attendance, or moderation. A browser event can optimistically update
display state; the next server response remains authoritative.

## Backend architecture

### Server modules and provider adapter

All LiveKit server SDK use belongs in server-only modules behind a small provider
interface. The application domain invokes operations such as:

- ensure an exact room generation exists;
- issue an attendee or presenter join token;
- list active participants for reconciliation;
- remove a participant;
- close a room; and
- start, inspect, and stop a managed composite recording; and
- verify and normalise a webhook.

Domain services do not accept arbitrary room names, participant identities, or
grants from the client. They derive these values from authorised database rows.
The adapter permits deterministic fakes in domain tests and prevents provider
types from spreading through Event code.

Four server-owned boundaries prevent callers from reconstructing policy:

1. `virtual-session-access-policy.server.ts` derives an explicit attendee or
   staff outcome from authoritative registration, participation, questionnaire,
   assignment, session, room-generation, admission, consent, capacity and door
   state.
2. `livekit-provider.server.ts` owns provider room, participant, token, Egress
   and reconciliation operations behind a deterministic test fake.
3. `livekit-webhook.server.ts` verifies and normalises the bounded raw provider
   request before recording an idempotent receipt. It does not call the join
   policy.
4. `virtual-attendance.server.ts` derives versioned attendance decisions from
   append-only connection intervals and the immutable session policy snapshot.

The access policy returns typed outcomes such as `registration_required`,
`questionnaire_required`, `verification_required`, `meeting_not_started`,
`waiting_for_admission`, `ready_to_join`, `capacity_reached`, `locked`, `ended`,
`revoked`, and `staff_access`. Browser routes translate these outcomes into user
experience but do not grant the capability themselves.

LiveKit API key and secret are environment-specific Secrets Manager values read
only by the server. The public WebSocket URL is validated configuration.
Development, test, staging, and production use separate LiveKit Cloud projects,
URLs, API keys, and secrets so a token from one environment cannot reach
another. Provider credentials never enter the client bundle or application
logs.

### Typed server functions and endpoint outline

Every browser boundary uses a Zod-validated typed server function. The target
capabilities are:

- resolve lobby reference and return enumeration-safe public session status;
- create/resume an authenticated lobby entry;
- request, resend, and consume email/SMS recovery OTPs;
- create/resume a passwordless lobby entry through the scoped capability;
- fetch the caller's lobby status;
- issue an attendee token after the complete gate;
- fetch the presenter's exact-session operational view;
- enter the presenter green room and issue a presenter token;
- admit, bulk-admit, decline, or revoke lobby entries;
- change admission mode;
- start, lock, reopen, end, or replace a room generation;
- inspect recording readiness and perform an authorised emergency recording
  stop;
- perform server-authorised participant moderation;
- inspect/retry provider reconciliation; and
- review and correct attendance through the existing audited boundary.

The LiveKit webhook is the exception because it is provider-to-server rather
than a browser server function. It uses a dedicated endpoint that reads the
bounded raw request body, requires `application/webhook+json`, verifies the
LiveKit signature before JSON processing, and rejects unsigned or invalid
payloads without side effects.

### Authorization matrix

| Capability                    | Attendee                         | Assigned Presenter                 | Occurrence administrator  | Platform Administrator |
| ----------------------------- | -------------------------------- | ---------------------------------- | ------------------------- | ---------------------- |
| View own lobby state          | Exact participation/capability   | No                                 | Scoped operational view   | Audited backstop       |
| Obtain attendee token         | Self; eligible + admitted + open | No                                 | No impersonation          | No impersonation       |
| Enter green room              | No                               | Exact active assignment            | Existing occurrence scope | Audited backstop       |
| Admit or decline              | No                               | Exact active assignment            | Existing occurrence scope | Audited backstop       |
| Start/lock/reopen/end         | No                               | Exact active assignment            | Existing occurrence scope | Audited backstop       |
| Moderate provider participant | No                               | Exact active assignment via server | Existing occurrence scope | Audited backstop       |
| Edit template/session policy  | No                               | No                                 | Existing authoring role   | Existing platform role |
| Correct attendance            | Existing self-check-in only      | Existing exact-session scope       | Existing occurrence scope | Existing platform role |

Every row is enforced server-side. Hidden controls, route guards, provider
grants, and possession of a public lobby reference are defence-in-depth or UX,
not the authorization boundary.

## Identity, capabilities and LiveKit grants

### Participant identity

Provider identities are stable within a room generation and contain no PII.
They are derived from durable Upskill identifiers, for example an opaque form of
`attendee:<eventParticipationId>` and `staff:<userId>:<assignmentId>`. The
provider display metadata contains only the minimum display name and application
role required in the room; it never contains email, phone, organisation secrets,
access codes, registration notes, or authorization claims.

Because LiveKit permits only one active participant for a given identity in a
room, a newer attendee connection replaces the older connection. Presence
calculation handles that transition without double-counting overlapping
intervals. Staff who legitimately need multiple devices receive a separately
derived device identity while retaining a common application actor identity.

### Token lifetime and grants

Join JWTs initially expire after five minutes. Expiry limits the time in which a
new provider connection can begin; application authorization is still rechecked
before every issuance. The server may revoke future issuance immediately and
may remove an already-connected participant through the provider API.
LiveKit tokens are not treated as one-use credentials: a token copied before
expiry may be presented again, so short expiry, exact-room grants, stable
participant identity, generation binding, and server-side removal all remain
necessary.

Attendee grants are limited to:

- join this one exact room;
- subscribe to presenter tracks;
- no camera or microphone publication;
- no screen publication;
- no arbitrary data publication; and
- no room-administration capability.

Presenter grants are limited to:

- join this one exact room;
- subscribe;
- publish only approved camera, microphone, and screen sources; and
- no browser room-administration capability.

The token subject, room, identity, grants, generation, and display metadata are
server-derived. The API never accepts caller-supplied LiveKit grants.

### Capability storage

Opaque public references and join capabilities are generated with a
cryptographically secure random source. Only keyed digests are retained where a
bearer value does not need to be recovered. Database and audit records store a
fingerprint or digest, never an OTP, capability, API secret, or LiveKit JWT.

Rate limits are applied by action, lobby reference, identifier digest,
participation, account, and coarse client/network signals. Responses remain
enumeration-safe and do not turn throttling differences into an identity oracle.

## Data model

The next sequential forward-only migration introduces the following logical
model. Final physical names may follow generated-type conventions, but the
relationships and invariants are part of this decision.

### Event delivery configuration

`event_occurrence` gains a virtual-delivery provider discriminator. Existing
virtual URL data is retained for `external_url`; constraints require a protected
external URL only for that provider and prohibit provider settings for in-person
delivery.

Exact Event Session delivery snapshots retain admission mode, attendance mode,
duration threshold, preparation window, rejoin grace, guest policy, capacity
headroom, recording mode, and recording retention duration. These are distinct
from mutable operational room state.

### Virtual room generation

`event_virtual_room` records:

- exact Event Session and provider;
- opaque unique provider room name and generation number;
- door state and current operational admission mode;
- snapshotted attendance policy and threshold;
- snapshotted recording policy and retention duration;
- provider readiness/error classification;
- created, started, locked, reopened, and ended instants and actors; and
- immutable links to replacement or replaced generations.

There is one current generation per Event Session, enforced transactionally.
State-transition updates use row locking or compare-and-set semantics so double
start, simultaneous end, and recovery races are idempotent and attributable.

### Lobby link and entry

`event_virtual_join_access` records the recoverable routing metadata and digest
of the opaque public reference, exact session/generation binding, creation,
rotation, revocation, and actor.

`event_virtual_lobby_entry` records the exact session, generation,
participation, current operational state, access method, request/admission/
decline/revocation actors and instants, first token issuance, and first/last
connection observations. A unique constraint permits one active logical entry
per participation and generation. History is retained when the generation is
replaced.

### Recovery challenges and sessions

`event_virtual_recovery_challenge` records exact room/session/participation
binding, channel, identifier/code/request digests, attempt and resend counters,
expiry, consumption, and non-sensitive delivery outcome.

`event_virtual_join_session` records only a digest of the opaque capability,
its exact binding, issue/last-use/expiry times, access method, and revocation.
Successful recovery does not mutate durable account-verification fields.

### Webhook receipts and presence

`livekit_webhook_receipt` records provider deployment, unique event identifier,
event type, raw-body digest, provider creation time, receipt time, processing
state, retry count, and normalised outcome. The raw webhook body is not retained
after signature verification unless a later privacy review explicitly approves
bounded encrypted retention.

`event_virtual_presence_interval` records room generation, exact participation,
provider participant SID/identity fingerprint, joined time, last-seen time, left
time, disconnect reason, source, and reconciliation state. Intervals are
append-only evidence; corrective processing adds or closes evidence rather than
rewriting the original provider receipt.

### Recording lifecycle

`event_virtual_recording` records the room generation, provider Egress
identifier, lifecycle status, requested/started/ended/completed instants and
actors, opaque S3 object key, file size and duration, retention deadline,
non-sensitive failure classification, and deletion evidence. It never stores an
upload credential or public object URL. One initial composite recording is
permitted per generation; retries attach attempts to the same logical record so
provider ambiguity cannot create an untracked duplicate.

Composite foreign keys and unique constraints prevent a lobby entry, recovery
session, webhook, interval, or recording from being attached to a different
Event Session, participation, or room generation.

## Room lifecycle and provider consistency

Room creation, token issuance, participant removal, and room closure are
idempotent. Provider mutations that follow a committed domain transition use
the existing outbox/retry approach so an application restart cannot leave an
unobservable half-completed operation.

Start requires provider readiness but does not depend on a presenter's browser
remaining connected. End commits the terminal application state first, prevents
new tokens, enqueues provider closure, and records whether provider confirmation
is pending. Retries use stable deduplication keys based on room generation and
operation.

Provider state never silently reopens an application door. If a provider room
is unexpectedly recreated or remains active after an application end, the
reconciler closes it and raises an operational warning.

## Automatic attendance

### Policy modes

Attendance policy is explicit for each exact session:

- `manual`: LiveKit presence is displayed as supporting evidence but does not
  change attendance state.
- `automatic_check_in`: the first verified active attendee connection may move
  `not_recorded` to `checked_in`; staff still decides `attended` or `absent`.
- `automatic_duration`: connection evidence may move `not_recorded` to
  `checked_in` and then to `attended` after the snapshotted minimum connected
  duration is met.

No mode marks an attendee `attended` merely because a token was issued, a socket
attempt began, a lobby was opened, or a first connection event arrived.

Automatic changes use the existing `system` attendance source and retain the
policy, threshold, evidence total, calculation version, and decision time. A
later manual correction is separately audited and does not erase the automatic
decision or its evidence.

### Evidence capture

LiveKit `participant_joined` and `participant_left` webhooks open and close
presence intervals only after signed, idempotent receipt processing. Duplicate
and out-of-order events are expected. Intervals for the same attendee are
normalised so reconnections, multiple tabs, and identity replacement do not
double-count overlapping time.

Webhook delivery is not assumed to be complete. While a room is live, a bounded
reconciler periodically compares the provider participant list with open local
intervals. Ending a room triggers a final reconciliation. Missing leave events
are closed using the best supported last-seen/provider/end evidence and marked
with their reconciliation source for later review.

Qualifying duration:

- begins no earlier than the scheduled session start;
- excludes lobby time and token lifetime before connection;
- sums non-overlapping active intervals for the attendee identity;
- may continue beyond the scheduled finish until the presenter ends the room;
- stops at explicit room end or the best reconciled disconnect time; and
- remains reviewable when provider evidence is incomplete.

The operational UI distinguishes waiting, admitted, connecting, connected,
disconnected, reconnecting, duration-qualified, automatically attended, and
needs-review states. User-facing copy calls the result **connection-based
attendance** and does not claim proof of attention.

## Webhooks, reconciliation and background work

The webhook endpoint verifies the signed token against the exact raw request
body before parsing or persistence. The provider event identifier is unique, so
redelivery returns success after the existing result is found. Processing is
transactional and safe for out-of-order join/leave events.

Slow normalization, attendance promotion, and reconciliation run through
idempotent worker jobs with stable deduplication keys. A poison event remains
visible with a bounded error classification and retry history; it is not dropped
or allowed to block unrelated rooms.

The final attendance calculation may be rerun deterministically from retained
normalised evidence and the snapshotted policy. Calculation-version changes do
not silently rewrite historical decisions; they require an explicit audited
recalculation operation if ever introduced.

## Security, privacy and browser policy

### CSP and browser permissions

The implementation will add only the exact LiveKit Cloud project WebSocket/API
origin for each configured environment to `connect-src`. It will not add
wildcard provider origins, `unsafe-inline`, `unsafe-eval`, or a general CSP
exception. Rendered-HTML CSP verification must cover both attendee and presenter
routes.

Existing `media-src`/`worker-src` allowances are reviewed against the actual SDK
output. Camera and microphone remain denied by default and are enabled only for
the presenter route through a narrowly scoped response policy. The
subscribe-only attendee route does not receive capture permissions. Screen
capture remains an explicit presenter gesture governed by browser controls.

### Data minimisation

No email address, phone number, organisation membership, access code, internal
database identifier, or authorization detail is placed in room names, URLs,
JWT-visible metadata, provider logs controlled by the application, or analytics
events. Logs use room-generation IDs, actor IDs already permitted by the audit
boundary, and token-decision reason codes without bearer values.

LiveKit Cloud offers an Australian realtime region. The initial service may use
LiveKit's normal closest-region routing, but that behaviour is not described as
guaranteed Australian data residency. Production activation requires a privacy
review that either accepts the selected plan's routing, enables contractual
region pinning to the Australian region, or leaves LiveKit delivery disabled.
Recording objects are stored in the configured private Sydney-region Upskill
bucket, but storage location does not by itself prove where realtime media was
processed.

### Managed LiveKit Cloud infrastructure

Development, staging, and production use isolated LiveKit Cloud projects. The
service provides the WebRTC media plane, TLS signalling, ICE/TCP and TURN
fallback, capacity management, service upgrades, and managed Egress. Upskill
does not provision an EC2 media host, Elastic IP, media security group, Redis,
certificate, TURN service, or Egress worker.

The browser connects only to its environment's validated LiveKit Cloud project
URL. The application server calls the corresponding trusted API endpoint and
LiveKit Cloud sends signed webhooks to the protected Upskill HTTPS endpoint.
Project selection is server-derived and cannot be supplied by a client or room
policy row.

The provider plan, participant limit, concurrent-room limit, Egress concurrency,
included participant minutes, downstream transfer, and transcode allowance are
operational configuration. Administrator validation must reject a published
capacity beyond the approved commercial and tested limits. Current provider
allowances are never encoded as permanent domain rules because plans and quotas
can change independently of an immutable Event snapshot.

### Managed media operations and availability

LiveKit Cloud owns media-node health, routing, TURN availability, certificates,
and infrastructure upgrades. Upskill remains responsible for compatible pinned
client/server SDK versions, project credentials, webhook verification,
application reconciliation, provider-status monitoring, quota alerts, and
cross-browser media testing.

Operational monitoring covers API and room-creation failures, signed-webhook
lag, provider service status, unexpected disconnects, participant and room
capacity, downstream transfer, participant minutes, transcode minutes, Egress
concurrency, and forecast plan exhaustion. A provider failure before start
leaves attendees safely in the application lobby. Staff may retry or use the
audited pre-start external URL. A failure during a webinar is surfaced as a
media incident; recovery may replace the room generation and must re-evaluate
every attendee before issuing another token.

### Managed recording and storage

Recording defaults to off. When the immutable session policy enables automatic
recording, every lobby, green-room, and in-room view gives clear notice before
connection and the connected view shows a persistent recording indicator.
Attendee access records the required acknowledgement before token issuance.

Upskill does not configure room auto-Egress because that could record the
presenter green room. After the meeting start transition commits, the server
starts one managed RoomComposite Egress job idempotently. It records the webinar
layout to MP4 and stops when the meeting ends. An authorised administrator has
an audited emergency stop; pause, restart, multiple layouts, individual-track
recording, transcription, and AI summaries are outside the initial slice.

The recording is written to an opaque, session-generation-specific prefix in a
private Upskill S3 bucket. The preferred upload authorization is LiveKit Cloud
AWS role assumption when enabled for the selected plan. Otherwise the server may
supply dedicated short-lived STS credentials whose expiry covers the bounded
session and final upload. The credentials allow only the required object writes
to that exact recording prefix, are never persisted in the database or logs,
and cannot list, read, or delete bucket objects. Recording object names are
unique and replacement protection is enforced by the storage policy. Long-lived
or general-purpose AWS credentials are not accepted.

Recording start, active, stopping, complete, failed, size, duration, provider
Egress identifier, storage key, retention deadline, and deletion evidence are
durable application state derived from verified provider events and
reconciliation. A recording failure does not falsify attendance or end an
otherwise healthy webinar; it is surfaced immediately to staff and remains an
operational exception. Playback and download require server-side authorization
and short-lived application-controlled access. S3 encryption, access logging,
malware/content review where required, and lifecycle deletion enforce the
published retention policy. There is no public recording URL.

### Encryption

LiveKit transport encryption is required. WebRTC media is encrypted between
each browser and the LiveKit Cloud SFU, where transport encryption terminates so
the service can forward tracks and, when enabled, perform managed recording.

Optional end-to-end encryption (E2EE) would additionally encrypt media in the
presenter's client and decrypt it only in authorised subscriber clients.
Signalling and API metadata are not thereby end-to-end encrypted, and managed
composite recording would require a separately designed trusted key path. E2EE
remains deferred because application-owned key distribution, recovery,
multi-device presenter operation, moderation, and recording compatibility
require a separate threat and product decision.

## Audit and observability

Durable audit events cover:

- provider/session policy snapshot and operational changes;
- room generation creation, replacement, start, lock, reopen, and end;
- lobby-link creation, rotation, and revocation;
- recovery request outcome, verification outcome, and capability revocation;
- individual, bulk, and automatic admission or decline;
- token issuance allowed/denied reason, without the token;
- participant removal and other moderation;
- webhook verification/processing outcome and duplicate detection;
- reconciliation runs, evidence gaps, and finalisation;
- recording request, start, stop, completion, failure, access, retention, and
  deletion;
- automatic attendance decisions and staff corrections; and
- emergency pre-start switch to external delivery.

Operational metrics and alerts include provider-room creation failures, token
denial rates by safe reason code, lobby polling errors, webhook signature
failures, webhook lag, unprocessed receipts, reconciliation gaps, unexpected
active rooms, connected-participant capacity, room duration, and participant
connection duration for capacity analysis. Provider cost and quota metrics cover
participant minutes, downstream transfer, transcode minutes, recording output,
and concurrent rooms and Egress jobs.

Metrics and logs must avoid high-cardinality bearer values and PII. Dashboards
link to authorised Upskill operational records rather than placing contact data
in the telemetry system.

## Failure and recovery rules

- **Provider unavailable before start:** keep attendees in the application
  lobby; do not disclose credentials. Staff may retry or perform the audited
  pre-start external-provider switch.
- **Presenter disconnects:** keep the application room open. Other assigned
  presenters/admins may continue; warn when no staff participant is visible.
- **Attendee token expires before connection:** reissue only after all current
  predicates pass.
- **Eligibility changes after admission:** revoke future issuance and remove an
  active participant through the idempotent server moderation path.
- **Webhook delayed or missing:** retain provisional evidence, reconcile through
  Room Service, and surface `needs_review` rather than inventing a precise leave
  time.
- **Room unexpectedly ends:** close token issuance, preserve evidence, show a
  recoverable operational error, and require explicit generation replacement.
- **Recording fails or upload is incomplete:** keep the webinar running, show
  staff the recording failure, reconcile provider status, and never expose a
  partial object as a completed recording.
- **Double start/end/admit:** return the already-committed compatible result or
  a typed state-conflict response; never duplicate evidence or outbox work.
- **Capacity reached:** preserve lobby state, show a retryable capacity message,
  and alert staff; do not over-admit by bypassing Event capacity rules.

## Migration and backward compatibility

The schema change is the next sequential, forward-only Kysely migration after
the current baseline and applied migrations. It uses expand-and-contract rules:

1. add provider and LiveKit policy fields without invalidating current rows;
2. backfill every current virtual occurrence to `external_url`;
3. add new room, lobby, recovery, webhook, presence, and recording tables;
4. add constraints and generated database types after the backfill is safe; and
5. leave current learner, guest, presenter, and administrator external-link
   behaviour intact until an exact session explicitly selects LiveKit.

Rescheduling the same exact session updates its schedule snapshot within the
existing occurrence lifecycle but does not expose a room. Cancellation or
replacement revokes the current lobby access and ends the generation. A newly
created replacement session receives a new public reference and room generation.

No existing historical attendance is recalculated. Automatic attendance starts
only for LiveKit sessions whose snapshotted policy enables it.

## Delivery sequence

Implementation proceeds in bounded slices, each independently reviewed and
verified:

1. **Managed provider foundation:** isolated LiveKit Cloud projects, validated
   environment URLs and Secrets Manager credentials, signed webhook endpoint,
   plan/quota configuration, provider fake, service-status monitoring, and
   development connectivity tests.
2. **Provider seam and persistence:** migration, generated types, validated
   environment contract, server-only adapter, provider fake, room-generation
   state machine, audit, and outbox operations.
3. **Administrator and presenter foundation:** template/occurrence policy,
   operational workspace, provider health, green room, presenter token grants,
   and start/lock/reopen/end controls.
4. **Attendee lobby and admission:** opaque links, authenticated lobby,
   passwordless email/SMS recovery, manual/bulk/automatic admission, meeting-not-
   started enforcement, and token gate.
5. **Webinar client:** lazy LiveKit client boundary, custom CSP-safe attendee and
   presenter media UI, responsive/accessibility coverage, reconnect and leave
   behaviour, and server-authorised moderation.
6. **Managed recording:** recording policy and consent, idempotent RoomComposite
   Egress lifecycle, narrowly scoped S3 upload authorization, status webhooks,
   private playback/download, retention, deletion evidence, and failure UI.
7. **Connection attendance:** signed webhook receipts, append-only intervals,
   periodic/final reconciliation, policy-based promotion, review UI, and exports.
8. **Open-entry and operational hardening:** policy-controlled guest lobby,
   provider failure drills, quotas/cost alerts, cross-browser media smoke, and
   production readiness review.

Production enablement is a separate operational action. This ADR and its
implementation do not authorise creation or mutation of a production LiveKit
Cloud project, production credentials, recording storage authorization,
commercial plan, region policy, or activation for live events.

### Implementation tracker

This tracker is updated when each exact implementation slice merges. A checked
item means its pull request, focused regression coverage and required repository
gates passed; it does not by itself authorise staging or production activation.

- [x] **Slice 1 — dormant provider foundation:** select exact dependency
      versions that satisfy the repository release-age policy; add validated local
      and server-only configuration, provider adapter/fake, raw webhook signature
      contract, Secrets Manager CDK configuration and development connectivity
      tests. Keep the feature disabled.
      Implemented by [PR #64](https://github.com/code-studio-au/upskill/pull/64).
- [x] **Slice 2 — versioned provider policy:** add the next sequential
      forward-only migration, generated types, template-session policy authoring,
      occurrence provider selection, immutable Event Session snapshots, and the
      `external_url` backfill with unchanged legacy behaviour. LiveKit
      occurrences remain draft-only until the attendee token and webinar media
      delivery paths are implemented; environment configuration alone does not
      make them publishable.
      Implemented by [PR #65](https://github.com/code-studio-au/upskill/pull/65).
- [x] **Slice 3 — room lifecycle and presenter green room:** add room-generation
      persistence, exact staff policy, idempotent outbox operations, lazy room
      creation, presenter grants, device preview, provider health, and
      start/lock/reopen/end/replacement controls.
      Implemented by [PR #66](https://github.com/code-studio-au/upskill/pull/66).
- [ ] **Slice 4 — attendee lobby, admission and recovery:** add opaque join
      access, the central attendee policy, authenticated lobby, narrow email/SMS
      recovery, manual/bulk/automatic admission, polling, meeting-not-started and
      token issuance, then route learner workspaces and communications through it.
- [ ] **Slice 5 — webinar media client:** add the route-split LiveKit client
      boundary, custom CSP-safe attendee and presenter media views, exact response
      security policy, reconnect/leave/removal behaviour, accessibility, responsive
      layout and deterministic bundle coverage.
- [ ] **Slice 6 — managed recording:** add the recording evidence model,
      consent, idempotent RoomComposite Egress lifecycle, dedicated private
      recording storage and narrowly scoped upload authorisation, private playback,
      retention, deletion evidence and failure recovery.
- [ ] **Slice 7 — connection attendance:** add signed webhook receipts,
      append-only connection intervals, periodic/final reconciliation, versioned
      policy evaluation, automatic promotion, preserved manual corrections, review
      UI and exports.
- [ ] **Slice 8 — open-entry and operational hardening:** route eligible guests
      through the same lobby, complete provider failure and generation-replacement
      drills, add quota/cost alerts and cross-browser media smoke, and produce a
      staging-readiness report while leaving production disabled.

Each pull request includes the impact-matrix delta in its description and audits
equivalent actors, acquisition paths, targets, lifecycle states and downstream
consumers before review. A review finding is classified as an invariant failure
and repaired across the affected category before a new exact-head review.

Initial implementation assumptions are:

- a whole-occurrence Presenter assignment authorises that Presenter for each
  active session in the occurrence, while a session assignment remains exact;
- Coordinators do not gain LiveKit control merely from their region-scoped Event
  operations role;
- recordings use a dedicated private bucket rather than the general learning or
  private-resource buckets;
- external-link virtual delivery remains a first-class, supported provider; and
- environment activation, commercial plan selection and production deployment
  remain separate authorised operational actions.

## Verification

### Domain and database verification

Focused tests and the database gate cover:

- valid and invalid room-door state transitions;
- one current generation per exact session and safe replacement;
- concurrent start, end, admission, auto-admit, and token requests;
- immutable policy snapshot and attendance threshold after start;
- external-URL backfill and unchanged existing behaviour;
- exact participation/session/generation composite integrity;
- lobby revocation after withdrawal, cancellation, or eligibility loss;
- append-only evidence and audited attendance correction;
- one logical recording per generation, idempotent recording lifecycle, and
  retained deletion evidence; and
- stable outbox deduplication and retry behaviour.

### Authentication, authorization and token verification

Tests prove:

- an early attendee response contains no room name, provider URL, JWT, or secret;
- a scheduled timestamp alone never opens the room;
- only exact assigned staff can enter or operate a session;
- normal attendees and recovery capabilities cannot obtain presenter grants;
- OTPs are one-use, short-lived, attempt/resend limited, and enumeration-safe;
- SMS targets only an existing verified E.164 mobile number;
- capabilities fail across session, participation, public-reference, and room-
  generation boundaries;
- every attendee issuance rechecks eligibility, admission, door, lock/rejoin,
  and capacity rules;
- recording-enabled issuance requires the snapshotted notice acknowledgement;
- attendee and presenter JWT claims contain only the intended room and grants;
  and
- moderation is rejected without server-side exact-session authorization.

### Provider and attendance verification

The provider fake covers ordinary domain tests. Focused integration tests use a
local disposable LiveKit service for deterministic development and an isolated
LiveKit Cloud staging project for provider-contract coverage of room create,
join, identity replacement, participant removal, close, managed Egress, storage
completion, and signed webhooks.

Attendance tests cover duplicate, out-of-order, delayed, and missing webhooks;
join without leave; reconnects; overlapping tabs; identity replacement; time
clamping; final reconciliation; duration thresholds; calculation idempotency;
manual mode; check-in-only mode; automatic promotion; and preserved staff
correction history.

### Provider and media-path verification

Configuration tests prove that each environment selects one validated LiveKit
Cloud project URL, server-only credentials remain absent from client and build
outputs, and staging/production credentials cannot be interchanged. Existing
AWS verification covers Secrets Manager access and the private recording bucket,
encryption, lifecycle, logging, and narrowly scoped recording upload role.

Staging readiness tests cover WebSocket signalling, direct media and restrictive
network fallback, signed webhook delivery, provider interruption, room-generation
replacement, managed recording start/stop/completion, failed upload recovery,
quota exhaustion, and the pre-start external-provider fallback. Representative
tests establish supported browser, presenter, attendee, room, and recording
concurrency within the selected provider plan before administrator validation
accepts that capacity.

### Browser and repository verification

Browser coverage exercises the learner, presenter, and administrator flows at
narrow and desktop widths, including keyboard operation, visible focus, status
announcements, permission prompts, waiting/admission/start changes, reconnect,
lock, end, and failure states. Media tests use browser fake-device support and
include Chromium, Firefox, and WebKit partitions where LiveKit supports the
tested behaviour.

Rendered HTML is checked for inline style/script violations and exact CSP and
Permissions-Policy output. Production builds must preserve deterministic client-
bundle budgets and prove that LiveKit is absent from the root and initial lobby
chunks. The completed schema/application slices run `pnpm run verify:db:gate`,
`pnpm run verify:app`, and the relevant Event administrator and learner browser
partitions before handoff.

## Consequences

- Upskill, rather than a reusable meeting URL, becomes the authoritative join
  and admission boundary.
- The application lobby prevents early media connection and avoids consuming
  provider participant minutes and downstream transfer while people wait.
- Presenters gain a true media green room without granting attendees early room
  access.
- Passwordless recovery is narrow, revocable, short-lived, and consistent with
  the existing Event task-access model.
- Attendance becomes more automatic and explainable while remaining honest
  about what connection evidence can and cannot prove.
- LiveKit Cloud removes application-operated media and Egress infrastructure,
  while Upskill remains responsible for provider credentials, quotas and cost,
  recording policy and storage, webhook reconciliation, real-time incident
  handling, and browser-media testing.
- LiveKit remains replaceable behind a server adapter, but room semantics and
  presence evidence are durable Upskill concepts rather than provider details.
- The strict CSP and client-budget constraints require a custom, lazy media UI
  instead of the provider's all-in-one React prefab.

## Alternatives rejected

### Put waiting attendees in a separate LiveKit lobby room

This would issue credentials and create provider connections before admission,
increasing cost and expanding the credential, privacy, and moderation surface.
The application lobby satisfies status and identity needs without media.

### Use a scheduled JWT activation time as “meeting not started”

A time claim cannot express presenter readiness, manual admission, door locks,
eligibility changes, or generation replacement. The token endpoint must enforce
current application state.

### Expose a static or long-lived meeting URL

It is forwardable, difficult to revoke per attendee, cannot encode current
eligibility safely, and weakens auditability. Opaque lobby links plus short-lived
server-issued JWTs provide a narrower boundary.

### Treat first connection as attended

A brief or accidental connection is not meaningful attendance. Explicit policy,
duration evidence, and retained manual review are required.

### Rely only on LiveKit webhooks

Webhook delivery is retryable but not guaranteed. Provider reconciliation and a
reviewable incomplete-evidence state are required for durable attendance.

### Give presenters LiveKit room-administration grants in the browser

This would let a stolen browser token perform provider administration outside
Upskill's exact-session authorization and audit boundary. Moderation remains a
server operation.

### Adopt the stock LiveKit React video-conference prefab

The prefab's inline styling and broad default interaction surface do not meet
Upskill's strict-CSP, static-CSS, webinar-permission, and bundle-control rules.

### Self-host LiveKit for the initial release

Self-hosting would provide direct infrastructure and regional-placement control,
but it would add media-node sizing, TLS, ICE/TCP, TURN, upgrades, incident
response, bandwidth planning, and capacity management. Recording would also
require separate Redis and Egress infrastructure with materially larger compute
requirements than the small development media node. That operational burden is
disproportionate for the initial event volume. The provider adapter preserves a
future self-hosting path if contractual residency, scale, or economics later
justify a new infrastructure decision.

### Use Zoom Video SDK

Zoom Video SDK would also provide managed media and cloud recording. Its Web SDK
guidance, however, requires broad provider origins and WebAssembly execution
through `unsafe-eval` or `wasm-unsafe-eval`; WebRTC-video support does not cover
all browsers required by Upskill. That conflicts with the nonce-only CSP, no-new-
exception policy, and Chromium/Firefox/WebKit support boundary. Upskill will not
weaken those controls to adopt the provider.

## Provider references

This decision relies on the following provider contracts, which must be
revalidated against the selected plan and pinned SDK versions during
implementation:

- [token generation and server-side grants](https://docs.livekit.io/home/server/generating-tokens/);
- [token and participant permissions](https://docs.livekit.io/frontends/reference/tokens-grants/);
- [rooms, participants, and unique participant identities](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/);
- [signed webhook events and delivery behaviour](https://docs.livekit.io/intro/basics/rooms-participants-tracks/webhooks-events/);
- [Room Service API](https://docs.livekit.io/reference/other/roomservice-api/);
- [LiveKit Cloud pricing and plan limits](https://livekit.com/pricing);
- [Cloud regions and regional endpoints](https://docs.livekit.io/deploy/admin/regions/endpoints/);
- [managed Egress overview](https://docs.livekit.io/transport/media/ingress-egress/egress/);
- [Egress output and S3 configuration](https://docs.livekit.io/transport/media/ingress-egress/egress/outputs/);
- [Egress API and recording status](https://docs.livekit.io/reference/other/egress/api/);
- [transport and end-to-end encryption](https://docs.livekit.io/transport/encryption/);
- [React `VideoConference` prefab](https://docs.livekit.io/reference/components/react/component/videoconference/)
  and its
  [source implementation](https://github.com/livekit/components-js/blob/main/packages/react/src/prefabs/VideoConference.tsx); and
- [Zoom Video SDK browser and CSP requirements](https://developers.zoom.us/docs/video-sdk/web/browser-support/).
