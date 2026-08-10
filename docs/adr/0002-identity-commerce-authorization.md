# ADR 0002: Identity, commerce and authorization

Status: Accepted

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

Bulk access codes are stored as canonical plaintext values so authorized
administrators can retrieve them for customers. A normalized PostgreSQL unique
index provides direct equality lookup without a separate application secret.
Grant capacity is serialized with a database row lock before enrolment, audit
and outbox writes commit together. Retrieval and capacity changes are authorized
and audited, and codes are excluded from log and audit metadata.
