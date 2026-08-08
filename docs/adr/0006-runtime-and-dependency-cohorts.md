# ADR 0006: Runtime and dependency cohorts

Status: Accepted

## Decision

Pin Node 26.7.0 and pnpm 11.0.8. Use TypeScript 7 for `tsc`, with the TypeScript
6 compatibility API only where tooling requires it. Upgrade exact-pinned
TanStack, React, Mantine, TypeScript/tooling, Better Auth, AWS and test cohorts
to the newest compatible releases without a release-age delay.

## Consequences

The project accepts early-release compatibility risk in exchange for staying
current. Audit, lockfile integrity, restricted build scripts and full cohort
verification remain mandatory; findings are repaired rather than suppressed.
