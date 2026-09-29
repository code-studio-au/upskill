import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createDistributionConfig } from "../deploy/cdk/lambda/offline-scorm-cloudfront-entitlement/index.mjs";
import {
  areOwnedDistributionsDeployed,
  AwsCliError,
  canWorkerInvokePinnedAllocator,
  classifyQualificationDistributions,
  collectCloudFrontQualificationReport,
  deploymentOwnedAutoDeleteRoleArn,
  evaluateQuotaHeadroom,
  hasConfirmedEmailSubscription,
  hasExpectedAlarmTopicPolicy,
  hasExpectedAlarmSubscription,
  hasExpectedAllocatorConfiguration,
  hasExpectedAllocatorRoleBoundary,
  hasExpectedWorkerAllocatorPolicyBoundary,
  hasExpectedWorkerRuntimeTarget,
  hasExpectedEdgeAlarmKmsBoundary,
  hasExpectedCloudFrontLogDeliveryAcl,
  hasExpectedLogBucketLifecycle,
  hasExpectedLogCleanupRoleBoundary,
  hasExpectedLogBucketPolicy,
  hasExpectedLogBucketPublicAccessBoundary,
  hasExpectedWorkerInstanceProfile,
  hasNoAllocatorInvocationPolicy,
  hasNoOriginKeyResourcePolicy,
  haveExpectedAlarmConfigurations,
  haveExpectedDistributionLogging,
  haveExpectedDistributionOwnership,
  haveExpectedDistributionOrigins,
  hasExpectedWafLoggingBaseline,
  hasExpectedWafLogDeliveryPolicy,
  hasExpectedWebAclBaseline,
  parseQualificationArguments,
  requireQualificationDistributionCap,
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
const edgeAlarmKeyArn =
  "arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555";
const edgeAlarmName = "upskill-staging-offline-scorm-waf-blocked-requests";
const allocatorAlarmTopicArn =
  "arn:aws:sns:ap-southeast-2:123456789012:operational-alarms";
const alarmEmail = "ops@codestudio.au";
const originKeySecretArn =
  "arn:aws:secretsmanager:ap-southeast-2:123456789012:secret:upskill/staging/offline-scorm/cloudfront-origin-key-example";
const wafLogGroupName = "aws-waf-logs-upskill-staging-offline-scorm-cloudfront";
const wafLogGroupArn = `arn:aws:logs:us-east-1:${options.expectedAccount}:log-group:${wafLogGroupName}`;
const logBucketDomain = "upskill-edge-logs.s3.amazonaws.com";
const distributionId = "E1234567890ABC";
const distributionArn = `arn:aws:cloudfront::${options.expectedAccount}:distribution/${distributionId}`;
const unrelatedDistributionId = "E0987654321XYZ";
const unrelatedDistributionArn = `arn:aws:cloudfront::${options.expectedAccount}:distribution/${unrelatedDistributionId}`;
const allocatorFunctionName = "allocator";
const allocatorQualifiedFunctionName =
  "arn:aws:lambda:ap-southeast-2:123456789012:function:allocator:12";
const allocatorCodeSha256 = `${"a".repeat(43)}=`;
const allocatorRoleName = "upskill-staging-allocator-role";
const allocatorRoleArn = `arn:aws:iam::${options.expectedAccount}:role/${allocatorRoleName}`;
const workerRoleName = "upskill-staging-worker-role";
const workerRoleArn = `arn:aws:iam::${options.expectedAccount}:role/${workerRoleName}`;
const applicationInstanceId = "i-0123456789abcdef0";
const workerInstanceProfileName = "upskill-staging-worker-profile";
const workerInstanceProfileArn = `arn:aws:iam::${options.expectedAccount}:instance-profile/${workerInstanceProfileName}`;
const autoDeleteRoleName =
  "upskill-staging-storage-CustomS3AutoDeleteObjectsRole-ABC123";
const autoDeleteRoleArn = `arn:aws:iam::${options.expectedAccount}:role/${autoDeleteRoleName}`;
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
    codeSha256: allocatorCodeSha256,
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
    CodeSha256: allocatorCodeSha256,
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
    Layers: [],
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

function expectedWorkerRoleResponses() {
  return {
    role: {
      Role: {
        Arn: workerRoleArn,
        AssumeRolePolicyDocument: {
          Version: "2012-10-17",
          Statement: [
            {
              Action: "sts:AssumeRole",
              Effect: "Allow",
              Principal: { Service: "ec2.amazonaws.com" },
            },
          ],
        },
        MaxSessionDuration: 3_600,
        RoleName: workerRoleName,
      },
    },
    attached: {
      AttachedPolicies: [
        {
          PolicyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
          PolicyName: "AmazonSSMManagedInstanceCore",
        },
      ],
    },
    names: { PolicyNames: ["worker-policy"] },
    policies: [
      {
        PolicyName: "worker-policy",
        RoleName: workerRoleName,
        PolicyDocument: {
          Version: "2012-10-17",
          Statement: [
            {
              Action: "lambda:InvokeFunction",
              Effect: "Allow",
              Resource: allocatorQualifiedFunctionName,
            },
            {
              Action: "ssm:GetParameter",
              Effect: "Allow",
              Resource:
                "arn:aws:ssm:ap-southeast-2:123456789012:parameter/example",
            },
          ],
        },
      },
    ],
  };
}

function expectedWorkerInstances() {
  return {
    Reservations: [
      {
        Instances: [
          {
            IamInstanceProfile: { Arn: workerInstanceProfileArn },
            InstanceId: applicationInstanceId,
            State: { Name: "running" },
          },
        ],
      },
    ],
  };
}

function expectedWorkerInstanceProfile() {
  return {
    InstanceProfile: {
      Arn: workerInstanceProfileArn,
      InstanceProfileName: workerInstanceProfileName,
      Roles: [{ Arn: workerRoleArn, RoleName: workerRoleName }],
    },
  };
}

function expectedAlarmTopicPolicy(topicArn, region, alarmName) {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Action: "SNS:Publish",
        Condition: {
          ArnLike: {
            "aws:SourceArn": `arn:aws:cloudwatch:${region}:${options.expectedAccount}:alarm:${alarmName}`,
          },
          StringEquals: { "aws:SourceAccount": options.expectedAccount },
        },
        Effect: "Allow",
        Principal: { Service: "cloudwatch.amazonaws.com" },
        Resource: topicArn,
      },
    ],
  });
}

