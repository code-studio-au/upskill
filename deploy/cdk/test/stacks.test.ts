import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { expect, test } from "vitest";
import { environmentConfig } from "../lib/config.js";
import { NetworkStack } from "../lib/network-stack.js";
import { OfflineScormEdgeSecurityStack } from "../lib/offline-scorm-edge-security-stack.js";
import { StorageStack } from "../lib/storage-stack.js";
import { DataStack } from "../lib/data-stack.js";
import { ApplicationStack } from "../lib/application-stack.js";
import { DeploymentIdentityStack } from "../lib/deployment-identity-stack.js";
import { AccessGrantsStack } from "../lib/access-grants-stack.js";

test("LiveKit spend approval is explicit CDK context", () => {
  expect(environmentConfig("production").liveKitApprovedMonthlySpendAud).toBe(
    0,
  );
  expect(
    environmentConfig("production", "250").liveKitApprovedMonthlySpendAud,
  ).toBe(250);
  expect(() => environmentConfig("production", "0")).toThrow(
    "must be a positive number",
  );
});

test("offline SCORM package-host context is all-or-nothing and zone-bound", () => {
  expect(environmentConfig("staging").offlineScormPackageHost).toBeNull();
  expect(
    environmentConfig("staging", undefined, {
      suffix: "packages.example.net",
      hostedZoneId: "/hostedzone/Z123PACKAGE",
      hostedZoneName: "example.net",
    }).offlineScormPackageHost,
  ).toEqual({
    suffix: "packages.example.net",
    hostedZoneId: "Z123PACKAGE",
    hostedZoneName: "example.net",
  });
  expect(() =>
    environmentConfig("staging", undefined, {
      suffix: "packages.example.net",
      hostedZoneId: undefined,
      hostedZoneName: "example.net",
    }),
  ).toThrow("must be configured together");
  expect(() =>
    environmentConfig("staging", undefined, {
      suffix: "packages.example.net",
      hostedZoneId: "Z123PACKAGE",
      hostedZoneName: "another.example",
    }),
  ).toThrow("must belong");
});

