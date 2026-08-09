import { describe, expect, it } from "vitest";
import {
  SCORM_MAX_ARCHIVE_BYTES,
  isScormVerificationPending,
} from "#/features/scorm/scorm-package.schema";
import {
  adminScormRemovalInputSchema,
  adminScormUploadQuerySchema,
} from "#/server/scorm/scorm-admin-contracts.server";

describe("administrator SCORM package contracts", () => {
  it("normalizes a new package upload", () => {
    expect(
      adminScormUploadQuerySchema.parse({ title: "  Safe practice  " }),
    ).toEqual({ title: "Safe practice" });
  });

  it("rejects unsafe package identifiers and oversized titles", () => {
    expect(() =>
      adminScormUploadQuerySchema.parse({
        title: "x".repeat(201),
        packageId: "../package",
      }),
    ).toThrow();
  });

  it("keeps upload size and verification states bounded", () => {
    expect(SCORM_MAX_ARCHIVE_BYTES).toBe(262_144_000);
    expect(isScormVerificationPending("quarantined")).toBe(true);
    expect(isScormVerificationPending("processing")).toBe(true);
    expect(isScormVerificationPending("ready")).toBe(false);
  });

  it("accepts only bounded package-version identifiers for removal", () => {
    expect(
      adminScormRemovalInputSchema.parse({
        packageVersionId: "scorm_pkgv_1",
      }),
    ).toEqual({ packageVersionId: "scorm_pkgv_1" });
    expect(() =>
      adminScormRemovalInputSchema.parse({ packageVersionId: "../version" }),
    ).toThrow();
  });
});
