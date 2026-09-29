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
  document and lifecycle. The operator must also be able to inspect the
  application instance's current IAM instance profile, inspect the deployed
  worker role's EC2-only trust policy plus all managed and inline policies, and
  simulate its permission to invoke the exact allocator version. Read the
  post-restart worker runtime target parameter written only after the deployed
  worker passes readiness.
- Read access to the edge SNS topic attributes and deployment-owned KMS key
  metadata and policy so the key's enabled state and CloudWatch alarm
  publication path can be qualified. The shared operational topic attributes
  are also read to qualify its same-account CloudWatch publication boundary.
- The application, storage and edge stacks deployed with the CloudFront
  qualification context.
- The shared `ap-southeast-2` operational SNS email subscription and the
  separate `us-east-1` edge SNS email subscription confirmed for the exact
  endpoint exported by each stack, with no subscription filter policy.

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
redaction, ACL-level and per-rule WAF metric publication/sampling, 30-day WAF
retention, exact unfiltered confirmed alarm-subscription endpoints, exact alarm
metrics/units/evaluation/actions, per-distribution entitlement-specific access
logging, the bucket's exact owner and S3 LogDelivery ACL grants, all four S3
public-access blocks, a non-public bucket-policy status, the exact TLS-only
bucket-policy deny plus the deployment-owned staging cleanup grant with no
other access grant, and the exact 30-day retention lifecycle, fully deployed
edge status, lifecycle ownership discovery across the comment, exact tags and
dedicated Web ACL binding,
entitlement-bound protected origin headers, HTTPS-only TLS 1.2 origin
transport, the live instance-profile binding to the worker role, the worker's
exact EC2-only trust policy, default session duration and lack of a permissions
boundary, its exact SSM allocator target and effective permission to invoke
that immutable version, the post-restart worker runtime attestation for that
same target, the absence of direct CloudFront or WAF permissions on the worker,
the live allocator version and code digest, lack of executable Lambda
layers, exact execution role, runtime, environment and reserved concurrency,
the allocator role's Lambda-only trust policy and least-privilege
managed/inline permission boundary, the worker role's exact managed-policy
inventory and sole Lambda invoke grant scoped to the immutable allocator
version, the edge topic's
enabled deployment-owned KMS key and exact CloudWatch publish grant, the
canonical distribution configuration, both SNS topics' account- and alarm-scoped
CloudWatch publish grants and sole confirmed recipient, the edge key's exact
administration and CloudWatch policy without an overriding deny, the absence of
an allocator-version resource policy, distribution-cap markers, service-quota
headroom and a globally bounded sample of recent CloudFront control-plane
mutations.

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

The harness reads tags for every distribution in the account so a qualification
distribution whose mutable comment has drifted cannot disappear from the
ownership, cap or configuration checks. Configuration reads remain limited to
qualification distributions identified by comment, exact tags, or the
dedicated Web ACL binding. A distribution whose comment and tags both drift
therefore remains visible through its deployment-owned WAF binding and fails
the ownership/configuration checks instead of escaping the inventory.

The application stack publishes an immutable Lambda version, grants the worker
invoke permission only for that version through its identity policy, writes
its qualified ARN to SSM, and resets a separate runtime-attestation parameter
to a non-qualifying pending value. After refreshing the worker environment and
successfully restarting the service, the release installer writes the ARN it
actually loaded to that narrowly scoped attestation parameter. The harness
requires the stack output, configured target, post-restart runtime target and
exact live version to agree, compares the live package digest with
the digest captured by the deployment, and requires that version to have no
resource-based invocation policy. Updating mutable `$LATEST` cannot change the
code the worker invokes; deleting and recreating the named function or version
cannot pass qualification with different code; a legitimate code change
requires a deployment that publishes, records and selects a new version.
Before refresh, the installer snapshots the previous release's environment
files. A failed first rollout from the legacy function-name target therefore
restores those files directly instead of asking older release code to parse the
new qualified ARN; a successful release removes the temporary snapshot.

The live allocator, IAM role/policy and instance-profile responses, worker
permission simulation, topic and subscription attributes, KMS key metadata and
policy, bucket ACL, public-access block, bucket-policy status and lifecycle
responses are evaluated only in memory. They are not copied into the report;
only the pass/fail checks are retained. The operator identity therefore needs
these additional read-only actions: `cloudformation:ListStackResources`,
`ec2:DescribeInstances`,
`iam:GetInstanceProfile`, `iam:GetRole`, `iam:ListAttachedRolePolicies`,
`iam:ListRolePolicies`, `iam:GetRolePolicy`, `iam:SimulatePrincipalPolicy`,
`kms:DescribeKey`, `kms:GetKeyPolicy`, `lambda:GetPolicy`,
`secretsmanager:GetResourcePolicy`,
`sns:GetSubscriptionAttributes`,
`sns:GetTopicAttributes`, `s3:GetBucketLifecycleConfiguration`,
`s3:GetBucketPolicy`, `s3:GetBucketPublicAccessBlock`, and
`s3:GetBucketPolicyStatus`.

## Interpreting results

A `failed` result exits non-zero and means the recorded deployed boundary is
not suitable for qualification. A `warning` result exits zero but needs an
operator decision. In particular, absent CloudFront standard access logs are a
warning while no entitlement distribution is active, and can remain delayed
after a distribution serves requests. AWS notes that standard log delivery is
not real time and can be delayed by up to 24 hours.

The command uses CloudTrail Event History as staging evidence only. It does not
configure a durable CloudTrail trail or data-event collection, and it does not
replace the device isolation, cleanup, latency, WAF-tuning, origin-denial or
cost gates in ADR 0045.

See [CloudFront logging in CloudTrail](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/logging_using_cloudtrail.html), [standard-log timing](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/standard-logs-reference.html), and [CloudFront service quotas](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html).
