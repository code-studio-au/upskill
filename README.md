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
pnpm dev
```

The local stack follows the Projex pattern: PostgreSQL plus MinIO with durable
data under the ignored `.local/` directory. MinIO exposes its S3 API on port
9020 and console on 9021, and initializes private quarantine, learning-content,
resource and certificate buckets. The public catalog reads immutable published
course versions from PostgreSQL. `db:seed:catalog` installs deterministic local
and browser-test data; it is never run by production deployment.

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
and Stripe keys. EC2 combines that secret with the generated RDS secret into a
private systemd environment file on boot and at every atomic deployment.
Set the corresponding GitHub environment's `AWS_DEPLOY_ROLE_ARN` and
`ARTIFACT_BUCKET` secrets from the deployment-identity and storage stack
outputs.
Production CDK synthesis also requires `-c certificateArn=<regional ACM ARN>`;
the application stack then terminates HTTPS and permanently redirects HTTP.
