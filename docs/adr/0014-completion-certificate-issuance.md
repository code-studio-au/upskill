# ADR 0014: On-demand completion certificates

## Status

Accepted.

## Decision

An exact course version may opt into completion certificates. A learner may
download one only when the authenticated user owns the exact enrolment, that
enrolment is currently completed with a completion timestamp, and its enrolled
course version still has certificate support enabled.

The authenticated same-origin route evaluates those conditions on every
request, renders the PDF synchronously and streams it with `Cache-Control:
private, no-store`. The document includes the current learner name, exact course
version title and completion time. A deterministic completion reference is
derived at runtime from the enrolment identity and completion timestamp.

Certificates are not domain records. The application does not retain a
certificate table, PDF object, storage bucket, queue command, worker lifecycle,
pending state, polling UI or certificate-specific issuance audit event. The
authoritative enrolment completion and its existing progress/override evidence
remain the source of truth.

An administrator completion override makes the certificate unavailable
immediately. If the learner later completes the requirements again, the current
completion makes a newly rendered download available immediately.

## Consequences

There is no stored certificate to revoke, clean up, reconcile or preserve.
Downloaded copies are outside the application's control, as with any downloaded
document. Course and learner profile changes may alter a later rendering; the
exact enrolled version and authoritative completion time remain fixed inputs.
If future legal or regulatory requirements demand issued-document retention,
that must be introduced as a new explicit product decision rather than hidden
inside the current download feature.
