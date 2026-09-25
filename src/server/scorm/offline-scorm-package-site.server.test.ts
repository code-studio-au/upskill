import { describe, expect, it } from "vitest";
import { createOfflineScormPackageSiteProvisioner } from "#/server/scorm/offline-scorm-package-site.server";

const originKey = Buffer.alloc(32, 7).toString("base64url");

function configuration(
  overrides: Partial<
    Parameters<typeof createOfflineScormPackageSiteProvisioner>[0]
  > = {},
): Parameters<typeof createOfflineScormPackageSiteProvisioner>[0] {
  return {
    APP_ORIGIN: "https://app.example.com",
    LEARNING_ORIGIN: "https://learning.example.com",
    OFFLINE_SCORM_ENABLED: true,
    OFFLINE_SCORM_PACKAGE_SITE_SUFFIX: "github.io",
    OFFLINE_SCORM_PACKAGE_SITE_ORIGIN_KEY: originKey,
    ...overrides,
  };
}

describe("offline SCORM package-site provisioner", () => {
  it("derives stable opaque sites that separate entitlements", () => {
    const provision = createOfflineScormPackageSiteProvisioner(configuration());
    const first = provision({
      attemptId: "attempt_1",
      entitlementId: "entitlement_1",
    });

    expect(first).toMatch(/^https:\/\/p-[a-f0-9]{56}\.github\.io$/u);
    expect(
      provision({
        attemptId: "attempt_1",
        entitlementId: "entitlement_1",
      }),
    ).toBe(first);
    expect(
      provision({
        attemptId: "attempt_1",
        entitlementId: "entitlement_2",
      }),
    ).not.toBe(first);
    expect(
      provision({
        attemptId: "attempt_2",
        entitlementId: "entitlement_1",
      }),
    ).not.toBe(first);
    expect(new URL(first).hostname).not.toContain("attempt_1");
    expect(new URL(first).hostname).not.toContain("entitlement_1");
  });

  it("requires a private Public Suffix List boundary", () => {
    expect(() =>
      createOfflineScormPackageSiteProvisioner(
        configuration({ OFFLINE_SCORM_PACKAGE_SITE_SUFFIX: "example.com" }),
      ),
    ).toThrow("private Public Suffix List");
    expect(() =>
      createOfflineScormPackageSiteProvisioner(
        configuration({ OFFLINE_SCORM_PACKAGE_SITE_SUFFIX: "GITHUB.IO" }),
      ),
    ).toThrow("canonical lowercase DNS");
  });

  it("rejects disabled and malformed-key configuration", () => {
    expect(() =>
      createOfflineScormPackageSiteProvisioner(
        configuration({ OFFLINE_SCORM_ENABLED: false }),
      ),
    ).toThrow("activation is disabled");
    expect(() =>
      createOfflineScormPackageSiteProvisioner(
        configuration({
          OFFLINE_SCORM_PACKAGE_SITE_ORIGIN_KEY: `${originKey}=`,
        }),
      ),
    ).toThrow("canonical base64url");
  });

  it("treats sibling hosts under a private suffix as separate sites", () => {
    expect(() =>
      createOfflineScormPackageSiteProvisioner(
        configuration({ APP_ORIGIN: "https://app.github.io" }),
      )({ attemptId: "attempt_1", entitlementId: "app" }),
    ).not.toThrow();
  });

  it("rejects malformed provisioning identifiers", () => {
    const provision = createOfflineScormPackageSiteProvisioner(configuration());
    expect(() =>
      provision({ attemptId: "../attempt", entitlementId: "entitlement_1" }),
    ).toThrow("attempt identifier is invalid");
  });
});
