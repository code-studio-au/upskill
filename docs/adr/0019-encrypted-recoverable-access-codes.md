# ADR 0019: Encrypted recoverable access codes

## Status

Accepted; implementation pending.

## Context

Organisation access codes are human-readable credentials. Learners must be able
to enter them, and authorised administrators must be able to retrieve the exact
code when a customer loses it. One-way password hashing cannot support that
recovery requirement. Plaintext database storage makes every active code
available to anyone who obtains a database snapshot, while randomized
authenticated encryption alone cannot provide indexed lookup from an arbitrary
submitted code.

The current implementation stores canonical plaintext codes and uses a
normalized PostgreSQL expression index. That remains the executable truth until
the migration described here is delivered.

## Decision

Store each complete access code as authenticated ciphertext rather than
plaintext. The server generates a non-secret, unique opaque lookup identifier and
includes it as a stable segment of the human-readable code. PostgreSQL stores and
uniquely indexes that identifier as an ordinary value. The memorable code body
and lookup segment together form the exact code shown to administrators and
entered by learners.

Redemption parses the lookup identifier, selects one grant by normal indexed
lookup, decrypts that grant's ciphertext and compares the complete normalized
submitted code before applying any grant policy. This avoids a separately
managed HMAC lookup key while preventing a database-only disclosure from
revealing the complete credential.

The authenticated-encryption key remains outside PostgreSQL under the
application secret-management boundary. Persist a key version with the
ciphertext so controlled rotation remains possible.

The intended record contains:

- a server-generated, unique, non-secret lookup identifier included in the
  displayed code;
- authenticated ciphertext for the canonical display code;
- the encryption nonce and authentication data required by the selected
  authenticated-encryption construction; and
- a key version or key identifier.

Redemption extracts the lookup identifier from learner input, selects the unique
grant, decrypts and compares only that candidate, locks the grant row, and
retains the existing eligibility, capacity, expiry and revocation transaction.
Administrator retrieval selects the grant by its ordinary grant identifier,
reauthorizes the administrator, decrypts only that code, and retains the existing
durable retrieval audit event.

Codes, ciphertext and key material are excluded from logs, generic reports,
queue payloads and audit metadata. The public lookup identifier may appear only
where operationally required and never counts as proof of possession. Directory
queries never decrypt codes in bulk.

## Migration and rollout

Because Upskill is pre-production and its data is disposable, replace/reissue
current codes in the reset baseline rather than retain a dual-read compatibility
path. Introduce the encrypted columns, unique lookup identifier and versioned
encryption secret before removing plaintext. Verify lookup, comparison and
authorized recovery; new writes must never fall back to plaintext.

If key rotation is required, new writes use the active version while reads may
temporarily accept prior versions. Re-encryption is explicit, observable and
restart-safe.

## Consequences

Administrators retain exact code recovery and learners retain human-readable
entry. A database-only disclosure no longer directly reveals active codes. The
application now depends on available key material for creation, redemption and
retrieval, so key backup, rotation, deployment access and failure behaviour become
operational responsibilities.
The generated lookup segment makes the final code slightly longer, but it
remains readable and stable when capacity changes.

This ADR supersedes only the plaintext-storage and plaintext-lookup portions of
[ADR 0016](0016-administrator-access-grant-lifecycle.md). ADR 0016's grant
lifecycle, capacity locking, eligibility, revocation and audited retrieval
decisions remain accepted.
