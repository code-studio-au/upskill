# ADR 0004: SCORM and object storage

Status: Accepted

## Decision

Upload packages to quarantine, validate and extract them asynchronously, and
serve immutable files through private S3 and CloudFront. Run the SCORM shell and
package on a dedicated learning origin with attempt-scoped authorization.
The primary application issues a five-minute, single-use launch credential only
after checking enrolment ownership and access. The learning origin exchanges it
for a revocable, HTTP-only attempt session; it never receives the Better Auth
session. SCORM progress writes are bounded, validated and scoped to that one
attempt.

## Consequences

SCORM can locate its same-origin runtime API without receiving the primary
application's cookies. Arbitrary vendor packages beyond the supported Rise 360
profile require a new build-versus-buy decision.
Course completion is derived transactionally when every mapped module has a
completed attempt, producing one audit record and one outbox event even when the
runtime repeats its final commit.
