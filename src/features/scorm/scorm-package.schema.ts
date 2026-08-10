import { z } from "#/validation/zod";
import type { CourseVersionUsage } from "#/features/admin-course/course-version-usage";

export const SCORM_MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;

const scormArchiveSchema = z
  .custom<File>(
    (value) => typeof File !== "undefined" && value instanceof File,
    "Choose a SCORM ZIP to upload.",
  )
  .check(
    z.refine((archive) => archive.size > 0, "The ZIP must contain data."),
    z.refine(
      (archive) => archive.size <= SCORM_MAX_ARCHIVE_BYTES,
      "The ZIP must be no larger than 250 MB.",
    ),
    z.refine(
      (archive) => archive.name.toLowerCase().endsWith(".zip"),
      "Choose a file ending in .zip.",
    ),
  );

export const adminScormUploadFormSchema = z.object({
  title: z
    .string()
    .check(
      z.trim(),
      z.minLength(1, "Enter a module name."),
      z.maxLength(200, "The module name must be 200 characters or fewer."),
    ),
  archive: scormArchiveSchema,
});

export type AdminScormRemovalResult =
  | {
      status: "removed";
      data: { packageId: string; packageRemoved: boolean; version: number };
    }
  | {
      status: "in-use";
      data: { attemptCount: number; courseUsageCount: number };
    }
  | { status: "verification-pending" }
  | { status: "not-found" }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

export interface AdminScormPackageVersionSummary {
  id: string;
  version: number;
  status: "quarantined" | "processing" | "ready" | "rejected";
  sourceBytes: number | null;
  failureCode: string | null;
  courseUsageCount: number;
  courseUsages: Array<CourseVersionUsage>;
  attemptCount: number;
}

export interface AdminScormPackageSummary {
  id: string;
  title: string;
  versions: Array<AdminScormPackageVersionSummary>;
}

export function isScormVerificationPending(
  status: AdminScormPackageVersionSummary["status"],
): boolean {
  return status === "quarantined" || status === "processing";
}

export type AdminScormLibraryResult =
  | { status: "ready"; data: Array<AdminScormPackageSummary> }
  | { status: "unauthenticated" }
  | { status: "forbidden" };
