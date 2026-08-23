import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import {
  normalizeEventDomains,
  type AdminEventOccurrenceCreateInput,
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
import { ensureEventSurveyAccessRecords } from "#/server/events/event-survey-access.server";
import { ensureEventGuestAccessRecord } from "#/server/events/event-guest-access.server";
import { calculateEventSectionReleaseAt } from "#/server/learning/event-section-release.server";
import { isAdminEventScheduleConsistent } from "#/server/admin/event-timezone.server";
import { materializeEventOccurrenceCommunications } from "#/server/admin/admin-communication.server";
import { refreshEventCommunicationSchedules } from "#/server/notifications/event-communication-execution.server";
import {
  addElapsedDuration,
  addElapsedMilliseconds,
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

export async function createAdminEventOccurrence(
  input: AdminEventOccurrenceCreateInput,
  administrator: AuthenticatedUser,
): Promise<
  | { status: "created"; eventOccurrenceId: string }
  | { status: "not-found" }
  | { status: "conflict" }
  | {
      status: "conflict";
      reason: "occurrence-window-too-short";
      minimumDurationMinutes: number;
    }
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
        return {
          status: "conflict",
          reason: "occurrence-window-too-short",
          minimumDurationMinutes: totalSessionMinutes,
        } as const;
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
          priceCents: input.priceCents,
          salePriceCents: input.salePriceCents,
          currency: input.currency,
          bulkPricing: JSON.stringify(input.bulkPricing),
          listInStore: input.listInStore,
          featured: input.featured,
          venueName: optionalText(input.venueName),
          venueAddress: optionalText(input.venueAddress),
          virtualJoinUrl: optionalText(input.virtualJoinUrl),
          openEntryAttendanceMode: "checked_in",
          publishedAt: null,
          createdByUserId: administrator.id,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      await materializeEventOccurrenceCommunications(
        transaction,
        eventOccurrenceId,
        version.id,
        administrator.id,
        now,
      );
      await ensureEventSurveyAccessRecords(
        transaction,
        eventOccurrenceId,
        version.id,
        now,
      );
      if (input.registrationMode === "open_entry")
        await ensureEventGuestAccessRecord(transaction, eventOccurrenceId, now);
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
          priceCents: input.priceCents,
          salePriceCents: input.salePriceCents,
          currency: input.currency,
          bulkPricing: JSON.stringify(input.bulkPricing),
          listInStore: input.listInStore,
          featured: input.featured,
          venueName: optionalText(input.venueName),
          venueAddress: optionalText(input.venueAddress),
          virtualJoinUrl: optionalText(input.virtualJoinUrl),
          updatedAt: now,
        })
        .where("id", "=", eventOccurrenceId)
        .execute();

      for (const session of sessions) {
        const startOffsetMilliseconds =
          session.startsAt.getTime() - occurrence.startsAt.getTime();
        const durationMilliseconds =
          session.endsAt.getTime() - session.startsAt.getTime();
        const nextSessionStartsAt = addElapsedMilliseconds(
          startsAt,
          startOffsetMilliseconds,
        );
        const nextSessionEndsAt = addElapsedMilliseconds(
          nextSessionStartsAt,
          durationMilliseconds,
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

      await refreshEventCommunicationSchedules(
        transaction,
        eventOccurrenceId,
        now,
      );

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
          priceCents: next.priceCents,
          salePriceCents: next.salePriceCents,
          currency: next.currency,
          bulkPricing: JSON.stringify(next.bulkPricing),
          listInStore: next.listInStore,
          featured: next.featured,
          venueName: optionalText(next.venueName),
          venueAddress: optionalText(next.venueAddress),
          virtualJoinUrl: optionalText(next.virtualJoinUrl),
          confirmedCount: occurrence.confirmedCount - releasedConfirmedCount,
          updatedAt: now,
        })
        .where("id", "=", eventOccurrenceId)
        .execute();

      for (const session of sessions) {
        const startOffsetMilliseconds =
          session.startsAt.getTime() - occurrence.startsAt.getTime();
        const durationMilliseconds =
          session.endsAt.getTime() - session.startsAt.getTime();
        const nextSessionStartsAt = addElapsedMilliseconds(
          nextStartsAt,
          startOffsetMilliseconds,
        );
        const nextSessionEndsAt = addElapsedMilliseconds(
          nextSessionStartsAt,
          durationMilliseconds,
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

      await refreshEventCommunicationSchedules(
        transaction,
        eventOccurrenceId,
        now,
      );
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
      await refreshEventCommunicationSchedules(
        transaction,
        eventOccurrenceId,
        now,
      );
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
