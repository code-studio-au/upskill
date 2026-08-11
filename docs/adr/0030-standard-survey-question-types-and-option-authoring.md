# ADR 0030: Standard Survey question types and option authoring

## Status

Accepted target; implementation pending.

## Context

The current Survey implementation supports written response, single choice and
multiple choice. Learning Surveys and Survey-backed User Onboarding also need
compact long-list selection, explicit agreement/acknowledgement and common typed
answers without creating a second form system.

Administrators may need to enter substantial option lists such as regions. These
lists commonly originate as a column copied from Excel, so individual-only
option entry would be slow and error prone.

## Decision

The shared Survey model supports this standard question set:

| Question type              | Stored answer                  | Intended use                                                       |
| -------------------------- | ------------------------------ | ------------------------------------------------------------------ |
| Short text                 | Trimmed string                 | Name/context, role, brief free text                                |
| Long text                  | Trimmed string                 | Reflection, explanation and qualitative feedback                   |
| Single choice              | One immutable option ID        | A small visible radio-button list                                  |
| Multiple choice            | Unique immutable option IDs    | A small visible checkbox list                                      |
| Dropdown / combobox        | One immutable option ID        | A longer single-select searchable list, such as region             |
| Checkbox / acknowledgement | Boolean                        | One labelled statement such as agreement to terms                  |
| Number                     | Validated decimal/whole number | Years of experience and other bounded numeric answers              |
| Date                       | ISO local calendar date        | Date-only answers where collection has an explicit privacy purpose |
| Rating / Likert scale      | One bounded integer/option ID  | Baseline knowledge, confidence, agreement and evaluation ratings   |

Yes/No, True/False and similar questions are presets of Single choice, not new
storage kinds. Email, phone and URL are validation/display modes of Short text;
collecting a phone number does not verify it.

Instruction/Text Blocks remain ordered Survey Items but are not questions and do
not store answers.

### Dropdown option authoring

Dropdown, Single-choice and Multiple-choice questions share the same immutable
option structure. The editor supports:

- adding, editing, removing and reordering options individually;
- bulk paste/import with one label per line or one spreadsheet cell per row;
- optional tab-separated stable external value and label when an authorised
  canonical mapping is required;
- trimming surrounding whitespace and omitting blank rows;
- a preview before applying the bulk change; and
- blocking case-insensitive duplicate labels/values with row-level errors.

Import preserves supplied order and creates stable internal option IDs once. It
does not silently alphabetise, merge duplicates or derive durable IDs from
labels. Published Survey Versions snapshot their exact option IDs, labels, order
and any validated canonical mapping, so later drafts cannot reinterpret old
answers.

Option counts and label lengths are server-bounded. The ordinary embedded list
supports up to 500 options, enough for expected regional lists. A larger or
frequently changing controlled vocabulary is a trigger for a separately
versioned reference dataset rather than an unbounded Survey document.

For profile fields such as current region, an Onboarding Definition Version maps
each selectable option to an authorised canonical Region ID. A copied label by
itself must not create or guess a Region relationship.

### Checkbox semantics

A Checkbox question stores an explicit boolean. If required, successful
submission requires `true`; absence and `false` do not satisfy it. If optional,
both states are valid and must not be confused with an unanswered required
question.

For terms, privacy or another material acknowledgement, the published Survey
Version retains the exact checkbox label and the Onboarding/Offering policy
references the exact versioned terms/document. Evidence records the User,
context, Survey Version, question ID, accepted value and submission timestamp.
A mutable external URL alone is not sufficient historical evidence.

### Typed validation

All types are discriminated in the versioned schema and validated server-side
against the entitled/assigned exact Survey Version. The client chooses neither
the question kind nor allowed options.

Number questions declare integer/decimal mode, minimum and maximum. Date
questions declare allowed minimum/maximum and use date-only semantics without an
implicit timezone. Rating questions declare ordered labels, minimum/maximum and
optional endpoint labels. Short/Long text declare length bounds and any allowed
format mode.

## Rationale

These types cover expected onboarding, event feedback and learning-survey needs
while retaining accessible native semantics and compact mobile layouts. Reusing
option IDs and exact Survey Versions keeps historical responses interpretable.

The set deliberately stops short of a general-purpose form builder.

## Alternatives Considered

- **Render every selection as radio buttons/checkboxes.** Rejected because long
  region lists consume excessive space and are difficult to scan on mobile.
- **Store selected labels.** Rejected because labels may be corrected or
  translated in later versions and are not reliable identifiers.
- **Accept an unrestricted spreadsheet upload.** Rejected because a paste
  preview with bounded rows has a much smaller parsing and security surface.
- **Add every common form-builder type now.** Rejected because file upload,
  signature, matrices, ranking and conditional branching require separate
  evidence, privacy, accessibility and validation decisions.

## Consequences

The Survey schema, designer, learner/onboarding renderer, answer union, response
validation and tests must be extended together. Existing published versions and
responses keep their current representation.

The dropdown UI uses an accessible Mantine Combobox/Select implementation with
search for longer lists, strict CSP compatibility and mobile keyboard/focus
testing. Its code remains within the Survey/onboarding route split and client
bundle budget.

## Invariants / Guardrails

1. Published question configuration and options are immutable.
2. Answers reference stable option/question IDs, never labels or array indexes.
3. Bulk import previews and rejects invalid/duplicate rows before mutation.
4. A required acknowledgement is complete only when explicitly true.
5. Legal/material acknowledgement references exact versioned wording/content.
6. Canonical profile mappings use validated domain IDs, not guessed labels.
7. Every answer is validated server-side against the exact resolved Survey
   Version.
8. Survey answer content remains excluded from application/audit logs.

## Follow-up / Triggers

Consider file upload, signature, matrix/grid, ranking, reusable reference
datasets or conditional branching only after a concrete workflow defines their
evidence, privacy, accessibility and reporting requirements.

## Related Documents

- [Learning domain and activities](../architecture/learning-domain-and-activities.md)
- [Content authoring, versioning, and publication lifecycle](../architecture/content-authoring-versioning-and-publication-lifecycle.md)
- [User Onboarding](../architecture/user-onboarding.md)
- [ADR 0011](0011-versioned-surveys-and-response-evidence.md)
- [ADR 0029](0029-survey-backed-versioned-user-onboarding.md)
