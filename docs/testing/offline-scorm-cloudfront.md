# Offline SCORM CloudFront qualification

This staging-only command checks the deployed, dormant CloudFront
qualification boundary. It does not enable Offline SCORM, create a
distribution, invoke the allocator, alter a WAF rule, or write to AWS.

## Prerequisites

- AWS CLI credentials for the staging account.
- Read access to the staging CloudFront origin-key secret; its value is used
  only in memory and is never included in the qualification report. Read its
  resource policy as well so any resource-based access grant is rejected.
- Read access to the allocator Lambda version configuration, resource policy
  and reserved concurrency, its IAM role/trust/managed and inline policies,
  all three Offline SCORM SSM parameters, the storage stack resources, and the
  CloudFront access-log bucket ACL, public-access block, policy status, policy
  document, lifecycle, versioning and replication configuration, plus the
  deployment-owned cleanup role's trust policy. The operator must also be able
  to inspect the
  running application instance's current IAM instance profile, inspect the
  deployed worker role's EC2-only trust policy plus all managed and inline
  policies, and simulate its permission to invoke the exact allocator version.
  Read the worker-owned runtime-target lease refreshed by the running process
  at startup and every five minutes. Read the worker heartbeat alarm and recent
  `WorkerActive` datapoints so target freshness and current process health can
  both be qualified.
- Read access to the edge SNS topic attributes and deployment-owned KMS key
  metadata and policy so the key's enabled state and CloudWatch alarm
  publication path can be qualified. The shared operational topic attributes
  are also read to qualify its same-account CloudWatch publication boundary
  and require the deployment baseline of no KMS encryption key.
- Read access to account- and resource-scoped CloudWatch Logs resource policies
  so the WAF log group's exact delivery-service write path can be qualified.
- The application, storage and edge stacks deployed with the CloudFront
  qualification context.
- The shared `ap-southeast-2` operational SNS email subscription and the
  separate `us-east-1` edge SNS email subscription confirmed for the exact
  endpoint exported by each stack, with no subscription filter or dead-letter
  policy.

The application, allocator and origin run in `ap-southeast-2`; the
CloudFront-scope WAF, edge alarm and CloudTrail Event History lookup run in
`us-east-1`.

## Run

Run after deployment with the exact staging account and direct application
origin. The command deliberately rejects every environment except `staging`.

```sh
pnpm run qualify:offline-scorm:cloudfront -- \
  --environment staging \
  --expected-account 839629613667 \
  --expected-origin-domain staging.upskill.institute
```

Store the JSON output with the qualification record. It verifies the direct
origin parameter and deployed-distribution binding, staging risk
acknowledgement, WAF ownership/binding, mandatory rules, safe log filtering and
redaction, the exact CloudWatch Logs delivery grant with no applicable explicit
deny or additional condition clause, ACL-level and per-rule WAF metric
publication/sampling, 30-day WAF
retention with no unexpected KMS association, exact unfiltered confirmed
alarm-subscription endpoints, exact alarm
metrics/units/evaluation/actions, per-distribution entitlement-specific access
logging, the bucket's exact owner and S3 LogDelivery ACL grants, all four S3
public-access blocks, a non-public bucket-policy status, the exact TLS-only
bucket-policy deny plus the deployment-owned staging cleanup grant with no
other access grant, its exact SSE-S3 encryption and unversioned baselines,
absence of replication, the cleanup role's exact Lambda-only trust boundary, and
the exact 30-day retention lifecycle, fully deployed
edge status, lifecycle ownership discovery across the immutable caller
reference, comment, exact tags and dedicated Web ACL binding,
entitlement-bound protected origin headers, HTTPS-only TLS 1.2 origin
transport, the running instance's live profile binding to the worker role, the
worker's exact EC2-only trust policy, default session duration and lack of a
permissions boundary, its exact SSM allocator target and effective permission
to invoke that immutable version, a current healthy `WorkerActive` datapoint
with the heartbeat alarm in `OK`, a worker-owned runtime attestation no more
than ten minutes old for that same target, the absence of direct CloudFront,
WAF, IAM, KMS, Logs, SNS, S3-control or infrastructure mutation permissions on
the worker except for assuming the exact deployment-owned recording upload
role, read-only Secrets Manager access scoped to the exact eight
deployment-owned application, access-code, database, LiveKit and Offline SCORM
secret names in the staging account and Region, object-data-only S3 access, and
only the exact metric-publication and runtime-attestation writes, the
live allocator version and code digest, lack of executable Lambda layers or a
VPC attachment, exact execution role, runtime, environment and reserved
concurrency,
the allocator role's Lambda-only trust policy and least-privilege
managed/inline permission boundary, the worker role's exact managed-policy
inventory and sole Lambda invoke grant scoped to the immutable allocator
version, the edge topic's
enabled deployment-owned KMS key and exact CloudWatch publish grant, the
canonical distribution configuration, both SNS topics' account- and
alarm-scoped CloudWatch publish grants and sole confirmed recipient without a
filter or dead-letter policy, the edge key's exact
administration and CloudWatch policy without an overriding deny, the absence of
an allocator-version resource policy, distribution-cap markers, service-quota
headroom and a globally bounded sample of recent CloudFront control-plane
mutations.

