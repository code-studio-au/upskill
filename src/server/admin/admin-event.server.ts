import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import {
  adminEventTemplateDraftSchema,
  normalizeEventDomains,
  type AdminCoordinationRegionSaveInput,
  type AdminEventOccurrenceCreateInput,
  type AdminEventPersonOption,
  type AdminEventTemplateCreateInput,
  type AdminEventTemplateDetail,
  type AdminEventTemplateDraft,
  type AdminEventTemplateItem,
  type AdminEventWorkspace,
} from "#/features/admin-event/admin-event.schema";
import {
  ianaTimeZoneSchema,
  instantIsoSchema,
  type IsoDuration,
} from "#/features/shared/time.schema";
import { isIanaTimeZone } from "#/features/shared/iana-timezone";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { ensureEventSurveyAccessRecords } from "#/server/events/event-survey-access.server";
import { calculateEventSectionReleaseAt } from "#/server/learning/event-section-release.server";
import { logServerEvent } from "#/server/logging/server-logger";
import { isAdminEventScheduleConsistent } from "#/server/admin/event-timezone.server";
import {
  addElapsedDuration,
  dateToInstant,
  instantToDate,
  instantToLocalDateTime,
} from "#/server/time/time.server";

function optionalDate(value: string): Date | null {
  return value ? instantToDate(instantIsoSchema.parse(value)) : null;
}

function requiredDate(value: string): Date {
  return instantToDate(instantIsoSchema.parse(value));
}

function addElapsedMinutes(value: Date, minutes: number): Date {
  return instantToDate(
    addElapsedDuration(
      dateToInstant(value),
      `PT${String(minutes)}M` as IsoDuration,
    ),
  );
}

function localDateTimeFor(value: Date, timezone: string): string {
  return instantToLocalDateTime(
    dateToInstant(value),
    ianaTimeZoneSchema.parse(timezone),
  );
}

function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

export async function findAdminEventWorkspace(): Promise<AdminEventWorkspace> {
  const database = getDatabase();
  const [
    templates,
    versions,
    occurrences,
    occurrenceDomains,
    platformAdministrators,
    presenters,
    regions,
    coordinators,
  ] = await Promise.all([
    database
      .selectFrom("event_template")
      .select(["id", "title", "status"])
      .orderBy("title")
      .execute(),
    database
      .selectFrom("event_template_version")
      .select(["id", "eventTemplateId", "version", "publishedAt"])
      .orderBy("version", "desc")
      .execute(),
    database
      .selectFrom("event_occurrence")
      .innerJoin(
        "event_template_version",
        "event_template_version.id",
        "event_occurrence.eventTemplateVersionId",
      )
      .innerJoin(
        "event_template",
        "event_template.id",
        "event_template_version.eventTemplateId",
      )
      .select([
        "event_occurrence.id",
        "event_occurrence.eventTemplateVersionId",
        "event_template.id as eventTemplateId",
        "event_template.title as eventTemplateTitle",
        "event_template_version.version as templateVersion",
        "event_occurrence.title",
        "event_occurrence.slug",
        "event_occurrence.status",
        "event_occurrence.deliveryMode",
        "event_occurrence.registrationMode",
        "event_occurrence.approvalMode",
        "event_occurrence.timezone",
        "event_occurrence.localStartsAt",
        "event_occurrence.localEndsAt",
        "event_occurrence.localRegistrationOpensAt",
        "event_occurrence.localRegistrationClosesAt",
        "event_occurrence.localCoordinatorLockAt",
        "event_occurrence.startsAt",
        "event_occurrence.endsAt",
        "event_occurrence.registrationOpensAt",
        "event_occurrence.registrationClosesAt",
        "event_occurrence.coordinatorLockAt",
        "event_occurrence.capacity",
        "event_occurrence.confirmedCount",
        "event_occurrence.venueName",
        "event_occurrence.venueAddress",
        "event_occurrence.virtualJoinUrl",
        sql<number>`(
          select count(*)::integer from event_session
          where event_session."eventOccurrenceId" = event_occurrence.id
        )`.as("sessionCount"),
        sql<number>`(
          select count(*)::integer from event_admin_assignment
          where event_admin_assignment."eventOccurrenceId" = event_occurrence.id
            and event_admin_assignment."endedAt" is null
        )`.as("assignedAdminCount"),
      ])
      .orderBy("event_occurrence.startsAt", "asc")
      .execute(),
    database
      .selectFrom("event_occurrence_domain")
      .select(["eventOccurrenceId", "domain"])
      .orderBy("domain")
      .execute(),
    database
      .selectFrom("platform_admin")
      .innerJoin("user", "user.id", "platform_admin.userId")
      .select(["user.id", "user.name", "user.email"])
      .orderBy("user.name")
      .orderBy("user.email")
      .execute(),
    database
      .selectFrom("event_staff_eligibility as eligibility")
      .innerJoin("user", "user.id", "eligibility.userId")
      .select([
        "eligibility.id as eligibilityId",
        "user.id",
        "user.name",
        "user.email",
      ])
      .where("eligibility.responsibility", "=", "presenter")
      .where("eligibility.revokedAt", "is", null)
      .orderBy("user.name")
      .orderBy("user.email")
      .execute(),
    database
      .selectFrom("coordination_region as region")
      .leftJoin("coordination_region as parent", "parent.id", "region.parentId")
      .select([
        "region.id",
        "region.name",
        "region.code",
        "region.kind",
        "region.status",
        "region.parentId",
        "parent.name as parentName",
      ])
      .orderBy("parent.name")
      .orderBy("region.kind")
      .orderBy("region.name")
      .execute(),
    database
      .selectFrom("event_staff_eligibility as eligibility")
      .innerJoin("user", "user.id", "eligibility.userId")
      .innerJoin(
        "coordination_region as region",
        "region.id",
        "eligibility.regionId",
      )
      .select([
        "eligibility.id as eligibilityId",
        "user.id",
        "user.name",
        "user.email",
        "region.id as regionId",
        "region.name as regionName",
      ])
      .where("eligibility.responsibility", "=", "coordinator")
      .where("eligibility.revokedAt", "is", null)
      .where("region.status", "=", "active")
      .orderBy("region.name")
      .orderBy("user.name")
      .orderBy("user.email")
      .execute(),
  ]);

  const versionsByTemplate = new Map<
    string,
    Array<(typeof versions)[number]>
  >();
  for (const version of versions) {
    const current = versionsByTemplate.get(version.eventTemplateId) ?? [];
    current.push(version);
    versionsByTemplate.set(version.eventTemplateId, current);
  }
  const occurrenceCounts = new Map<string, number>();
  for (const occurrence of occurrences)
    occurrenceCounts.set(
      occurrence.eventTemplateId,
      (occurrenceCounts.get(occurrence.eventTemplateId) ?? 0) + 1,
    );

  return {
    templates: templates.map((template) => {
      const templateVersions = versionsByTemplate.get(template.id) ?? [];
      const draft = templateVersions.find((version) => !version.publishedAt);
      const published = templateVersions.find((version) => version.publishedAt);
      return {
        ...template,
        latestVersion: templateVersions[0]?.version ?? 0,
        draftVersionId: draft?.id ?? null,
        publishedVersionId: published?.id ?? null,
        publishedVersion: published?.version ?? null,
        occurrenceCount: occurrenceCounts.get(template.id) ?? 0,
      };
    }),
    publishedVersions: templates.flatMap((template) => {
      const published = (versionsByTemplate.get(template.id) ?? []).find(
        (version) => version.publishedAt,
      );
      return published
        ? [
            {
              eventTemplateId: template.id,
              eventTemplateVersionId: published.id,
              title: template.title,
              version: published.version,
            },
          ]
        : [];
    }),
    platformAdministrators,
    presenters,
    coordinators,
    regions,
    occurrences: occurrences.map((occurrence) => ({
      ...occurrence,
      startsAt: occurrence.startsAt.toISOString(),
      endsAt: occurrence.endsAt.toISOString(),
      registrationOpensAt: occurrence.registrationOpensAt?.toISOString() ?? "",
      registrationClosesAt:
        occurrence.registrationClosesAt?.toISOString() ?? "",
      coordinatorLockAt: occurrence.coordinatorLockAt?.toISOString() ?? "",
      localRegistrationOpensAt: occurrence.localRegistrationOpensAt ?? "",
      localRegistrationClosesAt: occurrence.localRegistrationClosesAt ?? "",
      localCoordinatorLockAt: occurrence.localCoordinatorLockAt ?? "",
      venueName: occurrence.venueName ?? "",
      venueAddress: occurrence.venueAddress ?? "",
      virtualJoinUrl: occurrence.virtualJoinUrl ?? "",
      domains: occurrenceDomains
        .filter((domain) => domain.eventOccurrenceId === occurrence.id)
        .map((domain) => domain.domain)
        .join(", "),
    })),
  };
}

export async function grantAdminEventStaffEligibility(
  input: {
    email: string;
    responsibility: "presenter" | "coordinator";
    regionId: string | null;
  },
  administrator: AuthenticatedUser,
): Promise<{ status: "granted" | "unchanged"; eligibilityId: string } | null> {
  const normalizedEmail = input.email.trim().toLocaleLowerCase("en-AU");
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const user = await transaction
        .selectFrom("user")
        .select("id")
        .where(sql<boolean>`lower("email") = ${normalizedEmail}`)
        .executeTakeFirst();
      if (!user) return null;
      if (input.responsibility === "coordinator") {
        if (!input.regionId) return null;
        const region = await transaction
          .selectFrom("coordination_region")
          .select(["id", "kind"])
          .where("id", "=", input.regionId)
          .where("status", "=", "active")
          .executeTakeFirst();
        if (!region || region.kind !== "operational") return null;
      }
      const existing = await transaction
        .selectFrom("event_staff_eligibility")
        .select("id")
        .where("userId", "=", user.id)
        .where("responsibility", "=", input.responsibility)
        .where("regionId", input.regionId === null ? "is" : "=", input.regionId)
        .where("revokedAt", "is", null)
        .executeTakeFirst();
      if (existing)
        return {
          status: "unchanged" as const,
          eligibilityId: existing.id,
        };
      const grantId = `staff_eligibility_${randomUUID()}`;
      await transaction
        .insertInto("event_staff_eligibility")
        .values({
          id: grantId,
          userId: user.id,
          responsibility: input.responsibility,
          regionId: input.regionId,
          grantedByUserId: administrator.id,
          grantedAt: new Date(),
          revokedByUserId: null,
          revokedAt: null,
        })
        .execute();
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "event_staff.eligibility_granted",
        subjectType: "user",
        subjectId: user.id,
        metadata: {
          purpose: "template_selection",
          responsibility: input.responsibility,
          regionId: input.regionId,
        },
      });
      return { status: "granted" as const, eligibilityId: grantId };
    });
}

export async function findAdminEventStaffCandidates(input: {
  q: string;
  responsibility: "presenter" | "coordinator";
  regionId: string | null;
}): Promise<Array<AdminEventPersonOption>> {
  const pattern = `%${input.q
    .trim()
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_")}%`;
  return await getDatabase()
    .selectFrom("user")
    .select(["user.id", "user.name", "user.email"])
    .where((expression) =>
      expression.or([
        expression("user.name", "ilike", pattern),
        expression("user.email", "ilike", pattern),
      ]),
    )
    .where(
      sql<boolean>`not exists (
        select 1
        from event_staff_eligibility eligibility
        where eligibility."userId" = "user".id
          and eligibility.responsibility = ${input.responsibility}
          and eligibility."revokedAt" is null
          and (
            (${input.responsibility} = 'presenter' and eligibility."regionId" is null)
            or eligibility."regionId" = ${input.regionId}
          )
      )`,
    )
    .orderBy(sql`lower("user".email)`)
    .orderBy("user.id")
    .limit(10)
    .execute();
}

