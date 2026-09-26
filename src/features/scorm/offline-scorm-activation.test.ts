import { describe, expect, it } from "vitest";
import {
  offlineScormCleanupConfirmationSchema,
  offlineScormCourseActivationSchema,
  offlineScormResolutionRequestSchema,
  offlineScormSyncRequestSchema,
} from "#/features/scorm/offline-scorm-activation";

describe("offline SCORM Course activation contracts", () => {
  it("accepts only one exact Course registration target", () => {
    const input = {
      schemaVersion: 1,
      registration: {
        schemaVersion: 1,
        installationId: "installation_1",
        publicKeySpki: "A".repeat(86),
      },
      enrollmentId: "enrollment_1",
      modulePosition: 2,
    };
    expect(offlineScormCourseActivationSchema.parse(input)).toEqual(input);
    expect(() =>
      offlineScormCourseActivationSchema.parse({
        ...input,
        eventId: "event_1",
      }),
    ).toThrow();
    expect(() =>
      offlineScormCourseActivationSchema.parse({
        ...input,
        modulePosition: -1,
      }),
    ).toThrow();
  });

  it("bounds sync, resolution and cleanup commands", () => {
    expect(() =>
      offlineScormSyncRequestSchema.parse({
        schemaVersion: 1,
        batch: {
          schemaVersion: 1,
          entitlementId: "entitlement_1",
          attemptId: "attempt_1",
          commits: [],
        },
      }),
    ).toThrow();
    expect(
      offlineScormResolutionRequestSchema.parse({
        schemaVersion: 1,
        entitlementId: "entitlement_1",
        resolution: "reconciled",
      }).resolution,
    ).toBe("reconciled");
    expect(() =>
      offlineScormResolutionRequestSchema.parse({
        schemaVersion: 1,
        entitlementId: "entitlement_1",
        resolution: "administrator_resolved",
      }),
    ).toThrow();
    expect(
      offlineScormCleanupConfirmationSchema.parse({
        schemaVersion: 1,
        entitlementId: "entitlement_1",
        cleanupReceiptSha256: "a".repeat(64),
      }).cleanupReceiptSha256,
    ).toHaveLength(64);
  });
});
