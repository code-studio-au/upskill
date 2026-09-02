# ADR 0040: Versioned registration questionnaires for Events and Courses

- **Status:** Accepted and implemented
- **Date:** 2026-08-31

## Context

Upskill needs to collect cohort-specific information as part of registering for
an Event or receiving access to a Course. A clinical webinar may ask for region
group, operational region, discipline, workplace context, or case-specific
experience. A Course made available to a subset of bulk-enrolled employees may
need a different set of questions to the learner's general profile or initial
onboarding.

The questions change over time and the answers must remain interpretable
against exactly what the learner saw. They are registration evidence, not
learning progress, and must work consistently whether access came from ordinary
registration, paid Checkout, an Access Grant, an Enterprise Contract, a late
invitation, or an administrator-created enrolment.

Upskill already has immutable Survey Versions, a standard question catalogue,
branching, validation, accessible learner rendering, dynamic region choices,
and profile-mapped questions. Rebuilding those capabilities as fixed Event or
Course fields would duplicate behaviour and lose exact-version history.

## Decision

An Event Template Version or Course Version may reference zero or one exact,
published **registration Survey Version**. The reference is part of the
immutable offering version. A different form, including a new version of the
same Survey, requires a successor Event Template Version or Course Version and
an explicit selection of the new Survey Version.

An Event Template Version with a registration Survey cannot be scheduled as an
open-entry Event. Open entry is an anonymous or provisional self-check-in flow,
not a registration flow, and can disclose Event access before an authenticated
versioned prerequisite can be completed. Administrators must choose unrestricted
registration, restricted registration, or paid entry. Both the administrator UI
and server mutations enforce this boundary; public guest-access endpoints also
fail closed for any incompatible retained occurrence.

Registration Surveys reuse standard Survey authoring, Sections, Instructions,
branching, question types, dynamic region options, profile mappings, validation,
and learner rendering. `discipline` is an ordinary administrator-authored
question; it is not a new system-owned profile field or question type.

A registration questionnaire has its own assignment and response boundary. It
does not create learning evidence, count toward Course or Event progress, or
affect certificates. The assignment is pinned to the exact Survey Version and
one exact target:

- one Event Occurrence and user; or
- one Course enrolment.

Assignments progress through `assigned`, `in_progress`, `completed`, or
`waived`. A missing assignment for a configured offering means `not_started`.
Waivers require an authorised administrator, a reason, actor and timestamp, and
a durable audit event. Completion and waiver both satisfy the access gate;
waiver does not fabricate answers or a submission.

## Answer and profile semantics

Every submitted answer belongs to the registration response and is retained as
an exact-version snapshot. Prefilling a question from current profile data does
not make the profile the source of historical truth and does not silently write
back to it.

Where the Survey uses a supported profile-mapped question, the final learner
step offers one explicit consent control: **also update my current profile with
the applicable answers**. If declined, the answer remains registration-specific.
If accepted, the response snapshot is retained and the applicable current
profile fields are also updated. A changed phone number clears its verification
state; answering a question can never mark a phone or email address as verified.

Region group and operational region use the standard dynamic Survey question
variants. For a region-restricted Event, operational-region options are filtered
to the exact regions offered by that occurrence. The selected option becomes
both a registration response and the Event's typed occurrence-region snapshot.
Publishing a regional Event Template Version with a registration Survey that
lacks an operational-region question is rejected. Events without a registration
Survey retain the existing dedicated region-confirmation flow.

When an Event Occurrence offers no operational regions, region-group and
operational-region questions remain valid cohort/profile questions only. Their
answers are retained in the registration response and may participate in an
explicit profile update, but they do not set an occurrence-region snapshot or
block registration by requiring a region the Event does not offer.

## Learner flows

### Event

1. The learner selects an Event from the dashboard or follows an eligible Event
   link.
2. If the exact Event Template Version has no registration Survey, the existing
   registration flow continues unchanged.
3. If a registration Survey is configured, Upskill creates or resumes one
   idempotent assignment, takes the learner directly to the questionnaire, and
   prefills applicable current profile values. It does not send the learner to
   the My Events index to find the form themselves.
4. The learner completes the versioned Sections and questions. Server-side
   branching and answer validation run on every step; hidden branch answers are
   removed.
5. On the final step the learner may explicitly consent to updating supported
   profile fields.
6. Submission freezes the response, records completion and, for ordinary Event
   registration, atomically uses the selected occurrence region to finish the
   normal Event registration workflow.
7. For a paid, invited, enterprise, access-code, or administrator-created Event
   registration, the place may already exist, but Event content and join access
   remain gated until the questionnaire is completed or waived.

If the registration window closes, capacity is exhausted, selection is lost,
or the Event becomes unavailable before an ordinary registration is finalised,
the answers remain saved but the server refuses to create the registration and
shows an actionable outcome. A client cannot bypass this by calling the normal
registration endpoint directly.

### Course

1. Any entitlement source may create the Course enrolment against one exact
   Course Version.
2. The dashboard labels that enrolment as requiring registration details and
   routes the learner to the questionnaire before opening the workspace.
3. The learner completes or resumes the exact Survey Version, with the same
   explicit profile-update choice.
4. Completion or an authorised waiver unlocks the Course workspace. The
   registration response remains separate from module progress and Course
   completion.

Course workspace, SCORM launch, learning Survey, and PDF-resource endpoints all
repeat the gate on the server. Event workspace, Event learning Survey, and
Event resource endpoints do the same. Route redirects and hidden buttons are
only user-experience aids.

## Presenter and Event operations flows

