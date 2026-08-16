import { CfnOutput, Stack, Tags, type StackProps } from "aws-cdk-lib";
import { AutoScalingGroup, UpdatePolicy } from "aws-cdk-lib/aws-autoscaling";
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ListenerAction,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import {
  InstanceClass,
  InstanceSize,
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
import type { Bucket } from "aws-cdk-lib/aws-s3";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import type { Queue } from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";
import type { EnvironmentConfig } from "./config.js";

export interface ApplicationStackProps extends StackProps {
  config: EnvironmentConfig;
  vpc: Vpc;
  loadBalancerSecurityGroup: SecurityGroup;
  applicationSecurityGroup: SecurityGroup;
  artifactBucket: Bucket;
  learningBucket: Bucket;
  privateBucket: Bucket;
  quarantineBucket: Bucket;
  workQueue: Queue;
  databaseSecretArn: string;
  certificateArn?: string;
}

export class ApplicationStack extends Stack {
  constructor(scope: Construct, id: string, props: ApplicationStackProps) {
    super(scope, id, props);
    const role = new Role(this, "InstanceRole", {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
      ],
    });
    const configurationSecret = new Secret(this, "ApplicationConfiguration", {
      secretName: `upskill/${props.config.name}/application`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          APP_ENV: props.config.name,
          UPSKILL_LOG_LEVEL: "info",
          UPSKILL_TRUST_PROXY: "true",
          APP_ORIGIN: `https://${props.config.name}.example.invalid`,
          LEARNING_ORIGIN: `https://learn-${props.config.name}.example.invalid`,
          STRIPE_SECRET_KEY: "sk_live_REPLACE_BEFORE_DEPLOY",
          STRIPE_WEBHOOK_SECRET: "whsec_REPLACE_BEFORE_DEPLOY",
          EMAIL_PROVIDER: "mailgun",
          MAILGUN_API_KEY: "REPLACE_WITH_DOMAIN_SENDING_KEY",
          MAILGUN_DOMAIN: "REPLACE_WITH_SENDING_DOMAIN",
          MAILGUN_FROM: "Upskill <no-reply@REPLACE_WITH_SENDING_DOMAIN>",
          MAILGUN_API_BASE_URL: "https://api.mailgun.net",
          AWS_REGION: this.region,
          S3_QUARANTINE_BUCKET: props.quarantineBucket.bucketName,
          S3_LEARNING_CONTENT_BUCKET: props.learningBucket.bucketName,
          S3_PRIVATE_RESOURCES_BUCKET: props.privateBucket.bucketName,
          SQS_QUEUE_URL: props.workQueue.queueUrl,
          SQS_RECEIVE_WAIT_SECONDS: "20",
          SQS_VISIBILITY_TIMEOUT_SECONDS: "900",
          NODE_ENV: "production",
        }),
        generateStringKey: "BETTER_AUTH_SECRET",
        passwordLength: 48,
        excludePunctuation: true,
      },
    });
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
    props.artifactBucket.grantRead(role);
    props.learningBucket.grantReadWrite(role);
    props.privateBucket.grantReadWrite(role);
    props.quarantineBucket.grantReadWrite(role);
    props.workQueue.grantConsumeMessages(role);
    props.workQueue.grantSendMessages(role);
    configurationSecret.grantRead(role);
    accessCodeEncryptionSecret.grantRead(role);
    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["secretsmanager:GetSecretValue"],
        resources: [props.databaseSecretArn],
      }),
    );

    const userData = UserData.forLinux();
    userData.addCommands(
      "dnf install -y jq nginx",
      "systemctl enable nginx",
      "mkdir -p /opt/upskill/releases /opt/upskill/shared",
      "chown -R ec2-user:ec2-user /opt/upskill",
      `cat > /usr/local/bin/upskill-refresh-env <<'UPSKILL_ENV'
#!/usr/bin/env bash
set -euo pipefail
application_json=$(aws secretsmanager get-secret-value --region ${this.region} --secret-id '${configurationSecret.secretArn}' --query SecretString --output text)
database_json=$(aws secretsmanager get-secret-value --region ${this.region} --secret-id '${props.databaseSecretArn}' --query SecretString --output text)
access_code_encryption_key=$(aws secretsmanager get-secret-value --region ${this.region} --secret-id '${accessCodeEncryptionSecret.secretArn}' --query SecretString --output text)
environment_tmp=$(mktemp)
jq -r 'to_entries[] | "\\(.key)=\\(.value|tostring|@json)"' <<< "$application_json" > "$environment_tmp"
database_url=$(jq -r '"postgresql://\\(.username|@uri):\\(.password|@uri)@\\(.host):\\(.port)/\\(.dbname)"' <<< "$database_json")
jq -Rn --arg value "$database_url" '"DATABASE_URL=\\($value|@json)"' >> "$environment_tmp"
jq -Rn --arg value "$access_code_encryption_key" '"ACCESS_CODE_ENCRYPTION_KEY=\\($value|@json)"' >> "$environment_tmp"
install -o ec2-user -g ec2-user -m 0600 "$environment_tmp" /opt/upskill/shared/upskill.env
rm -f "$environment_tmp"
UPSKILL_ENV`,
      "chmod 0755 /usr/local/bin/upskill-refresh-env",
      "/usr/local/bin/upskill-refresh-env",
      "systemctl start nginx",
    );

    const group = new AutoScalingGroup(this, "ApplicationGroup", {
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      securityGroup: props.applicationSecurityGroup,
      machineImage: MachineImage.resolveSsmParameterAtLaunch(
        "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64",
      ),
      instanceType: InstanceType.of(
        InstanceClass.BURSTABLE4_GRAVITON,
        InstanceSize.SMALL,
      ),
      role,
      userData,
      minCapacity: props.config.minCapacity,
      maxCapacity: props.config.maxCapacity,
      updatePolicy: UpdatePolicy.rollingUpdate(),
    });
    Tags.of(group).add("Application", "upskill");
    Tags.of(group).add("Environment", props.config.name);

    const loadBalancer = new ApplicationLoadBalancer(this, "LoadBalancer", {
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: props.loadBalancerSecurityGroup,
      dropInvalidHeaderFields: true,
    });
    const targetOptions = {
      port: 80,
      protocol: ApplicationProtocol.HTTP,
      targets: [group],
      healthCheck: { path: "/api/health" },
    };
    if (props.certificateArn) {
      const certificate = Certificate.fromCertificateArn(
        this,
        "Certificate",
        props.certificateArn,
      );
      const httpsListener = loadBalancer.addListener("HttpsListener", {
        port: 443,
        protocol: ApplicationProtocol.HTTPS,
        certificates: [certificate],
      });
      httpsListener.addTargets("ApplicationTargets", targetOptions);
      loadBalancer.addListener("HttpRedirect", {
        port: 80,
        protocol: ApplicationProtocol.HTTP,
        defaultAction: ListenerAction.redirect({
          protocol: "HTTPS",
          port: "443",
          permanent: true,
        }),
      });
    } else {
      const httpListener = loadBalancer.addListener("HttpListener", {
        port: 80,
        protocol: ApplicationProtocol.HTTP,
      });
      httpListener.addTargets("ApplicationTargets", targetOptions);
    }
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
  }
}
