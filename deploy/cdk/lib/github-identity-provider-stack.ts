import { Stack, type StackProps } from "aws-cdk-lib";
import { CfnOIDCProvider } from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

export class GitHubIdentityProviderStack extends Stack {
  readonly providerArn: string;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    const provider = new CfnOIDCProvider(this, "GitHubProvider", {
      url: "https://token.actions.githubusercontent.com",
      clientIdList: ["sts.amazonaws.com"],
    });
    this.providerArn = provider.ref;
  }
}
