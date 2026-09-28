import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createDistributionConfig } from "../deploy/cdk/lambda/offline-scorm-cloudfront-entitlement/index.mjs";
import {
  areOwnedDistributionsDeployed,
  AwsCliError,
  canWorkerInvokePinnedAllocator,
  classifyQualificationDistributions,
  collectCloudFrontQualificationReport,
  evaluateQuotaHeadroom,
  hasConfirmedEmailSubscription,
  hasExpectedAllocatorConfiguration,
  hasExpectedAllocatorRoleBoundary,
  hasExpectedCloudFrontLogDeliveryAcl,
  hasExpectedLogBucketPublicAccessBoundary,
  haveExpectedAlarmConfigurations,
  haveExpectedDistributionLogging,
  haveExpectedDistributionOwnership,
  haveExpectedDistributionOrigins,
  hasExpectedWafLoggingBaseline,
  hasExpectedWebAclBaseline,
  parseQualificationArguments,
  summarizeCloudTrailEvents,
} from "./qualify-offline-scorm-cloudfront.mjs";

const options = {
  applicationRegion: "ap-southeast-2",
  environment: "staging",
  expectedAccount: "123456789012",
  expectedOriginDomain: "staging.upskill.institute",
  lookbackHours: 24,
};
const webAclArn =
  "arn:aws:wafv2:us-east-1:123456789012:global/webacl/upskill-staging-offline-scorm-cloudfront/11111111-2222-3333-4444-555555555555";
const edgeAlarmTopicArn = "arn:aws:sns:us-east-1:123456789012:edge-alarms";
const allocatorAlarmTopicArn =
  "arn:aws:sns:ap-southeast-2:123456789012:operational-alarms";
const alarmEmail = "ops@codestudio.au";
const originKeySecretArn =
  "arn:aws:secretsmanager:ap-southeast-2:123456789012:secret:upskill/staging/offline-scorm/cloudfront-origin-key-example";
const wafLogGroupName = "aws-waf-logs-upskill-staging-offline-scorm-cloudfront";
const logBucketDomain = "upskill-edge-logs.s3.amazonaws.com";
const distributionId = "E1234567890ABC";
const distributionArn = `arn:aws:cloudfront::${options.expectedAccount}:distribution/${distributionId}`;
const unrelatedDistributionId = "E0987654321XYZ";
const unrelatedDistributionArn = `arn:aws:cloudfront::${options.expectedAccount}:distribution/${unrelatedDistributionId}`;
const allocatorFunctionName = "allocator";
const allocatorQualifiedFunctionName =
  "arn:aws:lambda:ap-southeast-2:123456789012:function:allocator:12";
const allocatorRoleName = "upskill-staging-allocator-role";
const allocatorRoleArn = `arn:aws:iam::${options.expectedAccount}:role/${allocatorRoleName}`;
const workerRoleName = "upskill-staging-worker-role";
const workerRoleArn = `arn:aws:iam::${options.expectedAccount}:role/${workerRoleName}`;
const entitlementId = "entitlement-123";
const originKey = "qualification-origin-key-".repeat(3);
const entitlementDigest = createHash("sha256")
  .update("upskill-offline-scorm-cloudfront-entitlement-v1", "utf8")
  .update("\0", "utf8")
  .update(options.environment, "utf8")
  .update("\0", "utf8")
  .update(entitlementId, "utf8")
  .digest("hex")
  .slice(0, 32);
const distributionComment = `upskill:staging:offline-scorm:${entitlementDigest}`;
const originCapability = createHmac("sha256", originKey)
  .update("upskill-offline-scorm-cloudfront-origin-capability-v1", "utf8")
  .update("\0", "utf8")
  .update(options.environment, "utf8")
  .update("\0", "utf8")
  .update(entitlementId, "utf8")
  .digest("base64url");

function expectedDistributionTags() {
  return [
    { Key: "Application", Value: "upskill" },
    { Key: "Environment", Value: options.environment },
    { Key: "OfflineScormEntitlementId", Value: entitlementId },
    { Key: "Purpose", Value: "offline-scorm-qualification" },
  ];
}

function expectedWafVisibility(metricName) {
  return {
    CloudWatchMetricsEnabled: true,
    MetricName: metricName,
    SampledRequestsEnabled: true,
  };
}

function expectedWebAcl() {
  return {
    ARN: webAclArn,
    DefaultAction: { Allow: {} },
    VisibilityConfig: {
      CloudWatchMetricsEnabled: true,
      MetricName: "upskill-staging-offline-scorm-all",
      SampledRequestsEnabled: true,
    },
    Rules: [
      {
        Name: "aws-managed-ip-reputation",
        Priority: 0,
        OverrideAction: { None: {} },
        VisibilityConfig: expectedWafVisibility(
          "upskill-staging-offline-scorm-ip-reputation",
        ),
        Statement: {
          ManagedRuleGroupStatement: {
            Name: "AWSManagedRulesAmazonIpReputationList",
            VendorName: "AWS",
          },
        },
      },
      {
        Name: "aws-managed-common-protections-qualification",
        Priority: 1,
        OverrideAction: { Count: {} },
        VisibilityConfig: expectedWafVisibility(
          "upskill-staging-offline-scorm-common-count",
        ),
        Statement: {
          ManagedRuleGroupStatement: {
            Name: "AWSManagedRulesCommonRuleSet",
            VendorName: "AWS",
          },
        },
      },
      {
        Name: "per-ip-request-rate",
        Priority: 2,
        Action: { Block: {} },
        VisibilityConfig: expectedWafVisibility(
          "upskill-staging-offline-scorm-rate-limit",
        ),
        Statement: {
          RateBasedStatement: {
            AggregateKeyType: "IP",
            EvaluationWindowSec: 300,
            Limit: 2_000,
          },
        },
      },
    ],
  };
}

