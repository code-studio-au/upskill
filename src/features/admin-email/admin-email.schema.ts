import { z } from "#/validation/zod";

const identifierSchema = z
  .string()
  .check(
    z.trim(),
    z.minLength(1),
    z.maxLength(255),
    z.regex(/^[A-Za-z0-9_.-]+$/u),
  );
const nameSchema = z.string().check(z.trim(), z.minLength(2), z.maxLength(120));
const subjectSchema = z
  .string()
  .check(z.trim(), z.minLength(1), z.maxLength(180), z.regex(/^[^\r\n]+$/u));
const textBodySchema = z
  .string()
  .check(z.trim(), z.minLength(1), z.maxLength(20_000));

const emailDesignContextSchema = z.enum(["offering_course", "offering_event"]);
export type EmailDesignContext = z.infer<typeof emailDesignContextSchema>;

export const adminEmailDesignParamsSchema = z.object({
  emailDesignId: identifierSchema,
});

export const adminEmailDesignSearchSchema = z.object({
  versionId: z.optional(identifierSchema),
});

export const adminEmailDesignDetailParamsSchema = z.object({
  emailDesignId: identifierSchema,
  versionId: z.optional(identifierSchema),
});

export const adminEmailDesignVersionParamsSchema = z.object({
  emailDesignId: identifierSchema,
  versionId: identifierSchema,
});

export const adminEmailDesignCreateSchema = z.object({
  name: nameSchema,
  contextKey: emailDesignContextSchema,
});

export const adminEmailDesignMoveSchema = z.object({
  emailDesignId: identifierSchema,
  direction: z.enum(["up", "down"]),
});

export const adminEmailDesignDraftSchema = z.object({
  emailDesignId: identifierSchema,
  versionId: identifierSchema,
  subject: subjectSchema,
  textBody: textBodySchema,
});

export type EmailTemplateVariableCategory =
  | "Account"
  | "Attendance"
  | "Course"
  | "Enrolment"
  | "Event"
  | "Platform"
  | "Progress"
  | "Purchase"
  | "Recipient"
  | "Registration"
  | "Session";

export interface EmailTemplateVariableDefinition {
  category: EmailTemplateVariableCategory;
  key: string;
  label: string;
  type: "text" | "url";
  required: boolean;
  fixtureValue: string;
}

export interface EmailTemplateVariableGroup {
  group: string;
  items: Array<{ label: string; value: string }>;
}

export interface AdminEmailDesignSummary {
  id: string;
  catalogue: "offering" | "system";
  name: string;
  contextKey: string;
  position: number;
  systemKey: string | null;
  activeVersion: number | null;
  draftVersion: number | null;
  publishedVersions: number;
  updatedAt: string;
}

interface AdminEmailDesignVersionSummary {
  id: string;
  version: number;
  publishedAt: string | null;
  active: boolean;
}

export interface AdminEmailDesignDetail {
  design: {
    id: string;
    catalogue: "offering" | "system";
    name: string;
    contextKey: string;
    systemKey: string | null;
  };
  version: {
    id: string;
    version: number;
    subject: string;
    textBody: string;
    publishedAt: string | null;
    active: boolean;
    editable: boolean;
  };
  versions: Array<AdminEmailDesignVersionSummary>;
  variableGroups: Array<EmailTemplateVariableGroup>;
  preview: AdminEmailPreview | null;
}

export interface AdminEmailPreview {
  subject: string;
  textBody: string;
  htmlBody: string;
}

export type AdminEmailResult<T> =
  | { status: "ready"; data: T }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

export type AdminEmailDetailResult =
  AdminEmailResult<AdminEmailDesignDetail> | { status: "not-found" };

export type AdminEmailMutationResult =
  | AdminEmailResult<{
      outcome:
        | "created"
        | "deleted"
        | "draft-created"
        | "moved"
        | "published"
        | "rolled-back"
        | "saved";
      emailDesignId: string;
      versionId?: string;
    }>
  | { status: "not-found" }
  | {
      status: "conflict";
      reason:
        | "active_version"
        | "draft_exists"
        | "invalid_template"
        | "version_is_published";
    };

export type AdminEmailPreviewResult =
  | AdminEmailResult<AdminEmailPreview>
  | { status: "conflict"; reason: "invalid_template" };
