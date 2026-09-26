export type OfflineScormServerCleanupState =
  "cleared" | "clearing" | "needs_attention" | "pending";

export function offlineScormRecoveredCourseState(input: {
  cleanupState: OfflineScormServerCleanupState;
  entitlementStatus: "active" | "resolved";
}): "blocked" | "removing" {
  return input.entitlementStatus === "active" &&
    input.cleanupState === "pending"
    ? "blocked"
    : "removing";
}

export function offlineScormCleanupIsFinalized(
  cleanupState: OfflineScormServerCleanupState | undefined,
): boolean {
  return cleanupState === "cleared";
}
