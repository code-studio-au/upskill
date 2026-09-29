# ADR 0045: Provider-owned offline SCORM entitlement sites

## Status

Proposed; CloudFront qualification infrastructure, durable allocation,
issuance and retirement models, origin validation, dormant worker recovery and
an explicit staging-only shared-host risk gate plus dormant WAF, logging, alarm
and distribution-cap guardrails are implemented but disabled by default.
Date: 2026-09-27

## Context

ADRs 0041 and 0043 require every offline SCORM attempt to execute on an
uncredentialed origin that is isolated at both the origin and registrable-site
boundary. The implemented package runtime depends on a stable same-origin
service worker and a bounded synchronous Web Storage spool. Those guarantees
cannot be reproduced by an asynchronous `postMessage` bridge in an opaque
iframe without weakening the meaning of successful `LMSCommit` and
`LMSFinish` calls.

The first package-site design derives a unique hostname below an
operator-controlled suffix. Production use requires that suffix to be a private
entry in the Public Suffix List. Upskill does not currently satisfy the policy
and long-term domain commitments required for that registration.

AWS-issued CloudFront distribution hostnames are already beneath a
provider-managed public suffix. One standard distribution per exact offline
entitlement can therefore give the browser a distinct registrable site without
Upskill operating its own PSL entry. This does not remove the browser's PSL
security model; it delegates the suffix boundary to AWS.

The existing package host already authorises an exact entitlement, generates
the runtime and cleanup responses, and streams immutable package objects from
the private learning-content bucket. Replacing it with direct S3 delivery in the
first experiment would combine the site-isolation question with presigned
subresources, response-header limitations and a new cleanup mechanism.

## Decision

Qualify a **standard CloudFront distribution per exact offline entitlement** as
the first provider-owned-site implementation. Do not allocate by package
version, learner or installation: two attempts must never share a distribution,
origin, cookies, service-worker scope or local storage.

The first qualification topology uses the existing HTTPS package host as a
custom origin:

1. A dedicated allocator creates a tagged distribution in the disabled state.
2. The origin request contains an exact entitlement identifier and a
   per-entitlement HMAC capability in CloudFront custom headers. CloudFront
   overwrites viewer-supplied values for configured custom headers, so a viewer
   cannot replace those bindings before the origin request. The application
   must still validate the capability in constant time and resolve the stored
   entitlement-to-distribution binding before serving a package response.
3. The allocator returns the AWS distribution identifier and assigned
   `https://*.cloudfront.net` origin. The worker persists that immutable binding
   before any entitlement or cleanup evidence can make it eligible for
   activation.
4. Only after that binding is durable may the allocator enable the
   distribution. A lost response is recovered through a stable caller
   reference, exact tags and a deterministic non-secret marker.
5. Retirement first disables the distribution, waits for the disabled
   configuration to reach `Deployed`, and only then deletes it. Origin reuse is
   forbidden. Local package-site cleanup must complete or be recorded as
   needing attention independently of edge-resource deletion.

The qualification distribution deliberately disables edge caching and forwards
the cleanup query string and `Origin` header. This preserves the existing
authorization, range, runtime-version and `Clear-Site-Data` behaviour while the
security boundary is qualified. Immutable package caching may be introduced
later only as a separate reviewed slice with cache-key and invalidation tests.

The allocator remains a dormant capability:

- it is absent unless the explicit CDK context
  `offlineScormCloudFrontOriginDomain` is configured;
- the qualification stack grants the shared host role permission to invoke
  only the exact allocator, exposes its function name only in the root-owned
  worker environment and requires the worker process marker before constructing
  the provider;
- every created distribution starts disabled;
- the allocator resolves exactly one deterministic CloudFront-scope WAF web ACL
  in `us-east-1`, verifies its application, environment and purpose tags,
  attaches its ARN at creation and treats any later WAF binding drift as an
  ownership-boundary failure;
- the single-concurrency staging allocator refuses a new entitlement site once
  25 retained qualification distributions exist, while still recovering an
  existing exact-entitlement distribution at the cap;
- mutation requires the exact environment, purpose and entitlement ownership
  tags plus an exact match for the expected origin, capability, cache, logging,
  certificate and isolation configuration; and
- application Offline SCORM remains disabled.

