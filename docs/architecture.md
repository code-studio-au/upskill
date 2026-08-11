# Architecture specification

For the broader product and domain design, recommended future direction, and
engineering governance, see the [Architecture Handbook](architecture/README.md).
Accepted architectural decisions remain indexed in the [ADR
collection](adr/README.md). This document is the concise specification of the
implemented application architecture.

## Purpose

Upskill currently provides a public course catalogue, authenticated purchasing,
organisation access grants, versioned course/SCORM/survey/PDF content,
certificates, transactional background work and audited administration. The
broader handbook identifies Events, enterprise contracts and notifications as
Target Product capabilities rather than implemented features.

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
Course administration exposes a bounded, newest-first learner roster across all
immutable versions, with effective active, completed, expired and removed state
and links back to the existing enrolment-scoped progress boundary.
Administrators can grant an existing learner access to an exact published
version and soft-remove that access. Re-adding a removed or expired exact-version
enrolment restores its retained progress and completion history rather than
creating a competing learner record. Each transition is serialized and audited.
Administrators can also issue capacity-limited organisation access codes for an
exact published version and revoke further use without changing enrolments that
already exist. The administration route is kept behind its own client route
boundary.

The application uses nonce-based script CSP with no script `unsafe-inline`.
Mantine is styled primarily through CSS Modules. Mantine's CSS-variable style
attributes are the documented `style-src-attr 'unsafe-inline'` exception;
generated style elements require the request nonce.

## Data model

Stable `course` and `learning_activity` identities are separated from version
records. `learning_activity_version` is the common version envelope; SCORM,
survey and resource child tables own validated type-specific content. Course
items reference one exact common activity version and matching kind. Published
learning versions are immutable, and enrolments snapshot exact course versions
so later publishing cannot rewrite learner history. Administrative completion
changes are append-only overrides with actor, timestamp and state. Module
overrides take precedence over SCORM evidence without rewriting attempts; the
latest explicit course override takes precedence over derived module completion.
The enrolment completion projection and corresponding outbox event change in the
same transaction.

Paid orders and administrator actions create access grants or enrolments. Atomic
redemptions create enrolments. Verified email domains may restrict discovery and
redemption. Stripe confirms payment, while Upskill remains authoritative for
fulfilment.
Single-course Checkout snapshots the published course version and price in an
order item before redirecting to Stripe. A raw-body, signature-verified webhook
reconciles the session to that snapshot and serializes replay-safe fulfilment on
the order row; the browser success redirect only reads the resulting status.
Administrator-issued access codes are canonical human-readable values stored as
plaintext in the current implementation so authorized staff can retrieve them
for customers. PostgreSQL uses a unique normalized-code index for equality
lookup. [ADR 0019](adr/0019-encrypted-recoverable-access-codes.md) accepts a
pre-production migration to authenticated ciphertext plus a generated public
lookup ID embedded in the displayed code. Redemption will select one row by that
ordinary indexed ID, decrypt it and compare the complete code; no separate HMAC
lookup key is required. That target must not be described as implemented until
the migration and runtime boundary land. Codes and their cryptographic forms are
never written to logs or audit metadata. Retrieval is an explicit authorized
command with durable audit evidence. Redemption locks the grant row and commits
the capacity update, enrolment, audit event and outbox event in one transaction.
Grants bind an organisation, capacity, learner access duration, optional expiry
and optional normalized email domains. Administrators may change total capacity
without changing the code, but cannot reduce it below the number already
redeemed. Timestamped revocation removes the grant from domain discovery and
causes later redemption to fail while preserving the grant and its existing
enrolments as historical evidence.
Learner workspace reads are scoped by both the opaque enrolment identifier and
the authenticated user. They resolve the exact enrolled course version and
reject expired or removed access before any learning content is exposed;
completed enrolments remain reviewable while their access window is valid.

Course versions contain ordered sections and ordered items. Every item points to
one exact Learning Activity Version, discriminated as SCORM, survey or PDF
resource. Published versions are immutable; an author must explicitly create a
new draft version before reordering or removing content. Archiving removes a
course from discovery while retaining history. Permanent deletion requires an
archived course with no enrolment, order-item or access-grant references.
Learner item evidence is stored, while section completion is derived from
required items so it cannot drift from module, survey or resource progress.
Content libraries expose the exact linked course version and its draft,
published and archived state so administrators can understand reference and
removal boundaries.

