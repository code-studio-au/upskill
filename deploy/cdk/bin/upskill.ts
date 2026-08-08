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
const certificateArn = app.node.tryGetContext("certificateArn") as
  string | undefined;
if (config.name === "production" && !certificateArn) {
  throw new Error("Production synthesis requires CDK context certificateArn");
}
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
});
new ApplicationStack(app, `${stackPrefix}-application`, {
  ...stackProps,
  config,
  vpc: network.vpc,
  loadBalancerSecurityGroup: network.loadBalancerSecurityGroup,
  applicationSecurityGroup: network.applicationSecurityGroup,
  artifactBucket: storage.artifactBucket,
  learningBucket: storage.learningBucket,
  privateBucket: storage.privateBucket,
  quarantineBucket: storage.quarantineBucket,
  workQueue: storage.workQueue,
  databaseSecretArn: data.database.secret?.secretArn ?? "missing",
  ...(certificateArn ? { certificateArn } : {}),
});
new DeploymentIdentityStack(app, `${stackPrefix}-deployment-identity`, {
  ...stackProps,
  owner: String(app.node.tryGetContext("githubOwner")),
  repository: String(app.node.tryGetContext("githubRepository")),
  environment: config.name,
  artifactBucket: storage.artifactBucket,
});
Tags.of(app).add("Application", "upskill");
Tags.of(app).add("Environment", config.name);
