import { createHash, createHmac } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

const ALLOCATOR_FORMAT = "upskill-offline-scorm-cloudfront-entitlement-v1";
const ORIGIN_CAPABILITY_FORMAT =
  "upskill-offline-scorm-cloudfront-origin-capability-v1";
const ENTITLEMENT_ID = /^[A-Za-z0-9_-]{1,255}$/u;
const DISTRIBUTION_ID = /^[A-Z0-9]{8,32}$/u;
const ORIGIN_DOMAIN =
  /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

function requiredEnvironment(name, pattern) {
  const value = process.env[name]?.trim();
  if (!value || !pattern.test(value))
    throw new Error(`Missing or invalid ${name}`);
  return value;
}

function assertEntitlementId(value) {
  if (typeof value !== "string" || !ENTITLEMENT_ID.test(value))
    throw new Error("Offline SCORM entitlement identifier is invalid");
  return value;
}

function entitlementDigest(environment, entitlementId) {
  return createHash("sha256")
    .update(ALLOCATOR_FORMAT, "utf8")
    .update("\0", "utf8")
    .update(environment, "utf8")
    .update("\0", "utf8")
    .update(entitlementId, "utf8")
    .digest("hex");
}

export function distributionMarker(environment, entitlementId) {
  return `upskill:${environment}:offline-scorm:${entitlementDigest(
    environment,
    assertEntitlementId(entitlementId),
  ).slice(0, 32)}`;
}

export function createOriginCapability(originKey, environment, entitlementId) {
  if (typeof originKey !== "string" || originKey.length < 43)
    throw new Error("Offline SCORM CloudFront origin key is invalid");
  return createHmac("sha256", originKey)
    .update(ORIGIN_CAPABILITY_FORMAT, "utf8")
    .update("\0", "utf8")
    .update(environment, "utf8")
    .update("\0", "utf8")
    .update(assertEntitlementId(entitlementId), "utf8")
    .digest("base64url");
}

export function parseAllocatorRequest(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new Error("Offline SCORM CloudFront request must be an object");
  const operation = input.operation;
  if (
    operation !== "allocate" &&
    operation !== "describe" &&
    operation !== "activate" &&
    operation !== "retire"
  )
    throw new Error("Offline SCORM CloudFront operation is invalid");
  const entitlementId = assertEntitlementId(input.entitlementId);
  if (operation === "allocate") return { operation, entitlementId };
  if (
    typeof input.distributionId !== "string" ||
    !DISTRIBUTION_ID.test(input.distributionId)
  )
    throw new Error("Offline SCORM CloudFront distribution ID is invalid");
  return { operation, entitlementId, distributionId: input.distributionId };
}

