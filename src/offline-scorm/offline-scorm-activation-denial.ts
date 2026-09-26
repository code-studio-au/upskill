const offlineScormActivationDenialReasons = [
  "activation-disabled",
  "package-inventory-unavailable",
  "active-installation-exists",
  "installation-unavailable",
  "public-key-invalid",
  "not-found",
  "access-unavailable",
  "questionnaire-incomplete",
  "item-unavailable",
  "section-unreleased",
  "unavailable",
  "offline-writer-active",
  "finite-access-expiry-required",
  "session-unavailable",
] as const;

type OfflineScormActivationDenialReason =
  (typeof offlineScormActivationDenialReasons)[number];

export interface OfflineScormActivationDenial {
  status: "denied";
  reason: OfflineScormActivationDenialReason;
  discardInstallation: boolean;
}

export function parseOfflineScormActivationDenial(
  value: unknown,
): OfflineScormActivationDenial | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.status !== "denied" ||
    typeof candidate.reason !== "string" ||
    !offlineScormActivationDenialReasons.some(
      (reason) => reason === candidate.reason,
    ) ||
    typeof candidate.discardInstallation !== "boolean"
  )
    return undefined;
  return candidate as unknown as OfflineScormActivationDenial;
}

export function offlineScormActivationDenialMessage(
  reason: OfflineScormActivationDenialReason,
): string {
  switch (reason) {
    case "activation-disabled":
      return "Offline downloads are not currently available.";
    case "package-inventory-unavailable":
      return "This module is not prepared for offline download.";
    case "active-installation-exists":
      return "Another installation is already active. Remove its offline courses before retrying.";
    case "finite-access-expiry-required":
      return "This course needs an access end date before it can be downloaded offline.";
    case "session-unavailable":
      return "Your session ended. Sign in again to download this module.";
    case "questionnaire-incomplete":
      return "Complete the required questionnaire before downloading this module.";
    case "section-unreleased":
      return "This section is not released yet.";
    case "offline-writer-active":
      return "This module already has an offline download that must be resolved first.";
    case "installation-unavailable":
    case "public-key-invalid":
    case "not-found":
    case "access-unavailable":
    case "item-unavailable":
    case "unavailable":
      return "This module cannot be downloaded offline. Check your access and try again.";
  }
}
