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

## Consequences

Every private server function authorizes the active application user and target
resource. Domain access requires a verified email. Payment redirects never
fulfil orders without a matching webhook transaction.
