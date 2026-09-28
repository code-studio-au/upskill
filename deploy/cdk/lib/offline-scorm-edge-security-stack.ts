import {
  ArnFormat,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import {
  Alarm,
  ComparisonOperator,
  Metric,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Key } from "aws-cdk-lib/aws-kms";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { CfnLoggingConfiguration, CfnWebACL } from "aws-cdk-lib/aws-wafv2";
import type { Construct } from "constructs";
import type { EnvironmentConfig } from "./config.js";

export function offlineScormCloudFrontWebAclName(
  environment: EnvironmentConfig["name"],
): string {
  return `upskill-${environment}-offline-scorm-cloudfront`;
}

export interface OfflineScormEdgeSecurityStackProps extends StackProps {
  config: EnvironmentConfig;
}

export class OfflineScormEdgeSecurityStack extends Stack {
  readonly webAclName: string;

  constructor(
    scope: Construct,
    id: string,
    props: OfflineScormEdgeSecurityStackProps,
  ) {
    super(scope, id, props);
    if (!props.config.offlineScormCloudFrontQualification)
      throw new Error(
        "Offline SCORM edge security requires the qualification boundary",
      );

    this.webAclName = offlineScormCloudFrontWebAclName(props.config.name);
    const metricPrefix = `upskill-${props.config.name}-offline-scorm`;
    const commonVisibility = (metricName: string) => ({
      cloudWatchMetricsEnabled: true,
      metricName,
      sampledRequestsEnabled: true,
    });
    const webAcl = new CfnWebACL(this, "OfflineScormCloudFrontWebAcl", {
      name: this.webAclName,
      description:
        "Shared protection for dormant exact-entitlement Offline SCORM CloudFront qualification sites",
      scope: "CLOUDFRONT",
      defaultAction: { allow: {} },
      tags: [
        { key: "Application", value: "upskill" },
        { key: "Environment", value: props.config.name },
        { key: "Purpose", value: "offline-scorm-qualification" },
      ],
      visibilityConfig: commonVisibility(`${metricPrefix}-all`),
      rules: [
        {
          name: "aws-managed-ip-reputation",
          priority: 0,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              name: "AWSManagedRulesAmazonIpReputationList",
              vendorName: "AWS",
            },
          },
          visibilityConfig: commonVisibility(`${metricPrefix}-ip-reputation`),
        },
        {
          name: "aws-managed-common-protections-qualification",
          priority: 1,
          overrideAction: { count: {} },
          statement: {
            managedRuleGroupStatement: {
              name: "AWSManagedRulesCommonRuleSet",
              vendorName: "AWS",
            },
          },
          visibilityConfig: commonVisibility(`${metricPrefix}-common-count`),
        },
        {
          name: "per-ip-request-rate",
          priority: 2,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              aggregateKeyType: "IP",
              evaluationWindowSec: 300,
              limit: 2_000,
            },
          },
          visibilityConfig: commonVisibility(`${metricPrefix}-rate-limit`),
        },
      ],
    });

    const wafLogGroup = new LogGroup(this, "OfflineScormWafLogGroup", {
      logGroupName: `aws-waf-logs-${this.webAclName}`,
      retention:
        props.config.name === "production"
          ? RetentionDays.THREE_MONTHS
          : RetentionDays.ONE_MONTH,
      removalPolicy:
        props.config.name === "production"
          ? RemovalPolicy.RETAIN
          : RemovalPolicy.DESTROY,
    });
    const logging = new CfnLoggingConfiguration(
      this,
      "OfflineScormWafLogging",
      {
        resourceArn: webAcl.attrArn,
        logDestinationConfigs: [wafLogGroup.logGroupArn],
        redactedFields: [
          { singleHeader: { Name: "authorization" } },
          { singleHeader: { Name: "cookie" } },
          { queryString: {} },
        ],
        loggingFilter: {
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
      },
    );
    logging.addResourceDependency(webAcl);

    const blockedRequestAlarmName = `upskill-${props.config.name}-offline-scorm-waf-blocked-requests`;
    const alarmKey = new Key(this, "OfflineScormEdgeAlarmKey", {
      description: `Encrypts Upskill ${props.config.name} Offline SCORM edge alarm notifications`,
      enableKeyRotation: true,
      removalPolicy:
        props.config.name === "production"
          ? RemovalPolicy.RETAIN
          : RemovalPolicy.DESTROY,
    });
    alarmKey.addToResourcePolicy(
      new PolicyStatement({
        principals: [new ServicePrincipal("cloudwatch.amazonaws.com")],
        actions: ["kms:GenerateDataKey*", "kms:Decrypt"],
        resources: ["*"],
        conditions: {
          StringEquals: { "aws:SourceAccount": this.account },
          ArnLike: {
            "aws:SourceArn": this.formatArn({
              service: "cloudwatch",
              resource: "alarm",
              resourceName: blockedRequestAlarmName,
              arnFormat: ArnFormat.COLON_RESOURCE_NAME,
            }),
          },
        },
      }),
    );
    const alarmTopic = new Topic(this, "OfflineScormEdgeAlarmTopic", {
      displayName: `Upskill ${props.config.name} Offline SCORM edge alarms`,
      masterKey: alarmKey,
    });
    alarmTopic.addSubscription(new EmailSubscription(props.config.alarmEmail));
    const blockedRequestAlarm = new Alarm(
      this,
      "OfflineScormWafBlockedRequestAlarm",
      {
        alarmName: blockedRequestAlarmName,
        alarmDescription:
          "Offline SCORM qualification traffic has sustained at least 100 WAF-blocked requests in five minutes.",
        metric: new Metric({
          namespace: "AWS/WAFV2",
          metricName: "BlockedRequests",
          dimensionsMap: {
            Region: "Global",
            Rule: "ALL",
            WebACL: this.webAclName,
          },
          period: Duration.minutes(5),
          statistic: "Sum",
        }),
        threshold: 100,
        evaluationPeriods: 1,
        comparisonOperator:
          ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      },
    );
    blockedRequestAlarm.addAlarmAction(new SnsAction(alarmTopic));

    new CfnOutput(this, "OfflineScormCloudFrontWebAclArn", {
      value: webAcl.attrArn,
      description:
        "CloudFront-scope WAF authority required by every Offline SCORM qualification distribution",
    });
    new CfnOutput(this, "OfflineScormCloudFrontWebAclName", {
      value: this.webAclName,
    });
    new CfnOutput(this, "OfflineScormWafLogGroupName", {
      value: wafLogGroup.logGroupName,
    });
    new CfnOutput(this, "OfflineScormEdgeAlarmTopicArn", {
      value: alarmTopic.topicArn,
      description:
        "Encrypted notification topic whose email subscription must be confirmed before qualification",
    });
    new CfnOutput(this, "OfflineScormEdgeAlarmEmail", {
      value: props.config.alarmEmail,
      description:
        "Expected confirmed email endpoint for Offline SCORM edge alarms",
    });
  }
}