test("offline SCORM CloudFront qualification requires explicit staging-only shared-host risk acceptance", () => {
  expect(
    environmentConfig("staging").offlineScormCloudFrontQualification,
  ).toBeNull();
  expect(() =>
    environmentConfig(
      "staging",
      undefined,
      undefined,
      "staging.upskill.institute",
    ),
  ).toThrow('must equal "staging-qualification-only"');
  expect(
    environmentConfig(
      "staging",
      undefined,
      undefined,
      "staging.upskill.institute",
      "staging-qualification-only",
    ).offlineScormCloudFrontQualification,
  ).toEqual({
    maxEntitlementDistributions: 25,
    originDomain: "staging.upskill.institute",
    sharedHostRiskAcceptance: "staging-qualification-only",
  });
  expect(() =>
    environmentConfig(
      "production",
      undefined,
      undefined,
      "upskill.institute",
      "staging-qualification-only",
    ),
  ).toThrow("production requires a distinct worker AWS principal");
  expect(() =>
    environmentConfig(
      "staging",
      undefined,
      undefined,
      undefined,
      "staging-qualification-only",
    ),
  ).toThrow("is only valid with offlineScormCloudFrontOriginDomain");
  expect(() =>
    environmentConfig(
      "staging",
      undefined,
      undefined,
      "D123.cloudfront.net",
      "staging-qualification-only",
    ),
  ).toThrow("canonical lowercase DNS");
  expect(() =>
    environmentConfig(
      "staging",
      undefined,
      undefined,
      "d123.cloudfront.net",
      "staging-qualification-only",
    ),
  ).toThrow("must not chain");
});

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
  template.resourceCountIs("AWS::S3::Bucket", 6);
  template.resourceCountIs("Custom::S3AutoDeleteObjects", 6);
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
  template.hasResourceProperties("AWS::SNS::TopicPolicy", {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: "sns:Publish",
          Condition: {
            ArnLike: { "aws:SourceArn": Match.anyValue() },
            StringEquals: { "aws:SourceAccount": Match.anyValue() },
          },
          Effect: "Allow",
          Principal: { Service: "cloudwatch.amazonaws.com" },
          Resource: Match.anyValue(),
        }),
      ]),
    },
  });
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
    offlineScormEdgeLogBucket: storage.offlineScormEdgeLogBucket,
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
  applicationTemplate.resourceCountIs("AWS::Route53::RecordSet", 1);
  const applicationResources = applicationTemplate.toJSON().Resources as Record<
    string,
    unknown
  >;
  expect(
    applicationResources["OfflineScormPackageHostSuffixParameterD8F46799"],
  ).toMatchObject({
    Condition: "RetainLegacyOfflineScormPackageHostResources",
    DeletionPolicy: "Retain",
    UpdateReplacePolicy: "Retain",
  });
  expect(
    applicationResources["OfflineScormPackageWildcardRecord"],
  ).toMatchObject({
    Condition: "RetainLegacyOfflineScormPackageHostResources",
    DeletionPolicy: "Retain",
    UpdateReplacePolicy: "Retain",
  });
  applicationTemplate.hasResourceProperties(
    "Custom::OfflineScormPackageHostLifecycle",
    {
      HostedZoneId: "",
      LifecycleVersion: "2",
      Suffix: "",
      PublicIp: "",
      ParameterName: "/upskill/staging/offline-scorm/package-host-suffix",
    },
  );
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
  applicationTemplate.resourceCountIs("AWS::CloudWatch::Alarm", 13);
  applicationTemplate.resourceCountIs("AWS::SecretsManager::Secret", 7);
  expect(JSON.stringify(applicationTemplate.toJSON())).not.toContain(
    "cloudfront:CreateDistributionWithTags",
  );
  applicationTemplate.resourcePropertiesCountIs(
    "AWS::SSM::Parameter",
    {
      Name: "/upskill/staging/offline-scorm/cloudfront-allocator-function-name",
    },
    0,
  );
  applicationTemplate.hasResourceProperties("AWS::SecretsManager::Secret", {
    Name: "upskill/staging/livekit",
    Description: Match.stringLikeRegexp("Dormant LiveKit Cloud configuration"),
    SecretString: JSON.stringify({
      LIVEKIT_ENABLED: "false",
      LIVEKIT_PROJECT_ENVIRONMENT: "staging",
    }),
  });
  applicationTemplate.hasResourceProperties("AWS::SecretsManager::Secret", {
    Name: "upskill/staging/offline-scorm",
    Description: Match.stringLikeRegexp(
      "Dormant offline SCORM signing and exact-site allocation authority",
    ),
    SecretString: JSON.stringify({ OFFLINE_SCORM_ENABLED: "false" }),
  });
  applicationTemplate.hasResourceProperties("AWS::SecretsManager::Secret", {
    Name: "upskill/staging/offline-scorm/cloudfront-origin-key",
    Description: Match.stringLikeRegexp("qualification toggles"),
    GenerateSecretString: {
      ExcludePunctuation: true,
      PasswordLength: 64,
    },
  });
  applicationTemplate.hasOutput("OfflineScormCloudFrontOriginKeySecretArn", {
    Description:
      "Read-only qualification binding for the CloudFront origin capability authority",
    Value: { Ref: Match.anyValue() },
  });
  applicationTemplate.hasOutput("OfflineScormEdgeLogBucketArn", {
    Description:
      "Stable cross-stack binding retained across CloudFront qualification toggles",
    Value: { "Fn::ImportValue": Match.anyValue() },
  });
  applicationTemplate.hasOutput("OfflineScormEdgeLogBucketDomain", {
    Description:
      "Stable cross-stack binding retained across CloudFront qualification toggles",
    Value: { "Fn::ImportValue": Match.anyValue() },
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
  expect(applicationJson).toContain("offline_scorm_json");
  expect(applicationJson).toContain("upskill/staging/offline-scorm");
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
    AccessGrantsLocationConfiguration: { S3SubPrefix: "*" },
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
  const liveKitSpendParameterLogicalId = Object.keys(parameters).find(
    (logicalId) =>
      parameters[logicalId]?.Properties?.Name ===
      "/upskill/staging/livekit/approved-monthly-spend-aud",
  );
  expect(liveKitSpendParameterLogicalId).toBeDefined();
  expect(applicationInstance?.DependsOn).toContain(
    liveKitSpendParameterLogicalId,
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
      serialized.includes("s3:DeleteObjectVersion") &&
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
    Action: ["s3:GetObject", "s3:DeleteObject", "s3:DeleteObjectVersion"],
    Effect: "Allow",
  });
  expect(JSON.stringify(recordingReadStatement)).toContain("recordings/*");
  const recordingVersionListStatement =
    recordingReadPolicy?.Properties.PolicyDocument.Statement.find((statement) =>
      JSON.stringify(statement).includes("s3:ListBucketVersions"),
    );
  expect(recordingVersionListStatement).toMatchObject({
    Action: "s3:ListBucketVersions",
    Effect: "Allow",
    Condition: { StringLike: { "s3:prefix": ["recordings/*"] } },
  });
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
  expect(JSON.stringify(recordingRoleParameterReadPolicy)).toContain(
    "LiveKitApprovedMonthlySpendParameter",
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
  expect(applicationJson).toContain(
    '.key == \\"LIVEKIT_APPROVED_MAX_CONCURRENT_PARTICIPANTS\\"',
  );
  expect(applicationJson).toContain(
    '.key == \\"LIVEKIT_APPROVED_MAX_CONCURRENT_EGRESS_JOBS\\"',
  );
  applicationTemplate.hasResourceProperties("AWS::SSM::Parameter", {
    Name: "/upskill/staging/livekit/approved-monthly-spend-aud",
    Type: "String",
    Value: "0",
  });
  expect(applicationJson).toContain("LIVEKIT_APPROVED_MONTHLY_SPEND_AUD");
  for (const [alarmName, metricName, threshold] of [
    ["upskill-staging-livekit-provider-probe", "LiveKitProviderAvailable", 1],
    ["upskill-staging-livekit-quota-exhausted", "LiveKitQuotaExhausted", 1],
    [
      "upskill-staging-livekit-participant-saturation",
      "LiveKitParticipantUtilizationPercent",
      80,
    ],
    [
      "upskill-staging-livekit-room-saturation",
      "LiveKitConcurrentRoomUtilizationPercent",
      80,
    ],
    [
      "upskill-staging-livekit-egress-failure",
      "LiveKitManagedEgressFailures",
      1,
    ],
    ["upskill-staging-livekit-approved-spend", "LiveKitMonthlySpendAud", 0],
    [
      "upskill-staging-livekit-spend-observation-stale",
      "LiveKitSpendObservationFresh",
      1,
    ],
  ] as const)
    applicationTemplate.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: alarmName,
      Namespace: "Upskill",
      MetricName: metricName,
      Threshold: threshold,
      AlarmActions: Match.anyValue(),
    });
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

