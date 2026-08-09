import { describe, expect, it } from "vitest";
import {
  SCORM_MAX_ARCHIVE_BYTES,
  adminScormUploadFormSchema,
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

  it("validates administrator upload form values", () => {
    const archive = new File(["package"], "module.zip", {
      type: "application/zip",
    });
    expect(
      adminScormUploadFormSchema.parse({ title: "  Safe practice  ", archive }),
    ).toEqual({ title: "Safe practice", archive });
    const invalid = adminScormUploadFormSchema.safeParse({
      title: "",
      archive: null,
    });
    expect(invalid.success).toBe(false);
    if (!invalid.success)
      expect(invalid.error.issues.map((issue) => issue.message)).toEqual([
        "Enter a module name.",
        "Choose a SCORM ZIP to upload.",
      ]);
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
