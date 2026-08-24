# ADR 0007: AWS deployment and verification

## Status

Accepted. The CloudFront delivery portion is superseded by ADR 0036.

## Decision

Use CDK for isolated staging and production stacks, RDS PostgreSQL, private S3,
SQS, CloudFront and one ARM EC2 instance with an Elastic IP per environment.
This intentionally low-cost topology omits NAT gateways, an ALB and Auto
Scaling until measured availability or capacity needs justify them. The public
application and isolated learning origins terminate Let's Encrypt TLS at nginx;
RDS remains isolated and requires verified TLS from all application roles.
GitHub Actions uses OIDC and promotes one immutable, checksummed artifact
through staging to production. Manual deployment is restricted to `main` and
requires the operator to confirm its exact commit SHA. GitHub signs build
provenance for the exact release archive before S3 upload. The bootstrap nginx
configuration exposes ACME plus a maintenance response only; public application
traffic begins after the distinct application and learning origins have valid
TLS. In the current shared Code Studio AWS account, Projex retains CloudFormation
ownership of the single account-wide GitHub Actions OIDC provider; Upskill
references its canonical ARN and owns only its repository- and
environment-scoped deployment roles.
The Code Studio GitHub organization customizes OIDC subjects with immutable
organization and repository IDs. Deployment-role trust policies therefore bind
both the canonical names and numeric IDs; repository transfer or recreation
requires an explicit reviewed context update before deployment can resume.
Run Command access is restricted to managed EC2 instances carrying both the
`Application=upskill` tag and the matching `Environment` tag. Tag-based scope
keeps the deployment role least-privileged without coupling its stack to an
ephemeral instance ID or blocking a reviewed host replacement.

## Consequences

Stateful resources have retention protection and at least seven days of
backups, application releases can roll back independently, and schema evolution
must use expand/contract migrations. A single host is a deliberate cost/
availability trade-off: readiness and host alarms detect failure, but there is
no automatic failover until the topology is deliberately scaled out.
The application host is immutable at the infrastructure boundary: reviewed
user-data changes replace the EC2 instance and re-associate its environment
Elastic IP instead of relying on cloud-init to rerun on an existing host.
Migration baseline v1 in
[ADR 0021](0021-pre-production-schema-rebaselining.md) closes the temporary
pre-production rebaselining exception before the first staging environment.