Account- and resource-scoped CloudWatch Logs policies capable of applying to
the qualification log group must use the supported `2012-10-17` policy
language. Qualification ignores inspectable legacy statements that target only
unrelated resources, but fails closed when a potentially applicable policy
cannot be evaluated.

The deployed cap output must remain the repository qualification baseline of
25, and quota headroom is calculated from every distribution item aggregated
by the AWS CLI rather than page-level response metadata.

The report intentionally includes only a small CloudTrail mutation summary:
event name/time, read-only status, error code and service identity type. It
never emits CloudTrail request parameters, headers, cookies, query strings,
source IP addresses or user ARNs. The AWS CLI result set is globally capped at
50 events rather than allowing pagination to expand the evidence sample.

The per-distribution configuration read includes the protected origin headers.
The harness reads the staging origin-key secret solely to recompute each
entitlement-bound capability, evaluates the configuration and tag responses
only in memory, and never serializes the secret, configuration, tags or header
values into the report.

The harness reads tags and configuration for every distribution in the account.
Its allocator-derived `CallerReference` cannot be changed by a CloudFront
distribution update, so a qualification distribution remains in the ownership,
cap and configuration checks even if its mutable comment, exact tags and Web
ACL binding all drift together. The drifted distribution then fails the
canonical ownership/configuration checks instead of escaping the inventory.

The application stack publishes an immutable Lambda version, grants the worker
invoke permission only for that version through its identity policy, writes
its qualified ARN to SSM, and resets a separate runtime-attestation parameter
to a non-qualifying pending value. The worker process writes the ARN it
actually loaded at startup and refreshes that narrowly scoped lease every five
minutes; a write failure is fatal so the service cannot remain healthy with
stale evidence. The release installer never writes the runtime attestation.
The harness requires the stack output, configured target, fresh runtime target and
exact live version to agree, compares the live package digest with
the digest captured by the deployment, and requires that version to have no
resource-based invocation policy. Updating mutable `$LATEST` cannot change the
code the worker invokes; deleting and recreating the named function or version
cannot pass qualification with different code; a legitimate code change
requires a deployment that publishes, records and selects a new version.
Before refresh, the installer snapshots the previous release's environment
files and defers the current-release symlink switch until every fallible host
installation and validation step has passed. Activation failures restore the
previous symlink, environment snapshot and package-site vhost together. The
same vhost restoration applies when an active-release configuration refresh or
a pre-activation validation fails. A failed first rollout from the legacy
function-name target therefore does not ask older release code to parse the new
qualified ARN; a successful release removes the temporary snapshot.

The live allocator, IAM role/policy and instance-profile responses, worker
permission simulation, topic and subscription attributes, KMS key metadata and
policy, bucket ACL, public-access block, bucket-policy status and lifecycle
responses are evaluated only in memory. They are not copied into the report;
only the pass/fail checks are retained. The operator identity therefore needs
these additional read-only actions: `cloudformation:ListStackResources`,
`cloudwatch:DescribeAlarms`, `cloudwatch:GetMetricStatistics`,
`ec2:DescribeInstances`,
`iam:GetInstanceProfile`, `iam:GetRole`, `iam:ListAttachedRolePolicies`,
`iam:ListRolePolicies`, `iam:GetRolePolicy`, `iam:SimulatePrincipalPolicy`,
`kms:DescribeKey`, `kms:GetKeyPolicy`, `lambda:GetPolicy`,
`logs:DescribeResourcePolicies`,
`secretsmanager:GetResourcePolicy`,
`sns:GetSubscriptionAttributes`,
`sns:GetTopicAttributes`, `s3:GetBucketLifecycleConfiguration`,
`s3:GetEncryptionConfiguration`, `s3:GetBucketPolicy`,
`s3:GetBucketVersioning`, `s3:GetReplicationConfiguration`,
`s3:GetBucketPublicAccessBlock`, and
`s3:GetBucketPolicyStatus`.

## Interpreting results

A `failed` result exits non-zero and means the recorded deployed boundary is
not suitable for qualification. A `warning` result exits zero but needs an
operator decision. Access-log evidence is queried separately for every current
owned distribution using its entitlement-specific prefix and distribution ID.
Every distribution needs an object whose event hour and S3 modification time
fall within the selected lookback window (24 hours by default); stale evidence
from a deleted distribution cannot satisfy the check. Missing evidence is a
warning while no entitlement distribution is active, and can remain delayed
after a distribution serves requests. AWS notes that standard log delivery is
not real time and can be delayed by up to 24 hours.

The command uses CloudTrail Event History as staging evidence only. It does not
configure a durable CloudTrail trail or data-event collection, and it does not
replace the device isolation, cleanup, latency, WAF-tuning, origin-denial or
cost gates in ADR 0045.

See [CloudFront logging in CloudTrail](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/logging_using_cloudtrail.html), [standard-log timing](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/standard-logs-reference.html), and [CloudFront service quotas](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html).
