# Upskill

Upskill is a mobile-first learning commerce platform built with TanStack Start,
Mantine, Better Auth, PostgreSQL and AWS.

## Runtime

- Node.js 26.7.0
- pnpm 11.0.8
- TypeScript 7 for authoritative type checking
- TypeScript 6 compatibility API only for tools that require it

## Local setup

```sh
cp .env.example .env.local
pnpm install
docker compose up -d
pnpm run db:migrate
pnpm run db:seed:catalog
pnpm run db:seed:learner
pnpm dev
```

The local stack follows the Projex pattern: PostgreSQL, MinIO and ElasticMQ,
with durable database/object data under the ignored `.local/` directory. MinIO
exposes its S3 API on port 9020 and console on 9021, and initializes private
quarantine, learning-content and resource buckets. ElasticMQ
exposes its SQS-compatible API on port 9324 and web UI on 9325; its work queue,
15-minute visibility timeout and five-receive DLQ policy match CDK. `pnpm dev`
starts Vite for the application on port 3000, the isolated learning origin on
port 3001 and the local SCORM worker, so asynchronous uploads are processed and
modules run inside the learner workspace. Use `pnpm dev:web` only when
deliberately running the learning origin and worker separately.

Local email is captured in PostgreSQL by default. To send it through Mailgun,
set `EMAIL_PROVIDER=mailgun`, `MAILGUN_API_KEY`, `MAILGUN_DOMAIN` and
`MAILGUN_FROM` in `.env.local`; use `MAILGUN_API_BASE_URL` for an EU-region
domain. `pnpm dev` already runs the notification consumer. Never commit the
domain sending key.

The project is currently pre-production with no real data. Accepted breaking
domain changes may rebase the migration chain and require a reset of only
`.local/postgres`; see ADR 0021. This temporary policy ends before the first
non-disposable environment or external user, when the migration baseline is
frozen and all later schema changes become forward-only. Object-storage data is
not implicitly removed by a database reset.

To exercise the production asset and HTTP-compression path locally, run:

```sh
pnpm run preview:https
```

This builds the application, generates an ignored local CA and signed localhost
certificate under `.local/tls`, then serves the application at
`https://localhost:3443` and learning content at `https://localhost:3444`.
Trust `.local/tls/upskill-local-ca.crt` once in the development machine's
browser or operating-system keychain to remove certificate warnings. Static
compressible assets prefer Brotli with gzip fallback; real-time streamed SSR
uses gzip. Run `pnpm worker:scorm` separately when the secure preview also needs
asynchronous content processing. `pnpm dev` remains the faster HTTP/HMR loop.

Production runtime artifacts intentionally exclude source maps. `pnpm dev`
still provides source-level TypeScript and React debugging. When Datadog error
tracking is enabled, CI must generate private source maps, upload them against
the exact deployment/release identifier and remove them before packaging
`dist`; otherwise production stack traces cannot resolve to exact source files
and line numbers.

Server and worker events are bounded structured JSON. `UPSKILL_LOG_LEVEL` may
be `info`, `warn`, `error` or `off` for operational events; committed audit
projections are always emitted. EC2 sends both service streams to journald so a
future Datadog Agent can collect them without application-level vendor coupling.
The public catalog reads immutable published course versions from PostgreSQL.
The catalog and account seed commands install
deterministic local and browser-test data; they are never run by production
deployment. `db:seed:learner` requires `SEED_LEARNER_PASSWORD`; it creates
verified `learner@example.com` and
`redeemer@example.com` accounts, the platform administrator
`admin@example.com`, and the local code
`EXAMPLE-LEARN-2026-EXAMP7E26X`. All three local
accounts use `SEED_LEARNER_PASSWORD`; administration starts at `/admin`.
For the complete multi-region event and eLearning fixture set, including real
local SCORM archives, see [local development data](docs/local-development-data.md).
Platform administrators manage quarantined SCORM uploads and package versions at
`/admin/modules`. Browser uploads stream through a bounded same-origin route;
they do not require direct MinIO/S3 access or a permissive bucket CORS policy.
The worker moves queued versions to ready or rejected after validation.
Administrators can remove terminal versions only when no course version or
learner attempt references them. Removal is audited, and an outbox job clears
the exact quarantine and learning-content prefixes with retry and DLQ support.
Each module version lists and links the exact draft, published or archived
course versions that reference it.
Course authoring is available at `/admin/courses`. Drafts contain reorderable
sections with exact SCORM, published-survey and private PDF resource versions.
Each course page also shows its newest learner enrolments across exact versions,
with effective access state and direct progress-review links. Administrators can
grant an existing learner access to a selected published version or soft-remove
access without deleting progress. Re-adding removed or expired access restores
the retained exact-version history.
Organisation access is managed at `/admin/access`. Administrators issue
capacity-limited codes for an exact published version with an enrolment duration,
optional expiry and optional verified-email domains. Administrators choose a
memorable code, can retrieve it later, and can increase or otherwise adjust its
capacity without replacing it; capacity cannot be reduced below places already
redeemed. Upskill appends a generated public lookup ID, stores the complete code
in an AES-256-GCM envelope and uses the ID for an ordinary indexed candidate
lookup before full-code comparison; see ADR 0019. It does not require a separate
HMAC lookup secret. Code retrieval and capacity changes are audited. Revocation
blocks discovery and future redemption while retaining existing learner
enrolments and audit history.
SCORM, surveys and resources share stable Learning Activity identities and a
common Learning Activity Version envelope, with validated type-specific content
tables keyed by the same version identifier. Course items carry one exact
activity-version reference and kind. Published versions are immutable, so
structural changes require an explicit new version and never rewrite existing
enrolments. Courses can be archived; an archived course can be permanently
deleted only when it has no enrolment or commerce history. The learner workspace
shows derived item and section progress.
Survey authoring is available at `/admin/surveys`; published question sets are
immutable, and entitled learners submit exact-version responses that contribute
to section and course completion. The survey library identifies every course
version using each immutable survey version.
Private PDF resources are managed at `/admin/resources`. Uploads create stable
resources or immutable new versions; unreferenced versions can be removed, with
durable audit and retryable exact-object cleanup through the content worker.
Referenced PDF versions link back to each exact course version that uses them.
Courses configured with a completion certificate expose a download only while
the learner's exact enrolment is currently completed. The authenticated route
rechecks ownership, completion and the exact course-version setting, renders the
PDF on demand and returns private, non-cacheable bytes. It stores no certificate
row or object. An administrator completion override therefore removes the
download immediately; recompletion restores it immediately.

