import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { expect, test } from "vitest";
import { environmentConfig } from "../lib/config.js";
import { NetworkStack } from "../lib/network-stack.js";
import { StorageStack } from "../lib/storage-stack.js";
import { DataStack } from "../lib/data-stack.js";
import { ApplicationStack } from "../lib/application-stack.js";
import { DeploymentIdentityStack } from "../lib/deployment-identity-stack.js";
import { GitHubIdentityProviderStack } from "../lib/github-identity-provider-stack.js";

test("staging network has isolated data subnets", () => {
  const stack = new NetworkStack(
    new App(),
    "Network",
    environmentConfig("staging"),
  );
  const template = Template.fromStack(stack);
  template.resourceCountIs("AWS::EC2::Subnet", 4);
  template.resourceCountIs("AWS::EC2::NatGateway", 0);
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
  template.resourceCountIs("AWS::CloudWatch::Alarm", 3);
  template.resourceCountIs("AWS::SNS::Topic", 1);
  template.resourceCountIs("AWS::SNS::Subscription", 1);
});

test("staging uses one low-cost ARM host and an isolated micro database", () => {
  const app = new App();
  const config = environmentConfig("staging");
  const network = new NetworkStack(app, "LowCostNetwork", config);
  const storage = new StorageStack(app, "LowCostStorage", config);
  const data = new DataStack(app, "LowCostData", {
    config,
    vpc: network.vpc,
    securityGroup: network.databaseSecurityGroup,
    alarmTopic: storage.alarmTopic,
  });
  const application = new ApplicationStack(app, "LowCostApplication", {
    config,
    vpc: network.vpc,
    applicationSecurityGroup: network.applicationSecurityGroup,
    artifactBucket: storage.artifactBucket,
    learningBucket: storage.learningBucket,
    privateBucket: storage.privateBucket,
    quarantineBucket: storage.quarantineBucket,
    workQueue: storage.workQueue,
    deadLetterQueue: storage.deadLetterQueue,
    databaseSecretArn: data.database.secret?.secretArn ?? "missing",
    alarmTopic: storage.alarmTopic,
  });
  const identityProvider = new GitHubIdentityProviderStack(
    app,
    "SharedGitHubIdentity",
  );
  const deploymentIdentity = new DeploymentIdentityStack(
    app,
    "LowCostDeploymentIdentity",
    {
      owner: "codestudio-au",
      repository: "upskill",
      environment: "staging",
      artifactBucket: storage.artifactBucket,
      instanceId: application.instanceId,
      providerArn: identityProvider.providerArn,
    },
  );
  const applicationTemplate = Template.fromStack(application);
  applicationTemplate.resourceCountIs("AWS::EC2::Instance", 1);
  applicationTemplate.resourceCountIs("AWS::EC2::EIP", 1);
  applicationTemplate.resourceCountIs(
    "AWS::ElasticLoadBalancingV2::LoadBalancer",
    0,
  );
  applicationTemplate.resourceCountIs("AWS::AutoScaling::AutoScalingGroup", 0);
  applicationTemplate.hasResourceProperties("AWS::EC2::Instance", {
    InstanceType: "t4g.micro",
  });
  applicationTemplate.hasResourceProperties("AWS::EC2::LaunchTemplate", {
    LaunchTemplateData: { MetadataOptions: { HttpTokens: "required" } },
  });
  applicationTemplate.resourceCountIs("AWS::CloudWatch::Alarm", 6);
  const applicationJson = JSON.stringify(applicationTemplate.toJSON());
  expect(applicationJson).toContain("sslmode=verify-full");
  expect(applicationJson).toContain("upskill-web.env");
  expect(applicationJson).toContain("upskill-worker.env");
  expect(applicationJson).toContain("upskill-deploy.env");
  expect(applicationJson).toContain("/swapfile");
  Template.fromStack(identityProvider).resourceCountIs(
    "AWS::IAM::OIDCProvider",
    1,
  );
  Template.fromStack(deploymentIdentity).resourceCountIs(
    "AWS::IAM::OIDCProvider",
    0,
  );
  Template.fromStack(data).hasResourceProperties("AWS::RDS::DBInstance", {
    DBInstanceClass: "db.t4g.micro",
    AllocatedStorage: "20",
    BackupRetentionPeriod: 7,
    MultiAZ: false,
    PubliclyAccessible: false,
    StorageEncrypted: true,
  });
  Template.fromStack(data).hasResourceProperties("AWS::RDS::DBParameterGroup", {
    Parameters: { "rds.force_ssl": "1" },
  });
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
