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
  readonly loadBalancerSecurityGroup: SecurityGroup;
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
      natGateways: config.name === "production" ? 2 : 1,
      subnetConfiguration: [
        { name: "public", subnetType: SubnetType.PUBLIC, cidrMask: 24 },
        {
          name: "application",
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: "isolated",
          subnetType: SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });
    this.loadBalancerSecurityGroup = new SecurityGroup(
      this,
      "LoadBalancerSecurityGroup",
      { vpc: this.vpc },
    );
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

    this.loadBalancerSecurityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(80),
      "public HTTP until an ACM domain enables HTTPS",
    );
    this.loadBalancerSecurityGroup.addIngressRule(
      Peer.anyIpv6(),
      Port.tcp(80),
      "public HTTP IPv6 until an ACM domain enables HTTPS",
    );
    this.loadBalancerSecurityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(443),
      "public HTTPS",
    );
    this.loadBalancerSecurityGroup.addIngressRule(
      Peer.anyIpv6(),
      Port.tcp(443),
      "public HTTPS IPv6",
    );
    this.applicationSecurityGroup.addIngressRule(
      this.loadBalancerSecurityGroup,
      Port.tcp(80),
      "nginx from ALB",
    );
    this.databaseSecurityGroup.addIngressRule(
      this.applicationSecurityGroup,
      Port.tcp(5432),
      "PostgreSQL from application",
    );
    new CfnOutput(this, "VpcId", { value: this.vpc.vpcId });
  }
}
