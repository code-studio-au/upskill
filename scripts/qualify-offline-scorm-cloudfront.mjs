import { execFile } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";
import { assertOwnedConfiguration } from "../deploy/cdk/lambda/offline-scorm-cloudfront-entitlement/index.mjs";

const execFileAsync = promisify(execFile);

export const CLOUDFRONT_DISTRIBUTION_QUOTA_CODE = "L-24B04930";
export const CLOUDFRONT_QUALIFICATION_DISTRIBUTION_CAP = 25;
const CLOUDFRONT_CONTROL_PLANE_REGION = "us-east-1";
const APPLICATION_REGION = "ap-southeast-2";
const CLOUDFRONT_ORIGIN_DOMAIN =
  /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const ACCOUNT_ID = /^[0-9]{12}$/u;
const CLOUDFRONT_DISTRIBUTION_ID = /^[A-Z0-9]{8,32}$/u;
const CLOUDFRONT_DISTRIBUTION_ARN =
  /^arn:aws:cloudfront::([0-9]{12}):distribution\/([A-Z0-9]{8,32})$/u;
const CLOUDFRONT_WEB_ACL_ARN =
  /^arn:[a-z0-9-]+:wafv2:us-east-1:[0-9]{12}:global\/webacl\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9-]{36})$/u;
const LAMBDA_VERSION_ARN =
  /^arn:(aws|aws-cn|aws-us-gov):lambda:([a-z0-9-]+):([0-9]{12}):function:([A-Za-z0-9_-]{1,64}):([1-9][0-9]*)$/u;
const SECRETS_MANAGER_SECRET_ARN =
  /^arn:(aws|aws-cn|aws-us-gov):secretsmanager:([a-z0-9-]+):([0-9]{12}):secret:(.+)-([A-Za-z0-9]{6})$/u;
const IAM_ROLE_ARN =
  /^arn:(aws|aws-cn|aws-us-gov):iam::([0-9]{12}):role\/(.+)$/u;
const IAM_INSTANCE_PROFILE_ARN =
  /^arn:(aws|aws-cn|aws-us-gov):iam::([0-9]{12}):instance-profile\/(.+)$/u;
const IAM_ROLE_NAME = /^[A-Za-z0-9+=,.@_-]{1,64}$/u;
const AUTO_DELETE_ROLE_LOGICAL_ID =
  /^CustomS3AutoDeleteObjectsCustomResourceProviderRole[A-F0-9]+$/u;
const KMS_KEY_ARN =
  /^arn:(aws|aws-cn|aws-us-gov):kms:([a-z0-9-]+):([0-9]{12}):key\/([a-f0-9-]{36})$/u;
const S3_BUCKET_ARN =
  /^arn:(aws|aws-cn|aws-us-gov):s3:::([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])$/u;
const SNS_TOPIC_ARN =
  /^arn:(aws|aws-cn|aws-us-gov):sns:([a-z0-9-]+):([0-9]{12}):([A-Za-z0-9_-]{1,256})$/u;
const EC2_INSTANCE_ID = /^i-(?:[0-9a-f]{8}|[0-9a-f]{17})$/u;
const LAMBDA_CODE_SHA_256 = /^[A-Za-z0-9+/]{43}=$/u;
const ENTITLEMENT_ID = /^[A-Za-z0-9_-]{1,255}$/u;
const ORIGIN_CAPABILITY = /^[A-Za-z0-9_-]{43}$/u;
const ALLOCATOR_FORMAT = "upskill-offline-scorm-cloudfront-entitlement-v1";
const ORIGIN_CAPABILITY_FORMAT =
  "upskill-offline-scorm-cloudfront-origin-capability-v1";
const ENTITLEMENT_HEADER = "X-Upskill-Offline-Entitlement";
const ORIGIN_CAPABILITY_HEADER = "X-Upskill-Offline-Origin-Capability";
const ALLOCATOR_DESCRIPTION =
  "Dormant worker-owned allocator for exact-entitlement CloudFront qualification sites";
const S3_LOG_DELIVERY_GROUP_URI =
  "http://acs.amazonaws.com/groups/s3/LogDelivery";
const EDGE_LOG_RETENTION_DAYS = 30;
export const WORKER_RUNTIME_ATTESTATION_MAX_AGE_MS = 10 * 60_000;
const MUTATING_CLOUDFRONT_EVENTS = new Set([
  "CreateDistribution",
  "CreateDistributionWithTags",
  "DeleteDistribution",
  "TagResource",
  "UntagResource",
  "UpdateDistribution",
]);
const PRIVILEGE_ESCALATION_ACTIONS = [
  "cloudformation:CreateStack",
  "cloudformation:CreateStackSet",
  "cloudformation:UpdateStack",
  "cloudformation:UpdateStackSet",
  "ec2:AssociateIamInstanceProfile",
  "ec2:ReplaceIamInstanceProfileAssociation",
  "ec2:RunInstances",
  "lambda:AddPermission",
  "lambda:CreateFunction",
  "lambda:UpdateFunctionCode",
  "lambda:UpdateFunctionConfiguration",
  "ssm:SendCommand",
  "ssm:StartSession",
  "sts:AssumeRole",
];
const WORKER_S3_DATA_ACTIONS = [
  "s3:Abort*",
  "s3:DeleteObject*",
  "s3:GetBucket*",
  "s3:GetDataAccess",
  "s3:GetObject*",
  "s3:List*",
  "s3:PutObject*",
];
const WORKER_ROUTE53_READ_ACTIONS = [
  "route53:Get*",
  "route53:List*",
  "route53:TestDNSAnswer",
];

export class AwsCliError extends Error {
  constructor(message, stderr = "") {
    super(message);
    this.name = "AwsCliError";
    this.stderr = stderr;
  }

  hasCode(code) {
    return this.stderr.includes(code) || this.message.includes(code);
  }
}

function parseJson(value) {
  if (value.trim() === "") return {};
  return JSON.parse(value);
}

export async function runAwsJson(args) {
  try {
    const { stdout } = await execFileAsync(
      "aws",
      [...args, "--output", "json", "--no-cli-pager"],
      { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
    );
    return parseJson(stdout);
  } catch (error) {
    const stderr = typeof error?.stderr === "string" ? error.stderr : "";
    throw new AwsCliError(stderr.trim() || "AWS CLI command failed", stderr);
  }
}

async function readAllocatorInvocationPolicy(
  runAws,
  functionName,
  qualifier,
  region,
) {
  try {
    return {
      absent: false,
      response: await runAws([
        "lambda",
        "get-policy",
        "--function-name",
        functionName,
        "--qualifier",
        qualifier,
        "--region",
        region,
      ]),
    };
  } catch (error) {
    if (
      error instanceof AwsCliError &&
      error.hasCode("ResourceNotFoundException")
    )
      return { absent: true };
    throw error;
  }
}

export function hasNoAllocatorInvocationPolicy(policyRead) {
  return (
    policyRead?.absent === true &&
    policyRead?.response === undefined &&
    Object.keys(policyRead).length === 1
  );
}

export function deploymentOwnedAutoDeleteRoleArn(
  stackResources,
  expectedAccount,
  expectedPartition,
) {
  const matches = (stackResources?.StackResourceSummaries ?? []).filter(
    (resource) =>
      resource?.ResourceType === "AWS::IAM::Role" &&
      AUTO_DELETE_ROLE_LOGICAL_ID.test(resource?.LogicalResourceId ?? "") &&
      IAM_ROLE_NAME.test(resource?.PhysicalResourceId ?? ""),
  );
  if (
    !ACCOUNT_ID.test(expectedAccount ?? "") ||
    !["aws", "aws-cn", "aws-us-gov"].includes(expectedPartition) ||
    matches.length !== 1
  )
    return null;
  return `arn:${expectedPartition}:iam::${expectedAccount}:role/${matches[0].PhysicalResourceId}`;
}

export function hasExpectedLogCleanupRoleBoundary(roleResponse, roleArn) {
  const roleMatch = IAM_ROLE_ARN.exec(roleArn ?? "");
  const roleName = roleMatch?.[3];
  return (
    typeof roleName === "string" &&
    !roleName.includes("/") &&
    roleResponse?.Role?.Arn === roleArn &&
    roleResponse?.Role?.RoleName === roleName &&
    roleResponse?.Role?.MaxSessionDuration === 3_600 &&
    roleResponse?.Role?.PermissionsBoundary === undefined &&
    isDeepStrictEqual(roleResponse?.Role?.AssumeRolePolicyDocument, {
      Version: "2012-10-17",
      Statement: [
        {
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Principal: { Service: "lambda.amazonaws.com" },
        },
      ],
    })
  );
}

function requiredValue(value, message) {
  if (typeof value !== "string" || value.length === 0) throw new Error(message);
  return value;
}

function outputMap(stack, stackName) {
  const stacks = Array.isArray(stack.Stacks) ? stack.Stacks : [];
  if (stacks.length !== 1)
    throw new Error(`Expected deployed stack ${stackName}`);
  const [deployedStack] = stacks;
  if (
    ![
      "CREATE_COMPLETE",
      "IMPORT_COMPLETE",
      "UPDATE_COMPLETE",
      "UPDATE_ROLLBACK_COMPLETE",
    ].includes(deployedStack.StackStatus)
  )
    throw new Error(
      `Stack ${stackName} is not deployable (${String(deployedStack.StackStatus)})`,
    );
  return new Map(
    (deployedStack.Outputs ?? []).map((output) => [
      output.OutputKey,
      output.OutputValue,
    ]),
  );
}

function requiredOutput(outputs, key, stackName) {
  return requiredValue(
    outputs.get(key),
    `Stack ${stackName} has no ${key} output`,
  );
}

function parsePositiveInteger(value, message) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value))
    throw new Error(message);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(message);
  return parsed;
}

export function requireQualificationDistributionCap(value) {
  const deployedCap = parsePositiveInteger(
    value,
    "Offline SCORM qualification distribution cap is invalid",
  );
  if (deployedCap !== CLOUDFRONT_QUALIFICATION_DISTRIBUTION_CAP)
    throw new Error(
      `Offline SCORM qualification distribution cap must remain ${CLOUDFRONT_QUALIFICATION_DISTRIBUTION_CAP}`,
    );
  return CLOUDFRONT_QUALIFICATION_DISTRIBUTION_CAP;
}

export function parseQualificationArguments(argv) {
  const parsed = {
    applicationRegion: APPLICATION_REGION,
    environment: "",
    expectedAccount: "",
    expectedOriginDomain: "",
    lookbackHours: 24,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--help") return { help: true };
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--"))
      throw new Error(`Missing value for ${argument}`);
    index += 1;
    if (argument === "--environment") parsed.environment = value;
    else if (argument === "--expected-account") parsed.expectedAccount = value;
    else if (argument === "--expected-origin-domain")
      parsed.expectedOriginDomain = value;
    else if (argument === "--application-region")
      parsed.applicationRegion = value;
    else if (argument === "--lookback-hours")
      parsed.lookbackHours = parsePositiveInteger(
        value,
        "--lookback-hours must be a positive integer",
      );
    else throw new Error(`Unknown argument ${argument}`);
  }
  if (parsed.environment !== "staging")
    throw new Error("CloudFront qualification is staging-only");
  if (!ACCOUNT_ID.test(parsed.expectedAccount))
    throw new Error("--expected-account must be a 12-digit AWS account ID");
  if (
    !CLOUDFRONT_ORIGIN_DOMAIN.test(parsed.expectedOriginDomain) ||
    parsed.expectedOriginDomain.endsWith(".cloudfront.net")
  )
    throw new Error(
      "--expected-origin-domain must be a lowercase non-CloudFront DNS name",
    );
  if (!/^[a-z0-9-]{3,32}$/u.test(parsed.applicationRegion))
    throw new Error("--application-region is invalid");
  if (parsed.lookbackHours > 24 * 7)
    throw new Error("--lookback-hours must not exceed 168");
  return parsed;
}

export function classifyQualificationDistributions(
  distributions,
  environment,
  expectedWebAclArn,
) {
  const prefix = `upskill:${environment}:offline-scorm:`;
  const owned = distributions.filter((distribution) => {
    const comment = distribution.inventoryComment ?? distribution.Comment;
    const callerReference = distribution.configuration?.CallerReference;
    return (
      callerReference?.startsWith(prefix) ||
      comment?.startsWith(prefix) ||
      hasQualificationOwnershipTags(distribution.tags, environment) ||
      distribution.webAclId === expectedWebAclArn
    );
  });
  const comments = new Set();
  const duplicateMarkers = new Set();
  for (const distribution of owned) {
    const comment = distribution.inventoryComment ?? distribution.Comment;
    if (typeof comment !== "string") continue;
    if (comments.has(comment)) duplicateMarkers.add(comment);
    comments.add(comment);
  }
  return { duplicateMarkers: [...duplicateMarkers].sort(), owned };
}

function entitlementDigest(environment, entitlementId) {
  if (!ENTITLEMENT_ID.test(entitlementId)) return null;
  return createHash("sha256")
    .update(ALLOCATOR_FORMAT, "utf8")
    .update("\0", "utf8")
    .update(environment, "utf8")
    .update("\0", "utf8")
    .update(entitlementId, "utf8")
    .digest("hex");
}

function expectedDistributionMarker(environment, entitlementId) {
  const digest = entitlementDigest(environment, entitlementId);
  return digest === null
    ? null
    : `upskill:${environment}:offline-scorm:${digest.slice(0, 32)}`;
}

function expectedOriginCapability(originKey, environment, entitlementId) {
  if (
    typeof originKey !== "string" ||
    originKey.length < 43 ||
    originKey.length > 512 ||
    !ENTITLEMENT_ID.test(entitlementId)
  )
    return null;
  return createHmac("sha256", originKey)
    .update(ORIGIN_CAPABILITY_FORMAT, "utf8")
    .update("\0", "utf8")
    .update(environment, "utf8")
    .update("\0", "utf8")
    .update(entitlementId, "utf8")
    .digest("base64url");
}