function expectedDistributionConfiguration() {
  return createDistributionConfig({
    entitlementId,
    environment: options.environment,
    logBucketDomain,
    originCapability,
    originDomain: options.expectedOriginDomain,
    webAclArn,
  });
}

function expectedAllocatorBaseline() {
  return {
    accountId: options.expectedAccount,
    applicationRegion: options.applicationRegion,
    environment: options.environment,
    functionName: allocatorFunctionName,
    logBucketDomain,
    originDomain: options.expectedOriginDomain,
    originKeySecretArn,
    qualificationCap: 25,
    qualifiedFunctionName: allocatorQualifiedFunctionName,
    roleArn: allocatorRoleArn,
    webAclName: "upskill-staging-offline-scorm-cloudfront",
  };
}

function expectedAllocatorConfiguration() {
  return {
    Description:
      "Dormant worker-owned allocator for exact-entitlement CloudFront qualification sites",
    CodeSha256: `${"a".repeat(43)}=`,
    Environment: {
      Variables: {
        UPSKILL_ENVIRONMENT: options.environment,
        UPSKILL_OFFLINE_SCORM_EDGE_LOG_BUCKET_DOMAIN: logBucketDomain,
        UPSKILL_OFFLINE_SCORM_MAX_DISTRIBUTIONS: "25",
        UPSKILL_OFFLINE_SCORM_ORIGIN_DOMAIN: options.expectedOriginDomain,
        UPSKILL_OFFLINE_SCORM_ORIGIN_KEY_SECRET_ARN: originKeySecretArn,
        UPSKILL_OFFLINE_SCORM_WEB_ACL_NAME:
          "upskill-staging-offline-scorm-cloudfront",
      },
    },
    FunctionName: allocatorFunctionName,
    Handler: "index.handler",
    LastUpdateStatus: "Successful",
    Role: allocatorRoleArn,
    Runtime: "nodejs22.x",
    State: "Active",
    Timeout: 120,
    Version: "12",
  };
}

function expectedAllocatorInlinePolicy() {
  return {
    PolicyName: "allocator-policy",
    PolicyDocument: {
      Version: "2012-10-17",
      Statement: [
        {
          Action: [
            "secretsmanager:GetSecretValue",
            "secretsmanager:DescribeSecret",
          ],
          Effect: "Allow",
          Resource: originKeySecretArn,
        },
        {
          Action: ["s3:GetBucketAcl", "s3:PutBucketAcl"],
          Effect: "Allow",
          Resource: "arn:aws:s3:::upskill-edge-logs",
        },
        {
          Action: "wafv2:ListWebACLs",
          Effect: "Allow",
          Resource: "*",
        },
        {
          Action: "wafv2:ListTagsForResource",
          Effect: "Allow",
          Resource:
            "arn:aws:wafv2:us-east-1:123456789012:global/webacl/upskill-staging-offline-scorm-cloudfront/*",
        },
        {
          Action: [
            "cloudfront:ListDistributions",
            "cloudfront:CreateDistributionWithTags",
          ],
          Effect: "Allow",
          Resource: "*",
        },
        {
          Action: [
            "cloudfront:UpdateDistribution",
            "cloudfront:GetDistributionConfig",
            "cloudfront:ListTagsForResource",
            "cloudfront:DeleteDistribution",
            "cloudfront:GetDistribution",
          ],
          Effect: "Allow",
          Resource: "arn:aws:cloudfront::123456789012:distribution/*",
        },
      ],
    },
  };
}

function expectedAllocatorRoleResponses() {
  return {
    role: {
      Role: {
        Arn: allocatorRoleArn,
        AssumeRolePolicyDocument: {
          Version: "2012-10-17",
          Statement: [
            {
              Action: "sts:AssumeRole",
              Effect: "Allow",
              Principal: { Service: "lambda.amazonaws.com" },
            },
          ],
        },
        MaxSessionDuration: 3_600,
        RoleName: allocatorRoleName,
      },
    },
    attached: {
      AttachedPolicies: [
        {
          PolicyArn:
            "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
          PolicyName: "AWSLambdaBasicExecutionRole",
        },
      ],
    },
    names: { PolicyNames: ["allocator-policy"] },
    policies: [expectedAllocatorInlinePolicy()],
  };
}

function expectedLogBucketAcl() {
  const ownerId = "canonical-owner-id";
  const logDeliveryUri = "http://acs.amazonaws.com/groups/s3/LogDelivery";
  return {
    Owner: { ID: ownerId },
    Grants: [
      {
        Grantee: { ID: ownerId, Type: "CanonicalUser" },
        Permission: "FULL_CONTROL",
      },
      {
        Grantee: { Type: "Group", URI: logDeliveryUri },
        Permission: "READ_ACP",
      },
      {
        Grantee: { Type: "Group", URI: logDeliveryUri },
        Permission: "WRITE",
      },
    ],
  };
}

function expectedWorkerInvocationSimulation() {
  return {
    EvaluationResults: [
      {
        EvalActionName: "lambda:InvokeFunction",
        EvalDecision: "allowed",
        MissingContextValues: [],
        ResourceSpecificResults: [
          {
            EvalResourceDecision: "allowed",
            EvalResourceName: allocatorQualifiedFunctionName,
            MissingContextValues: [],
          },
        ],
      },
    ],
  };
}

function expectedLogBucketPublicAccessBlock() {
  return {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
  };
}

function expectedLogBucketPolicyStatus() {
  return { PolicyStatus: { IsPublic: false } };
}

