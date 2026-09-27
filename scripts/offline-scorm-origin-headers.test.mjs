import { describe, expect, it } from "vitest";
import {
  claimsOfflineScormCloudFrontOrigin,
  mayServeBootstrapShortcuts,
} from "./offline-scorm-origin-headers.mjs";

describe("offline SCORM CloudFront origin header claims", () => {
  it("allows bootstrap shortcuts only when neither reserved header is present", () => {
    expect(mayServeBootstrapShortcuts({ accept: "text/html" })).toBe(true);
    expect(
      mayServeBootstrapShortcuts({
        "x-upskill-offline-entitlement": "entitlement-1",
      }),
    ).toBe(false);
    expect(
      mayServeBootstrapShortcuts({
        "x-upskill-offline-origin-capability": "capability",
      }),
    ).toBe(false);
  });

  it("claims malformed and incomplete reserved-header requests", () => {
    expect(
      claimsOfflineScormCloudFrontOrigin({
        "x-upskill-offline-entitlement": "",
      }),
    ).toBe(true);
    expect(
      claimsOfflineScormCloudFrontOrigin({
        "x-upskill-offline-origin-capability": ["one", "two"],
      }),
    ).toBe(true);
  });
});
