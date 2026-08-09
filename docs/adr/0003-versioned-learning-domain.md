# ADR 0003: Versioned learning domain

Status: Accepted

## Decision

Published course, module, survey and event-template versions are immutable.
Enrolments snapshot exact component versions. Publishing a reused component
creates new affected course versions for future enrolments.

## Consequences

Historical progress remains reproducible. Corrections and manual completion are
new audited records rather than destructive updates.

The learner workspace always resolves content through the enrolment's exact
course-version foreign key. Completion and access are separate concerns: a
completed enrolment remains reviewable until its access expires or is removed.
