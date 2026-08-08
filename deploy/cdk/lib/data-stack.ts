import { RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  SubnetType,
  type SecurityGroup,
  type Vpc,
} from "aws-cdk-lib/aws-ec2";
import {
  Credentials,
  DatabaseInstance,
  DatabaseInstanceEngine,
  PostgresEngineVersion,
  StorageType,
} from "aws-cdk-lib/aws-rds";
import type { Construct } from "constructs";
import type { EnvironmentConfig } from "./config.js";

export interface DataStackProps extends StackProps {
  config: EnvironmentConfig;
  vpc: Vpc;
  securityGroup: SecurityGroup;
}

export class DataStack extends Stack {
  readonly database: DatabaseInstance;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    this.database = new DatabaseInstance(this, "Database", {
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
      securityGroups: [props.securityGroup],
      engine: DatabaseInstanceEngine.postgres({
        version: PostgresEngineVersion.VER_17,
      }),
      instanceType: InstanceType.of(
        InstanceClass.BURSTABLE4_GRAVITON,
        InstanceSize.SMALL,
      ),
      credentials: Credentials.fromGeneratedSecret("upskill_admin", {
        secretName: `upskill/${props.config.name}/database`,
      }),
      databaseName: "upskill",
      allocatedStorage: 30,
      maxAllocatedStorage: 200,
      storageEncrypted: true,
      storageType: StorageType.GP3,
      multiAz: props.config.dbMultiAz,
      deletionProtection: props.config.deletionProtection,
      removalPolicy: props.config.deletionProtection
        ? RemovalPolicy.RETAIN
        : RemovalPolicy.SNAPSHOT,
      publiclyAccessible: false,
    });
  }
}