test("provisioned offline SCORM host retires the vhost before managed DNS and SSM changes", () => {
  const app = new App();
  const config = environmentConfig("staging", undefined, {
    suffix: "packages.example.net",
    hostedZoneId: "Z123PACKAGE",
    hostedZoneName: "example.net",
  });
  const network = new NetworkStack(app, "PackageHostNetwork", config);
  const storage = new StorageStack(app, "PackageHostStorage", config);
  const application = new ApplicationStack(app, "PackageHostApplication", {
    config,
    vpc: network.vpc,
    applicationSecurityGroup: network.applicationSecurityGroup,
    artifactBucket: storage.artifactBucket,
    offlineScormEdgeLogBucket: storage.offlineScormEdgeLogBucket,
    learningBucket: storage.learningBucket,
    privateBucket: storage.privateBucket,
    recordingBucket: storage.recordingBucket,
    quarantineBucket: storage.quarantineBucket,
    workQueue: storage.workQueue,
    deadLetterQueue: storage.deadLetterQueue,
    databaseSecretArn:
      "arn:aws:secretsmanager:ap-southeast-2:123456789012:secret:database",
    alarmTopic: storage.alarmTopic,
    accessGrantsInstanceArn:
      "arn:aws:s3:ap-southeast-2:123456789012:access-grants/default",
  });
  const template = Template.fromStack(application);

  template.hasResourceProperties("Custom::OfflineScormPackageHostLifecycle", {
    HostedZoneId: "Z123PACKAGE",
    LifecycleVersion: "2",
    Suffix: "packages.example.net",
    PublicIp: Match.anyValue(),
    InstanceId: Match.anyValue(),
    ParameterName: "/upskill/staging/offline-scorm/package-host-suffix",
  });
  const serialized = JSON.stringify(template.toJSON());
  expect(serialized).toContain("OFFLINE_SCORM_PACKAGE_HOST_SUFFIX");
  expect(serialized).toContain("AWS-RunShellScript");
  expect(serialized).toContain("ssm:resourceTag/Application");
  expect(serialized).toContain("ssm:resourceTag/Environment");
  expect(serialized).toContain("ssm:GetCommandInvocation");
  expect(serialized).toContain("ssm:PutParameter");
  expect(serialized).toContain("ssm:DeleteParameter");
  expect(serialized).toContain("route53:ChangeResourceRecordSets");
  expect(serialized).toContain("route53:ListResourceRecordSets");
  expect(serialized).toContain("route53:ChangeResourceRecordSetsRecordTypes");
  expect(serialized).toContain("route53:ChangeResourceRecordSetsActions");
  expect(serialized).not.toContain("route53:*");
});