function expectedAlarmTopicAttributes(topicArn, region, alarmName) {
  return {
    Attributes: {
      Owner: options.expectedAccount,
      Policy: expectedAlarmTopicPolicy(topicArn, region, alarmName),
      TopicArn: topicArn,
    },
  };
}

function expectedEdgeAlarmTopicAttributes() {
  return {
    Attributes: {
      ...expectedAlarmTopicAttributes(
        edgeAlarmTopicArn,
        "us-east-1",
        edgeAlarmName,
      ).Attributes,
      KmsMasterKeyId: edgeAlarmKeyArn,
    },
  };
}

function expectedEdgeAlarmKeyDescription() {
  return {
    KeyMetadata: {
      AWSAccountId: options.expectedAccount,
      Arn: edgeAlarmKeyArn,
      Enabled: true,
      KeyManager: "CUSTOMER",
      KeySpec: "SYMMETRIC_DEFAULT",
      KeyState: "Enabled",
      KeyUsage: "ENCRYPT_DECRYPT",
    },
  };
}

function expectedEdgeAlarmKeyPolicy() {
  return {
    Policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Action: "kms:*",
          Effect: "Allow",
          Principal: { AWS: `arn:aws:iam::${options.expectedAccount}:root` },
          Resource: "*",
        },
        {
          Action: ["kms:GenerateDataKey*", "kms:Decrypt"],
          Condition: {
            ArnLike: {
              "aws:SourceArn": `arn:aws:cloudwatch:us-east-1:${options.expectedAccount}:alarm:${edgeAlarmName}`,
            },
            StringEquals: { "aws:SourceAccount": options.expectedAccount },
          },
          Effect: "Allow",
          Principal: { Service: "cloudwatch.amazonaws.com" },
          Resource: "*",
        },
      ],
    }),
  };
}

function expectedSubscriptionAttributes(topicArn) {
  return {
    Attributes: {
      Endpoint: alarmEmail,
      Owner: options.expectedAccount,
      Protocol: "email",
      RawMessageDelivery: "false",
      SubscriptionArn: `${topicArn}:subscription`,
      TopicArn: topicArn,
    },
  };
}

function expectedLogCleanupRole() {
  return {
    Role: {
      Arn: autoDeleteRoleArn,
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
      RoleName: autoDeleteRoleName,
    },
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

function expectedLogBucketPolicy() {
  const bucketArn = "arn:aws:s3:::upskill-edge-logs";
  return {
    Policy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Action: "s3:*",
          Condition: { Bool: { "aws:SecureTransport": "false" } },
          Effect: "Deny",
          Principal: { AWS: "*" },
          Resource: [bucketArn, `${bucketArn}/*`],
        },
        {
          Action: [
            "s3:DeleteObject*",
            "s3:GetBucket*",
            "s3:List*",
            "s3:PutBucketPolicy",
          ],
          Effect: "Allow",
          Principal: { AWS: autoDeleteRoleArn },
          Resource: [bucketArn, `${bucketArn}/*`],
        },
      ],
    }),
  };
}

function expectedLogBucketPolicyStatus() {
  return { PolicyStatus: { IsPublic: false } };
}

function expectedLogBucketLifecycle() {
  return {
    Rules: [
      {
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
        Expiration: { Days: 30 },
        ID: "generated-rule-id",
        Prefix: "",
        Status: "Enabled",
      },
    ],
  };
}

