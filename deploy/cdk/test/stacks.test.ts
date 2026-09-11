import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { expect, test } from "vitest";
import { environmentConfig } from "../lib/config.js";
import { NetworkStack } from "../lib/network-stack.js";
import { StorageStack } from "../lib/storage-stack.js";
import { DataStack } from "../lib/data-stack.js";
import { ApplicationStack } from "../lib/application-stack.js";
import { DeploymentIdentityStack } from "../lib/deployment-identity-stack.js";
import { AccessGrantsStack } from "../lib/access-grants-stack.js";

test("shared S3 Access Grants foundation owns the account-region singleton", () => {
  const stack = new AccessGrantsStack(new App(), "AccessGrants");
  const template = Template.fromStack(stack);
  template.resourceCountIs("AWS::S3::AccessGrantsInstance", 1);
  const instances = template.findResources("AWS::S3::AccessGrantsInstance");
  expect(Object.values(instances)[0]).toMatchObject({
    DeletionPolicy: "Retain",
    UpdateReplacePolicy: "Retain",
  });
});

test("staging network has isolated data subnets", () => {
  const stack = new NetworkStack(
    new App(),
    "Network",
    environmentConfig("staging"),
  );
  const template = Template.fromStack(stack);
  template.resourceCountIs("AWS::EC2::Subnet", 4);
  template.resourceCountIs("AWS::EC2::NatGateway", 0);
});

