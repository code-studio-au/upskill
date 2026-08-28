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
applies pending database migrations before it starts Vite for the application
on port 3000, the isolated learning origin on port 3001 and the local SCORM
worker. Startup stops if a migration fails, so the application cannot run
against a stale schema. Use `pnpm dev:web` only when deliberately running the
learning origin and worker separately.

Initial setup runs `db:migrate` explicitly because the seed commands need the
schema before the development supervisor starts. Later `pnpm dev` runs apply
only pending migrations.

`.env.example` is the non-secret local configuration contract; copy it to the
ignored `.env.local` and customize only that local file. Do not copy real local
credentials back into `.env.example`. `ACCESS_CODE_PEPPER` is obsolete and must
not be configured; local access-code recovery uses `ACCESS_CODE_ENCRYPTION_KEY`
or the documented development-only fallback. Deployed environments never read
either local environment file.

Local email is captured in PostgreSQL by default. To send it through Mailgun,
set `EMAIL_PROVIDER=mailgun`, `MAILGUN_API_KEY`, `MAILGUN_DOMAIN` and
`MAILGUN_FROM` in `.env.local`; use `MAILGUN_API_BASE_URL` for an EU-region
domain. `pnpm dev` already runs the notification consumer. Never commit the
domain sending key.

Event recovery SMS is also captured in PostgreSQL by default. To send it
through TextBee, set `SMS_PROVIDER=textbee`, `TEXTBEE_API_KEY` and
`TEXTBEE_WEBHOOK_SECRET` in `.env.local`. The webhook secret must be the same
20-or-more-character value configured for the TextBee endpoint.
`TEXTBEE_DEVICE_ID` is optional; when omitted, TextBee selects the default or
most recently active device. Never commit either TextBee secret.

Migration baseline v1 freezes migrations `0001` through `0072`; see ADR 0021.
Every later schema change is a sequential, forward-only migration and the
normal application gate verifies the frozen files by SHA-256. Existing local
databases remain upgradeable and must not be reset as a migration strategy.
Object-storage data is never implicitly removed by a database operation.

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
verified `learner@codestudio.au` and
`redeemer@codestudio.au` accounts, the platform administrator
`admin@codestudio.au`, and the local code
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
support email address, restricted Stripe key, Stripe webhook signing secret,
Mailgun domain sending key, sending domain and From address, TextBee API key and
TextBee webhook signing secret. Use
Mailgun's EU API base URL when the sending domain is hosted in the EU region.
EC2 combines that application secret with the RDS secret in separate root-only
web, worker and deployment environment files on boot and at every atomic
deployment. Web and worker services receive only their own least-privilege
database credentials. A
dedicated versioned Secrets Manager value supplies each environment's access-code
encryption key and is readable only by the application instance role. The public
lookup ID is stored in PostgreSQL and requires no separate secret.
Set the corresponding GitHub environment's `AWS_DEPLOY_ROLE_ARN` and
`ARTIFACT_BUCKET` secrets from the deployment-identity and storage stack
outputs. The account-wide GitHub OIDC provider lives in the shared
`ProjexGithubIdentity` stack in the current Code Studio AWS account. Upskill
references that canonical provider by ARN and creates only repository- and
environment-scoped deployment roles. Do not duplicate, replace or transfer
CloudFormation ownership of the provider when adding an Upskill environment.

Authenticate to the intended AWS account, confirm the Sydney region, then
bootstrap and deploy the staging infrastructure from the pinned CDK workspace:

```sh
aws login
aws sts get-caller-identity
pnpm --dir deploy/cdk exec cdk bootstrap aws://<aws-account-id>/ap-southeast-2
pnpm --dir deploy/cdk exec cdk deploy --all --context environment=staging
```

Use a named IAM Identity Center or administrative role for this bootstrap; the
identity returned by `aws sts get-caller-identity` must not be the AWS account
root. Upskill and Projex currently share the Code Studio AWS account, so retain
the `upskill-<environment>-*` stack names, `Application=upskill` tags and
dedicated least-privilege roles. Do not reuse Projex deploy users or policies;
the only shared deployment identity resource is the existing account-wide
GitHub OIDC provider.
Review the IAM/security-group changes when CDK prompts; do not suppress that
approval for the first environment. The stack outputs identify the application
configuration secret, Elastic IP, artifact bucket and GitHub deployment role.
Replace the configuration-secret placeholders through Secrets Manager before
the first application deployment. The deployment performs another fail-closed
runtime validation before it can run migrations.

Do not enable automatic EC2 replacement for application user-data changes in
the single-host topology. A replacement would receive the Elastic IP before it
has restored the active release and Let's Encrypt state. User-data changes
therefore configure future hosts; apply an existing-host bootstrap correction
as a reviewed, idempotent SSM repair, or use an explicit maintenance operation
that restores the release and TLS before returning the environment to service.