function distributionTagMap(tags) {
  if (!Array.isArray(tags)) return null;
  const tagMap = new Map();
  for (const tag of tags) {
    if (
      typeof tag?.Key !== "string" ||
      typeof tag?.Value !== "string" ||
      tagMap.has(tag.Key)
    )
      return null;
    tagMap.set(tag.Key, tag.Value);
  }
  return tagMap;
}

function hasQualificationOwnershipTags(tags, environment) {
  const tagMap = distributionTagMap(tags);
  return (
    tagMap?.get("Application") === "upskill" &&
    tagMap?.get("Environment") === environment &&
    tagMap?.get("Purpose") === "offline-scorm-qualification" &&
    ENTITLEMENT_ID.test(tagMap?.get("OfflineScormEntitlementId") ?? "")
  );
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export function haveExpectedDistributionOwnership(
  distributions,
  environment,
  expectedAccount,
) {
  if (!Array.isArray(distributions)) return false;
  return distributions.every((distribution) => {
    const arnMatch = CLOUDFRONT_DISTRIBUTION_ARN.exec(
      distribution?.distributionArn ?? "",
    );
    const tags = distributionTagMap(distribution?.tags);
    const entitlementId = tags?.get("OfflineScormEntitlementId");
    const expectedMarker = expectedDistributionMarker(
      environment,
      entitlementId,
    );
    return (
      arnMatch?.[1] === expectedAccount &&
      arnMatch?.[2] === distribution?.distributionId &&
      tags?.get("Application") === "upskill" &&
      tags?.get("Environment") === environment &&
      tags?.get("Purpose") === "offline-scorm-qualification" &&
      expectedMarker !== null &&
      distribution?.configuration?.CallerReference === expectedMarker &&
      distribution?.inventoryComment === expectedMarker &&
      distribution?.configuration?.Comment === expectedMarker
    );
  });
}

export function evaluateQuotaHeadroom({
  distributionQuota,
  ownedDistributionCount,
  totalDistributionCount,
  qualificationCap,
}) {
  const requiredAdditionalCapacity = Math.max(
    qualificationCap - ownedDistributionCount,
    0,
  );
  const availableCapacity = distributionQuota - totalDistributionCount;
  return {
    availableCapacity,
    requiredAdditionalCapacity,
    sufficient: availableCapacity >= requiredAdditionalCapacity,
  };
}

export function areOwnedDistributionsDeployed(distributions) {
  return (
    Array.isArray(distributions) &&
    distributions.every(
      (distribution) => distribution?.deploymentStatus === "Deployed",
    )
  );
}

export function summarizeCloudTrailEvents(events) {
  return events
    .filter((event) => MUTATING_CLOUDFRONT_EVENTS.has(event.EventName))
    .map((event) => {
      let detail = {};
      try {
        detail = JSON.parse(event.CloudTrailEvent ?? "{}");
      } catch {
        // Event History remains usable even when a malformed detail cannot be summarized.
      }
      return {
        errorCode: detail.errorCode ?? null,
        eventName: event.EventName,
        eventTime: event.EventTime,
        identityType: detail.userIdentity?.type ?? null,
        invokedBy: detail.userIdentity?.invokedBy ?? null,
        readOnly: event.ReadOnly === "true",
      };
    });
}

export function haveExpectedAlarmConfigurations(alarms, expectedAlarms) {
  if (!Array.isArray(alarms)) return false;
  const alarmsByName = new Map(alarms.map((alarm) => [alarm.AlarmName, alarm]));
  return expectedAlarms.every((expected) => {
    const {
      actionArn,
      alarmName,
      comparisonOperator,
      dimensions,
      evaluationPeriods,
      metricName,
      namespace,
      period,
      statistic,
      threshold,
      treatMissingData,
      unit,
    } = expected;
    const alarm = alarmsByName.get(alarmName);
    return (
      alarm?.ActionsEnabled === true &&
      Array.isArray(alarm.AlarmActions) &&
      alarm.AlarmActions.length === 1 &&
      alarm.AlarmActions[0] === actionArn &&
      (alarm.OKActions === undefined ||
        (Array.isArray(alarm.OKActions) && alarm.OKActions.length === 0)) &&
      (alarm.InsufficientDataActions === undefined ||
        (Array.isArray(alarm.InsufficientDataActions) &&
          alarm.InsufficientDataActions.length === 0)) &&
      alarm.Namespace === namespace &&
      alarm.MetricName === metricName &&
      haveExpectedDimensions(alarm.Dimensions, dimensions) &&
      alarm.Period === period &&
      alarm.Statistic === statistic &&
      alarm.Threshold === threshold &&
      alarm.ComparisonOperator === comparisonOperator &&
      alarm.EvaluationPeriods === evaluationPeriods &&
      alarm.TreatMissingData === treatMissingData &&
      alarm.Unit === unit
    );
  });
}

export function hasCurrentHealthyWorkerSignal(
  metricResponse,
  alarmResponse,
  generatedAt,
  expectedAlarmName,
) {
  const observedAt = Date.parse(generatedAt);
  const alarms = alarmResponse?.MetricAlarms;
  const datapoints = metricResponse?.Datapoints;
  if (
    !Number.isFinite(observedAt) ||
    !Array.isArray(alarms) ||
    alarms.length !== 1 ||
    alarms[0]?.AlarmName !== expectedAlarmName ||
    alarms[0]?.StateValue !== "OK" ||
    !Array.isArray(datapoints) ||
    datapoints.length === 0
  )
    return false;
  const latest = datapoints
    .map((datapoint) => ({
      ...datapoint,
      observedAt: Date.parse(datapoint?.Timestamp ?? ""),
    }))
    .filter((datapoint) => Number.isFinite(datapoint.observedAt))
    .sort((left, right) => right.observedAt - left.observedAt)[0];
  return (
    latest?.Maximum === 1 &&
    latest?.Minimum === 1 &&
    latest?.Unit === "Count" &&
    latest.observedAt <= observedAt + 60_000 &&
    latest.observedAt >= observedAt - 10 * 60_000
  );
}

export function hasExpectedAllocatorConfiguration(
  configuration,
  concurrency,
  expected,
) {
  const versionMatch = LAMBDA_VERSION_ARN.exec(
    expected.qualifiedFunctionName ?? "",
  );
  return (
    versionMatch?.[2] === expected.applicationRegion &&
    versionMatch?.[3] === expected.accountId &&
    versionMatch?.[4] === expected.functionName &&
    configuration?.FunctionName === versionMatch?.[4] &&
    configuration?.Version === versionMatch?.[5] &&
    LAMBDA_CODE_SHA_256.test(configuration?.CodeSha256 ?? "") &&
    configuration?.CodeSha256 === expected.codeSha256 &&
    configuration?.Role === expected.roleArn &&
    configuration?.State === "Active" &&
    configuration?.LastUpdateStatus === "Successful" &&
    configuration?.Runtime === "nodejs22.x" &&
    configuration?.Handler === "index.handler" &&
    configuration?.Timeout === 120 &&
    configuration?.Description === ALLOCATOR_DESCRIPTION &&
    isDeepStrictEqual(configuration?.VpcConfig, {
      Ipv6AllowedForDualStack: false,
      SecurityGroupIds: [],
      SubnetIds: [],
      VpcId: "",
    }) &&
    (configuration?.Layers === undefined ||
      (Array.isArray(configuration.Layers) &&
        configuration.Layers.length === 0)) &&
    isDeepStrictEqual(configuration?.Environment?.Variables, {
      UPSKILL_ENVIRONMENT: expected.environment,
      UPSKILL_OFFLINE_SCORM_EDGE_LOG_BUCKET_DOMAIN: expected.logBucketDomain,
      UPSKILL_OFFLINE_SCORM_MAX_DISTRIBUTIONS: String(
        expected.qualificationCap,
      ),
      UPSKILL_OFFLINE_SCORM_ORIGIN_DOMAIN: expected.originDomain,
      UPSKILL_OFFLINE_SCORM_ORIGIN_KEY_SECRET_ARN: expected.originKeySecretArn,
      UPSKILL_OFFLINE_SCORM_WEB_ACL_NAME: expected.webAclName,
    }) &&
    concurrency?.ReservedConcurrentExecutions === 1
  );
}

function canonicalIdentityPolicyStatements(policyDocument) {
  if (
    policyDocument?.Version !== "2012-10-17" ||
    !Array.isArray(policyDocument.Statement)
  )
    return null;
  const statements = [];
  for (const statement of policyDocument.Statement) {
    if (
      !statement ||
      statement.Effect !== "Allow" ||
      Object.keys(statement).sort().join(",") !== "Action,Effect,Resource"
    )
      return null;
    const actions = Array.isArray(statement.Action)
      ? statement.Action
      : [statement.Action];
    const resources = Array.isArray(statement.Resource)
      ? statement.Resource
      : [statement.Resource];
    if (
      actions.some((action) => typeof action !== "string") ||
      resources.some((resource) => typeof resource !== "string")
    )
      return null;
    statements.push(
      JSON.stringify({
        actions: [...actions].sort(),
        resources: [...resources].sort(),
      }),
    );
  }
  return statements.sort();
}

export function hasExpectedAllocatorRoleBoundary(
  roleResponse,
  attachedPoliciesResponse,
  inlinePolicyNamesResponse,
  inlinePolicies,
  expected,
) {
  const roleMatch = IAM_ROLE_ARN.exec(expected.roleArn ?? "");
  const rolePath = roleMatch?.[3];
  const roleName = rolePath?.split("/").at(-1);
  if (
    roleMatch?.[2] !== expected.accountId ||
    !roleName ||
    roleResponse?.Role?.Arn !== expected.roleArn ||
    roleResponse?.Role?.RoleName !== roleName ||
    roleResponse?.Role?.MaxSessionDuration !== 3_600 ||
    roleResponse?.Role?.PermissionsBoundary !== undefined ||
    !isDeepStrictEqual(roleResponse?.Role?.AssumeRolePolicyDocument, {
      Version: "2012-10-17",
      Statement: [
        {
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Principal: { Service: "lambda.amazonaws.com" },
        },
      ],
    })
  )
    return false;
  if (
    !isDeepStrictEqual(attachedPoliciesResponse?.AttachedPolicies, [
      {
        PolicyArn: `arn:${roleMatch[1]}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole`,
        PolicyName: "AWSLambdaBasicExecutionRole",
      },
    ]) ||
    !Array.isArray(inlinePolicyNamesResponse?.PolicyNames) ||
    inlinePolicyNamesResponse.PolicyNames.length !== 1 ||
    !Array.isArray(inlinePolicies) ||
    inlinePolicies.length !== 1 ||
    inlinePolicies[0]?.PolicyName !== inlinePolicyNamesResponse.PolicyNames[0]
  )
    return false;
  const webAclResource = expected.webAclArn.replace(/\/[^/]+$/u, "/*");
  const expectedStatements = canonicalIdentityPolicyStatements({
    Version: "2012-10-17",
    Statement: [
      {
        Action: [
          "secretsmanager:DescribeSecret",
          "secretsmanager:GetSecretValue",
        ],
        Effect: "Allow",
        Resource: expected.originKeySecretArn,
      },
      {
        Action: ["s3:GetBucketAcl", "s3:PutBucketAcl"],
        Effect: "Allow",
        Resource: expected.logBucketArn,
      },
      {
        Action: "wafv2:ListWebACLs",
        Effect: "Allow",
        Resource: "*",
      },
      {
        Action: "wafv2:ListTagsForResource",
        Effect: "Allow",
        Resource: webAclResource,
      },
      {
        Action: [
          "cloudfront:CreateDistributionWithTags",
          "cloudfront:ListDistributions",
        ],
        Effect: "Allow",
        Resource: "*",
      },
      {
        Action: [
          "cloudfront:DeleteDistribution",
          "cloudfront:GetDistribution",
          "cloudfront:GetDistributionConfig",
          "cloudfront:ListTagsForResource",
          "cloudfront:UpdateDistribution",
        ],
        Effect: "Allow",
        Resource: `arn:${roleMatch[1]}:cloudfront::${expected.accountId}:distribution/*`,
      },
    ],
  });
  return isDeepStrictEqual(
    canonicalIdentityPolicyStatements(inlinePolicies[0]?.PolicyDocument),
    expectedStatements,
  );
}

function hasNoMissingContextValues(result) {
  return (
    result?.MissingContextValues === undefined ||
    (Array.isArray(result.MissingContextValues) &&
      result.MissingContextValues.length === 0)
  );
}

export function canWorkerInvokePinnedAllocator(
  simulation,
  qualifiedFunctionName,
) {
  if (!LAMBDA_VERSION_ARN.test(qualifiedFunctionName ?? "")) return false;
  const results = simulation?.EvaluationResults;
  if (!Array.isArray(results) || results.length !== 1) return false;
  const [result] = results;
  const resourceResults = result?.ResourceSpecificResults;
  return (
    result?.EvalActionName === "lambda:InvokeFunction" &&
    result?.EvalDecision === "allowed" &&
    hasNoMissingContextValues(result) &&
    Array.isArray(resourceResults) &&
    resourceResults.length === 1 &&
    resourceResults[0]?.EvalResourceName === qualifiedFunctionName &&
    resourceResults[0]?.EvalResourceDecision === "allowed" &&
    hasNoMissingContextValues(resourceResults[0])
  );
}

function actionPatternMatches(actionPattern, action) {
  if (typeof actionPattern !== "string") return false;
  const escaped = actionPattern
    .toLowerCase()
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replaceAll("*", ".*")
    .replaceAll("?", ".");
  return new RegExp(`^${escaped}$`, "u").test(action.toLowerCase());
}

function actionPatternMayTargetService(actionPattern, service) {
  if (typeof actionPattern !== "string") return false;
  if (actionPattern === "*") return true;
  const separator = actionPattern.indexOf(":");
  if (separator < 1) return false;
  return actionPatternMatches(actionPattern.slice(0, separator), service);
}

function isExactAllocatorInvokeStatement(statement, qualifiedFunctionName) {
  const actions = Array.isArray(statement?.Action)
    ? statement.Action
    : [statement?.Action];
  const resources = Array.isArray(statement?.Resource)
    ? statement.Resource
    : [statement?.Resource];
  return (
    Object.keys(statement ?? {})
      .sort()
      .join(",") === "Action,Effect,Resource" &&
    statement.Effect === "Allow" &&
    actions.length === 1 &&
    actions[0] === "lambda:InvokeFunction" &&
    resources.length === 1 &&
    resources[0] === qualifiedFunctionName
  );
}

function isExactWorkerRuntimeAttestationStatement(
  statement,
  runtimeTargetParameterArn,
) {
  const actions = Array.isArray(statement?.Action)
    ? statement.Action
    : [statement?.Action];
  const resources = Array.isArray(statement?.Resource)
    ? statement.Resource
    : [statement?.Resource];
  return (
    Object.keys(statement ?? {})
      .sort()
      .join(",") === "Action,Effect,Resource" &&
    statement.Effect === "Allow" &&
    actions.length === 1 &&
    actions[0] === "ssm:PutParameter" &&
    resources.length === 1 &&
    resources[0] === runtimeTargetParameterArn
  );
}

function isExactWorkerMetricPublicationStatement(statement) {
  const actions = Array.isArray(statement?.Action)
    ? statement.Action
    : [statement?.Action];
  const resources = Array.isArray(statement?.Resource)
    ? statement.Resource
    : [statement?.Resource];
  return (
    isDeepStrictEqual(Object.keys(statement ?? {}).sort(), [
      "Action",
      "Condition",
      "Effect",
      "Resource",
    ]) &&
    statement.Effect === "Allow" &&
    isDeepStrictEqual(actions, ["cloudwatch:PutMetricData"]) &&
    isDeepStrictEqual(resources, ["*"]) &&
    isDeepStrictEqual(statement.Condition, {
      StringEquals: { "cloudwatch:namespace": "Upskill" },
    })
  );
}

function statementMayTargetS3Bucket(statement, bucketArn) {
  const resources = Array.isArray(statement?.Resource)
    ? statement.Resource
    : [statement?.Resource];
  return resources.some(
    (resource) =>
      typeof resource === "string" &&
      (resource === "*" ||
        actionPatternMatches(resource, bucketArn) ||
        actionPatternMatches(resource, `${bucketArn}/qualification-probe`)),
  );
}

function expectedWorkerSecretName(resource, expected) {
  const match = SECRETS_MANAGER_SECRET_ARN.exec(resource ?? "");
  if (
    match?.[1] !== expected.partition ||
    match?.[2] !== expected.region ||
    match?.[3] !== expected.accountId ||
    !expected.names.has(match?.[4])
  )
    return null;
  return match[4];
}

function workerSecretStatementNames(statement, actions, expected) {
  if (
    !isDeepStrictEqual(Object.keys(statement ?? {}).sort(), [
      "Action",
      "Effect",
      "Resource",
    ]) ||
    statement.Effect !== "Allow" ||
    actions.length === 0 ||
    !actions.every((action) =>
      [
        "secretsmanager:DescribeSecret",
        "secretsmanager:GetSecretValue",
      ].includes(action),
    )
  )
    return null;
  const resources = Array.isArray(statement.Resource)
    ? statement.Resource
    : [statement.Resource];
  if (
    resources.length === 0 ||
    new Set(resources).size !== resources.length ||
    resources.some((resource) => typeof resource !== "string")
  )
    return null;
  const names = resources.map((resource) =>
    expectedWorkerSecretName(resource, expected),
  );
  return names.includes(null) ? null : names;
}

export function hasExpectedWorkerAllocatorPolicyBoundary(
  roleResponse,
  attachedPoliciesResponse,
  inlinePolicyNamesResponse,
  inlinePolicies,
  workerRoleArn,
  qualifiedFunctionName,
  runtimeTargetParameterArn,
  protectedLogBucketArn,
  approvedSecretNames,
) {
  const roleMatch = IAM_ROLE_ARN.exec(workerRoleArn ?? "");
  const functionMatch = LAMBDA_VERSION_ARN.exec(qualifiedFunctionName ?? "");
  const roleName = roleMatch?.[3].split("/").at(-1);
  const approvedSecretNameSet = new Set(
    Array.isArray(approvedSecretNames) ? approvedSecretNames : [],
  );
  if (
    !roleName ||
    functionMatch?.[1] !== roleMatch?.[1] ||
    functionMatch?.[3] !== roleMatch?.[2] ||
    typeof runtimeTargetParameterArn !== "string" ||
    !S3_BUCKET_ARN.test(protectedLogBucketArn ?? "") ||
    !Array.isArray(approvedSecretNames) ||
    approvedSecretNames.length === 0 ||
    approvedSecretNameSet.size !== approvedSecretNames.length ||
    approvedSecretNames.some(
      (name) =>
        typeof name !== "string" ||
        !/^upskill\/[a-z0-9-]+\/[A-Za-z0-9/_+=.@-]+$/u.test(name),
    ) ||
    roleResponse?.Role?.Arn !== workerRoleArn ||
    roleResponse?.Role?.RoleName !== roleName ||
    roleResponse?.Role?.MaxSessionDuration !== 3_600 ||
    roleResponse?.Role?.PermissionsBoundary !== undefined ||
    !isDeepStrictEqual(roleResponse?.Role?.AssumeRolePolicyDocument, {
      Version: "2012-10-17",
      Statement: [
        {
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Principal: { Service: "ec2.amazonaws.com" },
        },
      ],
    }) ||
    !isDeepStrictEqual(attachedPoliciesResponse?.AttachedPolicies, [
      {
        PolicyArn: `arn:${roleMatch[1]}:iam::aws:policy/AmazonSSMManagedInstanceCore`,
        PolicyName: "AmazonSSMManagedInstanceCore",
      },
    ]) ||
    !Array.isArray(inlinePolicyNamesResponse?.PolicyNames) ||
    inlinePolicyNamesResponse.PolicyNames.length === 0 ||
    new Set(inlinePolicyNamesResponse.PolicyNames).size !==
      inlinePolicyNamesResponse.PolicyNames.length ||
    !Array.isArray(inlinePolicies) ||
    inlinePolicies.length !== inlinePolicyNamesResponse.PolicyNames.length
  )
    return false;

  const expectedPolicyNames = new Set(inlinePolicyNamesResponse.PolicyNames);
  let allocatorInvokeStatements = 0;
  let runtimeAttestationStatements = 0;
  const observedSecretNames = new Set();
  for (const policy of inlinePolicies) {
    if (
      policy?.RoleName !== roleName ||
      !expectedPolicyNames.delete(policy?.PolicyName) ||
      policy?.PolicyDocument?.Version !== "2012-10-17" ||
      !Array.isArray(policy.PolicyDocument.Statement)
    )
      return false;
    for (const statement of policy.PolicyDocument.Statement) {
      if (!statement || statement.Effect !== "Allow") continue;
      if (
        statement.NotAction !== undefined ||
        statement.NotResource !== undefined
      )
        return false;
      const actions = Array.isArray(statement.Action)
        ? statement.Action
        : [statement.Action];
      if (actions.some((action) => typeof action !== "string")) return false;
      const hasSecretAction = actions.some((action) =>
        actionPatternMayTargetService(action, "secretsmanager"),
      );
      if (hasSecretAction) {
        const secretNames = workerSecretStatementNames(statement, actions, {
          accountId: roleMatch[2],
          names: approvedSecretNameSet,
          partition: roleMatch[1],
          region: functionMatch[2],
        });
        if (secretNames === null) return false;
        for (const secretName of secretNames)
          observedSecretNames.add(secretName);
      }
      const hasS3Action = actions.some((action) =>
        actionPatternMayTargetService(action, "s3"),
      );
      if (
        (hasS3Action &&
          statementMayTargetS3Bucket(statement, protectedLogBucketArn)) ||
        actions.some(
          (action) =>
            actionPatternMayTargetService(action, "cloudfront") ||
            actionPatternMayTargetService(action, "wafv2") ||
            actionPatternMayTargetService(action, "iam") ||
            actionPatternMayTargetService(action, "organizations") ||
            actionPatternMayTargetService(action, "cloudformation") ||
            actionPatternMayTargetService(action, "ec2") ||
            actionPatternMayTargetService(action, "kms") ||
            actionPatternMayTargetService(action, "logs") ||
            actionPatternMayTargetService(action, "sns") ||
            actionPatternMayTargetService(action, "s3control") ||
            (actionPatternMayTargetService(action, "s3") &&
              !WORKER_S3_DATA_ACTIONS.some((allowedAction) =>
                actionPatternMatches(allowedAction, action),
              )) ||
            (actionPatternMayTargetService(action, "route53") &&
              !WORKER_ROUTE53_READ_ACTIONS.some((allowedAction) =>
                actionPatternMatches(allowedAction, action),
              )) ||
            PRIVILEGE_ESCALATION_ACTIONS.some((privilegedAction) =>
              actionPatternMatches(action, privilegedAction),
            ),
        )
      )
        return false;
      if (
        actions.some((action) =>
          actionPatternMayTargetService(action, "lambda"),
        )
      ) {
        if (!isExactAllocatorInvokeStatement(statement, qualifiedFunctionName))
          return false;
        allocatorInvokeStatements += 1;
      }
      if (
        actions.some((action) => actionPatternMayTargetService(action, "ssm"))
      ) {
        if (
          isExactWorkerRuntimeAttestationStatement(
            statement,
            runtimeTargetParameterArn,
          )
        )
          runtimeAttestationStatements += 1;
        else if (!actions.every((action) => action === "ssm:GetParameter"))
          return false;
      }
      if (
        actions.some((action) =>
          actionPatternMayTargetService(action, "cloudwatch"),
        ) &&
        !isExactWorkerMetricPublicationStatement(statement)
      )
        return false;
    }
  }
  return (
    expectedPolicyNames.size === 0 &&
    allocatorInvokeStatements === 1 &&
    runtimeAttestationStatements === 1 &&
    observedSecretNames.size === approvedSecretNameSet.size &&
    [...approvedSecretNameSet].every((name) => observedSecretNames.has(name))
  );
}

export function hasNoOriginKeyResourcePolicy(policyResponse, secretArn) {
  return (
    policyResponse?.ARN === secretArn &&
    (policyResponse.ResourcePolicy === undefined ||
      policyResponse.ResourcePolicy === null ||
      policyResponse.ResourcePolicy === "")
  );
}

export function hasExpectedWorkerRuntimeTarget(
  configuredParameter,
  runtimeParameter,
  configuredParameterName,
  runtimeParameterName,
  qualifiedFunctionName,
  observedAt,
) {
  const observedAtMilliseconds = Date.parse(observedAt ?? "");
  const attestedAtMilliseconds = Date.parse(
    runtimeParameter?.Parameter?.LastModifiedDate ?? "",
  );
  return (
    LAMBDA_VERSION_ARN.test(qualifiedFunctionName ?? "") &&
    Number.isFinite(observedAtMilliseconds) &&
    Number.isFinite(attestedAtMilliseconds) &&
    attestedAtMilliseconds <= observedAtMilliseconds + 60_000 &&
    observedAtMilliseconds - attestedAtMilliseconds <=
      WORKER_RUNTIME_ATTESTATION_MAX_AGE_MS &&
    configuredParameter?.Parameter?.Name === configuredParameterName &&
    configuredParameter.Parameter.Value === qualifiedFunctionName &&
    runtimeParameter?.Parameter?.Name === runtimeParameterName &&
    runtimeParameter.Parameter.Value === qualifiedFunctionName
  );
}

function workerInstanceProfileBinding(instancesResponse, expectedInstanceId) {
  const instances = (instancesResponse?.Reservations ?? []).flatMap(
    (reservation) => reservation?.Instances ?? [],
  );
  if (instances.length !== 1 || instances[0]?.InstanceId !== expectedInstanceId)
    return null;
  const profileArn = instances[0]?.IamInstanceProfile?.Arn;
  const profileMatch = IAM_INSTANCE_PROFILE_ARN.exec(profileArn ?? "");
  const profileName = profileMatch?.[3].split("/").at(-1);
  if (!profileName || instances[0]?.State?.Name !== "running") return null;
  return {
    accountId: profileMatch[2],
    partition: profileMatch[1],
    profileArn,
    profileName,
  };
}

export function hasExpectedWorkerInstanceProfile(
  instancesResponse,
  instanceProfileResponse,
  expectedInstanceId,
  expectedRoleArn,
) {
  if (!EC2_INSTANCE_ID.test(expectedInstanceId ?? "")) return false;
  const roleMatch = IAM_ROLE_ARN.exec(expectedRoleArn ?? "");
  const binding = workerInstanceProfileBinding(
    instancesResponse,
    expectedInstanceId,
  );
  const profile = instanceProfileResponse?.InstanceProfile;
  return (
    binding !== null &&
    roleMatch?.[1] === binding.partition &&
    roleMatch?.[2] === binding.accountId &&
    profile?.Arn === binding.profileArn &&
    profile?.InstanceProfileName === binding.profileName &&
    Array.isArray(profile?.Roles) &&
    profile.Roles.length === 1 &&
    profile.Roles[0]?.Arn === expectedRoleArn
  );
}

function parsePolicyDocument(policy) {
  if (typeof policy !== "string") return null;
  try {
    const parsed = JSON.parse(policy);
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function hasExpectedEdgeAlarmKmsBoundary(
  topicAttributesResponse,
  keyDescriptionResponse,
  keyPolicyResponse,
  expected,
) {
  const keyMatch = KMS_KEY_ARN.exec(expected.keyArn ?? "");
  const topicMatch = SNS_TOPIC_ARN.exec(expected.topicArn ?? "");
  const keyMetadata = keyDescriptionResponse?.KeyMetadata;
  if (
    keyMatch?.[1] !== topicMatch?.[1] ||
    keyMatch?.[2] !== CLOUDFRONT_CONTROL_PLANE_REGION ||
    topicMatch?.[2] !== CLOUDFRONT_CONTROL_PLANE_REGION ||
    keyMatch?.[3] !== expected.accountId ||
    topicMatch?.[3] !== expected.accountId ||
    topicAttributesResponse?.Attributes?.KmsMasterKeyId !== expected.keyArn ||
    keyMetadata?.Arn !== expected.keyArn ||
    keyMetadata?.AWSAccountId !== expected.accountId ||
    keyMetadata?.Enabled !== true ||
    keyMetadata?.KeyState !== "Enabled" ||
    keyMetadata?.KeyUsage !== "ENCRYPT_DECRYPT" ||
    keyMetadata?.KeySpec !== "SYMMETRIC_DEFAULT" ||
    keyMetadata?.KeyManager !== "CUSTOMER"
  )
    return false;
  const policy = parsePolicyDocument(keyPolicyResponse?.Policy);
  const statements = Array.isArray(policy?.Statement) ? policy.Statement : [];
  const expectedAlarmArn = `arn:${keyMatch[1]}:cloudwatch:${CLOUDFRONT_CONTROL_PLANE_REGION}:${expected.accountId}:alarm:${expected.alarmName}`;
  if (policy?.Version !== "2012-10-17" || statements.length !== 2) return false;
  const hasAccountAdministration = statements.some((statement) => {
    const actions = Array.isArray(statement?.Action)
      ? statement.Action
      : [statement?.Action];
    return (
      statement?.Effect === "Allow" &&
      isDeepStrictEqual(statement?.Principal, {
        AWS: `arn:${keyMatch[1]}:iam::${expected.accountId}:root`,
      }) &&
      actions.length === 1 &&
      actions[0] === "kms:*" &&
      statement?.Resource === "*" &&
      statement?.Condition === undefined &&
      statement?.NotAction === undefined &&
      statement?.NotPrincipal === undefined &&
      statement?.NotResource === undefined
    );
  });
  const hasCloudWatchGrant = statements.some((statement) => {
    const actions = Array.isArray(statement?.Action)
      ? statement.Action
      : [statement?.Action];
    return (
      statement?.Effect === "Allow" &&
      isDeepStrictEqual(statement?.Principal, {
        Service: "cloudwatch.amazonaws.com",
      }) &&
      statement?.NotAction === undefined &&
      statement?.NotPrincipal === undefined &&
      statement?.NotResource === undefined &&
      isDeepStrictEqual([...actions].sort(), [
        "kms:Decrypt",
        "kms:GenerateDataKey*",
      ]) &&
      statement?.Resource === "*" &&
      isDeepStrictEqual(statement?.Condition, {
        ArnLike: { "aws:SourceArn": expectedAlarmArn },
        StringEquals: { "aws:SourceAccount": expected.accountId },
      })
    );
  });
  return hasAccountAdministration && hasCloudWatchGrant;
}

export function hasExpectedAlarmTopicPolicy(topicAttributesResponse, expected) {
  const topicMatch = SNS_TOPIC_ARN.exec(expected.topicArn ?? "");
  const expectedAlarmArn = topicMatch
    ? `arn:${topicMatch[1]}:cloudwatch:${expected.region}:${expected.accountId}:alarm:${expected.alarmName}`
    : null;
  const attributes = topicAttributesResponse?.Attributes;
  const policy = parsePolicyDocument(attributes?.Policy);
  const statements = Array.isArray(policy?.Statement) ? policy.Statement : [];
  if (
    topicMatch?.[2] !== expected.region ||
    topicMatch?.[3] !== expected.accountId ||
    attributes?.Owner !== expected.accountId ||
    attributes?.TopicArn !== expected.topicArn ||
    attributes?.KmsMasterKeyId !== expected.kmsMasterKeyId ||
    policy?.Version !== "2012-10-17" ||
    statements.length !== 1
  )
    return false;
  const [statement] = statements;
  const actions = Array.isArray(statement?.Action)
    ? statement.Action
    : [statement?.Action];
  return (
    Object.keys(statement ?? {})
      .sort()
      .join(",") === "Action,Condition,Effect,Principal,Resource" &&
    statement?.Effect === "Allow" &&
    isDeepStrictEqual(statement?.Principal, {
      Service: "cloudwatch.amazonaws.com",
    }) &&
    actions.length === 1 &&
    String(actions[0]).toLowerCase() === "sns:publish" &&
    statement?.Resource === expected.topicArn &&
    isDeepStrictEqual(statement?.Condition, {
      ArnLike: { "aws:SourceArn": expectedAlarmArn },
      StringEquals: { "aws:SourceAccount": expected.accountId },
    })
  );
}

export function hasExpectedCloudFrontLogDeliveryAcl(acl) {
  const ownerId = acl?.Owner?.ID;
  if (typeof ownerId !== "string" || ownerId.length === 0) return false;
  const grants = acl?.Grants;
  if (!Array.isArray(grants)) return false;
  const actual = grants
    .map(
      (grant) =>
        `${String(grant?.Permission)}|${String(grant?.Grantee?.Type)}|${String(
          grant?.Grantee?.ID ?? "",
        )}|${String(grant?.Grantee?.URI ?? "")}`,
    )
    .sort();
  const expected = [
    `FULL_CONTROL|CanonicalUser|${ownerId}|`,
    `READ_ACP|Group||${S3_LOG_DELIVERY_GROUP_URI}`,
    `WRITE|Group||${S3_LOG_DELIVERY_GROUP_URI}`,
  ].sort();
  return isDeepStrictEqual(actual, expected);
}

export function hasExpectedLogBucketPolicy(
  policyResponse,
  expectedBucketArn,
  expectedAutoDeleteRoleArn,
) {
  if (
    !/^arn:(aws|aws-cn|aws-us-gov):s3:::[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(
      expectedBucketArn ?? "",
    ) ||
    !/^arn:(aws|aws-cn|aws-us-gov):iam::[0-9]{12}:role\/[A-Za-z0-9+=,.@_-]{1,64}$/u.test(
      expectedAutoDeleteRoleArn ?? "",
    )
  )
    return false;
  const policy = parsePolicyDocument(policyResponse?.Policy);
  const statements = Array.isArray(policy?.Statement) ? policy.Statement : [];
  if (policy?.Version !== "2012-10-17" || statements.length !== 2) return false;
  const deny = statements.find((statement) => statement?.Effect === "Deny");
  const allow = statements.find((statement) => statement?.Effect === "Allow");
  const actions = Array.isArray(deny?.Action) ? deny.Action : [deny?.Action];
  const resources = Array.isArray(deny?.Resource)
    ? deny.Resource
    : [deny?.Resource];
  const allowActions = Array.isArray(allow?.Action)
    ? allow.Action
    : [allow?.Action];
  const allowResources = Array.isArray(allow?.Resource)
    ? allow.Resource
    : [allow?.Resource];
  return (
    deny?.NotAction === undefined &&
    deny?.NotPrincipal === undefined &&
    deny?.NotResource === undefined &&
    actions.length === 1 &&
    String(actions[0]).toLowerCase() === "s3:*" &&
    isDeepStrictEqual(deny?.Principal, { AWS: "*" }) &&
    isDeepStrictEqual([...resources].sort(), [
      expectedBucketArn,
      `${expectedBucketArn}/*`,
    ]) &&
    isDeepStrictEqual(deny?.Condition, {
      Bool: { "aws:SecureTransport": "false" },
    }) &&
    allow?.NotAction === undefined &&
    allow?.NotPrincipal === undefined &&
    allow?.NotResource === undefined &&
    allow?.Condition === undefined &&
    isDeepStrictEqual([...allowActions].sort(), [
      "s3:DeleteObject*",
      "s3:GetBucket*",
      "s3:List*",
      "s3:PutBucketPolicy",
    ]) &&
    isDeepStrictEqual(allow?.Principal, {
      AWS: expectedAutoDeleteRoleArn,
    }) &&
    isDeepStrictEqual([...allowResources].sort(), [
      expectedBucketArn,
      `${expectedBucketArn}/*`,
    ])
  );
}

export function hasExpectedLogBucketPublicAccessBoundary(
  publicAccessBlock,
  policyStatus,
) {
  return (
    isDeepStrictEqual(publicAccessBlock?.PublicAccessBlockConfiguration, {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    }) && policyStatus?.PolicyStatus?.IsPublic === false
  );
}

export function hasExpectedLogBucketLifecycle(lifecycle) {
  const rules = lifecycle?.Rules;
  if (!Array.isArray(rules) || rules.length !== 1) return false;
  const [rule] = rules;
  const allowedKeys = new Set([
    "AbortIncompleteMultipartUpload",
    "Expiration",
    "Filter",
    "ID",
    "Prefix",
    "Status",
  ]);
  if (Object.keys(rule ?? {}).some((key) => !allowedKeys.has(key)))
    return false;
  const wholeBucketFilter =
    (rule?.Filter === undefined &&
      (rule?.Prefix === undefined || rule.Prefix === "")) ||
    (rule?.Prefix === undefined &&
      (isDeepStrictEqual(rule?.Filter, {}) ||
        isDeepStrictEqual(rule?.Filter, { Prefix: "" })));
  return (
    wholeBucketFilter &&
    rule?.Status === "Enabled" &&
    isDeepStrictEqual(rule?.Expiration, { Days: EDGE_LOG_RETENTION_DAYS }) &&
    isDeepStrictEqual(rule?.AbortIncompleteMultipartUpload, {
      DaysAfterInitiation: 1,
    })
  );
}

export function hasExpectedLogBucketEncryption(configuration) {
  const serverConfiguration = configuration?.ServerSideEncryptionConfiguration;
  const rules = serverConfiguration?.Rules;
  if (!Array.isArray(rules) || rules.length !== 1) return false;
  const [rule] = rules;
  return (
    isDeepStrictEqual(Object.keys(serverConfiguration), ["Rules"]) &&
    isDeepStrictEqual(
      Object.keys(rule ?? {}).sort(),
      rule?.BucketKeyEnabled === undefined
        ? ["ApplyServerSideEncryptionByDefault"]
        : ["ApplyServerSideEncryptionByDefault", "BucketKeyEnabled"],
    ) &&
    (rule?.BucketKeyEnabled === undefined || rule.BucketKeyEnabled === false) &&
    isDeepStrictEqual(rule?.ApplyServerSideEncryptionByDefault, {
      SSEAlgorithm: "AES256",
    })
  );
}

export function hasExpectedLogBucketVersioning(configuration) {
  return isDeepStrictEqual(configuration, {});
}

async function readBucketReplication(runAws, args) {
  try {
    return { absent: false, response: await runAws(args) };
  } catch (error) {
    if (
      error instanceof AwsCliError &&
      error.hasCode("ReplicationConfigurationNotFoundError")
    )
      return { absent: true };
    throw error;
  }
}

export function hasNoLogBucketReplication(replicationRead) {
  return (
    replicationRead?.absent === true &&
    replicationRead?.response === undefined &&
    Object.keys(replicationRead).length === 1
  );
}

function haveExpectedDimensions(actual, expected) {
  if (
    !Array.isArray(actual) ||
    !Array.isArray(expected) ||
    actual.length !== expected.length
  )
    return false;
  const actualDimensions = new Map(
    actual.map((dimension) => [dimension.Name, dimension.Value]),
  );
  return expected.every(
    (dimension) => actualDimensions.get(dimension.Name) === dimension.Value,
  );
}

export function haveExpectedDistributionOrigins(
  distributions,
  environment,
  expectedOriginDomain,
  originKey,
  expectedLogBucketDomain,
  expectedWebAclArn,
) {
  if (!Array.isArray(distributions)) return false;
  return distributions.every((distribution) => {
    const configuration = distribution?.configuration;
    const tags = distributionTagMap(distribution?.tags);
    const entitlementId = tags?.get("OfflineScormEntitlementId");
    const capability = expectedOriginCapability(
      originKey,
      environment,
      entitlementId,
    );
    const origins = configuration?.Origins;
    const originItems = origins?.Items;
    const origin = originItems?.[0];
    const customHeaders = origin?.CustomHeaders;
    const customHeaderItems = customHeaders?.Items;
    const headerMap = new Map(
      Array.isArray(customHeaderItems)
        ? customHeaderItems.map((header) => [
            header?.HeaderName,
            header?.HeaderValue,
          ])
        : [],
    );
    let completeConfigurationMatches = false;
    if (capability !== null) {
      try {
        assertOwnedConfiguration(
          configuration,
          environment,
          entitlementId,
          capability,
          expectedOriginDomain,
          expectedLogBucketDomain,
          expectedWebAclArn,
        );
        completeConfigurationMatches = true;
      } catch {
        // The qualification report records only the failed invariant, never configuration values.
      }
    }
    return (
      completeConfigurationMatches &&
      origins?.Quantity === 1 &&
      Array.isArray(originItems) &&
      originItems.length === 1 &&
      origin?.Id === "upskill-offline-package-host" &&
      origin?.DomainName === expectedOriginDomain &&
      origin?.ConnectionAttempts === 3 &&
      origin?.ConnectionTimeout === 10 &&
      isDeepStrictEqual(origin?.CustomOriginConfig, {
        HTTPPort: 80,
        HTTPSPort: 443,
        OriginProtocolPolicy: "https-only",
        OriginSslProtocols: { Quantity: 1, Items: ["TLSv1.2"] },
        OriginReadTimeout: 30,
        OriginKeepaliveTimeout: 5,
      }) &&
      customHeaders?.Quantity === 2 &&
      Array.isArray(customHeaderItems) &&
      customHeaderItems.length === 2 &&
      headerMap.size === 2 &&
      headerMap.get(ENTITLEMENT_HEADER) === entitlementId &&
      capability !== null &&
      ORIGIN_CAPABILITY.test(headerMap.get(ORIGIN_CAPABILITY_HEADER) ?? "") &&
      headerMap.get(ORIGIN_CAPABILITY_HEADER) === capability &&
      configuration?.DefaultCacheBehavior?.TargetOriginId ===
        "upskill-offline-package-host"
    );
  });
}

export function haveExpectedDistributionLogging(
  distributionConfigurations,
  environment,
  expectedLogBucketDomain,
) {
  if (!Array.isArray(distributionConfigurations)) return false;
  const markerPrefix = `upskill:${environment}:offline-scorm:`;
  return distributionConfigurations.every(
    ({ inventoryComment, configuration }) => {
      if (
        typeof inventoryComment !== "string" ||
        configuration?.Comment !== inventoryComment ||
        !inventoryComment.startsWith(markerPrefix)
      )
        return false;
      const entitlementDigest = inventoryComment.slice(markerPrefix.length);
      if (!/^[a-f0-9]{32}$/u.test(entitlementDigest)) return false;
      return (
        configuration.Logging?.Enabled === true &&
        configuration.Logging.IncludeCookies === false &&
        configuration.Logging.Bucket === expectedLogBucketDomain &&
        configuration.Logging.Prefix ===
          `offline-scorm/${environment}/${entitlementDigest}/`
      );
    },
  );
}

function expectedDistributionAccessLogObjectPrefix(distribution, environment) {
  const markerPrefix = `upskill:${environment}:offline-scorm:`;
  const inventoryComment = distribution?.inventoryComment;
  if (
    !CLOUDFRONT_DISTRIBUTION_ID.test(distribution?.distributionId ?? "") ||
    typeof inventoryComment !== "string" ||
    !inventoryComment.startsWith(markerPrefix)
  )
    return null;
  const digest = inventoryComment.slice(markerPrefix.length);
  if (!/^[a-f0-9]{32}$/u.test(digest)) return null;
  const loggingPrefix = `offline-scorm/${environment}/${digest}/`;
  if (distribution?.configuration?.Logging?.Prefix !== loggingPrefix)
    return null;
  return `${loggingPrefix}${distribution.distributionId}.`;
}

function hasCurrentAccessLogObject(evidence, startTime, generatedAt) {
  const startAt = Date.parse(startTime);
  const endAt = Date.parse(generatedAt);
  const objectPrefix = evidence?.objectPrefix;
  const contents = evidence?.response?.Contents;
  if (
    !Number.isFinite(startAt) ||
    !Number.isFinite(endAt) ||
    typeof objectPrefix !== "string" ||
    !Array.isArray(contents) ||
    contents.length !== 1
  )
    return false;
  const [object] = contents;
  if (typeof object?.Key !== "string" || !object.Key.startsWith(objectPrefix))
    return false;
  const keyMatch =
    /^(\d{4})-(\d{2})-(\d{2})-(\d{2})\.[A-Za-z0-9_-]+\.gz$/u.exec(
      object.Key.slice(objectPrefix.length),
    );
  if (keyMatch === null) return false;
  const eventHour = Date.UTC(
    Number(keyMatch[1]),
    Number(keyMatch[2]) - 1,
    Number(keyMatch[3]),
    Number(keyMatch[4]),
  );
  const lastModifiedAt = Date.parse(object.LastModified ?? "");
  const eventHourText = keyMatch.slice(1, 5).join("-");
  return (
    new Date(eventHour).toISOString().slice(0, 13).replace("T", "-") ===
      eventHourText &&
    eventHour >= startAt - (startAt % (60 * 60_000)) &&
    eventHour <= endAt &&
    lastModifiedAt >= startAt &&
    lastModifiedAt <= endAt + 5 * 60_000
  );
}

export function hasCurrentAccessLogEvidence(
  evidenceByDistribution,
  startTime,
  generatedAt,
) {
  return (
    Array.isArray(evidenceByDistribution) &&
    evidenceByDistribution.length > 0 &&
    evidenceByDistribution.every((evidence) =>
      hasCurrentAccessLogObject(evidence, startTime, generatedAt),
    )
  );
}

function hasOnlyEmptyAction(action, expectedAction) {
  return (
    action !== null &&
    typeof action === "object" &&
    !Array.isArray(action) &&
    Object.keys(action).length === 1 &&
    action[expectedAction] !== null &&
    typeof action[expectedAction] === "object" &&
    !Array.isArray(action[expectedAction]) &&
    Object.keys(action[expectedAction]).length === 0
  );
}

function hasExpectedWafVisibility(visibilityConfig, metricName) {
  return isDeepStrictEqual(visibilityConfig, {
    CloudWatchMetricsEnabled: true,
    MetricName: metricName,
    SampledRequestsEnabled: true,
  });
}

export function hasExpectedWebAclBaseline(webAcl, environment) {
  if (!hasOnlyEmptyAction(webAcl?.DefaultAction, "Allow")) return false;
  const metricPrefix = `upskill-${environment}-offline-scorm`;
  if (
    !hasExpectedWafVisibility(webAcl?.VisibilityConfig, `${metricPrefix}-all`)
  )
    return false;
  if (!Array.isArray(webAcl?.Rules) || webAcl.Rules.length !== 3) return false;
  const rules = new Map(webAcl.Rules.map((rule) => [rule.Name, rule]));
  const ipReputation = rules.get("aws-managed-ip-reputation");
  const commonProtections = rules.get(
    "aws-managed-common-protections-qualification",
  );
  const rateLimit = rules.get("per-ip-request-rate");
  return (
    ipReputation?.Priority === 0 &&
    hasOnlyEmptyAction(ipReputation.OverrideAction, "None") &&
    hasExpectedWafVisibility(
      ipReputation.VisibilityConfig,
      `${metricPrefix}-ip-reputation`,
    ) &&
    isDeepStrictEqual(ipReputation.Statement, {
      ManagedRuleGroupStatement: {
        Name: "AWSManagedRulesAmazonIpReputationList",
        VendorName: "AWS",
      },
    }) &&
    commonProtections?.Priority === 1 &&
    hasOnlyEmptyAction(commonProtections.OverrideAction, "Count") &&
    hasExpectedWafVisibility(
      commonProtections.VisibilityConfig,
      `${metricPrefix}-common-count`,
    ) &&
    isDeepStrictEqual(commonProtections.Statement, {
      ManagedRuleGroupStatement: {
        Name: "AWSManagedRulesCommonRuleSet",
        VendorName: "AWS",
      },
    }) &&
    rateLimit?.Priority === 2 &&
    hasOnlyEmptyAction(rateLimit.Action, "Block") &&
    hasExpectedWafVisibility(
      rateLimit.VisibilityConfig,
      `${metricPrefix}-rate-limit`,
    ) &&
    isDeepStrictEqual(rateLimit.Statement, {
      RateBasedStatement: {
        AggregateKeyType: "IP",
        EvaluationWindowSec: 300,
        Limit: 2_000,
      },
    })
  );
}

export function hasExpectedWafLoggingBaseline(
  loggingConfiguration,
  webAclArn,
  wafLogGroupName,
) {
  if (loggingConfiguration?.ResourceArn !== webAclArn) return false;
  const destinations = loggingConfiguration.LogDestinationConfigs;
  if (
    !Array.isArray(destinations) ||
    destinations.length !== 1 ||
    typeof destinations[0] !== "string" ||
    !destinations[0].endsWith(`:${wafLogGroupName}`)
  )
    return false;
  const redactedFields = loggingConfiguration.RedactedFields;
  if (!Array.isArray(redactedFields) || redactedFields.length !== 3)
    return false;
  const hasHeader = (name) =>
    redactedFields.some((field) =>
      isDeepStrictEqual(field, { SingleHeader: { Name: name } }),
    );
  if (
    !hasHeader("authorization") ||
    !hasHeader("cookie") ||
    !redactedFields.some((field) =>
      isDeepStrictEqual(field, { QueryString: {} }),
    )
  )
    return false;
  const loggingFilter = loggingConfiguration.LoggingFilter;
  if (
    loggingFilter?.DefaultBehavior !== "DROP" ||
    !Array.isArray(loggingFilter.Filters) ||
    loggingFilter.Filters.length !== 1
  )
    return false;
  const [filter] = loggingFilter.Filters;
  if (
    filter?.Behavior !== "KEEP" ||
    filter?.Requirement !== "MEETS_ANY" ||
    !Array.isArray(filter?.Conditions) ||
    filter.Conditions.length !== 2
  )
    return false;
  const retainedActions = new Set(
    filter.Conditions.map((condition) => condition?.ActionCondition?.Action),
  );
  return (
    retainedActions.size === 2 &&
    retainedActions.has("BLOCK") &&
    retainedActions.has("COUNT")
  );
}

export function hasExpectedWafLogGroupBaseline(logGroup, wafLogGroupName) {
  return (
    logGroup?.logGroupName === wafLogGroupName &&
    logGroup?.retentionInDays === 30 &&
    logGroup?.kmsKeyId === undefined
  );
}

export function hasExpectedWafLogDeliveryPolicy(
  accountPoliciesResponse,
  resourcePoliciesResponse,
  logGroupArn,
  expectedAccount,
) {
  const expectedSourceArn = `arn:aws:logs:${CLOUDFRONT_CONTROL_PLANE_REGION}:${expectedAccount}:*`;
  const expectedLogStreamArn = `${logGroupArn}:log-stream:*`;
  const requiredActions = ["logs:CreateLogStream", "logs:PutLogEvents"];
  const list = (value) => (Array.isArray(value) ? value : [value]);
  const patternMatches = (pattern, value) =>
    typeof pattern === "string" && actionPatternMatches(pattern, value);
  const actionApplies = (statement) => {
    if (statement?.NotAction !== undefined)
      return requiredActions.some(
        (action) =>
          !list(statement.NotAction).some((pattern) =>
            patternMatches(pattern, action),
          ),
      );
    return requiredActions.some((action) =>
      list(statement?.Action).some((pattern) =>
        patternMatches(pattern, action),
      ),
    );
  };
  const resourceApplies = (statement) => {
    const matchesLogStream = (pattern) =>
      pattern === "*" ||
      (typeof pattern === "string" &&
        (pattern.startsWith(`${logGroupArn}:log-stream:`) ||
          patternMatches(
            pattern,
            `${logGroupArn}:log-stream:qualification-probe`,
          )));
    if (statement?.NotResource !== undefined)
      return !list(statement.NotResource).some(
        (pattern) =>
          pattern === expectedLogStreamArn ||
          pattern === "*" ||
          patternMatches(pattern, expectedLogStreamArn),
      );
    return list(statement?.Resource).some(matchesLogStream);
  };
  const policies = [
    ...(accountPoliciesResponse?.resourcePolicies ?? []),
    ...(resourcePoliciesResponse?.resourcePolicies ?? []),
  ];
  let hasUnevaluablePolicy = false;
  const statements = policies.flatMap((resourcePolicy) => {
    if (
      resourcePolicy?.policyScope === "RESOURCE" &&
      resourcePolicy?.resourceArn !== logGroupArn
    )
      return [];
    const policy = parsePolicyDocument(resourcePolicy?.policyDocument);
    if (policy?.Version !== "2012-10-17" || !Array.isArray(policy.Statement)) {
      const inspectableStatements = Array.isArray(policy?.Statement)
        ? policy.Statement
        : policy?.Statement !== null && typeof policy?.Statement === "object"
          ? [policy.Statement]
          : null;
      hasUnevaluablePolicy ||=
        inspectableStatements === null ||
        inspectableStatements.some(
          (statement) => actionApplies(statement) && resourceApplies(statement),
        );
      return [];
    }
    return policy.Statement;
  });
  const isExpectedAllow = (statement) => {
    const actions = Array.isArray(statement?.Action)
      ? statement.Action
      : [statement?.Action];
    const resources = Array.isArray(statement?.Resource)
      ? statement.Resource
      : [statement?.Resource];
    const services = Array.isArray(statement?.Principal?.Service)
      ? statement.Principal.Service
      : [statement?.Principal?.Service];
    const sourceAccounts = Array.isArray(
      statement?.Condition?.StringEquals?.["aws:SourceAccount"],
    )
      ? statement.Condition.StringEquals["aws:SourceAccount"]
      : [statement?.Condition?.StringEquals?.["aws:SourceAccount"]];
    const sourceArns = Array.isArray(
      statement?.Condition?.ArnLike?.["aws:SourceArn"],
    )
      ? statement.Condition.ArnLike["aws:SourceArn"]
      : [statement?.Condition?.ArnLike?.["aws:SourceArn"]];
    return (
      statement?.Effect === "Allow" &&
      isDeepStrictEqual(services, ["delivery.logs.amazonaws.com"]) &&
      isDeepStrictEqual([...actions].sort(), [
        "logs:CreateLogStream",
        "logs:PutLogEvents",
      ]) &&
      isDeepStrictEqual(resources, [expectedLogStreamArn]) &&
      isDeepStrictEqual(sourceAccounts, [expectedAccount]) &&
      isDeepStrictEqual(sourceArns, [expectedSourceArn]) &&
      isDeepStrictEqual(Object.keys(statement?.Condition ?? {}).sort(), [
        "ArnLike",
        "StringEquals",
      ]) &&
      isDeepStrictEqual(Object.keys(statement.Condition.StringEquals ?? {}), [
        "aws:SourceAccount",
      ]) &&
      isDeepStrictEqual(Object.keys(statement.Condition.ArnLike ?? {}), [
        "aws:SourceArn",
      ]) &&
      statement?.NotAction === undefined &&
      statement?.NotPrincipal === undefined &&
      statement?.NotResource === undefined
    );
  };
  const hasExpectedAllow = statements.some(isExpectedAllow);
  const expectedService = "delivery.logs.amazonaws.com";
  const principalApplies = (statement) => {
    const principal = statement?.Principal;
    const notPrincipal = statement?.NotPrincipal;
    const matches = (candidate) =>
      candidate === "*" ||
      list(candidate?.Service).some((pattern) =>
        patternMatches(pattern, expectedService),
      ) ||
      list(candidate?.AWS).some((pattern) => pattern === "*");
    if (notPrincipal !== undefined) return !matches(notPrincipal);
    return matches(principal);
  };
  const hasApplicableDeny = statements.some(
    (statement) =>
      statement?.Effect === "Deny" &&
      principalApplies(statement) &&
      actionApplies(statement) &&
      resourceApplies(statement),
  );
  const hasUnexpectedApplicableAllow = statements.some(
    (statement) =>
      statement?.Effect === "Allow" &&
      actionApplies(statement) &&
      resourceApplies(statement) &&
      !isExpectedAllow(statement),
  );
  return (
    !hasUnevaluablePolicy &&
    hasExpectedAllow &&
    !hasApplicableDeny &&
    !hasUnexpectedApplicableAllow
  );
}

function confirmedSubscriptions(response) {
  return (response.Subscriptions ?? []).filter(
    (subscription) =>
      typeof subscription?.SubscriptionArn === "string" &&
      subscription.SubscriptionArn !== "PendingConfirmation" &&
      subscription.SubscriptionArn !== "Deleted",
  );
}

function confirmedEmailSubscriptions(response, topicArn, expectedEndpoint) {
  return confirmedSubscriptions(response).filter(
    (subscription) =>
      subscription.Protocol === "email" &&
      subscription.Endpoint === expectedEndpoint &&
      subscription.SubscriptionArn.startsWith(`${topicArn}:`),
  );
}

export function hasConfirmedEmailSubscription(
  response,
  topicArn,
  expectedEndpoint,
) {
  const confirmed = confirmedSubscriptions(response);
  return (
    confirmed.length === 1 &&
    confirmedEmailSubscriptions(response, topicArn, expectedEndpoint).length ===
      1
  );
}

export function hasExpectedAlarmSubscription(
  response,
  attributesResponse,
  topicArn,
  expectedEndpoint,
  expectedAccount,
) {
  if (confirmedSubscriptions(response).length !== 1) return false;
  const subscriptions = confirmedEmailSubscriptions(
    response,
    topicArn,
    expectedEndpoint,
  );
  if (subscriptions.length !== 1) return false;
  const [subscription] = subscriptions;
  const attributes = attributesResponse?.Attributes;
  return (
    attributes?.SubscriptionArn === subscription.SubscriptionArn &&
    attributes?.TopicArn === topicArn &&
    attributes?.Protocol === "email" &&
    attributes?.Endpoint === expectedEndpoint &&
    attributes?.Owner === expectedAccount &&
    (attributes?.PendingConfirmation === undefined ||
      attributes.PendingConfirmation === "false") &&
    attributes?.FilterPolicy === undefined &&
    attributes?.FilterPolicyScope === undefined &&
    attributes?.RedrivePolicy === undefined
  );
}

async function effectiveCloudFrontQuota(runAws) {
  const args = [
    "service-quotas",
    "get-service-quota",
    "--service-code",
    "cloudfront",
    "--quota-code",
    CLOUDFRONT_DISTRIBUTION_QUOTA_CODE,
    "--region",
    CLOUDFRONT_CONTROL_PLANE_REGION,
  ];
  try {
    const response = await runAws(args);
    return { source: "account", value: response.Quota?.Value };
  } catch (error) {
    if (
      !(error instanceof AwsCliError) ||
      !error.hasCode("NoSuchResourceException")
    )
      throw error;
    const response = await runAws([
      "service-quotas",
      "get-aws-default-service-quota",
      "--service-code",
      "cloudfront",
      "--quota-code",
      CLOUDFRONT_DISTRIBUTION_QUOTA_CODE,
      "--region",
      CLOUDFRONT_CONTROL_PLANE_REGION,
    ]);
    return { source: "aws-default", value: response.Quota?.Value };
  }
}

function addCheck(checks, id, passed, summary, severity = "fail") {
  checks.push({
    id,
    status: passed ? "pass" : severity === "warning" ? "warning" : "fail",
    summary,
  });
}

function stackName(environment, suffix) {
  return `upskill-${environment}-${suffix}`;
}

function workerSecretNames(environment) {
  return [
    `upskill/${environment}/access-code/v1`,
    `upskill/${environment}/application`,
    `upskill/${environment}/database`,
    `upskill/${environment}/database/web`,
    `upskill/${environment}/database/worker`,
    `upskill/${environment}/livekit`,
    `upskill/${environment}/offline-scorm`,
    `upskill/${environment}/offline-scorm/cloudfront-origin-key`,
  ];
}

export async function collectCloudFrontQualificationReport(
  options,
  dependencies = {},
) {
  const runAws = dependencies.runAws ?? runAwsJson;
  const now = dependencies.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const appStackName = stackName(options.environment, "application");
  const storageStackName = stackName(options.environment, "storage");
  const edgeStackName = stackName(
    options.environment,
    "offline-scorm-edge-security",
  );
  const identity = await runAws(["sts", "get-caller-identity"]);
  const accountId = requiredValue(
    identity.Account,
    "AWS caller account is unavailable",
  );
  if (accountId !== options.expectedAccount)
    throw new Error(
      `AWS caller account ${accountId} does not match --expected-account`,
    );

  const [
    applicationStack,
    edgeStack,
    storageStackResources,
    originParameter,
    allocatorTargetParameter,
    workerRuntimeTargetParameter,
    distributions,
    quota,
  ] = await Promise.all([
    runAws([
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      appStackName,
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      edgeStackName,
      "--region",
      CLOUDFRONT_CONTROL_PLANE_REGION,
    ]),
    runAws([
      "cloudformation",
      "list-stack-resources",
      "--stack-name",
      storageStackName,
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "ssm",
      "get-parameter",
      "--name",
      `/upskill/${options.environment}/offline-scorm/cloudfront-origin-domain`,
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "ssm",
      "get-parameter",
      "--name",
      `/upskill/${options.environment}/offline-scorm/cloudfront-allocator-function-name`,
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "ssm",
      "get-parameter",
      "--name",
      `/upskill/${options.environment}/offline-scorm/cloudfront-worker-runtime-target`,
      "--region",
      options.applicationRegion,
    ]),
    runAws(["cloudfront", "list-distributions"]),
    effectiveCloudFrontQuota(runAws),
  ]);

  const applicationOutputs = outputMap(applicationStack, appStackName);
  const edgeOutputs = outputMap(edgeStack, edgeStackName);
  const qualificationCap = requireQualificationDistributionCap(
    requiredOutput(
      applicationOutputs,
      "OfflineScormCloudFrontMaxDistributions",
      appStackName,
    ),
  );
  const webAclArn = requiredOutput(
    edgeOutputs,
    "OfflineScormCloudFrontWebAclArn",
    edgeStackName,
  );
  const webAclName = requiredOutput(
    edgeOutputs,
    "OfflineScormCloudFrontWebAclName",
    edgeStackName,
  );
  const wafLogGroupName = requiredOutput(
    edgeOutputs,
    "OfflineScormWafLogGroupName",
    edgeStackName,
  );
  const edgeAlarmTopicArn = requiredOutput(
    edgeOutputs,
    "OfflineScormEdgeAlarmTopicArn",
    edgeStackName,
  );
  const edgeAlarmKeyArn = requiredOutput(
    edgeOutputs,
    "OfflineScormEdgeAlarmKeyArn",
    edgeStackName,
  );
  const edgeAlarmEmail = requiredOutput(
    edgeOutputs,
    "OfflineScormEdgeAlarmEmail",
    edgeStackName,
  );
  const allocatorAlarmTopicArn = requiredOutput(
    applicationOutputs,
    "OfflineScormCloudFrontAllocatorAlarmTopicArn",
    appStackName,
  );
  const allocatorAlarmEmail = requiredOutput(
    applicationOutputs,
    "OfflineScormCloudFrontAllocatorAlarmEmail",
    appStackName,
  );
  const logBucketArn = requiredOutput(
    applicationOutputs,
    "OfflineScormEdgeLogBucketArn",
    appStackName,
  );
  const logBucketDomain = requiredOutput(
    applicationOutputs,
    "OfflineScormEdgeLogBucketDomain",
    appStackName,
  );
  const originKeySecretArn = requiredOutput(
    applicationOutputs,
    "OfflineScormCloudFrontOriginKeySecretArn",
    appStackName,
  );
  const allocatorFunctionName = requiredOutput(
    applicationOutputs,
    "OfflineScormCloudFrontAllocatorFunctionName",
    appStackName,
  );
  const allocatorQualifiedFunctionName = requiredOutput(
    applicationOutputs,
    "OfflineScormCloudFrontAllocatorQualifiedFunctionName",
    appStackName,
  );
  const allocatorCodeSha256 = requiredOutput(
    applicationOutputs,
    "OfflineScormCloudFrontAllocatorCodeSha256",
    appStackName,
  );
  const allocatorRoleArn = requiredOutput(
    applicationOutputs,
    "OfflineScormCloudFrontAllocatorRoleArn",
    appStackName,
  );
  const workerRoleArn = requiredOutput(
    applicationOutputs,
    "OfflineScormCloudFrontWorkerRoleArn",
    appStackName,
  );
  const applicationInstanceId = requiredOutput(
    applicationOutputs,
    "ApplicationInstanceId",
    appStackName,
  );
  const allocatorRoleMatch = IAM_ROLE_ARN.exec(allocatorRoleArn);
  const allocatorRoleName = allocatorRoleMatch?.[3].split("/").at(-1);
  const workerRoleMatch = IAM_ROLE_ARN.exec(workerRoleArn);
  const workerRoleName = workerRoleMatch?.[3].split("/").at(-1);
  const allocatorVersionMatch = LAMBDA_VERSION_ARN.exec(
    allocatorQualifiedFunctionName,
  );
  if (
    allocatorRoleMatch?.[2] !== accountId ||
    typeof allocatorRoleName !== "string" ||
    allocatorRoleName.length === 0
  )
    throw new Error("Offline SCORM allocator role output is invalid");
  if (
    workerRoleMatch?.[2] !== accountId ||
    typeof workerRoleName !== "string" ||
    workerRoleName.length === 0
  )
    throw new Error("Offline SCORM worker role output is invalid");
  if (
    allocatorVersionMatch?.[2] !== options.applicationRegion ||
    allocatorVersionMatch?.[3] !== accountId ||
    allocatorVersionMatch?.[4] !== allocatorFunctionName
  )
    throw new Error("Offline SCORM allocator version output is invalid");
  if (!EC2_INSTANCE_ID.test(applicationInstanceId))
    throw new Error("Application instance output is invalid");
  const workerRuntimeTargetParameterArn = `arn:${allocatorVersionMatch[1]}:ssm:${options.applicationRegion}:${accountId}:parameter/upskill/${options.environment}/offline-scorm/cloudfront-worker-runtime-target`;
  const originDomain = requiredValue(
    originParameter.Parameter?.Value,
    "CloudFront origin domain parameter is unavailable",
  );
  const [originKeySecret, originKeySecretPolicy] = await Promise.all([
    runAws([
      "secretsmanager",
      "get-secret-value",
      "--secret-id",
      originKeySecretArn,
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "secretsmanager",
      "get-resource-policy",
      "--secret-id",
      originKeySecretArn,
      "--region",
      options.applicationRegion,
    ]),
  ]);
  const originKey = requiredValue(
    originKeySecret.SecretString,
    "CloudFront origin key secret is unavailable",
  );
  if (originKey.length < 43 || originKey.length > 512)
    throw new Error("CloudFront origin key secret is invalid");
  const webAclMatch = CLOUDFRONT_WEB_ACL_ARN.exec(webAclArn);
  if (!webAclMatch || webAclMatch[1] !== webAclName)
    throw new Error("CloudFront Web ACL stack outputs are inconsistent");
  const logBucketMatch = S3_BUCKET_ARN.exec(logBucketArn);
  const logBucket = logBucketMatch?.[2];
  const logBucketAutoDeleteRoleArn = deploymentOwnedAutoDeleteRoleArn(
    storageStackResources,
    accountId,
    logBucketMatch?.[1],
  );
  if (typeof logBucket !== "string")
    throw new Error("CloudFront access-log bucket output is invalid");
  if (logBucketAutoDeleteRoleArn === null)
    throw new Error(
      "CloudFront access-log bucket cleanup role is not deployment-owned",
    );
  const logBucketAutoDeleteRoleName = IAM_ROLE_ARN.exec(
    logBucketAutoDeleteRoleArn,
  )?.[3];
  if (typeof logBucketAutoDeleteRoleName !== "string")
    throw new Error("CloudFront access-log bucket cleanup role is invalid");
  const distributionItems = distributions.DistributionList?.Items ?? [];
  if (!Array.isArray(distributionItems))
    throw new Error("CloudFront distribution inventory is invalid");
  const totalDistributionCount = distributionItems.length;
  const distributionQuota = Number(quota.value);
  if (!Number.isSafeInteger(distributionQuota) || distributionQuota < 1)
    throw new Error("CloudFront distribution quota is unavailable");
  const taggedDistributionInventory = await mapWithConcurrency(
    distributionItems,
    8,
    async (distribution) => {
      if (
        typeof distribution.Id !== "string" ||
        !CLOUDFRONT_DISTRIBUTION_ID.test(distribution.Id)
      )
        throw new Error("CloudFront distribution ID is invalid");
      const arnMatch = CLOUDFRONT_DISTRIBUTION_ARN.exec(distribution.ARN ?? "");
      if (arnMatch?.[1] !== accountId || arnMatch?.[2] !== distribution.Id)
        throw new Error("CloudFront distribution ARN is invalid");
      const [tagResponse, configurationResponse] = await Promise.all([
        runAws([
          "cloudfront",
          "list-tags-for-resource",
          "--resource",
          distribution.ARN,
        ]),
        runAws([
          "cloudfront",
          "get-distribution-config",
          "--id",
          distribution.Id,
        ]),
      ]);
      return {
        configuration: configurationResponse.DistributionConfig,
        deploymentStatus: distribution.Status,
        distributionArn: distribution.ARN,
        distributionId: distribution.Id,
        inventoryComment: distribution.Comment,
        tags: tagResponse.Tags?.Items,
        webAclId: distribution.WebACLId,
      };
    },
  );
  const { owned, duplicateMarkers } = classifyQualificationDistributions(
    taggedDistributionInventory,
    options.environment,
    webAclArn,
  );
  const headroom = evaluateQuotaHeadroom({
    distributionQuota,
    ownedDistributionCount: owned.length,
    qualificationCap,
    totalDistributionCount,
  });
  const ownedDistributionConfigurations = owned;
  const currentOwnedConfigurations = ownedDistributionConfigurations.map(
    ({ configuration }) => configuration,
  );

  const startTime = new Date(
    Date.parse(generatedAt) - options.lookbackHours * 60 * 60 * 1_000,
  ).toISOString();
  const edgeAlarmName = `upskill-${options.environment}-offline-scorm-waf-blocked-requests`;
  const workerAlarmName = `upskill-${options.environment}-worker-heartbeat`;
  const workerSignalStartTime = new Date(
    Date.parse(generatedAt) - 15 * 60_000,
  ).toISOString();
  const wafLogGroupArn = `arn:aws:logs:${CLOUDFRONT_CONTROL_PLANE_REGION}:${accountId}:log-group:${wafLogGroupName}`;
  const [
    webAcl,
    webAclTags,
    wafLogging,
    wafLogGroups,
    wafAccountLogPolicies,
    wafResourceLogPolicies,
    edgeSubscriptions,
    edgeAlarmTopicAttributes,
    edgeAlarmKeyDescription,
    edgeAlarmKeyPolicy,
    allocatorSubscriptions,
    allocatorAlarmTopicAttributes,
    edgeAlarms,
    allocatorAlarms,
    workerAlarms,
    workerMetrics,
    allocatorConfiguration,
    allocatorInvocationPolicy,
    allocatorRole,
    allocatorAttachedPolicies,
    allocatorInlinePolicyNames,
    workerInstances,
    workerRole,
    workerAttachedPolicies,
    workerInlinePolicyNames,
    workerInvocationSimulation,
    allocatorConcurrency,
    logBucketAutoDeleteRole,
    logBucketAcl,
    logBucketPublicAccessBlock,
    logBucketPolicyStatus,
    logBucketPolicy,
    logBucketLifecycle,
    logBucketEncryption,
    logBucketVersioning,
    logBucketReplication,
    cloudTrail,
    accessLogEvidence,
  ] = await Promise.all([
    runAws([
      "wafv2",
      "get-web-acl",
      "--name",
      webAclName,
      "--id",
      webAclMatch[2],
      "--scope",
      "CLOUDFRONT",
      "--region",
      CLOUDFRONT_CONTROL_PLANE_REGION,
    ]),
    runAws([
      "wafv2",
      "list-tags-for-resource",
      "--resource-arn",
      webAclArn,
      "--region",
      CLOUDFRONT_CONTROL_PLANE_REGION,
    ]),
    runAws([
      "wafv2",
      "get-logging-configuration",
      "--resource-arn",
      webAclArn,
      "--region",
      CLOUDFRONT_CONTROL_PLANE_REGION,
    ]),
    runAws([
      "logs",
      "describe-log-groups",
      "--log-group-name-prefix",
      wafLogGroupName,
      "--region",
      CLOUDFRONT_CONTROL_PLANE_REGION,
    ]),
    runAws([
      "logs",
      "describe-resource-policies",
      "--policy-scope",
      "ACCOUNT",
      "--no-paginate",
      "--region",
      CLOUDFRONT_CONTROL_PLANE_REGION,
    ]),
    runAws([
      "logs",
      "describe-resource-policies",
      "--resource-arn",
      wafLogGroupArn,
      "--policy-scope",
      "RESOURCE",
      "--no-paginate",
      "--region",
      CLOUDFRONT_CONTROL_PLANE_REGION,
    ]),
    runAws([
      "sns",
      "list-subscriptions-by-topic",
      "--topic-arn",
      edgeAlarmTopicArn,
      "--region",
      CLOUDFRONT_CONTROL_PLANE_REGION,
    ]),
    runAws([
      "sns",
      "get-topic-attributes",
      "--topic-arn",
      edgeAlarmTopicArn,
      "--region",
      CLOUDFRONT_CONTROL_PLANE_REGION,
    ]),
    runAws([
      "kms",
      "describe-key",
      "--key-id",
      edgeAlarmKeyArn,
      "--region",
      CLOUDFRONT_CONTROL_PLANE_REGION,
    ]),
    runAws([
      "kms",
      "get-key-policy",
      "--key-id",
      edgeAlarmKeyArn,
      "--policy-name",
      "default",
      "--region",
      CLOUDFRONT_CONTROL_PLANE_REGION,
    ]),
    runAws([
      "sns",
      "list-subscriptions-by-topic",
      "--topic-arn",
      allocatorAlarmTopicArn,
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "sns",
      "get-topic-attributes",
      "--topic-arn",
      allocatorAlarmTopicArn,
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "cloudwatch",
      "describe-alarms",
      "--alarm-names",
      edgeAlarmName,
      "--region",
      CLOUDFRONT_CONTROL_PLANE_REGION,
    ]),
    runAws([
      "cloudwatch",
      "describe-alarms",
      "--alarm-names",
      `upskill-${options.environment}-offline-scorm-cloudfront-allocator-errors`,
      `upskill-${options.environment}-offline-scorm-cloudfront-allocator-throttles`,
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "cloudwatch",
      "describe-alarms",
      "--alarm-names",
      workerAlarmName,
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "cloudwatch",
      "get-metric-statistics",
      "--namespace",
      "Upskill",
      "--metric-name",
      "WorkerActive",
      "--dimensions",
      `Name=Environment,Value=${options.environment}`,
      "--start-time",
      workerSignalStartTime,
      "--end-time",
      generatedAt,
      "--period",
      "300",
      "--statistics",
      "Maximum",
      "Minimum",
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "lambda",
      "get-function-configuration",
      "--function-name",
      allocatorQualifiedFunctionName,
      "--region",
      options.applicationRegion,
    ]),
    readAllocatorInvocationPolicy(
      runAws,
      allocatorFunctionName,
      allocatorVersionMatch[5],
      options.applicationRegion,
    ),
    runAws([
      "iam",
      "get-role",
      "--role-name",
      allocatorRoleName,
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "iam",
      "list-attached-role-policies",
      "--role-name",
      allocatorRoleName,
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "iam",
      "list-role-policies",
      "--role-name",
      allocatorRoleName,
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "ec2",
      "describe-instances",
      "--instance-ids",
      applicationInstanceId,
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "iam",
      "get-role",
      "--role-name",
      workerRoleName,
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "iam",
      "list-attached-role-policies",
      "--role-name",
      workerRoleName,
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "iam",
      "list-role-policies",
      "--role-name",
      workerRoleName,
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "iam",
      "simulate-principal-policy",
      "--policy-source-arn",
      workerRoleArn,
      "--action-names",
      "lambda:InvokeFunction",
      "--resource-arns",
      allocatorQualifiedFunctionName,
      "--no-paginate",
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "lambda",
      "get-function-concurrency",
      "--function-name",
      allocatorFunctionName,
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "iam",
      "get-role",
      "--role-name",
      logBucketAutoDeleteRoleName,
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "s3api",
      "get-bucket-acl",
      "--bucket",
      logBucket,
      "--expected-bucket-owner",
      accountId,
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "s3api",
      "get-public-access-block",
      "--bucket",
      logBucket,
      "--expected-bucket-owner",
      accountId,
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "s3api",
      "get-bucket-policy-status",
      "--bucket",
      logBucket,
      "--expected-bucket-owner",
      accountId,
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "s3api",
      "get-bucket-policy",
      "--bucket",
      logBucket,
      "--expected-bucket-owner",
      accountId,
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "s3api",
      "get-bucket-lifecycle-configuration",
      "--bucket",
      logBucket,
      "--expected-bucket-owner",
      accountId,
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "s3api",
      "get-bucket-encryption",
      "--bucket",
      logBucket,
      "--expected-bucket-owner",
      accountId,
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "s3api",
      "get-bucket-versioning",
      "--bucket",
      logBucket,
      "--expected-bucket-owner",
      accountId,
      "--region",
      options.applicationRegion,
    ]),
    readBucketReplication(runAws, [
      "s3api",
      "get-bucket-replication",
      "--bucket",
      logBucket,
      "--expected-bucket-owner",
      accountId,
      "--region",
      options.applicationRegion,
    ]),
    runAws([
      "cloudtrail",
      "lookup-events",
      "--lookup-attributes",
      "AttributeKey=EventSource,AttributeValue=cloudfront.amazonaws.com",
      "--start-time",
      startTime,
      "--end-time",
      generatedAt,
      "--max-items",
      "50",
      "--region",
      CLOUDFRONT_CONTROL_PLANE_REGION,
    ]),
    Promise.all(
      ownedDistributionConfigurations.map(async (distribution) => {
        const objectPrefix = expectedDistributionAccessLogObjectPrefix(
          distribution,
          options.environment,
        );
        if (objectPrefix === null)
          return {
            distributionId: distribution.distributionId,
            objectPrefix,
            response: null,
          };
        const startAfter = `${objectPrefix}${startTime
          .slice(0, 13)
          .replace("T", "-")}`;
        return {
          distributionId: distribution.distributionId,
          objectPrefix,
          response: await runAws([
            "s3api",
            "list-objects-v2",
            "--bucket",
            logBucket,
            "--prefix",
            objectPrefix,
            "--start-after",
            startAfter,
            "--max-items",
            "1",
            "--expected-bucket-owner",
            accountId,
            "--region",
            options.applicationRegion,
          ]),
        };
      }),
    ),
  ]);
  const workerProfileBinding = workerInstanceProfileBinding(
    workerInstances,
    applicationInstanceId,
  );
  const edgeConfirmedSubscriptions = confirmedEmailSubscriptions(
    edgeSubscriptions,
    edgeAlarmTopicArn,
    edgeAlarmEmail,
  );
  const allocatorConfirmedSubscriptions = confirmedEmailSubscriptions(
    allocatorSubscriptions,
    allocatorAlarmTopicArn,
    allocatorAlarmEmail,
  );
  const edgeSubscriptionArn =
    edgeConfirmedSubscriptions.length === 1
      ? edgeConfirmedSubscriptions[0].SubscriptionArn
      : null;
  const allocatorSubscriptionArn =
    allocatorConfirmedSubscriptions.length === 1
      ? allocatorConfirmedSubscriptions[0].SubscriptionArn
      : null;
  const [
    allocatorInlinePolicies,
    workerInlinePolicies,
    workerInstanceProfile,
    edgeSubscriptionAttributes,
    allocatorSubscriptionAttributes,
  ] = await Promise.all([
    Promise.all(
      (allocatorInlinePolicyNames.PolicyNames ?? []).map((policyName) =>
        runAws([
          "iam",
          "get-role-policy",
          "--role-name",
          allocatorRoleName,
          "--policy-name",
          policyName,
          "--region",
          options.applicationRegion,
        ]),
      ),
    ),
    Promise.all(
      (workerInlinePolicyNames.PolicyNames ?? []).map((policyName) =>
        runAws([
          "iam",
          "get-role-policy",
          "--role-name",
          workerRoleName,
          "--policy-name",
          policyName,
          "--region",
          options.applicationRegion,
        ]),
      ),
    ),
    workerProfileBinding === null
      ? Promise.resolve({})
      : runAws([
          "iam",
          "get-instance-profile",
          "--instance-profile-name",
          workerProfileBinding.profileName,
          "--region",
          options.applicationRegion,
        ]),
    edgeSubscriptionArn === null
      ? Promise.resolve({})
      : runAws([
          "sns",
          "get-subscription-attributes",
          "--subscription-arn",
          edgeSubscriptionArn,
          "--region",
          CLOUDFRONT_CONTROL_PLANE_REGION,
        ]),
    allocatorSubscriptionArn === null
      ? Promise.resolve({})
      : runAws([
          "sns",
          "get-subscription-attributes",
          "--subscription-arn",
          allocatorSubscriptionArn,
          "--region",
          options.applicationRegion,
        ]),
  ]);

  const attestationObservedAt = now().toISOString();
  const checks = [];
  addCheck(
    checks,
    "origin-domain",
    originDomain === options.expectedOriginDomain,
    "Direct origin matches the expected staging domain",
  );
  addCheck(
    checks,
    "risk-acceptance",
    applicationOutputs.get("OfflineScormCloudFrontSharedHostRiskAcceptance") ===
      "staging-qualification-only",
    "Shared-host staging-only risk acceptance is present",
  );
  addCheck(
    checks,
    "allocator-target",
    hasExpectedWorkerRuntimeTarget(
      allocatorTargetParameter,
      workerRuntimeTargetParameter,
      `/upskill/${options.environment}/offline-scorm/cloudfront-allocator-function-name`,
      `/upskill/${options.environment}/offline-scorm/cloudfront-worker-runtime-target`,
      allocatorQualifiedFunctionName,
      attestationObservedAt,
    ),
    "Worker configuration and fresh process-owned runtime attestation target the deployment-owned immutable allocator version",
  );
  addCheck(
    checks,
    "origin-key-resource-policy",
    hasNoOriginKeyResourcePolicy(originKeySecretPolicy, originKeySecretArn),
    "CloudFront origin-key secret has no resource-based access policy",
  );
  addCheck(
    checks,
    "allocator-configuration",
    hasExpectedAllocatorConfiguration(
      allocatorConfiguration,
      allocatorConcurrency,
      {
        accountId,
        applicationRegion: options.applicationRegion,
        codeSha256: allocatorCodeSha256,
        environment: options.environment,
        functionName: allocatorFunctionName,
        logBucketDomain,
        originDomain,
        originKeySecretArn,
        qualificationCap,
        qualifiedFunctionName: allocatorQualifiedFunctionName,
        roleArn: allocatorRoleArn,
        webAclName,
      },
    ),
    "Immutable allocator version matches its deployment-recorded code digest, role, runtime, environment and reserved-concurrency baseline",
  );
  addCheck(
    checks,
    "allocator-invocation-policy",
    hasNoAllocatorInvocationPolicy(allocatorInvocationPolicy),
    "Immutable allocator version has no resource-based invocation grants",
  );
  addCheck(
    checks,
    "allocator-role-boundary",
    hasExpectedAllocatorRoleBoundary(
      allocatorRole,
      allocatorAttachedPolicies,
      allocatorInlinePolicyNames,
      allocatorInlinePolicies,
      {
        accountId,
        logBucketArn,
        originKeySecretArn,
        roleArn: allocatorRoleArn,
        webAclArn,
      },
    ),
    "Allocator trust, managed policy and inline permissions match the least-privilege deployment baseline",
  );
  addCheck(
    checks,
    "worker-instance-profile",
    hasExpectedWorkerInstanceProfile(
      workerInstances,
      workerInstanceProfile,
      applicationInstanceId,
      workerRoleArn,
    ),
    "Live application instance profile contains exactly the deployment-owned worker role",
  );
  addCheck(
    checks,
    "worker-heartbeat",
    hasCurrentHealthyWorkerSignal(
      workerMetrics,
      workerAlarms,
      generatedAt,
      workerAlarmName,
    ),
    "Application worker has a current healthy WorkerActive signal and its heartbeat alarm is OK",
  );
  addCheck(
    checks,
    "worker-allocator-policy-boundary",
    hasExpectedWorkerAllocatorPolicyBoundary(
      workerRole,
      workerAttachedPolicies,
      workerInlinePolicyNames,
      workerInlinePolicies,
      workerRoleArn,
      allocatorQualifiedFunctionName,
      workerRuntimeTargetParameterArn,
      logBucketArn,
      workerSecretNames(options.environment),
    ),
    "Application worker has only qualified-boundary-safe actions and deployment-owned secret reads plus exact allocator invoke, runtime attestation and metric grants",
  );
  addCheck(
    checks,
    "worker-allocator-permission",
    canWorkerInvokePinnedAllocator(
      workerInvocationSimulation,
      allocatorQualifiedFunctionName,
    ),
    "Application worker role is authorized to invoke the deployment-owned allocator version",
  );
  addCheck(
    checks,
    "access-log-cleanup-role-boundary",
    hasExpectedLogCleanupRoleBoundary(
      logBucketAutoDeleteRole,
      logBucketAutoDeleteRoleArn,
    ),
    "CloudFront access-log cleanup role retains its deployment-owned Lambda-only trust boundary",
  );
  addCheck(
    checks,
    "access-log-bucket-acl",
    hasExpectedCloudFrontLogDeliveryAcl(logBucketAcl),
    "CloudFront log-delivery retains only its required bucket ACL grants and owner control",
  );
  addCheck(
    checks,
    "access-log-bucket-public-access",
    hasExpectedLogBucketPublicAccessBoundary(
      logBucketPublicAccessBlock,
      logBucketPolicyStatus,
    ),
    "CloudFront access-log bucket blocks every public-access path and has no public policy",
  );
  addCheck(
    checks,
    "access-log-bucket-policy",
    hasExpectedLogBucketPolicy(
      logBucketPolicy,
      logBucketArn,
      logBucketAutoDeleteRoleArn,
    ),
    "CloudFront access-log bucket retains only its TLS deny and deployment-owned staging cleanup grant",
  );
  addCheck(
    checks,
    "access-log-bucket-lifecycle",
    hasExpectedLogBucketLifecycle(logBucketLifecycle),
    "CloudFront access-log bucket retains objects for 30 days and aborts incomplete multipart uploads after one day",
  );
  addCheck(
    checks,
    "access-log-bucket-encryption",
    hasExpectedLogBucketEncryption(logBucketEncryption),
    "CloudFront access-log bucket retains its exact SSE-S3 encryption baseline",
  );
  addCheck(
    checks,
    "access-log-bucket-versioning",
    hasExpectedLogBucketVersioning(logBucketVersioning),
    "CloudFront access-log bucket retains its exact unversioned baseline",
  );
  addCheck(
    checks,
    "access-log-bucket-replication",
    hasNoLogBucketReplication(logBucketReplication),
    "CloudFront access-log bucket has no replication configuration",
  );
  addCheck(
    checks,
    "web-acl",
    webAcl.WebACL?.ARN === webAclArn &&
      hasExpectedWebAclBaseline(webAcl.WebACL, options.environment),
    "CloudFront-scoped WAF matches the mandatory rules and emits the aggregate metric used by the edge alarm",
  );
  const tags = new Map(
    (webAclTags.TagInfoForResource?.TagList ?? []).map((tag) => [
      tag.Key,
      tag.Value,
    ]),
  );
  addCheck(
    checks,
    "web-acl-tags",
    tags.get("Application") === "upskill" &&
      tags.get("Environment") === options.environment &&
      tags.get("Purpose") === "offline-scorm-qualification",
    "CloudFront WAF ownership tags match qualification scope",
  );
  addCheck(
    checks,
    "waf-logging",
    hasExpectedWafLoggingBaseline(
      wafLogging.LoggingConfiguration,
      webAclArn,
      wafLogGroupName,
    ),
    "WAF logging targets the expected log group, redacts credentials and query strings, and retains only BLOCK/COUNT records",
  );
  const logGroup = (wafLogGroups.logGroups ?? []).find(
    (group) => group.logGroupName === wafLogGroupName,
  );
  addCheck(
    checks,
    "waf-log-retention",
    hasExpectedWafLogGroupBaseline(logGroup, wafLogGroupName),
    "Staging WAF log group has 30-day retention and no unexpected KMS association",
  );
  addCheck(
    checks,
    "waf-log-delivery-policy",
    hasExpectedWafLogDeliveryPolicy(
      wafAccountLogPolicies,
      wafResourceLogPolicies,
      wafLogGroupArn,
      accountId,
    ),
    "CloudWatch Logs policy grants the delivery service exact write access to the WAF log group",
  );
  addCheck(
    checks,
    "edge-alert-kms",
    hasExpectedEdgeAlarmKmsBoundary(
      edgeAlarmTopicAttributes,
      edgeAlarmKeyDescription,
      edgeAlarmKeyPolicy,
      {
        accountId,
        alarmName: edgeAlarmName,
        keyArn: edgeAlarmKeyArn,
        topicArn: edgeAlarmTopicArn,
      },
    ),
    "Edge alarm topic uses the enabled deployment-owned KMS key with the exact CloudWatch publish grant",
  );
  addCheck(
    checks,
    "edge-alert-topic-policy",
    hasExpectedAlarmTopicPolicy(edgeAlarmTopicAttributes, {
      accountId,
      alarmName: edgeAlarmName,
      kmsMasterKeyId: edgeAlarmKeyArn,
      region: CLOUDFRONT_CONTROL_PLANE_REGION,
      topicArn: edgeAlarmTopicArn,
    }),
    "Edge alarm topic policy grants only the expected same-account CloudWatch alarm publication path",
  );
  addCheck(
    checks,
    "edge-alert-subscription",
    hasExpectedAlarmSubscription(
      edgeSubscriptions,
      edgeSubscriptionAttributes,
      edgeAlarmTopicArn,
      edgeAlarmEmail,
      accountId,
    ),
    "Edge alarm topic has exactly one confirmed, unfiltered subscription for the configured operations email",
  );
  addCheck(
    checks,
    "allocator-alert-subscription",
    hasExpectedAlarmSubscription(
      allocatorSubscriptions,
      allocatorSubscriptionAttributes,
      allocatorAlarmTopicArn,
      allocatorAlarmEmail,
      accountId,
    ),
    "Allocator alarm topic has exactly one confirmed, unfiltered subscription for the configured operations email",
  );
  addCheck(
    checks,
    "allocator-alert-topic-policy",
    hasExpectedAlarmTopicPolicy(allocatorAlarmTopicAttributes, {
      accountId,
      alarmName: "*",
      kmsMasterKeyId: undefined,
      region: options.applicationRegion,
      topicArn: allocatorAlarmTopicArn,
    }),
    "Operational alarm topic policy grants the expected same-account CloudWatch alarm publication path",
  );
  const alarmDefaults = {
    comparisonOperator: "GreaterThanOrEqualToThreshold",
    evaluationPeriods: 1,
    period: 300,
    statistic: "Sum",
    treatMissingData: "notBreaching",
  };
  const expectedAlarmConfigurations = [
    {
      ...alarmDefaults,
      alarmName: edgeAlarmName,
      actionArn: edgeAlarmTopicArn,
      dimensions: [
        { Name: "Region", Value: "Global" },
        { Name: "Rule", Value: "ALL" },
        { Name: "WebACL", Value: webAclName },
      ],
      metricName: "BlockedRequests",
      namespace: "AWS/WAFV2",
      threshold: 100,
    },
    {
      ...alarmDefaults,
      alarmName: `upskill-${options.environment}-offline-scorm-cloudfront-allocator-errors`,
      actionArn: allocatorAlarmTopicArn,
      dimensions: [{ Name: "FunctionName", Value: allocatorFunctionName }],
      metricName: "Errors",
      namespace: "AWS/Lambda",
      threshold: 1,
    },
    {
      ...alarmDefaults,
      alarmName: `upskill-${options.environment}-offline-scorm-cloudfront-allocator-throttles`,
      actionArn: allocatorAlarmTopicArn,
      dimensions: [{ Name: "FunctionName", Value: allocatorFunctionName }],
      metricName: "Throttles",
      namespace: "AWS/Lambda",
      threshold: 1,
    },
    {
      alarmName: workerAlarmName,
      actionArn: allocatorAlarmTopicArn,
      comparisonOperator: "LessThanThreshold",
      dimensions: [{ Name: "Environment", Value: options.environment }],
      evaluationPeriods: 2,
      metricName: "WorkerActive",
      namespace: "Upskill",
      period: 300,
      statistic: "Maximum",
      threshold: 1,
      treatMissingData: "breaching",
      unit: undefined,
    },
  ];
  addCheck(
    checks,
    "alarms",
    haveExpectedAlarmConfigurations(
      [
        ...(edgeAlarms.MetricAlarms ?? []),
        ...(allocatorAlarms.MetricAlarms ?? []),
        ...(workerAlarms.MetricAlarms ?? []),
      ],
      expectedAlarmConfigurations,
    ),
    "WAF, allocator and worker alarms match their expected metrics, thresholds, evaluation and notification configuration",
  );
  addCheck(
    checks,
    "distribution-cap",
    owned.length <= qualificationCap && duplicateMarkers.length === 0,
    "Owned qualification distributions are within the cap and have unique markers",
  );
  addCheck(
    checks,
    "distribution-deployment",
    areOwnedDistributionsDeployed(ownedDistributionConfigurations),
    "Every owned qualification distribution has finished deploying to the CloudFront edge",
  );
  addCheck(
    checks,
    "distribution-ownership",
    haveExpectedDistributionOwnership(
      ownedDistributionConfigurations,
      options.environment,
      accountId,
    ),
    "Every owned qualification distribution has the expected account binding, entitlement marker and lifecycle ownership tags",
  );
  addCheck(
    checks,
    "distribution-waf-binding",
    currentOwnedConfigurations.every(
      (distribution) => distribution?.WebACLId === webAclArn,
    ),
    "Every owned qualification distribution is bound to the expected WAF",
  );
  addCheck(
    checks,
    "distribution-origin-binding",
    haveExpectedDistributionOrigins(
      ownedDistributionConfigurations,
      options.environment,
      options.expectedOriginDomain,
      originKey,
      logBucketDomain,
      webAclArn,
    ),
    "Every owned qualification distribution matches the allocator baseline, including direct origin, TLS transport and entitlement-bound protected headers",
  );
  addCheck(
    checks,
    "distribution-access-logging",
    haveExpectedDistributionLogging(
      ownedDistributionConfigurations,
      options.environment,
      logBucketDomain,
    ),
    "Every owned qualification distribution logs without cookies to its entitlement-specific prefix in the expected bucket",
  );
  addCheck(
    checks,
    "quota-headroom",
    headroom.sufficient,
    `CloudFront quota retains capacity for ${headroom.requiredAdditionalCapacity} additional qualification distributions`,
  );
  const mutationEvents = summarizeCloudTrailEvents(cloudTrail.Events ?? []);
  addCheck(
    checks,
    "cloudtrail-control-plane",
    true,
    `CloudTrail Event History returned ${mutationEvents.length} CloudFront mutation event(s) in the selected window`,
  );
  const accessLogEvidencePresent = hasCurrentAccessLogEvidence(
    accessLogEvidence,
    startTime,
    generatedAt,
  );
  const evidencedDistributionCount = accessLogEvidence.filter((evidence) =>
    hasCurrentAccessLogObject(evidence, startTime, generatedAt),
  ).length;
  addCheck(
    checks,
    "access-log-evidence",
    accessLogEvidencePresent,
    accessLogEvidencePresent
      ? `Recent CloudFront access-log evidence is present for all ${owned.length} owned distribution(s)`
      : owned.length === 0
        ? "No owned distribution is active; access-log evidence is not expected yet"
        : `Recent CloudFront access-log evidence is present for ${evidencedDistributionCount} of ${owned.length} owned distribution(s); standard delivery can be delayed`,
    "warning",
  );

  const failures = checks.filter((check) => check.status === "fail").length;
  const warnings = checks.filter((check) => check.status === "warning").length;
  return {
    accessLogEvidencePresent,
    accountId,
    checks,
    cloudTrailMutations: mutationEvents,
    generatedAt,
    headroom: { ...headroom, quotaSource: quota.source },
    status: failures > 0 ? "failed" : warnings > 0 ? "warning" : "passed",
    target: {
      applicationRegion: options.applicationRegion,
      environment: options.environment,
      webAclName,
    },
  };
}

function usage() {
  return `Usage: pnpm run qualify:offline-scorm:cloudfront -- --environment staging --expected-account <12-digit-account-id> --expected-origin-domain staging.upskill.institute [--application-region ap-southeast-2] [--lookback-hours 24]`;
}

async function main() {
  const options = parseQualificationArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const report = await collectCloudFrontQualificationReport(options);
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "failed") process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  await main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Qualification failed",
    );
    process.exitCode = 1;
  });
