import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  Tags,
  type StackProps,
} from "aws-cdk-lib";
import {
  Alarm,
  ComparisonOperator,
  Metric,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import {
  AmazonLinuxCpuType,
  BlockDeviceVolume,
  CfnEIP,
  CfnEIPAssociation,
  EbsDeviceVolumeType,
  Instance,
  InstanceType,
  MachineImage,
  SubnetType,
  UserData,
  type SecurityGroup,
  type Vpc,
} from "aws-cdk-lib/aws-ec2";
import {
  Effect,
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import {
  CfnAccessGrant,
  CfnAccessGrantsLocation,
  type Bucket,
} from "aws-cdk-lib/aws-s3";
import { CfnRecordSet } from "aws-cdk-lib/aws-route53";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import type { Queue } from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";
import type { ITopic } from "aws-cdk-lib/aws-sns";
import type { EnvironmentConfig } from "./config.js";

export interface ApplicationStackProps extends StackProps {
  config: EnvironmentConfig;
  vpc: Vpc;
  applicationSecurityGroup: SecurityGroup;
  artifactBucket: Bucket;
  learningBucket: Bucket;
  privateBucket: Bucket;
  recordingBucket: Bucket;
  quarantineBucket: Bucket;
  workQueue: Queue;
  deadLetterQueue: Queue;
  databaseSecretArn: string;
  alarmTopic: ITopic;
  accessGrantsInstanceArn: string;
}

export class ApplicationStack extends Stack {
  readonly instanceId: string;

  constructor(scope: Construct, id: string, props: ApplicationStackProps) {
    super(scope, id, props);
    const role = new Role(this, "InstanceRole", {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
      ],
    });
    const recordingUploadRole = new Role(this, "RecordingUploadRole", {
      assumedBy: role,
      description:
        "Dormant short-session role for exact-object LiveKit recording uploads",
      maxSessionDuration: Duration.hours(1),
    });
    recordingUploadRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["s3:PutObject"],
        resources: [props.recordingBucket.arnForObjects("recordings/*")],
      }),
    );
    recordingUploadRole.grantAssumeRole(role);
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["s3:GetObject", "s3:DeleteObject", "s3:DeleteObjectVersion"],
        resources: [props.recordingBucket.arnForObjects("recordings/*")],
      }),
    );
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["s3:ListBucketVersions"],
        resources: [props.recordingBucket.bucketArn],
        conditions: {
          StringLike: { "s3:prefix": ["recordings/*"] },
        },
      }),
    );
    const accessGrantsPrincipal = new ServicePrincipal(
      "access-grants.s3.amazonaws.com",
      {
        conditions: {
          StringEquals: {
            "aws:SourceAccount": this.account,
            "aws:SourceArn": props.accessGrantsInstanceArn,
          },
        },
      },
    );
    const recordingAccessGrantsLocationRole = new Role(
      this,
      "RecordingAccessGrantsLocationRole",
      {
        assumedBy: accessGrantsPrincipal,
        description:
          "S3 Access Grants location role for scoped LiveKit recording uploads",
        maxSessionDuration: Duration.hours(12),
      },
    );
    recordingAccessGrantsLocationRole.assumeRolePolicy?.addStatements(
      new PolicyStatement({
        actions: ["sts:SetSourceIdentity"],
        principals: [accessGrantsPrincipal],
      }),
    );
    recordingAccessGrantsLocationRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["s3:PutObject"],
        resources: [props.recordingBucket.arnForObjects("recordings/*")],
      }),
    );
    const recordingAccessGrantsLocation = new CfnAccessGrantsLocation(
      this,
      "RecordingAccessGrantsLocation",
      {
        iamRoleArn: recordingAccessGrantsLocationRole.roleArn,
        locationScope: `s3://${props.recordingBucket.bucketName}/recordings/`,
      },
    );
    new CfnAccessGrant(this, "RecordingAccessGrant", {
      accessGrantsLocationId:
        recordingAccessGrantsLocation.attrAccessGrantsLocationId,
      grantee: {
        granteeType: "IAM",
        granteeIdentifier: role.roleArn,
      },
      permission: "WRITE",
    });
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["s3:GetDataAccess"],
        resources: [props.accessGrantsInstanceArn],
      }),
    );
    const recordingUploadRoleParameter = new StringParameter(
      this,
      "RecordingUploadRoleParameter",
      {
        parameterName: `/upskill/${props.config.name}/livekit/recording-upload-role-arn`,
        description:
          "Dormant LiveKit recording upload role ARN for application hosts",
        stringValue: recordingUploadRole.roleArn,
      },
    );
    const recordingAccessGrantsAccountParameter = new StringParameter(
      this,
      "RecordingAccessGrantsAccountParameter",
      {
        parameterName: `/upskill/${props.config.name}/livekit/recording-access-grants-account-id`,
        description:
          "AWS account ID for scoped LiveKit recording upload credentials",
        stringValue: this.account,
      },
    );
    const liveKitApprovedMonthlySpendParameter = new StringParameter(
      this,
      "LiveKitApprovedMonthlySpendParameter",
      {
        parameterName: `/upskill/${props.config.name}/livekit/approved-monthly-spend-aud`,
        description:
          "Reviewed LiveKit monthly spend alert threshold in AUD; zero blocks enablement",
        stringValue: String(props.config.liveKitApprovedMonthlySpendAud),
      },
    );
    const offlineScormPackageHostSuffixParameter = props.config
      .offlineScormPackageHost
      ? new StringParameter(this, "OfflineScormPackageHostSuffixParameter", {
          parameterName: `/upskill/${props.config.name}/offline-scorm/package-host-suffix`,
          description:
            "Provisioned wildcard package-host suffix; runtime activation must use the same private PSL suffix",
          stringValue: props.config.offlineScormPackageHost.suffix,
        })
      : null;
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["ssm:GetParameter"],
        resources: [
          recordingUploadRoleParameter.parameterArn,
          recordingAccessGrantsAccountParameter.parameterArn,
          liveKitApprovedMonthlySpendParameter.parameterArn,
          ...(offlineScormPackageHostSuffixParameter
            ? [offlineScormPackageHostSuffixParameter.parameterArn]
            : []),
        ],
      }),
    );
    if (props.config.offlineScormPackageHost) {
      role.addToPolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["route53:ChangeResourceRecordSets"],
          resources: [
            this.formatArn({
              service: "route53",
              region: "",
              account: "",
              resource: "hostedzone",
              resourceName: props.config.offlineScormPackageHost.hostedZoneId,
            }),
          ],
        }),
      );
      role.addToPolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["route53:GetChange"],
          resources: [
            this.formatArn({
              service: "route53",
              region: "",
              account: "",
              resource: "change",
              resourceName: "*",
            }),
          ],
        }),
      );
      role.addToPolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["route53:ListHostedZones"],
          resources: ["*"],
        }),
      );
    }
    const configurationSecret = new Secret(this, "ApplicationConfiguration", {
      secretName: `upskill/${props.config.name}/application`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          APP_ENV: props.config.name,
          UPSKILL_LOG_LEVEL: "info",
          UPSKILL_TRUST_PROXY: "true",
          APP_ORIGIN: `https://${props.config.name}.example.invalid`,
          LEARNING_ORIGIN: `https://learn-${props.config.name}.example.invalid`,
          SUPPORT_EMAIL: "support@REPLACE_WITH_PRODUCT_DOMAIN",
          STRIPE_SECRET_KEY: "rk_live_REPLACE_BEFORE_DEPLOY",
          STRIPE_WEBHOOK_SECRET: "whsec_REPLACE_BEFORE_DEPLOY",
          EMAIL_PROVIDER: "mailgun",
          MAILGUN_API_KEY: "REPLACE_WITH_DOMAIN_SENDING_KEY",
          MAILGUN_DOMAIN: "REPLACE_WITH_SENDING_DOMAIN",
          MAILGUN_FROM: "Upskill <no-reply@REPLACE_WITH_SENDING_DOMAIN>",
          MAILGUN_API_BASE_URL: "https://api.mailgun.net",
          SMS_PROVIDER: "textbee",
          TEXTBEE_API_KEY: "REPLACE_WITH_TEXTBEE_API_KEY",
          TEXTBEE_API_BASE_URL: "https://api.textbee.dev",
          TEXTBEE_WEBHOOK_SECRET: "REPLACE_WITH_TEXTBEE_WEBHOOK_SIGNING_SECRET",
          AWS_REGION: this.region,
          S3_QUARANTINE_BUCKET: props.quarantineBucket.bucketName,
          S3_LEARNING_CONTENT_BUCKET: props.learningBucket.bucketName,
          S3_PRIVATE_RESOURCES_BUCKET: props.privateBucket.bucketName,
          S3_RECORDING_BUCKET: props.recordingBucket.bucketName,
          SQS_QUEUE_URL: props.workQueue.queueUrl,
          SQS_DEAD_LETTER_QUEUE_URL: props.deadLetterQueue.queueUrl,
          SQS_RECEIVE_WAIT_SECONDS: "20",
          SQS_VISIBILITY_TIMEOUT_SECONDS: "900",
          NODE_ENV: "production",
        }),
        generateStringKey: "BETTER_AUTH_SECRET",
        passwordLength: 48,
        excludePunctuation: true,
      },
    });
    const liveKitConfigurationSecret = new Secret(
      this,
      "LiveKitConfiguration",
      {
        secretName: `upskill/${props.config.name}/livekit`,
        description:
          "Dormant LiveKit Cloud configuration; add provider credentials before deliberate enablement",
        secretObjectValue: {
          LIVEKIT_ENABLED: SecretValue.unsafePlainText("false"),
          LIVEKIT_PROJECT_ENVIRONMENT: SecretValue.unsafePlainText(
            props.config.name,
          ),
        },
        removalPolicy:
          props.config.name === "production"
            ? RemovalPolicy.RETAIN
            : RemovalPolicy.DESTROY,
      },
    );
    const offlineScormConfigurationSecret = new Secret(
      this,
      "OfflineScormConfiguration",
      {
        secretName: `upskill/${props.config.name}/offline-scorm`,
        description:
          "Dormant offline SCORM signing and exact-site allocation authority; configure both before deliberate activation",
        secretObjectValue: {
          OFFLINE_SCORM_ENABLED: SecretValue.unsafePlainText("false"),
        },
        removalPolicy:
          props.config.name === "production"
            ? RemovalPolicy.RETAIN
            : RemovalPolicy.DESTROY,
      },
    );
    const accessCodeEncryptionSecret = new Secret(
      this,
      "AccessCodeEncryptionKey",
      {
        secretName: `upskill/${props.config.name}/access-code/v1`,
        description: "AES-256-GCM key material for recoverable access codes",
        generateSecretString: {
          passwordLength: 43,
          excludePunctuation: true,
        },
      },
    );
    const webDatabaseCredentials = new Secret(this, "WebDatabaseCredentials", {
      secretName: `upskill/${props.config.name}/database/web`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "upskill_web" }),
        generateStringKey: "password",
        passwordLength: 40,
        excludePunctuation: true,
      },
    });
    const workerDatabaseCredentials = new Secret(
      this,
      "WorkerDatabaseCredentials",
      {
        secretName: `upskill/${props.config.name}/database/worker`,
        generateSecretString: {
          secretStringTemplate: JSON.stringify({ username: "upskill_worker" }),
          generateStringKey: "password",
          passwordLength: 40,
          excludePunctuation: true,
        },
      },
    );
    props.artifactBucket.grantRead(role);
    props.learningBucket.grantReadWrite(role);
    props.privateBucket.grantReadWrite(role);
    props.quarantineBucket.grantReadWrite(role);
    props.workQueue.grantConsumeMessages(role);
    props.workQueue.grantSendMessages(role);
    props.deadLetterQueue.grantConsumeMessages(role);
    configurationSecret.grantRead(role);
    liveKitConfigurationSecret.grantRead(role);
    offlineScormConfigurationSecret.grantRead(role);
    accessCodeEncryptionSecret.grantRead(role);
    webDatabaseCredentials.grantRead(role);
    workerDatabaseCredentials.grantRead(role);
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["secretsmanager:GetSecretValue"],
        resources: [props.databaseSecretArn],
      }),
    );
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["cloudwatch:PutMetricData"],
        resources: ["*"],
        conditions: { StringEquals: { "cloudwatch:namespace": "Upskill" } },
      }),
    );

    const userData = UserData.forLinux();
    userData.addCommands(
      "set -euxo pipefail",
      "dnf install -y jq libatomic nginx xz",
      "UPSKILL_NODE_TMP=$(mktemp -d /tmp/upskill-node.XXXXXX)",
      "trap 'rm -rf -- \"$UPSKILL_NODE_TMP\"' EXIT",
      "UPSKILL_NODE_ARCHIVE=node-v26.7.0-linux-arm64.tar.xz",
      "curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 https://nodejs.org/download/release/v26.7.0/SHASUMS256.txt --output \"$UPSKILL_NODE_TMP/SHASUMS256.txt\"",
      'grep -F "  $UPSKILL_NODE_ARCHIVE" "$UPSKILL_NODE_TMP/SHASUMS256.txt" > "$UPSKILL_NODE_TMP/SHASUMS256-linux.txt"',
      'curl --fail --silent --show-error --location --proto \'=https\' --tlsv1.2 "https://nodejs.org/download/release/v26.7.0/$UPSKILL_NODE_ARCHIVE" --output "$UPSKILL_NODE_TMP/$UPSKILL_NODE_ARCHIVE"',
      '(cd "$UPSKILL_NODE_TMP" && sha256sum --check SHASUMS256-linux.txt)',
      "install -d -m 0755 /usr/local/lib/nodejs",
      'tar --extract --xz --no-same-owner --file "$UPSKILL_NODE_TMP/$UPSKILL_NODE_ARCHIVE" --directory /usr/local/lib/nodejs',
      "chown -R root:root /usr/local/lib/nodejs/node-v26.7.0-linux-arm64",
      "for binary in node npm npx; do ln -sfn /usr/local/lib/nodejs/node-v26.7.0-linux-arm64/bin/$binary /usr/local/bin/$binary; done",
      "/usr/local/bin/npm install --global pnpm@11.0.8 --prefix /usr/local --ignore-scripts",
      'test "$(/usr/local/bin/pnpm --version)" = 11.0.8',
      'rm -rf -- "$UPSKILL_NODE_TMP"',
      "trap - EXIT",
      "install -d -m 0755 /etc/upskill",
      "curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem --output /etc/upskill/rds-global-bundle.pem",
      "grep -q -- '-----BEGIN CERTIFICATE-----' /etc/upskill/rds-global-bundle.pem",
      "chmod 0644 /etc/upskill/rds-global-bundle.pem",
      "systemctl enable nginx",
      "install -d -o ec2-user -g ec2-user -m 0755 /opt/upskill/releases",
      "install -d -o root -g root -m 0755 /opt/upskill/shared",
      "if [[ ! -f /swapfile ]]; then fallocate -l 2G /swapfile; chmod 0600 /swapfile; mkswap /swapfile; echo '/swapfile none swap sw 0 0' >> /etc/fstab; fi",
      "swapon --show=NAME --noheadings | grep -Fxq /swapfile || swapon /swapfile",
      `cat > /usr/local/bin/upskill-refresh-env <<'UPSKILL_ENV'
#!/usr/bin/env bash
set -euo pipefail
application_json=$(aws secretsmanager get-secret-value --region ${this.region} --secret-id '${configurationSecret.secretArn}' --query SecretString --output text)
livekit_json=$(aws secretsmanager get-secret-value --region ${this.region} --secret-id '${liveKitConfigurationSecret.secretArn}' --query SecretString --output text)
offline_scorm_json=$(aws secretsmanager get-secret-value --region ${this.region} --secret-id '${offlineScormConfigurationSecret.secretArn}' --query SecretString --output text)
database_json=$(aws secretsmanager get-secret-value --region ${this.region} --secret-id '${props.databaseSecretArn}' --query SecretString --output text)
web_database_json=$(aws secretsmanager get-secret-value --region ${this.region} --secret-id '${webDatabaseCredentials.secretArn}' --query SecretString --output text)
worker_database_json=$(aws secretsmanager get-secret-value --region ${this.region} --secret-id '${workerDatabaseCredentials.secretArn}' --query SecretString --output text)
access_code_encryption_key=$(aws secretsmanager get-secret-value --region ${this.region} --secret-id '${accessCodeEncryptionSecret.secretArn}' --query SecretString --output text)
recording_upload_role_arn=$(aws ssm get-parameter --region ${this.region} --name '${recordingUploadRoleParameter.parameterName}' --query Parameter.Value --output text)
recording_access_grants_account_id=$(aws ssm get-parameter --region ${this.region} --name '${recordingAccessGrantsAccountParameter.parameterName}' --query Parameter.Value --output text)
livekit_approved_monthly_spend_aud=$(aws ssm get-parameter --region ${this.region} --name '${liveKitApprovedMonthlySpendParameter.parameterName}' --query Parameter.Value --output text)
${
  offlineScormPackageHostSuffixParameter
    ? `offline_scorm_package_host_suffix=$(aws ssm get-parameter --region ${this.region} --name '${offlineScormPackageHostSuffixParameter.parameterName}' --query Parameter.Value --output text)`
    : 'offline_scorm_package_host_suffix=""'
}
base_environment_tmp=$(mktemp)
web_environment_tmp=$(mktemp)
worker_environment_tmp=$(mktemp)
deploy_environment_tmp=$(mktemp)
trap 'rm -f -- "$base_environment_tmp" "$web_environment_tmp" "$worker_environment_tmp" "$deploy_environment_tmp"' EXIT
jq -r 'to_entries[] | "\\(.key)=\\(.value|tostring|@json)"' <<< "$application_json" > "$base_environment_tmp"
jq -r 'to_entries[] | select(.key == "LIVEKIT_ENABLED" or .key == "LIVEKIT_PROJECT_ENVIRONMENT" or .key == "LIVEKIT_URL" or .key == "LIVEKIT_API_KEY" or .key == "LIVEKIT_API_SECRET" or .key == "LIVEKIT_APPROVED_MAX_PARTICIPANTS" or .key == "LIVEKIT_APPROVED_MAX_CONCURRENT_ROOMS" or .key == "LIVEKIT_APPROVED_MAX_CONCURRENT_PARTICIPANTS" or .key == "LIVEKIT_APPROVED_MAX_CONCURRENT_EGRESS_JOBS") | "\\(.key)=\\(.value|tostring|@json)"' <<< "$livekit_json" >> "$base_environment_tmp"
jq -rn '"OFFLINE_SCORM_ENABLED=false"' >> "$base_environment_tmp"
jq -rn --arg value "$recording_upload_role_arn" '"LIVEKIT_RECORDING_UPLOAD_ROLE_ARN=\\($value|@json)"' >> "$base_environment_tmp"
jq -rn --arg value "$recording_access_grants_account_id" '"LIVEKIT_RECORDING_ACCESS_GRANTS_ACCOUNT_ID=\\($value|@json)"' >> "$base_environment_tmp"
jq -rn --arg value "$livekit_approved_monthly_spend_aud" '"LIVEKIT_APPROVED_MONTHLY_SPEND_AUD=\\($value|@json)"' >> "$base_environment_tmp"
if [[ -n "$offline_scorm_package_host_suffix" ]]; then
  jq -rn --arg value "$offline_scorm_package_host_suffix" '"OFFLINE_SCORM_PACKAGE_HOST_SUFFIX=\\($value|@json)"' >> "$base_environment_tmp"
fi
database_host=$(jq -r '.host' <<< "$database_json")
database_port=$(jq -r '.port' <<< "$database_json")
database_name=$(jq -r '.dbname' <<< "$database_json")
database_tls='sslmode=verify-full&sslrootcert=%2Fetc%2Fupskill%2Frds-global-bundle.pem'
migration_database_url=$(jq -rn --argjson credentials "$database_json" --arg host "$database_host" --arg port "$database_port" --arg name "$database_name" --arg tls "$database_tls" '"postgresql://\\($credentials.username|@uri):\\($credentials.password|@uri)@\\($host):\\($port)/\\($name)?\\($tls)"')
web_database_url=$(jq -rn --argjson credentials "$web_database_json" --arg host "$database_host" --arg port "$database_port" --arg name "$database_name" --arg tls "$database_tls" '"postgresql://\\($credentials.username|@uri):\\($credentials.password|@uri)@\\($host):\\($port)/\\($name)?\\($tls)"')
worker_database_url=$(jq -rn --argjson credentials "$worker_database_json" --arg host "$database_host" --arg port "$database_port" --arg name "$database_name" --arg tls "$database_tls" '"postgresql://\\($credentials.username|@uri):\\($credentials.password|@uri)@\\($host):\\($port)/\\($name)?\\($tls)"')
cp "$base_environment_tmp" "$web_environment_tmp"
cp "$base_environment_tmp" "$worker_environment_tmp"
cp "$base_environment_tmp" "$deploy_environment_tmp"
jq -r 'to_entries[] | select(.key == "OFFLINE_SCORM_ENABLED" or .key == "OFFLINE_SCORM_ENTITLEMENT_SIGNING_KEY_ID" or .key == "OFFLINE_SCORM_ENTITLEMENT_SIGNING_PRIVATE_KEY_PKCS8" or .key == "OFFLINE_SCORM_PACKAGE_SITE_SUFFIX" or .key == "OFFLINE_SCORM_PACKAGE_SITE_ORIGIN_KEY") | "\\(.key)=\\(.value|tostring|@json)"' <<< "$offline_scorm_json" >> "$web_environment_tmp"
jq -rn --arg value "$web_database_url" '"DATABASE_URL=\\($value|@json)"' >> "$web_environment_tmp"
jq -rn --arg value "$worker_database_url" '"DATABASE_URL=\\($value|@json)"' >> "$worker_environment_tmp"
jq -rn --arg value "$web_database_url" '"DATABASE_URL=\\($value|@json)"' >> "$deploy_environment_tmp"
jq -rn --arg value "$worker_database_url" '"WORKER_DATABASE_URL=\\($value|@json)"' >> "$deploy_environment_tmp"
jq -rn --arg value "$migration_database_url" '"MIGRATION_DATABASE_URL=\\($value|@json)"' >> "$deploy_environment_tmp"
for target in "$web_environment_tmp" "$worker_environment_tmp" "$deploy_environment_tmp"; do
  jq -rn --arg value "$access_code_encryption_key" '"ACCESS_CODE_ENCRYPTION_KEY=\\($value|@json)"' >> "$target"
done
install -o root -g root -m 0600 "$web_environment_tmp" /opt/upskill/shared/upskill-web.env
install -o root -g root -m 0600 "$worker_environment_tmp" /opt/upskill/shared/upskill-worker.env
install -o root -g root -m 0600 "$deploy_environment_tmp" /opt/upskill/shared/upskill-deploy.env
rm -f -- "$base_environment_tmp" "$web_environment_tmp" "$worker_environment_tmp" "$deploy_environment_tmp"
trap - EXIT
UPSKILL_ENV`,
      "chmod 0755 /usr/local/bin/upskill-refresh-env",
      "/usr/local/bin/upskill-refresh-env",
      "systemctl start nginx",
    );

    const instance = new Instance(this, "ApplicationInstance", {
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      securityGroup: props.applicationSecurityGroup,
      machineImage: MachineImage.latestAmazonLinux2023({
        cpuType: AmazonLinuxCpuType.ARM_64,
      }),
      instanceType: new InstanceType(props.config.instanceType),
      role,
      userData,
      requireImdsv2: true,
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: BlockDeviceVolume.ebs(20, {
            encrypted: true,
            volumeType: EbsDeviceVolumeType.GP3,
          }),
        },
      ],
    });
    instance.node.addDependency(recordingUploadRoleParameter);
    instance.node.addDependency(recordingAccessGrantsAccountParameter);
    instance.node.addDependency(liveKitApprovedMonthlySpendParameter);
    if (offlineScormPackageHostSuffixParameter)
      instance.node.addDependency(offlineScormPackageHostSuffixParameter);
    this.instanceId = instance.instanceId;
    Tags.of(instance).add("Application", "upskill");
    Tags.of(instance).add("Environment", props.config.name);
    const elasticIp = new CfnEIP(this, "ApplicationElasticIp", {
      domain: "vpc",
    });
    new CfnEIPAssociation(this, "ApplicationElasticIpAssociation", {
      allocationId: elasticIp.attrAllocationId,
      instanceId: instance.instanceId,
    });
    if (props.config.offlineScormPackageHost)
      new CfnRecordSet(this, "OfflineScormPackageWildcardRecord", {
        hostedZoneId: props.config.offlineScormPackageHost.hostedZoneId,
        name: `*.${props.config.offlineScormPackageHost.suffix}`,
        type: "A",
        ttl: "60",
        resourceRecords: [elasticIp.attrPublicIp],
      });
    const statusAlarm = new Alarm(this, "ApplicationStatusAlarm", {
      alarmName: `upskill-${props.config.name}-application-status`,
      metric: new Metric({
        namespace: "AWS/EC2",
        metricName: "StatusCheckFailed",
        dimensionsMap: { InstanceId: instance.instanceId },
        period: Duration.minutes(1),
        statistic: "Maximum",
      }),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.BREACHING,
    });
    const cpuAlarm = new Alarm(this, "ApplicationCpuAlarm", {
      alarmName: `upskill-${props.config.name}-application-cpu`,
      metric: new Metric({
        namespace: "AWS/EC2",
        metricName: "CPUUtilization",
        dimensionsMap: { InstanceId: instance.instanceId },
        period: Duration.minutes(5),
        statistic: "Average",
      }),
      threshold: 90,
      evaluationPeriods: 3,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    statusAlarm.addAlarmAction(new SnsAction(props.alarmTopic));
    cpuAlarm.addAlarmAction(new SnsAction(props.alarmTopic));
    const customMetric = (metricName: string) =>
      new Metric({
        namespace: "Upskill",
        metricName,
        dimensionsMap: { Environment: props.config.name },
        period: Duration.minutes(5),
        statistic: "Maximum",
      });
    const readinessAlarm = new Alarm(this, "ApplicationReadinessAlarm", {
      alarmName: `upskill-${props.config.name}-application-readiness`,
      metric: customMetric("ApplicationReady"),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.BREACHING,
    });
    const workerAlarm = new Alarm(this, "WorkerHeartbeatAlarm", {
      alarmName: `upskill-${props.config.name}-worker-heartbeat`,
      metric: customMetric("WorkerActive"),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.BREACHING,
    });
    const outboxAgeAlarm = new Alarm(this, "OutboxAgeAlarm", {
      alarmName: `upskill-${props.config.name}-outbox-age`,
      metric: customMetric("OutboxOldestSeconds"),
      threshold: 900,
      evaluationPeriods: 2,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.BREACHING,
    });
    const uncertainDeliveryAlarm = new Alarm(this, "UncertainDeliveryAlarm", {
      alarmName: `upskill-${props.config.name}-uncertain-delivery`,
      metric: customMetric("UncertainDeliveries"),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.BREACHING,
    });
    const liveKitProviderAlarm = new Alarm(this, "LiveKitProviderAlarm", {
      alarmName: `upskill-${props.config.name}-livekit-provider-probe`,
      alarmDescription:
        "LiveKit operational probe failed; keep attendees in the application lobby and inspect provider status and credentials before retrying.",
      metric: customMetric("LiveKitProviderAvailable"),
      threshold: 1,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    const liveKitQuotaAlarm = new Alarm(this, "LiveKitQuotaAlarm", {
      alarmName: `upskill-${props.config.name}-livekit-quota-exhausted`,
      alarmDescription:
        "LiveKit reached an approved capacity boundary or denied capacity; inspect provider quotas and active rooms, participants and Egress before starting more sessions.",
      metric: customMetric("LiveKitQuotaExhausted"),
      threshold: 1,
      evaluationPeriods: 2,
      datapointsToAlarm: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    const liveKitParticipantAlarm = new Alarm(
      this,
      "LiveKitParticipantSaturationAlarm",
      {
        alarmName: `upskill-${props.config.name}-livekit-participant-saturation`,
        alarmDescription:
          "LiveKit concurrent participants reached 80% of the reviewed project limit; inspect active rooms and preserve headroom before admitting more attendees.",
        metric: customMetric("LiveKitParticipantUtilizationPercent"),
        threshold: 80,
        evaluationPeriods: 3,
        datapointsToAlarm: 2,
        comparisonOperator:
          ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      },
    );
    const liveKitRoomAlarm = new Alarm(
      this,
      "LiveKitConcurrentRoomSaturationAlarm",
      {
        alarmName: `upskill-${props.config.name}-livekit-room-saturation`,
        alarmDescription:
          "LiveKit active rooms reached 80% of the reviewed concurrent-room limit; inspect room lifecycle and provider capacity before starting more sessions.",
        metric: customMetric("LiveKitConcurrentRoomUtilizationPercent"),
        threshold: 80,
        evaluationPeriods: 3,
        datapointsToAlarm: 2,
        comparisonOperator:
          ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      },
    );
    const liveKitEgressAlarm = new Alarm(
      this,
      "LiveKitManagedEgressFailureAlarm",
      {
        alarmName: `upskill-${props.config.name}-livekit-egress-failure`,
        alarmDescription:
          "Managed LiveKit Egress failed in the last ten minutes; inspect the Event Operations recording failure and exact provider job before retrying.",
        metric: customMetric("LiveKitManagedEgressFailures"),
        threshold: 1,
        evaluationPeriods: 2,
        datapointsToAlarm: 1,
        comparisonOperator:
          ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      },
    );
    const liveKitSpendAlarm = new Alarm(this, "LiveKitApprovedSpendAlarm", {
      alarmName: `upskill-${props.config.name}-livekit-approved-spend`,
      alarmDescription:
        "Observed LiveKit month-to-date spend reached the reviewed AUD threshold; pause new LiveKit activation and publication while provider billing is reviewed.",
      metric: customMetric("LiveKitMonthlySpendAud"),
      threshold: props.config.liveKitApprovedMonthlySpendAud,
      evaluationPeriods: 2,
      datapointsToAlarm: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    const liveKitSpendFreshnessAlarm = new Alarm(
      this,
      "LiveKitSpendObservationFreshnessAlarm",
      {
        alarmName: `upskill-${props.config.name}-livekit-spend-observation-stale`,
        alarmDescription:
          "LiveKit spend evidence is missing, stale or for another billing month; refresh the root-owned observation from provider billing before routine use.",
        metric: customMetric("LiveKitSpendObservationFresh"),
        threshold: 1,
        evaluationPeriods: 2,
        datapointsToAlarm: 2,
        comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
      },
    );
    for (const alarm of [
      readinessAlarm,
      workerAlarm,
      outboxAgeAlarm,
      uncertainDeliveryAlarm,
      liveKitProviderAlarm,
      liveKitQuotaAlarm,
      liveKitParticipantAlarm,
      liveKitRoomAlarm,
      liveKitEgressAlarm,
      liveKitSpendAlarm,
      liveKitSpendFreshnessAlarm,
    ])
      alarm.addAlarmAction(new SnsAction(props.alarmTopic));
    new CfnOutput(this, "ApplicationInstanceId", {
      value: instance.instanceId,
    });
    new CfnOutput(this, "ApplicationPublicIp", {
      value: elasticIp.attrPublicIp,
    });
    new CfnOutput(this, "ApplicationConfigurationSecretArn", {
      value: configurationSecret.secretArn,
      description:
        "Replace the placeholder origins and Stripe values before the first deployment",
    });
    new CfnOutput(this, "AccessCodeEncryptionSecretArn", {
      value: accessCodeEncryptionSecret.secretArn,
      description:
        "Versioned application key for encrypted recoverable access codes",
    });
    new CfnOutput(this, "LiveKitConfigurationSecretArn", {
      value: liveKitConfigurationSecret.secretArn,
      description:
        "Populate environment-specific LiveKit credentials and approved quotas before enablement",
    });
    new CfnOutput(this, "OfflineScormConfigurationSecretArn", {
      value: offlineScormConfigurationSecret.secretArn,
      description:
        "Populate the P-256 signing authority only before deliberate offline SCORM activation",
    });
    if (props.config.offlineScormPackageHost)
      new CfnOutput(this, "OfflineScormPackageHostSuffix", {
        value: props.config.offlineScormPackageHost.suffix,
        description:
          "Dormant wildcard package host; do not enable offline SCORM until TLS and runtime configuration match",
      });
  }
}
