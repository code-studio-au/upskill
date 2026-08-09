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
Platform administration is an explicit application-table assignment, separate
from organisation membership. Aggregate statistics, validated learner search
and immutable-version enrolment profiles are read boundaries. Manual module and
course completion corrections use a separate audited command boundary with
append-only actor, timestamp and state history. Impersonation remains a later,
separately audited session capability and is not implied by either boundary.

The application uses nonce-based script CSP with no script `unsafe-inline`.
Mantine is styled primarily through CSS Modules. Mantine's CSS-variable style
attributes are the documented `style-src-attr 'unsafe-inline'` exception;
generated style elements require the request nonce.

## Data model

Stable identities (`course`, `module`, `survey`, `event_template`) are separated
from immutable published versions. Enrolments snapshot exact versions so later
publishing cannot rewrite learner history. Administrative completion changes are
append-only overrides with actor, timestamp and state. Module overrides take
precedence over SCORM evidence without rewriting attempts; the latest explicit
course override takes precedence over derived module completion. The enrolment
completion projection and corresponding outbox event change in the same
transaction.

Orders and contracts create access grants. Atomic redemptions create enrolments.
Verified email domains may restrict discovery and redemption. Stripe confirms
payment, while Upskill remains authoritative for fulfilment.
Single-course Checkout snapshots the published course version and price in an
order item before redirecting to Stripe. A raw-body, signature-verified webhook
reconciles the session to that snapshot and serializes replay-safe fulfilment on
the order row; the browser success redirect only reads the resulting status.
Access codes are normalized and stored only as HMAC digests protected by an
independent generated secret. Redemption locks the grant row and commits the
capacity update, enrolment, audit event and outbox event in one transaction.
Learner workspace reads are scoped by both the opaque enrolment identifier and
the authenticated user. They resolve the exact enrolled course version and
reject expired or removed access before any learning content is exposed;
completed enrolments remain reviewable while their access window is valid.

## Content and asynchronous work

S3 buckets separate quarantine uploads, immutable learning content, private
resources/certificates and deployment artifacts. SCORM runs on a dedicated
learning origin so package scripts do not receive the main application's auth
cookies. CloudFront signed cookies authorize package file trees.
Package versions, course-version mappings and learner attempts are immutable or
append-only records. Five-minute launch credentials are stored only as SHA-256
digests and exchanged on the learning origin for HTTP-only, attempt-scoped
sessions. Progress commits recheck enrolment access and serialize completion so
replayed final commits cannot duplicate completion events.
Quarantined SCORM archives are digest-verified and processed under explicit ZIP
entry, expanded-size and manifest-profile limits. Extraction rejects traversal,
links, encryption and duplicate paths before immutable conditional writes to the
learning-content bucket. Validation rejection codes and processing timestamps
are retained on the package version for administration and support.
Administrators upload archives through a same-origin, authenticated route that
requires a declared length, streams at most 250 MB directly to quarantine and
calculates the source digest incrementally. The browser never receives object
store credentials, and the buckets do not need browser CORS access. nginx keeps
the normal 2 MB request limit and grants the larger unbuffered limit only to the
exact upload route.
Terminal package versions can be removed only while no course-version mapping
or SCORM attempt references them. The database removal and audit event commit
with an outbox cleanup request; the worker then idempotently clears only that
version's quarantine and immutable-content prefixes.

A transactional outbox dispatcher and SQS-backed worker handle Stripe
fulfilment, SCORM extraction, certificates, email and scheduled rules. The
dispatcher publishes versioned envelopes after the domain transaction commits;
consumers delete messages only after idempotent handlers reach a terminal
outcome. Long-running work extends its visibility lease, transient failure is
redelivered, and poison jobs move to a dead-letter queue after five receives.
ElasticMQ provides the same queue API, visibility and redrive boundary in local
Docker development; AWS SQS is the deployed transport.

Business and security audit records commit with their domain changes in an
append-only PostgreSQL ledger. Each retained record also enqueues a sanitized,
versioned log projection. The worker emits that projection only after commit,
using its stable event identifier so duplicate delivery can be collapsed by an
observability sink. It drains bounded outbox batches and uses a non-blocking SQS
receive after outbox work, avoiding long-poll throughput caps without starving
SCORM messages. Reconstructable SCORM lifecycle and launch telemetry is
logged operationally instead of duplicating domain state. Structured JSON from
the web and worker services flows to journald; a future Datadog Agent collects
that stream without introducing Datadog calls into request or mutation paths.

## AWS topology

CDK defines staging and production instances of separated network, data,
storage/messaging and application stacks. PostgreSQL and S3 are private and
encrypted. An ALB fronts EC2 Auto Scaling instances running nginx, the Start web
process and a separately hardened worker process. GitHub Actions authenticates
to AWS through OIDC, builds both processes once and promotes the same
content-addressed artifact.

## Quality attributes

- Mobile-first layouts with CSS media/container queries.
- WCAG-oriented keyboard, focus, contrast and touch-target behaviour.
- Typed, size-limited and normalized server boundaries.
- Fresh-database and upgrade migration verification.
- Deterministic bundle budgets enforced after every production build: total
  client assets, largest JavaScript chunk, root preload gzip cost and maximum
  incremental route JavaScript/CSS gzip cost. Route budgets force feature code
  behind route boundaries before the root bundle becomes difficult to split.
- Chromium, Firefox and WebKit critical-path smoke coverage.
- Transactional append-only audit records with committed structured-log
  projections, sanitized operational/error events, request correlation and
  deployment identity output suitable for journald and future Datadog intake.
