# ADR 0007: AWS deployment and verification

Status: Accepted

## Decision

Use CDK for isolated staging and production stacks, RDS PostgreSQL, private S3,
SQS, CloudFront, ALB and EC2 Auto Scaling. GitHub Actions uses OIDC and promotes
one immutable artifact through staging to production.

## Consequences

Stateful resources have retention protection, application releases can roll
back independently, and schema evolution must use expand/contract migrations.
