# ADR 0011: Versioned surveys and response evidence

## Status

Accepted.

## Decision

Surveys use a stable identity with immutable published versions. A version owns
an ordered, validated question document containing written-response,
single-choice and multiple-choice questions. Conditional branching, scoring
and assessment pass marks are outside this slice. Authors must create a new
version before changing a published survey, and course items continue to
reference the exact version selected when their course version was published.

A learner opens a survey through a dedicated route keyed by enrolment and
course-version item. The server derives the survey version from that entitled
item; clients cannot select or substitute it. Submitted answers are validated
against the stored published question document and persisted once as an
immutable `survey_response` tied to the enrolment, item and survey version.
Answer payloads are never written to application or audit logs.

Successful submission writes the course-item completion evidence in the same
transaction and re-evaluates section and course completion. Survey lifecycle
changes are durable administrator audit events. Learner submission is
operationally logged using identifiers and outcome only; the response table is
the durable business evidence.

## Consequences

Historical course versions and learner responses remain reproducible when a
survey is revised. Entitlement and validation do not trust route or form data
for the referenced version. A future branching designer can extend the
versioned content schema, but must preserve exact-version response evidence
and must not expose answer content to centralized logging.
