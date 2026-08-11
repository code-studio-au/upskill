# ADR 0021: Pre-production schema rebaselining

## Status

Accepted as a temporary pre-production policy.

## Context

Upskill has no production deployment or real user data. Local and CI databases
are disposable, and another batch of breaking domain changes is expected. At
this stage, retaining compatibility tables and translating synthetic history
would make the intended schema harder to understand and constrain later design
without protecting any real records.

The production deployment ADR otherwise requires forward-safe expand/contract
migrations. That remains the correct policy once durable environments or real
data exist, but applying it before the first production baseline would create
cost without a corresponding safety benefit.

## Decision

Until the production-baseline trigger below, maintainers may rewrite existing
migrations and reset local/CI PostgreSQL data when an accepted breaking domain
decision benefits from a clean schema. The resulting migration sequence must:

- build a fresh database from zero;
- pass the complete schema and database behaviour gates;
- remove obsolete compatibility structures rather than leave two executable
  models;
- keep fixture/object deletion precisely scoped and explicit; and
- update current-state documentation and authoritative database types in the
  same change.

This exception applies to database migration history, not to product history.
Published Learning Activity Versions, published Course Versions, learner
evidence, audit records and other domain-history invariants remain immutable in
the running product.

## Production-baseline trigger

Before the first environment containing non-disposable data is created, or
before any external user is admitted, whichever happens first:

1. record and tag the accepted migration baseline;
2. remove permission to rewrite executed migration files;
3. require forward-only migrations from that baseline;
4. use expand/contract for rolling-deployment compatibility; and
5. add upgrade-path verification wherever retained data must be transformed.

After that trigger, a reset is not an acceptable migration strategy for staging
or production data. Any exception requires a new ADR and an explicit data
preservation or disposal decision.

## Consequences

The schema can remain coherent while the local-only product model is still
changing quickly. Developers may need to reset `.local/postgres` after pulling a
branch that rewrites the baseline. That cost is deliberate and temporary.

The repository must not claim that migration history is always forward-only
during this phase. [ADR 0007](0007-aws-deployment-and-verification.md) remains
authoritative for production deployment, with this ADR defining the temporary
pre-production exception.
