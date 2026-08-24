# ADR 0004: SCORM and object storage

## Status

Accepted. The CloudFront delivery portion is superseded by ADR 0036.

## Decision

Upload packages to quarantine, validate and extract them asynchronously, and
serve immutable files through private S3 and CloudFront. Run the SCORM shell and
package on a dedicated learning origin with attempt-scoped authorization.
The primary application issues a five-minute, single-use launch credential only
after checking enrolment ownership and access. The learning origin exchanges it
for a revocable, HTTP-only attempt session; it never receives the Better Auth
session. SCORM progress writes are bounded, validated and scoped to that one
attempt.

The supported ingestion profile is a root-manifest, single-SCO Rise 360 SCORM
1.2 export. ZIP processing rejects traversal, absolute or duplicate paths,
links, encryption and bounded-resource violations before writing learning
content. Limits are 250 MB compressed, 1 GB expanded, 5,000 entries and 64 MB
per entry. Immutable object keys include the package-version identifier and
source SHA-256 digest; conditional writes make worker retries idempotent.
The database transaction also writes an ingestion request to the outbox. Its
dispatcher publishes a versioned SQS envelope, and the consumer acknowledges
the message only after validation has reached a durable ready or rejected
state. Visibility heartbeats cover long extraction, while repeated transient or
malformed messages are redriven to the dead-letter queue.
Administrator uploads use an authenticated same-origin application route. It
requires `Content-Length`, rejects encoded bodies, streams no more than 250 MB
to a unique quarantine object and computes SHA-256 while streaming. Only after
the object is complete does the database transaction register the version and
outbox request. Failed registration removes that exact object. Direct browser
uploads to S3 and broad object-store CORS are deliberately excluded.
Removal is version-scoped and allowed only after validation is terminal and
when neither course-version mappings nor SCORM attempts reference the version.
The same transaction removes the database row and records both the administrator
audit event and an outbox cleanup request. The worker idempotently deletes only
the package-version quarantine and learning-content prefixes, so transient S3
failures use the same visibility, retry and dead-letter behavior as ingestion.

## Consequences

SCORM can locate its same-origin runtime API without receiving the primary
application's cookies. Arbitrary vendor packages beyond the supported Rise 360
profile require a new build-versus-buy decision.
Rise exports require inline scripts, inline styles and dynamic evaluation. Those
capabilities are prohibited on the application origin and permitted only by the
SCORM response policy on the dedicated learning origin. The application embeds
that origin in a sandboxed iframe, the learning origin accepts framing only from
the configured application origin, and every shell, state and package request
requires the attempt-scoped HTTP-only session.
The learning-origin policy permits frames from Articulate's dedicated embed
origin so supported Rise media can load without broadening the application
policy or allowing arbitrary HTTPS frames. The outer sandbox permits
user-initiated popups and downloads so packaged references such as PDFs can
open, but does not allow popups to escape the sandbox.
The web process remains in the upload data path, so nginx and the application
must preserve streaming and coordinated limits. This keeps authorization,
auditing and cleanup atomic at the application boundary without buffering a
full archive in memory.
Unused versions can be reclaimed without weakening immutable course or learner
history. Object cleanup is eventually consistent with the committed database
removal and may remain queued briefly after the administrator confirms it.
Course completion is derived transactionally when every mapped module has a
completed attempt, producing one audit record and one outbox event even when the
runtime repeats its final commit.
