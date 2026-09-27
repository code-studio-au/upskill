import { describe, expect, it } from "vitest";
import {
  offlineScormCanRecoverAbsentLocalBinding,
  offlineScormCleanupIsFinalized,
  offlineScormPackageStateSupportsOperation,
  offlineScormRecoveredCourseState,
  offlineScormRemovalRecoveryCanBypassPackageChannel,
  offlineScormRemovalResolution,
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

  it("recovers removal only when both local binding records are absent", () => {
    expect(
      offlineScormCanRecoverAbsentLocalBinding({
        attemptAvailable: false,
        mode: "remove",
        packageAvailable: false,
      }),
    ).toBe(true);
    for (const input of [
      {
        attemptAvailable: true,
        mode: "remove" as const,
        packageAvailable: false,
      },
      {
        attemptAvailable: false,
        mode: "remove" as const,
        packageAvailable: true,
      },
      {
        attemptAvailable: false,
        mode: "launch" as const,
        packageAvailable: false,
      },
      {
        attemptAvailable: false,
        mode: "sync" as const,
        packageAvailable: false,
      },
    ])
      expect(offlineScormCanRecoverAbsentLocalBinding(input)).toBe(false);
  });

  it("accepts every trusted package lifecycle state for removal only", () => {
    for (const status of [
      "downloading",
      "ready",
      "integrity_failed",
      "cleanup_pending",
      "cleared",
    ] as const)
      expect(
        offlineScormPackageStateSupportsOperation({ mode: "remove", status }),
      ).toBe(true);
    for (const mode of ["launch", "sync"] as const)
      for (const status of [
        "downloading",
        "integrity_failed",
        "cleanup_pending",
        "cleared",
      ] as const)
        expect(
          offlineScormPackageStateSupportsOperation({ mode, status }),
        ).toBe(false);
  });

  it("retains an authenticated server resolution during resumed removal", () => {
    expect(
      offlineScormRemovalResolution({
        hasDiscardedJournal: false,
        serverResolution: "administrator_resolved",
      }),
    ).toBe("discarded");
    expect(
      offlineScormRemovalResolution({
        hasDiscardedJournal: false,
        serverResolution: "discarded",
      }),
    ).toBe("discarded");
    expect(
      offlineScormRemovalResolution({
        hasDiscardedJournal: true,
        serverResolution: "reconciled",
      }),
    ).toBe("reconciled");
    expect(
      offlineScormRemovalResolution({
        hasDiscardedJournal: true,
        serverResolution: undefined,
      }),
    ).toBe("discarded");
  });

  it("bypasses the package channel only for verified removal recovery", () => {
    expect(
      offlineScormRemovalRecoveryCanBypassPackageChannel({
        mode: "remove",
        removalRecoveryAvailable: true,
      }),
    ).toBe(true);
    for (const input of [
      { mode: "remove" as const, removalRecoveryAvailable: false },
      { mode: "install" as const, removalRecoveryAvailable: true },
      { mode: "launch" as const, removalRecoveryAvailable: true },
      { mode: "sync" as const, removalRecoveryAvailable: true },
    ])
      expect(offlineScormRemovalRecoveryCanBypassPackageChannel(input)).toBe(
        false,
      );
  });
});
