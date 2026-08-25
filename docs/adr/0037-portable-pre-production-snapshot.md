# ADR 0037: Portable pre-production snapshot fixture

## Status

Accepted and implemented.

## Context

The pre-baseline local database contained useful current authoring data and
event operational states that would be expensive and error-prone to recreate by
hand. The schema baseline is now frozen, so preserving that data cannot depend
on replaying obsolete tables or rewriting migrations. Staging also needs
representative data and one approved real mobile number to exercise TextBee SMS
verification, while production must never accept fixture data.

## Decision

Maintain one reviewed, current-schema relational snapshot in Git and keep its
binary offering/SCORM assets in a separately transferred protected bundle. The
snapshot contains current authored versions and operational evidence, uses only
reserved fictional phone numbers, strips credentials/provider identifiers and
excludes delivery/outbox/transient records.

The loader:

- runs only in development, test or staging and rejects production before
  parsing the deployed runtime environment;
- requires an exact staging confirmation and a root-controlled operator
  environment;
- creates fresh credential hashes and encrypted access codes using the target
  environment keys;
- preserves existing staging users by case-insensitive email and remaps all
  fixture references to their IDs;
- uploads integrity-checked private assets and SCORM content without replacing
  existing objects;
- inserts relational data atomically, treats a complete rerun as a no-op and
  rejects partial fixture state; and
- accepts an Australian E.164 SMS test override only in staging, setting the
  selected learner to enabled but unverified with no active phone claim.

The real staging number, fixture password and binary asset bundle are never
committed. Operational transfer must not place those values in CI or SSM command
logs.

## Consequences

Local development can reset onto the frozen schema without losing the valuable
fixture topology, and staging can reproduce it without resetting its database
or overwriting the bootstrap administrator. Seeded communication definitions
are retained, but no historical delivery or pending work can be replayed.
Maintainers must update or replace the fixture when current schema constraints
change; it is not a migration mechanism and creates no exception to ADR 0021.