Published survey versions contain validated written, single-choice and
multiple-choice questions. Learner responses are entitlement-scoped to an
exact course-version item, validated against its published survey version and
stored as immutable evidence without answer content entering centralized logs.

## Content and asynchronous work

S3 buckets separate quarantine uploads, immutable learning content, private
resources and deployment artifacts. SCORM runs on a dedicated
learning origin so package scripts do not receive the main application's auth
cookies or weaken the primary application's CSP. The application embeds the
attempt player in a sandboxed iframe. Rise's required inline-script, inline-style
and evaluation compatibility policy exists only on attempt-scoped responses
from that learning origin. An authorized streaming proxy rechecks the attempt
session before exposing each immutable package file.
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

PDF resources use immutable digest-addressed keys in the private resource
bucket. The browser uploads through a same-origin administrator boundary that
validates declared size, media type and PDF signature; it never receives S3
credentials. Learner downloads recheck the authenticated enrolment and exact
course-version item before returning private, non-cacheable bytes. A successful
resource read records item completion and therefore participates in derived
section progress. Administrators manage stable resources and immutable versions
in a shared library. A version can be removed only when no draft or published
course item references it; removal commits its durable audit event and exact-key
cleanup request atomically, then the content worker deletes the private object.

Completion certificates are derived documents rather than persisted domain
state. A same-origin authenticated download rechecks ownership, the exact
enrolled course version, its certificate setting and the enrolment's current
completed state, then renders the PDF synchronously and returns private,
non-cacheable bytes. No certificate database row, S3 object, queue command or
issuance audit record exists. An administrator completion override removes
download eligibility immediately; recompletion restores it immediately.

A transactional outbox dispatcher and SQS-backed worker handle Stripe
fulfilment, SCORM extraction, resource cleanup, email and scheduled rules. The
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

Builds contain integrity-verified Brotli and gzip sidecars for compressible
client assets. The secure local production preview serves Brotli over TLS with
gzip and identity fallback; streamed SSR remains dynamically gzip-compressed.
Deployment Nginx enables its standard gzip module. Production Brotli delivery
will use only a separately verified module or edge/CDN capability rather than
compiling third-party code during instance boot.

Runtime artifacts contain no source maps. Local Vite development retains
source-level debugging. Future Datadog error symbolication must generate and
upload private client, server and worker maps keyed to the exact deployment
identity, then remove them before the immutable release archive is created.
Without that upload, production errors identify generated bundles rather than
the original TypeScript file and line.

The Node listener is loopback-only. Deployments explicitly enable its trusted
proxy mode so Nginx's overwritten `X-Real-IP` reaches BetterAuth rate limiting;
direct local launches replace any client-supplied value with the socket address.

## Quality attributes

- Mobile-first layouts with CSS media/container queries.
- WCAG-oriented keyboard, focus, contrast and touch-target behaviour.
- Typed, size-limited and normalized server boundaries.
- Fresh-database and upgrade migration verification.
- Deterministic bundle budgets enforced after every production build: total
  client assets, total Brotli wire size, largest JavaScript chunk, root preload
  gzip cost and maximum incremental route JavaScript/CSS gzip cost. Route
  budgets force feature code behind route boundaries before the root bundle
  becomes difficult to split.
- TanStack Form and Zod own interactive mutation form state and validation;
  router-backed catalogue filters remain native GET forms. Server and upload
  boundaries parse every payload independently of browser validation.
- Chromium, Firefox and WebKit critical-path smoke coverage.
- Transactional append-only audit records with committed structured-log
  projections, sanitized operational/error events, request correlation and
  deployment identity output suitable for journald and future Datadog intake.

While the product has no non-disposable environment or real users, the
pre-production policy in
[ADR 0021](adr/0021-pre-production-schema-rebaselining.md) permits a deliberate
migration-chain rebase plus local/CI database reset. Fresh-database and complete
behaviour gates are authoritative during this temporary phase. Forward-only
expand/contract migrations become mandatory at the production-baseline trigger;
published content and learner evidence remain historically immutable
throughout.
