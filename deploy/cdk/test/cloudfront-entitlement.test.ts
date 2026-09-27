import { describe, expect, it } from "vitest";
import {
  assertOwnedConfiguration,
  createDistributionConfig,
  createOriginCapability,
  distributionMarker,
  parseAllocatorRequest,
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

  it("requires the exact entitlement and capability before mutation", () => {
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
      assertOwnedConfiguration(config, "staging", "entitlement_a", capability);
    }).not.toThrow();
    expect(() => {
      assertOwnedConfiguration(
        config,
        "staging",
        "entitlement_a",
        createOriginCapability(originKey, "staging", "entitlement_b"),
      );
    }).toThrow("outside the exact entitlement boundary");
  });
});
