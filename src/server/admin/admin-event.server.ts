import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import {
  normalizeEventDomains,
  type AdminEventOccurrenceCreateInput,
  type AdminEventTemplateCreateInput,
  type AdminEventWorkspace,
} from "#/features/admin-event/admin-event.schema";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

function optionalDate(value: string): Date | null {
  return value ? new Date(value) : null;
}

function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function hasValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export async function findAdminEventWorkspace(): Promise<AdminEventWorkspace> {
  const database = getDatabase();
  const [templates, versions, occurrences] = await Promise.all([
    database
      .selectFrom("event_template")
      .select(["id", "slug", "title", "status"])
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
        "event_template.id as eventTemplateId",
        "event_template.title as eventTemplateTitle",
        "event_template_version.version as templateVersion",
        "event_occurrence.title",
        "event_occurrence.status",
        "event_occurrence.deliveryMode",
        "event_occurrence.registrationMode",
        "event_occurrence.timezone",
        "event_occurrence.startsAt",
        "event_occurrence.endsAt",
        "event_occurrence.capacity",
        "event_occurrence.confirmedCount",
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
      .orderBy("event_occurrence.startsAt", "desc")
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
    occurrences: occurrences.map((occurrence) => ({
      ...occurrence,
      startsAt: occurrence.startsAt.toISOString(),
      endsAt: occurrence.endsAt.toISOString(),
    })),
  };
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
  const sessionDefinitionId = `event_session_definition_${randomUUID()}`;
  try {
    await getDatabase()
      .transaction()
      .execute(async (transaction) => {
        await transaction
          .insertInto("event_template")
          .values({
            id: eventTemplateId,
            slug: input.slug,
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
            summary: input.summary,
            description: input.description,
            hasCompletionCertificate: input.hasCompletionCertificate,
            publishedAt: null,
          })
          .execute();
        await transaction
          .insertInto("event_template_version_admin_default")
          .values({
            eventTemplateVersionId,
            userId: administrator.id,
          })
          .execute();
        await transaction
          .insertInto("event_template_session_definition")
          .values({
            id: sessionDefinitionId,
            eventTemplateVersionId,
            position: 0,
            title: input.sessionTitle,
            durationMinutes: input.sessionDurationMinutes,
            presenterRequired: true,
          })
          .execute();
        await transaction
          .insertInto("event_template_version_presenter_default")
          .values({
            eventTemplateVersionId,
            sessionDefinitionId,
            userId: administrator.id,
            scopeKey: sessionDefinitionId,
          })
          .execute();
        await recordDurableAuditEvent(transaction, {
          actorUserId: administrator.id,
          action: "event_template.created",
          subjectType: "event_template",
          subjectId: eventTemplateId,
          metadata: { eventTemplateVersionId },
        });
      });
  } catch (error) {
    if (isUniqueViolation(error)) return { status: "conflict" };
    throw error;
  }
  return { status: "created", eventTemplateId, eventTemplateVersionId };
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
        ])
        .where("event_template_version.id", "=", eventTemplateVersionId)
        .where("event_template.id", "=", eventTemplateId)
        .forUpdate()
        .executeTakeFirst();
      if (!version) return "not-found" as const;
      if (version.publishedAt || version.status === "archived")
        return "conflict" as const;
      const [administratorCoverage, presenterCoverage] = await Promise.all([
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
          .where("defaults.eventTemplateVersionId", "=", eventTemplateVersionId)
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
                where presenters."eventTemplateVersionId" = sessions."eventTemplateVersionId"
                  and presenters."sessionDefinitionId" = sessions.id
              )
            )::integer`.as("covered"),
          ])
          .where("sessions.eventTemplateVersionId", "=", eventTemplateVersionId)
          .executeTakeFirstOrThrow(),
      ]);
      if (
        administratorCoverage.configured === 0 ||
        administratorCoverage.configured !== administratorCoverage.active ||
        presenterCoverage.required !== presenterCoverage.covered
      )
        return "conflict" as const;
      const regionCoverage = await transaction
        .selectFrom("event_template_version_region as regions")
        .select([
          sql<number>`count(*)::integer`.as("configured"),
          sql<number>`count(*) filter (where exists (
            select 1 from event_template_version_coordinator_default coordinators
            where coordinators."eventTemplateVersionId" = regions."eventTemplateVersionId"
              and coordinators."regionId" = regions."regionId"
          ))::integer`.as("covered"),
        ])
        .where("regions.eventTemplateVersionId", "=", eventTemplateVersionId)
        .executeTakeFirstOrThrow();
      if (regionCoverage.configured !== regionCoverage.covered)
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
> {
  if (!hasValidTimezone(input.timezone)) return { status: "conflict" };
  const domains = normalizeEventDomains(input.domains);
  if (!domains) return { status: "conflict" };
  const eventOccurrenceId = `event_occurrence_${randomUUID()}`;
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
          .selectFrom("event_template_version_presenter_default")
          .select(["sessionDefinitionId", "userId", "scopeKey"])
          .where("eventTemplateVersionId", "=", version.id)
          .execute(),
        transaction
          .selectFrom("event_template_version_region as template_region")
          .select(["template_region.regionId", "template_region.position"])
          .where("template_region.eventTemplateVersionId", "=", version.id)
          .orderBy("template_region.position")
          .execute(),
      ]);
      if (
        configuredAdminDefaults.length === 0 ||
        activeAdminDefaults.length !== configuredAdminDefaults.length ||
        sessionDefinitions.length !== 1
      )
        return { status: "conflict" } as const;
      const requiredSession = sessionDefinitions[0];
      if (!requiredSession) return { status: "conflict" } as const;
      if (
        requiredSession.presenterRequired &&
        !presenterDefaults.some(
          (presenter) => presenter.sessionDefinitionId === requiredSession.id,
        )
      )
        return { status: "conflict" } as const;
      const coordinatorDefaults = await transaction
        .selectFrom("event_template_version_coordinator_default")
        .select(["regionId", "userId"])
        .where("eventTemplateVersionId", "=", version.id)
        .execute();
      if (
        regions.some(
          (region) =>
            !coordinatorDefaults.some(
              (coordinator) => coordinator.regionId === region.regionId,
            ),
        )
      )
        return { status: "conflict" } as const;

      const startsAt = new Date(input.startsAt);
      const endsAt = new Date(input.endsAt);
      const now = new Date();
      await transaction
        .insertInto("event_occurrence")
        .values({
          id: eventOccurrenceId,
          eventTemplateVersionId: version.id,
          title: input.title,
          status: "draft",
          deliveryMode: input.deliveryMode,
          registrationMode: input.registrationMode,
          approvalMode: input.approvalMode,
          timezone: input.timezone,
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
      const sessionId = `event_session_${randomUUID()}`;
      await transaction
        .insertInto("event_session")
        .values({
          id: sessionId,
          eventOccurrenceId,
          sessionDefinitionId: requiredSession.id,
          position: 0,
          title: requiredSession.title,
          startsAt,
          endsAt,
          presenterRequired: requiredSession.presenterRequired,
          venueName: optionalText(input.venueName),
          venueAddress: optionalText(input.venueAddress),
          virtualJoinUrl: optionalText(input.virtualJoinUrl),
        })
        .execute();
      for (const presenter of presenterDefaults)
        await transaction
          .insertInto("event_presenter_assignment")
          .values({
            id: `event_presenter_assignment_${randomUUID()}`,
            eventOccurrenceId,
            eventSessionId: presenter.sessionDefinitionId ? sessionId : null,
            userId: presenter.userId,
            scopeKey: presenter.sessionDefinitionId ? sessionId : "occurrence",
            source: "template_default",
            assignedByUserId: administrator.id,
            assignedAt: now,
            endedAt: null,
            endReason: null,
          })
          .execute();
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
          sql<number>`(select count(*)::integer from event_admin_assignment
            where "eventOccurrenceId" = ${eventOccurrenceId} and "endedAt" is null)`.as(
            "admins",
          ),
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
        ((occurrence.deliveryMode === "in_person" ||
          occurrence.deliveryMode === "hybrid") &&
          !occurrence.venueName) ||
        ((occurrence.deliveryMode === "virtual" ||
          occurrence.deliveryMode === "hybrid") &&
          !occurrence.virtualJoinUrl);
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
