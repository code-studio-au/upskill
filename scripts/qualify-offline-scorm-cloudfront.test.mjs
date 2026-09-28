import { describe, expect, it } from "vitest";
import {
  AwsCliError,
  classifyQualificationDistributions,
  collectCloudFrontQualificationReport,
  evaluateQuotaHeadroom,
  haveExpectedAlarmActions,
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
const wafLogGroupName = "aws-waf-logs-upskill-staging-offline-scorm-cloudfront";

function expectedWebAcl() {
  return {
    ARN: webAclArn,
    DefaultAction: { Allow: {} },
    Rules: [
      {
        Name: "aws-managed-ip-reputation",
        Priority: 0,
        OverrideAction: { None: {} },
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
        { Comment: "unrelated" },
      ],
      "staging",
    );
    expect(inventory.owned).toHaveLength(2);
    expect(inventory.duplicateMarkers).toEqual([
      "upskill:staging:offline-scorm:one",
    ]);
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

  it("requires every alarm action to be enabled and target the expected topic", () => {
    const expectedActions = [
      { alarmName: "edge", actionArn: edgeAlarmTopicArn },
      { alarmName: "allocator", actionArn: allocatorAlarmTopicArn },
    ];
    const alarms = [
      {
        AlarmName: "edge",
        ActionsEnabled: true,
        AlarmActions: [edgeAlarmTopicArn],
      },
      {
        AlarmName: "allocator",
        ActionsEnabled: true,
        AlarmActions: [allocatorAlarmTopicArn],
      },
    ];
    expect(haveExpectedAlarmActions(alarms, expectedActions)).toBe(true);
    expect(
      haveExpectedAlarmActions(
        alarms.map((alarm) =>
          alarm.AlarmName === "edge"
            ? { ...alarm, ActionsEnabled: false }
            : alarm,
        ),
        expectedActions,
      ),
    ).toBe(false);
    expect(
      haveExpectedAlarmActions(
        alarms.map((alarm) =>
          alarm.AlarmName === "allocator"
            ? { ...alarm, AlarmActions: [edgeAlarmTopicArn] }
            : alarm,
        ),
        expectedActions,
      ),
    ).toBe(false);
  });

  it("requires every owned distribution to target only the direct package origin", () => {
    const distribution = {
      DefaultCacheBehavior: {
        TargetOriginId: "upskill-offline-package-host",
      },
      Origins: {
        Quantity: 1,
        Items: [
          {
            DomainName: options.expectedOriginDomain,
            Id: "upskill-offline-package-host",
          },
        ],
      },
    };
    expect(
      haveExpectedDistributionOrigins(
        [distribution],
        options.expectedOriginDomain,
      ),
    ).toBe(true);
    expect(
      haveExpectedDistributionOrigins(
        [
          {
            ...distribution,
            Origins: {
              Quantity: 1,
              Items: [
                {
                  DomainName: "attacker.example",
                  Id: "upskill-offline-package-host",
                },
              ],
            },
          },
        ],
        options.expectedOriginDomain,
      ),
    ).toBe(false);
  });

  it("requires the complete deployed WAF security baseline", () => {
    const webAcl = expectedWebAcl();
    expect(hasExpectedWebAclBaseline(webAcl)).toBe(true);
    expect(
      hasExpectedWebAclBaseline({
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
      }),
    ).toBe(false);
    expect(
      hasExpectedWebAclBaseline({
        ...webAcl,
        Rules: webAcl.Rules.filter(
          (rule) => rule.Name !== "aws-managed-ip-reputation",
        ),
      }),
    ).toBe(false);
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
                OutputValue: "allocator",
              },
              {
                OutputKey: "OfflineScormCloudFrontAllocatorAlarmTopicArn",
                OutputValue: allocatorAlarmTopicArn,
              },
              {
                OutputKey: "OfflineScormEdgeLogBucketArn",
                OutputValue: "arn:aws:s3:::upskill-edge-logs",
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
            ];
        return {
          Stacks: [{ Outputs: outputs, StackStatus: "UPDATE_COMPLETE" }],
        };
      }
      if (command === "ssm get-parameter")
        return { Parameter: { Value: options.expectedOriginDomain } };
      if (command === "cloudfront list-distributions")
        return { DistributionList: { Items: [], Quantity: 0 } };
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
            .map((AlarmName) => ({
              ActionsEnabled: true,
              AlarmActions: [actionArn],
              AlarmName,
            })),
        };
      }
      if (command === "cloudtrail lookup-events") return { Events: [] };
      if (command === "s3api list-objects-v2") return { Contents: [] };
      throw new Error(`Unexpected AWS command ${command}`);
    };
    const report = await collectCloudFrontQualificationReport(options, {
      now: () => new Date("2026-09-28T00:00:00Z"),
      runAws: runner,
    });
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
    const alarmRegions = calls
      .filter(
        (args) => args.slice(0, 2).join(" ") === "cloudwatch describe-alarms",
      )
      .map((args) => args[args.indexOf("--region") + 1]);
    expect(alarmRegions).toEqual(["us-east-1", options.applicationRegion]);
  });
});
