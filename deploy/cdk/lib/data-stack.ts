import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import {
  Alarm,
  ComparisonOperator,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import {
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
import type { ITopic } from "aws-cdk-lib/aws-sns";
import type { EnvironmentConfig } from "./config.js";

export interface DataStackProps extends StackProps {
  config: EnvironmentConfig;
  vpc: Vpc;
  securityGroup: SecurityGroup;
  alarmTopic: ITopic;
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
      parameters: { "rds.force_ssl": "1" },
      instanceType: new InstanceType(props.config.databaseInstanceType),
      credentials: Credentials.fromGeneratedSecret("upskill_admin", {
        secretName: `upskill/${props.config.name}/database`,
      }),
      databaseName: "upskill",
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      storageType: StorageType.GP3,
      backupRetention: Duration.days(props.config.databaseBackupRetentionDays),
      deleteAutomatedBackups: !props.config.deletionProtection,
      multiAz: false,
      deletionProtection: props.config.deletionProtection,
      removalPolicy: props.config.deletionProtection
        ? RemovalPolicy.RETAIN
        : RemovalPolicy.SNAPSHOT,
      publiclyAccessible: false,
    });
    const alarmDefaults = {
      evaluationPeriods: 2,
      treatMissingData: TreatMissingData.BREACHING,
    } as const;
    const storageAlarm = new Alarm(this, "DatabaseFreeStorageAlarm", {
      ...alarmDefaults,
      alarmName: `upskill-${props.config.name}-database-free-storage`,
      metric: this.database.metricFreeStorageSpace({
        period: Duration.minutes(5),
      }),
      threshold: 5 * 1024 * 1024 * 1024,
      comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
    });
    const cpuAlarm = new Alarm(this, "DatabaseCpuAlarm", {
      ...alarmDefaults,
      treatMissingData: TreatMissingData.NOT_BREACHING,
      alarmName: `upskill-${props.config.name}-database-cpu`,
      metric: this.database.metricCPUUtilization({
        period: Duration.minutes(5),
      }),
      threshold: 90,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    const connectionsAlarm = new Alarm(this, "DatabaseConnectionsAlarm", {
      ...alarmDefaults,
      treatMissingData: TreatMissingData.NOT_BREACHING,
      alarmName: `upskill-${props.config.name}-database-connections`,
      metric: this.database.metricDatabaseConnections({
        period: Duration.minutes(5),
      }),
      threshold: 45,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    for (const alarm of [storageAlarm, cpuAlarm, connectionsAlarm])
      alarm.addAlarmAction(new SnsAction(props.alarmTopic));
  }
}
