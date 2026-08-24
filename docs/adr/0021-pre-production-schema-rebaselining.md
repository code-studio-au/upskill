# ADR 0021: Pre-production schema rebaselining

## Status

Accepted. The temporary rewrite window closed on 2026-08-24 when migration
baseline v1 froze migrations `0001` through `0072`.

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

Before the production-baseline trigger below, maintainers could rewrite
existing migrations and reset local/CI PostgreSQL data when an accepted
breaking domain decision benefited from a clean schema. The resulting migration
sequence had to:

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

## Production-baseline activation

Before the first environment containing non-disposable data is created, or
before any external user is admitted, whichever happens first, maintainers
must:

1. record and tag the accepted migration baseline;
2. remove permission to rewrite executed migration files;
3. require forward-only migrations from that baseline;
4. use expand/contract for rolling-deployment compatibility; and
5. add upgrade-path verification wherever retained data must be transformed.

Baseline v1 is recorded in `src/server/db/migration-baseline-v1.sha256` and its
activation commit is identified by the `schema-baseline-v1` Git tag. The
application verification gate hashes every frozen migration and requires all
later migrations to remain sequential. Migration `0073` is the first
forward-only change.

After this trigger, a reset is not an acceptable migration strategy for local,
staging or production data. Any exception requires a new ADR and an explicit
data preservation or disposal decision.

## Consequences

The temporary reset permission kept the initial schema coherent while the
local-only product model changed quickly. That permission is now closed.
Developers and deployed environments upgrade retained data through forward-only
migrations governed by [ADR 0007](0007-aws-deployment-and-verification.md).