test("CloudFront entitlement qualification has a global WAF baseline", () => {
  const config = environmentConfig(
    "staging",
    undefined,
    undefined,
    "staging.upskill.institute",
    "staging-qualification-only",
  );
  const stack = new OfflineScormEdgeSecurityStack(
    new App(),
    "CloudFrontEdgeSecurity",
    {
      config,
      env: { account: "123456789012", region: "us-east-1" },
    },
  );
  const template = Template.fromStack(stack);

  template.resourceCountIs("AWS::WAFv2::WebACL", 1);
  template.hasResourceProperties("AWS::WAFv2::WebACL", {
    Name: "upskill-staging-offline-scorm-cloudfront",
    Scope: "CLOUDFRONT",
    Tags: Match.arrayWith([
      { Key: "Application", Value: "upskill" },
      { Key: "Environment", Value: "staging" },
      { Key: "Purpose", Value: "offline-scorm-qualification" },
    ]),
    DefaultAction: { Allow: {} },
    Rules: Match.arrayWith([
      Match.objectLike({
        Name: "aws-managed-ip-reputation",
        Priority: 0,
        OverrideAction: { None: {} },
        Statement: {
          ManagedRuleGroupStatement: {
            Name: "AWSManagedRulesAmazonIpReputationList",
            VendorName: "AWS",
          },
        },
      }),
      Match.objectLike({
        Name: "aws-managed-common-protections-qualification",
        Priority: 1,
        OverrideAction: { Count: {} },
        Statement: {
          ManagedRuleGroupStatement: {
            Name: "AWSManagedRulesCommonRuleSet",
            VendorName: "AWS",
          },
        },
      }),
      Match.objectLike({
        Name: "per-ip-request-rate",
        Priority: 2,
        Action: { Block: {} },
        Statement: {
          RateBasedStatement: {
            AggregateKeyType: "IP",
            EvaluationWindowSec: 300,
            Limit: 2_000,
          },
        },
      }),
    ]),
  });
  template.hasResourceProperties("AWS::Logs::LogGroup", {
    LogGroupName: "aws-waf-logs-upskill-staging-offline-scorm-cloudfront",
    RetentionInDays: 30,
  });
  template.hasResourceProperties("AWS::WAFv2::LoggingConfiguration", {
    LoggingFilter: {
      DefaultBehavior: "DROP",
      Filters: [
        {
          Behavior: "KEEP",
          Conditions: [
            { ActionCondition: { Action: "BLOCK" } },
            { ActionCondition: { Action: "COUNT" } },
          ],
          Requirement: "MEETS_ANY",
        },
      ],
    },
    RedactedFields: [
      { SingleHeader: { Name: "authorization" } },
      { SingleHeader: { Name: "cookie" } },
      { QueryString: {} },
    ],
  });
  template.hasResourceProperties("AWS::CloudWatch::Alarm", {
    AlarmName: "upskill-staging-offline-scorm-waf-blocked-requests",
    Namespace: "AWS/WAFV2",
    MetricName: "BlockedRequests",
    Period: 300,
    Threshold: 100,
  });
  template.hasResourceProperties("AWS::KMS::Key", {
    Description:
      "Encrypts Upskill staging Offline SCORM edge alarm notifications",
    EnableKeyRotation: true,
    KeyPolicy: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: ["kms:GenerateDataKey*", "kms:Decrypt"],
          Condition: {
            ArnLike: {
              "aws:SourceArn": Match.anyValue(),
            },
            StringEquals: { "aws:SourceAccount": "123456789012" },
          },
          Effect: "Allow",
          Principal: { Service: "cloudwatch.amazonaws.com" },
          Resource: "*",
        }),
      ]),
    },
  });
  template.hasResourceProperties("AWS::SNS::Subscription", {
    Endpoint: "ops@codestudio.au",
    Protocol: "email",
  });
  template.resourceCountIs("AWS::SNS::Topic", 1);
  template.hasResourceProperties("AWS::SNS::TopicPolicy", {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: "sns:Publish",
          Condition: {
            ArnLike: { "aws:SourceArn": Match.anyValue() },
            StringEquals: { "aws:SourceAccount": "123456789012" },
          },
          Effect: "Allow",
          Principal: { Service: "cloudwatch.amazonaws.com" },
          Resource: Match.anyValue(),
        }),
      ]),
    },
  });
  template.hasOutput("OfflineScormCloudFrontWebAclArn", {
    Description: Match.stringLikeRegexp("required by every Offline SCORM"),
  });
  template.hasOutput("OfflineScormEdgeAlarmTopicArn", {
    Description: Match.stringLikeRegexp("must be confirmed"),
  });
  template.hasOutput("OfflineScormEdgeAlarmKeyArn", {
    Description: Match.stringLikeRegexp("CloudWatch publish grant"),
  });
  template.hasOutput("OfflineScormEdgeAlarmEmail", {
    Value: "ops@codestudio.au",
  });
});

