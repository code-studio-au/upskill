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
});
