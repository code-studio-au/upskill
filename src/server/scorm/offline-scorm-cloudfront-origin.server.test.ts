import { describe, expect, it } from "vitest";
import {
  createOfflineScormCloudFrontOriginCapability,
  verifyOfflineScormCloudFrontOriginCapability,
} from "./offline-scorm-cloudfront-origin.server";

const originKey = "cloudfront-origin-key-".padEnd(64, "7");

describe("offline SCORM CloudFront origin capability", () => {
  it("matches the allocator's fixed cross-boundary capability vector", () => {
    expect(
      createOfflineScormCloudFrontOriginCapability(
        originKey,
        "production",
        "entitlement_cloudfront",
      ),
    ).toBe("F8pcIPQIzhHfEr6ME4grW-6jHKOvCnnrpKcGT-wu2sg");
  });

  it("verifies only the exact environment and entitlement capability", () => {
    const actualCapability = createOfflineScormCloudFrontOriginCapability(
      originKey,
      "staging",
      "entitlement_a",
    );
    expect(
      verifyOfflineScormCloudFrontOriginCapability({
        actualCapability,
        entitlementId: "entitlement_a",
        environment: "staging",
        originKey,
      }),
    ).toBe(true);
    expect(
      verifyOfflineScormCloudFrontOriginCapability({
        actualCapability,
        entitlementId: "entitlement_b",
        environment: "staging",
        originKey,
      }),
    ).toBe(false);
    expect(
      verifyOfflineScormCloudFrontOriginCapability({
        actualCapability: `${actualCapability.startsWith("A") ? "B" : "A"}${actualCapability.slice(1)}`,
        entitlementId: "entitlement_a",
        environment: "staging",
        originKey,
      }),
    ).toBe(false);
  });

  it("rejects malformed inputs before capability comparison", () => {
    expect(
      verifyOfflineScormCloudFrontOriginCapability({
        actualCapability: "short",
        entitlementId: "entitlement_a",
        environment: "staging",
        originKey,
      }),
    ).toBe(false);
    expect(
      verifyOfflineScormCloudFrontOriginCapability({
        actualCapability: "A".repeat(43),
        entitlementId: "../entitlement",
        environment: "staging",
        originKey,
      }),
    ).toBe(false);
  });
});
