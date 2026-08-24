# ADR 0036: Initial authenticated SCORM content delivery

## Status

Accepted and implemented for the initial low-cost deployment topology.
This decision supersedes the CloudFront delivery portions of ADRs 0004 and
0007; their other decisions remain authoritative.

## Context

ADRs 0004 and 0007 originally selected CloudFront delivery for immutable SCORM
objects. The implemented learning origin already enforces an attempt-scoped,
HTTP-only session on every shell, state and content request and streams the
exact authorised object from private S3. The first staging and production
topology uses one deliberately small application host and has no measured
content-volume requirement that justifies a second authorization mechanism.

## Decision

Keep learning objects private in S3 and proxy authorised SCORM content through
the dedicated nginx learning origin and application process. The learning
origin accepts only `/api/scorm/` routes; every object request revalidates the
attempt session before retrieving an exact immutable key. Do not create public
bucket access, presigned browser access or CloudFront signing credentials.

Introduce CloudFront only after measured host bandwidth, latency or availability
shows that the proxy is the limiting boundary. That change must preserve
attempt-scoped revocation and dedicated-origin CSP isolation and requires a new
security and cost review.

## Consequences

The initial topology matches the executable system and has fewer credentials,
cookie policies and invalidation paths. EC2 carries SCORM response bandwidth,
so staging smoke and load checks must include representative Rise packages and
operational metrics must be reviewed before material learner scale. Immutable
S3 keys still make a later CDN introduction an additive delivery change.
