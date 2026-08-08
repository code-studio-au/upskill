# ADR 0004: SCORM and object storage

Status: Accepted

## Decision

Upload packages to quarantine, validate and extract them asynchronously, and
serve immutable files through private S3 and CloudFront. Run the SCORM shell and
package on a dedicated learning origin with attempt-scoped authorization.

## Consequences

SCORM can locate its same-origin runtime API without receiving the primary
application's cookies. Arbitrary vendor packages beyond the supported Rise 360
profile require a new build-versus-buy decision.
