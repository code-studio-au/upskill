#!/usr/bin/env node
import { App, Tags } from "aws-cdk-lib";
import { AccessGrantsStack } from "../lib/access-grants-stack.js";
import { ApplicationStack } from "../lib/application-stack.js";
import { environmentConfig } from "../lib/config.js";
import { DataStack } from "../lib/data-stack.js";
import { DeploymentIdentityStack } from "../lib/deployment-identity-stack.js";
import { NetworkStack } from "../lib/network-stack.js";
import { OfflineScormEdgeSecurityStack } from "../lib/offline-scorm-edge-security-stack.js";
import { StorageStack } from "../lib/storage-stack.js";

const app = new App();
const config = environmentConfig(
  app.node.tryGetContext("environment"),
  app.node.tryGetContext("liveKitApprovedMonthlySpendAud"),
  {
    suffix: app.node.tryGetContext("offlineScormPackageSiteSuffix"),
    hostedZoneId: app.node.tryGetContext("offlineScormHostedZoneId"),
    hostedZoneName: app.node.tryGetContext("offlineScormHostedZoneName"),
  },
  app.node.tryGetContext("offlineScormCloudFrontOriginDomain"),
  app.node.tryGetContext("offlineScormCloudFrontSharedHostRiskAcceptance"),
);
const stackPrefix = `upskill-${config.name}`;
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION;
const stackProps = account && region ? { env: { account, region } } : {};
const accessGrants = new AccessGrantsStack(
  app,
  "upskill-shared-access-grants",
  stackProps,
);
const network = new NetworkStack(
  app,
  `${stackPrefix}-network`,
  config,
  stackProps,
);
const storage = new StorageStack(
  app,
  `${stackPrefix}-storage`,
  config,
  stackProps,
);
let offlineScormEdgeSecurity: OfflineScormEdgeSecurityStack | undefined;
if (config.offlineScormCloudFrontQualification) {
  if (!account)
    throw new Error(
      "Offline SCORM CloudFront qualification requires a resolved AWS account",
    );
  offlineScormEdgeSecurity = new OfflineScormEdgeSecurityStack(
    app,
    `${stackPrefix}-offline-scorm-edge-security`,
    {
      env: { account, region: "us-east-1" },
      config,
    },
  );
}
const data = new DataStack(app, `${stackPrefix}-data`, {
  ...stackProps,
  config,
  vpc: network.vpc,
  securityGroup: network.databaseSecurityGroup,
  alarmTopic: storage.alarmTopic,
});
const application = new ApplicationStack(app, `${stackPrefix}-application`, {
  ...stackProps,
  config,
  vpc: network.vpc,
  applicationSecurityGroup: network.applicationSecurityGroup,
  artifactBucket: storage.artifactBucket,
  offlineScormEdgeLogBucket: storage.offlineScormEdgeLogBucket,
  learningBucket: storage.learningBucket,
  privateBucket: storage.privateBucket,
  recordingBucket: storage.recordingBucket,
  quarantineBucket: storage.quarantineBucket,
  workQueue: storage.workQueue,
  deadLetterQueue: storage.deadLetterQueue,
  databaseSecretArn: data.database.secret?.secretArn ?? "missing",
  alarmTopic: storage.alarmTopic,
  accessGrantsInstanceArn: accessGrants.instanceArn,
});
if (offlineScormEdgeSecurity)
  application.addStackDependency(offlineScormEdgeSecurity);
const deploymentIdentity = new DeploymentIdentityStack(
  app,
  `${stackPrefix}-deployment-identity`,
  {
    ...stackProps,
    owner: String(app.node.tryGetContext("githubOwner")),
    ownerId: String(app.node.tryGetContext("githubOwnerId")),
    repository: String(app.node.tryGetContext("githubRepository")),
    repositoryId: String(app.node.tryGetContext("githubRepositoryId")),
    environment: config.name,
    artifactBucket: storage.artifactBucket,
  },
);
for (const stack of [network, storage, data, application, deploymentIdentity]) {
  Tags.of(stack).add("Application", "upskill");
  Tags.of(stack).add("Environment", config.name);
}
if (offlineScormEdgeSecurity) {
  Tags.of(offlineScormEdgeSecurity).add("Application", "upskill");
  Tags.of(offlineScormEdgeSecurity).add("Environment", config.name);
}
Tags.of(accessGrants).add("Application", "upskill");
