import { describe, expect, it } from "vitest";
import {
  adminScormUploadAcceptedSchema,
  adminScormUploadQuerySchema,
  SCORM_MAX_ARCHIVE_BYTES,
} from "#/features/scorm/scorm-package.schema";

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

  it("keeps accepted upload responses versioned and bounded", () => {
    expect(SCORM_MAX_ARCHIVE_BYTES).toBe(262_144_000);
    expect(
      adminScormUploadAcceptedSchema.parse({
        status: "accepted",
        packageId: "scorm_pkg_1",
        packageVersionId: "scorm_pkgv_1",
        version: 2,
      }),
    ).toEqual({
      status: "accepted",
      packageId: "scorm_pkg_1",
      packageVersionId: "scorm_pkgv_1",
      version: 2,
    });
  });
});
