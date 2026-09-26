import { describe, expect, it } from "vitest";
import {
  offlineScormActivationDenialMessage,
  parseOfflineScormActivationDenial,
} from "#/offline-scorm/offline-scorm-activation-denial";

describe("offline SCORM activation denials", () => {
  it("accepts only bounded authoritative denial responses", () => {
    expect(
      parseOfflineScormActivationDenial({
        status: "denied",
        reason: "finite-access-expiry-required",
        discardInstallation: true,
      }),
    ).toEqual({
      status: "denied",
      reason: "finite-access-expiry-required",
      discardInstallation: true,
    });
    expect(
      parseOfflineScormActivationDenial({
        status: "denied",
        reason: "future-reason",
        discardInstallation: true,
      }),
    ).toBeUndefined();
    expect(
      parseOfflineScormActivationDenial({
        status: "denied",
        reason: "not-found",
      }),
    ).toBeUndefined();
  });

  it("states the corrective action for terminal denials", () => {
    expect(
      offlineScormActivationDenialMessage("finite-access-expiry-required"),
    ).toContain("access end date");
    expect(
      offlineScormActivationDenialMessage("active-installation-exists"),
    ).toContain("Remove its offline courses");
  });
});