Real, legally shareable SCORM packages can be exercised without committing
their contents:

```sh
pnpm run verify:scorm-ingestion:local -- /path/to/module-1.zip /path/to/module-2.zip
```

Stop `pnpm worker:scorm` before running this exclusive local verifier. It checks
bounded streaming ingestion, real outbox dispatch, SQS receipt, five-receive
DLQ redrive, idempotent duplicate delivery, quarantine extraction, guarded
removal and object cleanup, then removes its exact database, object-storage and
queue fixtures.

## Verification

```sh
pnpm run verify:app
pnpm run verify:cdk
pnpm run verify:db:gate
pnpm run test:e2e
```

Every browser-test command creates a uniquely named PostgreSQL database on the
configured localhost server, migrates and seeds it, runs against fresh local
origins on unoccupied ports, and drops the database even when the suite fails.
Playwright never reuses a running development server. Browser tests therefore do
not create, update or clean fixtures in the normal local `upskill` database. The
complete `verify:db:gate` uses the same disposable-database boundary for its
database integration verifiers.

See the [architecture specification](docs/architecture.md), broader
[architecture handbook](docs/architecture/README.md) and
[architecture decisions](docs/adr/README.md).

Before the first AWS release, populate the application configuration secret
output by the CDK application stack with the real application/learning origins,
restricted Stripe key, Stripe webhook signing secret, Mailgun domain sending
key, sending domain and From address. Use
Mailgun's EU API base URL when the sending domain is hosted in the EU region.
EC2 combines that application secret with the RDS secret in a private systemd
environment file on boot and at every atomic deployment. A
dedicated versioned Secrets Manager value supplies each environment's access-code
encryption key and is readable only by the application instance role. The public
lookup ID is stored in PostgreSQL and requires no separate secret.
Set the corresponding GitHub environment's `AWS_DEPLOY_ROLE_ARN` and
`ARTIFACT_BUCKET` secrets from the deployment-identity and storage stack
outputs.
Production CDK synthesis also requires `-c certificateArn=<regional ACM ARN>`;
the application stack then terminates HTTPS and permanently redirects HTTP.

Configure Stripe to send `checkout.session.completed`,
`checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `checkout.session.expired`,
`refund.created`, `refund.updated` and `refund.failed` events
to `POST /api/stripe/webhook`. For local test-mode forwarding, use the Stripe
CLI webhook secret as `STRIPE_WEBHOOK_SECRET`; the redirect success page never
fulfils an order by itself.

The restricted `STRIPE_SECRET_KEY` needs write access to Checkout Sessions and
Customers plus read access to Invoices. Bulk Checkout enables post-purchase
invoice creation; Access Owners retrieve the Stripe-hosted invoice from their
assigned-grant order history. Refund events update financial history only and
never delete issued codes or learning access.

`pnpm run dev` starts the authenticated Stripe CLI listener with the web,
learning and SCORM-worker processes. It injects the listener's temporary signing
secret without changing `.env.local`, so local Checkout fulfilment works while
the development supervisor is running. Run `stripe login` once before starting
development. Startup fails clearly when Stripe CLI is unavailable or no longer
authenticated because payment webhooks are a required local service.
