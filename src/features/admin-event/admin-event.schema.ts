import { z } from "#/validation/zod";
import { isIanaTimeZone } from "#/features/shared/iana-timezone";
import {
  eventScheduleEmailItemSchema,
  type AdminCommunicationTemplateOption,
} from "#/features/admin-email/admin-communication.schema";
import type { EmailTemplateVariableGroup } from "#/features/admin-email/admin-email.schema";
import { certificateAccreditationsSchema } from "#/features/catalog/accreditation";
import { offeringTopicSchema } from "#/features/shared/offering-topic";
import { offeringImageSchema } from "#/features/shared/offering-image";
import {
  bulkPricingSchema,
  type BulkPricing,
} from "#/features/catalog/catalog.schema";

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
const dateTime = z.iso
  .datetime({ offset: true })
  .check(z.regex(/Z$/u, "Use a canonical UTC instant."));
const domainPattern =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u;

const eventTimezone = boundedText(100, "Select an event timezone.").check(
  z.refine(isIanaTimeZone, "Select a supported event timezone."),
);

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
  defaultAdministratorIds: z.array(identifierSchema).check(
    z.minLength(1, "Select at least one default administrator."),
    z.maxLength(20),
    z.refine(
      (ids) => new Set(ids).size === ids.length,
      "Default administrators must be unique.",
    ),
  ),
});

export const adminEventTemplateVersionParamsSchema = z.object({
  eventTemplateId: identifierSchema,
  eventTemplateVersionId: identifierSchema,
});

export const adminEventTemplateParamsSchema = z.object({
  eventTemplateId: identifierSchema,
});

export const adminEventTemplateCreateVersionSchema = z.object({
  eventTemplateId: identifierSchema,
  sourceVersionId: identifierSchema,
});

export const adminEventTemplateSelectionSchema = z.object({
  eventTemplateId: identifierSchema,
  eventTemplateVersionId: z.optional(identifierSchema),
});

export const adminEventStaffEligibilityGrantSchema = z
  .object({
    name: z.optional(z.string().check(z.trim(), z.maxLength(200))),
    email: z.email("Enter a valid user email address.").check(z.maxLength(320)),
    responsibility: z.enum(["presenter", "coordinator"]),
    regionId: z.nullable(identifierSchema),
  })
  .check(
    z.superRefine((value, context) => {
      if (value.responsibility === "presenter" && value.regionId !== null)
        context.addIssue({
          code: "custom",
          path: ["regionId"],
          message: "Presenter eligibility is not region-specific.",
        });
      if (value.responsibility === "coordinator" && value.regionId === null)
        context.addIssue({
          code: "custom",
          path: ["regionId"],
          message: "Select the coordinator's region.",
        });
    }),
  );
export type AdminEventStaffEligibilityGrantInput = z.infer<
  typeof adminEventStaffEligibilityGrantSchema
>;

export const adminEventStaffEligibilityParamsSchema = z.object({
  eligibilityId: identifierSchema,
});

export const adminEventStaffCandidateSearchSchema = z
  .object({
    q: z.string().check(z.trim(), z.minLength(2), z.maxLength(100)),
    responsibility: z.enum(["presenter", "coordinator"]),
    regionId: z.nullable(identifierSchema),
  })
  .check(
    z.superRefine((value, context) => {
      if (value.responsibility === "presenter" && value.regionId !== null)
        context.addIssue({
          code: "custom",
          path: ["regionId"],
          message: "Presenter search is not region-specific.",
        });
      if (value.responsibility === "coordinator" && value.regionId === null)
        context.addIssue({
          code: "custom",
          path: ["regionId"],
          message: "Select the coordinator's region before searching.",
        });
    }),
  );

