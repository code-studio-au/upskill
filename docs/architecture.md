# Architecture specification

## Purpose

Upskill provides a public course and event catalog, authenticated purchasing,
bulk and contract access grants, versioned learning content, embedded SCORM,
surveys, certificates, scheduled communications and audited administration.

## Application model

The application follows TanStack Start's router-first model:

- File-based TanStack Router routes are the URL and rendering contract.
- Zod validates search parameters and every network input.
- Route loaders fetch data through typed server functions.
- Public catalog routes use full-document SSR and streaming.
- Authenticated data-heavy routes may use data-only SSR.
- Highly interactive administration surfaces may opt out of SSR deliberately.
- Server functions serve same-origin application calls; server routes serve
  Stripe, Better Auth and other external callers.
- Database, secrets, Stripe and AWS clients stay in `.server.ts` modules marked
  with `@tanstack/react-start/server-only`.

## Runtime and dependencies

Node 26.7.0 and pnpm 11.0.8 are pinned across development, CI, CDK and EC2.
TypeScript 7 is the authoritative compiler. The TypeScript 6 compatibility
package exists only while lint or ecosystem tools require its programmatic API.
Critical dependencies are exact-pinned and upgraded as coherent cohorts without
a release-age delay.

## Web and security boundaries

The public catalog, learner application and admin application share one Start
codebase and explicit server authorization boundaries. Better Auth owns identity
and sessions; application tables own roles, organisations, enrolments and
entitlements. Route guards improve UX but never replace server-side checks.

The application uses nonce-based script CSP with no script `unsafe-inline`.
Mantine is styled primarily through CSS Modules. Mantine's CSS-variable style
attributes are the documented `style-src-attr 'unsafe-inline'` exception;
generated style elements require the request nonce.

## Data model

Stable identities (`course`, `module`, `survey`, `event_template`) are separated
from immutable published versions. Enrolments snapshot exact versions so later
publishing cannot rewrite learner history. Administrative completion changes are
append-only overrides with actor, reason and timestamp.

Orders and contracts create access grants. Atomic redemptions create enrolments.
Verified email domains may restrict discovery and redemption. Stripe confirms
payment, while Upskill remains authoritative for fulfilment.

## Content and asynchronous work

S3 buckets separate quarantine uploads, immutable learning content, private
resources/certificates and deployment artifacts. SCORM runs on a dedicated
learning origin so package scripts do not receive the main application's auth
cookies. CloudFront signed cookies authorize package file trees.

A transactional outbox and SQS-backed worker handle Stripe fulfilment, SCORM
extraction, certificates, email and scheduled rules. Every job is idempotent and
failed jobs move to a dead-letter queue.

## AWS topology

CDK defines staging and production instances of separated network, data,
storage/messaging and application stacks. PostgreSQL and S3 are private and
encrypted. An ALB fronts EC2 Auto Scaling instances running nginx, the Start web
process and a worker process. GitHub Actions authenticates to AWS through OIDC,
builds once and promotes the same content-addressed artifact.

## Quality attributes

- Mobile-first layouts with CSS media/container queries.
- WCAG-oriented keyboard, focus, contrast and touch-target behaviour.
- Typed, size-limited and normalized server boundaries.
- Fresh-database and upgrade migration verification.
- Deterministic client bundle budgets.
- Chromium, Firefox and WebKit critical-path smoke coverage.
- Structured request, audit and deployment identity logging.
