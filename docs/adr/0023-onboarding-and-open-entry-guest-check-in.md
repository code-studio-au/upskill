# ADR 0023: User onboarding and open-entry guest check-in

## Status

Accepted target; implementation pending.

## Decision

User onboarding and open-entry Event participation are separate workflows.

An authenticated user who has not completed the current required onboarding
version is directed to a pre-dashboard onboarding experience. It may collect
demographic, professional-context and baseline self-rated-knowledge responses.
Questions are versioned, validation and required/optional policy are explicit,
and sensitive answers receive purpose limitation, field-level authorization and
retention rules. Onboarding completion gates the ordinary learner dashboard but
does not become learning completion evidence unless a question set is
deliberately modelled as a Learning Activity.

An open-entry Event may instead publish an occurrence-scoped guest access link.
The landing page discloses no virtual-meeting credential until the visitor enters
at least their name and email address and accepts any required privacy notice.
The server creates or finds the user identity for the normalized email and
creates a guest participation/check-in record, but does not create a
Registration. A newly created user is provisional: email is unverified, no
authenticated session or application capability is granted, and the derived
`userOnboarded` state is false. It retains the submitted contact details as
point-in-time event attribution and records when the protected Join action was
used. The underlying Zoom, Teams or equivalent URL remains private configuration
and is disclosed only through the guarded occurrence boundary.

This uses the same shared provisional-account boundary as an administrator adding
a person by name and email. Each caller supplies name, normalized email and a
creation source, then attaches its own domain record: Event participation for
open entry, the exact Registration plus `administrator_override` eligibility
evidence for a restricted-Event override, or the relevant administrator-granted
assignment/access. A user-specific late Event invitation also resolves its
intended recipient through this boundary before the authenticated recipient
completes Registration. Creation is idempotent by normalized email. A new provisional
("soft") account atomically
records a deduplicated setup-notification intent; the resulting single-use,
expiring "set up your account" email is delivered asynchronously and does not
delay the Event Join action. Reusing an existing account never resets its
credentials, verification or onboarding state.

For a restricted Event, shared account provisioning does not itself bypass any
rule. The separate audited administrator command creates the occurrence-specific
Registration and bypasses only its verified-domain criterion. Capacity,
occurrence lifecycle, approval policy and all other entitlement requirements
remain authoritative.

Accessing the landing page or disclosing the meeting link before the configured
attendance window does not prove attendance. A protected Join action inside an
occurrence/session attendance window creates `self_check_in` evidence. Each
occurrence explicitly chooses whether valid self-check-in is sufficient to mark
attendance automatically or remains `checked_in` until a coordinator/presenter
confirms it. The evidence retains source and timestamp, and authorised staff can
correct the result without erasing the original evidence.

Submitting the form does not prove control of the email address. If the address
already belongs to a user, the check-in may reference that stable identity but
must remain explicitly self-asserted evidence and cannot authenticate, mutate the
verified profile or grant access to private account data. A later verification,
password-setup or passwordless sign-in flow proves control. On first authenticated
entry, the user completes ordinary onboarding; prior event attribution remains
stable under ADR 0022.

Because Event participation already references the stable user, confirmed or
policy-established Attendance appears in the learner's Event history/dashboard
after account setup and onboarding without an administrator manually matching
the record. A merely early or unconfirmed check-in remains labelled accurately.

The persistent onboarding source of truth is the exact completed onboarding
definition version (nullable while incomplete), with `userOnboarded` exposed as
the derived product state. This allows future questionnaire versions and policy
to be handled deliberately instead of turning one permanent boolean into hidden
versioning logic.

ADR 0029 refines this model: each Onboarding Definition Version references one
exact immutable Survey Version so onboarding can reuse Survey authoring,
Sections, instruction blocks, validation and rendering without becoming a
Learning Activity. Publishing does not silently invalidate prior completion;
re-onboarding existing Users requires an explicit assignment campaign.

The guest link is high entropy, occurrence-scoped, revocable, rate limited and
valid only for the configured access period. It reduces accidental public
disclosure but cannot prevent a recipient from copying a meeting URL after it is
shown; meeting-provider controls remain a separate defence.

## Consequences

Open entry remains distinct from registration-required unrestricted Events.
Coordinators no longer need to transcribe every attendee name/email from the
meeting, while reporting can distinguish guest details submitted, join link
disclosed, self-check-in, confirmed attendance and later account linkage.

Onboarding does not block provisional open-entry users from reaching the guarded
Join action. The implementation needs an explicit privacy basis for demographic
and guest contact data, safe idempotent user lookup/creation, email verification
and setup delivery, abuse controls, duplicate/reconciliation support and
accessible mobile-first forms.