The current low-cost staging topology runs web and worker processes on one EC2
host and therefore one IAM instance role. Worker-only environment configuration
and runtime validation are conventions within that trust boundary, not process
or AWS-principal isolation. Qualification infrastructure now requires the exact
CDK acknowledgement `staging-qualification-only`, records it as a stack output
and rejects the topology in production. That acknowledgement accepts only the
risk that another process on the disposable, non-production staging host could
exercise the worker's exact allocator invocation permission. It does not enable
Offline SCORM, waive any browser or operational gate, permit production use or
assert process isolation. Production learner activation still requires a
dedicated worker compute identity.

AWS documents that CloudFront custom origin headers overwrite same-named viewer
headers, which is required by the origin-capability design:
[custom origin headers](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/add-origin-custom-headers.html).
CloudFront updates require the current configuration and ETag and replace the
whole configuration rather than merging fields:
[UpdateDistribution](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_UpdateDistribution.html).

## Actors, entry points and targets

| Dimension               | Qualification scope                                                                                                                                                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actors                  | Learner receiving an offline entitlement; application service issuing it; operator invoking the dormant allocator; allocator execution role; CloudFront and WAF services; existing package host; operational responder receiving edge alarms.                                      |
| Entry points            | Future server-owned entitlement issuance/recovery; operator-only Lambda invocation during qualification; the assigned CloudFront viewer origin.                                                                                                                                    |
| Targets                 | One exact entitlement, its cleanup inventory, one tagged distribution, its custom-origin binding and access-log prefix.                                                                                                                                                            |
| Lifecycle               | Unallocated; allocating disabled; binding pending; enabling; active; disabling; deletion pending; deleted; needs attention.                                                                                                                                                        |
| Downstream effects      | Package-origin CSP, signed entitlement envelope, offline course index, service-worker registration, synchronous spool, cleanup receipt, reconciliation and retained audit evidence.                                                                                                |
| Failure and concurrency | Lost allocator response, duplicate allocation, CloudFront deployment delay, missing or ambiguous WAF, WAF-binding drift, local cap or AWS quota exhaustion, stale ETag, tag mismatch, origin-key rotation, partial binding, concurrent activation/retirement and deletion failure. |

The server-owned workflow must own these transitions through locked,
retry-safe database work. A distribution being `Deployed` is infrastructure
evidence, not authority to issue or activate an entitlement.

Migration 0120 adds the dormant
`offline_scorm_cloudfront_allocation` reservation and evidence model. Absence
of a row is the unallocated state; a row begins in `allocating` before the AWS
request, so a lost response can resume from the same exact entitlement ID.
Binding records the unique distribution ID and AWS-owned domain once and makes
both immutable. Guarded transitions cover binding pending, enabling, active,
disabling, deletion pending, deleted and operation-specific needs-attention
recovery. Lifecycle timestamps are write-once and runtime database roles cannot
delete the evidence.

The package host now also contains the dormant CloudFront-origin validation
boundary. Any request carrying either reserved origin header is claimed before
the application router and fails closed unless both headers are present, the
HMAC capability matches in constant time, the request reached the configured
direct custom origin and the exact retained allocation is `active`. The bound
AWS distribution domain becomes the package-site origin used for the existing
entitlement, runtime and cleanup checks, and their entitlement evidence must
match the capability binding. Every other allocation state is rejected across
package content, runtime assets and whole-site cleanup. The generated HMAC key
is exposed only to the web process environment when qualification context is
present. A conditional non-secret SSM parameter records the direct origin so
both first boot and every release refresh reconstruct the same web-only
authority; only an absent parameter disables that reconstruction, while other
SSM or secret failures abort the refresh. Runtime composition deliberately
hard-codes this mode off; no deployment flag or learner path is added by this
slice. The bootstrap server also claims either reserved origin header before
its readiness, PWA, prototype or static-asset shortcuts, so malformed,
incomplete and colliding package paths always reach the same validation
boundary.

The reservation intentionally precedes `offline_learning_entitlement`, so it
does not have a foreign key to an entitlement that does not yet exist. The
issuance workflow locks the reservation and atomically creates the entitlement
plus cleanup inventory for
`https://<distributionDomain>` before moving the reservation from
`binding_pending` to `enabling`.

Migration 0121 adds bounded provider-failure, availability and versioned lease
evidence for the allocation worker. The worker claims work with `FOR UPDATE
SKIP LOCKED`, invokes the exact configured allocator outside the transaction,
and recovers expired or failed allocation and activation calls without
replacing a stored binding. Normal CloudFront deployment polling advances the
lease version but does not consume the provider-failure budget. Allocation ends
at `binding_pending`. Activation can begin only when an active entitlement and
pending cleanup inventory already exist and the cleanup origin exactly matches
`https://<distributionDomain>`. The worker revalidates that authority while
claiming and finalising every activation call; if it disappears, the retained
allocation moves to `disabling` for the pending retirement workflow rather than
becoming active. This increment does not create reservations, issue
entitlements, process distribution retirement or expose learner UI.