export const adminCoordinationRegionSaveSchema = z
  .object({
    regionId: z.nullable(identifierSchema),
    name: boundedText(160, "Enter a region name."),
    code: z
      .string()
      .check(
        z.trim(),
        z.minLength(2, "Enter a region code."),
        z.maxLength(40),
        z.regex(
          /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u,
          "Use letters, numbers and hyphens only.",
        ),
      ),
    kind: z.enum(["group", "operational"]),
    parentId: z.nullable(identifierSchema),
  })
  .check(
    z.superRefine((value, context) => {
      if (value.kind === "group" && value.parentId !== null)
        context.addIssue({
          code: "custom",
          path: ["parentId"],
          message: "Region groups must be top-level.",
        });
      if (value.regionId !== null && value.regionId === value.parentId)
        context.addIssue({
          code: "custom",
          path: ["parentId"],
          message: "A region cannot be its own parent.",
        });
    }),
  );

export const adminCoordinationRegionStatusSchema = z.object({
  regionId: identifierSchema,
  status: z.enum(["active", "retired"]),
});

export type AdminCoordinationRegionSaveInput = z.infer<
  typeof adminCoordinationRegionSaveSchema
>;

const eventTemplateItemBase = {
  id: identifierSchema,
  title: boundedText(200, "Enter an item title."),
  required: z.boolean(),
};

const adminEventTemplateItemSchema = z.discriminatedUnion("kind", [
  z.object({
    ...eventTemplateItemBase,
    kind: z.literal("session"),
    durationMinutes: z
      .number()
      .check(z.int(), z.minimum(15), z.maximum(10_080)),
    presenterRequired: z.boolean(),
    presenterIds: z.array(identifierSchema).check(z.maxLength(20)),
  }),
  z.object({
    ...eventTemplateItemBase,
    kind: z.literal("scorm"),
    durationMinutes: z
      .number()
      .check(z.int(), z.minimum(1), z.maximum(100_000)),
    learningActivityVersionId: identifierSchema,
  }),
  eventScheduleEmailItemSchema,
  z.object({
    ...eventTemplateItemBase,
    kind: z.literal("survey"),
    durationMinutes: z.nullable(
      z.number().check(z.int(), z.minimum(1), z.maximum(100_000)),
    ),
    learningActivityVersionId: identifierSchema,
  }),
  z.object({
    ...eventTemplateItemBase,
    kind: z.literal("resource"),
    durationMinutes: z.null(),
    learningActivityVersionId: identifierSchema,
  }),
]);

const adminEventTemplateSectionSchema = z
  .object({
    id: identifierSchema,
    title: boundedText(160, "Enter a section title."),
    description: optionalText(2_000),
    phase: z.enum(["pre_event", "session", "post_event", "follow_up"]),
    releaseAnchor: z.enum([
      "participation_created",
      "occurrence_start",
      "occurrence_end",
      "final_session_end",
    ]),
    releaseOffsetAmount: z.number().check(z.int()),
    releaseOffsetUnit: z.enum(["minute", "hour", "day", "week", "month"]),
    items: z.array(adminEventTemplateItemSchema).check(z.maxLength(200)),
  })
  .check(
    z.superRefine((section, context) => {
      const maximum = {
        minute: 5_256_000,
        hour: 87_600,
        day: 3_650,
        week: 520,
        month: 120,
      }[section.releaseOffsetUnit];
      if (Math.abs(section.releaseOffsetAmount) > maximum)
        context.addIssue({
          code: "custom",
          path: ["releaseOffsetAmount"],
          message: "Keep the release offset within ten years.",
        });
    }),
  );

const adminEventTemplateRegionSchema = z.object({
  regionId: identifierSchema,
  coordinatorIds: z
    .array(identifierSchema)
    .check(z.minLength(1), z.maxLength(20)),
});

