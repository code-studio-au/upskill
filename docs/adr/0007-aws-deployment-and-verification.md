# ADR 0007: AWS deployment and verification

## Status

Accepted.

## Decision

Use CDK for isolated staging and production stacks, RDS PostgreSQL, private S3,
SQS, CloudFront and one ARM EC2 instance with an Elastic IP per environment.
This intentionally low-cost topology omits NAT gateways, an ALB and Auto
Scaling until measured availability or capacity needs justify them. The public
application and isolated learning origins terminate Let's Encrypt TLS at nginx;
RDS remains isolated and requires verified TLS from all application roles.
GitHub Actions uses OIDC and promotes one immutable, checksummed artifact
through staging to production.

## Consequences

Stateful resources have retention protection and at least seven days of
backups, application releases can roll back independently, and schema evolution
must use expand/contract migrations. A single host is a deliberate cost/
availability trade-off: readiness and host alarms detect failure, but there is
no automatic failover until the topology is deliberately scaled out.
Before the first non-disposable environment or external user, the temporary
pre-production rebaselining exception in
[ADR 0021](0021-pre-production-schema-rebaselining.md) applies instead.