test("CloudFront entitlement qualification is dormant and worker-owned", () => {
  const app = new App();
  const config = environmentConfig(
    "staging",
    undefined,
    undefined,
    "staging.upskill.institute",
    "staging-qualification-only",
  );
  const network = new NetworkStack(app, "CloudFrontNetwork", config);
  const storage = new StorageStack(app, "CloudFrontStorage", config);
  const application = new ApplicationStack(app, "CloudFrontApplication", {
    config,
    vpc: network.vpc,
    applicationSecurityGroup: network.applicationSecurityGroup,
    artifactBucket: storage.artifactBucket,
    offlineScormEdgeLogBucket: storage.offlineScormEdgeLogBucket,
    learningBucket: storage.learningBucket,
    privateBucket: storage.privateBucket,
    recordingBucket: storage.recordingBucket,
    quarantineBucket: storage.quarantineBucket,
    workQueue: storage.workQueue,
    deadLetterQueue: storage.deadLetterQueue,
    databaseSecretArn:
      "arn:aws:secretsmanager:ap-southeast-2:123456789012:secret:database",
    alarmTopic: storage.alarmTopic,
    accessGrantsInstanceArn:
      "arn:aws:s3:ap-southeast-2:123456789012:access-grants/default",
  });
  const storageTemplate = Template.fromStack(storage);
  storageTemplate.resourceCountIs("AWS::S3::Bucket", 6);
  storageTemplate.resourceCountIs("Custom::S3AutoDeleteObjects", 6);
  storageTemplate.hasResourceProperties("AWS::S3::Bucket", {
    AccessControl: "LogDeliveryWrite",
    BucketEncryption: {
      ServerSideEncryptionConfiguration: [
        { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
      ],
    },
    OwnershipControls: {
      Rules: [{ ObjectOwnership: "ObjectWriter" }],
    },
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
    LifecycleConfiguration: {
      Rules: [
        {
          AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
          ExpirationInDays: 30,
          Status: "Enabled",
        },
      ],
    },
  });
  const template = Template.fromStack(application);

  template.hasResourceProperties("AWS::SecretsManager::Secret", {
    Name: "upskill/staging/offline-scorm/cloudfront-origin-key",
    Description: Match.stringLikeRegexp("CloudFront origin requests"),
    GenerateSecretString: {
      ExcludePunctuation: true,
      PasswordLength: 64,
    },
  });
  template.hasResourceProperties("AWS::SSM::Parameter", {
    Name: "/upskill/staging/offline-scorm/cloudfront-origin-domain",
    Type: "String",
    Value: "staging.upskill.institute",
  });
  template.resourceCountIs("AWS::Lambda::Version", 1);
  const allocatorVersionLogicalId = Object.keys(
    template.findResources("AWS::Lambda::Version"),
  )[0];
  expect(allocatorVersionLogicalId).toBeDefined();
  const allocatorVersionReference = { Ref: allocatorVersionLogicalId };
  const lambdaPermissions = template.findResources(
    "AWS::Lambda::Permission",
  ) as Record<string, { Properties?: { FunctionName?: unknown } }>;
  const allocatorVersionPermissions = Object.values(lambdaPermissions).filter(
    (permission) =>
      JSON.stringify(permission.Properties?.FunctionName).includes(
        allocatorVersionLogicalId ?? "",
      ),
  );
  expect(allocatorVersionPermissions).toEqual([]);
  const roles = template.findResources("AWS::IAM::Role");
  const instanceRoleLogicalId = Object.keys(roles).find((logicalId) =>
    logicalId.startsWith("InstanceRole"),
  );
  expect(instanceRoleLogicalId).toBeDefined();
  template.hasResourceProperties("AWS::SSM::Parameter", {
    Name: "/upskill/staging/offline-scorm/cloudfront-allocator-function-name",
    Type: "String",
    Value: allocatorVersionReference,
  });
  template.hasResourceProperties("AWS::Lambda::Function", {
    Description: Match.stringLikeRegexp("worker-owned allocator"),
    ReservedConcurrentExecutions: 1,
    Timeout: 120,
    Environment: {
      Variables: Match.objectLike({
        UPSKILL_ENVIRONMENT: "staging",
        UPSKILL_OFFLINE_SCORM_MAX_DISTRIBUTIONS: "25",
        UPSKILL_OFFLINE_SCORM_ORIGIN_DOMAIN: "staging.upskill.institute",
        UPSKILL_OFFLINE_SCORM_WEB_ACL_NAME:
          "upskill-staging-offline-scorm-cloudfront",
      }),
    },
  });
  template.hasOutput("OfflineScormCloudFrontMaxDistributions", {
    Value: "25",
  });
  template.hasOutput("OfflineScormCloudFrontAllocatorAlarmTopicArn", {
    Description: Match.stringLikeRegexp("required by the Offline SCORM"),
  });
  template.hasOutput("OfflineScormCloudFrontAllocatorAlarmEmail", {
    Value: "ops@codestudio.au",
  });
  template.hasOutput("OfflineScormCloudFrontAllocatorFunctionName", {
    Value: Match.anyValue(),
  });
  template.hasOutput("OfflineScormCloudFrontAllocatorQualifiedFunctionName", {
    Value: allocatorVersionReference,
  });
  template.hasOutput("OfflineScormCloudFrontAllocatorRoleArn", {
    Value: Match.anyValue(),
  });
  template.hasOutput("OfflineScormCloudFrontWorkerRoleArn", {
    Value: { "Fn::GetAtt": [instanceRoleLogicalId, "Arn"] },
  });
  const serialized = JSON.stringify(template.toJSON());
  expect(serialized).toContain("OFFLINE_SCORM_CLOUDFRONT_ORIGIN_DOMAIN");
  expect(serialized).toContain("OFFLINE_SCORM_CLOUDFRONT_ORIGIN_KEY");
  expect(serialized).toContain(
    "OFFLINE_SCORM_CLOUDFRONT_ALLOCATOR_FUNCTION_NAME",
  );
  expect(serialized).toContain(
    "Offline SCORM CloudFront allocator immutable version ARN is invalid",
  );
  expect(serialized).toContain(
    "^arn:(aws|aws-cn|aws-us-gov):lambda:[a-z0-9-]+:[0-9]{12}:function:[A-Za-z0-9_-]{1,64}:[1-9][0-9]*$",
  );
  expect(serialized).not.toContain(
    "Offline SCORM CloudFront allocator function name is invalid",
  );
  expect(serialized).toContain("upskill-worker.env");
  expect(serialized).toContain("upskill-web.env");
  expect(serialized).toContain("UPSKILL_PROCESS_ROLE");
  expect(serialized).toContain("cloudfront:CreateDistributionWithTags");
  expect(serialized).toContain("cloudfront:UpdateDistribution");
  expect(serialized).toContain("cloudfront:DeleteDistribution");
  expect(serialized).toContain("cloudfront:ListTagsForResource");
  expect(serialized).toContain("wafv2:ListWebACLs");
  expect(serialized).toContain("wafv2:ListTagsForResource");
  expect(serialized).toContain('"AWS::Lambda::Version"');
  expect(serialized).toContain('"Fn::GetAtt"');
  template.hasResourceProperties("AWS::IAM::Policy", {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: ["s3:GetBucketAcl", "s3:PutBucketAcl"],
          Effect: "Allow",
          Resource: Match.anyValue(),
        }),
      ]),
    },
  });
  expect(serialized).not.toContain('"cloudfront:*"');
  expect(serialized).not.toContain('"wafv2:*"');
  const policies = template.findResources("AWS::IAM::Policy") as Record<
    string,
    { Properties?: { Roles?: unknown[] } }
  >;
  const instancePolicies = Object.values(policies).filter((policy) =>
    policy.Properties?.Roles?.some(
      (role) =>
        JSON.stringify(role) === JSON.stringify({ Ref: instanceRoleLogicalId }),
    ),
  );
  expect(JSON.stringify(instancePolicies)).toContain("lambda:InvokeFunction");
  expect(JSON.stringify(instancePolicies)).toContain(
    JSON.stringify({
      Action: "lambda:InvokeFunction",
      Effect: "Allow",
      Resource: allocatorVersionReference,
    }),
  );
  expect(JSON.stringify(instancePolicies)).toContain(
    "OfflineScormCloudFrontOriginKey",
  );
  expect(JSON.stringify(instancePolicies)).toContain(
    "offline-scorm/cloudfront-origin-domain",
  );
  expect(JSON.stringify(instancePolicies)).toContain(
    "offline-scorm/cloudfront-allocator-function-name",
  );
  expect(serialized).toContain(
    "Dormant qualification allocator configured for the worker recovery boundary on the shared application host",
  );
  template.hasOutput("OfflineScormCloudFrontSharedHostRiskAcceptance", {
    Value: "staging-qualification-only",
    Description: Match.stringLikeRegexp("Explicit staging-only acceptance"),
  });
  template.hasResourceProperties("AWS::CloudWatch::Alarm", {
    AlarmName: "upskill-staging-offline-scorm-cloudfront-allocator-errors",
  });
  template.hasResourceProperties("AWS::CloudWatch::Alarm", {
    AlarmName: "upskill-staging-offline-scorm-cloudfront-allocator-throttles",
  });
});

test("production storage alarms on durable work backlog and dead letters", () => {
  const stack = new StorageStack(
    new App(),
    "ProductionStorage",
    environmentConfig("production"),
  );
  const template = Template.fromStack(stack);
  template.resourceCountIs("AWS::S3::Bucket", 6);
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
