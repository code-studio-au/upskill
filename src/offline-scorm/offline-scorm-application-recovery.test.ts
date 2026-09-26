import { describe, expect, it } from "vitest";
import {
  offlineScormCleanupIsFinalized,
  offlineScormRecoveredCourseState,
} from "#/offline-scorm/offline-scorm-application-recovery";

describe("offline SCORM application recovery", () => {
  it("rebuilds missing active inventory as removal-only state", () => {
    expect(
      offlineScormRecoveredCourseState({
        cleanupState: "pending",
        entitlementStatus: "active",
      }),
    ).toBe("blocked");
    expect(
      offlineScormRecoveredCourseState({
        cleanupState: "clearing",
        entitlementStatus: "resolved",
      }),
    ).toBe("removing");
  });

  it("bypasses the erased package site only after server confirmation", () => {
    expect(offlineScormCleanupIsFinalized("cleared")).toBe(true);
    expect(offlineScormCleanupIsFinalized("clearing")).toBe(false);
    expect(offlineScormCleanupIsFinalized(undefined)).toBe(false);
  });
});