function expectedAlarmConfigurations() {
  const defaults = {
    ActionsEnabled: true,
    ComparisonOperator: "GreaterThanOrEqualToThreshold",
    EvaluationPeriods: 1,
    Period: 300,
    Statistic: "Sum",
    TreatMissingData: "notBreaching",
  };
  return [
    {
      ...defaults,
      AlarmActions: [edgeAlarmTopicArn],
      AlarmName: "edge",
      Dimensions: [
        { Name: "Rule", Value: "ALL" },
        { Name: "Region", Value: "Global" },
      ],
      MetricName: "BlockedRequests",
      Namespace: "AWS/WAFV2",
      Threshold: 100,
    },
    {
      ...defaults,
      AlarmActions: [allocatorAlarmTopicArn],
      AlarmName: "allocator",
      Dimensions: [{ Name: "FunctionName", Value: "allocator" }],
      MetricName: "Errors",
      Namespace: "AWS/Lambda",
      Threshold: 1,
    },
  ];
}

function expectedAlarmDefinitions() {
  return [
    {
      actionArn: edgeAlarmTopicArn,
      alarmName: "edge",
      comparisonOperator: "GreaterThanOrEqualToThreshold",
      dimensions: [
        { Name: "Region", Value: "Global" },
        { Name: "Rule", Value: "ALL" },
      ],
      evaluationPeriods: 1,
      metricName: "BlockedRequests",
      namespace: "AWS/WAFV2",
      period: 300,
      statistic: "Sum",
      threshold: 100,
      treatMissingData: "notBreaching",
      unit: undefined,
    },
    {
      actionArn: allocatorAlarmTopicArn,
      alarmName: "allocator",
      comparisonOperator: "GreaterThanOrEqualToThreshold",
      dimensions: [{ Name: "FunctionName", Value: "allocator" }],
      evaluationPeriods: 1,
      metricName: "Errors",
      namespace: "AWS/Lambda",
      period: 300,
      statistic: "Sum",
      threshold: 1,
      treatMissingData: "notBreaching",
      unit: undefined,
    },
  ];
}

function expectedWafLoggingConfiguration() {
  return {
    ResourceArn: webAclArn,
    LogDestinationConfigs: [
      `arn:aws:logs:us-east-1:123456789012:log-group:${wafLogGroupName}`,
    ],
    RedactedFields: [
      { SingleHeader: { Name: "authorization" } },
      { SingleHeader: { Name: "cookie" } },
      { QueryString: {} },
    ],
    LoggingFilter: {
      DefaultBehavior: "DROP",
      Filters: [
        {
          Behavior: "KEEP",
          Requirement: "MEETS_ANY",
          Conditions: [
            { ActionCondition: { Action: "BLOCK" } },
            { ActionCondition: { Action: "COUNT" } },
          ],
        },
      ],
    },
  };
}