export function createDistributionConfig(input) {
  const environment = input.environment;
  if (environment !== "staging" && environment !== "production")
    throw new Error("Offline SCORM CloudFront environment is invalid");
  const entitlementId = assertEntitlementId(input.entitlementId);
  if (!ORIGIN_DOMAIN.test(input.originDomain))
    throw new Error("Offline SCORM CloudFront origin domain is invalid");
  if (
    typeof input.originCapability !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(input.originCapability)
  )
    throw new Error("Offline SCORM CloudFront origin capability is invalid");
  if (!ORIGIN_DOMAIN.test(input.logBucketDomain))
    throw new Error("Offline SCORM CloudFront log bucket domain is invalid");
  const marker = distributionMarker(environment, entitlementId);
  return {
    CallerReference: marker,
    Comment: marker,
    Enabled: false,
    IsIPV6Enabled: true,
    HttpVersion: "http2and3",
    PriceClass: "PriceClass_100",
    Origins: {
      Quantity: 1,
      Items: [
        {
          Id: "upskill-offline-package-host",
          DomainName: input.originDomain,
          ConnectionAttempts: 3,
          ConnectionTimeout: 10,
          CustomHeaders: {
            Quantity: 2,
            Items: [
              {
                HeaderName: "X-Upskill-Offline-Entitlement",
                HeaderValue: entitlementId,
              },
              {
                HeaderName: "X-Upskill-Offline-Origin-Capability",
                HeaderValue: input.originCapability,
              },
            ],
          },
          CustomOriginConfig: {
            HTTPPort: 80,
            HTTPSPort: 443,
            OriginProtocolPolicy: "https-only",
            OriginSslProtocols: { Quantity: 1, Items: ["TLSv1.2"] },
            OriginReadTimeout: 30,
            OriginKeepaliveTimeout: 5,
          },
        },
      ],
    },
    DefaultCacheBehavior: {
      TargetOriginId: "upskill-offline-package-host",
      ViewerProtocolPolicy: "https-only",
      Compress: false,
      AllowedMethods: {
        Quantity: 7,
        Items: ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"],
        CachedMethods: {
          Quantity: 3,
          Items: ["GET", "HEAD", "OPTIONS"],
        },
      },
      ForwardedValues: {
        QueryString: true,
        Cookies: { Forward: "none" },
        Headers: { Quantity: 1, Items: ["Origin"] },
      },
      MinTTL: 0,
      DefaultTTL: 0,
      MaxTTL: 0,
      SmoothStreaming: false,
      TrustedSigners: { Enabled: false, Quantity: 0 },
      TrustedKeyGroups: { Enabled: false, Quantity: 0 },
    },
    CacheBehaviors: { Quantity: 0 },
    CustomErrorResponses: { Quantity: 0 },
    OriginGroups: { Quantity: 0 },
    Aliases: { Quantity: 0 },
    Logging: {
      Enabled: true,
      IncludeCookies: false,
      Bucket: input.logBucketDomain,
      Prefix: `offline-scorm/${environment}/${entitlementDigest(
        environment,
        entitlementId,
      ).slice(0, 32)}/`,
    },
    Restrictions: {
      GeoRestriction: { RestrictionType: "none", Quantity: 0 },
    },
    ViewerCertificate: {
      CloudFrontDefaultCertificate: true,
    },
    WebACLId: "",
  };
}

let awsModulesPromise;
async function awsModules() {
  awsModulesPromise ??= Promise.all([
    import("@aws-sdk/client-cloudfront"),
    import("@aws-sdk/client-secrets-manager"),
  ]);
  const [cloudfront, secretsManager] = await awsModulesPromise;
  return { cloudfront, secretsManager };
}

let originKeyPromise;
async function readOriginKey(secretArn, secretsManager) {
  originKeyPromise ??= (async () => {
    const client = new secretsManager.SecretsManagerClient({});
    const response = await client.send(
      new secretsManager.GetSecretValueCommand({ SecretId: secretArn }),
    );
    const originKey = response.SecretString;
    if (typeof originKey !== "string" || originKey.length < 43)
      throw new Error(
        "Offline SCORM CloudFront origin key secret is unavailable",
      );
    return originKey;
  })();
  return await originKeyPromise;
}

function ownedTags(environment, entitlementId) {
  return new Map([
    ["Application", "upskill"],
    ["Environment", environment],
    ["OfflineScormEntitlementId", entitlementId],
    ["Purpose", "offline-scorm-qualification"],
  ]);
}

function distributionTags(environment, entitlementId) {
  return {
    Items: [...ownedTags(environment, entitlementId)].map(([Key, Value]) => ({
      Key,
      Value,
    })),
  };
}

export function assertOwnedConfiguration(
  config,
  environment,
  entitlementId,
  originCapability,
  originDomain,
  logBucketDomain,
) {
  const expected = createDistributionConfig({
    environment,
    entitlementId,
    originCapability,
    originDomain,
    logBucketDomain,
  });
  if (typeof config.Enabled !== "boolean")
    throw new Error(
      "Refusing to mutate a CloudFront distribution outside the exact entitlement boundary",
    );
  const expectedAtCurrentLifecycleState = {
    ...expected,
    Enabled: config.Enabled,
  };
  if (
    !isDeepStrictEqual(
      normalizeCloudFrontConfiguration(config),
      normalizeCloudFrontConfiguration(expectedAtCurrentLifecycleState),
    )
  )
    throw new Error(
      "Refusing to mutate a CloudFront distribution outside the exact entitlement boundary",
    );
}

