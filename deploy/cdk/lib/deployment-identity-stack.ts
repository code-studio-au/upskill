import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import {
  Effect,
  FederatedPrincipal,
  OpenIdConnectProvider,
  PolicyStatement,
  Role,
} from "aws-cdk-lib/aws-iam";
import type { Bucket } from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

export interface DeploymentIdentityStackProps extends StackProps {
  owner: string;
  repository: string;
  environment: string;
  artifactBucket: Bucket;
}

export class DeploymentIdentityStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: DeploymentIdentityStackProps,
  ) {
    super(scope, id, props);
    const provider = new OpenIdConnectProvider(this, "GitHubProvider", {
      url: "https://token.actions.githubusercontent.com",
      clientIds: ["sts.amazonaws.com"],
    });
    const subject = `repo:${props.owner}/${props.repository}:environment:${props.environment}`;
    const role = new Role(this, "GitHubDeploymentRole", {
      assumedBy: new FederatedPrincipal(
        provider.openIdConnectProviderArn,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub": subject,
          },
        },
        "sts:AssumeRoleWithWebIdentity",
      ),
    });
    props.artifactBucket.grantReadWrite(role);
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "ssm:SendCommand",
          "ssm:GetCommandInvocation",
          "ssm:ListCommandInvocations",
        ],
        resources: ["*"],
        conditions: {
          StringEquals: {
            "aws:ResourceTag/Application": "upskill",
            "aws:ResourceTag/Environment": props.environment,
          },
        },
      }),
    );
    new CfnOutput(this, "GitHubDeploymentRoleArn", {
      value: role.roleArn,
    });
  }
}
