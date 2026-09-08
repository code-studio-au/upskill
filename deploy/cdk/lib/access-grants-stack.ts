import { RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { CfnAccessGrantsInstance } from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

export class AccessGrantsStack extends Stack {
  readonly instanceArn: string;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    const instance = new CfnAccessGrantsInstance(this, "AccessGrantsInstance");
    instance.applyRemovalPolicy(RemovalPolicy.RETAIN);
    this.instanceArn = instance.attrAccessGrantsInstanceArn;
  }
}
