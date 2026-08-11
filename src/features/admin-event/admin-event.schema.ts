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
const optionalText = (maximum: number) =>
  z.string().check(z.trim(), z.maxLength(maximum));
const absoluteUrl = z.union([z.literal(""), z.url("Enter a valid URL.")]);
const dateTime = z.iso.datetime({ offset: true });
const domainPattern =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u;

export function normalizeEventDomains(value: string): Array<string> | null {
  const domains = [
    ...new Set(
      value
        .split(/[\s,;]+/u)
        .map((domain) => domain.trim().toLocaleLowerCase("en-AU"))
        .filter(Boolean),
    ),
  ];
  if (
    domains.length > 50 ||
    domains.some((domain) => !domainPattern.test(domain))
  )
    return null;
  return domains;
}

export const adminEventTemplateCreateSchema = z.object({
  title: boundedText(160, "Enter an event template title."),
  slug: z
    .string()
    .check(
      z.trim(),
      z.minLength(1, "Enter a URL slug."),
      z.maxLength(100),
      z.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a valid URL slug."),
    ),
  summary: boundedText(320, "Enter a short summary."),
  description: boundedText(10_000, "Enter an event description."),
  sessionTitle: boundedText(160, "Enter the default session title."),
  sessionDurationMinutes: z
    .number()
    .check(z.int(), z.minimum(15), z.maximum(10_080)),
  hasCompletionCertificate: z.boolean(),
});

export const adminEventTemplateVersionParamsSchema = z.object({
  eventTemplateId: identifierSchema,
  eventTemplateVersionId: identifierSchema,
});

export const adminEventOccurrenceParamsSchema = z.object({
  eventOccurrenceId: identifierSchema,
});

export const adminEventOccurrenceCreateSchema = z
  .object({
    eventTemplateVersionId: identifierSchema,
    title: boundedText(200, "Enter an occurrence title."),
    deliveryMode: z.enum(["in_person", "virtual", "hybrid"]),
    registrationMode: z.enum([
      "open_entry",
      "required_unrestricted",
      "required_restricted",
    ]),
    approvalMode: z.enum(["automatic", "manual"]),
    timezone: boundedText(100, "Enter a timezone."),
    startsAt: dateTime,
    endsAt: dateTime,
    registrationOpensAt: z.union([z.literal(""), dateTime]),
    registrationClosesAt: z.union([z.literal(""), dateTime]),
    coordinatorLockAt: z.union([z.literal(""), dateTime]),
    capacity: z.number().check(z.int(), z.minimum(1), z.maximum(100_000)),
    venueName: optionalText(240),
    venueAddress: optionalText(1_000),
    virtualJoinUrl: absoluteUrl,
    domains: z.string().check(
      z.maxLength(5_000),
      z.refine(
        (value) => normalizeEventDomains(value) !== null,
        "Enter valid domain names separated by commas.",
      ),
    ),
  })
  .check(
    z.superRefine((value, context) => {
      const startsAt = new Date(value.startsAt);
      const endsAt = new Date(value.endsAt);
      if (endsAt <= startsAt)
        context.addIssue({
          code: "custom",
          path: ["endsAt"],
          message: "The occurrence must end after it starts.",
        });
      const domains = normalizeEventDomains(value.domains) ?? [];
      if (value.registrationMode === "required_restricted" && !domains.length)
        context.addIssue({
          code: "custom",
          path: ["domains"],
          message: "Add at least one permitted email domain.",
        });
      if (value.registrationMode !== "required_restricted" && domains.length)
        context.addIssue({
          code: "custom",
          path: ["domains"],
          message: "Domains apply only to restricted registration.",
        });
      if (
        (value.deliveryMode === "in_person" ||
          value.deliveryMode === "hybrid") &&
        !value.venueName.trim()
      )
        context.addIssue({
          code: "custom",
          path: ["venueName"],
          message: "Enter a venue for in-person delivery.",
        });
      if (
        (value.deliveryMode === "virtual" || value.deliveryMode === "hybrid") &&
        !value.virtualJoinUrl
      )
        context.addIssue({
          code: "custom",
          path: ["virtualJoinUrl"],
          message: "Enter the protected virtual meeting URL.",
        });
      const opens = value.registrationOpensAt
        ? new Date(value.registrationOpensAt)
        : null;
      const closes = value.registrationClosesAt
        ? new Date(value.registrationClosesAt)
        : null;
      const locks = value.coordinatorLockAt
        ? new Date(value.coordinatorLockAt)
        : null;
      if (opens && closes && closes <= opens)
        context.addIssue({
          code: "custom",
          path: ["registrationClosesAt"],
          message: "Registration must close after it opens.",
        });
      if (closes && locks && locks < closes)
        context.addIssue({
          code: "custom",
          path: ["coordinatorLockAt"],
          message: "Coordinator lock cannot precede registration close.",
        });
      if (value.registrationMode !== "open_entry" && (!opens || !closes))
        context.addIssue({
          code: "custom",
          path: ["registrationOpensAt"],
          message:
            "Registration-required events need an opening and closing time.",
        });
    }),
  );

