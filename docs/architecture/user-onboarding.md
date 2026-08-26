# User Onboarding

**Status:** Current Product foundation; advanced administration pending\
**Scope:** Authenticated-user onboarding, versioned questionnaires, profile
initialisation, privacy, completion, and soft-account transition

## Purpose

User onboarding is the pre-dashboard workflow through which a verified,
authenticated User supplies required profile and demographic information and
may rate their current knowledge. Its questions will change over time, so the
system must preserve what each User was asked without treating onboarding as
learning progress.

Open-entry Event check-in, administrator and Event staff invitations, and
purchase-time account creation are account provisioning paths, not alternative
onboarding flows. They all create or reuse one stable User with onboarding
incomplete. After account setup and authentication, the same ordinary onboarding
workflow applies.

## Decision Summary

Onboarding reuses the existing Survey Designer, question document, validation,
section/instruction-block support, renderer and immutable Survey Versions. It is
not itself a Survey Learning Activity.

An immutable **Onboarding Definition Version** references one exact published
Survey Version and adds onboarding-specific policy: privacy information,
approved profile mappings, applicability, completion rules and activation
behaviour. An **Onboarding Assignment** pins one User to that exact version.
Answers are stored as privacy-scoped onboarding responses and never create
Learning Evidence, Section progress, Course/Event completion or certificates.

This boundary reuses the mature questionnaire machinery while preventing
learning-specific entitlement, item and progress rules from leaking into
identity onboarding.

## Current Product

Better Auth account/session mechanics, secure provisional-account activation
and Survey-backed onboarding are implemented. Administrators can classify and
publish onboarding questionnaires, activate an immutable onboarding definition
version with a versioned privacy notice, allowlisted profile mappings and an
optional contact-verification completion policy, and review configuration
status. Published settings are immutable; the administrator uses the same
explicit Create new version workflow as Survey authoring to make a change. The
learner flow creates or resumes an exact version-pinned assignment,
validates each answer server-side, applies mapped name, canonical mobile,
email/SMS enablement and current-region fields transactionally, and gates My
Learning/My Events until completion. Enabled, unverified contact methods can be
verified with a six-digit code after questionnaire submission. Verification is
recommended and skippable by default; an administrator can require every
enabled method for a newly activated immutable version. Onboarding responses
remain separate from Learning Evidence and course/event progress.

The product exposes the shared provisional-account boundary from the learner
directory, Event staff roster, and unauthenticated paid-offering flow. A new
person receives one expiring account-setup email; a repeated invitation reuses
the same User and refreshes setup only within the resend controls. Purchase-time
setup returns the person to the exact Course or Event after activation so
Stripe Checkout and the resulting entitlement always use an authenticated User.
Public Better Auth sign-up remains disabled.

Completed learners can open My profile from the account menu to view and update
the current values projected by onboarding: full name, canonical mobile,
operational region, email enablement and SMS enablement. Email is displayed with
its verification state but remains read-only because it is the authentication
identifier. Profile edits never rewrite the immutable onboarding response.
Changing mobile closes the active phone claim, clears SMS verification and
revokes outstanding SMS recovery challenges and survey-only sessions before the
new number can be verified.

Explicit re-onboarding campaigns, privacy-scoped answer support/reporting,
answer retention/redaction jobs, profession mappings and a durable
`onboarding.completed` outbox event remain Target Product work.

## Target Product

### Domain concepts

- **Onboarding Definition:** stable administrative identity for the onboarding
  programme. Upskill initially needs one default definition.
- **Onboarding Definition Version:** immutable published policy that references
  one exact published Survey Version and snapshots its privacy notice/version,
  completion rule, approved profile mappings, contact-verification requirement
  and activation policy.
- **Onboarding Assignment:** one User's requirement to complete one exact
  Onboarding Definition Version. It records assignment source and timestamps,
  with `assigned`, `in_progress` or `completed` state.
- **Onboarding Response:** draft/final privacy-scoped answers for one assignment
  and its exact Survey Version. A final submission is immutable except for
  privacy-governed deletion/redaction of answer content.
- **Onboarding Completion:** minimal durable fact identifying the User,
  assignment, exact Onboarding Definition Version and completion timestamp. It
  remains after answer retention expires but is not Learning Evidence.

The product-facing `userOnboarded` value is derived. It is false for a
provisional/unverified User and becomes true only when the verified User has a
completed assignment satisfying their currently applicable onboarding
requirement. It is not a permanent mutable boolean and does not mean that the
User completed the newest version ever published.

### Authoring and publication

An authorised administrator creates the questionnaire in the Survey Designer.
The supported content includes:

- titled Sections;
- Text/Instruction Blocks;
- required and optional questions;
- Short/Long text, Single/Multiple choice, Dropdown,
  Checkbox/acknowledgement, Number, Date and Rating/Likert questions;
- onboarding-only Profile full name and Profile mobile phone variants of Short
  text, plus Profile email enabled and Profile SMS enabled variants of Checkbox;
- directory-backed Region group and Operational region dropdowns whose options
  cannot be edited in the Survey Designer;
