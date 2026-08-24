import { ArnFormat, CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import {
  Effect,
  FederatedPrincipal,
  PolicyStatement,
  Role,
} from "aws-cdk-lib/aws-iam";
import type { Bucket } from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

export interface DeploymentIdentityStackProps extends StackProps {
  owner: string;
  ownerId: string;
  repository: string;
  repositoryId: string;
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
    for (const [label, value] of [
      ["GitHub owner ID", props.ownerId],
      ["GitHub repository ID", props.repositoryId],
    ] as const)
      if (!/^\d+$/u.test(value)) throw new Error(`${label} must be numeric`);
    const subject = `repo:${props.owner}@${props.ownerId}/${props.repository}@${props.repositoryId}:environment:${props.environment}`;
    const githubOidcProviderArn = this.formatArn({
      service: "iam",
      region: "",
      resource: "oidc-provider",
      resourceName: "token.actions.githubusercontent.com",
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
    });
    const role = new Role(this, "GitHubDeploymentRole", {
      assumedBy: new FederatedPrincipal(
        githubOidcProviderArn,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub": subject,
          },
        },
        "sts:AssumeRoleWithWebIdentity",
      ),
    });
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "s3:PutObject",
          "s3:AbortMultipartUpload",
          "s3:ListMultipartUploadParts",
        ],
        resources: [props.artifactBucket.arnForObjects("releases/*")],
      }),
    );
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["ssm:SendCommand"],
        resources: [
          this.formatArn({
            service: "ec2",
            resource: "instance",
            resourceName: "*",
          }),
        ],
        conditions: {
          StringEquals: {
            "ssm:resourceTag/Application": "upskill",
            "ssm:resourceTag/Environment": props.environment,
          },
        },
      }),
    );
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["ssm:SendCommand"],
        resources: [
          this.formatArn({
            service: "ssm",
            account: "",
            resource: "document",
            resourceName: "AWS-RunShellScript",
          }),
        ],
      }),
    );
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["ssm:GetCommandInvocation"],
        resources: ["*"],
      }),
    );
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["ec2:DescribeInstances"],
        resources: ["*"],
      }),
    );
    new CfnOutput(this, "GitHubDeploymentRoleArn", {
      value: role.roleArn,
    });
  }
}
