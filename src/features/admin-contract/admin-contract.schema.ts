import { z } from "#/validation/zod";
import {
  normalizeAccessOwnerEmails,
  normalizeAdminAccessDomains,
} from "#/features/admin-access/admin-access.schema";
import { localDateIsoSchema } from "#/features/shared/time.schema";

const identifierSchema = z
  .string()
  .check(
    z.trim(),
    z.minLength(1),
    z.maxLength(255),
    z.regex(/^[A-Za-z0-9_-]+$/u),
  );
const boundedText = (maximum: number, message: string) =>
  z.string().check(z.trim(), z.minLength(2, message), z.maxLength(maximum));
const contractDateSchema = localDateIsoSchema;

export const adminEnterpriseContractCreateSchema = z
  .object({
    name: boundedText(160, "Enter a contract name."),
    reference: boundedText(80, "Enter a contract reference."),
    organizationName: boundedText(120, "Enter an organisation name."),
    startsOn: contractDateSchema,
    expiresOn: contractDateSchema,
    enrollmentDurationDays: z
      .number()
      .check(z.int(), z.minimum(1), z.maximum(3650)),
    autoEnrollCourses: z.boolean(),
    accessCode: z.string().check(
      z.trim(),
      z.minLength(8, "Use at least eight letters or numbers."),
      z.maxLength(80),
      z.regex(
        /^[A-Za-z0-9]+(?:[ -][A-Za-z0-9]+)*$/u,
        "Use letters, numbers, spaces and hyphens only.",
      ),
      z.refine((value) => {
        const normalizedLength = value.replaceAll(/[ -]/gu, "").length;
        return normalizedLength >= 8 && normalizedLength <= 64;
      }, "Use between eight and 64 letters or numbers."),
    ),
    domains: z.string().check(
      z.maxLength(2_000),
      z.refine((value) => {
        const domains = normalizeAdminAccessDomains(value);
        return domains !== null;
      }, "Enter valid verified-email domains."),
    ),
    courseIds: z.array(identifierSchema).check(z.maxLength(200)),
    eventOccurrenceIds: z.array(identifierSchema).check(z.maxLength(200)),
    ownerEmails: z.string().check(
      z.maxLength(2_000),
      z.refine(
        (value) =>
          value.trim() === "" || normalizeAccessOwnerEmails(value) !== null,
        "Enter valid Access Owner emails.",
      ),
    ),
  })
  .check(
    z.refine(
      (value) => value.expiresOn > value.startsOn,
      "The end date must be after the start date.",
    ),
    z.refine(
      (value) => value.courseIds.length + value.eventOccurrenceIds.length > 0,
      "Select at least one covered course or scheduled event.",
    ),
  );

export const adminEnterpriseContractLifecycleSchema = z.object({
  enterpriseContractId: identifierSchema,
  action: z.enum(["activate", "resume", "suspend", "terminate"]),
});

export const adminEnterpriseContractRevealSchema = z.object({
  enterpriseContractId: identifierSchema,
});

export const adminEnterpriseContractRotateCodeSchema = z.object({
  enterpriseContractId: identifierSchema,
  accessCode: adminEnterpriseContractCreateSchema.shape.accessCode,
});

export const adminEnterpriseContractRenewSchema = z
  .object({
    enterpriseContractId: identifierSchema,
    name: boundedText(160, "Enter a renewal name."),
    reference: boundedText(80, "Enter a renewal reference."),
    startsOn: contractDateSchema,
    expiresOn: contractDateSchema,
    accessCode: adminEnterpriseContractCreateSchema.shape.accessCode,
  })
  .check(
    z.refine(
      (value) => value.expiresOn > value.startsOn,
      "The end date must be after the start date.",
    ),
  );

export const adminEnterpriseContractEligibilitySchema = z.object({
  enterpriseContractId: identifierSchema,
  csvText: z.string().check(z.minLength(1), z.maxLength(2_000_000)),
});

export const adminEnterpriseContractOwnerSchema = z.object({
  enterpriseContractId: identifierSchema,
  ownerEmails: z.string().check(
    z.minLength(3),
    z.maxLength(2_000),
    z.refine(
      (value) => normalizeAccessOwnerEmails(value) !== null,
      "Enter at least one valid Access Owner email.",
    ),
  ),
});

export const adminEnterpriseContractOwnerRevokeSchema = z.object({
  enterpriseContractId: identifierSchema,
  ownerAssignmentId: identifierSchema,
});

export const adminEnterpriseContractBulkEnrollSchema = z.object({
  enterpriseContractId: identifierSchema,
});

export type AdminEnterpriseContractCreateInput = z.infer<
  typeof adminEnterpriseContractCreateSchema
>;
export type AdminEnterpriseContractLifecycleInput = z.infer<
  typeof adminEnterpriseContractLifecycleSchema
>;
export type AdminEnterpriseContractRenewInput = z.infer<
  typeof adminEnterpriseContractRenewSchema
>;
export type AdminEnterpriseContractEligibilityInput = z.infer<
  typeof adminEnterpriseContractEligibilitySchema
>;
export type AdminEnterpriseContractOwnerInput = z.infer<
  typeof adminEnterpriseContractOwnerSchema
>;
export type AdminEnterpriseContractBulkEnrollInput = z.infer<
  typeof adminEnterpriseContractBulkEnrollSchema
>;

export interface AdminEnterpriseContractDirectory {
  courses: Array<{
    id: string;
    title: string;
    version: number;
  }>;
  events: Array<{
    id: string;
    title: string;
    startsAt: string;
    timezone: string;
    remainingPlaces: number;
  }>;
  contracts: Array<{
    id: string;
    name: string;
    reference: string;
    organizationName: string;
    status: "draft" | "active" | "suspended" | "expired" | "terminated";
    startsAt: string;
    expiresAt: string;
    enrollmentDurationDays: number;
    autoEnrollCourses: boolean;
    renewedFromEnterpriseContractId: string | null;
    renewalContractId: string | null;
    coverage: Array<{ id: string; courseId: string; courseTitle: string }>;
    eventCoverage: Array<{
      id: string;
      eventOccurrenceId: string;
      eventTitle: string;
    }>;
    domains: Array<string>;
    employeeEligibilityCount: number;
    owners: Array<{
      id: string;
      email: string;
      activated: boolean;
    }>;
    claimCount: number;
    entitlementCount: number;
    createdAt: string;
  }>;
}

export type AdminEnterpriseContract =
  AdminEnterpriseContractDirectory["contracts"][number];

export type AdminEnterpriseContractResult<T> =
  | { status: "ready"; data: T }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

export type AdminEnterpriseContractMutationResult =
  | AdminEnterpriseContractResult<{
      outcome:
        | "created"
        | "activated"
        | "resumed"
        | "suspended"
        | "terminated"
        | "code_rotated"
        | "renewed"
        | "eligibility_replaced"
        | "owners_assigned"
        | "owner_revoked"
        | "bulk_enrollment_completed";
      enterpriseContractId: string;
      accessCode?: string;
      importedCount?: number;
      enrolledCount?: number;
      skippedCount?: number;
    }>
  | {
      status: "conflict";
      reason:
        | "duplicate_reference"
        | "invalid_transition"
        | "period_expired"
        | "offering_unavailable"
        | "renewal_exists"
        | "invalid_csv"
        | "invalid_owner_emails"
        | "no_active_code"
        | "eligibility_required"
        | "bulk_too_large";
    }
  | { status: "not-found" };

export type AdminEnterpriseContractRevealResult =
  | AdminEnterpriseContractResult<{
      enterpriseContractId: string;
      accessCode: string;
    }>
  | { status: "not-found" };