Migration 0122 binds application-created reservations immutably to the exact
learner, installation, attempt, Course item and package evidence that authorized
the request. The dormant Course workflow serializes concurrent reservations on
the attempt, recovers a lost reservation response, revalidates the session,
installation, launch policy and immutable package before issuance, and creates
the signed entitlement plus cleanup inventory in the same transaction that
moves a bound allocation to `enabling`. The signed envelope remains server-side
until the allocation is `active`. Legacy operator qualification reservations
remain unowned and cannot be claimed by this workflow. No route, deployment
mode or learner activation path is added by this increment.

The dormant worker now also owns distribution retirement. An active
distribution remains available while cleanup is pending, actively clearing or
waiting for an explicit cleanup retry; confirmed cleanup, or an entitlement
that has been replaced or hard-revoked, promotes the allocation to `disabling`
under row locks. Exhausted activation work is also promoted to retirement if
its activation authority is later lost. The worker invokes the exact entitlement and
distribution binding, waits without consuming the failure budget while
CloudFront deploys the disabled configuration, records `deletion_pending`, and
requires a subsequent idempotent absence confirmation before recording
`deleted`. Lost responses and provider failures reuse the existing bounded
lease, backoff and needs-attention recovery model. Distribution deletion never
marks device cleanup successful and all lifecycle evidence remains retained.
This increment adds no learner route, deployment mode or activation flag.

## Threat model and controls

| Threat                                                      | Required control                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Viewer bypasses CloudFront and calls the application origin | Package-host edge mode accepts only the entitlement header plus valid HMAC capability and a matching durable binding. Ordinary application requests cannot select a package entitlement.                                                                                                     |
| Viewer supplies forged origin headers                       | CloudFront overwrites configured custom headers; the origin verifies the HMAC and binding. Header values are never treated as user identity.                                                                                                                                                 |
| Allocator mutates an unrelated distribution                 | Exact application, environment, purpose and entitlement tags plus caller-reference/configuration checks are mandatory before update or delete.                                                                                                                                               |
| Lost create response allocates a second site                | Stable caller reference and deterministic marker recover exactly one tagged disabled distribution. Multiple matches fail closed.                                                                                                                                                             |
| Package response is cached across authority changes         | Initial qualification uses zero TTLs and no cache policy. Error and runtime responses remain origin-owned.                                                                                                                                                                                   |
| Distribution becomes reachable before durable binding       | Creation is disabled; activation is a separate operation after persistence.                                                                                                                                                                                                                  |
| Retired entitlement remains reachable                       | Disable, wait for global deployment, then delete. The package host independently rejects non-active or cleanup-invalid states.                                                                                                                                                               |
| Public edge receives exploit or flood traffic               | One shared CloudFront-scope WAF blocks the AWS IP reputation list and more than 2,000 requests per source IP in five minutes. The Common Rule Set remains count-only during qualification so false positives can be measured before any acceptance amendment.                                |
| Allocator creates an unprotected or drifted distribution    | It resolves exactly one deterministic WAF name, requires the returned global ARN in every new distribution and includes that ARN in the exact configuration checked before describe, enable, disable or delete.                                                                              |
| Qualification leaks resources or approaches account quota   | Reserved allocator concurrency serializes creates and a staging-owned cap of 25 distributions blocks new allocations without blocking exact lost-response recovery. AWS account quota headroom remains an explicit qualification gate.                                                       |
| Logs expose learner or bearer information                   | Distribution tags and paths use opaque internal identifiers; cookies are excluded from access logs; the log bucket is encrypted, private and lifecycle-limited. Query strings must be reviewed before production logging because cleanup capabilities currently appear in a query parameter. |
| Origin capability is disclosed                              | Store its HMAC key in Secrets Manager, never return the capability from the allocator, rotate through an explicit dual-key migration, and restrict secret access to the allocator and package-host validation boundary.                                                                      |