export async function revokeAdminEventStaffEligibility(
  eligibilityId: string,
  administrator: AuthenticatedUser,
): Promise<
  | { status: "revoked"; endedAssignmentCount: number }
  | { status: "not-found" }
  | {
      status: "conflict";
      coordinatorCoverage: Array<{
        eventOccurrenceId: string;
        eventOccurrenceRegionId: string;
        occurrenceTitle: string;
        occurrenceStatus: "draft" | "published";
        occurrenceStartsAt: string;
        occurrenceTimezone: string;
        regionName: string;
        regionCode: string;
      }>;
    }
> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const grant = await transaction
        .selectFrom("event_staff_eligibility")
        .select(["id", "userId", "responsibility", "regionId"])
        .where("id", "=", eligibilityId)
        .where("revokedAt", "is", null)
        .forUpdate()
        .executeTakeFirst();
      if (!grant) return { status: "not-found" } as const;
      const coordinatorAssignments =
        grant.responsibility === "coordinator" && grant.regionId
          ? await transaction
              .selectFrom("event_coordinator_assignment as assignment")
              .innerJoin(
                "event_occurrence_region as occurrenceRegion",
                "occurrenceRegion.id",
                "assignment.eventOccurrenceRegionId",
              )
              .innerJoin(
                "event_occurrence as occurrence",
                "occurrence.id",
                "occurrenceRegion.eventOccurrenceId",
              )
              .innerJoin(
                "coordination_region as region",
                "region.id",
                "occurrenceRegion.regionId",
              )
              .select([
                "assignment.id as assignmentId",
                "occurrenceRegion.id as eventOccurrenceRegionId",
                "occurrenceRegion.retiredAt",
                "occurrence.id as eventOccurrenceId",
                "occurrence.title as occurrenceTitle",
                "occurrence.status as occurrenceStatus",
                "occurrence.startsAt as occurrenceStartsAt",
                "occurrence.timezone as occurrenceTimezone",
                "region.name as regionName",
                "region.code as regionCode",
                sql<number>`(select count(*)::integer
                  from event_coordinator_assignment other
                  where other."eventOccurrenceRegionId" = "occurrenceRegion".id
                    and other."userId" <> ${grant.userId}
                    and other."endedAt" is null)`.as("otherCoordinatorCount"),
              ])
              .where("assignment.userId", "=", grant.userId)
              .where("assignment.endedAt", "is", null)
              .where("occurrenceRegion.regionId", "=", grant.regionId)
              .orderBy("occurrence.startsAt", "asc")
              .orderBy("occurrence.id", "asc")
              .forUpdate(["assignment", "occurrenceRegion"])
              .execute()
          : [];
      const coordinatorCoverage = coordinatorAssignments.flatMap(
        (assignment) =>
          !assignment.retiredAt &&
          (assignment.occurrenceStatus === "draft" ||
            assignment.occurrenceStatus === "published") &&
          assignment.otherCoordinatorCount === 0
            ? [
                {
                  eventOccurrenceId: assignment.eventOccurrenceId,
                  eventOccurrenceRegionId: assignment.eventOccurrenceRegionId,
                  occurrenceTitle: assignment.occurrenceTitle,
                  occurrenceStatus: assignment.occurrenceStatus,
                  occurrenceStartsAt:
                    assignment.occurrenceStartsAt.toISOString(),
                  occurrenceTimezone: assignment.occurrenceTimezone,
                  regionName: assignment.regionName,
                  regionCode: assignment.regionCode,
                },
              ]
            : [],
      );
      if (coordinatorCoverage.length)
        return { status: "conflict", coordinatorCoverage } as const;
      const revokedAt = new Date();
      if (coordinatorAssignments.length)
        await transaction
          .updateTable("event_coordinator_assignment")
          .set({ endedAt: revokedAt, endReason: "assignment_ended" })
          .where(
            "id",
            "in",
            coordinatorAssignments.map((assignment) => assignment.assignmentId),
          )
          .execute();
      await transaction
        .updateTable("event_staff_eligibility")
        .set({
          revokedByUserId: administrator.id,
          revokedAt,
        })
        .where("id", "=", grant.id)
        .execute();
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "event_staff.eligibility_revoked",
        subjectType: "user",
        subjectId: grant.userId,
        metadata: {
          purpose: "template_selection",
          responsibility: grant.responsibility,
          regionId: grant.regionId,
          endedActiveAssignmentCount: coordinatorAssignments.length,
        },
        createdAt: revokedAt,
      });
      return {
        status: "revoked",
        endedAssignmentCount: coordinatorAssignments.length,
      } as const;
    });
}

export async function saveAdminCoordinationRegion(
  input: AdminCoordinationRegionSaveInput,
  administrator: AuthenticatedUser,
): Promise<
  | { status: "created" | "updated"; regionId: string }
  | { status: "not-found" | "code-in-use" | "conflict" }
> {
  const code = input.code.trim().toLocaleUpperCase("en-AU");
  const name = input.name.trim();
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      if (input.kind === "operational" && input.parentId) {
        const parent = await transaction
          .selectFrom("coordination_region")
          .select(["id", "kind", "status"])
          .where("id", "=", input.parentId)
          .executeTakeFirst();
        if (!parent || parent.kind !== "group" || parent.status !== "active")
          return { status: "conflict" as const };
      }
      const duplicate = await transaction
        .selectFrom("coordination_region")
        .select("id")
        .where(sql<boolean>`lower("code") = lower(${code})`)
        .$if(input.regionId !== null, (query) =>
          query.where("id", "!=", input.regionId as string),
        )
        .executeTakeFirst();
      if (duplicate) return { status: "code-in-use" as const };

      if (input.regionId === null) {
        const regionId = `coordination_region_${randomUUID()}`;
        await transaction
          .insertInto("coordination_region")
          .values({
            id: regionId,
            parentId: input.parentId,
            code,
            name,
            kind: input.kind,
            status: "active",
          })
          .execute();
        await recordDurableAuditEvent(transaction, {
          actorUserId: administrator.id,
          action: "coordination_region.created",
          subjectType: "coordination_region",
          subjectId: regionId,
          metadata: { code, kind: input.kind, parentId: input.parentId },
        });
        return { status: "created" as const, regionId };
      }

      const current = await transaction
        .selectFrom("coordination_region")
        .select(["id", "kind"])
        .where("id", "=", input.regionId)
        .forUpdate()
        .executeTakeFirst();
      if (!current) return { status: "not-found" as const };
      if (current.kind !== input.kind) return { status: "conflict" as const };
      await transaction
        .updateTable("coordination_region")
        .set({ code, name, parentId: input.parentId })
        .where("id", "=", input.regionId)
        .execute();
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "coordination_region.updated",
        subjectType: "coordination_region",
        subjectId: input.regionId,
        metadata: { code, kind: input.kind, parentId: input.parentId },
      });
      return { status: "updated" as const, regionId: input.regionId };
    });
}

export async function setAdminCoordinationRegionStatus(
  regionId: string,
  status: "active" | "retired",
  administrator: AuthenticatedUser,
): Promise<"updated" | "unchanged" | "not-found" | "conflict"> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const region = await transaction
        .selectFrom("coordination_region")
        .select(["id", "kind", "parentId", "status"])
        .where("id", "=", regionId)
        .forUpdate()
        .executeTakeFirst();
      if (!region) return "not-found" as const;
      if (region.status === status) return "unchanged" as const;
      if (status === "retired" && region.kind === "group") {
        const activeChild = await transaction
          .selectFrom("coordination_region")
          .select("id")
          .where("parentId", "=", regionId)
          .where("status", "=", "active")
          .executeTakeFirst();
        if (activeChild) return "conflict" as const;
      }
      if (status === "active" && region.parentId) {
        const parent = await transaction
          .selectFrom("coordination_region")
          .select(["kind", "status"])
          .where("id", "=", region.parentId)
          .executeTakeFirst();
        if (!parent || parent.kind !== "group" || parent.status !== "active")
          return "conflict" as const;
      }
      await transaction
        .updateTable("coordination_region")
        .set({ status })
        .where("id", "=", regionId)
        .execute();
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action:
          status === "active"
            ? "coordination_region.reactivated"
            : "coordination_region.retired",
        subjectType: "coordination_region",
        subjectId: regionId,
        metadata: { kind: region.kind, parentId: region.parentId },
      });
      return "updated" as const;
    });
}

export async function createAdminEventTemplate(
  input: AdminEventTemplateCreateInput,
  administrator: AuthenticatedUser,
): Promise<
  | {
      status: "created";
      eventTemplateId: string;
      eventTemplateVersionId: string;
    }
  | { status: "conflict" }
> {
  const eventTemplateId = `event_template_${randomUUID()}`;
  const eventTemplateVersionId = `event_template_version_${randomUUID()}`;
  const created = await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const administrators = await transaction
        .selectFrom("platform_admin")
        .select("userId")
        .where("userId", "in", input.defaultAdministratorIds)
        .execute();
      if (
        new Set(administrators.map((row) => row.userId)).size !==
        new Set(input.defaultAdministratorIds).size
      )
        return false;
      await transaction
        .insertInto("event_template")
        .values({
          id: eventTemplateId,
          title: input.title,
          status: "draft",
        })
        .execute();
      await transaction
        .insertInto("event_template_version")
        .values({
          id: eventTemplateVersionId,
          eventTemplateId,
          version: 1,
          summary: "Event summary to be completed.",
          description: "Event description to be completed.",
          hasCompletionCertificate: false,
          publishedAt: null,
        })
        .execute();
      await transaction
        .insertInto("event_template_version_admin_default")
        .values(
          input.defaultAdministratorIds.map((userId) => ({
            eventTemplateVersionId,
            userId,
          })),
        )
        .execute();
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "event_template.created",
        subjectType: "event_template",
        subjectId: eventTemplateId,
        metadata: { eventTemplateVersionId },
      });
      return true;
    });
  if (!created) return { status: "conflict" };
  return { status: "created", eventTemplateId, eventTemplateVersionId };
}

export async function startAdminEventTemplate(
  administrator: AuthenticatedUser,
) {
  return await createAdminEventTemplate(
    {
      title: "Untitled event template",
      defaultAdministratorIds: [administrator.id],
    },
    administrator,
  );
}

function eventItemFromRow(row: {
  id: string;
  kind: "session" | "scorm" | "survey" | "resource";
  title: string;
  required: boolean;
  durationMinutes: number | null;
  learningActivityVersionId: string | null;
  sessionDefinitionId: string | null;
  presenterRequired: boolean | null;
  presenterIds: Array<string>;
}): AdminEventTemplateItem {
  if (row.kind === "session")
    return {
      id: row.id,
      kind: "session",
      title: row.title,
      required: row.required,
      durationMinutes: row.durationMinutes ?? 60,
      presenterRequired: row.presenterRequired ?? true,
      presenterIds: row.presenterIds,
    };
  if (!row.learningActivityVersionId)
    throw new Error("Event activity item has no learning activity version");
  if (row.kind === "resource")
    return {
      id: row.id,
      kind: "resource",
      title: row.title,
      required: row.required,
      durationMinutes: null,
      learningActivityVersionId: row.learningActivityVersionId,
    };
  if (row.kind === "scorm")
    return {
      id: row.id,
      kind: "scorm",
      title: row.title,
      required: row.required,
      durationMinutes: row.durationMinutes ?? 1,
      learningActivityVersionId: row.learningActivityVersionId,
    };
  return {
    id: row.id,
    kind: "survey",
    title: row.title,
    required: row.required,
    durationMinutes: row.durationMinutes,
    learningActivityVersionId: row.learningActivityVersionId,
  };
}

