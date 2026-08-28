# ADR 0038: Enterprise blanket contracts as lazy entitlement producers

- **Status:** Accepted and implemented
- **Date:** 2026-08-28

## Context

Upskill already supports individual purchases and finite, offering-specific
access grants. A whole-workforce agreement is different: it authorises an
eligible population to select from several courses without pre-creating one
grant or enrolment per course and learner.

Folding this model into `access_grant` would mix finite capacity with blanket
eligibility, duplicate commercial terms across courses, and make renewal and
historical explanation difficult.

## Decision

Introduce a first-class Enterprise Contract boundary with these rules:

1. A contract belongs to a stable Organisation and owns a commercial
   reference, effective period, learner access duration, lifecycle, immutable
   Course/Event coverage, and verified-email eligibility through domains or an
   uploaded exact employee list.
2. Contract periods move through `draft`, `active`, `suspended`, and
   `terminated`; expiry is derived from the effective period. Renewal creates a
   linked draft period with cloned coverage, eligibility and owners rather than
   mutating historical terms.
3. Activating a shared encrypted code creates one idempotent learner claim only
   after authentication, verified email, contract eligibility and explicit
   information-release acceptance succeed. Code possession alone is
   insufficient. Rotation transactionally revokes the previous code while
   retaining its history.
4. Lazy Course materialisation remains the default. A contract may instead
   enable automatic Course enrolment after claim consent, and administrators
   may idempotently backfill already-consented claimants. Uploading eligibility
   alone never creates accounts or enrolments.
5. Every resulting entitlement records the exact contract, claim, and immutable
   coverage row. Composite database constraints prevent inconsistent lineage.
6. Suspending, expiring, or terminating a contract blocks new claims and
   materialisation but does not revoke already-issued learning. Any future
   retroactive revocation must be a separate explicit audited operation.
7. Shared codes use the existing encrypted recoverable-code boundary. The code
   table supports one active code and retained revoked history so later rotation
   does not rewrite contract identity.

8. Event coverage targets exact scheduled Event Occurrences. A claimant may
   register without payment, but normal publication, registration-window,
   capacity and duplicate-registration rules remain authoritative.
9. Contract Access Owner assignments are email-bound and activate only for the
   matching verified account. Owners see only learners who accepted contract
   information sharing and may export audited CSV utilisation evidence.
10. Uploaded employee CSVs replace the active exact-email eligibility set while
    retaining removed import rows as evidence. SSO is deliberately outside this
    implementation.

## Consequences

- Learning, SCORM, surveys, progress, and certificates remain unaware of
  enterprise commercial rules.
- A contract may cover a course whose current published version changes; the
  exact version is fixed only when an individual entitlement is issued.
- Contract coverage and domains may be prepared in draft but cannot be silently
  rewritten after activation. Employee eligibility and Access Owner assignments
  are operational lists with explicit, audited replacement/revocation history.
- Administrators receive a dedicated contract directory and lifecycle workflow;
  learners reuse the existing access-code entry and public course catalogue.
- Contract history and issued learning remain durable commercial evidence.
- Explicit administrator bulk-enrolment is bounded to 5,000 claim/course
  combinations per operation so a large contract cannot create an unbounded
  database transaction. Larger populations require staged processing.

## Verification

The disposable-database verifier covers draft inactivity, domain and uploaded
exact-email eligibility, idempotent claims, lazy and consent-triggered automatic
enrolment, latest-version pinning, code rotation, covered Event registration,
renewal cloning, suspension/resumption/termination, immutable terms, preserved
existing access, and durable audit/origin evidence.
