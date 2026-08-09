# ADR 0005: Audited progress overrides

Status: Accepted

## Decision

Administrator completion corrections are append-only records with a mandatory
reason, actor and timestamp. A module correction supersedes the underlying SCORM
result without modifying any attempt. The latest explicit overall-course
correction wins, ordered by a database-generated monotonic sequence so
concurrent corrections cannot share an ambiguous position. Without one, course
completion remains derived from the effective state of every mapped module.

The command locks the enrolment, rejects repeated no-op corrections, writes the
override and global audit event, and updates the existing enrolment completion
projection in one transaction. Completion and revocation transitions emit
transactional outbox events. Access expiry and removal remain independent from
completion.

## Consequences

Every correction is attributable and reversible through another append-only
record. Historical SCORM evidence remains intact, duplicate submissions do not
create misleading audit noise, and existing learner/dashboard reads continue to
use a transactionally consistent completion projection.