async function loadEventTemplateDraft(
  database: Transaction<Database> | ReturnType<typeof getDatabase>,
  template: { id: string; title: string },
  version: {
    id: string;
    summary: string;
    description: string;
    hasCompletionCertificate: boolean;
  },
): Promise<AdminEventTemplateDraft> {
  const [sectionRows, presenterRows, administratorRows, regionRows] =
    await Promise.all([
      database
        .selectFrom("event_template_version_section as sections")
        .leftJoin("event_template_version_item as items", (join) =>
          join
            .onRef("items.sectionId", "=", "sections.id")
            .onRef(
              "items.eventTemplateVersionId",
              "=",
              "sections.eventTemplateVersionId",
            ),
        )
        .leftJoin(
          "event_template_session_definition as sessions",
          "sessions.id",
          "items.sessionDefinitionId",
        )
        .select([
          "sections.id as sectionId",
          "sections.title as sectionTitle",
          "sections.description as sectionDescription",
          "sections.phase as sectionPhase",
          "sections.releaseAnchor as sectionReleaseAnchor",
          "sections.releaseOffsetAmount as sectionReleaseOffsetAmount",
          "sections.releaseOffsetUnit as sectionReleaseOffsetUnit",
          "items.id as itemId",
          "items.kind as itemKind",
          "items.title as itemTitle",
          "items.required as itemRequired",
          "items.durationMinutes",
          "items.learningActivityVersionId",
          "items.sessionDefinitionId",
          "sessions.presenterRequired",
        ])
        .where("sections.eventTemplateVersionId", "=", version.id)
        .orderBy("sections.position")
        .orderBy("items.position")
        .execute(),
      database
        .selectFrom("event_template_version_presenter_default")
        .select(["sessionDefinitionId", "userId"])
        .where("eventTemplateVersionId", "=", version.id)
        .execute(),
      database
        .selectFrom("event_template_version_admin_default")
        .select("userId")
        .where("eventTemplateVersionId", "=", version.id)
        .orderBy("userId")
        .execute(),
      database
        .selectFrom("event_template_version_region as regions")
        .leftJoin(
          "event_template_version_coordinator_default as coordinators",
          (join) =>
            join
              .onRef(
                "coordinators.eventTemplateVersionId",
                "=",
                "regions.eventTemplateVersionId",
              )
              .onRef("coordinators.regionId", "=", "regions.regionId"),
        )
        .select(["regions.regionId", "coordinators.userId"])
        .where("regions.eventTemplateVersionId", "=", version.id)
        .orderBy("regions.position")
        .orderBy("coordinators.userId")
        .execute(),
    ]);

  const sections = new Map<
    string,
    AdminEventTemplateDraft["sections"][number]
  >();
  for (const row of sectionRows) {
    let section = sections.get(row.sectionId);
    if (!section) {
      section = {
        id: row.sectionId,
        title: row.sectionTitle,
        description: row.sectionDescription,
        phase: row.sectionPhase,
        releaseAnchor: row.sectionReleaseAnchor,
        releaseOffsetAmount: row.sectionReleaseOffsetAmount,
        releaseOffsetUnit: row.sectionReleaseOffsetUnit,
        items: [],
      };
      sections.set(row.sectionId, section);
    }
    if (row.itemId && row.itemKind && row.itemTitle)
      section.items.push(
        eventItemFromRow({
          id: row.itemId,
          kind: row.itemKind,
          title: row.itemTitle,
          required: row.itemRequired ?? true,
          durationMinutes: row.durationMinutes,
          learningActivityVersionId: row.learningActivityVersionId,
          sessionDefinitionId: row.sessionDefinitionId,
          presenterRequired: row.presenterRequired,
          presenterIds: presenterRows
            .filter(
              (presenter) =>
                presenter.sessionDefinitionId === row.sessionDefinitionId,
            )
            .map((presenter) => presenter.userId),
        }),
      );
  }
  const regions = new Map<string, Array<string>>();
  for (const row of regionRows) {
    const coordinators = regions.get(row.regionId) ?? [];
    if (row.userId) coordinators.push(row.userId);
    regions.set(row.regionId, coordinators);
  }
  return adminEventTemplateDraftSchema.parse({
    eventTemplateId: template.id,
    eventTemplateVersionId: version.id,
    title: template.title,
    summary: version.summary,
    description: version.description,
    hasCompletionCertificate: version.hasCompletionCertificate,
    defaultAdministratorIds: administratorRows.map((row) => row.userId),
    regions: [...regions].map(([regionId, coordinatorIds]) => ({
      regionId,
      coordinatorIds,
    })),
    sections: [...sections.values()],
  });
}

export async function findAdminEventTemplate(
  eventTemplateId: string,
  eventTemplateVersionId?: string,
): Promise<AdminEventTemplateDetail | null> {
  const database = getDatabase();
  const template = await database
    .selectFrom("event_template")
    .select(["id", "title", "status"])
    .where("id", "=", eventTemplateId)
    .executeTakeFirst();
  if (!template) return null;
  const versions = await database
    .selectFrom("event_template_version")
    .select([
      "id",
      "version",
      "summary",
      "description",
      "hasCompletionCertificate",
      "publishedAt",
    ])
    .where("eventTemplateId", "=", eventTemplateId)
    .orderBy("version", "desc")
    .execute();
  const version = eventTemplateVersionId
    ? versions.find((candidate) => candidate.id === eventTemplateVersionId)
    : (versions.find((candidate) => !candidate.publishedAt) ?? versions[0]);
  if (!version) return null;
  const draft = await loadEventTemplateDraft(database, template, version);
  const referencedStaffIds = [
    ...new Set([
      ...draft.defaultAdministratorIds,
      ...draft.regions.flatMap((region) => region.coordinatorIds),
      ...draft.sections.flatMap((section) =>
        section.items.flatMap((item) =>
          item.kind === "session" ? item.presenterIds : [],
        ),
      ),
    ]),
  ];
  const [
    platformAdministrators,
    presenters,
    coordinators,
    users,
    regions,
    modules,
    surveys,
    resources,
  ] = await Promise.all([
    database
      .selectFrom("platform_admin")
      .innerJoin("user", "user.id", "platform_admin.userId")
      .select(["user.id", "user.name", "user.email"])
      .orderBy("user.name")
      .execute(),
    database
      .selectFrom("event_staff_eligibility as eligibility")
      .innerJoin("user", "user.id", "eligibility.userId")
      .select([
        "eligibility.id as eligibilityId",
        "user.id",
        "user.name",
        "user.email",
      ])
      .where("eligibility.responsibility", "=", "presenter")
      .where("eligibility.revokedAt", "is", null)
      .orderBy("user.name")
      .orderBy("user.email")
      .execute(),
    database
      .selectFrom("event_staff_eligibility as eligibility")
      .innerJoin("user", "user.id", "eligibility.userId")
      .innerJoin(
        "coordination_region as region",
        "region.id",
        "eligibility.regionId",
      )
      .select([
        "eligibility.id as eligibilityId",
        "user.id",
        "user.name",
        "user.email",
        "region.id as regionId",
        "region.name as regionName",
      ])
      .where("eligibility.responsibility", "=", "coordinator")
      .where("eligibility.revokedAt", "is", null)
      .where("region.status", "=", "active")
      .orderBy("region.name")
      .orderBy("user.name")
      .orderBy("user.email")
      .execute(),
    referencedStaffIds.length
      ? database
          .selectFrom("user")
          .select(["id", "name", "email"])
          .where("id", "in", referencedStaffIds)
          .orderBy("name")
          .orderBy("email")
          .execute()
      : [],
    database
      .selectFrom("coordination_region as region")
      .leftJoin("coordination_region as parent", "parent.id", "region.parentId")
      .select([
        "region.id",
        "region.name",
        "region.code",
        "region.parentId",
        "parent.name as parentName",
      ])
      .where("region.status", "=", "active")
      .where("region.kind", "=", "operational")
      .orderBy("parent.name")
      .orderBy("region.name")
      .execute(),
    database
      .selectFrom("scorm_package_version")
      .innerJoin(
        "learning_activity_version",
        "learning_activity_version.id",
        "scorm_package_version.id",
      )
      .innerJoin(
        "learning_activity",
        "learning_activity.id",
        "learning_activity_version.activityId",
      )
      .select([
        "scorm_package_version.id",
        "learning_activity.title",
        "learning_activity_version.version",
      ])
      .where("scorm_package_version.status", "=", "ready")
      .orderBy("learning_activity.title")
      .orderBy("learning_activity_version.version", "desc")
      .execute(),
    database
      .selectFrom("survey_version")
      .innerJoin(
        "learning_activity_version",
        "learning_activity_version.id",
        "survey_version.id",
      )
      .innerJoin(
        "learning_activity",
        "learning_activity.id",
        "learning_activity_version.activityId",
      )
      .select([
        "survey_version.id",
        "learning_activity.title",
        "learning_activity_version.version",
      ])
      .where("learning_activity_version.publishedAt", "is not", null)
      .orderBy("learning_activity.title")
      .orderBy("learning_activity_version.version", "desc")
      .execute(),
    database
      .selectFrom("learning_resource_version")
      .innerJoin(
        "learning_activity_version",
        "learning_activity_version.id",
        "learning_resource_version.id",
      )
      .innerJoin(
        "learning_activity",
        "learning_activity.id",
        "learning_activity_version.activityId",
      )
      .select([
        "learning_resource_version.id",
        "learning_activity.title",
        "learning_activity_version.version",
      ])
      .orderBy("learning_activity.title")
      .orderBy("learning_activity_version.version", "desc")
      .execute(),
  ]);
  return {
    template,
    version: {
      id: version.id,
      version: version.version,
      publishedAt: version.publishedAt?.toISOString() ?? null,
      editable: !version.publishedAt && template.status !== "archived",
    },
    versions: versions.map((candidate) => ({
      id: candidate.id,
      version: candidate.version,
      publishedAt: candidate.publishedAt?.toISOString() ?? null,
    })),
    draft,
    people: { platformAdministrators, coordinators, presenters, users },
    regions,
    library: { modules, surveys, resources },
  };
}

async function validateEventDraftReferences(
  transaction: Transaction<Database>,
  draft: AdminEventTemplateDraft,
): Promise<boolean> {
  const administratorIds = new Set(draft.defaultAdministratorIds);
  const coordinatorSelections = draft.regions.flatMap((region) =>
    region.coordinatorIds.map((userId) => ({
      regionId: region.regionId,
      userId,
    })),
  );
  const coordinatorIds = new Set(
    coordinatorSelections.map((selection) => selection.userId),
  );
  const presenterIds = new Set(
    draft.sections.flatMap((section) =>
      section.items.flatMap((item) =>
        item.kind === "session" ? item.presenterIds : [],
      ),
    ),
  );
  const activityIds = draft.sections.flatMap((section) =>
    section.items.flatMap((item) =>
      item.kind === "session" ? [] : [item.learningActivityVersionId],
    ),
  );
  const regionIds = new Set(draft.regions.map((region) => region.regionId));
  const [administrators, coordinators, presenters, activities, regions] =
    await Promise.all([
      transaction
        .selectFrom("platform_admin")
        .select("userId")
        .where("userId", "in", [...administratorIds])
        .execute(),
      coordinatorIds.size
        ? transaction
            .selectFrom("event_staff_eligibility")
            .select(["userId", "regionId"])
            .where("userId", "in", [...coordinatorIds])
            .where("responsibility", "=", "coordinator")
            .where("revokedAt", "is", null)
            .execute()
        : [],
      presenterIds.size
        ? transaction
            .selectFrom("event_staff_eligibility")
            .select("userId")
            .where("userId", "in", [...presenterIds])
            .where("responsibility", "=", "presenter")
            .where("revokedAt", "is", null)
            .execute()
        : [],
      activityIds.length
        ? transaction
            .selectFrom("learning_activity_version")
            .select("id")
            .where("id", "in", activityIds)
            .execute()
        : [],
      regionIds.size
        ? transaction
            .selectFrom("coordination_region")
            .select("id")
            .where("id", "in", [...regionIds])
            .where("status", "=", "active")
            .execute()
        : [],
    ]);
  return (
    new Set(administrators.map((row) => row.userId)).size ===
      administratorIds.size &&
    coordinatorSelections.every((selection) =>
      coordinators.some(
        (coordinator) =>
          coordinator.userId === selection.userId &&
          coordinator.regionId === selection.regionId,
      ),
    ) &&
    new Set(presenters.map((row) => row.userId)).size === presenterIds.size &&
    new Set(activities.map((row) => row.id)).size ===
      new Set(activityIds).size &&
    new Set(regions.map((row) => row.id)).size === regionIds.size
  );
}

