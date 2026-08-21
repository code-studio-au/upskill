import { z } from "#/validation/zod";

const identifierSchema = z
  .string()
  .check(
    z.trim(),
    z.minLength(1),
    z.maxLength(255),
    z.regex(/^[A-Za-z0-9_-]+$/),
  );
const boundedText = (maximum: number, message: string) =>
  z.string().check(z.trim(), z.minLength(2, message), z.maxLength(maximum));
const domainPattern =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u;

export function normalizeAdminAccessDomains(
  value: string,
): Array<string> | null {
  const domains = [
    ...new Set(
      value
        .split(/[\s,;]+/u)
        .map((domain) => domain.trim().toLocaleLowerCase("en-AU"))
        .filter(Boolean),
    ),
  ];
  if (
    domains.length > 20 ||
    domains.some((domain) => !domainPattern.test(domain))
  )
    return null;
  return domains;
}

export function normalizeAccessOwnerEmails(
  value: string,
): Array<string> | null {
  const emails = [
    ...new Set(
      value
        .split(/[\s,;]+/u)
        .map((email) => email.trim().toLocaleLowerCase("en-AU"))
        .filter(Boolean),
    ),
  ];
  if (
    emails.length < 1 ||
    emails.length > 20 ||
    emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
  )
    return null;
  return emails;
}

const expiryDateSchema = z.string().check(
  z.trim(),
  z.maxLength(10),
  z.refine(
    (value) => value === "" || /^\d{4}-\d{2}-\d{2}$/u.test(value),
    "Enter a valid expiry date.",
  ),
);

export const adminAccessGrantCreateSchema = z.object({
  label: boundedText(120, "Enter a grant label."),
  organizationName: boundedText(120, "Enter an organisation name."),
  accessCode: z.string().check(
    z.trim(),
    z.minLength(8, "Use at least eight letters or numbers."),
    z.maxLength(80, "Use no more than 80 characters."),
    z.regex(
      /^[A-Za-z0-9]+(?:[ -][A-Za-z0-9]+)*$/u,
      "Use letters, numbers, spaces and hyphens only.",
    ),
    z.refine((value) => {
      const normalizedLength = value.replaceAll(/[ -]/gu, "").length;
      return normalizedLength >= 8 && normalizedLength <= 64;
    }, "Use between eight and 64 letters or numbers."),
  ),
  targetType: z.enum(["course", "event"]),
  targetId: identifierSchema,
  quantity: z
    .number()
    .check(
      z.int("Enter a whole number."),
      z.minimum(1, "Allow at least one enrolment."),
      z.maximum(100_000),
    ),
  enrollmentDurationDays: z
    .number()
    .check(
      z.int("Enter a whole number."),
      z.minimum(1, "Access must last at least one day."),
      z.maximum(3650),
    ),
  expiresOn: expiryDateSchema,
  domains: z.string().check(
    z.maxLength(2_000),
    z.refine(
      (value) => normalizeAdminAccessDomains(value) !== null,
      "Enter valid domain names separated by commas.",
    ),
  ),
  kind: z.enum(["bulk_purchase", "enterprise_contract"]),
  fulfillmentMode: z.enum(["shared_code", "single_use_codes"]),
  customerExtendable: z.boolean(),
  ownerEmails: z.string().check(
    z.maxLength(2_000),
    z.refine(
      (value) => normalizeAccessOwnerEmails(value) !== null,
      "Enter at least one valid Access Owner email.",
    ),
  ),
});

export const adminAccessGrantRevokeSchema = z.object({
  accessGrantId: identifierSchema,
});

export const adminAccessGrantRevealSchema = z.object({
  accessGrantId: identifierSchema,
});

export const adminAccessGrantRedemptionsSchema = z.object({
  accessGrantId: identifierSchema,
  page: z.number().check(z.int(), z.minimum(1), z.maximum(1_000)),
});

export const adminAccessGrantCapacitySchema = z.object({
  accessGrantId: identifierSchema,
  quantity: z
    .number()
    .check(
      z.int("Enter a whole number."),
      z.minimum(1, "Allow at least one enrolment."),
      z.maximum(100_000),
    ),
});

export type AdminAccessGrantCreateInput = z.infer<
  typeof adminAccessGrantCreateSchema
>;
export type AdminAccessGrantRevokeInput = z.infer<
  typeof adminAccessGrantRevokeSchema
>;
export type AdminAccessGrantRevealInput = z.infer<
  typeof adminAccessGrantRevealSchema
>;
export type AdminAccessGrantRedemptionsInput = z.infer<
  typeof adminAccessGrantRedemptionsSchema
>;
export type AdminAccessGrantCapacityInput = z.infer<
  typeof adminAccessGrantCapacitySchema
>;

export interface AdminAccessGrantDirectory {
  targets: Array<{
    type: "course" | "event";
    id: string;
    title: string;
    detail: string;
  }>;
  grants: Array<{
    id: string;
    label: string;
    organizationName: string | null;
    offeringType: "course" | "event";
    offeringTitle: string;
    offeringDetail: string;
    quantity: number;
    redeemed: number;
    enrollmentDurationDays: number | null;
    domains: Array<string>;
    expiresAt: string | null;
    revokedAt: string | null;
    createdAt: string;
    kind: "bulk_purchase" | "enterprise_contract";
    fulfillmentMode: "shared_code" | "single_use_codes";
    customerExtendable: boolean;
    owners: Array<{
      id: string;
      name: string;
      email: string;
      status: "pending" | "active";
    }>;
  }>;
}

export interface AdminAccessGrantRedemptionPage {
  rows: Array<{
    enrollmentId: string;
    learnerId: string;
    learnerName: string;
    learnerEmail: string;
    enrolledAt: string;
    state: "active" | "completed" | "expired" | "removed";
  }>;
  page: number;
  pageSize: number;
  total: number;
}

export type AdminAccessGrant = AdminAccessGrantDirectory["grants"][number];

export type AdminAccessGrantResult<T> =
  | { status: "ready"; data: T }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

export type AdminAccessGrantRedemptionsResult =
  | AdminAccessGrantResult<AdminAccessGrantRedemptionPage>
  | { status: "not-found" };

export type AdminAccessGrantMutationResult =
  | AdminAccessGrantResult<{
      outcome: "created" | "revoked" | "unchanged" | "capacity-updated";
      accessGrantId: string;
      accessCode?: string;
      generatedCodeCount?: number;
    }>
  | { status: "not-found"; entity: "access-grant" | "offering" }
  | {
      status: "conflict";
      reason:
        | "capacity_below_redeemed"
        | "batch_capacity_reduction"
        | "expiry_not_future";
    };

export type AdminAccessGrantRevealResult =
  | AdminAccessGrantResult<{
      accessGrantId: string;
      accessCode: string;
    }>
  | { status: "not-found"; entity: "access-grant" };
