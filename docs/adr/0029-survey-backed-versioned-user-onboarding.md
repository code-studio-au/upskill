# ADR 0029: Survey-backed versioned user onboarding

## Status

Accepted target; implementation pending.

## Context

Authenticated onboarding will collect demographic, professional-context and
baseline self-rated-knowledge answers before a User reaches the learner
dashboard. Questions, validation, privacy wording and required fields will change
over time. Upskill already has versioned Survey authoring and rendering, but a
learning Survey also carries entitlement, item-progress and Learning Evidence
semantics that do not belong to identity onboarding.

## Decision

Reuse the Survey Designer, question schema, validator, renderer and exact
immutable Survey Version as the questionnaire content for onboarding. Do not
model onboarding as a Survey Learning Activity.

An immutable Onboarding Definition Version references one exact published Survey
Version and owns onboarding-only policy: privacy notice/version, typed profile
mappings, completion and activation behaviour. A User receives an Onboarding
Assignment pinned to that exact definition/version, and final submission creates
privacy-scoped onboarding response/completion records rather than Learning
Evidence.

Publishing a new version defaults to future/newly incomplete Users. Requiring
previously onboarded Users to complete a later version is a separate explicit,
audited reassignment campaign. In-progress assignments never retarget
automatically.

## Rationale

This reuses established versioning, authoring, validation, Sections,
Text/Instruction Blocks and responsive form behaviour without duplicating a
questionnaire platform. The separate orchestration model keeps onboarding
privacy, profile mapping and dashboard gating out of Course/Event progress.

The shared standard question and bulk-option behaviours are governed by ADR
0030; onboarding does not introduce private question kinds.

An exact assigned version preserves what the User saw. Explicit activation
prevents a harmless questionnaire revision from unexpectedly locking every
existing learner out of their dashboard.

## Alternatives Considered

- **Make onboarding an ordinary Survey Learning Activity.** Rejected because it
  would require a Course/Event entitlement/item and could accidentally influence
  progress, completion and certificates.
- **Build a second onboarding form/question engine.** Rejected because it would
  duplicate authoring, validation, accessibility and versioning.
- **Store fixed onboarding columns only on User.** Rejected because changing
  questions would destroy exact-version interpretation and mix raw historic
  answers with the current mutable profile.
- **Always require the newest version.** Rejected because publication would
  silently invalidate prior completion and create an unsafe dashboard lockout.

## Consequences

The Survey engine needs a non-learning response context with equally strict
server-side exact-version validation. Onboarding administration must publish two
related immutable objects: the Survey Version and the Onboarding Definition
Version that adds policy.

Profile values copied from onboarding become mutable current profile state;
historic onboarding answers and participation-time snapshots remain separate.
Sensitive-answer authorisation and retention are stricter than ordinary progress
reporting.

## Invariants / Guardrails

1. Clients cannot choose or substitute the assigned Survey Version.
2. Onboarding submission never writes Learning Evidence or affects educational
   progress/completion.
3. Existing or in-progress assignments never retarget on publication.
4. Re-onboarding is explicit and audited.
5. Answer content is excluded from application logs, generic audit payloads and
   generic exports.
6. A phone number collected during onboarding is not verified until a separate
   possession challenge succeeds.
7. Privacy-governed answer deletion may retain a minimal completion fact.

## Follow-up / Triggers

Introduce multiple Onboarding Definitions or cohort-specific selection only when
the product has a concrete audience with materially different onboarding needs.
Do not add a general rules engine for the initial default flow.

## Related Documents

- [User Onboarding](../architecture/user-onboarding.md)
- [ADR 0011](0011-versioned-surveys-and-response-evidence.md)
- [ADR 0022](0022-stable-identity-and-historical-attribution.md)
- [ADR 0023](0023-onboarding-and-open-entry-guest-check-in.md)
- [ADR 0030](0030-standard-survey-question-types-and-option-authoring.md)
