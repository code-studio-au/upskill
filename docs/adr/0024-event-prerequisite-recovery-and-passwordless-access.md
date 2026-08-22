# ADR 0024: Event prerequisite recovery and passwordless access

## Status

Accepted; email and verified-mobile SMS OTP event-task access implemented, with
facilitated fallback pending.

The implemented first slice resolves the persisted opaque Survey QR to its exact
occurrence, Event item and Survey Version. Eligible participants can use their
password or request an enumeration-safe six-digit code by email or to the
mobile retained on their profile. A successful SMS challenge proves control of
that mobile for the task session. Codes are short-lived, one-use digests with
bounded requests and attempts. Successful
verification creates a 30-minute, 10-minute-idle task session that is accepted
only by the exact Event Survey read/write boundary and is invalidated after
submission. Security codes bypass the durable notification queue; production
SMS uses the provider-neutral direct security-message boundary with TextBee,
while local SMS is captured in PostgreSQL. Successful verification is durably
audited, and shared-device completion returns to a neutral route.
Presenter-configured recovery windows and the facilitated registered-email
capability remain follow-up work.

## Context

Some registered virtual and face-to-face Event participants arrive without
completing required pre-event SCORM, surveys or other activities. Presenters
currently show a Survey QR code so a participant can enter an email and answer
without authenticating. This works around forgotten passwords, 2FA problems,
restricted corporate devices, poor Wi-Fi, phone-only attendance and shared
devices, but creates weakly attributed responses. Coordinators later match
responses to registrations by email; different addresses, typing mistakes and
shared devices make that manual, ambiguous and unsafe.

## Decision

Every prerequisite QR/deep link identifies an exact Event occurrence, published
prerequisite item and Learning Activity Version. It preserves that destination
through authentication using signed server state and never accepts an arbitrary
post-login redirect.

### Occurrence-owned Survey QR set

Each Event Occurrence (the product's Event instance) owns one persisted Survey
access record for every Survey item contained in its exact ordered Sections.
Where the item belongs to one Session in a multi-session occurrence, the access
record is also Session-scoped. Pre-event, in-session and post-event Surveys all
use the same model; their configured availability windows and prerequisite rules
determine when submission is allowed.

Creating/publishing the occurrence materializes this complete QR set
idempotently from its exact Event composition. A uniqueness boundary on
occurrence, optional Session and Event item prevents duplicates. Draft
composition changes reconcile the draft set; a published composition change
requires the ordinary new-version/new-occurrence rules rather than retargeting a
displayed code. Archiving/cancelling the occurrence disables access while
retaining the records needed to interpret existing evidence.

The stored record identifies the occurrence, optional Session, exact Event item,
exact Survey Version, access policy, window, public-reference digest, creation
time and revocation/rotation state. Its QR image may be rendered from that record
when needed; no separate S3 bitmap is required. The QR payload contains only an
opaque high-entropy public reference and safe route. It never exposes raw
occurrence/session/user identifiers, email, capability tokens or Survey answers.

After scanning, the server resolves the public reference and the landing flow
collects/authenticates the participant. The resulting evidence records the
resolved occurrence, optional Session, exact item/Survey Version, stable User and
Registration, submitted-email snapshot, access method and timestamps. Email is
captured after scan; it is not encoded in the reusable displayed QR.

Assigned Presenters and Coordinators can browse the occurrence's QR set grouped
as pre-session, per-Session and post-session Surveys. They can open a
presentation-safe full-screen view containing the Survey title, concise
instructions, QR and window status/countdown, without participant data or the
underlying meeting/admin controls. Server authorization rechecks their active
occurrence/session assignment. Rotation/revocation is an explicit privileged
operation; merely displaying a QR is operational telemetry.

### Preferred authenticated path

The participant identifies their account and chooses an available sign-in
method: verified-mobile SMS one-time code, email one-time code, or password.
Successful verification creates an authenticated session and returns directly
to the exact outstanding prerequisite. SMS is a first-class channel, not merely
a notification feature. Phone numbers use normalized E.164 storage and explicit
verification; an unverified submitted number is not an authentication factor.

On a borrowed/shared device, the participant may choose an event-task session.
It still requires successful OTP verification but exposes only the selected
occurrence and prerequisite activities, expires quickly, and clears session and
participant data after completion or inactivity. A normal personal-device login
may retain the ordinary application session.

### Last-resort registered-email survey path

An occurrence may explicitly enable facilitated email-match completion for
selected Survey activities. Inside a short configured presenter window, the
participant enters an email. The server performs exact normalized matching
against an accepted Registration's retained registration email and confirms only
whether that address is eligible for this occurrence/item. An accepted match
issues a short-lived, single-use capability bound to the participant User,
Registration, occurrence, prerequisite item and exact Survey Version.

The capability can read and submit only that Survey. It grants no general
session, profile, other learning, answers, progress or Event-participant list.
Submission writes evidence directly to the participant's exact event-learning
item with provenance `facilitated_registered_email`; completion is idempotent.
There is no later email-based response matching step.

This path is a deliberately weaker identity check because knowledge of an email
is not proof of control. It is therefore the last option, occurrence-configured,
time bounded, rate limited, abuse monitored and unsuitable for surveys whose
sensitivity requires authenticated access. The page returns only
eligible/not-eligible in the high-entropy occurrence context and discloses no
account, registration or progress details.

If the entered email differs from the Registration, the system does not fuzzy
match or create a second participant. An authenticated Presenter/Coordinator may
select the correct participant and issue the same one-survey capability through
an audited assisted-completion command. This explicit human decision replaces
later ambiguous reconciliation.

### Activity and device boundaries

SCORM and other active/private content continue to require authenticated or
OTP-verified event-task access; the email-only capability initially supports
only explicitly approved Surveys. On shared devices, completion returns to a
neutral start screen, invalidates the capability, clears participant-specific
client state, disables response caching and prevents the next participant from
seeing prior answers or identity.

OTP challenges are short lived, one time and stored as digests. Attempts and
resends are bounded per account/identifier, challenge, IP/device and occurrence;
responses resist account enumeration; codes and phone numbers never enter URLs,
logs, audit metadata or queue payloads. Provider delivery is operational
telemetry, while successful authentication and assisted attribution follow the
existing identity/audit boundaries.

Outbound SMS has a separate operational delivery record containing purpose,
destination, provider batch identifier and accepted/sent/delivered/failed
timestamps, but never the OTP body. TextBee callbacks are accepted only through
the public HTTPS webhook after raw-body HMAC verification. Callback receipts are
digest-deduplicated, retain no raw payload, and update delivery state
monotonically so a late sent/failed event cannot overwrite carrier-confirmed
delivery. Authenticated unmatched receipts are retained for operations review
without guessing a match from a phone number.

## Consequences

Most participants can recover access on the phone already in their hand and
complete the exact prerequisite under their real account. Shared-device users do
not need to expose their broader account. The unavoidable email-only fallback
has narrow, explicit risk and produces already-attributed evidence, eliminating
the coordinator's later matching task.

Implementation requires verified-mobile capture/maintenance, SMS delivery,
email/SMS OTP UX, signed return state, event-task sessions, presenter-window QR
configuration and full-screen presentation, scoped capability tokens, assisted
participant selection, shared-device privacy cleanup and provider/rate-limit
observability.