The qualification context now creates a separate global-edge stack in
`us-east-1`, as AWS requires for CloudFront-scope WAF. EC2, RDS, S3, the worker,
allocator and origin stay in `ap-southeast-2`. The shared web ACL blocks the AWS
IP reputation list and a per-IP rate rule, counts the AWS Common Rule Set for
qualification tuning, samples requests and retains only `BLOCK`/`COUNT` logs in
a 30-day CloudWatch log group. Authorization, cookie and query-string values are
redacted. A blocked-request spike alarm publishes to a KMS-encrypted edge SNS
topic; operators must confirm its separate `us-east-1` email subscription after
deployment. CloudFront also receives AWS Shield Standard automatically. Shield
Advanced is not enabled for this staging experiment because its subscription
and operational commitment are disproportionate; revisit it before production
acceptance if risk or organisational policy requires the additional response
features.

The staging-only read-only qualification harness records CloudTrail Event
History, account quota headroom, WAF configuration, alarms and access-log
availability from deployed stack outputs. It does not create, update or delete
any edge resource, and it does not replace a durable production audit-retention
decision. CloudFront access-log review, anomalous origin-denial telemetry and
the resulting control-plane evidence remain required before learner activation.
The counted Common Rule Set must be tuned and the resulting block/count policy
recorded during qualification.

The AWS-owned hostname also forces use of the default CloudFront certificate.
AWS documents that this fixes the minimum viewer security policy at `TLSv1`;
the allocator cannot truthfully select `TLSv1.2_2021` without a custom hostname
and ACM certificate. Modern mobile browsers still negotiate newer TLS, but the
edge may accept older clients.

