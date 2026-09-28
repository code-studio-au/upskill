# Offline SCORM CloudFront qualification

This staging-only command checks the deployed, dormant CloudFront
qualification boundary. It does not enable Offline SCORM, create a
distribution, invoke the allocator, alter a WAF rule, or write to AWS.

## Prerequisites

- AWS CLI credentials for the staging account.
- Read access to the staging CloudFront origin-key secret; its value is used
  only in memory and is never included in the qualification report.
- The application and edge stacks deployed with the CloudFront qualification
  context.
- The shared `ap-southeast-2` operational SNS email subscription and the
  separate `us-east-1` edge SNS email subscription confirmed for the exact
  endpoint exported by each stack.

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
retention, exact confirmed alarm-subscription endpoints, exact alarm
metrics/units/evaluation/actions, per-distribution entitlement-specific access
logging, fully deployed edge status, tag-first lifecycle ownership discovery,
entitlement-bound protected origin headers, HTTPS-only TLS 1.2 origin transport
and the remaining canonical allocator configuration, distribution-cap markers,
service-quota headroom and a globally bounded sample of recent CloudFront
control-plane mutations.

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
the union of comment-identified and exactly tag-identified qualification
distributions.

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