async function replaceEventDraftStructure(
  transaction: Transaction<Database>,
  draft: AdminEventTemplateDraft,
): Promise<void> {
  await transaction
    .deleteFrom("event_template_version_item")
    .where("eventTemplateVersionId", "=", draft.eventTemplateVersionId)
    .execute();
  await transaction
    .deleteFrom("event_template_version_section")
    .where("eventTemplateVersionId", "=", draft.eventTemplateVersionId)
    .execute();
  await transaction
    .deleteFrom("event_template_version_presenter_default")
    .where("eventTemplateVersionId", "=", draft.eventTemplateVersionId)
    .execute();
  await transaction
    .deleteFrom("event_template_session_definition")
    .where("eventTemplateVersionId", "=", draft.eventTemplateVersionId)
    .execute();
  await transaction
    .deleteFrom("event_template_version_coordinator_default")
    .where("eventTemplateVersionId", "=", draft.eventTemplateVersionId)
    .execute();
  await transaction
    .deleteFrom("event_template_version_region")
    .where("eventTemplateVersionId", "=", draft.eventTemplateVersionId)
    .execute();
  await transaction
    .deleteFrom("event_template_version_admin_default")
    .where("eventTemplateVersionId", "=", draft.eventTemplateVersionId)
    .execute();

  await transaction
    .insertInto("event_template_version_admin_default")
    .values(
      draft.defaultAdministratorIds.map((userId) => ({
        eventTemplateVersionId: draft.eventTemplateVersionId,
        userId,
      })),
    )
    .execute();
  for (const [position, region] of draft.regions.entries()) {
    await transaction
      .insertInto("event_template_version_region")
      .values({
        eventTemplateVersionId: draft.eventTemplateVersionId,
        regionId: region.regionId,
        position,
      })
      .execute();
    await transaction
      .insertInto("event_template_version_coordinator_default")
      .values(
        region.coordinatorIds.map((userId) => ({
          eventTemplateVersionId: draft.eventTemplateVersionId,
          regionId: region.regionId,
          userId,
        })),
      )
      .execute();
  }
  let sessionPosition = 0;
  for (const [sectionPosition, section] of draft.sections.entries()) {
    await transaction
      .insertInto("event_template_version_section")
      .values({
        id: section.id,
        eventTemplateVersionId: draft.eventTemplateVersionId,
        position: sectionPosition,
        title: section.title,
        description: section.description,
        phase: section.phase,
        releaseAnchor: section.releaseAnchor,
        releaseOffsetAmount: section.releaseOffsetAmount,
        releaseOffsetUnit: section.releaseOffsetUnit,
      })
      .execute();
    for (const [itemPosition, item] of section.items.entries()) {
      const sessionDefinitionId =
        item.kind === "session"
          ? `event_session_definition_${randomUUID()}`
          : null;
      if (item.kind === "session" && sessionDefinitionId) {
        await transaction
          .insertInto("event_template_session_definition")
          .values({
            id: sessionDefinitionId,
            eventTemplateVersionId: draft.eventTemplateVersionId,
            position: sessionPosition++,
            title: item.title,
            durationMinutes: item.durationMinutes,
            presenterRequired: item.presenterRequired,
          })
          .execute();
        if (item.presenterIds.length)
          await transaction
            .insertInto("event_template_version_presenter_default")
            .values(
              item.presenterIds.map((userId) => ({
                eventTemplateVersionId: draft.eventTemplateVersionId,
                sessionDefinitionId,
                userId,
                scopeKey: sessionDefinitionId,
              })),
            )
            .execute();
      }
      await transaction
        .insertInto("event_template_version_item")
        .values({
          id: item.id,
          eventTemplateVersionId: draft.eventTemplateVersionId,
          sectionId: section.id,
          position: itemPosition,
          kind: item.kind,
          title: item.title,
          required: item.required,
          durationMinutes: item.durationMinutes,
          learningActivityVersionId:
            item.kind === "session" ? null : item.learningActivityVersionId,
          sessionDefinitionId,
        })
        .execute();
    }
  }
}

export async function saveAdminEventTemplateDraft(
  draft: AdminEventTemplateDraft,
  administrator: AuthenticatedUser,
): Promise<"saved" | "not-found" | "conflict"> {
  const result = await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const version = await transaction
        .selectFrom("event_template_version")
        .innerJoin(
          "event_template",
          "event_template.id",
          "event_template_version.eventTemplateId",
        )
        .select(["event_template_version.publishedAt", "event_template.status"])
        .where("event_template_version.id", "=", draft.eventTemplateVersionId)
        .where("event_template.id", "=", draft.eventTemplateId)
        .forUpdate()
        .executeTakeFirst();
      if (!version) return "not-found" as const;
      if (version.publishedAt || version.status === "archived")
        return "conflict" as const;
      if (!(await validateEventDraftReferences(transaction, draft)))
        return "conflict" as const;
      await transaction
        .updateTable("event_template")
        .set({ title: draft.title, updatedAt: new Date() })
        .where("id", "=", draft.eventTemplateId)
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable("event_template_version")
        .set({
          summary: draft.summary,
          description: draft.description,
          hasCompletionCertificate: draft.hasCompletionCertificate,
        })
        .where("id", "=", draft.eventTemplateVersionId)
        .executeTakeFirstOrThrow();
      await replaceEventDraftStructure(transaction, draft);
      return "saved" as const;
    });
  if (result === "saved")
    logServerEvent({
      level: "info",
      event: "event_template.draft_saved",
      fields: {
        actorUserId: administrator.id,
        entityType: "event_template",
        entityId: draft.eventTemplateId,
      },
    });
  return result;
}

export async function createAdminEventTemplateVersion(
  eventTemplateId: string,
  administrator: AuthenticatedUser,
): Promise<
  | { status: "created"; eventTemplateVersionId: string }
  | { status: "not-found" | "conflict" }
> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const template = await transaction
        .selectFrom("event_template")
        .select(["id", "title", "status"])
        .where("id", "=", eventTemplateId)
        .forUpdate()
        .executeTakeFirst();
      if (!template) return { status: "not-found" } as const;
      if (template.status === "archived")
        return { status: "conflict" } as const;
      const versions = await transaction
        .selectFrom("event_template_version")
        .select([
          "id",
          "version",
          "summary",
          "description",
          "hasCompletionCertificate",
          "publishedAt",
        ])
        .where("eventTemplateId", "=", eventTemplateId)
        .orderBy("version", "desc")
        .execute();
      if (versions.some((version) => !version.publishedAt))
        return { status: "conflict" } as const;
      const source = versions[0];
      if (!source) return { status: "not-found" } as const;
      const eventTemplateVersionId = `event_template_version_${randomUUID()}`;
      await transaction
        .insertInto("event_template_version")
        .values({
          id: eventTemplateVersionId,
          eventTemplateId,
          version: source.version + 1,
          summary: source.summary,
          description: source.description,
          hasCompletionCertificate: source.hasCompletionCertificate,
          publishedAt: null,
        })
        .execute();
      const sourceDraft = await loadEventTemplateDraft(
        transaction,
        template,
        source,
      );
      const draft: AdminEventTemplateDraft = {
        ...sourceDraft,
        eventTemplateVersionId,
        sections: sourceDraft.sections.map((section) => ({
          ...section,
          id: `event_section_${randomUUID()}`,
          items: section.items.map((item) => ({
            ...item,
            id: `event_item_${randomUUID()}`,
          })),
        })),
      };
      await replaceEventDraftStructure(transaction, draft);
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "event_template.version_created",
        subjectType: "event_template_version",
        subjectId: eventTemplateVersionId,
        aggregateId: eventTemplateId,
        metadata: { sourceVersionId: source.id, version: source.version + 1 },
      });
      return { status: "created", eventTemplateVersionId } as const;
    });
}

export async function deleteAdminEventTemplateVersion(
  eventTemplateId: string,
  eventTemplateVersionId: string,
  administrator: AuthenticatedUser,
): Promise<
  | { status: "deleted"; templateDeleted: boolean }
  | { status: "not-found" | "conflict" }
> {
  const outcome = await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const version = await transaction
        .selectFrom("event_template_version")
        .select(["id", "eventTemplateId", "publishedAt"])
        .where("id", "=", eventTemplateVersionId)
        .where("eventTemplateId", "=", eventTemplateId)
        .forUpdate()
        .executeTakeFirst();
      if (!version) return { status: "not-found" } as const;
      if (version.publishedAt) return { status: "conflict" } as const;
      const occurrence = await transaction
        .selectFrom("event_occurrence")
        .select("id")
        .where("eventTemplateVersionId", "=", eventTemplateVersionId)
        .executeTakeFirst();
      if (occurrence) return { status: "conflict" } as const;
      await transaction
        .deleteFrom("event_template_version")
        .where("id", "=", eventTemplateVersionId)
        .executeTakeFirstOrThrow();
      const remaining = await transaction
        .selectFrom("event_template_version")
        .select("id")
        .where("eventTemplateId", "=", eventTemplateId)
        .executeTakeFirst();
      if (!remaining)
        await transaction
          .deleteFrom("event_template")
          .where("id", "=", eventTemplateId)
          .executeTakeFirstOrThrow();
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "event_template.draft_deleted",
        subjectType: remaining ? "event_template_version" : "event_template",
        subjectId: remaining ? eventTemplateVersionId : eventTemplateId,
        aggregateId: eventTemplateId,
        metadata: {
          eventTemplateVersionId,
          templateDeleted: !remaining,
        },
      });
      return { status: "deleted", templateDeleted: !remaining } as const;
    });
  if (outcome.status === "deleted")
    logServerEvent({
      level: "info",
      event: "event_template.draft_deleted",
      fields: {
        actorUserId: administrator.id,
        entityType: outcome.templateDeleted
          ? "event_template"
          : "event_template_version",
        entityId: outcome.templateDeleted
          ? eventTemplateId
          : eventTemplateVersionId,
        aggregateId: eventTemplateId,
      },
    });
  return outcome;
}