function expectedAlarmConfigurations() {
  const defaults = {
    ActionsEnabled: true,
    InsufficientDataActions: [],
    OKActions: [],
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

function expectedWafLogDeliveryPolicies() {
  return {
    resourcePolicies: [
      {
        policyDocument: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Sid: "AWSLogDeliveryWrite20150319",
              Effect: "Allow",
              Principal: { Service: ["delivery.logs.amazonaws.com"] },
              Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
              Resource: [`${wafLogGroupArn}:log-stream:*`],
              Condition: {
                StringEquals: {
                  "aws:SourceAccount": [options.expectedAccount],
                },
                ArnLike: {
                  "aws:SourceArn": [
                    `arn:aws:logs:us-east-1:${options.expectedAccount}:*`,
                  ],
                },
              },
            },
          ],
        }),
        policyName: "waf-log-delivery",
        policyScope: "RESOURCE",
        resourceArn: wafLogGroupArn,
      },
    ],
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
    expect(requireQualificationDistributionCap("25")).toBe(25);
    expect(() => requireQualificationDistributionCap("50")).toThrow(
      "must remain 25",
    );
    expect(() => requireQualificationDistributionCap("invalid")).toThrow(
      "is invalid",
    );
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
        {
          configuration: {
            CallerReference: "upskill:staging:offline-scorm:immutable",
          },
          inventoryComment: "all-markers-drifted",
          tags: [],
          webAclId: "",
        },
        { Comment: "unrelated" },
      ],
      "staging",
      webAclArn,
    );
    expect(inventory.owned).toHaveLength(5);
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
      { OKActions: [allocatorAlarmTopicArn] },
      { InsufficientDataActions: [allocatorAlarmTopicArn] },
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
      {
        Layers: [
          {
            Arn: "arn:aws:lambda:ap-southeast-2:123456789012:layer:unexpected:1",
          },
        ],
      },
      { Layers: {} },
      { CodeSha256: `${"b".repeat(43)}=` },
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

  it("requires the allocator version to have no resource-based invocation policy", () => {
    expect(hasNoAllocatorInvocationPolicy({ absent: true })).toBe(true);
    expect(
      hasNoAllocatorInvocationPolicy({
        absent: false,
        response: {
          Policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
              {
                Action: "lambda:InvokeFunction",
                Effect: "Allow",
                Principal: { AWS: "arn:aws:iam::210987654321:root" },
                Resource: allocatorQualifiedFunctionName,
              },
            ],
          }),
        },
      }),
    ).toBe(false);
    expect(hasNoAllocatorInvocationPolicy({})).toBe(false);
  });

  it("resolves exactly one deployment-owned staging cleanup role", () => {
    const resources = {
      StackResourceSummaries: [
        {
          LogicalResourceId:
            "CustomS3AutoDeleteObjectsCustomResourceProviderRole3B1BD092",
          PhysicalResourceId: autoDeleteRoleName,
          ResourceType: "AWS::IAM::Role",
        },
      ],
    };
    expect(
      deploymentOwnedAutoDeleteRoleArn(
        resources,
        options.expectedAccount,
        "aws",
      ),
    ).toBe(autoDeleteRoleArn);
    expect(
      deploymentOwnedAutoDeleteRoleArn(
        {
          StackResourceSummaries: [
            ...resources.StackResourceSummaries,
            {
              ...resources.StackResourceSummaries[0],
              PhysicalResourceId: "another-auto-delete-role",
            },
          ],
        },
        options.expectedAccount,
        "aws",
      ),
    ).toBeNull();
    expect(
      deploymentOwnedAutoDeleteRoleArn(
        {
          StackResourceSummaries: [
            {
              ...resources.StackResourceSummaries[0],
              LogicalResourceId: "UnrelatedRoleABC123",
            },
          ],
        },
        options.expectedAccount,
        "aws",
      ),
    ).toBeNull();
  });

  it("requires the log-cleanup role to retain its Lambda-only trust", () => {
    const role = expectedLogCleanupRole();
    expect(hasExpectedLogCleanupRoleBoundary(role, autoDeleteRoleArn)).toBe(
      true,
    );
    expect(
      hasExpectedLogCleanupRoleBoundary(
        {
          Role: {
            ...role.Role,
            AssumeRolePolicyDocument: {
              ...role.Role.AssumeRolePolicyDocument,
              Statement: [
                ...role.Role.AssumeRolePolicyDocument.Statement,
                {
                  Action: "sts:AssumeRole",
                  Effect: "Allow",
                  Principal: {
                    AWS: `arn:aws:iam::${options.expectedAccount}:root`,
                  },
                },
              ],
            },
          },
        },
        autoDeleteRoleArn,
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

  it("requires the worker role to grant only the pinned allocator version", () => {
    const responses = expectedWorkerRoleResponses();
    const evaluate = (policies = responses.policies) =>
      hasExpectedWorkerAllocatorPolicyBoundary(
        responses.role,
        responses.attached,
        responses.names,
        policies,
        workerRoleArn,
        allocatorQualifiedFunctionName,
      );
    expect(evaluate()).toBe(true);
    for (const Resource of [
      "*",
      allocatorQualifiedFunctionName.replace(":12", ""),
      allocatorQualifiedFunctionName.replace(":12", ":*"),
    ]) {
      expect(
        evaluate([
          {
            ...responses.policies[0],
            PolicyDocument: {
              ...responses.policies[0].PolicyDocument,
              Statement: [
                {
                  Action: "lambda:InvokeFunction",
                  Effect: "Allow",
                  Resource,
                },
              ],
            },
          },
        ]),
      ).toBe(false);
    }
    for (const Action of [
      "lambda:*",
      "lambda:Invoke*",
      "*",
      "cloudfront:UpdateDistribution",
      "cloudfront:*",
      "wafv2:UpdateWebACL",
      "waf*:GetWebACL",
    ]) {
      expect(
        evaluate([
          {
            ...responses.policies[0],
            PolicyDocument: {
              ...responses.policies[0].PolicyDocument,
              Statement: [
                {
                  Action,
                  Effect: "Allow",
                  Resource: allocatorQualifiedFunctionName,
                },
              ],
            },
          },
        ]),
      ).toBe(false);
    }
    expect(
      evaluate([
        {
          ...responses.policies[0],
          PolicyDocument: {
            ...responses.policies[0].PolicyDocument,
            Statement: [
              {
                Effect: "Allow",
                NotAction: "s3:*",
                Resource: "*",
              },
            ],
          },
        },
      ]),
    ).toBe(false);
    expect(
      hasExpectedWorkerAllocatorPolicyBoundary(
        responses.role,
        { AttachedPolicies: [] },
        responses.names,
        responses.policies,
        workerRoleArn,
        allocatorQualifiedFunctionName,
      ),
    ).toBe(false);
    expect(
      hasExpectedWorkerAllocatorPolicyBoundary(
        {
          Role: {
            ...responses.role.Role,
            AssumeRolePolicyDocument: {
              Version: "2012-10-17",
              Statement: [
                ...responses.role.Role.AssumeRolePolicyDocument.Statement,
                {
                  Action: "sts:AssumeRole",
                  Effect: "Allow",
                  Principal: { AWS: "arn:aws:iam::123456789012:root" },
                },
              ],
            },
          },
        },
        responses.attached,
        responses.names,
        responses.policies,
        workerRoleArn,
        allocatorQualifiedFunctionName,
      ),
    ).toBe(false);
  });

  it("requires a post-restart worker attestation for the configured target", () => {
    const configuredName =
      "/upskill/staging/offline-scorm/cloudfront-allocator-function-name";
    const runtimeName =
      "/upskill/staging/offline-scorm/cloudfront-worker-runtime-target";
    const configured = {
      Parameter: {
        Name: configuredName,
        Value: allocatorQualifiedFunctionName,
      },
    };
    const runtime = {
      Parameter: { Name: runtimeName, Value: allocatorQualifiedFunctionName },
    };
    expect(
      hasExpectedWorkerRuntimeTarget(
        configured,
        runtime,
        configuredName,
        runtimeName,
        allocatorQualifiedFunctionName,
      ),
    ).toBe(true);
    for (const Value of [
      `pending:${allocatorQualifiedFunctionName}`,
      allocatorQualifiedFunctionName.replace(":12", ":11"),
      allocatorQualifiedFunctionName.replace(":12", ""),
    ]) {
      expect(
        hasExpectedWorkerRuntimeTarget(
          configured,
          { Parameter: { ...runtime.Parameter, Value } },
          configuredName,
          runtimeName,
          allocatorQualifiedFunctionName,
        ),
      ).toBe(false);
    }
  });

  it("requires the origin-key secret to have no resource policy", () => {
    expect(
      hasNoOriginKeyResourcePolicy(
        { ARN: originKeySecretArn },
        originKeySecretArn,
      ),
    ).toBe(true);
    expect(
      hasNoOriginKeyResourcePolicy(
        {
          ARN: originKeySecretArn,
          ResourcePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
              {
                Action: "secretsmanager:GetSecretValue",
                Effect: "Allow",
                Principal: { AWS: "arn:aws:iam::123456789012:role/unapproved" },
                Resource: "*",
              },
            ],
          }),
        },
        originKeySecretArn,
      ),
    ).toBe(false);
    expect(
      hasNoOriginKeyResourcePolicy(
        { ARN: originKeySecretArn.replace("123456789012", "999999999999") },
        originKeySecretArn,
      ),
    ).toBe(false);
  });

  it("requires the live application instance to use the simulated worker role", () => {
    const instances = expectedWorkerInstances();
    const profile = expectedWorkerInstanceProfile();
    expect(
      hasExpectedWorkerInstanceProfile(
        instances,
        profile,
        applicationInstanceId,
        workerRoleArn,
      ),
    ).toBe(true);
    expect(
      hasExpectedWorkerInstanceProfile(
        {
          Reservations: [
            {
              Instances: [
                {
                  ...instances.Reservations[0].Instances[0],
                  State: { Name: "stopped" },
                },
              ],
            },
          ],
        },
        profile,
        applicationInstanceId,
        workerRoleArn,
      ),
    ).toBe(false);
    expect(
      hasExpectedWorkerInstanceProfile(
        instances,
        {
          InstanceProfile: {
            ...profile.InstanceProfile,
            Roles: [
              {
                Arn: `arn:aws:iam::${options.expectedAccount}:role/unrelated`,
              },
            ],
          },
        },
        applicationInstanceId,
        workerRoleArn,
      ),
    ).toBe(false);
    expect(
      hasExpectedWorkerInstanceProfile(
        instances,
        {
          InstanceProfile: {
            ...profile.InstanceProfile,
            Roles: [
              ...profile.InstanceProfile.Roles,
              { Arn: workerRoleArn, RoleName: workerRoleName },
            ],
          },
        },
        applicationInstanceId,
        workerRoleArn,
      ),
    ).toBe(false);
    expect(
      hasExpectedWorkerInstanceProfile(
        {
          Reservations: [
            {
              Instances: [
                {
                  IamInstanceProfile: {
                    Arn: workerInstanceProfileArn.replace(
                      workerInstanceProfileName,
                      "unrelated-profile",
                    ),
                  },
                  InstanceId: applicationInstanceId,
                },
              ],
            },
          ],
        },
        profile,
        applicationInstanceId,
        workerRoleArn,
      ),
    ).toBe(false);
  });

  it("requires the edge topic KMS key and CloudWatch publish grant", () => {
    const topic = expectedEdgeAlarmTopicAttributes();
    const description = expectedEdgeAlarmKeyDescription();
    const policy = expectedEdgeAlarmKeyPolicy();
    const expected = {
      accountId: options.expectedAccount,
      alarmName: edgeAlarmName,
      keyArn: edgeAlarmKeyArn,
      topicArn: edgeAlarmTopicArn,
    };
    expect(
      hasExpectedEdgeAlarmKmsBoundary(topic, description, policy, expected),
    ).toBe(true);
    expect(
      hasExpectedEdgeAlarmKmsBoundary(
        { Attributes: { KmsMasterKeyId: "alias/aws/sns" } },
        description,
        policy,
        expected,
      ),
    ).toBe(false);
    expect(
      hasExpectedEdgeAlarmKmsBoundary(
        topic,
        {
          KeyMetadata: {
            ...description.KeyMetadata,
            Enabled: false,
            KeyState: "Disabled",
          },
        },
        policy,
        expected,
      ),
    ).toBe(false);
    expect(
      hasExpectedEdgeAlarmKmsBoundary(
        topic,
        {
          KeyMetadata: {
            ...description.KeyMetadata,
            KeyState: "PendingDeletion",
          },
        },
        policy,
        expected,
      ),
    ).toBe(false);
    const policyDocument = JSON.parse(policy.Policy);
    expect(
      hasExpectedEdgeAlarmKmsBoundary(
        topic,
        description,
        {
          Policy: JSON.stringify({
            ...policyDocument,
            Statement: [
              ...policyDocument.Statement,
              {
                Action: ["kms:Decrypt", "kms:GenerateDataKey*"],
                Effect: "Deny",
                Principal: { Service: "cloudwatch.amazonaws.com" },
                Resource: "*",
              },
            ],
          }),
        },
        expected,
      ),
    ).toBe(false);
    expect(
      hasExpectedEdgeAlarmKmsBoundary(
        topic,
        description,
        {
          Policy: JSON.stringify({
            ...policyDocument,
            Statement: [
              ...policyDocument.Statement,
              {
                Action: "kms:Decrypt",
                Effect: "Allow",
                Principal: { AWS: "arn:aws:iam::210987654321:root" },
                Resource: "*",
              },
            ],
          }),
        },
        expected,
      ),
    ).toBe(false);
    expect(
      hasExpectedEdgeAlarmKmsBoundary(
        topic,
        description,
        {
          Policy: JSON.stringify({
            ...policyDocument,
            Statement: policyDocument.Statement.map((statement) =>
              statement.Principal?.Service === "cloudwatch.amazonaws.com"
                ? { ...statement, Action: ["kms:Decrypt"] }
                : statement,
            ),
          }),
        },
        expected,
      ),
    ).toBe(false);
    expect(
      hasExpectedEdgeAlarmKmsBoundary(
        topic,
        description,
        {
          Policy: JSON.stringify({
            ...policyDocument,
            Statement: policyDocument.Statement.map((statement) =>
              statement.Principal?.Service === "cloudwatch.amazonaws.com"
                ? {
                    ...statement,
                    Condition: {
                      ...statement.Condition,
                      ArnLike: {
                        "aws:SourceArn":
                          "arn:aws:cloudwatch:us-east-1:123456789012:alarm:unrelated",
                      },
                    },
                  }
                : statement,
            ),
          }),
        },
        expected,
      ),
    ).toBe(false);
  });

  it("requires alarm topic policies to preserve their CloudWatch publication boundaries", () => {
    const edgeAttributes = expectedEdgeAlarmTopicAttributes();
    const edgeExpected = {
      accountId: options.expectedAccount,
      alarmName: edgeAlarmName,
      kmsMasterKeyId: edgeAlarmKeyArn,
      region: "us-east-1",
      topicArn: edgeAlarmTopicArn,
    };
    expect(hasExpectedAlarmTopicPolicy(edgeAttributes, edgeExpected)).toBe(
      true,
    );
    expect(
      hasExpectedAlarmTopicPolicy(
        expectedAlarmTopicAttributes(
          allocatorAlarmTopicArn,
          options.applicationRegion,
          "*",
        ),
        {
          accountId: options.expectedAccount,
          alarmName: "*",
          kmsMasterKeyId: undefined,
          region: options.applicationRegion,
          topicArn: allocatorAlarmTopicArn,
        },
      ),
    ).toBe(true);
    expect(
      hasExpectedAlarmTopicPolicy(
        {
          Attributes: {
            ...expectedAlarmTopicAttributes(
              allocatorAlarmTopicArn,
              options.applicationRegion,
              "*",
            ).Attributes,
            KmsMasterKeyId: "alias/aws/sns",
          },
        },
        {
          accountId: options.expectedAccount,
          alarmName: "*",
          kmsMasterKeyId: undefined,
          region: options.applicationRegion,
          topicArn: allocatorAlarmTopicArn,
        },
      ),
    ).toBe(false);

    const policy = JSON.parse(edgeAttributes.Attributes.Policy);
    expect(
      hasExpectedAlarmTopicPolicy(
        {
          Attributes: {
            ...edgeAttributes.Attributes,
            Policy: JSON.stringify({
              ...policy,
              Statement: [
                ...policy.Statement,
                {
                  Action: "SNS:Publish",
                  Effect: "Deny",
                  Principal: { Service: "cloudwatch.amazonaws.com" },
                  Resource: edgeAlarmTopicArn,
                },
              ],
            }),
          },
        },
        edgeExpected,
      ),
    ).toBe(false);
    expect(
      hasExpectedAlarmTopicPolicy(
        {
          Attributes: {
            ...edgeAttributes.Attributes,
            Policy: JSON.stringify({
              ...policy,
              Statement: [
                ...policy.Statement,
                {
                  Action: "SNS:Publish",
                  Effect: "Allow",
                  Principal: { AWS: "*" },
                  Resource: edgeAlarmTopicArn,
                },
              ],
            }),
          },
        },
        edgeExpected,
      ),
    ).toBe(false);
    expect(
      hasExpectedAlarmTopicPolicy(
        {
          Attributes: {
            ...edgeAttributes.Attributes,
            Policy: JSON.stringify({
              ...policy,
              Statement: policy.Statement.map((statement) => ({
                ...statement,
                Condition: {
                  ...statement.Condition,
                  ArnLike: {
                    "aws:SourceArn":
                      "arn:aws:cloudwatch:us-east-1:123456789012:alarm:unrelated",
                  },
                },
              })),
            }),
          },
        },
        edgeExpected,
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

  it("requires the exact access-log bucket policy boundary", () => {
    const bucketArn = "arn:aws:s3:::upskill-edge-logs";
    const response = expectedLogBucketPolicy();
    expect(
      hasExpectedLogBucketPolicy(response, bucketArn, autoDeleteRoleArn),
    ).toBe(true);
    const policy = JSON.parse(response.Policy);
    expect(
      hasExpectedLogBucketPolicy(
        {
          Policy: JSON.stringify({
            ...policy,
            Statement: policy.Statement.filter(
              (statement) => statement.Effect !== "Deny",
            ),
          }),
        },
        bucketArn,
        autoDeleteRoleArn,
      ),
    ).toBe(false);
    expect(
      hasExpectedLogBucketPolicy(
        {
          Policy: JSON.stringify({
            ...policy,
            Statement: [
              ...policy.Statement,
              {
                Action: "s3:PutObject",
                Effect: "Deny",
                Principal: { AWS: "*" },
                Resource: `${bucketArn}/*`,
              },
            ],
          }),
        },
        bucketArn,
        autoDeleteRoleArn,
      ),
    ).toBe(false);
    expect(
      hasExpectedLogBucketPolicy(
        {
          Policy: JSON.stringify({
            ...policy,
            Statement: policy.Statement.map((statement) =>
              statement.Effect === "Deny"
                ? {
                    ...statement,
                    Condition: { Bool: { "aws:SecureTransport": "true" } },
                  }
                : statement,
            ),
          }),
        },
        bucketArn,
        autoDeleteRoleArn,
      ),
    ).toBe(false);
    expect(
      hasExpectedLogBucketPolicy(
        {
          Policy: JSON.stringify({
            ...policy,
            Statement: [
              ...policy.Statement,
              {
                Action: "s3:GetObject",
                Effect: "Allow",
                Principal: { AWS: "arn:aws:iam::210987654321:root" },
                Resource: `${bucketArn}/*`,
              },
            ],
          }),
        },
        bucketArn,
        autoDeleteRoleArn,
      ),
    ).toBe(false);
    expect(hasExpectedLogBucketPolicy(response, bucketArn, workerRoleArn)).toBe(
      false,
    );
  });

  it("requires the complete access-log retention lifecycle", () => {
    const lifecycle = expectedLogBucketLifecycle();
    expect(hasExpectedLogBucketLifecycle(lifecycle)).toBe(true);
    expect(
      hasExpectedLogBucketLifecycle({
        Rules: [
          {
            ...lifecycle.Rules[0],
            Expiration: { Days: 1 },
          },
        ],
      }),
    ).toBe(false);
    expect(
      hasExpectedLogBucketLifecycle({
        Rules: [{ ...lifecycle.Rules[0], Status: "Disabled" }],
      }),
    ).toBe(false);
    expect(
      hasExpectedLogBucketLifecycle({
        Rules: [
          {
            ...lifecycle.Rules[0],
            Transitions: [{ Days: 1, StorageClass: "GLACIER" }],
          },
        ],
      }),
    ).toBe(false);
    expect(
      hasExpectedLogBucketLifecycle({
        Rules: [...lifecycle.Rules, lifecycle.Rules[0]],
      }),
    ).toBe(false);
  });

  it("requires exactly one unfiltered confirmed operations subscription", () => {
    const expectedEndpoint = "ops@codestudio.au";
    const subscription = {
      Endpoint: expectedEndpoint,
      Protocol: "email",
      SubscriptionArn: `${edgeAlarmTopicArn}:subscription`,
    };
    const subscriptions = { Subscriptions: [subscription] };
    const attributes = expectedSubscriptionAttributes(edgeAlarmTopicArn);
    expect(
      hasConfirmedEmailSubscription(
        subscriptions,
        edgeAlarmTopicArn,
        expectedEndpoint,
      ),
    ).toBe(true);
    expect(
      hasExpectedAlarmSubscription(
        subscriptions,
        attributes,
        edgeAlarmTopicArn,
        expectedEndpoint,
        options.expectedAccount,
      ),
    ).toBe(true);
    for (const filteredAttributes of [
      { ...attributes.Attributes, FilterPolicy: "{}" },
      { ...attributes.Attributes, FilterPolicyScope: "MessageBody" },
      {
        ...attributes.Attributes,
        RedrivePolicy: JSON.stringify({
          deadLetterTargetArn: `arn:aws:sqs:us-east-1:${options.expectedAccount}:undeclared`,
        }),
      },
    ]) {
      expect(
        hasExpectedAlarmSubscription(
          subscriptions,
          { Attributes: filteredAttributes },
          edgeAlarmTopicArn,
          expectedEndpoint,
          options.expectedAccount,
        ),
      ).toBe(false);
    }
    expect(
      hasExpectedAlarmSubscription(
        subscriptions,
        {
          Attributes: {
            ...attributes.Attributes,
            SubscriptionArn: `${edgeAlarmTopicArn}:unrelated`,
          },
        },
        edgeAlarmTopicArn,
        expectedEndpoint,
        options.expectedAccount,
      ),
    ).toBe(false);
    expect(
      hasConfirmedEmailSubscription(
        { Subscriptions: [subscription, { ...subscription }] },
        edgeAlarmTopicArn,
        expectedEndpoint,
      ),
    ).toBe(false);
    const unrelatedConfirmed = {
      Endpoint: "https://attacker.example/alarm",
      Protocol: "https",
      SubscriptionArn: `${edgeAlarmTopicArn}:unrelated-confirmed`,
    };
    expect(
      hasConfirmedEmailSubscription(
        { Subscriptions: [subscription, unrelatedConfirmed] },
        edgeAlarmTopicArn,
        expectedEndpoint,
      ),
    ).toBe(false);
    expect(
      hasExpectedAlarmSubscription(
        { Subscriptions: [subscription, unrelatedConfirmed] },
        attributes,
        edgeAlarmTopicArn,
        expectedEndpoint,
        options.expectedAccount,
      ),
    ).toBe(false);
    expect(
      hasExpectedAlarmSubscription(
        {
          Subscriptions: [
            subscription,
            {
              Endpoint: "pending@example.com",
              Protocol: "email",
              SubscriptionArn: "PendingConfirmation",
            },
          ],
        },
        attributes,
        edgeAlarmTopicArn,
        expectedEndpoint,
        options.expectedAccount,
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
    const logPolicies = expectedWafLogDeliveryPolicies();
    expect(
      hasExpectedWafLogDeliveryPolicy(
        { resourcePolicies: [] },
        logPolicies,
        wafLogGroupArn,
        options.expectedAccount,
      ),
    ).toBe(true);
    expect(
      hasExpectedWafLogDeliveryPolicy(
        {
          resourcePolicies: logPolicies.resourcePolicies.map((policy) => ({
            policyDocument: policy.policyDocument,
            policyName: policy.policyName,
            policyScope: "ACCOUNT",
          })),
        },
        { resourcePolicies: [] },
        wafLogGroupArn,
        options.expectedAccount,
      ),
    ).toBe(true);
    expect(
      hasExpectedWafLogDeliveryPolicy(
        { resourcePolicies: [] },
        {
          resourcePolicies: logPolicies.resourcePolicies.map((policy) => ({
            ...policy,
            policyDocument: JSON.stringify({
              ...JSON.parse(policy.policyDocument),
              Statement: JSON.parse(policy.policyDocument).Statement.map(
                (statement) => ({
                  ...statement,
                  Action: ["logs:CreateLogStream"],
                }),
              ),
            }),
          })),
        },
        wafLogGroupArn,
        options.expectedAccount,
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
                OutputKey: "OfflineScormCloudFrontAllocatorCodeSha256",
                OutputValue: allocatorCodeSha256,
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
                OutputKey: "ApplicationInstanceId",
                OutputValue: applicationInstanceId,
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
                OutputKey: "OfflineScormEdgeAlarmKeyArn",
                OutputValue: edgeAlarmKeyArn,
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
      if (command === "cloudformation list-stack-resources")
        return {
          StackResourceSummaries: [
            {
              LogicalResourceId:
                "CustomS3AutoDeleteObjectsCustomResourceProviderRole3B1BD092",
              PhysicalResourceId: autoDeleteRoleName,
              ResourceType: "AWS::IAM::Role",
            },
          ],
        };
      if (command === "ssm get-parameter") {
        const parameterName = args[args.indexOf("--name") + 1];
        return {
          Parameter: {
            Name: parameterName,
            Value:
              parameterName.endsWith("allocator-function-name") ||
              parameterName.endsWith("worker-runtime-target")
                ? allocatorQualifiedFunctionName
                : options.expectedOriginDomain,
          },
        };
      }
      if (command === "secretsmanager get-secret-value")
        return { SecretString: originKey };
      if (command === "secretsmanager get-resource-policy")
        return { ARN: originKeySecretArn };
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
            Quantity: 1,
          },
        };
      if (command === "cloudfront get-distribution-config") {
        const distributionIdArgument = args[args.indexOf("--id") + 1];
        return {
          DistributionConfig:
            distributionIdArgument === distributionId
              ? expectedDistributionConfiguration()
              : {
                  CallerReference: "unrelated",
                  Comment: "unrelated",
                  WebACLId: "",
                },
        };
      }
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
      if (command === "logs describe-resource-policies")
        return args.includes("RESOURCE")
          ? expectedWafLogDeliveryPolicies()
          : { resourcePolicies: [] };
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
      if (command === "sns get-subscription-attributes") {
        const subscriptionArn = args[args.indexOf("--subscription-arn") + 1];
        const topicArn = subscriptionArn.slice(
          0,
          subscriptionArn.lastIndexOf(":"),
        );
        return expectedSubscriptionAttributes(topicArn);
      }
      if (command === "sns get-topic-attributes") {
        const topicArn = args[args.indexOf("--topic-arn") + 1];
        return topicArn === edgeAlarmTopicArn
          ? expectedEdgeAlarmTopicAttributes()
          : expectedAlarmTopicAttributes(
              allocatorAlarmTopicArn,
              options.applicationRegion,
              "*",
            );
      }
      if (command === "kms describe-key")
        return expectedEdgeAlarmKeyDescription();
      if (command === "kms get-key-policy") return expectedEdgeAlarmKeyPolicy();
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
                InsufficientDataActions: [],
                OKActions: [],
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
      if (command === "lambda get-policy")
        throw new AwsCliError(
          "No resource-based policy is attached",
          "ResourceNotFoundException",
        );
      if (command === "lambda get-function-concurrency")
        return { ReservedConcurrentExecutions: 1 };
      if (command === "iam get-role")
        return args.includes(workerRoleName)
          ? expectedWorkerRoleResponses().role
          : args.includes(autoDeleteRoleName)
            ? expectedLogCleanupRole()
            : expectedAllocatorRoleResponses().role;
      if (command === "iam list-attached-role-policies")
        return args.includes(workerRoleName)
          ? expectedWorkerRoleResponses().attached
          : expectedAllocatorRoleResponses().attached;
      if (command === "iam list-role-policies")
        return args.includes(workerRoleName)
          ? expectedWorkerRoleResponses().names
          : expectedAllocatorRoleResponses().names;
      if (command === "iam simulate-principal-policy")
        return expectedWorkerInvocationSimulation();
      if (command === "iam get-role-policy")
        return args.includes(workerRoleName)
          ? expectedWorkerRoleResponses().policies[0]
          : expectedAllocatorRoleResponses().policies[0];
      if (command === "iam get-instance-profile")
        return expectedWorkerInstanceProfile();
      if (command === "ec2 describe-instances")
        return expectedWorkerInstances();
      if (command === "s3api get-bucket-acl") return expectedLogBucketAcl();
      if (command === "s3api get-public-access-block")
        return expectedLogBucketPublicAccessBlock();
      if (command === "s3api get-bucket-policy-status")
        return expectedLogBucketPolicyStatus();
      if (command === "s3api get-bucket-policy")
        return expectedLogBucketPolicy();
      if (command === "s3api get-bucket-lifecycle-configuration")
        return expectedLogBucketLifecycle();
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
      availableCapacity: 498,
      quotaSource: "aws-default",
      requiredAdditionalCapacity: 24,
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
      report.checks.find((check) => check.id === "origin-key-resource-policy"),
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
      report.checks.find((check) => check.id === "access-log-bucket-policy"),
    ).toMatchObject({ status: "pass" });
    expect(
      report.checks.find((check) => check.id === "worker-allocator-permission"),
    ).toMatchObject({ status: "pass" });
    expect(
      report.checks.find(
        (check) => check.id === "worker-allocator-policy-boundary",
      ),
    ).toMatchObject({ status: "pass" });
    expect(
      report.checks.find((check) => check.id === "allocator-invocation-policy"),
    ).toMatchObject({ status: "pass" });
    expect(
      report.checks.find((check) => check.id === "worker-instance-profile"),
    ).toMatchObject({ status: "pass" });
    expect(
      report.checks.find((check) => check.id === "edge-alert-kms"),
    ).toMatchObject({ status: "pass" });
    expect(
      report.checks.find((check) => check.id === "edge-alert-topic-policy"),
    ).toMatchObject({ status: "pass" });
    expect(
      report.checks.find(
        (check) => check.id === "allocator-alert-topic-policy",
      ),
    ).toMatchObject({ status: "pass" });
    expect(
      report.checks.find((check) => check.id === "access-log-bucket-lifecycle"),
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
      [
        "cloudfront",
        "get-distribution-config",
        "--id",
        unrelatedDistributionId,
      ],
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
      calls.find(
        (args) =>
          args.slice(0, 2).join(" ") === "cloudformation list-stack-resources",
      ),
    ).toEqual([
      "cloudformation",
      "list-stack-resources",
      "--stack-name",
      "upskill-staging-storage",
      "--region",
      options.applicationRegion,
    ]);
    expect(
      calls
        .filter((args) => args[0] === "lambda")
        .map((args) => args.slice(0, 2)),
    ).toEqual([
      ["lambda", "get-function-configuration"],
      ["lambda", "get-policy"],
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
      calls.find((args) => args.slice(0, 2).join(" ") === "lambda get-policy"),
    ).toEqual([
      "lambda",
      "get-policy",
      "--function-name",
      allocatorFunctionName,
      "--qualifier",
      "12",
      "--region",
      options.applicationRegion,
    ]);
    expect(
      calls.filter((args) => args[0] === "iam").map((args) => args[1]),
    ).toEqual([
      "get-role",
      "list-attached-role-policies",
      "list-role-policies",
      "get-role",
      "list-attached-role-policies",
      "list-role-policies",
      "simulate-principal-policy",
      "get-role",
      "get-role-policy",
      "get-role-policy",
      "get-instance-profile",
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
      "get-bucket-policy",
      "get-bucket-lifecycle-configuration",
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
      calls.find(
        (args) => args.slice(0, 2).join(" ") === "ec2 describe-instances",
      ),
    ).toEqual([
      "ec2",
      "describe-instances",
      "--instance-ids",
      applicationInstanceId,
      "--region",
      options.applicationRegion,
    ]);
    expect(
      calls.find(
        (args) => args.slice(0, 2).join(" ") === "iam get-instance-profile",
      ),
    ).toEqual([
      "iam",
      "get-instance-profile",
      "--instance-profile-name",
      workerInstanceProfileName,
      "--region",
      options.applicationRegion,
    ]);
    expect(
      calls.filter(
        (args) => args.slice(0, 2).join(" ") === "sns get-topic-attributes",
      ),
    ).toEqual([
      [
        "sns",
        "get-topic-attributes",
        "--topic-arn",
        edgeAlarmTopicArn,
        "--region",
        "us-east-1",
      ],
      [
        "sns",
        "get-topic-attributes",
        "--topic-arn",
        allocatorAlarmTopicArn,
        "--region",
        options.applicationRegion,
      ],
    ]);
    expect(
      calls.filter(
        (args) =>
          args.slice(0, 2).join(" ") === "sns get-subscription-attributes",
      ),
    ).toEqual([
      [
        "sns",
        "get-subscription-attributes",
        "--subscription-arn",
        `${edgeAlarmTopicArn}:subscription`,
        "--region",
        "us-east-1",
      ],
      [
        "sns",
        "get-subscription-attributes",
        "--subscription-arn",
        `${allocatorAlarmTopicArn}:subscription`,
        "--region",
        options.applicationRegion,
      ],
    ]);
    expect(
      calls.find((args) => args.slice(0, 2).join(" ") === "kms describe-key"),
    ).toEqual([
      "kms",
      "describe-key",
      "--key-id",
      edgeAlarmKeyArn,
      "--region",
      "us-east-1",
    ]);
    expect(
      calls.find((args) => args.slice(0, 2).join(" ") === "kms get-key-policy"),
    ).toEqual([
      "kms",
      "get-key-policy",
      "--key-id",
      edgeAlarmKeyArn,
      "--policy-name",
      "default",
      "--region",
      "us-east-1",
    ]);
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
    expect(
      calls.filter(
        (args) =>
          args.slice(0, 2).join(" ") === "secretsmanager get-resource-policy",
      ),
    ).toEqual([
      [
        "secretsmanager",
        "get-resource-policy",
        "--secret-id",
        originKeySecretArn,
        "--region",
        options.applicationRegion,
      ],
    ]);
  });
});
