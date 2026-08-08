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
pnpm dev
```

The application does not require a database for the initial public catalog
fixture. Database commands use `DATABASE_URL` and can target the PostgreSQL
service in `docker-compose.yml`.

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
