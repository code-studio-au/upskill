import { describe, expect, it } from "vitest";
import {
  assertOwnedConfiguration,
  createDistributionConfig,
  createOriginCapability,
  distributionMarker,
  parseAllocatorRequest,
  readOriginKey,
} from "../lambda/offline-scorm-cloudfront-entitlement/index.mjs";

const originKey = "a".repeat(64);

describe("offline SCORM CloudFront entitlement allocator", () => {
  it("derives stable entitlement-bound capabilities and caller references", () => {
    const first = createOriginCapability(originKey, "staging", "entitlement_a");
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(first).toBe(
      createOriginCapability(originKey, "staging", "entitlement_a"),
    );
    expect(first).not.toBe(
      createOriginCapability(originKey, "staging", "entitlement_b"),
    );
    expect(distributionMarker("staging", "entitlement_a")).toMatch(
      /^upskill:staging:offline-scorm:[a-f0-9]{32}$/u,
    );
    expect(
      createOriginCapability(
        "cloudfront-origin-key-".padEnd(64, "7"),
        "production",
        "entitlement_cloudfront",
      ),
    ).toBe("F8pcIPQIzhHfEr6ME4grW-6jHKOvCnnrpKcGT-wu2sg");
  });

  it("retries a transient origin-key read but caches a successful value", async () => {
    let requests = 0;
    class SecretsManagerClient {
      send() {
        requests += 1;
        if (requests === 1)
          return Promise.reject(new Error("transient Secrets Manager outage"));
        return Promise.resolve({ SecretString: originKey });
      }
    }
    class GetSecretValueCommand {
      constructor(readonly input: { SecretId: string }) {}
    }
    const secretsManager = { SecretsManagerClient, GetSecretValueCommand };

    await expect(
      readOriginKey(
        "arn:aws:secretsmanager:ap-southeast-2:123:secret:key",
        secretsManager,
      ),
    ).rejects.toThrow("transient Secrets Manager outage");
    await expect(
      readOriginKey(
        "arn:aws:secretsmanager:ap-southeast-2:123:secret:key",
        secretsManager,
      ),
    ).resolves.toBe(originKey);
    await expect(
      readOriginKey(
        "arn:aws:secretsmanager:ap-southeast-2:123:secret:key",
        secretsManager,
      ),
    ).resolves.toBe(originKey);
    expect(requests).toBe(2);
  });

  it("creates a disabled no-cache distribution before database binding", () => {
    const capability = createOriginCapability(
      originKey,
      "staging",
      "entitlement_a",
    );
    const config = createDistributionConfig({
      environment: "staging",
      entitlementId: "entitlement_a",
      originDomain: "staging.upskill.institute",
      originCapability: capability,
      logBucketDomain: "offline-logs.s3.amazonaws.com",
    });

    expect(config).toMatchObject({
      Enabled: false,
      IsIPV6Enabled: true,
      HttpVersion: "http2and3",
      PriceClass: "PriceClass_100",
      DefaultCacheBehavior: {
        ViewerProtocolPolicy: "https-only",
        Compress: false,
        MinTTL: 0,
        DefaultTTL: 0,
        MaxTTL: 0,
        AllowedMethods: {
          Items: ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"],
        },
        ForwardedValues: {
          QueryString: true,
          Cookies: { Forward: "none" },
          Headers: { Items: ["Origin"] },
        },
      },
      Logging: {
        Enabled: true,
        IncludeCookies: false,
        Bucket: "offline-logs.s3.amazonaws.com",
      },
      ViewerCertificate: {
        CloudFrontDefaultCertificate: true,
      },
      WebACLId: "",
    });
    expect(config).not.toHaveProperty("Aliases.Items");
    expect(config).not.toHaveProperty(
      "ViewerCertificate.MinimumProtocolVersion",
    );
    expect(config).not.toHaveProperty("DefaultCacheBehavior.CachePolicyId");
    expect(config).not.toHaveProperty(
      "DefaultCacheBehavior.FunctionAssociations",
    );
    expect(config).not.toHaveProperty(
      "DefaultCacheBehavior.LambdaFunctionAssociations",
    );
    expect(config).toMatchObject({
      Origins: {
        Items: [
          {
            DomainName: "staging.upskill.institute",
            CustomHeaders: {
              Items: [
                {
                  HeaderName: "X-Upskill-Offline-Entitlement",
                  HeaderValue: "entitlement_a",
                },
                {
                  HeaderName: "X-Upskill-Offline-Origin-Capability",
                  HeaderValue: capability,
                },
              ],
            },
            CustomOriginConfig: {
              OriginProtocolPolicy: "https-only",
              OriginSslProtocols: { Items: ["TLSv1.2"] },
            },
          },
        ],
      },
    });
  });

  it("rejects unbounded operations and identifiers before AWS calls", () => {
    expect(
      parseAllocatorRequest({ operation: "allocate", entitlementId: "e_1" }),
    ).toEqual({ operation: "allocate", entitlementId: "e_1" });
    expect(() =>
      parseAllocatorRequest({ operation: "delete", entitlementId: "e_1" }),
    ).toThrow("operation is invalid");
    expect(() =>
      parseAllocatorRequest({ operation: "activate", entitlementId: "e_1" }),
    ).toThrow("distribution ID is invalid");
    expect(() =>
      parseAllocatorRequest({
        operation: "retire",
        entitlementId: "../other",
        distributionId: "E1234567890",
      }),
    ).toThrow("entitlement identifier is invalid");
  });

  it("requires the complete entitlement security boundary before mutation", () => {
    const capability = createOriginCapability(
      originKey,
      "staging",
      "entitlement_a",
    );
    const config = createDistributionConfig({
      environment: "staging",
      entitlementId: "entitlement_a",
      originDomain: "staging.upskill.institute",
      originCapability: capability,
      logBucketDomain: "offline-logs.s3.amazonaws.com",
    });

    expect(() => {
      assertOwnedConfiguration(
        config,
        "staging",
        "entitlement_a",
        capability,
        "staging.upskill.institute",
        "offline-logs.s3.amazonaws.com",
      );
    }).not.toThrow();
    expect(() => {
      assertOwnedConfiguration(
        { ...config, Enabled: true },
        "staging",
        "entitlement_a",
        capability,
        "staging.upskill.institute",
        "offline-logs.s3.amazonaws.com",
      );
    }).not.toThrow();
    expect(() => {
      assertOwnedConfiguration(
        config,
        "staging",
        "entitlement_a",
        createOriginCapability(originKey, "staging", "entitlement_b"),
        "staging.upskill.institute",
        "offline-logs.s3.amazonaws.com",
      );
    }).toThrow("outside the exact entitlement boundary");

    const expectedOrigin = config.Origins.Items.at(0);
    if (!expectedOrigin) throw new Error("Missing distribution origin fixture");
    const serviceReturnedConfig = {
      ...structuredClone(config),
      DefaultRootObject: "",
      Staging: false,
      ContinuousDeploymentPolicyId: "",
      ConnectionMode: "direct",
      AnycastIpListId: "",
      ViewerCertificate: {
        CloudFrontDefaultCertificate: true,
        SSLSupportMethod: "vip",
        MinimumProtocolVersion: "TLSv1",
        CertificateSource: "cloudfront",
      },
      Origins: {
        ...structuredClone(config.Origins),
        Items: [
          {
            ...structuredClone(expectedOrigin),
            OriginPath: "",
            OriginAccessControlId: "",
            OriginShield: { Enabled: false },
          },
        ],
      },
      DefaultCacheBehavior: {
        ...structuredClone(config.DefaultCacheBehavior),
        FieldLevelEncryptionId: "",
        RealtimeLogConfigArn: "",
        CachePolicyId: "",
        OriginRequestPolicyId: "",
        ResponseHeadersPolicyId: "",
        LambdaFunctionAssociations: { Quantity: 0 },
        FunctionAssociations: { Quantity: 0 },
        GrpcConfig: { Enabled: false },
      },
    };
    expect(() => {
      assertOwnedConfiguration(
        serviceReturnedConfig,
        "staging",
        "entitlement_a",
        capability,
        "staging.upskill.institute",
        "offline-logs.s3.amazonaws.com",
      );
    }).not.toThrow();
    const driftedConfigurations = [
      {
        ...structuredClone(serviceReturnedConfig),
        Origins: {
          ...structuredClone(serviceReturnedConfig.Origins),
          Items: [
            {
              ...structuredClone(expectedOrigin),
              DomainName: "attacker.example.com",
            },
          ],
        },
      },
      {
        ...structuredClone(serviceReturnedConfig),
        DefaultCacheBehavior: {
          ...structuredClone(serviceReturnedConfig.DefaultCacheBehavior),
          DefaultTTL: 300,
        },
      },
      {
        ...structuredClone(serviceReturnedConfig),
        Logging: {
          ...structuredClone(serviceReturnedConfig.Logging),
          Bucket: "attacker-logs.s3.amazonaws.com",
        },
      },
      {
        ...structuredClone(serviceReturnedConfig),
        Aliases: { Quantity: 1, Items: ["packages.example.com"] },
      },
      {
        ...structuredClone(serviceReturnedConfig),
        Staging: true,
      },
    ];
    for (const drifted of driftedConfigurations)
      expect(() => {
        assertOwnedConfiguration(
          drifted,
          "staging",
          "entitlement_a",
          capability,
          "staging.upskill.institute",
          "offline-logs.s3.amazonaws.com",
        );
      }).toThrow("outside the exact entitlement boundary");
  });
});