test("staging storage is private, disposable and provides a dead-letter queue", () => {
  const stack = new StorageStack(
    new App(),
    "Storage",
    environmentConfig("staging"),
  );
  const template = Template.fromStack(stack);
  template.hasResourceProperties("AWS::S3::Bucket", {
    PublicAccessBlockConfiguration: Match.objectEquals({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    }),
  });
  template.resourceCountIs("AWS::S3::Bucket", 5);
  template.resourceCountIs("Custom::S3AutoDeleteObjects", 5);
  const buckets = template.findResources("AWS::S3::Bucket") as Record<
    string,
    {
      Properties?: {
        LifecycleConfiguration?: { Rules?: unknown[] };
      };
    }
  >;
  const recordingBucket = Object.entries(buckets).find(([logicalId]) =>
    logicalId.startsWith("RecordingBucket"),
  )?.[1];
  expect(recordingBucket).toBeDefined();
  expect(recordingBucket?.Properties).toMatchObject({
    BucketEncryption: {
      ServerSideEncryptionConfiguration: [
        { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
      ],
    },
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
    VersioningConfiguration: { Status: "Enabled" },
  });
  expect(recordingBucket?.Properties?.LifecycleConfiguration?.Rules).toEqual([
    {
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
      Status: "Enabled",
    },
  ]);
  for (const bucket of Object.values(
    template.findResources("AWS::S3::Bucket"),
  )) {
    expect(bucket.DeletionPolicy).toBe("Delete");
    expect(bucket.UpdateReplacePolicy).toBe("Delete");
  }
  template.resourceCountIs("AWS::SQS::Queue", 2);
  template.hasResourceProperties("AWS::SQS::Queue", {
    VisibilityTimeout: 900,
    RedrivePolicy: {
      deadLetterTargetArn: Match.anyValue(),
      maxReceiveCount: 5,
    },
  });
  template.resourceCountIs("AWS::CloudWatch::Alarm", 3);
  template.resourceCountIs("AWS::SNS::Topic", 1);
  template.resourceCountIs("AWS::SNS::Subscription", 1);
});

test("staging uses one low-cost ARM host and an isolated micro database", () => {
  const app = new App();
  const config = environmentConfig("staging");
  const network = new NetworkStack(app, "LowCostNetwork", config);
  const storage = new StorageStack(app, "LowCostStorage", config);
  const data = new DataStack(app, "LowCostData", {
    config,
    vpc: network.vpc,
    securityGroup: network.databaseSecurityGroup,
    alarmTopic: storage.alarmTopic,
  });
  const application = new ApplicationStack(app, "LowCostApplication", {
    config,
    vpc: network.vpc,
    applicationSecurityGroup: network.applicationSecurityGroup,
    artifactBucket: storage.artifactBucket,
    learningBucket: storage.learningBucket,
    privateBucket: storage.privateBucket,
    recordingBucket: storage.recordingBucket,
    quarantineBucket: storage.quarantineBucket,
    workQueue: storage.workQueue,
    deadLetterQueue: storage.deadLetterQueue,
    databaseSecretArn: data.database.secret?.secretArn ?? "missing",
    alarmTopic: storage.alarmTopic,
    accessGrantsInstanceArn:
      "arn:aws:s3:ap-southeast-2:123456789012:access-grants/default",
  });
  const deploymentIdentity = new DeploymentIdentityStack(
    app,
    "LowCostDeploymentIdentity",
    {
      owner: "code-studio-au",
      ownerId: "187219708",
      repository: "upskill",
      repositoryId: "1327543633",
      environment: "staging",
      artifactBucket: storage.artifactBucket,
    },
  );
  const applicationTemplate = Template.fromStack(application);
  applicationTemplate.resourceCountIs("AWS::EC2::Instance", 1);
  applicationTemplate.resourceCountIs("AWS::EC2::EIP", 1);
  applicationTemplate.resourceCountIs(
    "AWS::ElasticLoadBalancingV2::LoadBalancer",
    0,
  );
  applicationTemplate.resourceCountIs("AWS::AutoScaling::AutoScalingGroup", 0);
  applicationTemplate.hasResourceProperties("AWS::EC2::Instance", {
    InstanceType: "t4g.micro",
  });
  applicationTemplate.hasResourceProperties("AWS::EC2::LaunchTemplate", {
    LaunchTemplateData: { MetadataOptions: { HttpTokens: "required" } },
  });
  applicationTemplate.resourceCountIs("AWS::CloudWatch::Alarm", 6);
  applicationTemplate.resourceCountIs("AWS::SecretsManager::Secret", 5);
  applicationTemplate.hasResourceProperties("AWS::SecretsManager::Secret", {
    Name: "upskill/staging/livekit",
    Description: Match.stringLikeRegexp("Dormant LiveKit Cloud configuration"),
    SecretString: JSON.stringify({
      LIVEKIT_ENABLED: "false",
      LIVEKIT_PROJECT_ENVIRONMENT: "staging",
    }),
  });
  const secrets = applicationTemplate.findResources(
    "AWS::SecretsManager::Secret",
  ) as Record<
    string,
    {
      Properties?: {
        Name?: string;
        GenerateSecretString?: { SecretStringTemplate?: string };
      };
    }
  >;
  const applicationConfiguration = Object.values(secrets).find(
    (secret) => secret.Properties?.Name === "upskill/staging/application",
  );
  expect(applicationConfiguration).toBeDefined();
  expect(
    applicationConfiguration?.Properties?.GenerateSecretString
      ?.SecretStringTemplate,
  ).not.toContain("LIVEKIT_RECORDING_UPLOAD_ROLE_ARN");
  expect(
    applicationConfiguration?.Properties?.GenerateSecretString
      ?.SecretStringTemplate,
  ).not.toContain("LIVEKIT_RECORDING_ACCESS_GRANTS_ACCOUNT_ID");
  const applicationJson = JSON.stringify(applicationTemplate.toJSON());
  expect(applicationJson).toContain("sslmode=verify-full");
  expect(applicationJson).toContain("upskill-web.env");
  expect(applicationJson).toContain("upskill-worker.env");
  expect(applicationJson).toContain("upskill-deploy.env");
  expect(applicationJson).toContain("livekit_json");
  expect(applicationJson).toContain("upskill/staging/livekit");
  expect(applicationJson).toContain("S3_RECORDING_BUCKET");
  expect(applicationJson).toContain("LIVEKIT_RECORDING_UPLOAD_ROLE_ARN");
  expect(applicationJson).toContain(
    "LIVEKIT_RECORDING_ACCESS_GRANTS_ACCOUNT_ID",
  );
  const accessGrantsLocations = applicationTemplate.findResources(
    "AWS::S3::AccessGrantsLocation",
  );
  expect(Object.keys(accessGrantsLocations)).toHaveLength(1);
  expect(JSON.stringify(accessGrantsLocations)).toContain("recordings/");
  applicationTemplate.hasResourceProperties("AWS::S3::AccessGrant", {
    Permission: "WRITE",
    Grantee: {
      GranteeType: "IAM",
      GranteeIdentifier: Match.anyValue(),
    },
  });
  applicationTemplate.hasResourceProperties("AWS::IAM::Role", {
    Description:
      "S3 Access Grants location role for scoped LiveKit recording uploads",
    MaxSessionDuration: 43_200,
    AssumeRolePolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: "sts:AssumeRole",
          Condition: {
            StringEquals: {
              "aws:SourceAccount": { Ref: "AWS::AccountId" },
              "aws:SourceArn":
                "arn:aws:s3:ap-southeast-2:123456789012:access-grants/default",
            },
          },
          Principal: { Service: "access-grants.s3.amazonaws.com" },
        }),
        Match.objectLike({ Action: "sts:SetSourceIdentity" }),
      ]),
    },
  });
  applicationTemplate.hasResourceProperties("AWS::IAM::Role", {
    Description:
      "Dormant short-session role for exact-object LiveKit recording uploads",
    MaxSessionDuration: 3600,
  });
  const roles = applicationTemplate.findResources("AWS::IAM::Role");
  const instanceRoleLogicalId = Object.keys(roles).find((logicalId) =>
    logicalId.startsWith("InstanceRole"),
  );
  const recordingRoleLogicalId = Object.keys(roles).find((logicalId) =>
    logicalId.startsWith("RecordingUploadRole"),
  );
  const recordingAccessGrantsLocationRoleLogicalId = Object.keys(roles).find(
    (logicalId) => logicalId.startsWith("RecordingAccessGrantsLocationRole"),
  );
  expect(instanceRoleLogicalId).toBeDefined();
  expect(recordingRoleLogicalId).toBeDefined();
  expect(recordingAccessGrantsLocationRoleLogicalId).toBeDefined();
  if (!recordingRoleLogicalId)
    throw new Error("Expected the recording upload role in the template");
  applicationTemplate.hasResourceProperties("AWS::SSM::Parameter", {
    Name: "/upskill/staging/livekit/recording-upload-role-arn",
    Type: "String",
    Value: { "Fn::GetAtt": [recordingRoleLogicalId, "Arn"] },
  });
  applicationTemplate.hasResourceProperties("AWS::SSM::Parameter", {
    Name: "/upskill/staging/livekit/recording-access-grants-account-id",
    Type: "String",
    Value: { Ref: "AWS::AccountId" },
  });
  const parameters = applicationTemplate.findResources(
    "AWS::SSM::Parameter",
  ) as Record<string, { Properties?: { Name?: string } }>;
  const recordingRoleParameterLogicalId = Object.keys(parameters).find(
    (logicalId) =>
      parameters[logicalId]?.Properties?.Name ===
      "/upskill/staging/livekit/recording-upload-role-arn",
  );
  expect(recordingRoleParameterLogicalId).toBeDefined();
  if (!recordingRoleParameterLogicalId)
    throw new Error("Expected the recording upload role parameter");
  const instances = applicationTemplate.findResources(
    "AWS::EC2::Instance",
  ) as Record<string, { DependsOn?: string[] }>;
  const applicationInstance = Object.values(instances)[0];
  expect(applicationInstance?.DependsOn).toContain(
    recordingRoleParameterLogicalId,
  );
  const recordingAccountParameterLogicalId = Object.keys(parameters).find(
    (logicalId) =>
      parameters[logicalId]?.Properties?.Name ===
      "/upskill/staging/livekit/recording-access-grants-account-id",
  );
  expect(recordingAccountParameterLogicalId).toBeDefined();
  expect(applicationInstance?.DependsOn).toContain(
    recordingAccountParameterLogicalId,
  );
  const policies = applicationTemplate.findResources(
    "AWS::IAM::Policy",
  ) as Record<
    string,
    {
      Properties: {
        PolicyDocument: { Statement: unknown[] };
        Roles: unknown[];
      };
    }
  >;
  const recordingWritePolicy = Object.values(policies).find((policy) => {
    const serialized = JSON.stringify(policy);
    return (
      policy.Properties.Roles.some(
        (role) =>
          JSON.stringify(role) ===
          JSON.stringify({ Ref: recordingRoleLogicalId }),
      ) &&
      serialized.includes("s3:PutObject") &&
      serialized.includes("RecordingBucket")
    );
  });
  expect(recordingWritePolicy).toMatchObject({
    Properties: {
      Roles: [{ Ref: recordingRoleLogicalId }],
      PolicyDocument: {
        Statement: [
          {
            Action: "s3:PutObject",
            Effect: "Allow",
          },
        ],
      },
    },
  });
  expect(JSON.stringify(recordingWritePolicy)).toContain("recordings/*");
  expect(JSON.stringify(recordingWritePolicy)).not.toMatch(
    /s3:(?:GetObject|DeleteObject|ListBucket)/u,
  );
  const recordingReadPolicy = Object.values(policies).find((policy) => {
    const serialized = JSON.stringify(policy);
    return (
      policy.Properties.Roles.some(
        (role) =>
          JSON.stringify(role) ===
          JSON.stringify({ Ref: instanceRoleLogicalId }),
      ) &&
      serialized.includes("s3:GetObject") &&
      serialized.includes("RecordingBucket")
    );
  });
  expect(recordingReadPolicy?.Properties.Roles).toEqual([
    { Ref: instanceRoleLogicalId },
  ]);
  const recordingReadStatement =
    recordingReadPolicy?.Properties.PolicyDocument.Statement.find(
      (statement) =>
        JSON.stringify(statement).includes("s3:GetObject") &&
        JSON.stringify(statement).includes("RecordingBucket"),
    );
  expect(recordingReadStatement).toMatchObject({
    Action: "s3:GetObject",
    Effect: "Allow",
  });
  expect(JSON.stringify(recordingReadStatement)).toContain("recordings/*");
  expect(JSON.stringify(recordingReadStatement)).not.toMatch(
    /s3:(?:DeleteObject|ListBucket)/u,
  );
  const accessGrantsLocationWritePolicy = Object.values(policies).find(
    (policy) =>
      policy.Properties.Roles.some(
        (attachedRole) =>
          JSON.stringify(attachedRole) ===
          JSON.stringify({ Ref: recordingAccessGrantsLocationRoleLogicalId }),
      ),
  );
  expect(
    accessGrantsLocationWritePolicy?.Properties.PolicyDocument.Statement,
  ).toEqual([
    expect.objectContaining({
      Action: "s3:PutObject",
      Effect: "Allow",
    }),
  ]);
  expect(JSON.stringify(accessGrantsLocationWritePolicy)).toContain(
    "recordings/*",
  );
  expect(JSON.stringify(accessGrantsLocationWritePolicy)).not.toMatch(
    /s3:(?:GetObject|DeleteObject|ListBucket)/u,
  );
  const getDataAccessPolicy = Object.values(policies).find((policy) =>
    JSON.stringify(policy).includes("s3:GetDataAccess"),
  );
  expect(getDataAccessPolicy?.Properties.Roles).toEqual([
    { Ref: instanceRoleLogicalId },
  ]);
  expect(getDataAccessPolicy?.Properties.PolicyDocument.Statement).toEqual(
    expect.arrayContaining([
      {
        Action: "s3:GetDataAccess",
        Effect: "Allow",
        Resource:
          "arn:aws:s3:ap-southeast-2:123456789012:access-grants/default",
      },
    ]),
  );
  const recordingAssumePolicy = Object.values(policies).find((policy) => {
    const serialized = JSON.stringify(policy);
    return (
      serialized.includes("sts:AssumeRole") &&
      serialized.includes("RecordingUploadRole")
    );
  });
  expect(recordingAssumePolicy?.Properties.Roles).toEqual([
    { Ref: instanceRoleLogicalId },
  ]);
  expect(recordingAssumePolicy?.Properties.PolicyDocument.Statement).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        Action: "sts:AssumeRole",
        Effect: "Allow",
      }),
    ]),
  );
  const recordingRoleParameterReadPolicy = Object.values(policies).find(
    (policy) => {
      const serialized = JSON.stringify(policy);
      return (
        serialized.includes("ssm:GetParameter") &&
        serialized.includes("RecordingUploadRoleParameter")
      );
    },
  );
  expect(recordingRoleParameterReadPolicy?.Properties.Roles).toEqual([
    { Ref: instanceRoleLogicalId },
  ]);
  expect(JSON.stringify(recordingRoleParameterReadPolicy)).toContain(
    "RecordingAccessGrantsAccountParameter",
  );
  expect(
    recordingRoleParameterReadPolicy?.Properties.PolicyDocument.Statement,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        Action: "ssm:GetParameter",
        Effect: "Allow",
      }),
    ]),
  );
  expect(JSON.stringify(recordingRoleParameterReadPolicy)).not.toMatch(
    /ssm:(?:DescribeParameters|GetParameterHistory|GetParameters\b)/u,
  );
  expect(applicationJson).toContain(
    '.key == \\"LIVEKIT_APPROVED_MAX_CONCURRENT_ROOMS\\"',
  );
  expect(applicationJson).toContain("/swapfile");
  expect(applicationJson).toContain("dnf install -y jq libatomic nginx xz");
  expect(applicationJson).toContain(
    "npm install --global pnpm@11.0.8 --prefix /usr/local --ignore-scripts",
  );
  expect(applicationJson).not.toContain("corepack enable pnpm");
  expect(applicationJson).toContain("jq -rn --arg value");
  expect(applicationJson).not.toContain("jq -Rn --arg value");
  const deploymentIdentityTemplate = Template.fromStack(deploymentIdentity);
  deploymentIdentityTemplate.resourceCountIs("AWS::IAM::OIDCProvider", 0);
  expect(JSON.stringify(deploymentIdentityTemplate.toJSON())).toContain(
    "oidc-provider/token.actions.githubusercontent.com",
  );
  deploymentIdentityTemplate.hasResourceProperties("AWS::IAM::Role", {
    AssumeRolePolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Condition: {
            StringEquals: {
              "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
              "token.actions.githubusercontent.com:sub":
                "repo:code-studio-au@187219708/upskill@1327543633:environment:staging",
            },
          },
        }),
      ]),
    },
  });
  deploymentIdentityTemplate.hasResourceProperties("AWS::IAM::Policy", {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: "ssm:SendCommand",
          Condition: {
            StringEquals: {
              "ssm:resourceTag/Application": "upskill",
              "ssm:resourceTag/Environment": "staging",
            },
          },
        }),
      ]),
    },
  });
  const deploymentIdentityJson = JSON.stringify(
    deploymentIdentityTemplate.toJSON(),
  );
  expect(deploymentIdentityJson).not.toContain("LowCostApplication");
  expect(deploymentIdentityJson).toContain("AWS-RunShellScript");
  Template.fromStack(data).hasResourceProperties("AWS::RDS::DBInstance", {
    DBInstanceClass: "db.t4g.micro",
    AllocatedStorage: "20",
    BackupRetentionPeriod: 7,
    MultiAZ: false,
    PubliclyAccessible: false,
    StorageEncrypted: true,
  });
  Template.fromStack(data).hasResourceProperties("AWS::RDS::DBParameterGroup", {
    Parameters: { "rds.force_ssl": "1" },
  });
});