export async function publishAdminEventTemplateVersion(
  eventTemplateId: string,
  eventTemplateVersionId: string,
  administrator: AuthenticatedUser,
): Promise<"published" | "not-found" | "conflict"> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const version = await transaction
        .selectFrom("event_template_version")
        .innerJoin(
          "event_template",
          "event_template.id",
          "event_template_version.eventTemplateId",
        )
        .select([
          "event_template_version.id",
          "event_template_version.version",
          "event_template_version.publishedAt",
          "event_template.status",
          "event_template.title",
        ])
        .where("event_template_version.id", "=", eventTemplateVersionId)
        .where("event_template.id", "=", eventTemplateId)
        .forUpdate()
        .executeTakeFirst();
      if (!version) return "not-found" as const;
      if (
        version.publishedAt ||
        version.status === "archived" ||
        version.title === "Untitled event template"
      )
        return "conflict" as const;
      const [administratorCoverage, presenterCoverage, structure] =
        await Promise.all([
          transaction
            .selectFrom("event_template_version_admin_default as defaults")
            .leftJoin(
              "platform_admin",
              "platform_admin.userId",
              "defaults.userId",
            )
            .select([
              sql<number>`count(*)::integer`.as("configured"),
              sql<number>`count(platform_admin."userId")::integer`.as("active"),
            ])
            .where(
              "defaults.eventTemplateVersionId",
              "=",
              eventTemplateVersionId,
            )
            .executeTakeFirstOrThrow(),
          transaction
            .selectFrom("event_template_session_definition as sessions")
            .select([
              sql<number>`count(*) filter (where sessions."presenterRequired")::integer`.as(
                "required",
              ),
              sql<number>`count(*) filter (
              where sessions."presenterRequired" and exists (
                select 1 from event_template_version_presenter_default presenters
                inner join event_staff_eligibility eligibility
                  on eligibility."userId" = presenters."userId"
                  and eligibility.responsibility = 'presenter'
                  and eligibility."revokedAt" is null
                where presenters."eventTemplateVersionId" = sessions."eventTemplateVersionId"
                  and presenters."sessionDefinitionId" = sessions.id
              )
            )::integer`.as("covered"),
            ])
            .where(
              "sessions.eventTemplateVersionId",
              "=",
              eventTemplateVersionId,
            )
            .executeTakeFirstOrThrow(),
          transaction
            .selectFrom("event_template_version_section as sections")
            .leftJoin(
              "event_template_version_item as items",
              "items.sectionId",
              "sections.id",
            )
            .select([
              sql<number>`count(distinct sections.id)::integer`.as("sections"),
              sql<number>`count(items.id)::integer`.as("items"),
              sql<number>`count(distinct sections.id) filter (where items.id is null)::integer`.as(
                "emptySections",
              ),
              sql<number>`count(items.id) filter (where items.kind = 'session')::integer`.as(
                "sessions",
              ),
            ])
            .where(
              "sections.eventTemplateVersionId",
              "=",
              eventTemplateVersionId,
            )
            .executeTakeFirstOrThrow(),
        ]);
      if (
        structure.sections === 0 ||
        structure.items === 0 ||
        structure.emptySections > 0 ||
        structure.sessions === 0 ||
        administratorCoverage.configured === 0 ||
        administratorCoverage.configured !== administratorCoverage.active ||
        presenterCoverage.required !== presenterCoverage.covered
      )
        return "conflict" as const;
      const regionCoverage = await transaction
        .selectFrom("event_template_version_region as regions")
        .innerJoin(
          "coordination_region as region",
          "region.id",
          "regions.regionId",
        )
        .select([
          sql<number>`count(*)::integer`.as("configured"),
          sql<number>`count(*) filter (
            where region.status = 'active' and region.kind = 'operational'
          )::integer`.as("active"),
          sql<number>`count(*) filter (where exists (
            select 1 from event_template_version_coordinator_default coordinators
            inner join event_staff_eligibility eligibility
              on eligibility."userId" = coordinators."userId"
              and eligibility.responsibility = 'coordinator'
              and eligibility."regionId" = coordinators."regionId"
              and eligibility."revokedAt" is null
            where coordinators."eventTemplateVersionId" = regions."eventTemplateVersionId"
              and coordinators."regionId" = regions."regionId"
          ))::integer`.as("covered"),
        ])
        .where("regions.eventTemplateVersionId", "=", eventTemplateVersionId)
        .executeTakeFirstOrThrow();
      if (
        regionCoverage.configured !== regionCoverage.active ||
        regionCoverage.configured !== regionCoverage.covered
      )
        return "conflict" as const;
      const now = new Date();
      await transaction
        .updateTable("event_template_version")
        .set({ publishedAt: now })
        .where("id", "=", eventTemplateVersionId)
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable("event_template")
        .set({ status: "published", updatedAt: now })
        .where("id", "=", eventTemplateId)
        .executeTakeFirstOrThrow();
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "event_template.version_published",
        subjectType: "event_template_version",
        subjectId: eventTemplateVersionId,
        aggregateId: eventTemplateId,
        metadata: { version: version.version },
        createdAt: now,
      });
      return "published" as const;
    });
}

export async function createAdminEventOccurrence(
  input: AdminEventOccurrenceCreateInput,
  administrator: AuthenticatedUser,
): Promise<
  | { status: "created"; eventOccurrenceId: string }
  | { status: "not-found" }
  | { status: "conflict" }
  | { status: "slug-in-use" }