Each environment deliberately uses one Sydney-region `t4g.micro` EC2 instance
with an Elastic IP and one isolated `db.t4g.micro` PostgreSQL instance. This is
the lowest-cost supported topology and has no automatic host failover. The host
uses a small encrypted root volume plus swap so the 1 GiB instance can tolerate
short memory bursts without adding an always-on compute tier. Create
public DNS A records for the distinct application and learning origins using
the application stack's Elastic IP output. Create the matching GitHub
`staging` environment, restrict its deployment branches to `main`, and populate
its two deployment secrets. This repository has one maintainer, so the
environment deliberately has no required-reviewer rule; the manual workflow
instead requires the exact 40-character `main` commit SHA as an independent
confirmation. Run the first deployment from `main` and enter that SHA. The
release is checksummed and receives signed GitHub build-provenance attestation
before upload. It installs an nginx ACME configuration that returns only a
non-cacheable maintenance response over public HTTP until TLS is active. After
DNS resolves, connect with SSM and run:

```sh
sudo /usr/local/bin/upskill-provision-letsencrypt-cert \
  <application-hostname> <learning-hostname> ops@codestudio.au
```

The command obtains and renews one Let's Encrypt certificate for both names,
renders the production nginx configuration and enables the renewal timer. The
deployment workflow uploads one commit-addressed archive, waits for the exact
SSM command, migrates with the administrative database credential, provisions
the restricted web/worker roles, activates atomically and verifies `/api/ready`
against the commit SHA. Re-dispatching the active commit deliberately refreshes
Secrets Manager configuration, validates it and restarts the web and worker;
failed validation or readiness restores the previous environment files.
Production seeding is prohibited. Staging has one explicit, additive snapshot
seed for pre-production testing; it is separately confirmed, preserves existing
users by email, uses a root-only operator environment, and is documented in
[local development data](docs/local-development-data.md#controlled-staging-seed).
Verify the published provenance for the exact downloaded release when required:

```sh
gh attestation verify upskill-<commit-sha>.tar.gz \
  --repo code-studio-au/upskill
```

After public TLS is active, invite the intended first administrator through
SSM. Public sign-up remains disabled; the operator command creates only one
provisional account and queues the normal 72-hour password-setup email without
placing a password in shell, SSM or application logs:

```sh
sudo /usr/local/sbin/upskill-invite-platform-admin \
  "Administrator name" admin@codestudio.au
```

After the worker delivers the email and the recipient follows the setup link,
chooses a password and reaches the dashboard, grant that verified active
account the one-time platform role:

```sh
sudo /usr/local/sbin/upskill-bootstrap-platform-admin admin@codestudio.au
```

Both commands serialize on the same database lock and permanently refuse a
different target after platform administration is configured. Invitation and
privilege grant are durably audited. The grant succeeds idempotently for that
same administrator, and all later administrator changes must use authenticated
product workflows.

Configure Stripe to send `checkout.session.completed`,
`checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `checkout.session.expired`,
`refund.created`, `refund.updated` and `refund.failed` events
to `POST /api/stripe/webhook`. For local test-mode forwarding, use the Stripe
CLI webhook secret as `STRIPE_WEBHOOK_SECRET`; the redirect success page never
fulfils an order by itself. `pnpm run dev` starts without webhook forwarding
when Stripe CLI is missing, signed out or offline, and prints a warning instead;
checkout state will not advance from Stripe events until forwarding is restored.

Configure TextBee to send `MESSAGE_SENT`, `MESSAGE_DELIVERED` and
`MESSAGE_FAILED` events to `POST /api/textbee/webhook` on the public application
origin (for production, `https://upskill.institute/api/textbee/webhook`). Set
the endpoint signing secret as `TEXTBEE_WEBHOOK_SECRET`. The handler verifies
the `X-Signature` HMAC over the exact request bytes, deduplicates callbacks and
updates SMS delivery operations without retaining the OTP message or raw
webhook body. Do not subscribe this endpoint to inbound `MESSAGE_RECEIVED`
events.

The restricted `STRIPE_SECRET_KEY` needs write access to Checkout Sessions and
Customers plus read access to Invoices. Bulk Checkout enables post-purchase
invoice creation; Access Owners retrieve the Stripe-hosted invoice from their
assigned-grant order history. Refund events update financial history only and
never delete issued codes or learning access.

When Stripe CLI is installed, authenticated and online, `pnpm run dev` starts
its listener with the web, learning and SCORM-worker processes. It injects the
listener's temporary signing secret without changing `.env.local`, so local
Checkout fulfilment works while the development supervisor is running. Run
`stripe login` once to enable that forwarding. A missing, signed-out or offline
Stripe CLI instead produces a warning and development continues; webhook-driven
local Checkout updates remain unavailable until forwarding is restored. If an
active listener later disconnects, the web, learning and worker processes also
continue.
