# ADR 0016: Administrator-managed access-grant lifecycle

## Status

Partially superseded by
[ADR 0019: Encrypted recoverable access codes](0019-encrypted-recoverable-access-codes.md).
The grant lifecycle remains accepted; the plaintext-storage and lookup decision
below is retained as historical context.

## Decision

Platform administrators may issue access codes for one exact published course
version. Each grant records an operator-facing label, organisation, capacity,
learner access duration, optional code expiry and zero or more normalized email
domains. Creating a grant may reuse an existing case-insensitive organisation
name or create its stable identity inside the same transaction. Draft versions
and archived courses are not valid targets.

A finite grant chooses one reusable shared code or a generated batch containing
one unique single-use code per enrolment. Increasing shared-code capacity keeps
the code unchanged. Increasing batch capacity appends new codes; batch capacity
cannot be reduced because unused codes may already have been distributed.

Administrators choose a memorable code containing letters, numbers and readable
separators. Upskill stores its uppercase, hyphen-separated canonical form as
plaintext so an authorized administrator can retrieve it when a customer loses
the original. A PostgreSQL functional unique index removes presentation
separators for direct, case-insensitive equality lookup. No HMAC digest or
independently managed access-code secret is retained. Codes are deliberately
recoverable from database state and are therefore credentials with operational,
not high-security, secrecy; they are never included in logs or audit metadata.

Redemption retains the existing serialized grant-row boundary: it rechecks
publication, optional verified-email domains, capacity, expiry and revocation
before atomically creating the exact-version enrolment and incrementing usage.
Email domains are optional because some customer organisations do not have a
consistent domain. An administrator may update total capacity without changing
the code, including after a further bulk purchase, but cannot reduce it below
the number of places already redeemed.
Revocation is a timestamped terminal transition that prevents discovery and new
redemptions without deleting the grant, existing enrolments, learning evidence
or audit history. Repeated revocation is an idempotent no-op.

Creation, code retrieval, capacity changes and first revocation commit
append-only administrator audit evidence and sanitized transactional log
projections. Neither projection contains the plaintext code. The administrator
directory exposes bounded recent grants and recent linked enrolments; codes are
loaded only through the explicit audited retrieval command rather than included
in the directory response. High-volume reporting and pagination remain a future
read model.

## Consequences

Contract and organisation access can be managed with codes that customers can
enter and support staff can recover. Plaintext storage accepts greater impact
from a database disclosure in exchange for that operational requirement; the
normal application boundary still limits retrieval to platform administrators
and records each retrieval. Domain-restricted discovery and redemption use the
same grant record, so revocation cannot leave catalogue visibility active.
Customer-purchased bulk packages can later create the same domain object while
keeping Stripe order ownership and fulfilment separate from administrative
issuance.

The migration cannot recover codes from any legacy digest-only grants. Such
grants remain historical purchase records but must be reissued before they can
be redeemed as administrator-managed codes.