describe("Offline SCORM CloudFront qualification harness", () => {
  it("requires an explicit staging target and expected account", () => {
    expect(() => parseQualificationArguments([])).toThrow("staging-only");
    expect(() =>
      parseQualificationArguments([
        "--",
        "--environment",
        "staging",
        "--expected-account",
        "wrong",
        "--expected-origin-domain",
        "staging.upskill.institute",
      ]),
    ).toThrow("12-digit");
    expect(
      parseQualificationArguments([
        "--environment",
        "staging",
        "--expected-account",
        "123456789012",
        "--expected-origin-domain",
        "staging.upskill.institute",
      ]),
    ).toEqual(options);
  });

  it("keeps the qualification cap recoverable while requiring global quota headroom", () => {
    expect(
      evaluateQuotaHeadroom({
        distributionQuota: 500,
        ownedDistributionCount: 4,
        qualificationCap: 25,
        totalDistributionCount: 480,
      }),
    ).toMatchObject({
      availableCapacity: 20,
      requiredAdditionalCapacity: 21,
      sufficient: false,
    });
    const inventory = classifyQualificationDistributions(
      [
        { Comment: "upskill:staging:offline-scorm:one" },
        { Comment: "upskill:staging:offline-scorm:one" },
        {
          inventoryComment: "changed-comment",
          tags: expectedDistributionTags(),
        },
        {
          inventoryComment: "fully-drifted",
          tags: [],
          webAclId: webAclArn,
        },
        { Comment: "unrelated" },
      ],
      "staging",
      webAclArn,
    );
    expect(inventory.owned).toHaveLength(4);
    expect(inventory.owned).toContainEqual(
      expect.objectContaining({ inventoryComment: "changed-comment" }),
    );
    expect(inventory.owned).toContainEqual(
      expect.objectContaining({ inventoryComment: "fully-drifted" }),
    );
    expect(inventory.duplicateMarkers).toEqual([
      "upskill:staging:offline-scorm:one",
    ]);
  });

  it("requires every owned distribution to be fully deployed", () => {
    expect(
      areOwnedDistributionsDeployed([
        { deploymentStatus: "Deployed" },
        { deploymentStatus: "Deployed" },
      ]),
    ).toBe(true);
    expect(
      areOwnedDistributionsDeployed([
        { deploymentStatus: "Deployed" },
        { deploymentStatus: "InProgress" },
      ]),
    ).toBe(false);
    expect(areOwnedDistributionsDeployed([{}])).toBe(false);
  });

  it("redacts CloudTrail request detail while retaining mutation evidence", () => {
    expect(
      summarizeCloudTrailEvents([
        {
          CloudTrailEvent: JSON.stringify({
            errorCode: "AccessDenied",
            requestParameters: { secret: "must-not-appear" },
            userIdentity: {
              invokedBy: "lambda.amazonaws.com",
              type: "AWSService",
            },
          }),
          EventName: "UpdateDistribution",
          EventTime: "2026-09-28T00:00:00Z",
          ReadOnly: "false",
        },
        { EventName: "ListDistributions" },
      ]),
    ).toEqual([
      {
        errorCode: "AccessDenied",
        eventName: "UpdateDistribution",
        eventTime: "2026-09-28T00:00:00Z",
        identityType: "AWSService",
        invokedBy: "lambda.amazonaws.com",
        readOnly: false,
      },
    ]);
  });

  it("requires every alarm to match its metric, evaluation and notification baseline", () => {
    const expectedDefinitions = expectedAlarmDefinitions();
    const alarms = expectedAlarmConfigurations();
    expect(haveExpectedAlarmConfigurations(alarms, expectedDefinitions)).toBe(
      true,
    );
    expect(
      haveExpectedAlarmConfigurations(
        alarms.map((alarm) =>
          alarm.AlarmName === "edge"
            ? { ...alarm, ActionsEnabled: false }
            : alarm,
        ),
        expectedDefinitions,
      ),
    ).toBe(false);
    for (const drift of [
      { AlarmActions: [edgeAlarmTopicArn] },
      { Namespace: "Unrelated/Namespace" },
      { MetricName: "Invocations" },
      { Dimensions: [{ Name: "FunctionName", Value: "another-function" }] },
      { Period: 60 },
      { Statistic: "Average" },
      { Threshold: 100 },
      { ComparisonOperator: "LessThanThreshold" },
      { EvaluationPeriods: 5 },
      { TreatMissingData: "missing" },
      { Unit: "Bytes" },
    ]) {
      expect(
        haveExpectedAlarmConfigurations(
          alarms.map((alarm) =>
            alarm.AlarmName === "allocator" ? { ...alarm, ...drift } : alarm,
          ),
          expectedDefinitions,
        ),
      ).toBe(false);
    }
  });

  it("requires the live allocator runtime, environment and concurrency baseline", () => {
    const configuration = expectedAllocatorConfiguration();
    const concurrency = { ReservedConcurrentExecutions: 1 };
    const baseline = expectedAllocatorBaseline();
    expect(
      hasExpectedAllocatorConfiguration(configuration, concurrency, baseline),
    ).toBe(true);
    for (const drift of [
      { State: "Pending" },
      { LastUpdateStatus: "InProgress" },
      { Runtime: "nodejs20.x" },
      { Handler: "other.handler" },
      { Timeout: 30 },
      { Description: "drifted" },
      { CodeSha256: "invalid" },
      { Role: "arn:aws:iam::123456789012:role/broader-role" },
      { Version: "13" },
    ]) {
      expect(
        hasExpectedAllocatorConfiguration(
          { ...configuration, ...drift },
          concurrency,
          baseline,
        ),
      ).toBe(false);
    }
    expect(
      hasExpectedAllocatorConfiguration(
        {
          ...configuration,
          Environment: {
            Variables: {
              ...configuration.Environment.Variables,
              UPSKILL_OFFLINE_SCORM_MAX_DISTRIBUTIONS: "50",
            },
          },
        },
        concurrency,
        baseline,
      ),
    ).toBe(false);
    expect(
      hasExpectedAllocatorConfiguration(
        configuration,
        { ReservedConcurrentExecutions: 2 },
        baseline,
      ),
    ).toBe(false);
  });

  it("requires the exact allocator trust, managed and inline policy boundary", () => {
    const responses = expectedAllocatorRoleResponses();
    const expected = {
      accountId: options.expectedAccount,
      logBucketArn: "arn:aws:s3:::upskill-edge-logs",
      originKeySecretArn,
      roleArn: allocatorRoleArn,
      webAclArn,
    };
    expect(
      hasExpectedAllocatorRoleBoundary(
        responses.role,
        responses.attached,
        responses.names,
        responses.policies,
        expected,
      ),
    ).toBe(true);
    expect(
      hasExpectedAllocatorRoleBoundary(
        responses.role,
        {
          AttachedPolicies: [
            ...responses.attached.AttachedPolicies,
            {
              PolicyArn: "arn:aws:iam::aws:policy/AdministratorAccess",
              PolicyName: "AdministratorAccess",
            },
          ],
        },
        responses.names,
        responses.policies,
        expected,
      ),
    ).toBe(false);
    expect(
      hasExpectedAllocatorRoleBoundary(
        responses.role,
        responses.attached,
        responses.names,
        [
          {
            ...responses.policies[0],
            PolicyDocument: {
              ...responses.policies[0].PolicyDocument,
              Statement: [
                ...responses.policies[0].PolicyDocument.Statement,
                { Action: "iam:*", Effect: "Allow", Resource: "*" },
              ],
            },
          },
        ],
        expected,
      ),
    ).toBe(false);
    expect(
      hasExpectedAllocatorRoleBoundary(
        {
          Role: {
            ...responses.role.Role,
            AssumeRolePolicyDocument: {
              Version: "2012-10-17",
              Statement: [
                {
                  Action: "sts:AssumeRole",
                  Effect: "Allow",
                  Principal: { AWS: "*" },
                },
              ],
            },
          },
        },
        responses.attached,
        responses.names,
        responses.policies,
        expected,
      ),
    ).toBe(false);
  });

  it("requires the exact CloudFront log-delivery bucket ACL", () => {
    const acl = expectedLogBucketAcl();
    expect(hasExpectedCloudFrontLogDeliveryAcl(acl)).toBe(true);
    for (const permission of ["READ_ACP", "WRITE"]) {
      expect(
        hasExpectedCloudFrontLogDeliveryAcl({
          ...acl,
          Grants: acl.Grants.filter((grant) => grant.Permission !== permission),
        }),
      ).toBe(false);
    }
    expect(
      hasExpectedCloudFrontLogDeliveryAcl({
        ...acl,
        Grants: [
          ...acl.Grants,
          {
            Grantee: {
              Type: "Group",
              URI: "http://acs.amazonaws.com/groups/global/AllUsers",
            },
            Permission: "READ",
          },
        ],
      }),
    ).toBe(false);
  });

  it("requires the worker to invoke the exact pinned allocator version", () => {
    const simulation = expectedWorkerInvocationSimulation();
    expect(
      canWorkerInvokePinnedAllocator(
        simulation,
        allocatorQualifiedFunctionName,
      ),
    ).toBe(true);
    expect(
      canWorkerInvokePinnedAllocator(
        simulation,
        allocatorQualifiedFunctionName.replace(":12", ""),
      ),
    ).toBe(false);
    expect(
      canWorkerInvokePinnedAllocator(
        {
          EvaluationResults: [
            {
              ...simulation.EvaluationResults[0],
              EvalDecision: "implicitDeny",
            },
          ],
        },
        allocatorQualifiedFunctionName,
      ),
    ).toBe(false);
    expect(
      canWorkerInvokePinnedAllocator(
        {
          EvaluationResults: [
            {
              ...simulation.EvaluationResults[0],
              MissingContextValues: ["aws:RequestedRegion"],
            },
          ],
        },
        allocatorQualifiedFunctionName,
      ),
    ).toBe(false);
    expect(
      canWorkerInvokePinnedAllocator(
        {
          EvaluationResults: [
            {
              ...simulation.EvaluationResults[0],
              ResourceSpecificResults: [
                {
                  ...simulation.EvaluationResults[0].ResourceSpecificResults[0],
                  EvalResourceName:
                    "arn:aws:lambda:ap-southeast-2:123456789012:function:allocator:11",
                },
              ],
            },
          ],
        },
        allocatorQualifiedFunctionName,
      ),
    ).toBe(false);
  });

  it("requires every bucket public-access block and a non-public policy", () => {
    const publicAccessBlock = expectedLogBucketPublicAccessBlock();
    const policyStatus = expectedLogBucketPolicyStatus();
    expect(
      hasExpectedLogBucketPublicAccessBoundary(publicAccessBlock, policyStatus),
    ).toBe(true);
    for (const property of Object.keys(
      publicAccessBlock.PublicAccessBlockConfiguration,
    )) {
      expect(
        hasExpectedLogBucketPublicAccessBoundary(
          {
            PublicAccessBlockConfiguration: {
              ...publicAccessBlock.PublicAccessBlockConfiguration,
              [property]: false,
            },
          },
          policyStatus,
        ),
      ).toBe(false);
    }
    expect(
      hasExpectedLogBucketPublicAccessBoundary(publicAccessBlock, {
        PolicyStatus: { IsPublic: true },
      }),
    ).toBe(false);
  });

  it("requires the configured operations endpoint to be confirmed", () => {
    const expectedEndpoint = "ops@codestudio.au";
    const subscription = {
      Endpoint: expectedEndpoint,
      Protocol: "email",
      SubscriptionArn: `${edgeAlarmTopicArn}:subscription`,
    };
    expect(
      hasConfirmedEmailSubscription(
        { Subscriptions: [subscription] },
        edgeAlarmTopicArn,
        expectedEndpoint,
      ),
    ).toBe(true);
    expect(
      hasConfirmedEmailSubscription(
        {
          Subscriptions: [
            { ...subscription, Endpoint: "unrelated@example.com" },
          ],
        },
        edgeAlarmTopicArn,
        expectedEndpoint,
      ),
    ).toBe(false);
    expect(
      hasConfirmedEmailSubscription(
        {
          Subscriptions: [
            { ...subscription, SubscriptionArn: "PendingConfirmation" },
          ],
        },
        edgeAlarmTopicArn,
        expectedEndpoint,
      ),
    ).toBe(false);
  });

  it("requires every owned distribution to target only the direct package origin", () => {
    const distribution = expectedDistributionConfiguration();
    const record = {
      configuration: distribution,
      tags: expectedDistributionTags(),
    };
    expect(
      haveExpectedDistributionOrigins(
        [record],
        options.environment,
        options.expectedOriginDomain,
        originKey,
        logBucketDomain,
        webAclArn,
      ),
    ).toBe(true);
    for (const originDrift of [
      { DomainName: "attacker.example" },
      {
        CustomOriginConfig: {
          ...distribution.Origins.Items[0].CustomOriginConfig,
          OriginProtocolPolicy: "http-only",
        },
      },
      {
        CustomOriginConfig: {
          ...distribution.Origins.Items[0].CustomOriginConfig,
          OriginSslProtocols: { Items: ["TLSv1.1"], Quantity: 1 },
        },
      },
      {
        CustomHeaders: {
          Quantity: 1,
          Items: [
            {
              HeaderName: "X-Upskill-Offline-Entitlement",
              HeaderValue: entitlementId,
            },
          ],
        },
      },
      {
        CustomHeaders: {
          Quantity: 2,
          Items: [
            {
              HeaderName: "X-Upskill-Offline-Entitlement",
              HeaderValue: entitlementId,
            },
            {
              HeaderName: "X-Upskill-Offline-Origin-Capability",
              HeaderValue: "a".repeat(43),
            },
          ],
        },
      },
    ]) {
      expect(
        haveExpectedDistributionOrigins(
          [
            {
              ...record,
              configuration: {
                ...distribution,
                Origins: {
                  Quantity: 1,
                  Items: [
                    {
                      ...distribution.Origins.Items[0],
                      ...originDrift,
                    },
                  ],
                },
              },
            },
          ],
          options.environment,
          options.expectedOriginDomain,
          originKey,
          logBucketDomain,
          webAclArn,
        ),
      ).toBe(false);
    }
    expect(
      haveExpectedDistributionOrigins(
        [
          {
            ...record,
            configuration: {
              ...distribution,
              DefaultCacheBehavior: {
                ...distribution.DefaultCacheBehavior,
                ViewerProtocolPolicy: "allow-all",
              },
            },
          },
        ],
        options.environment,
        options.expectedOriginDomain,
        originKey,
        logBucketDomain,
        webAclArn,
      ),
    ).toBe(false);
  });

  it("requires exact lifecycle ownership tags and marker binding", () => {
    const record = {
      configuration: expectedDistributionConfiguration(),
      distributionArn,
      distributionId,
      inventoryComment: distributionComment,
      tags: expectedDistributionTags(),
    };
    expect(
      haveExpectedDistributionOwnership(
        [record],
        options.environment,
        options.expectedAccount,
      ),
    ).toBe(true);
    for (const tagDrift of [
      { Key: "Application", Value: "another-application" },
      { Key: "Environment", Value: "production" },
      { Key: "OfflineScormEntitlementId", Value: "another-entitlement" },
      { Key: "Purpose", Value: "another-purpose" },
    ]) {
      expect(
        haveExpectedDistributionOwnership(
          [
            {
              ...record,
              tags: record.tags.map((tag) =>
                tag.Key === tagDrift.Key ? tagDrift : tag,
              ),
            },
          ],
          options.environment,
          options.expectedAccount,
        ),
      ).toBe(false);
    }
    expect(
      haveExpectedDistributionOwnership(
        [{ ...record, distributionArn: distributionArn.replace("123", "999") }],
        options.environment,
        options.expectedAccount,
      ),
    ).toBe(false);
  });

  it("requires entitlement-specific access logging on every owned distribution", () => {
    const configuration = expectedDistributionConfiguration();
    const distributions = [
      { configuration, inventoryComment: distributionComment },
    ];
    expect(
      haveExpectedDistributionLogging(
        distributions,
        options.environment,
        logBucketDomain,
      ),
    ).toBe(true);
    for (const loggingDrift of [
      { Enabled: false },
      { IncludeCookies: true },
      { Bucket: "redirected-logs.s3.amazonaws.com" },
      { Prefix: "offline-scorm/staging/another-package/" },
    ]) {
      expect(
        haveExpectedDistributionLogging(
          [
            {
              configuration: {
                ...configuration,
                Logging: { ...configuration.Logging, ...loggingDrift },
              },
              inventoryComment: distributionComment,
            },
          ],
          options.environment,
          logBucketDomain,
        ),
      ).toBe(false);
    }
  });

  it("requires the complete deployed WAF security baseline", () => {
    const webAcl = expectedWebAcl();
    expect(hasExpectedWebAclBaseline(webAcl, options.environment)).toBe(true);
    expect(
      hasExpectedWebAclBaseline(
        {
          ...webAcl,
          Rules: webAcl.Rules.map((rule) =>
            rule.Name === "per-ip-request-rate"
              ? {
                  ...rule,
                  Statement: {
                    RateBasedStatement: {
                      AggregateKeyType: "IP",
                      EvaluationWindowSec: 300,
                      Limit: 4_000,
                    },
                  },
                }
              : rule,
          ),
        },
        options.environment,
      ),
    ).toBe(false);
    expect(
      hasExpectedWebAclBaseline(
        {
          ...webAcl,
          Rules: webAcl.Rules.filter(
            (rule) => rule.Name !== "aws-managed-ip-reputation",
          ),
        },
        options.environment,
      ),
    ).toBe(false);
    expect(
      hasExpectedWebAclBaseline(
        {
          ...webAcl,
          VisibilityConfig: {
            ...webAcl.VisibilityConfig,
            CloudWatchMetricsEnabled: false,
          },
        },
        options.environment,
      ),
    ).toBe(false);
    for (const visibilityDrift of [
      { CloudWatchMetricsEnabled: false },
      { SampledRequestsEnabled: false },
      { MetricName: "unrelated-metric" },
    ]) {
      expect(
        hasExpectedWebAclBaseline(
          {
            ...webAcl,
            Rules: webAcl.Rules.map((rule) =>
              rule.Name === "aws-managed-common-protections-qualification"
                ? {
                    ...rule,
                    VisibilityConfig: {
                      ...rule.VisibilityConfig,
                      ...visibilityDrift,
                    },
                  }
                : rule,
            ),
          },
          options.environment,
        ),
      ).toBe(false);
    }
  });

  it("requires WAF credential redaction and restrictive log filtering", () => {
    const logging = expectedWafLoggingConfiguration();
    expect(
      hasExpectedWafLoggingBaseline(logging, webAclArn, wafLogGroupName),
    ).toBe(true);
    expect(
      hasExpectedWafLoggingBaseline(
        {
          ...logging,
          RedactedFields: logging.RedactedFields.filter(
            (field) => field.SingleHeader?.Name !== "authorization",
          ),
        },
        webAclArn,
        wafLogGroupName,
      ),
    ).toBe(false);
    expect(
      hasExpectedWafLoggingBaseline(
        {
          ...logging,
          LoggingFilter: {
            ...logging.LoggingFilter,
            DefaultBehavior: "KEEP",
          },
        },
        webAclArn,
        wafLogGroupName,
      ),
    ).toBe(false);
  });

  it("falls back to the AWS default quota and reports delayed log evidence as a warning", async () => {
    const calls = [];
    const runner = async (args) => {
      calls.push(args);
      const command = args.slice(0, 2).join(" ");
      if (command === "sts get-caller-identity")
        return { Account: options.expectedAccount };
      if (command === "cloudformation describe-stacks") {
        const stackName = args[args.indexOf("--stack-name") + 1];
        const outputs = stackName.endsWith("application")
          ? [
              {
                OutputKey: "OfflineScormCloudFrontMaxDistributions",
                OutputValue: "25",
              },
              {
                OutputKey: "OfflineScormCloudFrontSharedHostRiskAcceptance",
                OutputValue: "staging-qualification-only",
              },
              {
                OutputKey: "OfflineScormCloudFrontAllocatorFunctionName",
                OutputValue: allocatorFunctionName,
              },
              {
                OutputKey:
                  "OfflineScormCloudFrontAllocatorQualifiedFunctionName",
                OutputValue: allocatorQualifiedFunctionName,
              },
              {
                OutputKey: "OfflineScormCloudFrontAllocatorRoleArn",
                OutputValue: allocatorRoleArn,
              },
              {
                OutputKey: "OfflineScormCloudFrontWorkerRoleArn",
                OutputValue: workerRoleArn,
              },
              {
                OutputKey: "OfflineScormCloudFrontAllocatorAlarmTopicArn",
                OutputValue: allocatorAlarmTopicArn,
              },
              {
                OutputKey: "OfflineScormCloudFrontAllocatorAlarmEmail",
                OutputValue: alarmEmail,
              },
              {
                OutputKey: "OfflineScormEdgeLogBucketArn",
                OutputValue: "arn:aws:s3:::upskill-edge-logs",
              },
              {
                OutputKey: "OfflineScormEdgeLogBucketDomain",
                OutputValue: logBucketDomain,
              },
              {
                OutputKey: "OfflineScormCloudFrontOriginKeySecretArn",
                OutputValue: originKeySecretArn,
              },
            ]
          : [
              {
                OutputKey: "OfflineScormCloudFrontWebAclArn",
                OutputValue: webAclArn,
              },
              {
                OutputKey: "OfflineScormCloudFrontWebAclName",
                OutputValue: "upskill-staging-offline-scorm-cloudfront",
              },
              {
                OutputKey: "OfflineScormWafLogGroupName",
                OutputValue: wafLogGroupName,
              },
              {
                OutputKey: "OfflineScormEdgeAlarmTopicArn",
                OutputValue: edgeAlarmTopicArn,
              },
              {
                OutputKey: "OfflineScormEdgeAlarmEmail",
                OutputValue: alarmEmail,
              },
            ];
        return {
          Stacks: [{ Outputs: outputs, StackStatus: "UPDATE_COMPLETE" }],
        };
      }
      if (command === "ssm get-parameter") {
        const parameterName = args[args.indexOf("--name") + 1];
        return {
          Parameter: {
            Value: parameterName.endsWith("allocator-function-name")
              ? allocatorQualifiedFunctionName
              : options.expectedOriginDomain,
          },
        };
      }
      if (command === "secretsmanager get-secret-value")
        return { SecretString: originKey };
      if (command === "cloudfront list-distributions")
        return {
          DistributionList: {
            Items: [
              {
                ARN: distributionArn,
                Comment: distributionComment,
                Id: distributionId,
                Status: "Deployed",
                WebACLId: webAclArn,
              },
              {
                ARN: unrelatedDistributionArn,
                Comment: "unrelated",
                Id: unrelatedDistributionId,
                Status: "Deployed",
              },
            ],
            Quantity: 2,
          },
        };
      if (command === "cloudfront get-distribution-config")
        return { DistributionConfig: expectedDistributionConfiguration() };
      if (command === "cloudfront list-tags-for-resource")
        return {
          Tags: {
            Items:
              args[args.indexOf("--resource") + 1] === distributionArn
                ? expectedDistributionTags()
                : [],
          },
        };
      if (command === "service-quotas get-service-quota")
        throw new AwsCliError("not found", "NoSuchResourceException");
      if (command === "service-quotas get-aws-default-service-quota")
        return { Quota: { Value: 500 } };
      if (command === "wafv2 get-web-acl") return { WebACL: expectedWebAcl() };
      if (command === "wafv2 list-tags-for-resource")
        return {
          TagInfoForResource: {
            TagList: [
              { Key: "Application", Value: "upskill" },
              { Key: "Environment", Value: "staging" },
              { Key: "Purpose", Value: "offline-scorm-qualification" },
            ],
          },
        };
      if (command === "wafv2 get-logging-configuration")
        return {
          LoggingConfiguration: expectedWafLoggingConfiguration(),
        };
      if (command === "logs describe-log-groups")
        return {
          logGroups: [
            {
              logGroupName: wafLogGroupName,
              retentionInDays: 30,
            },
          ],
        };
      if (command === "sns list-subscriptions-by-topic") {
        const topicArn = args[args.indexOf("--topic-arn") + 1];
        return {
          Subscriptions: [
            {
              Endpoint: alarmEmail,
              Protocol: "email",
              SubscriptionArn: `${topicArn}:subscription`,
            },
          ],
        };
      }
      if (command === "cloudwatch describe-alarms") {
        const region = args[args.indexOf("--region") + 1];
        const actionArn =
          region === "us-east-1" ? edgeAlarmTopicArn : allocatorAlarmTopicArn;
        return {
          MetricAlarms: args
            .slice(args.indexOf("--alarm-names") + 1, args.indexOf("--region"))
            .map((AlarmName) => {
              const isEdge = region === "us-east-1";
              return {
                ActionsEnabled: true,
                AlarmActions: [actionArn],
                AlarmName,
                ComparisonOperator: "GreaterThanOrEqualToThreshold",
                Dimensions: isEdge
                  ? [
                      { Name: "Region", Value: "Global" },
                      { Name: "Rule", Value: "ALL" },
                      {
                        Name: "WebACL",
                        Value: "upskill-staging-offline-scorm-cloudfront",
                      },
                    ]
                  : [{ Name: "FunctionName", Value: "allocator" }],
                EvaluationPeriods: 1,
                MetricName: isEdge
                  ? "BlockedRequests"
                  : AlarmName.endsWith("-errors")
                    ? "Errors"
                    : "Throttles",
                Namespace: isEdge ? "AWS/WAFV2" : "AWS/Lambda",
                Period: 300,
                Statistic: "Sum",
                Threshold: isEdge ? 100 : 1,
                TreatMissingData: "notBreaching",
              };
            }),
        };
      }
      if (command === "lambda get-function-configuration")
        return expectedAllocatorConfiguration();
      if (command === "lambda get-function-concurrency")
        return { ReservedConcurrentExecutions: 1 };
      if (command === "iam get-role")
        return expectedAllocatorRoleResponses().role;
      if (command === "iam list-attached-role-policies")
        return expectedAllocatorRoleResponses().attached;
      if (command === "iam list-role-policies")
        return expectedAllocatorRoleResponses().names;
      if (command === "iam simulate-principal-policy")
        return expectedWorkerInvocationSimulation();
      if (command === "iam get-role-policy")
        return expectedAllocatorRoleResponses().policies[0];
      if (command === "s3api get-bucket-acl") return expectedLogBucketAcl();
      if (command === "s3api get-public-access-block")
        return expectedLogBucketPublicAccessBlock();
      if (command === "s3api get-bucket-policy-status")
        return expectedLogBucketPolicyStatus();
      if (command === "cloudtrail lookup-events") return { Events: [] };
      if (command === "s3api list-objects-v2") return { Contents: [] };
      throw new Error(`Unexpected AWS command ${command}`);
    };
    const report = await collectCloudFrontQualificationReport(options, {
      now: () => new Date("2026-09-28T00:00:00Z"),
      runAws: runner,
    });
    expect(report.checks.filter((check) => check.status === "fail")).toEqual(
      [],
    );
    expect(report.status).toBe("warning");
    expect(report.headroom).toMatchObject({
      quotaSource: "aws-default",
      sufficient: true,
    });
    expect(
      report.checks.find((check) => check.id === "access-log-evidence"),
    ).toMatchObject({ status: "warning" });
    expect(report.checks.find((check) => check.id === "web-acl")).toMatchObject(
      { status: "pass" },
    );
    expect(report.checks.find((check) => check.id === "alarms")).toMatchObject({
      status: "pass",
    });
    expect(
      report.checks.find((check) => check.id === "allocator-configuration"),
    ).toMatchObject({ status: "pass" });
    expect(
      report.checks.find((check) => check.id === "allocator-target"),
    ).toMatchObject({ status: "pass" });
    expect(
      report.checks.find((check) => check.id === "allocator-role-boundary"),
    ).toMatchObject({ status: "pass" });
    expect(
      report.checks.find((check) => check.id === "access-log-bucket-acl"),
    ).toMatchObject({ status: "pass" });
    expect(
      report.checks.find(
        (check) => check.id === "access-log-bucket-public-access",
      ),
    ).toMatchObject({ status: "pass" });
    expect(
      report.checks.find((check) => check.id === "worker-allocator-permission"),
    ).toMatchObject({ status: "pass" });
    expect(
      report.checks.find((check) => check.id === "distribution-access-logging"),
    ).toMatchObject({ status: "pass" });
    expect(
      report.checks.find((check) => check.id === "distribution-ownership"),
    ).toMatchObject({ status: "pass" });
    expect(
      report.checks.find((check) => check.id === "distribution-deployment"),
    ).toMatchObject({ status: "pass" });
    expect(
      report.checks.find((check) => check.id === "distribution-origin-binding"),
    ).toMatchObject({ status: "pass" });
    const serializedReport = JSON.stringify(report);
    expect(serializedReport).not.toContain(originKey);
    expect(serializedReport).not.toContain(originCapability);
    expect(serializedReport).not.toContain(entitlementId);
    const alarmRegions = calls
      .filter(
        (args) => args.slice(0, 2).join(" ") === "cloudwatch describe-alarms",
      )
      .map((args) => args[args.indexOf("--region") + 1]);
    expect(alarmRegions).toEqual(["us-east-1", options.applicationRegion]);
    expect(
      calls.filter(
        (args) =>
          args.slice(0, 2).join(" ") === "cloudfront get-distribution-config",
      ),
    ).toEqual([
      ["cloudfront", "get-distribution-config", "--id", distributionId],
    ]);
    expect(
      calls.filter(
        (args) =>
          args.slice(0, 2).join(" ") === "cloudfront list-tags-for-resource",
      ),
    ).toEqual([
      ["cloudfront", "list-tags-for-resource", "--resource", distributionArn],
      [
        "cloudfront",
        "list-tags-for-resource",
        "--resource",
        unrelatedDistributionArn,
      ],
    ]);
    const cloudTrailCall = calls.find(
      (args) => args.slice(0, 2).join(" ") === "cloudtrail lookup-events",
    );
    expect(cloudTrailCall).toEqual(
      expect.arrayContaining(["--max-items", "50"]),
    );
    expect(cloudTrailCall).not.toContain("--max-results");
    expect(
      calls
        .filter((args) => args[0] === "lambda")
        .map((args) => args.slice(0, 2)),
    ).toEqual([
      ["lambda", "get-function-configuration"],
      ["lambda", "get-function-concurrency"],
    ]);
    expect(
      calls.find(
        (args) =>
          args.slice(0, 2).join(" ") === "lambda get-function-configuration",
      ),
    ).toEqual([
      "lambda",
      "get-function-configuration",
      "--function-name",
      allocatorQualifiedFunctionName,
      "--region",
      options.applicationRegion,
    ]);
    expect(
      calls.filter((args) => args[0] === "iam").map((args) => args[1]),
    ).toEqual([
      "get-role",
      "list-attached-role-policies",
      "list-role-policies",
      "simulate-principal-policy",
      "get-role-policy",
    ]);
    expect(
      calls.find(
        (args) =>
          args.slice(0, 2).join(" ") === "iam simulate-principal-policy",
      ),
    ).toEqual([
      "iam",
      "simulate-principal-policy",
      "--policy-source-arn",
      workerRoleArn,
      "--action-names",
      "lambda:InvokeFunction",
      "--resource-arns",
      allocatorQualifiedFunctionName,
      "--no-paginate",
      "--region",
      options.applicationRegion,
    ]);
    for (const command of [
      "get-bucket-acl",
      "get-public-access-block",
      "get-bucket-policy-status",
      "list-objects-v2",
    ]) {
      expect(
        calls.find((args) => args.slice(0, 2).join(" ") === `s3api ${command}`),
      ).toEqual(
        expect.arrayContaining([
          "--expected-bucket-owner",
          options.expectedAccount,
        ]),
      );
    }
    expect(
      calls.filter(
        (args) =>
          args.slice(0, 2).join(" ") === "secretsmanager get-secret-value",
      ),
    ).toEqual([
      [
        "secretsmanager",
        "get-secret-value",
        "--secret-id",
        originKeySecretArn,
        "--region",
        options.applicationRegion,
      ],
    ]);
  });
});
