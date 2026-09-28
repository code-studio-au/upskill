import { describe, expect, it } from "vitest";
import {
  assertOwnedConfiguration,
  classifyDistributionInventory,
  createDistributionConfig,
  createOriginCapability,
  distributionMarker,
  parseAllocatorRequest,
  parseDistributionLimit,
  readCloudFrontWebAclArn,
  readOriginKey,
  selectDistributionForAllocation,
} from "../lambda/offline-scorm-cloudfront-entitlement/index.mjs";

const originKey = "a".repeat(64);
const webAclArn =
  "arn:aws:wafv2:us-east-1:123456789012:global/webacl/upskill-staging-offline-scorm-cloudfront/11111111-2222-3333-4444-555555555555";

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

  it("resolves exactly one global Web ACL and caches only success", async () => {
    let requests = 0;
    class WAFV2Client {
      constructor(readonly configuration: { region: string }) {
        expect(configuration.region).toBe("us-east-1");
      }
      send(command: {
        kind: "list" | "tags";
        input: { NextMarker?: string; Scope?: string };
      }) {
        requests += 1;
        if (command.kind === "tags")
          return Promise.resolve({
            TagInfoForResource: {
              TagList: [
                { Key: "Application", Value: "upskill" },
                {
                  Key: "Environment",
                  Value: requests === 4 ? "production" : "staging",
                },
                { Key: "Purpose", Value: "offline-scorm-qualification" },
              ],
            },
          });
        expect(command.input.Scope).toBe("CLOUDFRONT");
        if (requests === 1)
          return Promise.reject(new Error("transient WAF outage"));
        if (!command.input.NextMarker)
          return Promise.resolve({
            NextMarker: "next",
            WebACLs: [{ Name: "another-acl", ARN: webAclArn }],
          });
        return Promise.resolve({
          WebACLs: [
            {
              Name: "upskill-staging-offline-scorm-cloudfront",
              ARN: webAclArn,
            },
          ],
        });
      }
    }
    class ListWebACLsCommand {
      readonly kind = "list";
      constructor(readonly input: { NextMarker?: string; Scope: string }) {}
    }
    class ListTagsForResourceCommand {
      readonly kind = "tags";
      constructor(readonly input: { ResourceARN: string }) {}
    }
    const wafV2 = {
      WAFV2Client,
      ListTagsForResourceCommand,
      ListWebACLsCommand,
    };

    await expect(
      readCloudFrontWebAclArn(
        "upskill-staging-offline-scorm-cloudfront",
        "staging",
        wafV2,
      ),
    ).rejects.toThrow("transient WAF outage");
    await expect(
      readCloudFrontWebAclArn(
        "upskill-staging-offline-scorm-cloudfront",
        "staging",
        wafV2,
      ),
    ).rejects.toThrow("Web ACL ownership is invalid");
    await expect(
      readCloudFrontWebAclArn(
        "upskill-staging-offline-scorm-cloudfront",
        "staging",
        wafV2,
      ),
    ).resolves.toBe(webAclArn);
    await expect(
      readCloudFrontWebAclArn(
        "upskill-staging-offline-scorm-cloudfront",
        "staging",
        wafV2,
      ),
    ).resolves.toBe(webAclArn);
    expect(requests).toBe(7);
  });

  it("bounds qualification distribution inventory without breaking recovery", () => {
    expect(parseDistributionLimit("25")).toBe(25);
    expect(() => parseDistributionLimit("0")).toThrow("MAX_DISTRIBUTIONS");
    expect(() => parseDistributionLimit("101")).toThrow("MAX_DISTRIBUTIONS");
    expect(() => parseDistributionLimit(25)).toThrow("MAX_DISTRIBUTIONS");

    const marker = distributionMarker("staging", "entitlement_a");
    const inventory = classifyDistributionInventory(
      [
        { Comment: marker, Id: "E1234567890" },
        {
          Comment: distributionMarker("staging", "entitlement_b"),
          Id: "E1234567891",
        },
        {
          Comment: distributionMarker("production", "entitlement_c"),
          Id: "E1234567892",
        },
        { Comment: "another-application", Id: "E1234567893" },
      ],
      "staging",
      "entitlement_a",
    );
    expect(inventory.ownedCount).toBe(2);
    expect(inventory.entitlementMatches).toEqual([
      { Comment: marker, Id: "E1234567890" },
    ]);
    expect(selectDistributionForAllocation(inventory, 2)).toEqual({
      Comment: marker,
      Id: "E1234567890",
    });
    expect(
      selectDistributionForAllocation(
        { entitlementMatches: [], ownedCount: 1 },
        2,
      ),
    ).toBeNull();
    expect(() =>
      selectDistributionForAllocation(
        { entitlementMatches: [], ownedCount: 2 },
        2,
      ),
    ).toThrow("distribution limit reached (2)");
    expect(() =>
      selectDistributionForAllocation(
        {
          entitlementMatches: [
            { Comment: marker, Id: "E1234567890" },
            { Comment: marker, Id: "E1234567894" },
          ],
          ownedCount: 2,
        },
        2,
      ),
    ).toThrow("at most one recoverable");
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
      webAclArn,
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
      WebACLId: webAclArn,
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
      webAclArn,
    });

    expect(() => {
      assertOwnedConfiguration(
        config,
        "staging",
        "entitlement_a",
        capability,
        "staging.upskill.institute",
        "offline-logs.s3.amazonaws.com",
        webAclArn,
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
        webAclArn,
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
        webAclArn,
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
        webAclArn,
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
      {
        ...structuredClone(serviceReturnedConfig),
        WebACLId:
          "arn:aws:wafv2:us-east-1:123456789012:global/webacl/attacker/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
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
          webAclArn,
        );
      }).toThrow("outside the exact entitlement boundary");
  });
});