function withoutProviderDefault(object, key, expectedValue) {
  if (!isDeepStrictEqual(object?.[key], expectedValue)) return object;
  return Object.fromEntries(
    Object.entries(object).filter(([entryKey]) => entryKey !== key),
  );
}

function normalizeCloudFrontConfiguration(config) {
  let normalized = structuredClone(config);
  normalized = withoutProviderDefault(normalized, "DefaultRootObject", "");
  normalized = withoutProviderDefault(normalized, "Staging", false);
  normalized = withoutProviderDefault(
    normalized,
    "ContinuousDeploymentPolicyId",
    "",
  );
  normalized = withoutProviderDefault(normalized, "ConnectionMode", "direct");
  normalized = withoutProviderDefault(normalized, "AnycastIpListId", "");

  let certificate = normalized.ViewerCertificate;
  if (certificate?.CloudFrontDefaultCertificate === true) {
    certificate = withoutProviderDefault(
      certificate,
      "SSLSupportMethod",
      "vip",
    );
    certificate = withoutProviderDefault(
      certificate,
      "MinimumProtocolVersion",
      "TLSv1",
    );
    certificate = withoutProviderDefault(
      certificate,
      "CertificateSource",
      "cloudfront",
    );
    normalized.ViewerCertificate = certificate;
  }

  if (normalized.Origins?.Items)
    normalized.Origins.Items = normalized.Origins.Items.map((origin) => {
      let normalizedOrigin = withoutProviderDefault(origin, "OriginPath", "");
      normalizedOrigin = withoutProviderDefault(
        normalizedOrigin,
        "OriginAccessControlId",
        "",
      );
      return withoutProviderDefault(normalizedOrigin, "OriginShield", {
        Enabled: false,
      });
    });

  let defaultBehavior = normalized.DefaultCacheBehavior;
  defaultBehavior = withoutProviderDefault(
    defaultBehavior,
    "FieldLevelEncryptionId",
    "",
  );
  defaultBehavior = withoutProviderDefault(
    defaultBehavior,
    "RealtimeLogConfigArn",
    "",
  );
  defaultBehavior = withoutProviderDefault(
    defaultBehavior,
    "CachePolicyId",
    "",
  );
  defaultBehavior = withoutProviderDefault(
    defaultBehavior,
    "OriginRequestPolicyId",
    "",
  );
  defaultBehavior = withoutProviderDefault(
    defaultBehavior,
    "ResponseHeadersPolicyId",
    "",
  );
  defaultBehavior = withoutProviderDefault(
    defaultBehavior,
    "LambdaFunctionAssociations",
    { Quantity: 0 },
  );
  defaultBehavior = withoutProviderDefault(
    defaultBehavior,
    "FunctionAssociations",
    { Quantity: 0 },
  );
  defaultBehavior = withoutProviderDefault(defaultBehavior, "GrpcConfig", {
    Enabled: false,
  });
  normalized.DefaultCacheBehavior = defaultBehavior;
  return normalized;
}

async function findOwnedDistribution(
  client,
  cloudfront,
  environment,
  entitlementId,
) {
  const marker = distributionMarker(environment, entitlementId);
  const matches = [];
  let Marker;
  do {
    const response = await client.send(
      new cloudfront.ListDistributionsCommand(Marker ? { Marker } : {}),
    );
    for (const distribution of response.DistributionList?.Items ?? [])
      if (distribution.Comment === marker) matches.push(distribution);
    Marker = response.DistributionList?.IsTruncated
      ? response.DistributionList.NextMarker
      : undefined;
  } while (Marker);
  if (matches.length !== 1)
    throw new Error(
      `Expected one recoverable CloudFront entitlement distribution; found ${matches.length}`,
    );
  return matches[0];
}

