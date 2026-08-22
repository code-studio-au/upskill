import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { test } from "vitest";
import { environmentConfig } from "../lib/config.js";
import { NetworkStack } from "../lib/network-stack.js";
import { StorageStack } from "../lib/storage-stack.js";

test("staging network has isolated data subnets", () => {
  const stack = new NetworkStack(
    new App(),
    "Network",
    environmentConfig("staging"),
  );
  Template.fromStack(stack).resourceCountIs("AWS::EC2::Subnet", 6);
});

test("storage blocks public access and provides a dead-letter queue", () => {
  const stack = new StorageStack(
    new App(),
    "Storage",
    environmentConfig("staging"),
  );
  const template = Template.fromStack(stack);
  template.hasResourceProperties("AWS::S3::Bucket", {
    PublicAccessBlockConfiguration: Match.objectEquals({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    }),
  });
  template.resourceCountIs("AWS::SQS::Queue", 2);
  template.hasResourceProperties("AWS::SQS::Queue", {
    VisibilityTimeout: 900,
    RedrivePolicy: {
      deadLetterTargetArn: Match.anyValue(),
      maxReceiveCount: 5,
    },
  });
  template.resourceCountIs("AWS::CloudWatch::Alarm", 0);
});

test("production storage alarms on durable work backlog and dead letters", () => {
  const stack = new StorageStack(
    new App(),
    "ProductionStorage",
    environmentConfig("production"),
  );
  const template = Template.fromStack(stack);
  template.resourceCountIs("AWS::CloudWatch::Alarm", 3);
  template.hasResourceProperties("AWS::CloudWatch::Alarm", {
    AlarmName: "upskill-production-work-queue-oldest-message",
    Threshold: 900,
    EvaluationPeriods: 2,
  });
  template.hasResourceProperties("AWS::CloudWatch::Alarm", {
    AlarmName: "upskill-production-work-queue-backlog",
    Threshold: 100,
    EvaluationPeriods: 2,
  });
  template.hasResourceProperties("AWS::CloudWatch::Alarm", {
    AlarmName: "upskill-production-work-dead-letter-queue",
    Threshold: 1,
    EvaluationPeriods: 1,
  });
});
