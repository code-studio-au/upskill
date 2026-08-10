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
quarantine, learning-content, resource and certificate buckets. ElasticMQ
exposes its SQS-compatible API on port 9324 and web UI on 9325; its work queue,
15-minute visibility timeout and five-receive DLQ policy match CDK. `pnpm dev`
starts Vite for the application on port 3000, the isolated learning origin on
port 3001 and the local SCORM worker, so asynchronous uploads are processed and
modules run inside the learner workspace. Use `pnpm dev:web` only when
deliberately running the learning origin and worker separately.
Server and worker events are bounded structured JSON. `UPSKILL_LOG_LEVEL` may
be `info`, `warn`, `error` or `off` for operational events; committed audit
projections are always emitted. EC2 sends both service streams to journald so a
future Datadog Agent can collect them without application-level vendor coupling.
The public catalog reads immutable published course versions from PostgreSQL.
The two `db:seed:*` commands install
deterministic local and browser-test data; they are never run by production
deployment. `db:seed:learner` requires `SEED_LEARNER_PASSWORD` and
`ACCESS_CODE_PEPPER`; it creates verified `learner@example.com` and
`redeemer@example.com` accounts, the platform administrator
`admin@example.com`, and the local code `EXAMPLE-LEARN-2026`. All three local
accounts use `SEED_LEARNER_PASSWORD`; administration starts at `/admin`.
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
with effective access state and direct progress-review links.
Published versions are immutable, so structural changes require an explicit new
version and never rewrite existing enrolments. Courses can be archived; an
archived course can be permanently deleted only when it has no enrolment or
commerce history. The learner workspace shows derived item and section progress.
Survey authoring is available at `/admin/surveys`; published question sets are
immutable, and entitled learners submit exact-version responses that contribute
to section and course completion. The survey library identifies every course
version using each immutable survey version.
Private PDF resources are managed at `/admin/resources`. Uploads create stable
resources or immutable new versions; unreferenced versions can be removed, with
durable audit and retryable exact-object cleanup through the content worker.
Referenced PDF versions link back to each exact course version that uses them.
Courses configured with a completion certificate issue an immutable PDF
snapshot when an enrolment completes. The local content worker generates the
document in the private certificate bucket; the learner dashboard automatically
changes from a preparing state to an authenticated download action. Revoking a
completion removes access to that certificate, while a later recompletion
issues a new snapshot.

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
```

See [the architecture specification](docs/architecture.md) and
[architecture decisions](docs/adr/README.md).

Before the first AWS release, populate the application configuration secret
output by the CDK application stack with the real application/learning origins
and Stripe keys. EC2 combines that secret with the separately generated
access-code pepper and RDS secrets into a private systemd environment file on
boot and at every atomic deployment.
Set the corresponding GitHub environment's `AWS_DEPLOY_ROLE_ARN` and
`ARTIFACT_BUCKET` secrets from the deployment-identity and storage stack
outputs.
Production CDK synthesis also requires `-c certificateArn=<regional ACM ARN>`;
the application stack then terminates HTTPS and permanently redirects HTTP.

Configure Stripe to send `checkout.session.completed`,
`checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed` and `checkout.session.expired` events
to `POST /api/stripe/webhook`. For local test-mode forwarding, use the Stripe
CLI webhook secret as `STRIPE_WEBHOOK_SECRET`; the redirect success page never
fulfils an order by itself.