Upskill accepts that fixed viewer-policy constraint for the qualification and
intended production path as of 2026-09-27. The accepted boundary is narrow:
the package site is uncredentialed, receives no application session cookie or
learner identity cookie, uses an opaque exact-entitlement origin, and connects
from CloudFront to the package host with TLS 1.2. Supported mobile clients are
still required to negotiate modern TLS. WAF, rate limiting, access logging and
origin capability validation remain mandatory before learner activation. This
acceptance does not claim that the edge rejects legacy TLS clients, and it must
be revisited if organisational policy later requires enforced minimum TLS 1.2
at every public edge. AWS documents the constraint here:
[CloudFront distribution TLS settings](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesGeneral.html#DownloadDistValuesSecurityPolicy).

## Qualification gates

CloudFront becomes an accepted delivery mode only after all of the following
pass on physical supported devices:

1. `tldts` and browser probes show two distribution hostnames as different
   registrable sites.
2. Chrome, Firefox and the required WebKit prototype register and restart the
   same-origin package worker while offline.
3. One entitlement cannot read or set cookies, Web Storage, IndexedDB, Cache
   Storage or service-worker state visible to another entitlement.
4. `LMSCommit` and `LMSFinish` synchronously stage the bounded checkpoint before
   success, including immediate renderer/application termination tests.
5. The exact-origin sibling `MessageChannel` binding remains unchanged.
6. Runtime assets, range requests, immutable inventories and complete downloads
   behave identically through CloudFront.
7. Cleanup returns `Clear-Site-Data`, produces the expected receipt, and cannot
   clear or retire another entitlement.
8. Duplicate allocation, lost response, stale ETag, disable/delete retry and
   quota exhaustion recover idempotently.
9. Provisioning and retirement latency fit the learner journey, with a visible
   asynchronous preparing state rather than a blocked request.
10. Quota increases and an exit strategy are approved before retained active
    entitlements approach the account limit.
11. Reconfirm before production activation that the supported-client baseline
    and organisational transport policy have not changed since the recorded
    acceptance of the default CloudFront certificate's fixed TLS policy.

AWS currently documents a default quota of 500 distributions per account and
100 distributions associated with one origin access control or custom policy.
Those values are adjustable but make per-entitlement CloudFront a hypothesis,
not a proven long-term scale model:
[CloudFront quotas](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html).

## Cost and operations

This topology keeps one private S3 copy of every package. It adds CloudFront
viewer requests and data transfer, origin requests through the application
host, S3 reads performed by that host, Lambda allocator invocations, CloudFront
standard-log S3 PUT/storage charges, CloudTrail data-event charges if enabled,
and WAF charges before activation. Price Class 100 limits the initial edge
footprint, but qualification must measure Australian learner latency. Costs must
be tagged and reported per environment and purpose. Current pricing must be
reviewed immediately before activation:
[CloudFront pricing](https://aws.amazon.com/cloudfront/pricing/) and
[S3 pricing](https://aws.amazon.com/s3/pricing/).

The log bucket remains managed by the storage stack across qualification-context
toggles, while stable application-stack outputs retain its ARN and domain
imports. Rollback therefore cannot remove an export while the previous
application template still imports it. The bucket uses SSE-S3, blocks public
access, grants the legacy CloudFront log-delivery ACL required by standard
logging, and expires staging logs after 30 days and production logs after 90
days. The allocator can read and update only that bucket's ACL as required while
creating a legacy-logged distribution. If CloudFront logging moves to a
bucket-owner-enforced delivery mechanism, restore disabled ACLs.

The generated origin-capability key remains managed by the application stack
even while the explicit qualification context is absent. Removing and later
restoring the context therefore reuses the same CloudFormation resource instead
of colliding with an orphaned fixed-name secret or silently changing the HMAC
authority. Production also retains the key on whole-stack deletion; restoring a
deleted stack still requires the normal retained-resource recovery process.

## Alternatives considered

- **Private PSL suffix.** Still the cleanest high-scale web topology and remains
  the fallback if provider-owned resource provisioning fails its gates.
- **One S3 Access Point per entitlement.** Avoids duplicating objects and offers
  provider-owned hostnames, but requires a signed bootstrap/subresource design
  and cannot currently reproduce arbitrary security and `Clear-Site-Data`
  response headers as directly as the existing package host.
- **One S3 bucket per entitlement.** Gives a provider-owned site but duplicates
  immutable objects and multiplies request, storage and cleanup work.
- **Opaque sandbox with injected SCORM API bridge.** Rejected unless a durable
  synchronous staging primitive is proven. `postMessage` alone cannot make a
  synchronous SCORM commit acknowledgement durable.
- **Sibling subdomains without PSL isolation.** Rejected because package code
  can set parent-domain cookies visible to another attempt.
- **Native container.** Retained as the fallback when browser engines cannot
  satisfy synchronous storage and isolation gates.

## Delivery sequence

1. Record this ADR and add the initially operator-only allocator with encrypted
   access logging and no learner activation path.
2. Add a forward-only database model for distribution ID/domain and the explicit
   allocation lifecycle, including lost-response recovery. **Implemented,
   dormant, by migration 0120.**
3. Add constant-time CloudFront-origin capability validation to the package
   host, still disabled and covered across every route and lifecycle state.
   **Implemented, dormant, with no deployment-mode flag.**
4. Add the asynchronous server-owned workflow in bounded increments:
   - allocation and activation recovery for pre-existing reservations is
     **implemented and dormant** with migration 0121;
   - authenticated Course reservation creation and atomic entitlement/cleanup
     issuance are **implemented and dormant** with migration 0122;
   - distribution retirement is **implemented and dormant**; and
   - exact staging-only shared-host risk acceptance is **implemented as a CDK
     gate**; production still requires a distinct AWS worker principal; and
   - the separate CloudFront-scope WAF stack, filtered WAF logging, blocked
     request alarm, exact allocator WAF binding and 25-distribution staging cap
     are **implemented and dormant**.
5. Run the browser, cleanup, latency, quota, WAF and cost qualification matrix.
   The read-only deployed-boundary harness is **implemented**; retain its
   staging report with the manual device and operational evidence.
6. Amend this ADR to Accepted or Rejected. Only an Accepted amendment may add a
   deployment-mode flag and activate staging learners.

## Consequences

The first spike preserves the existing SCORM runtime and S3 ingestion instead
of combining isolation qualification with content-delivery replacement. It
also introduces slow, quota-bound global resources into entitlement lifecycle
planning. Entitlement preparation must therefore become asynchronous and
observable.

No current learner path changes in this slice. The private-PSL implementation,
localhost development flow, signed envelopes, package host and cleanup model
remain authoritative until this ADR is accepted and the activation flag is
deliberately enabled.

## Related documents

- [ADR 0041: Progressive web application and offline SCORM delivery](0041-progressive-web-app-and-offline-scorm-delivery.md)
- [ADR 0042: Device-bound offline learning entitlements](0042-device-bound-offline-learning-entitlements.md)
- [ADR 0043: Offline SCORM runtime and local progress journal](0043-offline-scorm-runtime-and-local-progress-journal.md)
- [ADR 0044: Idempotent offline SCORM reconciliation](0044-idempotent-offline-scorm-reconciliation.md)
- [Offline SCORM delivery plan](../architecture/offline-scorm-delivery-plan.md)
- [Security architecture and threat boundaries](../architecture/security-architecture-and-threat-boundaries.md)
