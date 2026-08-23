import { CfnOutput, Stack, type StackProps } from "aws-cdk-lib";
import {
  IpAddresses,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import type { Construct } from "constructs";
import type { EnvironmentConfig } from "./config.js";

export class NetworkStack extends Stack {
  readonly vpc: Vpc;
  readonly applicationSecurityGroup: SecurityGroup;
  readonly databaseSecurityGroup: SecurityGroup;

  constructor(
    scope: Construct,
    id: string,
    config: EnvironmentConfig,
    props?: StackProps,
  ) {
    super(scope, id, props);
    this.vpc = new Vpc(this, "Vpc", {
      ipAddresses: IpAddresses.cidr(config.cidr),
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: "public", subnetType: SubnetType.PUBLIC, cidrMask: 24 },
        {
          name: "isolated",
          subnetType: SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });
    this.applicationSecurityGroup = new SecurityGroup(
      this,
      "ApplicationSecurityGroup",
      { vpc: this.vpc },
    );
    this.databaseSecurityGroup = new SecurityGroup(
      this,
      "DatabaseSecurityGroup",
      { vpc: this.vpc },
    );

    this.applicationSecurityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(80),
      "public HTTP for ACME and HTTPS redirect",
    );
    this.applicationSecurityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(443),
      "public HTTPS",
    );
    this.databaseSecurityGroup.addIngressRule(
      this.applicationSecurityGroup,
      Port.tcp(5432),
      "PostgreSQL from application",
    );
    new CfnOutput(this, "VpcId", { value: this.vpc.vpcId });
  }
}
