# ADR 0015: Administrator-managed course enrolment lifecycle

## Status

Accepted.

## Decision

Platform administrators may grant an existing learner access to one exact
published course version from the course roster. Draft versions and archived
courses are not enrolment targets. The command performs an exact,
case-insensitive email lookup after server-side validation and excludes platform
administrator accounts from the learner boundary.

An active enrolment for the learner and version is a conflict. If the same
enrolment was removed or expired, granting access restores that row instead of
creating competing progress histories. Restoration clears removal and expiry,
retains the original enrolment date, learning evidence and completion snapshot,
and derives the restored status from the retained completion timestamp.

Removal is a soft lifecycle transition: the enrolment becomes cancelled and
receives a removal timestamp. Progress, completion, order/grant references and
certificates remain historical evidence. Learner content boundaries continue to
deny removed access.

Grant, restoration and removal serialize on the enrolment identity and commit
with append-only administrator audit evidence plus its transactional structured
log projection. Repeated add/remove commands are deterministic conflicts or
no-ops and do not create duplicate audit records.

## Consequences

Administrators can handle support and contract enrolments without direct
database changes. Version history remains reproducible and removal remains
recoverable. Separate future extension workflows may add bounded expiry dates or
new commercial entitlements without changing these lifecycle invariants.
