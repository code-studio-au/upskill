# ADR 0006: Runtime and dependency cohorts

## Status

Accepted.

## Decision

Pin Node 26.7.0 and pnpm 11.0.8. Use TypeScript 7 for `tsc`, with the TypeScript
6 compatibility API only where tooling requires it. Upgrade exact-pinned
TanStack, React, Mantine, TypeScript/tooling, Better Auth, AWS and test cohorts
as compatible cohorts. pnpm enforces a seven-day minimum release age for new
dependency versions; there are no package exclusions from that cooling-off
period.

## Consequences

Security fixes may therefore require an explicit, reviewed exception or a
version already older than seven days. Audit, lockfile integrity, restricted
build scripts, the release-age verifier and full cohort verification remain
mandatory; findings are repaired rather than suppressed.
