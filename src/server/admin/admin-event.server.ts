import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import {
  type AdminCoordinationRegionSaveInput,
  type AdminEventPersonOption,
  type AdminEventWorkspace,
} from "#/features/admin-event/admin-event.schema";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import { provisionUser } from "#/server/identity/provisional-user.server";

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
        "event_occurrence.priceCents",
        "event_occurrence.salePriceCents",
        "event_occurrence.currency",
        "event_occurrence.bulkPricing",
        "event_occurrence.listInStore",
        "event_occurrence.featured",
        "event_occurrence.confirmedCount",
        "event_occurrence.venueName",
        "event_occurrence.venueAddress",
        "event_occurrence.virtualJoinUrl",
        "event_occurrence.openEntryAttendanceMode",
        sql<string>`coalesce((
          select string_agg(region.name, ', ' order by occurrence_region.position)
          from event_occurrence_region as occurrence_region
          inner join coordination_region as region
            on region.id = occurrence_region."regionId"
          where occurrence_region."eventOccurrenceId" = event_occurrence.id
            and occurrence_region."retiredAt" is null
        ), '')`.as("regions"),
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
    name?: string | undefined;
    email: string;
    responsibility: "presenter" | "coordinator";
    regionId: string | null;
  },
  administrator: AuthenticatedUser,
): Promise<{
  status: "granted" | "unchanged";
  eligibilityId: string;
  accountInvited: boolean;
} | null> {
  const normalizedEmail = input.email.trim().toLocaleLowerCase("en-AU");
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      let user = await transaction
        .selectFrom("user")
        .select("id")
        .where(sql<boolean>`lower("email") = ${normalizedEmail}`)
        .executeTakeFirst();
      let accountInvited = false;
      if (!user && input.name?.trim()) {
        const provisioned = await provisionUser(transaction, {
          name: input.name,
          email: normalizedEmail,
          source: "administrator",
          actorUserId: administrator.id,
          sourceEventId: `staff-eligibility:${randomUUID()}`,
          refreshExistingSetup: { reason: "administrator" },
        });
        user = { id: provisioned.user.id };
        accountInvited = provisioned.notificationId !== null;
      }
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
          accountInvited,
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
      return {
        status: "granted" as const,
        eligibilityId: grantId,
        accountInvited,
      };
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
  { status: "revoked"; endedAssignmentCount: number } | { status: "not-found" }
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
              .select("assignment.id as assignmentId")
              .where("assignment.userId", "=", grant.userId)
              .where("assignment.endedAt", "is", null)
              .where("occurrenceRegion.regionId", "=", grant.regionId)
              .forUpdate(["assignment", "occurrenceRegion"])
              .execute()
          : [];
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

export {
  createAdminEventTemplate,
  createAdminEventTemplateVersion,
  deleteAdminEventTemplateVersion,
  findAdminEventTemplate,
  publishAdminEventTemplateVersion,
  saveAdminEventTemplateDraft,
  startAdminEventTemplate,
} from "./admin-event-template.server";

export {
  createAdminEventOccurrence,
  publishAdminEventOccurrence,
  rescheduleAdminEventOccurrence,
  updateAdminEventOccurrence,
} from "./admin-event-occurrence.server";
