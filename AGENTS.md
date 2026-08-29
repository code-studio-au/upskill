# Upskill agent guide

These instructions apply to the entire repository. Read them before changing code, and preserve any unrelated work already present in the working tree.

## Environment and local development

- Use Node.js 26 (the repository currently targets 26.7.0), pnpm 11, and the checked-in `pnpm-lock.yaml`. Use `pnpm`, not npm or yarn.
- Copy `.env.example` to `.env.local` for local configuration. Treat `.env.example` as the public configuration contract; never commit `.env.local`, credentials, tokens, signing secrets, production data, or secret values printed by a command.
- Start PostgreSQL with `docker compose up -d`. Run `pnpm run db:migrate` when migrations are needed. `pnpm run dev` selects Node 26, loads `.env.local`, applies pending migrations, and starts the web, learning, worker, and optional Stripe-forwarding processes.
- A missing, unauthenticated, or offline Stripe CLI must not prevent non-Stripe local development. Live checkout and webhook forwarding still require internet access and an authenticated Stripe CLI.
- Do not reset, reseed, delete, or destructively rewrite a database, object-storage bucket, deployment, or user data unless the user explicitly requests that operation and the exact environment is confirmed.

## Architecture and security boundaries

- Keep the TanStack Start application router-first. Validate every network and form boundary with the repository's Zod schemas, and use typed server functions rather than ad hoc request handling.
- Authorization is enforced on the server for every protected operation, including resource ownership and role checks. Route guards and hidden controls are user-experience measures, not security controls.
- Database access, secrets, Stripe, AWS clients, and other privileged integrations belong in server-only modules (normally `*.server.ts`) and must never enter the browser dependency graph.
- Preserve immutable published versions, learner evidence, delivery history, audit records, and contractual snapshots. Model corrections as explicit new state or append-only history rather than overwriting evidence.
- Keep asynchronous and webhook processing idempotent. Preserve transaction boundaries, stable deduplication keys, retry safety, and outbox observability.
- Never weaken CSP, authentication, validation, rate limiting, audit logging, or tenant/role boundaries to make an implementation or test pass.

## UI conventions

- Build mobile-first, responsive interfaces with semantic HTML and CSS Modules/static CSS. Support keyboard operation, visible focus, useful labels, adequate touch targets, and sensible narrow-screen layouts.
- Mantine 9 is the component foundation. Reuse primitives from `#/features/shared/mantine` and the dedicated shared form wrappers such as `MantineTextInput`, `MantineCheckbox`, and `MantineNativeSelect`; keep direct `@mantine/core` imports inside the shared compatibility boundary so styling, accessibility, CSP, and future upgrades remain consistent.
- Upskill uses a strict nonce-based CSP. Do not add inline style attributes, inline scripts, unsafe-eval, or new CSP exceptions. The existing Mantine compatibility exception is not permission to broaden the policy.
- Reuse shared controls, feedback patterns, status pills, filters, layout primitives, and date helpers before introducing a new variation.
- Display user-facing dates in Australian format through the shared `formatLocalDate`/`formatLocalDateTime` helpers. Keep stored instants and event time zones explicit; do not hand-format dates in components.
- Use TanStack Table for growing operational datasets that benefit from sorting, filtering, expansion, and pagination. Prefer server-side pagination and URL-backed search state. Use purpose-built semantic layouts for small, ordered, hierarchical, or workflow-oriented content.
- Keep route-level and conditional UI split from the root bundle. Treat deterministic client-bundle budgets as architectural constraints; fix an accidental dependency or split the route instead of raising a budget merely to pass CI.

## Database changes

- Migrations `0001` through `0072` are the frozen baseline. Add only the next sequential, forward-only Kysely migration; do not edit an applied migration or reset a database as a migration strategy.
- Use expand-and-contract changes when retained staging or production data is involved. Preserve snapshots, history, foreign-key integrity, and rollback/deployment compatibility.
- Update generated database types and focused database verification when a schema changes. Run the relevant `db:verify:*` command while iterating and `pnpm run verify:db:gate` before handing off a database slice.

## Dependencies

- Keep dependency versions exact and respect tested framework cohorts. Do not change `package.json`, the lockfile, patches, or dependency versions unless the task requires it or the user approves it.
- Preserve pnpm's seven-day `minimumReleaseAge` and do not add `minimumReleaseAgeExclude` entries.
- When a patched dependency is required in a container build, ensure every pnpm-install stage receives the checked-in `patches/` directory.

## Verification and self-review

- Run the narrowest relevant test during implementation, inspect failures, fix the root cause, and rerun the exact failed command.
- For application code, run `pnpm run verify:app` before handoff. It covers repository security, migration policy, dependency cohorts/audit, formatting, linting, React diagnostics, types, dead code, coverage, production builds, and bundle budgets.
- For infrastructure changes, run `pnpm run verify:cdk`. For database changes, run `pnpm run verify:db:gate`. `pnpm run verify:ci` runs all three broad gates.
- For user-flow or responsive UI changes, run the relevant browser partition: `pnpm run test:e2e:core`, `pnpm run test:e2e:scorm`, `pnpm run test:e2e:admin`, or `pnpm run test:e2e:https`. Use `pnpm run test:e2e` for the full browser suite when the risk or request warrants it.
- Do not claim a gate passed unless it completed successfully in the current work. If a required gate cannot run, report the exact blocker and which narrower checks did pass.
- Before handoff, review the diff for authorization gaps, missing validation, mutable historical data, CSP/style violations, dependency or bundle growth, migration safety, Australian date formatting, accessibility, responsive overflow, and accidental secret or generated-file inclusion.

## Git and delivery

- Inspect `git status`, the current branch, and the diff before editing and again before handoff. Do not discard, overwrite, or commit unrelated user changes.
- Do not commit, push, open or edit a pull request, merge, deploy, or mutate external services unless the user asks for that action.
- When asked to commit and open a pull request, run the relevant gates, commit only the intended slice, push its branch, and open a draft PR unless the user explicitly requests a ready-for-review PR.
- Pull-request descriptions should state the outcome, important implementation decisions, verification actually run, and any deployment, migration, or operational considerations. Address review comments with a focused regression test where practical.
