#!/usr/bin/env node
import { App, Tags } from "aws-cdk-lib";
import { ApplicationStack } from "../lib/application-stack.js";
import { environmentConfig } from "../lib/config.js";
import { DataStack } from "../lib/data-stack.js";
import { DeploymentIdentityStack } from "../lib/deployment-identity-stack.js";
import { NetworkStack } from "../lib/network-stack.js";
import { StorageStack } from "../lib/storage-stack.js";

const app = new App();
const config = environmentConfig(app.node.tryGetContext("environment"));
const stackPrefix = `upskill-${config.name}`;
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION;
const stackProps = account && region ? { env: { account, region } } : {};
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
  learningBucket: storage.learningBucket,
  privateBucket: storage.privateBucket,
  quarantineBucket: storage.quarantineBucket,
  workQueue: storage.workQueue,
  deadLetterQueue: storage.deadLetterQueue,
  databaseSecretArn: data.database.secret?.secretArn ?? "missing",
  alarmTopic: storage.alarmTopic,
});
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