> {
  if (!isIanaTimeZone(input.timezone) || !isAdminEventScheduleConsistent(input))
    return { status: "conflict" };
  const domains = normalizeEventDomains(input.domains);
  if (!domains) return { status: "conflict" };
  const eventOccurrenceId = `event_occurrence_${randomUUID()}`;
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(hashtext(${input.slug}))`.execute(
        transaction,
      );
      const slugOwner = await transaction
        .selectFrom("event_occurrence")
        .select("id")
        .where("slug", "=", input.slug)
        .executeTakeFirst();
      if (slugOwner) return { status: "slug-in-use" } as const;
      const version = await transaction
        .selectFrom("event_template_version")
        .innerJoin(
          "event_template",
          "event_template.id",
          "event_template_version.eventTemplateId",
        )
        .select([
          "event_template_version.id",
          "event_template_version.publishedAt",
          "event_template.status",
        ])
        .where("event_template_version.id", "=", input.eventTemplateVersionId)
        .executeTakeFirst();
      if (!version) return { status: "not-found" } as const;
      if (!version.publishedAt || version.status === "archived")
        return { status: "conflict" } as const;
      const [
        configuredAdminDefaults,
        activeAdminDefaults,
        sessionDefinitions,
        presenterDefaults,
        regions,
      ] = await Promise.all([
        transaction
          .selectFrom("event_template_version_admin_default")
          .select("userId")
          .where("eventTemplateVersionId", "=", version.id)
          .execute(),
        transaction
          .selectFrom("event_template_version_admin_default as defaults")
          .innerJoin(
            "platform_admin",
            "platform_admin.userId",
            "defaults.userId",
          )
          .select("defaults.userId")
          .where("defaults.eventTemplateVersionId", "=", version.id)
          .execute(),
        transaction
          .selectFrom("event_template_session_definition")
          .selectAll()
          .where("eventTemplateVersionId", "=", version.id)
          .orderBy("position")
          .execute(),
        transaction
          .selectFrom("event_template_version_presenter_default as defaults")
          .innerJoin("event_staff_eligibility as eligibility", (join) =>
            join
              .onRef("eligibility.userId", "=", "defaults.userId")
              .on("eligibility.responsibility", "=", "presenter")
              .on("eligibility.revokedAt", "is", null),
          )
          .select([
            "defaults.sessionDefinitionId",
            "defaults.userId",
            "defaults.scopeKey",
          ])
          .where("defaults.eventTemplateVersionId", "=", version.id)
          .execute(),
        transaction
          .selectFrom("event_template_version_region as template_region")
          .innerJoin(
            "coordination_region as region",
            "region.id",
            "template_region.regionId",
          )
          .select([
            "template_region.regionId",
            "template_region.position",
            "region.kind",
            "region.status",
          ])
          .where("template_region.eventTemplateVersionId", "=", version.id)
          .orderBy("template_region.position")
          .execute(),
      ]);
      if (
        configuredAdminDefaults.length === 0 ||
        activeAdminDefaults.length !== configuredAdminDefaults.length ||
        sessionDefinitions.length === 0
      )
        return { status: "conflict" } as const;
      if (
        sessionDefinitions.some(
          (session) =>
            session.presenterRequired &&
            !presenterDefaults.some(
              (presenter) => presenter.sessionDefinitionId === session.id,
            ),
        )
      )
        return { status: "conflict" } as const;
      const coordinatorDefaults = await transaction
        .selectFrom("event_template_version_coordinator_default as defaults")
        .innerJoin("event_staff_eligibility as eligibility", (join) =>
          join
            .onRef("eligibility.userId", "=", "defaults.userId")
            .onRef("eligibility.regionId", "=", "defaults.regionId")
            .on("eligibility.responsibility", "=", "coordinator")
            .on("eligibility.revokedAt", "is", null),
        )
        .select(["defaults.regionId", "defaults.userId"])
        .where("defaults.eventTemplateVersionId", "=", version.id)
        .execute();
      if (
        regions.some(
          (region) =>
            region.kind !== "operational" || region.status !== "active",
        ) ||
        regions.some(
          (region) =>
            !coordinatorDefaults.some(
              (coordinator) => coordinator.regionId === region.regionId,
            ),
        )
      )
        return { status: "conflict" } as const;

      const startsAt = requiredDate(input.startsAt);
      const endsAt = requiredDate(input.endsAt);
      const totalSessionMinutes = sessionDefinitions.reduce(
        (total, session) => total + session.durationMinutes,
        0,
      );
      if (endsAt.getTime() - startsAt.getTime() < totalSessionMinutes * 60_000)
        return { status: "conflict" } as const;
      const now = new Date();
      await transaction
        .insertInto("event_occurrence")
        .values({
          id: eventOccurrenceId,
          eventTemplateVersionId: version.id,
          title: input.title,
          slug: input.slug,
          status: "draft",
          deliveryMode: input.deliveryMode,
          registrationMode: input.registrationMode,
          approvalMode: input.approvalMode,
          timezone: input.timezone,
          localStartsAt: input.localStartsAt,
          localEndsAt: input.localEndsAt,
          localRegistrationOpensAt: optionalText(
            input.localRegistrationOpensAt,
          ),
          localRegistrationClosesAt: optionalText(
            input.localRegistrationClosesAt,
          ),
          localCoordinatorLockAt: optionalText(input.localCoordinatorLockAt),
          startsAt,
          endsAt,
          registrationOpensAt: optionalDate(input.registrationOpensAt),
          registrationClosesAt: optionalDate(input.registrationClosesAt),
          coordinatorLockAt: optionalDate(input.coordinatorLockAt),
          capacity: input.capacity,
          venueName: optionalText(input.venueName),
          venueAddress: optionalText(input.venueAddress),
          virtualJoinUrl: optionalText(input.virtualJoinUrl),
          publishedAt: null,
          createdByUserId: administrator.id,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      await ensureEventSurveyAccessRecords(
        transaction,
        eventOccurrenceId,
        version.id,
        now,
      );
      if (domains.length)
        await transaction
          .insertInto("event_occurrence_domain")
          .values(
            domains.map((domain) => ({
              eventOccurrenceId,
              domain,
              createdAt: now,
            })),
          )
          .execute();
      for (const adminDefault of activeAdminDefaults)
        await transaction
          .insertInto("event_admin_assignment")
          .values({
            id: `event_admin_assignment_${randomUUID()}`,
            eventOccurrenceId,
            userId: adminDefault.userId,
            source: "template_default",
            assignedByUserId: administrator.id,
            assignedAt: now,
            endedAt: null,
            endReason: null,
          })
          .execute();
      let sessionStartsAt = startsAt;
      for (const sessionDefinition of sessionDefinitions) {
        const sessionId = `event_session_${randomUUID()}`;
        const sessionEndsAt = addElapsedMinutes(
          sessionStartsAt,
          sessionDefinition.durationMinutes,
        );
        await transaction
          .insertInto("event_session")
          .values({
            id: sessionId,
            eventOccurrenceId,
            sessionDefinitionId: sessionDefinition.id,
            position: sessionDefinition.position,
            title: sessionDefinition.title,
            startsAt: sessionStartsAt,
            endsAt: sessionEndsAt,
            localStartsAt: localDateTimeFor(sessionStartsAt, input.timezone),
            localEndsAt: localDateTimeFor(sessionEndsAt, input.timezone),
            presenterRequired: sessionDefinition.presenterRequired,
            venueName: optionalText(input.venueName),
            venueAddress: optionalText(input.venueAddress),
            virtualJoinUrl: optionalText(input.virtualJoinUrl),
          })
          .execute();
        for (const presenter of presenterDefaults.filter(
          (candidate) => candidate.sessionDefinitionId === sessionDefinition.id,
        ))
          await transaction
            .insertInto("event_presenter_assignment")
            .values({
              id: `event_presenter_assignment_${randomUUID()}`,
              eventOccurrenceId,
              eventSessionId: sessionId,
              userId: presenter.userId,
              scopeKey: sessionId,
              source: "template_default",
              assignedByUserId: administrator.id,
              assignedAt: now,
              endedAt: null,
              endReason: null,
            })
            .execute();
        sessionStartsAt = sessionEndsAt;
      }
      for (const region of regions) {
        const eventOccurrenceRegionId = `event_occurrence_region_${randomUUID()}`;
        await transaction
          .insertInto("event_occurrence_region")
          .values({
            id: eventOccurrenceRegionId,
            eventOccurrenceId,
            regionId: region.regionId,
            position: region.position,
            retiredAt: null,
          })
          .execute();
        for (const coordinator of coordinatorDefaults.filter(
          (candidate) => candidate.regionId === region.regionId,
        ))
          await transaction
            .insertInto("event_coordinator_assignment")
            .values({
              id: `event_coordinator_assignment_${randomUUID()}`,
              eventOccurrenceRegionId,
              userId: coordinator.userId,
              source: "template_default",
              assignedByUserId: administrator.id,
              assignedAt: now,
              endedAt: null,
              endReason: null,
            })
            .execute();
      }
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "event_occurrence.created",
        subjectType: "event_occurrence",
        subjectId: eventOccurrenceId,
        metadata: { eventTemplateVersionId: version.id },
        createdAt: now,
      });
      return { status: "created", eventOccurrenceId } as const;
    });
}

export async function updateAdminEventOccurrence(
  eventOccurrenceId: string,
  input: AdminEventOccurrenceCreateInput,
  administrator: AuthenticatedUser,
): Promise<"updated" | "not-found" | "conflict" | "slug-in-use"> {
  if (!isIanaTimeZone(input.timezone) || !isAdminEventScheduleConsistent(input))
    return "conflict";
  const domains = normalizeEventDomains(input.domains);
  if (!domains) return "conflict";

  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(hashtext(${input.slug}))`.execute(
        transaction,
      );
      const slugOwner = await transaction
        .selectFrom("event_occurrence")
        .select("id")
        .where("slug", "=", input.slug)
        .where("id", "!=", eventOccurrenceId)
        .executeTakeFirst();
      if (slugOwner) return "slug-in-use" as const;
      const occurrence = await transaction
        .selectFrom("event_occurrence")
        .select([
          "eventTemplateVersionId",
          "startsAt",
          "confirmedCount",
          "status",
        ])
        .where("id", "=", eventOccurrenceId)
        .executeTakeFirst();
      if (!occurrence) return "not-found" as const;
      if (
        occurrence.eventTemplateVersionId !== input.eventTemplateVersionId ||
        occurrence.status !== "draft" ||
        input.capacity < occurrence.confirmedCount
      )
        return "conflict" as const;

      const sessions = await transaction
        .selectFrom("event_session")
        .select(["id", "startsAt", "endsAt"])
        .where("eventOccurrenceId", "=", eventOccurrenceId)
        .execute();
      const startsAt = requiredDate(input.startsAt);
      const endsAt = requiredDate(input.endsAt);
      const sessionMinutes = sessions.reduce(
        (total, session) =>
          total +
          (session.endsAt.getTime() - session.startsAt.getTime()) / 60_000,
        0,
      );
      if (endsAt.getTime() - startsAt.getTime() < sessionMinutes * 60_000)
        return "conflict" as const;

      const now = new Date();
      await transaction
        .updateTable("event_occurrence")
        .set({
          title: input.title,
          slug: input.slug,
          deliveryMode: input.deliveryMode,
          registrationMode: input.registrationMode,
          approvalMode: input.approvalMode,
          timezone: input.timezone,
          localStartsAt: input.localStartsAt,
          localEndsAt: input.localEndsAt,
          localRegistrationOpensAt: optionalText(
            input.localRegistrationOpensAt,
          ),
          localRegistrationClosesAt: optionalText(
            input.localRegistrationClosesAt,
          ),
          localCoordinatorLockAt: optionalText(input.localCoordinatorLockAt),
          startsAt,
          endsAt,
          registrationOpensAt: optionalDate(input.registrationOpensAt),
          registrationClosesAt: optionalDate(input.registrationClosesAt),
          coordinatorLockAt: optionalDate(input.coordinatorLockAt),
          capacity: input.capacity,
          venueName: optionalText(input.venueName),
          venueAddress: optionalText(input.venueAddress),
          virtualJoinUrl: optionalText(input.virtualJoinUrl),
          updatedAt: now,
        })
        .where("id", "=", eventOccurrenceId)
        .execute();

      for (const session of sessions) {
        const startOffsetMinutes =
          (session.startsAt.getTime() - occurrence.startsAt.getTime()) / 60_000;
        const durationMinutes =
          (session.endsAt.getTime() - session.startsAt.getTime()) / 60_000;
        const nextSessionStartsAt = addElapsedMinutes(
          startsAt,
          startOffsetMinutes,
        );
        const nextSessionEndsAt = addElapsedMinutes(
          nextSessionStartsAt,
          durationMinutes,
        );
        await transaction
          .updateTable("event_session")
          .set({
            startsAt: nextSessionStartsAt,
            endsAt: nextSessionEndsAt,
            localStartsAt: localDateTimeFor(
              nextSessionStartsAt,
              input.timezone,
            ),
            localEndsAt: localDateTimeFor(nextSessionEndsAt, input.timezone),
            venueName: optionalText(input.venueName),
            venueAddress: optionalText(input.venueAddress),
            virtualJoinUrl: optionalText(input.virtualJoinUrl),
          })
          .where("id", "=", session.id)
          .execute();
      }

      await transaction
        .deleteFrom("event_occurrence_domain")
        .where("eventOccurrenceId", "=", eventOccurrenceId)
        .execute();
      if (domains.length)
        await transaction
          .insertInto("event_occurrence_domain")
          .values(
            domains.map((domain) => ({
              eventOccurrenceId,
              domain,
              createdAt: now,
            })),
          )
          .execute();

      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "event_occurrence.updated",
        subjectType: "event_occurrence",
        subjectId: eventOccurrenceId,
        metadata: { eventTemplateVersionId: input.eventTemplateVersionId },
        createdAt: now,
      });
      return "updated" as const;
    });
}

export async function rescheduleAdminEventOccurrence(
  eventOccurrenceId: string,
  input: {
    occurrence: AdminEventOccurrenceCreateInput;
    registrationWindowPolicy: "keep" | "replace_future" | "reopen";
    regionsConfirmed: true;
    regionalCoverage: {
      regions: Array<{ regionId: string; coordinatorIds: Array<string> }>;
      retirements: Array<{
        regionId: string;
        disposition: "future_only" | "cancel_registrations";
      }>;
    };
  },
  administrator: AuthenticatedUser,
): Promise<
  | "rescheduled"
  | "not-found"
  | "conflict"
  | "slug-in-use"
  | "invalid-window-policy"
  | "regions-not-confirmed"
