import { z } from "#/validation/zod";

const identifierSchema = z
  .string()
  .check(
    z.trim(),
    z.minLength(1),
    z.maxLength(255),
    z.regex(/^[A-Za-z0-9_-]+$/),
  );
const boundedText = (maximum: number) =>
  z.string().check(z.trim(), z.minLength(1), z.maxLength(maximum));
const optionalText = (maximum: number) =>
  z.string().check(z.trim(), z.maxLength(maximum));
const resourceTitleSchema = z
  .string()
  .check(z.trim(), z.minLength(1, "Enter a resource title."), z.maxLength(200));

export const PDF_RESOURCE_MAX_BYTES = 25 * 1024 * 1024;

export const adminResourceUploadQuerySchema = z.object({
  title: resourceTitleSchema,
  description: optionalText(2_000),
  displayName: boundedText(255),
  resourceId: z.optional(identifierSchema),
});

export const adminResourceUploadFormSchema = z.object({
  title: resourceTitleSchema,
  description: optionalText(2_000),
  document: z
    .custom<File>(
      (value) => typeof File !== "undefined" && value instanceof File,
      "Choose a PDF document.",
    )
    .check(
      z.refine(
        (file) =>
          file.type === "application/pdf" ||
          file.name.toLocaleLowerCase("en-AU").endsWith(".pdf"),
        { message: "Choose a PDF document." },
      ),
      z.refine((file) => file.size > 0, { message: "Choose a PDF document." }),
      z.refine((file) => file.size <= PDF_RESOURCE_MAX_BYTES, {
        message: "The PDF must be 25 MB or smaller.",
      }),
    ),
});

export const adminResourceRemovalInputSchema = z.object({
  resourceVersionId: identifierSchema,
});

export type AdminResourceUploadQuery = z.infer<
  typeof adminResourceUploadQuerySchema
>;

export interface AdminCourseResourceOption {
  id: string;
  resourceId: string;
  title: string;
  displayName: string;
  description: string;
  version: number;
  sourceBytes: number;
}

export interface AdminResourceVersionSummary extends Omit<
  AdminCourseResourceOption,
  "resourceId" | "title"
> {
  courseUsageCount: number;
}

export interface AdminResourceSummary {
  id: string;
  title: string;
  versions: Array<AdminResourceVersionSummary>;
}

export type AdminResourceRemovalResult =
  | {
      status: "removed";
      data: { resourceId: string; resourceRemoved: boolean; version: number };
    }
  | { status: "in-use"; data: { courseUsageCount: number } }
  | { status: "not-found" };

export type AdminResourceLibraryResult =
  | { status: "ready"; data: Array<AdminResourceSummary> }
  | { status: "unauthenticated" }
  | { status: "forbidden" };
