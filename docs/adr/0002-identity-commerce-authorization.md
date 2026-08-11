# ADR 0002: Identity, commerce and authorization

## Status

Accepted.

## Decision

Better Auth owns credentials and sessions. Upskill owns application users,
organisations, permissions and impersonation audit records. Use direct Stripe
Checkout and verified idempotent webhooks; do not make a subscription-oriented
auth plugin authoritative for orders, grants or enrolments.

Install the official Better Auth Stripe plugin in non-subscription mode for its
identity/customer integration and authenticated Stripe boundary. It remains a
supporting adapter: application commerce tables and the direct fulfilment
webhook are authoritative.

Hosted Stripe Checkout handles single-course payment collection. Upskill
creates and prices orders from the current immutable course version, then
fulfils only from signature-verified webhook events after reconciling the
session, purchaser, version, amount and currency. Success redirects are display
surfaces, not payment authority.

## Consequences

Every private server function authorizes the active application user and target
resource. Domain access requires a verified email. Payment redirects never
fulfil orders without a matching webhook transaction.

Platform administrators are assigned in a dedicated application table and are
not inferred from Better Auth sessions or organisation roles. Administration
read functions authorize the assignment before running global statistics,
learner search or profile queries. Impersonation and manual progress changes use
separate audited commands with actor, timestamp and state-transition metadata.

Stable identity and historical attribution follow
[ADR 0022](0022-stable-identity-and-historical-attribution.md). Mutable email,
profile and current capability state never identify historical domain records.
Revoking a role or scoped assignment removes future authority without orphaning
the assignments, redemptions, learning evidence or audit records it previously
created.

Bulk access-code lifecycle and recovery are governed by
[ADR 0016](0016-administrator-access-grant-lifecycle.md) and
[ADR 0019](0019-encrypted-recoverable-access-codes.md). Grant capacity is
serialized with a database row lock before enrolment, audit and outbox writes
commit together. Retrieval and capacity changes are authorized and audited, and
codes and their cryptographic representations are excluded from logs, generic
reports, queue payloads and audit metadata.
