import { z } from "zod";

export const SCORM_MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;

const packageIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);

export const adminScormUploadQuerySchema = z.object({
  title: z.string().trim().min(1).max(200),
  packageId: packageIdSchema.optional(),
});

export const adminScormUploadAcceptedSchema = z.object({
  status: z.literal("accepted"),
  packageId: packageIdSchema,
  packageVersionId: packageIdSchema,
  version: z.number().int().positive(),
});

export interface AdminScormPackageVersionSummary {
  id: string;
  version: number;
  status: "quarantined" | "processing" | "ready" | "rejected";
  sourceBytes: number | null;
  failureCode: string | null;
  courseUsageCount: number;
  createdAt: string;
  processedAt: string | null;
}

export interface AdminScormPackageSummary {
  id: string;
  title: string;
  createdAt: string;
  versions: Array<AdminScormPackageVersionSummary>;
}

export type AdminScormLibraryResult =
  | { status: "ready"; data: Array<AdminScormPackageSummary> }
  | { status: "unauthenticated" }
  | { status: "forbidden" };
