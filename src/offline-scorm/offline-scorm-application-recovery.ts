import type { OfflineScormPackageRecord } from "#/features/scorm/offline-scorm-trusted-runtime";

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

export function offlineScormCanRecoverAbsentLocalBinding(input: {
  attemptAvailable: boolean;
  mode: "install" | "launch" | "remove" | "sync";
  packageAvailable: boolean;
}): boolean {
  return (
    input.mode === "remove" &&
    !input.attemptAvailable &&
    !input.packageAvailable
  );
}

export function offlineScormPackageStateSupportsOperation(input: {
  mode: "launch" | "remove" | "sync";
  status: OfflineScormPackageRecord["status"];
}): boolean {
  return input.mode === "remove" || input.status === "ready";
}

export function offlineScormRemovalResolution(input: {
  hasDiscardedJournal: boolean;
  serverResolution: "discarded" | "reconciled" | undefined;
}): "discarded" | "reconciled" {
  return (
    input.serverResolution ??
    (input.hasDiscardedJournal ? "discarded" : "reconciled")
  );
}

export function offlineScormRemovalRecoveryCanBypassPackageChannel(input: {
  mode: "install" | "launch" | "remove" | "sync";
  removalRecoveryAvailable: boolean;
}): boolean {
  return input.mode === "remove" && input.removalRecoveryAvailable;
}