async function assertOwnedDistribution(
  client,
  cloudfront,
  environment,
  entitlementId,
  distributionId,
) {
  let response;
  try {
    response = await client.send(
      new cloudfront.GetDistributionCommand({ Id: distributionId }),
    );
  } catch (error) {
    if (error?.name === "NoSuchDistribution") return null;
    throw error;
  }
  const distribution = response.Distribution;
  if (!distribution?.ARN)
    throw new Error("CloudFront did not return an entitlement distribution");
  const tagResponse = await client.send(
    new cloudfront.ListTagsForResourceCommand({ Resource: distribution.ARN }),
  );
  const actualTags = new Map(
    (tagResponse.Tags?.Items ?? []).map((tag) => [tag.Key, tag.Value]),
  );
  for (const [key, value] of ownedTags(environment, entitlementId))
    if (actualTags.get(key) !== value)
      throw new Error(
        "Refusing to use an unowned CloudFront distribution for offline SCORM",
      );
  return distribution;
}

async function distributionConfiguration(
  client,
  cloudfront,
  environment,
  entitlementId,
  distributionId,
  originCapability,
  originDomain,
  logBucketDomain,
) {
  const response = await client.send(
    new cloudfront.GetDistributionConfigCommand({ Id: distributionId }),
  );
  if (!response.DistributionConfig || !response.ETag)
    throw new Error("CloudFront distribution configuration is unavailable");
  assertOwnedConfiguration(
    response.DistributionConfig,
    environment,
    entitlementId,
    originCapability,
    originDomain,
    logBucketDomain,
  );
  return { config: response.DistributionConfig, etag: response.ETag };
}

function publicDistribution(distribution, phase) {
  if (!distribution?.Id || !distribution.DomainName || !distribution.Status)
    throw new Error("CloudFront returned an incomplete distribution");
  return {
    phase,
    distributionId: distribution.Id,
    packageSiteOrigin: `https://${distribution.DomainName}`,
    status: distribution.Status,
  };
}

async function allocate(input, configuration, client, cloudfront) {
  const config = createDistributionConfig({
    ...configuration,
    entitlementId: input.entitlementId,
  });
  try {
    const response = await client.send(
      new cloudfront.CreateDistributionWithTagsCommand({
        DistributionConfigWithTags: {
          DistributionConfig: config,
          Tags: distributionTags(
            configuration.environment,
            input.entitlementId,
          ),
        },
      }),
    );
    return publicDistribution(response.Distribution, "allocated-disabled");
  } catch (error) {
    if (error?.name !== "DistributionAlreadyExists") throw error;
    const recovered = await findOwnedDistribution(
      client,
      cloudfront,
      configuration.environment,
      input.entitlementId,
    );
    if (!recovered?.Id)
      throw new Error("Recovered CloudFront distribution has no identifier", {
        cause: error,
      });
    await assertOwnedDistribution(
      client,
      cloudfront,
      configuration.environment,
      input.entitlementId,
      recovered.Id,
    );
    const { config: recoveredConfig } = await distributionConfiguration(
      client,
      cloudfront,
      configuration.environment,
      input.entitlementId,
      recovered.Id,
      configuration.originCapability,
      configuration.originDomain,
      configuration.logBucketDomain,
    );
    if (recoveredConfig.Enabled)
      throw new Error(
        "Refusing to recover an already-enabled CloudFront entitlement distribution",
        { cause: error },
      );
    return publicDistribution(recovered, "recovered-disabled");
  }
}