Presenters do not automatically receive access to registration answers. Their
normal Event operations and LiveKit responsibilities do not require cohort
demographic data.

Assigned Event administrators can see registration-detail status alongside the
Event registration list. They can open a completed response, see question
prompts and display values interpreted through the exact Survey Version, see
whether profile-update consent was given, or record a reason-required waiver.
Coordinators may see completion status needed for regional review but do not
receive the answer-detail or waiver controls unless they also hold Event
administrator authority.

The Event list updates after completion or waiver. Existing Event selection,
waitlist, regional review, capacity, participation, attendance, and cancellation
state remain authoritative and are not duplicated in the questionnaire.

## Course and platform administration flows

### Survey catalogue

An administrator creates a Survey with registration usage, authors any standard
questions and Instructions, previews it, and publishes an immutable version.
Registration Surveys are listed separately from onboarding and learning
Surveys. Published versions cannot be altered.

### Offering authoring

The draft Event Template or Course editor shows a fixed **Registration
requirements** panel above the normal schedule/module list. It permits either
no questionnaire or one published registration Survey Version. The selector is
part of the version draft and is validated on save and publication.

When a published offering needs different questions, the administrator creates
a successor offering version and deliberately selects the replacement Survey
Version. Existing occurrences, enrolments, assignments and responses stay
pinned to their previous versions.

### Operations

The Course roster and Event registration tables show `not required`, `not
started`, `in progress`, `completed`, or `waived`. Authorised administrators can
open completed answers and can waive an incomplete requirement with a reason.
The system records the waiver as exceptional access evidence rather than
pretending the learner submitted the form.

## Backend model and transaction boundaries

`course_version.registrationSurveyVersionId` and
`event_template_version.registrationSurveyVersionId` reference an exact
published registration Survey Version. Database and application validation
enforce usage and publication state.

`registration_questionnaire_assignment` records the user, exact Survey Version,
single target, lifecycle timestamps, optional Event occurrence-region snapshot,
and waiver evidence. Partial unique indexes guarantee one assignment per Event
Occurrence/user or Course enrolment.

`registration_questionnaire_response` records draft answers, visited branch
items, current item, submission, optional profile-update consent, and a future
redaction marker. Draft updates and final submission are transactional.
Completed responses are not mutated by later learner requests.

Typed server functions resolve the target from the authenticated user and never
accept a client-selected Survey Version. They:

- validate current entitlement or Event eligibility;
- lazily and idempotently establish the pinned assignment;
- hydrate dynamic region options and profile prefills on the server;
- validate every answer and forward-only branch transition;
- remove answers that fall off the selected branch;
- apply profile updates only at final submission and only with explicit consent;
- finish ordinary Event registration only after successful submission; and
- expose response details and waiver mutation only after server-side
  administrator authorisation.

Read-path gate helpers treat no configured Survey as satisfied and require a
configured assignment to be `completed` or `waived`. These checks are called by
every protected learning and Event-content boundary, not only by page loaders.

## Security, privacy and evidence

- Clients cannot choose an assignment target, learner, or Survey Version.
- Registration answers are never written to application logs or generic audit
  metadata.
- Waiver audit metadata contains identifiers and the administrative reason, not
  questionnaire answers.
- Response details require platform/Course administration or exact Event
  administrator authority. Presenter assignment alone is insufficient.
- Current profile state and historical answers remain separate; later profile
  edits never rewrite a response.
- Dynamic option identifiers are validated against the pinned Survey content
  and, for regional Events, the occurrence's active region set.
- Published offering and Survey versions remain immutable.
- Server-side gates cover deep links and asset launches so UI manipulation does
  not grant access.

Registration response retention and privacy-driven redaction will use the
existing retained-evidence approach: preserve the minimum assignment,
completion/version and audit facts needed to explain access while allowing
answer content to be redacted under an explicit future operation. No automated
redaction policy is introduced by this slice.

## Alternatives considered

- **Fixed registration columns on Event and Course records.** Rejected because
  each cohort needs different questions and historic meaning would be lost.
- **Use onboarding responses directly.** Rejected because current profile and
  onboarding describe the learner generally; registration answers describe one
  exact cohort and moment.
- **Insert a normal learning Survey at the top of the schedule.** Rejected
  because registration is an access prerequisite, not learning progress, and
  must run before workspace access from every entitlement source.
- **Allow several registration Surveys per offering.** Rejected for the initial
  model. One composed, branched Survey provides a single atomic submission,
  clearer operations, and one immutable version pointer.
- **Always update the learner profile.** Rejected because cohort-specific
  answers must not silently overwrite current identity data.

## Consequences

Registration can be issued before questionnaire completion for commercial or
administrative sources, but protected content remains unavailable until the
separate prerequisite is resolved. This preserves payment, capacity and origin
evidence while keeping one source-neutral gate.

Administrators must publish a new offering version to change its registration
form. This is deliberate: it makes cohort differences explicit and preserves
the interpretation of existing responses.

## Related decisions

- [ADR 0011](0011-versioned-surveys-and-response-evidence.md)
- [ADR 0022](0022-stable-identity-and-historical-attribution.md)
- [ADR 0025](0025-event-registration-finalisation-and-section-release.md)
- [ADR 0029](0029-survey-backed-versioned-user-onboarding.md)
- [ADR 0030](0030-standard-survey-question-types-and-option-authoring.md)
- [ADR 0033](0033-forward-only-survey-branching.md)
- [ADR 0034](0034-source-neutral-entitlements-and-access-owner-disclosure.md)
- [ADR 0038](0038-enterprise-blanket-contracts.md)
- [ADR 0039](0039-livekit-virtual-webinars-and-admission.md)