- individual or bulk-pasted option authoring, including spreadsheet region
  lists;
- question/Section ordering and validation; and
- accessible mobile-first presentation.

Publishing the questionnaire creates an immutable Survey Version. Publishing
the onboarding configuration then creates an immutable Onboarding Definition
Version referencing that exact Survey Version. Draft edits never affect assigned
or completed Users, and a later Survey Version is not silently substituted.

An onboarding-oriented usage classification prevents accidental insertion of a
privacy-sensitive questionnaire into Course/Event content. The shared Survey
engine remains reusable; the usage policy controls where a version may be
selected.

### Version activation and reassignment

One published Onboarding Definition Version is active for new assignments at a
time. Activation uses an explicit policy:

1. **New/incomplete users (default):** Users who have not completed onboarding
   receive the active version. Existing valid completions remain valid.
2. **Explicit re-onboarding campaign:** selected existing Users or a defined
   cohort receive a new required assignment. This is a deliberate, audited
   action and does not erase their earlier completion/answers.

Publishing alone never forces completed Users through onboarding again. An
in-progress assignment stays pinned to its exact version even if a newer version
becomes active. A superseding assignment is explicit; it must retain the old
assignment and explain why the new one replaced it.

An administrator can require re-onboarding from the retained User profile. The
new assignment pins the currently active Onboarding Definition Version and
gates the ordinary learner dashboard at the next authenticated dashboard
boundary. It does not revoke identity, entitlements, registrations, historical
Attendance or Learning Evidence.

### Assignment and completion flow

```text
soft account created/reused
  -> setup notification queued
  -> email/phone control proved and account authenticated
  -> onboarding requirement resolved server-side
  -> exact active version assigned if required
  -> onboarding form started/resumed
  -> answer-based conditional paths skip inapplicable sections
  -> final answers validated against pinned Survey Version
  -> approved profile mappings + response committed atomically
  -> enabled contact methods verified, or optional verification explicitly skipped
  -> assignment completion committed
  -> onboarding.completed fact placed in the outbox
  -> learner dashboard becomes available
```

The server selects the assignment and Survey Version; the client cannot supply
or replace them. Repeated final submission is idempotent. A returning User
resumes an in-progress draft. Failure to deliver a post-completion notification
does not undo completion.

Open-entry participants may reach the occurrence's guarded Join action before
account setup/onboarding as defined by ADR 0023. They do not receive the ordinary
learner dashboard until verification, authentication and onboarding are
complete.

### Profile-field mappings

Some onboarding answers initialise current User/Profile values such as display
name, canonical mobile, contact-channel enablement, profession and current
region. Authors select the Profile full name, Profile mobile phone, Profile
email enabled and Profile SMS enabled question types directly. These types are
constrained variants of the shared Short text and Checkbox renderers and are
automatically mapped to their matching profile fields. Operational region is
also mapped automatically. This removes a second mapping decision from
activation. Each published onboarding version snapshots the resolved, typed
mapping from question key to profile field. Final submission validates and
writes those mapped values in the same transaction as the submitted response.
Mobile numbers use normalized E.164 storage; Profile mobile phone is required
and phone-formatted, while the two enablement questions are optional
Checkboxes.

Dropdown options store stable IDs rather than labels. The Region group question
snapshots active Region Groups, and the Operational region question snapshots
active Operational Regions and their parent relationship. The latter is
filtered by the selected Region Group and is automatically mapped to the User's
current canonical Region ID. Authors cannot edit these directory-backed option
sets. A required terms/privacy Checkbox is satisfied only by explicit
acceptance and references the exact versioned terms/privacy content.

Raw answer payloads are never the live profile source of truth. Users may later
update supported profile fields without rewriting their onboarding response.
Changing current region or mobile never rewrites Course Enrolment, Event
Registration, Attendance or other historical snapshots.

Entering or changing a phone number does not prove possession. A change clears
the retained SMS verification timestamp and closes any active phone claim. Email
and SMS enablement are learner profile preferences; their verified states are
system-owned and cannot be set by a questionnaire answer. Each enabled
unverified channel can receive a six-digit, 10-minute one-time code after
questionnaire submission. Challenges store only digests, are single-use, permit
at most five attempts and are limited to three sends per channel and assignment
in 15 minutes.

The post-onboarding profile uses a distinct profile challenge purpose and
authorization path while sharing the same digested-code, rate-limit, provider
and transferable-phone primitives. Profile verification does not relax the
assignment and submission checks on onboarding challenges. Learners may verify
an available email or mobile even when that channel is disabled, then decide
separately whether it may be used for communications.

A canonical mobile number has at most one verified owner, but ownership is
transferable. Successful verification creates a new append-only phone claim. In
the same transaction, Upskill closes the previous claim, clears the former
owner's verification timestamp, invalidates their outstanding SMS recovery
challenges and sessions, and queues a security email without disclosing the new
account. The former profile retains the number as unverified so its User can
replace or reverify it. A per-number lock plus partial unique indexes prevent
concurrent challenges from producing two active verified owners. Historical SMS
deliveries retain the recipient User and name snapshot captured when sent; a
later transfer never relabels those rows.

