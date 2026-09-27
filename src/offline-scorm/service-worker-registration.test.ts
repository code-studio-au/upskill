import { describe, expect, it } from "vitest";
import { OFFLINE_SCORM_PACKAGE_WORKER_REGISTRATION_OPTIONS } from "#/offline-scorm/service-worker-registration";

describe("offline package worker registration", () => {
  it("loads the split worker bundle as an ES module", () => {
    expect(OFFLINE_SCORM_PACKAGE_WORKER_REGISTRATION_OPTIONS).toEqual({
      scope: "/",
      type: "module",
      updateViaCache: "none",
    });
  });
});