export type AdminEventOccurrenceCreateInput = z.infer<
  typeof adminEventOccurrenceCreateSchema
>;
export type AdminEventOccurrenceFormInput = Omit<
  AdminEventOccurrenceCreateInput,
  | "startsAt"
  | "endsAt"
  | "registrationOpensAt"
  | "registrationClosesAt"
  | "coordinatorLockAt"
> & {
  startsAt: string;
  endsAt: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  coordinatorLockAt: string;
};

export const adminEventOccurrenceFormSchema = z
  .custom<AdminEventOccurrenceFormInput>(
    (value: unknown) => typeof value === "object" && value !== null,
  )
  .check(
    z.superRefine((value, context) => {
      const candidate = eventOccurrenceFormCandidate(value);
      const parsed = adminEventOccurrenceCreateSchema.safeParse(candidate);
      if (!parsed.success)
        for (const issue of parsed.error.issues) context.addIssue({ ...issue });
    }),
  );

function eventOccurrenceFormCandidate(
  input: AdminEventOccurrenceFormInput,
): Record<string, unknown> {
  const convert = (value: string) =>
    value ? `${value}${value.length === 16 ? ":00" : ""}Z` : "";
  const candidate: Record<string, unknown> = { ...input };
  for (const field of [
    "startsAt",
    "endsAt",
    "registrationOpensAt",
    "registrationClosesAt",
    "coordinatorLockAt",
  ] as const)
    candidate[field] = convert(input[field]);
  return candidate;
}

export type AdminEventTemplateCreateInput = z.infer<
  typeof adminEventTemplateCreateSchema
>;

export interface AdminEventWorkspace {
  templates: Array<{
    id: string;
    slug: string;
    title: string;
    status: "draft" | "published" | "archived";
    latestVersion: number;
    draftVersionId: string | null;
    publishedVersionId: string | null;
    publishedVersion: number | null;
    occurrenceCount: number;
  }>;
  publishedVersions: Array<{
    eventTemplateId: string;
    eventTemplateVersionId: string;
    title: string;
    version: number;
  }>;
  occurrences: Array<{
    id: string;
    eventTemplateId: string;
    eventTemplateTitle: string;
    templateVersion: number;
    title: string;
    status: "draft" | "published" | "cancelled" | "completed" | "archived";
    deliveryMode: "in_person" | "virtual" | "hybrid";
    registrationMode:
      "open_entry" | "required_unrestricted" | "required_restricted";
    timezone: string;
    startsAt: string;
    endsAt: string;
    capacity: number;
    confirmedCount: number;
    sessionCount: number;
    assignedAdminCount: number;
  }>;
}

export type AdminEventResult<T> =
  | { status: "ready"; data: T }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

export type AdminEventMutationResult =
  | AdminEventResult<{
      outcome:
        | "template-created"
        | "template-published"
        | "occurrence-created"
        | "occurrence-published";
      eventTemplateId?: string;
      eventTemplateVersionId?: string;
      eventOccurrenceId?: string;
    }>
  | { status: "not-found" }
  | {
      status: "conflict";
      reason:
        | "slug_in_use"
        | "template_not_publishable"
        | "occurrence_not_publishable";
    };