The immutable Onboarding Definition Version records whether contact verification
is required. When optional, the learner sees it as recommended and may explicitly
skip; the assignment records the skip timestamp before completion. When required,
the skip action is unavailable and every enabled channel must be verified before
the dashboard gate opens. A verified and enabled contact method may later be
used for narrow event Survey recovery; merely collecting or enabling it is never
an authentication factor.

SMS verification delivery is visible to platform administrators in the shared
email/SMS delivery operations table. Provider acceptance is shown separately
from device-sent and carrier-delivered state. The expanded row exposes only safe
operational metadata such as purpose, provider batch and timestamps; it never
exposes the verification code or message body.

### Privacy and authorisation

Each version states the purpose, required/optional status and retention policy
for collected data. The UI presents the exact privacy notice/version before
final submission.

Ordinary administrators may see onboarding state, assigned/completed version and
timestamps for support. They do not see sensitive answers by default. Answer
access/export requires a separate privacy-scoped capability, field minimisation
and durable audit evidence.

Answer content must not enter operational logs, generic audit payloads, generic
CSV exports or unrestricted analytics. Aggregated demographic reporting requires
an explicit authorised dataset and small-cohort disclosure controls.

Published question/policy versions and the minimal completion fact remain
historically stable. Answer data follows its declared retention policy and may
be deleted or irreversibly redacted without pretending the onboarding was never
completed.

### User experience

The onboarding route is full-document SSR with a useful loading state and a
route-level split form/designer bundle. It must work on a phone from the first
implementation, use TanStack Form and Mantine validation, preserve the strict CSP
without unsafe script evaluation, respect the narrowly documented Mantine style
attribute allowance, and provide accessible error summaries and focus
management.

The header and dashboard navigation must not briefly expose inaccessible learner
actions while onboarding state is loading. Server route guards remain
authoritative; client navigation is convenience only.

### Administration

Administration provides:

- draft/create/publish/activate Onboarding Definition Versions;
- preview using the exact referenced Survey Version;
- a clear impact summary before activation;
- separate confirmation for an explicit re-onboarding campaign;
- User-level assignment state and support diagnostics; and
- a versioned toggle requiring verification of every enabled contact method;
- audited access to any separately authorised answer view/export.

Administrators may resend account-setup messages or help correct the User's
current profile. They cannot fabricate answers or mark onboarding complete by
editing the derived state.

## Invariants

1. An Onboarding Assignment pins one exact immutable Onboarding Definition
   Version and Survey Version.
2. Onboarding reuses Survey questionnaire machinery but is not a Learning
   Activity and creates no Learning Evidence.
3. Publishing a new version never silently changes an in-progress assignment or
   invalidates an existing completion.
4. Re-onboarding existing Users is an explicit, audited assignment operation.
5. `userOnboarded` requires verified identity and a completion satisfying the
   User's applicable assignment; it is false for provisional Users.
6. Profile mappings are typed, allowlisted and versioned; entered phone numbers
   are normalized but are not verified sign-in factors.
7. Verification state is system-owned. A changed mobile clears SMS verification,
   and required verification blocks completion until every enabled channel is
   verified.
8. Sensitive answer content never enters logs, generic audit events, generic
   exports or ordinary administrator views.
9. Privacy retention may remove answer content without removing the minimal
   historical completion fact.
10. Provisional/open-entry access never becomes an authenticated dashboard
    session and remains governed by ADR 0023.

## Implementation Sequence

1. **Implemented:** generalise the Survey schema, renderer and validator without
   weakening Learning Survey entitlement rules.
2. **Implemented:** add Onboarding Definition Version, Assignment and Response
   persistence with version-pinned completion state.
3. **Implemented:** add the server-side pre-dashboard resolver and mobile
   onboarding route.
4. **Partly implemented:** typed name, canonical phone, contact enablement and
   current-region mappings are transactional; durable completion outbox dispatch
   remains pending.
5. **Implemented:** optional or administrator-required email/SMS possession
   verification, bounded OTP challenges, explicit skip recording and dashboard
   completion gating.
6. **Partly implemented:** version activation and explicit User-level
   administrator re-onboarding exist; bulk/cohort campaigns remain pending.
7. **Pending:** privacy-scoped support/reporting and retention/redaction.

## Related Decisions

- [ADR 0011: Versioned surveys and response evidence](../adr/0011-versioned-surveys-and-response-evidence.md)
- [ADR 0022: Stable identity and historical attribution](../adr/0022-stable-identity-and-historical-attribution.md)
- [ADR 0023: User onboarding and open-entry guest check-in](../adr/0023-onboarding-and-open-entry-guest-check-in.md)
- [ADR 0029: Survey-backed versioned user onboarding](../adr/0029-survey-backed-versioned-user-onboarding.md)
- [ADR 0030: Standard Survey question types and option authoring](../adr/0030-standard-survey-question-types-and-option-authoring.md)
- [ADR 0033: Forward-only Survey branching](../adr/0033-forward-only-survey-branching.md)