test("production storage alarms on durable work backlog and dead letters", () => {
  const stack = new StorageStack(
    new App(),
    "ProductionStorage",
    environmentConfig("production"),
  );
  const template = Template.fromStack(stack);
  template.resourceCountIs("AWS::S3::Bucket", 5);
  template.resourceCountIs("Custom::S3AutoDeleteObjects", 0);
  for (const bucket of Object.values(
    template.findResources("AWS::S3::Bucket"),
  )) {
    expect(bucket.DeletionPolicy).toBe("Retain");
    expect(bucket.UpdateReplacePolicy).toBe("Retain");
  }
  template.resourceCountIs("AWS::CloudWatch::Alarm", 3);
  template.hasResourceProperties("AWS::CloudWatch::Alarm", {
    AlarmName: "upskill-production-work-queue-oldest-message",
    Threshold: 900,
    EvaluationPeriods: 2,
  });
  template.hasResourceProperties("AWS::CloudWatch::Alarm", {
    AlarmName: "upskill-production-work-queue-backlog",
    Threshold: 100,
    EvaluationPeriods: 2,
  });
  template.hasResourceProperties("AWS::CloudWatch::Alarm", {
    AlarmName: "upskill-production-work-dead-letter-queue",
    Threshold: 1,
    EvaluationPeriods: 1,
  });
});