async function activate(input, configuration, client, cloudfront) {
  const distribution = await assertOwnedDistribution(
    client,
    cloudfront,
    configuration.environment,
    input.entitlementId,
    input.distributionId,
  );
  if (!distribution)
    throw new Error("CloudFront entitlement distribution is unavailable");
  if (distribution.Status !== "Deployed")
    return publicDistribution(distribution, "waiting-for-deployment");
  const { config, etag } = await distributionConfiguration(
    client,
    cloudfront,
    configuration.environment,
    input.entitlementId,
    input.distributionId,
    configuration.originCapability,
    configuration.originDomain,
    configuration.logBucketDomain,
  );
  if (config.Enabled) return publicDistribution(distribution, "active");
  const response = await client.send(
    new cloudfront.UpdateDistributionCommand({
      Id: input.distributionId,
      IfMatch: etag,
      DistributionConfig: { ...config, Enabled: true },
    }),
  );
  return publicDistribution(response.Distribution, "activating");
}

async function retire(input, configuration, client, cloudfront) {
  const distribution = await assertOwnedDistribution(
    client,
    cloudfront,
    configuration.environment,
    input.entitlementId,
    input.distributionId,
  );
  if (!distribution)
    return { phase: "deleted", distributionId: input.distributionId };
  if (distribution.Status !== "Deployed")
    return publicDistribution(distribution, "waiting-for-deployment");
  const { config, etag } = await distributionConfiguration(
    client,
    cloudfront,
    configuration.environment,
    input.entitlementId,
    input.distributionId,
    configuration.originCapability,
    configuration.originDomain,
    configuration.logBucketDomain,
  );
  if (config.Enabled) {
    const response = await client.send(
      new cloudfront.UpdateDistributionCommand({
        Id: input.distributionId,
        IfMatch: etag,
        DistributionConfig: { ...config, Enabled: false },
      }),
    );
    return publicDistribution(response.Distribution, "disabling");
  }
  await client.send(
    new cloudfront.DeleteDistributionCommand({
      Id: input.distributionId,
      IfMatch: etag,
    }),
  );
  return { phase: "deleted", distributionId: input.distributionId };
}

export async function handler(event) {
  const input = parseAllocatorRequest(event);
  const environment = requiredEnvironment(
    "UPSKILL_ENVIRONMENT",
    /^(?:staging|production)$/u,
  );
  const originDomain = requiredEnvironment(
    "UPSKILL_OFFLINE_SCORM_ORIGIN_DOMAIN",
    ORIGIN_DOMAIN,
  );
  const logBucketDomain = requiredEnvironment(
    "UPSKILL_OFFLINE_SCORM_EDGE_LOG_BUCKET_DOMAIN",
    ORIGIN_DOMAIN,
  );
  const secretArn = requiredEnvironment(
    "UPSKILL_OFFLINE_SCORM_ORIGIN_KEY_SECRET_ARN",
    /^arn:[a-z0-9-]+:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]+$/u,
  );
  const { cloudfront, secretsManager } = await awsModules();
  const originKey = await readOriginKey(secretArn, secretsManager);
  const configuration = {
    environment,
    originDomain,
    logBucketDomain,
    originCapability: createOriginCapability(
      originKey,
      environment,
      input.entitlementId,
    ),
  };
  const client = new cloudfront.CloudFrontClient({});
  if (input.operation === "allocate")
    return await allocate(input, configuration, client, cloudfront);
  if (input.operation === "activate")
    return await activate(input, configuration, client, cloudfront);
  if (input.operation === "retire")
    return await retire(input, configuration, client, cloudfront);
  const distribution = await assertOwnedDistribution(
    client,
    cloudfront,
    environment,
    input.entitlementId,
    input.distributionId,
  );
  if (!distribution)
    return { phase: "deleted", distributionId: input.distributionId };
  await distributionConfiguration(
    client,
    cloudfront,
    environment,
    input.entitlementId,
    input.distributionId,
    configuration.originCapability,
    configuration.originDomain,
    configuration.logBucketDomain,
  );
  return publicDistribution(distribution, "described");
}
