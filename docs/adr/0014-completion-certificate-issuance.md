# ADR 0014: Completion certificate issuance

Status: Accepted

## Decision

A course version may opt into completion certificates. When an eligible
enrolment first transitions to completed, the same database transaction creates
one pending certificate snapshot and one `certificate.generate_requested`
outbox event. The snapshot retains the exact learner name, course title,
course-version identifier and completion timestamp used to issue the document.
The unique enrolment and completion-time pair makes repeated completion signals
idempotent.

The existing content worker validates the versioned work envelope, renders the
PDF server-side and writes it to the private certificate bucket at
`certificates/{certificateId}.pdf`. It then marks the snapshot ready and commits
a durable `certificate.issued` audit event. Object creation and database
finalisation are safe to retry after partial failure. Existing completed
enrolments are backfilled as pending by the schema migration.

Learners download certificates only through a same-origin authenticated route.
The route verifies ownership and requires the enrolment's current completion
timestamp to equal the certificate snapshot before returning private,
non-cacheable PDF bytes. An administrator revocation therefore removes download
eligibility without deleting evidence; a later recompletion issues a new
snapshot. The dashboard polls only while generation is pending and exposes a
download action once ready.

## Consequences

Certificate history remains immutable and reproducible across course edits,
learner profile edits and completion corrections. Database state cannot claim a
certificate request without retaining its retryable work item. Generation is
eventually consistent, so delayed or dead-lettered work remains visible as
pending and must be covered by worker monitoring. Branded templates, uploaded
signatures and email delivery are separate future slices; they do not alter the
issuance or authorization model.