> {
  const next = input.occurrence;
  if (!isIanaTimeZone(next.timezone) || !isAdminEventScheduleConsistent(next))
    return "conflict";
  const domains = normalizeEventDomains(next.domains);
  if (!domains) return "conflict";

  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(hashtext(${eventOccurrenceId}))`.execute(
        transaction,
      );
      const occurrence = await transaction
        .selectFrom("event_occurrence")
        .selectAll()
        .where("id", "=", eventOccurrenceId)
        .forUpdate()
        .executeTakeFirst();
      if (!occurrence) return "not-found" as const;
      if (
        occurrence.status !== "published" ||
        occurrence.eventTemplateVersionId !== next.eventTemplateVersionId ||
        occurrence.registrationMode !== next.registrationMode ||
        occurrence.approvalMode !== next.approvalMode ||
        next.capacity < occurrence.confirmedCount
      )
        return "conflict" as const;

      await sql`select pg_advisory_xact_lock(hashtext(${next.slug}))`.execute(
        transaction,
      );
      const slugOwner = await transaction
        .selectFrom("event_occurrence")
        .select("id")
        .where("slug", "=", next.slug)
        .where("id", "!=", eventOccurrenceId)
        .executeTakeFirst();
      if (slugOwner) return "slug-in-use" as const;

      const [
        sessions,
        occurrenceRegions,
        coordinatorRows,
        finalDecision,
        participations,
        releaseSections,
      ] = await Promise.all([
        transaction
          .selectFrom("event_session")
          .select(["id", "startsAt", "endsAt"])
          .where("eventOccurrenceId", "=", eventOccurrenceId)
          .execute(),
        transaction
          .selectFrom("event_occurrence_region")
          .select(["id", "regionId", "position", "retiredAt"])
          .where("eventOccurrenceId", "=", eventOccurrenceId)
          .execute(),
        transaction
          .selectFrom("event_coordinator_assignment as assignment")
          .innerJoin(
            "event_occurrence_region as region",
            "region.id",
            "assignment.eventOccurrenceRegionId",
          )
          .select(["assignment.eventOccurrenceRegionId", "assignment.userId"])
          .where("region.eventOccurrenceId", "=", eventOccurrenceId)
          .where("assignment.endedAt", "is", null)
          .execute(),
        transaction
          .selectFrom("event_registration")
          .select("id")
          .where("eventOccurrenceId", "=", eventOccurrenceId)
          .where("finalDecidedAt", "is not", null)
          .executeTakeFirst(),
        transaction
          .selectFrom("event_participation")
          .select(["id", "createdAt"])
          .where("eventOccurrenceId", "=", eventOccurrenceId)
          .execute(),
        transaction
          .selectFrom("event_template_version_section")
          .select([
            "id",
            "releaseAnchor",
            "releaseOffsetAmount",
            "releaseOffsetUnit",
          ])
          .where(
            "eventTemplateVersionId",
            "=",
            occurrence.eventTemplateVersionId,
          )
          .execute(),
      ]);
      const activeRegions = occurrenceRegions.filter(
        (region) => !region.retiredAt,
      );
      const desiredRegionIds = new Set(
        input.regionalCoverage.regions.map((region) => region.regionId),
      );
      const removedRegions = activeRegions.filter(
        (region) => !desiredRegionIds.has(region.regionId),
      );
      const addedRegions = input.regionalCoverage.regions.filter(
        (desired) =>
          !activeRegions.some((region) => region.regionId === desired.regionId),
      );
      const retirementByRegion = new Map(
        input.regionalCoverage.retirements.map((retirement) => [
          retirement.regionId,
          retirement.disposition,
        ]),
      );
      if (
        removedRegions.some(
          (region) => !retirementByRegion.has(region.regionId),
        ) ||
        [...retirementByRegion.keys()].some(
          (regionId) =>
            !removedRegions.some((region) => region.regionId === regionId),
        )
      )
        return "regions-not-confirmed" as const;
      if (
        addedRegions.length > 0 &&
        occurrence.registrationMode !== "open_entry" &&
        input.registrationWindowPolicy !== "reopen"
      )
        return "invalid-window-policy" as const;
      const desiredCoordinatorIds = [
        ...new Set(
          input.regionalCoverage.regions.flatMap(
            (region) => region.coordinatorIds,
          ),
        ),
      ];
      const desiredCoordinatorSelections =
        input.regionalCoverage.regions.flatMap((region) =>
          region.coordinatorIds.map((userId) => ({
            regionId: region.regionId,
            userId,
          })),
        );
      const [validRegions, validCoordinatorEligibility] = await Promise.all([
        input.regionalCoverage.regions.length
          ? transaction
              .selectFrom("coordination_region")
              .select(["id", "kind"])
              .where(
                "id",
                "in",
                input.regionalCoverage.regions.map((region) => region.regionId),
              )
              .where("status", "=", "active")
              .where("kind", "=", "operational")
              .execute()
          : [],
        desiredCoordinatorIds.length
          ? transaction
              .selectFrom("event_staff_eligibility")
              .select(["userId", "regionId"])
              .where("userId", "in", desiredCoordinatorIds)
              .where("responsibility", "=", "coordinator")
              .where("revokedAt", "is", null)
              .execute()
          : [],
      ]);
      if (
        input.regionalCoverage.regions.some(
          (region) => region.coordinatorIds.length === 0,
        ) ||
        validRegions.length !== input.regionalCoverage.regions.length ||
        !desiredCoordinatorSelections.every((selection) =>
          validCoordinatorEligibility.some(
            (eligibility) =>
              eligibility.userId === selection.userId &&
              eligibility.regionId === selection.regionId,
          ),
        )
      )
        return "regions-not-confirmed" as const;

      const nextStartsAt = requiredDate(next.startsAt);
      const nextEndsAt = requiredDate(next.endsAt);
      const sessionMinutes = sessions.reduce(
        (total, session) =>
          total +
          (session.endsAt.getTime() - session.startsAt.getTime()) / 60_000,
        0,
      );
      if (
        nextEndsAt <= nextStartsAt ||
        nextEndsAt.getTime() - nextStartsAt.getTime() < sessionMinutes * 60_000
      )
        return "conflict" as const;

      const submittedOpensAt = optionalDate(next.registrationOpensAt);
      const submittedClosesAt = optionalDate(next.registrationClosesAt);
      const submittedLockAt = optionalDate(next.coordinatorLockAt);
      const now = new Date();
      const originalFinalSessionEndsAt =
        sessions.reduce<Date | null>(
          (latest, session) =>
            !latest || session.endsAt > latest ? session.endsAt : latest,
          null,
        ) ?? occurrence.endsAt;
      const elapsedReleases = participations.flatMap((participation) =>
        releaseSections.flatMap((section) => {
          const calculatedReleaseAt = calculateEventSectionReleaseAt({
            releaseAnchor: section.releaseAnchor,
            releaseOffsetAmount: section.releaseOffsetAmount,
            releaseOffsetUnit: section.releaseOffsetUnit,
            timezone: occurrence.timezone,
            participationCreatedAt: participation.createdAt,
            occurrenceStartsAt: occurrence.startsAt,
            occurrenceEndsAt: occurrence.endsAt,
            finalSessionEndsAt: originalFinalSessionEndsAt,
          });
          return calculatedReleaseAt <= now
            ? [
                {
                  eventParticipationId: participation.id,
                  eventTemplateVersionSectionId: section.id,
                  releasedAt: now,
                },
              ]
            : [];
        }),
      );
      if (elapsedReleases.length)
        await transaction
          .insertInto("event_section_release")
          .values(elapsedReleases)
          .onConflict((conflict) => conflict.doNothing())
          .execute();
      let nextOpensAt = occurrence.registrationOpensAt;
      let nextClosesAt = occurrence.registrationClosesAt;
      let nextLockAt = occurrence.coordinatorLockAt;
      let nextLocalOpensAt = occurrence.localRegistrationOpensAt;
      let nextLocalClosesAt = occurrence.localRegistrationClosesAt;
      let nextLocalLockAt = occurrence.localCoordinatorLockAt;

      if (input.registrationWindowPolicy === "replace_future") {
        const futureWindows = [
          [occurrence.registrationOpensAt, submittedOpensAt],
          [occurrence.registrationClosesAt, submittedClosesAt],
          [occurrence.coordinatorLockAt, submittedLockAt],
        ] as const;
        const futureWindowCount = futureWindows.filter(
          ([current]) => current && current > now,
        ).length;
        if (
          futureWindowCount === 0 ||
          futureWindows.some(
            ([current, proposed]) => current && current > now && !proposed,
          )
        )
          return "invalid-window-policy" as const;
        if (
          occurrence.registrationOpensAt &&
          occurrence.registrationOpensAt > now
        ) {
          nextOpensAt = submittedOpensAt;
          nextLocalOpensAt = optionalText(next.localRegistrationOpensAt);
        }
        if (
          occurrence.registrationClosesAt &&
          occurrence.registrationClosesAt > now
        ) {
          nextClosesAt = submittedClosesAt;
          nextLocalClosesAt = optionalText(next.localRegistrationClosesAt);
        }
        if (
          occurrence.coordinatorLockAt &&
          occurrence.coordinatorLockAt > now
        ) {
          nextLockAt = submittedLockAt;
          nextLocalLockAt = optionalText(next.localCoordinatorLockAt);
        }
      } else if (input.registrationWindowPolicy === "reopen") {
        if (
          occurrence.registrationMode === "open_entry" ||
          !submittedOpensAt ||
          !submittedClosesAt ||
          submittedClosesAt <= now ||
          submittedClosesAt <= submittedOpensAt ||
          (input.regionalCoverage.regions.length > 0 &&
            (!submittedLockAt || submittedLockAt < submittedClosesAt))
        )
          return "invalid-window-policy" as const;
        nextOpensAt = submittedOpensAt;
        nextClosesAt = submittedClosesAt;
        nextLockAt = submittedLockAt;
        nextLocalOpensAt = optionalText(next.localRegistrationOpensAt);
        nextLocalClosesAt = optionalText(next.localRegistrationClosesAt);
        nextLocalLockAt = optionalText(next.localCoordinatorLockAt);
      }

      if (nextOpensAt && nextClosesAt && nextClosesAt <= nextOpensAt)
        return "invalid-window-policy" as const;
      if (nextClosesAt && nextLockAt && nextLockAt < nextClosesAt)
        return "invalid-window-policy" as const;

      const rescheduleId = `event_occurrence_reschedule_${randomUUID()}`;
      await transaction
        .insertInto("event_occurrence_reschedule")
        .values({
          id: rescheduleId,
          eventOccurrenceId,
          registrationWindowPolicy: input.registrationWindowPolicy,
          previousTimezone: occurrence.timezone,
          previousLocalStartsAt: occurrence.localStartsAt,
          previousLocalEndsAt: occurrence.localEndsAt,
          previousLocalRegistrationOpensAt: occurrence.localRegistrationOpensAt,
          previousLocalRegistrationClosesAt:
            occurrence.localRegistrationClosesAt,
          previousLocalCoordinatorLockAt: occurrence.localCoordinatorLockAt,
          previousStartsAt: occurrence.startsAt,
          previousEndsAt: occurrence.endsAt,
          previousRegistrationOpensAt: occurrence.registrationOpensAt,
          previousRegistrationClosesAt: occurrence.registrationClosesAt,
          previousCoordinatorLockAt: occurrence.coordinatorLockAt,
          nextTimezone: next.timezone,
          nextLocalStartsAt: next.localStartsAt,
          nextLocalEndsAt: next.localEndsAt,
          nextLocalRegistrationOpensAt: nextLocalOpensAt,
          nextLocalRegistrationClosesAt: nextLocalClosesAt,
          nextLocalCoordinatorLockAt: nextLocalLockAt,
          nextStartsAt,
          nextEndsAt,
          nextRegistrationOpensAt: nextOpensAt,
          nextRegistrationClosesAt: nextClosesAt,
          nextCoordinatorLockAt: nextLockAt,
          actorUserId: administrator.id,
          createdAt: now,
        })
        .execute();

      const nextActiveRegions: Array<{ id: string; regionId: string }> = [];
      let nextPosition = occurrenceRegions.reduce(
        (maximum, region) => Math.max(maximum, region.position),
        -1,
      );
      const occurrenceRegionByRegionId = new Map(
        occurrenceRegions.map((region) => [region.regionId, region]),
      );
      const coordinatorIdsByOccurrenceRegion = new Map<string, Array<string>>();
      for (const coordinator of coordinatorRows) {
        const ids =
          coordinatorIdsByOccurrenceRegion.get(
            coordinator.eventOccurrenceRegionId,
          ) ?? [];
        ids.push(coordinator.userId);
        coordinatorIdsByOccurrenceRegion.set(
          coordinator.eventOccurrenceRegionId,
          ids,
        );
      }
      let releasedConfirmedCount = 0;
      let cancelledRegistrationCount = 0;
      for (const region of removedRegions) {
        const disposition = retirementByRegion.get(region.regionId);
        if (!disposition) return "regions-not-confirmed" as const;
        await transaction
          .updateTable("event_occurrence_region")
          .set({ retiredAt: now })
          .where("id", "=", region.id)
          .execute();
        await transaction
          .updateTable("event_coordinator_assignment")
          .set({
            endedAt: now,
            endReason: "assignment_ended",
          })
          .where("eventOccurrenceRegionId", "=", region.id)
          .where("endedAt", "is", null)
          .execute();
        await transaction
          .insertInto("event_occurrence_reschedule_region")
          .values({
            eventOccurrenceRescheduleId: rescheduleId,
            eventOccurrenceRegionId: region.id,
            coverageAction: "retired",
            registrationDisposition: disposition,
          })
          .execute();
        const retiringCoordinatorIds =
          coordinatorIdsByOccurrenceRegion.get(region.id) ?? [];
        if (retiringCoordinatorIds.length)
          await transaction
            .insertInto("event_occurrence_reschedule_region_coordinator")
            .values(
              retiringCoordinatorIds.map((userId) => ({
                eventOccurrenceRescheduleId: rescheduleId,
                eventOccurrenceRegionId: region.id,
                userId,
              })),
            )
            .execute();
        if (disposition === "cancel_registrations") {
          const registrations = await transaction
            .selectFrom("event_registration")
            .select(["id", "status", "coordinatorPriority"])
            .where("eventOccurrenceId", "=", eventOccurrenceId)
            .where("eventOccurrenceRegionId", "=", region.id)
            .where("status", "not in", [
              "cancelled",
              "withdrawn",
              "not_selected",
            ])
            .execute();
          releasedConfirmedCount += registrations.filter(
            (registration) => registration.status === "selected",
          ).length;
          cancelledRegistrationCount += registrations.length;
          for (const registration of registrations) {
            await transaction
              .updateTable("event_registration")
              .set({
                status: "cancelled",
                finalDecidedAt: now,
                finalDecidedByUserId: administrator.id,
                lockedInAt: null,
              })
              .where("id", "=", registration.id)
              .execute();
            await transaction
              .insertInto("event_registration_transition")
              .values({
                id: `event_registration_transition_${randomUUID()}`,
                eventRegistrationId: registration.id,
                fromStatus: registration.status,
                toStatus: "cancelled",
                source: "administrator",
                actorUserId: administrator.id,
                priority: registration.coordinatorPriority,
                occurredAt: now,
              })
              .execute();
          }
        }
      }

      for (const desired of input.regionalCoverage.regions) {
        const existing = occurrenceRegionByRegionId.get(desired.regionId);
        const wasActive = Boolean(existing && !existing.retiredAt);
        const eventOccurrenceRegionId =
          existing?.id ?? `event_occurrence_region_${randomUUID()}`;
        if (!existing) {
          nextPosition += 1;
          await transaction
            .insertInto("event_occurrence_region")
            .values({
              id: eventOccurrenceRegionId,
              eventOccurrenceId,
              regionId: desired.regionId,
              position: nextPosition,
              retiredAt: null,
            })
            .execute();
        } else if (existing.retiredAt)
          await transaction
            .updateTable("event_occurrence_region")
            .set({ retiredAt: null })
            .where("id", "=", existing.id)
            .execute();

        const currentCoordinatorIds =
          coordinatorIdsByOccurrenceRegion.get(eventOccurrenceRegionId) ?? [];
        const desiredCoordinatorIds = new Set(desired.coordinatorIds);
        const removedCoordinatorIds = currentCoordinatorIds.filter(
          (userId) => !desiredCoordinatorIds.has(userId),
        );
        if (removedCoordinatorIds.length)
          await transaction
            .updateTable("event_coordinator_assignment")
            .set({ endedAt: now, endReason: "replaced" })
            .where("eventOccurrenceRegionId", "=", eventOccurrenceRegionId)
            .where("userId", "in", removedCoordinatorIds)
            .where("endedAt", "is", null)
            .execute();
        const currentCoordinatorIdSet = new Set(currentCoordinatorIds);
        const addedCoordinatorIds = desired.coordinatorIds.filter(
          (userId) => !currentCoordinatorIdSet.has(userId),
        );
        if (addedCoordinatorIds.length)
          await transaction
            .insertInto("event_coordinator_assignment")
            .values(
              addedCoordinatorIds.map((userId) => ({
                id: `event_coordinator_assignment_${randomUUID()}`,
                eventOccurrenceRegionId,
                userId,
                source: wasActive
                  ? ("replacement" as const)
                  : ("occurrence_local" as const),
                assignedByUserId: administrator.id,
                assignedAt: now,
                endedAt: null,
                endReason: null,
              })),
            )
            .execute();
        await transaction
          .insertInto("event_occurrence_reschedule_region")
          .values({
            eventOccurrenceRescheduleId: rescheduleId,
            eventOccurrenceRegionId,
            coverageAction: wasActive ? "retained" : "added",
            registrationDisposition: null,
          })
          .execute();
        await transaction
          .insertInto("event_occurrence_reschedule_region_coordinator")
          .values(
            desired.coordinatorIds.map((userId) => ({
              eventOccurrenceRescheduleId: rescheduleId,
              eventOccurrenceRegionId,
              userId,
            })),
          )
          .execute();
        nextActiveRegions.push({
          id: eventOccurrenceRegionId,
          regionId: desired.regionId,
        });
      }

      if (
        nextActiveRegions.length > 0 &&
        input.registrationWindowPolicy === "replace_future" &&
        nextClosesAt &&
        nextLockAt
      )
        await transaction
          .updateTable("event_region_review_round")
          .set({
            registrationClosesAt: nextClosesAt,
            coordinatorLockAt: nextLockAt,
            eventOccurrenceRescheduleId: rescheduleId,
          })
          .where(
            "eventOccurrenceRegionId",
            "in",
            nextActiveRegions.map((row) => row.id),
          )
          .where("lockedAt", "is", null)
          .execute();

      if (
        input.registrationWindowPolicy === "reopen" &&
        nextClosesAt &&
        nextLockAt
      ) {
        const latestRounds = nextActiveRegions.length
          ? await transaction
              .selectFrom("event_region_review_round")
              .select([
                "eventOccurrenceRegionId",
                "round",
                "lockedAt",
                "coordinatorLockAt",
              ])
              .where(
                "eventOccurrenceRegionId",
                "in",
                nextActiveRegions.map((row) => row.id),
              )
              .orderBy("round", "desc")
              .execute()
          : [];
        const latestByRegion = new Map<string, (typeof latestRounds)[number]>();
        for (const round of latestRounds)
          if (!latestByRegion.has(round.eventOccurrenceRegionId))
            latestByRegion.set(round.eventOccurrenceRegionId, round);
        for (const region of nextActiveRegions) {
          const latest = latestByRegion.get(region.id);
          const boundaryReached =
            Boolean(finalDecision) ||
            Boolean(latest?.lockedAt) ||
            Boolean(latest && latest.coordinatorLockAt <= now);
          if (latest && !boundaryReached)
            await transaction
              .updateTable("event_region_review_round")
              .set({
                registrationClosesAt: nextClosesAt,
                coordinatorLockAt: nextLockAt,
                eventOccurrenceRescheduleId: rescheduleId,
              })
              .where("eventOccurrenceRegionId", "=", region.id)
              .where("round", "=", latest.round)
              .execute();
          else
            await transaction
              .insertInto("event_region_review_round")
              .values({
                id: `event_region_review_round_${randomUUID()}`,
                eventOccurrenceRegionId: region.id,
                round: (latest?.round ?? 0) + 1,
                registrationClosesAt: nextClosesAt,
                coordinatorLockAt: nextLockAt,
                lockedAt: null,
                lockedByUserId: null,
                lockSource: null,
                eventOccurrenceRescheduleId: rescheduleId,
              })
              .execute();
        }
      }

      await transaction
        .updateTable("event_occurrence")
        .set({
          title: next.title,
          slug: next.slug,
          deliveryMode: next.deliveryMode,
          registrationMode: next.registrationMode,
          approvalMode: next.approvalMode,
          timezone: next.timezone,
          localStartsAt: next.localStartsAt,
          localEndsAt: next.localEndsAt,
          localRegistrationOpensAt: nextLocalOpensAt,
          localRegistrationClosesAt: nextLocalClosesAt,
          localCoordinatorLockAt: nextLocalLockAt,
          startsAt: nextStartsAt,
          endsAt: nextEndsAt,
          registrationOpensAt: nextOpensAt,
          registrationClosesAt: nextClosesAt,
          coordinatorLockAt: nextLockAt,
          capacity: next.capacity,
          venueName: optionalText(next.venueName),
          venueAddress: optionalText(next.venueAddress),
          virtualJoinUrl: optionalText(next.virtualJoinUrl),
          confirmedCount: occurrence.confirmedCount - releasedConfirmedCount,
          updatedAt: now,
        })
        .where("id", "=", eventOccurrenceId)
        .execute();

      for (const session of sessions) {
        const startOffsetMinutes =
          (session.startsAt.getTime() - occurrence.startsAt.getTime()) / 60_000;
        const durationMinutes =
          (session.endsAt.getTime() - session.startsAt.getTime()) / 60_000;
        const nextSessionStartsAt = addElapsedMinutes(
          nextStartsAt,
          startOffsetMinutes,
        );
        const nextSessionEndsAt = addElapsedMinutes(
          nextSessionStartsAt,
          durationMinutes,
        );
        await transaction
          .updateTable("event_session")
          .set({
            startsAt: nextSessionStartsAt,
            endsAt: nextSessionEndsAt,
            localStartsAt: localDateTimeFor(nextSessionStartsAt, next.timezone),
            localEndsAt: localDateTimeFor(nextSessionEndsAt, next.timezone),
            venueName: optionalText(next.venueName),
            venueAddress: optionalText(next.venueAddress),
            virtualJoinUrl: optionalText(next.virtualJoinUrl),
          })
          .where("id", "=", session.id)
          .execute();
      }

      await transaction
        .deleteFrom("event_occurrence_domain")
        .where("eventOccurrenceId", "=", eventOccurrenceId)
        .execute();
      if (domains.length)
        await transaction
          .insertInto("event_occurrence_domain")
          .values(
            domains.map((domain) => ({
              eventOccurrenceId,
              domain,
              createdAt: now,
            })),
          )
          .execute();

      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "event_occurrence.rescheduled",
        subjectType: "event_occurrence_reschedule",
        subjectId: rescheduleId,
        aggregateId: eventOccurrenceId,
        metadata: {
          registrationWindowPolicy: input.registrationWindowPolicy,
          activeRegionCount: nextActiveRegions.length,
          addedRegionCount: addedRegions.length,
          retiredRegionCount: removedRegions.length,
          cancelledRegistrationCount,
        },
        createdAt: now,
      });
      return "rescheduled" as const;
    });
}

export async function publishAdminEventOccurrence(
  eventOccurrenceId: string,
  administrator: AuthenticatedUser,
): Promise<"published" | "not-found" | "conflict"> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const occurrence = await transaction
        .selectFrom("event_occurrence")
        .select([
          "id",
          "status",
          "registrationMode",
          "deliveryMode",
          "venueName",
          "virtualJoinUrl",
        ])
        .where("id", "=", eventOccurrenceId)
        .forUpdate()
        .executeTakeFirst();
      if (!occurrence) return "not-found" as const;
      if (occurrence.status !== "draft") return "conflict" as const;
      const coverage = await transaction
        .selectFrom("event_occurrence")
        .select([
          sql<number>`(select count(*)::integer
            from event_admin_assignment assignments
            inner join platform_admin active_admin
              on active_admin."userId" = assignments."userId"
            where assignments."eventOccurrenceId" = ${eventOccurrenceId}
              and assignments."endedAt" is null)`.as("admins"),
          sql<number>`(select count(*)::integer from event_session
            where "eventOccurrenceId" = ${eventOccurrenceId})`.as("sessions"),
          sql<number>`(select count(*)::integer from event_session sessions
            where sessions."eventOccurrenceId" = ${eventOccurrenceId}
              and sessions."presenterRequired"
              and not exists (
                select 1 from event_presenter_assignment presenters
                where presenters."eventOccurrenceId" = ${eventOccurrenceId}
                  and presenters."eventSessionId" = sessions.id
                  and presenters."endedAt" is null
              ))`.as("uncoveredPresenterSessions"),
          sql<number>`(select count(*)::integer from event_occurrence_region regions
            where regions."eventOccurrenceId" = ${eventOccurrenceId}
              and regions."retiredAt" is null
              and not exists (
                select 1 from event_coordinator_assignment coordinators
                where coordinators."eventOccurrenceRegionId" = regions.id
                  and coordinators."endedAt" is null
              ))`.as("uncoveredRegions"),
          sql<number>`(select count(*)::integer from event_occurrence_domain
            where "eventOccurrenceId" = ${eventOccurrenceId})`.as("domains"),
        ])
        .where("event_occurrence.id", "=", eventOccurrenceId)
        .executeTakeFirstOrThrow();
      const locationInvalid =
        (occurrence.deliveryMode === "in_person" && !occurrence.venueName) ||
        (occurrence.deliveryMode === "virtual" && !occurrence.virtualJoinUrl);
      if (
        coverage.admins === 0 ||
        coverage.sessions === 0 ||
        coverage.uncoveredPresenterSessions > 0 ||
        coverage.uncoveredRegions > 0 ||
        (occurrence.registrationMode === "required_restricted" &&
          coverage.domains === 0) ||
        locationInvalid
      )
        return "conflict" as const;
      const now = new Date();
      await transaction
        .updateTable("event_occurrence")
        .set({ status: "published", publishedAt: now, updatedAt: now })
        .where("id", "=", eventOccurrenceId)
        .executeTakeFirstOrThrow();
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "event_occurrence.published",
        subjectType: "event_occurrence",
        subjectId: eventOccurrenceId,
        createdAt: now,
      });
      return "published" as const;
    });
}