export const adminEventTemplateDraftSchema = z
  .object({
    eventTemplateId: identifierSchema,
    eventTemplateVersionId: identifierSchema,
    title: boundedText(160, "Enter an event template title."),
    topic: offeringTopicSchema,
    summary: boundedText(320, "Enter a short summary."),
    description: boundedText(10_000, "Enter an event description."),
    coverImage: z._default(offeringImageSchema, null),
    hasCompletionCertificate: z.boolean(),
    accreditations: z._default(certificateAccreditationsSchema, []),
    defaultAdministratorIds: z
      .array(identifierSchema)
      .check(
        z.minLength(1, "Select at least one default administrator."),
        z.maxLength(20),
      ),
    regions: z.array(adminEventTemplateRegionSchema).check(z.maxLength(100)),
    sections: z.array(adminEventTemplateSectionSchema).check(z.maxLength(100)),
  })
  .check(
    z.superRefine((draft, context) => {
      const identifiers = new Set<string>();
      const sessionItemIds = new Set(
        draft.sections.flatMap((section) =>
          section.items.flatMap((item) =>
            item.kind === "session" ? [item.id] : [],
          ),
        ),
      );
      if (
        new Set(draft.defaultAdministratorIds).size !==
        draft.defaultAdministratorIds.length
      )
        context.addIssue({
          code: "custom",
          path: ["defaultAdministratorIds"],
          message: "Default administrators must be unique.",
        });
      const regionIds = new Set<string>();
      for (const [regionIndex, region] of draft.regions.entries()) {
        if (regionIds.has(region.regionId))
          context.addIssue({
            code: "custom",
            path: ["regions", regionIndex, "regionId"],
            message: "Regions must be unique.",
          });
        regionIds.add(region.regionId);
        if (
          new Set(region.coordinatorIds).size !== region.coordinatorIds.length
        )
          context.addIssue({
            code: "custom",
            path: ["regions", regionIndex, "coordinatorIds"],
            message: "Coordinators must be unique within a region.",
          });
      }
      for (const [sectionIndex, section] of draft.sections.entries()) {
        if (identifiers.has(section.id))
          context.addIssue({
            code: "custom",
            path: ["sections", sectionIndex, "id"],
            message: "Section identifiers must be unique.",
          });
        identifiers.add(section.id);
        for (const [itemIndex, item] of section.items.entries()) {
          if (identifiers.has(item.id))
            context.addIssue({
              code: "custom",
              path: ["sections", sectionIndex, "items", itemIndex, "id"],
              message: "Item identifiers must be unique.",
            });
          identifiers.add(item.id);
          if (
            item.kind === "automated_email" &&
            item.sessionItemId &&
            !sessionItemIds.has(item.sessionItemId)
          ) {
            context.addIssue({
              code: "custom",
              path: [
                "sections",
                sectionIndex,
                "items",
                itemIndex,
                "sessionItemId",
              ],
              message: "Select a session from this event template.",
            });
          }
          if (
            item.kind === "automated_email" &&
            item.trigger === "session_start" &&
            !item.sessionItemId
          )
            context.addIssue({
              code: "custom",
              path: [
                "sections",
                sectionIndex,
                "items",
                itemIndex,
                "sessionItemId",
              ],
              message: "Select the session that anchors this email.",
            });
          if (
            item.kind === "session" &&
            item.presenterRequired &&
            item.presenterIds.length === 0
          )
            context.addIssue({
              code: "custom",
              path: [
                "sections",
                sectionIndex,
                "items",
                itemIndex,
                "presenterIds",
              ],
              message:
                "Select a presenter or make the session presenter-optional.",
            });
          if (
            item.kind === "session" &&
            new Set(item.presenterIds).size !== item.presenterIds.length
          )
            context.addIssue({
              code: "custom",
              path: [
                "sections",
                sectionIndex,
                "items",
                itemIndex,
                "presenterIds",
              ],
              message: "Presenters must be unique within a session.",
            });
        }
      }
    }),
  );

export const adminEventOccurrenceParamsSchema = z.object({
  eventOccurrenceId: identifierSchema,
});

