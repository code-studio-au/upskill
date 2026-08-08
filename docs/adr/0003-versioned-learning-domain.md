# ADR 0003: Versioned learning domain

Status: Accepted

## Decision

Published course, module, survey and event-template versions are immutable.
Enrolments snapshot exact component versions. Publishing a reused component
creates new affected course versions for future enrolments.

## Consequences

Historical progress remains reproducible. Corrections and manual completion are
new audited records rather than destructive updates.