export const adminEventOccurrenceCreateSchema = z
  .object({
    eventTemplateVersionId: identifierSchema,
    title: boundedText(200, "Enter an occurrence title."),
    slug: z
      .string()
      .check(
        z.trim(),
        z.minLength(1, "Enter a URL slug."),
        z.maxLength(100),
        z.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use a valid URL slug."),
      ),
    deliveryMode: z.enum(["in_person", "virtual"]),
    registrationMode: z.enum([
      "open_entry",
      "paid_entry",
      "required_unrestricted",
      "required_restricted",
    ]),
    approvalMode: z.enum(["automatic", "manual"]),
    timezone: eventTimezone,
    startsAt: dateTime,
    endsAt: dateTime,
    registrationOpensAt: z.union([z.literal(""), dateTime]),
    registrationClosesAt: z.union([z.literal(""), dateTime]),
    coordinatorLockAt: z.union([z.literal(""), dateTime]),
    capacity: z.number().check(z.int(), z.minimum(1), z.maximum(100_000)),
    priceCents: z.nullable(
      z.number().check(z.int(), z.positive(), z.maximum(100_000_000)),
    ),
    salePriceCents: z.nullable(
      z.number().check(z.int(), z.positive(), z.maximum(100_000_000)),
    ),
    currency: z.literal("AUD"),
    bulkPricing: bulkPricingSchema,
    listInStore: z.boolean(),
    featured: z.boolean(),
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
      if (
        (value.registrationMode === "open_entry" ||
          value.registrationMode === "paid_entry") &&
        value.approvalMode !== "automatic"
      )
        context.addIssue({
          code: "custom",
          path: ["approvalMode"],
          message:
            "Open-entry and paid-entry events do not have a registration approval step.",
        });
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
      if (value.deliveryMode === "in_person" && !value.venueName.trim())
        context.addIssue({
          code: "custom",
          path: ["venueName"],
          message: "Enter a venue for in-person delivery.",
        });
      if (value.deliveryMode === "virtual" && !value.virtualJoinUrl)
        context.addIssue({
          code: "custom",
          path: ["virtualJoinUrl"],
          message: "Enter the protected virtual meeting URL.",
        });
      if (value.deliveryMode === "in_person" && value.virtualJoinUrl)
        context.addIssue({
          code: "custom",
          path: ["virtualJoinUrl"],
          message: "Virtual meeting details do not apply to in-person events.",
        });
      if (
        value.deliveryMode === "virtual" &&
        (value.venueName.trim() || value.venueAddress.trim())
      )
        context.addIssue({
          code: "custom",
          path: ["venueName"],
          message: "Venue details do not apply to virtual events.",
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
      if (
        value.registrationMode !== "open_entry" &&
        value.registrationMode !== "paid_entry" &&
        (!opens || !closes)
      )
        context.addIssue({
          code: "custom",
          path: ["registrationOpensAt"],
          message:
            "Registration-required events need an opening and closing time.",
        });
      if (value.registrationMode === "paid_entry") {
        if (value.priceCents === null)
          context.addIssue({
            code: "custom",
            path: ["priceCents"],
            message: "Enter the paid-entry price.",
          });
        if (
          value.priceCents !== null &&
          value.salePriceCents !== null &&
          value.salePriceCents >= value.priceCents
        )
          context.addIssue({
            code: "custom",
            path: ["salePriceCents"],
            message: "Sale price must be lower than the original price.",
          });
        const individualPrice = value.salePriceCents ?? value.priceCents ?? 0;
        for (const [index, tier] of value.bulkPricing.tiers.entries())
          if (tier.unitPriceCents >= individualPrice)
            context.addIssue({
              code: "custom",
              path: ["bulkPricing", "tiers", index, "unitPriceCents"],
              message:
                "Bulk seat prices must be lower than the individual price.",
            });
      } else if (
        value.priceCents !== null ||
        value.salePriceCents !== null ||
        value.bulkPricing.enabled
      )
        context.addIssue({
          code: "custom",
          path: ["registrationMode"],
          message: "Pricing applies only to paid-entry events.",
        });
    }),
  );

export type AdminEventOccurrenceCreateInput = z.infer<
  typeof adminEventOccurrenceCreateSchema
> & {
  localStartsAt: string;
  localEndsAt: string;
  localRegistrationOpensAt: string;
  localRegistrationClosesAt: string;
  localCoordinatorLockAt: string;
};
export type AdminEventOccurrenceFormInput = Omit<
  AdminEventOccurrenceCreateInput,
  | "startsAt"
  | "endsAt"
  | "registrationOpensAt"
  | "registrationClosesAt"
  | "coordinatorLockAt"
  | "localStartsAt"
  | "localEndsAt"
  | "localRegistrationOpensAt"
  | "localRegistrationClosesAt"
  | "localCoordinatorLockAt"
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

export const adminEventOccurrenceUpdateFormSchema = z.object({
  eventOccurrenceId: identifierSchema,
  occurrence: adminEventOccurrenceFormSchema,
});

const adminEventOccurrenceRescheduleRegionSchema = z.object({
  regionId: identifierSchema,
  coordinatorIds: z.array(identifierSchema).check(
    z.minLength(1, "Assign at least one coordinator."),
    z.maxLength(20),
    z.refine(
      (ids) => new Set(ids).size === ids.length,
      "Coordinators must be unique within a region.",
    ),
  ),
});

export const adminEventOccurrenceRescheduleFormSchema = z
  .object({
    eventOccurrenceId: identifierSchema,
    occurrence: adminEventOccurrenceFormSchema,
    registrationWindowPolicy: z.enum(["keep", "replace_future", "reopen"]),
    regionsConfirmed: z.literal(true, {
      error: "Confirm the event's regional coverage before rescheduling.",
    }),
    regionalCoverage: z.object({
      regions: z
        .array(adminEventOccurrenceRescheduleRegionSchema)
        .check(z.maxLength(100)),
      retirements: z
        .array(
          z.object({
            regionId: identifierSchema,
            disposition: z.enum(["future_only", "cancel_registrations"]),
          }),
        )
        .check(z.maxLength(100)),
    }),
  })
  .check(
    z.superRefine((input, context) => {
      for (const [path, regionIds] of [
        ["regions", input.regionalCoverage.regions.map((row) => row.regionId)],
        [
          "retirements",
          input.regionalCoverage.retirements.map((row) => row.regionId),
        ],
      ] as const)
        if (new Set(regionIds).size !== regionIds.length)
          context.addIssue({
            code: "custom",
            path: ["regionalCoverage", path],
            message: "Regions must be unique.",
          });
    }),
  );

export type AdminEventOccurrenceRegionalCoverageInput = z.infer<
  typeof adminEventOccurrenceRescheduleFormSchema
>["regionalCoverage"];

export interface AdminEventOccurrenceRegionalCoverageOptions {
  availableRegions: Array<{
    id: string;
    name: string;
    code: string;
    parentName: string | null;
  }>;
  availableCoordinators: Array<AdminEventPersonOption & { regionId: string }>;
  availableUsers: Array<AdminEventPersonOption>;
  currentRegions: Array<{
    regionId: string;
    name: string;
    code: string;
    coordinatorIds: Array<string>;
    selectedCount: number;
    affectedActiveCount: number;
  }>;
}

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
export type AdminEventTemplateDraft = z.infer<
  typeof adminEventTemplateDraftSchema
>;
export type AdminEventTemplateItem = z.infer<
  typeof adminEventTemplateItemSchema
>;

export interface AdminEventPersonOption {
  id: string;
  name: string;
  email: string;
}

export interface AdminEventCoordinatorCoverageImpact {
  eventOccurrenceId: string;
  eventOccurrenceRegionId: string;
  occurrenceTitle: string;
  occurrenceStatus: "draft" | "published";
  occurrenceStartsAt: string;
  occurrenceTimezone: string;
  regionName: string;
  regionCode: string;
}

interface AdminEventPresenterOption extends AdminEventPersonOption {
  eligibilityId: string;
}

interface AdminEventCoordinatorOption extends AdminEventPersonOption {
  eligibilityId: string;
  regionId: string;
  regionName: string;
}

export interface AdminEventTemplateDetail {
  template: {
    id: string;
    title: string;
    status: "draft" | "published" | "archived";
  };
  version: {
    id: string;
    version: number;
    publishedAt: string | null;
    editable: boolean;
  };
  versions: Array<{
    id: string;
    version: number;
    publishedAt: string | null;
  }>;
  draft: AdminEventTemplateDraft;
  emailTemplates: Array<AdminCommunicationTemplateOption>;
  emailVariableGroups: Array<EmailTemplateVariableGroup>;
  people: {
    platformAdministrators: Array<AdminEventPersonOption>;
    coordinators: Array<AdminEventCoordinatorOption>;
    presenters: Array<AdminEventPresenterOption>;
    users: Array<AdminEventPersonOption>;
  };
  regions: Array<{
    id: string;
    name: string;
    code: string;
    parentId: string | null;
    parentName: string | null;
  }>;
  library: {
    modules: Array<{ id: string; title: string; version: number }>;
    surveys: Array<{
      id: string;
      title: string;
      version: number;
      type: "event" | "shared";
    }>;
    resources: Array<{ id: string; title: string; version: number }>;
  };
}

export interface AdminEventWorkspace {
  templates: Array<{
    id: string;
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
  platformAdministrators: Array<AdminEventPersonOption>;
  coordinators: Array<AdminEventCoordinatorOption>;
  presenters: Array<AdminEventPresenterOption>;
  regions: Array<{
    id: string;
    name: string;
    code: string;
    kind: "group" | "operational";
    status: "active" | "retired";
    parentId: string | null;
    parentName: string | null;
  }>;
  occurrences: Array<{
    id: string;
    eventTemplateVersionId: string;
    eventTemplateId: string;
    eventTemplateTitle: string;
    templateVersion: number;
    title: string;
    slug: string;
    status: "draft" | "published" | "cancelled" | "completed" | "archived";
    deliveryMode: "in_person" | "virtual";
    registrationMode:
      | "open_entry"
      | "paid_entry"
      | "required_unrestricted"
      | "required_restricted";
    approvalMode: "automatic" | "manual";
    timezone: string;
    localStartsAt: string;
    localEndsAt: string;
    localRegistrationOpensAt: string;
    localRegistrationClosesAt: string;
    localCoordinatorLockAt: string;
    startsAt: string;
    endsAt: string;
    registrationOpensAt: string;
    registrationClosesAt: string;
    coordinatorLockAt: string;
    capacity: number;
    priceCents: number | null;
    salePriceCents: number | null;
    currency: "AUD";
    bulkPricing: BulkPricing;
    listInStore: boolean;
    featured: boolean;
    venueName: string;
    venueAddress: string;
    virtualJoinUrl: string;
    openEntryAttendanceMode: "checked_in" | "attended";
    domains: string;
    regions: string;
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
        | "template-saved"
        | "template-version-created"
        | "template-version-deleted"
        | "template-deleted"
        | "template-published"
        | "occurrence-created"
        | "occurrence-updated"
        | "occurrence-rescheduled"
        | "occurrence-published"
        | "staff-eligibility-granted"
        | "staff-eligibility-revoked"
        | "region-created"
        | "region-updated"
        | "region-retired"
        | "region-reactivated";
      eventTemplateId?: string;
      eventTemplateVersionId?: string;
      eventOccurrenceId?: string;
      eligibilityId?: string;
      accountInvited?: boolean;
      regionId?: string;
    }>
  | { status: "not-found" }
  | {
      status: "conflict";
      reason:
        | "slug_in_use"
        | "template_not_publishable"
        | "template_version_not_deletable"
        | "registration_window_policy_invalid"
        | "regions_not_confirmed"
        | "region_code_in_use"
        | "region_not_retirable"
        | "coordinator_coverage_required"
        | "event_too_short"
        | "occurrence_not_publishable";
      coordinatorCoverage?: Array<AdminEventCoordinatorCoverageImpact>;
      minimumDurationMinutes?: number;
    };

export type AdminEventTemplateDetailResult =
  AdminEventResult<AdminEventTemplateDetail> | { status: "not-found" };
