import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import type { AdminEventOccurrenceOperations } from "#/features/admin-event/admin-event-operations.schema";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import {
  normalizeUserEmail,
  provisionUser,
} from "#/server/identity/provisional-user.server";
import { resendAccountSetup } from "#/server/identity/account-setup.server";
import { completeEventParticipationIfReady } from "#/server/learning/event-learning-completion.server";

function domainFromEmail(email: string): string | null {
  const separator = email.lastIndexOf("@");
  return separator > 0 && separator < email.length - 1
    ? email.slice(separator + 1).toLocaleLowerCase("en-AU")
    : null;
}

async function ensureReviewRound(
  transaction: Transaction<Database>,
  occurrence: {
    registrationClosesAt: Date | null;
    coordinatorLockAt: Date | null;
  },
  eventOccurrenceRegionId: string,
) {
  await sql`select pg_advisory_xact_lock(hashtext(${eventOccurrenceRegionId}))`.execute(
    transaction,
  );
  const current = await transaction
    .selectFrom("event_region_review_round")
    .selectAll()
    .where("eventOccurrenceRegionId", "=", eventOccurrenceRegionId)
    .orderBy("round", "desc")
    .executeTakeFirst();
  if (current) return current;
  if (!occurrence.registrationClosesAt || !occurrence.coordinatorLockAt)
    return null;
  const created = {
    id: `event_region_review_round_${randomUUID()}`,
    eventOccurrenceRegionId,
    round: 1,
    registrationClosesAt: occurrence.registrationClosesAt,
    coordinatorLockAt: occurrence.coordinatorLockAt,
    lockedAt: null,
    lockedByUserId: null,
    lockSource: null,
  } as const;
  await transaction
    .insertInto("event_region_review_round")
    .values(created)
    .execute();
  return created;
}

export async function findAdminEventOccurrenceOperations(
  eventOccurrenceId: string,
): Promise<AdminEventOccurrenceOperations | null> {
  const database = getDatabase();
  const occurrence = await database
    .selectFrom("event_occurrence as occurrence")
    .innerJoin(
      "event_template_version as version",
      "version.id",
      "occurrence.eventTemplateVersionId",
    )
    .innerJoin(
      "event_template as template",
      "template.id",
      "version.eventTemplateId",
    )
    .select([
      "occurrence.id",
      "occurrence.eventTemplateVersionId",
      "version.eventTemplateId",
      "occurrence.title",
      "occurrence.slug",
      "occurrence.status",
      "template.title as templateTitle",
      "version.version as templateVersion",
      "occurrence.deliveryMode",
      "occurrence.registrationMode",
      "occurrence.approvalMode",
      "occurrence.timezone",
      "occurrence.localStartsAt",
      "occurrence.localEndsAt",
      "occurrence.localRegistrationOpensAt",
      "occurrence.localRegistrationClosesAt",
      "occurrence.localCoordinatorLockAt",
      "occurrence.startsAt",
      "occurrence.endsAt",
      "occurrence.registrationOpensAt",
      "occurrence.registrationClosesAt",
      "occurrence.coordinatorLockAt",
      "occurrence.capacity",
      "occurrence.confirmedCount",
      "occurrence.venueName",
      "occurrence.venueAddress",
      "occurrence.virtualJoinUrl",
    ])
    .where("occurrence.id", "=", eventOccurrenceId)
    .executeTakeFirst();
  if (!occurrence) return null;

  const [
    registrationRows,
    regionRows,
    coordinatorRows,
    reviewRows,
    sessionRows,
    presenterRows,
    adminRows,
    userRows,
    availableCoordinatorRows,
    participationRows,
    attendanceRows,
    occurrenceDomains,
    transitionRows,
    rescheduleRows,
    availableRegionRows,
  ] = await Promise.all([
    database
      .selectFrom("event_registration as registration")
      .leftJoin(
        "event_occurrence_region as occurrence_region",
        "occurrence_region.id",
        "registration.eventOccurrenceRegionId",
      )
      .leftJoin(
        "coordination_region as region",
        "region.id",
        "occurrence_region.regionId",
      )
      .innerJoin("user", "user.id", "registration.userId")
      .leftJoin(
        "coordination_region as profile_region",
        "profile_region.id",
        "user.currentRegionId",
      )
      .select([
        "registration.id",
        "registration.userId",
        "registration.nameSnapshot as name",
        "registration.emailSnapshot as email",
        "registration.source",
        "registration.eligibilitySource",
        "registration.status",
        "registration.eventOccurrenceRegionId as regionId",
        "occurrence_region.regionId as registeredDirectoryRegionId",
        "region.name as regionName",
        "user.currentRegionId as profileRegionId",
        "profile_region.name as profileRegionName",
        "registration.reviewRoundId",
        "registration.coordinatorPriority",
        "registration.submittedAt",
        "registration.coordinatorDecidedAt",
        "registration.finalDecidedAt",
        "user.accountState",
        "user.setupRequestedAt",
      ])
      .where("registration.eventOccurrenceId", "=", eventOccurrenceId)
      .orderBy("registration.submittedAt", "desc")
      .execute(),
    database
      .selectFrom("event_occurrence_region as occurrence_region")
      .innerJoin(
        "coordination_region as region",
        "region.id",
        "occurrence_region.regionId",
      )
      .select([
        "occurrence_region.id",
        "occurrence_region.regionId",
        "region.name",
        "region.code",
        "occurrence_region.position",
      ])
      .where("occurrence_region.eventOccurrenceId", "=", eventOccurrenceId)
      .where("occurrence_region.retiredAt", "is", null)
      .orderBy("occurrence_region.position")
      .execute(),
    database
      .selectFrom("event_coordinator_assignment as assignment")
      .innerJoin(
        "event_occurrence_region as occurrence_region",
        "occurrence_region.id",
        "assignment.eventOccurrenceRegionId",
      )
      .innerJoin("user", "user.id", "assignment.userId")
      .select([
        "assignment.eventOccurrenceRegionId",
        "user.id",
        "user.name",
        "user.email",
      ])
      .where("occurrence_region.eventOccurrenceId", "=", eventOccurrenceId)
      .where("assignment.endedAt", "is", null)
      .execute(),
    database
      .selectFrom("event_region_review_round as review")
      .innerJoin(
        "event_occurrence_region as occurrence_region",
        "occurrence_region.id",
        "review.eventOccurrenceRegionId",
      )
      .selectAll("review")
      .where("occurrence_region.eventOccurrenceId", "=", eventOccurrenceId)
      .orderBy("review.round", "desc")
      .execute(),
    database
      .selectFrom("event_session")
      .select(["id", "title", "startsAt", "endsAt", "position"])
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .orderBy("position")
      .execute(),
    database
      .selectFrom("event_presenter_assignment as assignment")
      .innerJoin("user", "user.id", "assignment.userId")
      .select([
        "assignment.eventSessionId",
        "user.id",
        "user.name",
        "user.email",
      ])
      .where("assignment.eventOccurrenceId", "=", eventOccurrenceId)
      .where("assignment.endedAt", "is", null)
      .execute(),
    database
      .selectFrom("event_admin_assignment as assignment")
      .innerJoin("user", "user.id", "assignment.userId")
      .select(["user.id", "user.name", "user.email"])
      .where("assignment.eventOccurrenceId", "=", eventOccurrenceId)
      .where("assignment.endedAt", "is", null)
      .execute(),
    database
      .selectFrom("user")
      .select(["id", "name", "email"])
      .orderBy("name")
      .limit(500)
      .execute(),
    database
      .selectFrom("event_staff_eligibility as eligibility")
      .innerJoin("user", "user.id", "eligibility.userId")
      .innerJoin(
        "coordination_region as region",
        "region.id",
        "eligibility.regionId",
      )
      .select(["user.id", "user.name", "user.email", "region.id as regionId"])
      .where("eligibility.responsibility", "=", "coordinator")
      .where("eligibility.revokedAt", "is", null)
      .where("region.status", "=", "active")
      .where("region.kind", "=", "operational")
      .orderBy("user.name")
      .execute(),
    database
      .selectFrom("event_participation")
      .select([
        "id",
        "registrationId",
        "nameSnapshot as name",
        "emailSnapshot as email",
      ])
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .execute(),
    database
      .selectFrom("event_attendance as attendance")
      .innerJoin(
        "event_session as session",
        "session.id",
        "attendance.eventSessionId",
      )
      .select([
        "attendance.eventParticipationId",
        "attendance.eventSessionId",
        "attendance.state",
        "attendance.updatedAt",
      ])
      .where("session.eventOccurrenceId", "=", eventOccurrenceId)
      .execute(),
    database
      .selectFrom("event_occurrence_domain")
      .select("domain")
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .orderBy("domain")
      .execute(),
    database
      .selectFrom("event_registration_transition as transition")
      .innerJoin(
        "event_registration as registration",
        "registration.id",
        "transition.eventRegistrationId",
      )
      .leftJoin("user as actor", "actor.id", "transition.actorUserId")
      .leftJoin(
        "event_occurrence_region as from_occurrence_region",
        "from_occurrence_region.id",
        "transition.fromEventOccurrenceRegionId",
      )
      .leftJoin(
        "coordination_region as from_region",
        "from_region.id",
        "from_occurrence_region.regionId",
      )
      .leftJoin(
        "event_occurrence_region as to_occurrence_region",
        "to_occurrence_region.id",
        "transition.toEventOccurrenceRegionId",
      )
      .leftJoin(
        "coordination_region as to_region",
        "to_region.id",
        "to_occurrence_region.regionId",
      )
      .select([
        "transition.id",
        "transition.eventRegistrationId as registrationId",
        "registration.nameSnapshot as learnerName",
        "transition.fromStatus",
        "transition.toStatus",
        "transition.source",
        "actor.name as actorName",
        "transition.priority",
        "from_region.name as fromRegionName",
        "to_region.name as toRegionName",
        "transition.occurredAt",
      ])
      .where("registration.eventOccurrenceId", "=", eventOccurrenceId)
      .orderBy("transition.occurredAt", "desc")
      .limit(500)
      .execute(),
    database
      .selectFrom("event_occurrence_reschedule as reschedule")
      .innerJoin("user as actor", "actor.id", "reschedule.actorUserId")
      .select([
        "reschedule.id",
        "reschedule.registrationWindowPolicy",
        "reschedule.previousStartsAt",
        "reschedule.previousEndsAt",
        "reschedule.nextStartsAt",
        "reschedule.nextEndsAt",
        "actor.name as actorName",
        "reschedule.createdAt",
        sql<number>`(select count(*)::integer
          from event_occurrence_reschedule_region regions
          where regions."eventOccurrenceRescheduleId" = reschedule.id)`.as(
          "regionCount",
        ),
        sql<number>`(select count(*)::integer
          from event_occurrence_reschedule_region_coordinator coordinators
          where coordinators."eventOccurrenceRescheduleId" = reschedule.id)`.as(
          "coordinatorCount",
        ),
      ])
      .where("reschedule.eventOccurrenceId", "=", eventOccurrenceId)
      .orderBy("reschedule.createdAt", "desc")
      .execute(),
    database
      .selectFrom("coordination_region as region")
      .leftJoin("coordination_region as parent", "parent.id", "region.parentId")
      .select([
        "region.id",
        "region.name",
        "region.code",
        "parent.name as parentName",
      ])
      .where("region.status", "=", "active")
      .where("region.kind", "=", "operational")
      .orderBy("parent.name")
      .orderBy("region.name")
      .execute(),
  ]);

  const now = new Date();
  const reviewsByRegion = new Map<string, (typeof reviewRows)[number]>();
  for (const review of reviewRows)
    if (!reviewsByRegion.has(review.eventOccurrenceRegionId))
      reviewsByRegion.set(review.eventOccurrenceRegionId, review);
  const selected = registrationRows.filter(
    (row) => row.status === "selected",
  ).length;
  const participationByRegistration = new Map<string, string>();
  for (const participation of participationRows)
    if (participation.registrationId)
      participationByRegistration.set(
        participation.registrationId,
        participation.id,
      );
  const participationWithAttendance = new Set<string>();
  for (const attendance of attendanceRows)
    if (attendance.state !== "not_recorded")
      participationWithAttendance.add(attendance.eventParticipationId);
  return {
    occurrence: {
      ...occurrence,
      startsAt: occurrence.startsAt.toISOString(),
      endsAt: occurrence.endsAt.toISOString(),
      registrationOpensAt:
        occurrence.registrationOpensAt?.toISOString() ?? null,
      registrationClosesAt:
        occurrence.registrationClosesAt?.toISOString() ?? null,
      coordinatorLockAt: occurrence.coordinatorLockAt?.toISOString() ?? null,
      venueName: occurrence.venueName ?? "",
      venueAddress: occurrence.venueAddress ?? "",
      virtualJoinUrl: occurrence.virtualJoinUrl ?? "",
      domains: occurrenceDomains.map((row) => row.domain).join(", "),
      sessionCount: sessionRows.length,
      assignedAdminCount: adminRows.length,
    },
    metrics: {
      total: registrationRows.length,
      submitted: registrationRows.filter((row) => row.status === "submitted")
        .length,
      candidates: registrationRows.filter(
        (row) => row.status === "coordinator_approved",
      ).length,
      selected,
      remainingCapacity: Math.max(
        0,
        occurrence.capacity - occurrence.confirmedCount,
      ),
    },
    registrations: registrationRows.map((row) => ({
      ...row,
      status: row.status,
      submittedAt: row.submittedAt.toISOString(),
      coordinatorDecidedAt: row.coordinatorDecidedAt?.toISOString() ?? null,
      finalDecidedAt: row.finalDecidedAt?.toISOString() ?? null,
      setupRequestedAt: row.setupRequestedAt?.toISOString() ?? null,
      finalDecisionLocked: participationWithAttendance.has(
        participationByRegistration.get(row.id) ?? "",
      ),
      regionMismatch: row.profileRegionId !== row.registeredDirectoryRegionId,
    })),
    regions: regionRows.map((region) => {
      const review = reviewsByRegion.get(region.id);
      return {
        id: region.id,
        regionId: region.regionId,
        name: region.name,
        code: region.code,
        lockedAt: review?.lockedAt?.toISOString() ?? null,
        effectivelyLocked: Boolean(
          review?.lockedAt ||
          (review?.coordinatorLockAt && review.coordinatorLockAt <= now) ||
          (!review &&
            occurrence.coordinatorLockAt &&
            occurrence.coordinatorLockAt <= now),
        ),
        registrationCount: registrationRows.filter(
          (row) => row.regionId === region.id,
        ).length,
        selectedCount: registrationRows.filter(
          (row) => row.regionId === region.id && row.status === "selected",
        ).length,
        affectedActiveCount: registrationRows.filter(
          (row) =>
            row.regionId === region.id &&
            !(["cancelled", "withdrawn", "not_selected"] as const).includes(
              row.status as never,
            ),
        ).length,
        coordinators: coordinatorRows
          .filter((row) => row.eventOccurrenceRegionId === region.id)
          .map(({ id, name, email }) => ({ id, name, email })),
      };
    }),
    sessions: sessionRows.map((session) => ({
      id: session.id,
      title: session.title,
      startsAt: session.startsAt.toISOString(),
      endsAt: session.endsAt.toISOString(),
      presenters: presenterRows
        .filter((row) => row.eventSessionId === session.id)
        .map(({ id, name, email }) => ({ id, name, email })),
      attendance: participationRows.map((participation) => {
        const attendance = attendanceRows.find(
          (row) =>
            row.eventSessionId === session.id &&
            row.eventParticipationId === participation.id,
        );
        return {
          eventParticipationId: participation.id,
          name: participation.name,
          email: participation.email,
          state: attendance?.state ?? "not_recorded",
          updatedAt: attendance?.updatedAt.toISOString() ?? null,
        };
      }),
    })),
    administrators: adminRows,
    availableUsers: userRows,
    availableCoordinators: availableCoordinatorRows,
    availableRegions: availableRegionRows,
    reschedules: rescheduleRows.map((reschedule) => ({
      ...reschedule,
      previousStartsAt: reschedule.previousStartsAt.toISOString(),
      previousEndsAt: reschedule.previousEndsAt.toISOString(),
      nextStartsAt: reschedule.nextStartsAt.toISOString(),
      nextEndsAt: reschedule.nextEndsAt.toISOString(),
      createdAt: reschedule.createdAt.toISOString(),
    })),
    activity: transitionRows.map((transition) => ({
      ...transition,
      occurredAt: transition.occurredAt.toISOString(),
    })),
  };
}

export async function resendAdminEventAccountSetup(
  eventOccurrenceId: string,
  userId: string,
  actor: AuthenticatedUser,
): Promise<"resent" | "not-found" | "already-active"> {
  const registration = await getDatabase()
    .selectFrom("event_registration")
    .select("id")
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .where("userId", "=", userId)
    .executeTakeFirst();
  if (!registration) return "not-found";
  return await resendAccountSetup(userId, actor);
}

export async function recordAdminEventAttendance(
  input: {
    eventOccurrenceId: string;
    eventSessionId: string;
    eventParticipationId: string;
    state: "not_recorded" | "checked_in" | "attended" | "absent";
  },
  actor: AuthenticatedUser,
  source: "coordinator" | "presenter" | "administrator" = "administrator",
) {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const occurrence = await transaction
        .selectFrom("event_occurrence")
        .select("id")
        .where("id", "=", input.eventOccurrenceId)
        .forUpdate()
        .executeTakeFirst();
      if (!occurrence) return "not-found" as const;
      const valid = await transaction
        .selectFrom("event_participation as participation")
        .innerJoin(
          "event_session as session",
          "session.eventOccurrenceId",
          "participation.eventOccurrenceId",
        )
        .leftJoin(
          "event_registration as registration",
          "registration.id",
          "participation.registrationId",
        )
        .select(["participation.id"])
        .where("participation.id", "=", input.eventParticipationId)
        .where("session.id", "=", input.eventSessionId)
        .where("participation.eventOccurrenceId", "=", input.eventOccurrenceId)
        .where((expression) =>
          expression.or([
            expression("participation.mode", "=", "open_entry"),
            expression("registration.status", "=", "selected"),
          ]),
        )
        .executeTakeFirst();
      if (!valid) return "not-found" as const;
      const now = new Date();
      await transaction
        .insertInto("event_attendance")
        .values({
          eventParticipationId: input.eventParticipationId,
          eventSessionId: input.eventSessionId,
          state: input.state,
          source,
          recordedByUserId: actor.id,
          recordedAt: now,
          updatedAt: now,
        })
        .onConflict((conflict) =>
          conflict
            .columns(["eventParticipationId", "eventSessionId"])
            .doUpdateSet({
              state: input.state,
              source,
              recordedByUserId: actor.id,
              updatedAt: now,
            }),
        )
        .execute();
      await recordDurableAuditEvent(transaction, {
        actorUserId: actor.id,
        action: "event_attendance.recorded",
        subjectType: "event_attendance",
        subjectId: `${input.eventParticipationId}:${input.eventSessionId}`,
        aggregateId: input.eventOccurrenceId,
        metadata: { state: input.state, source },
        createdAt: now,
      });
      await completeEventParticipationIfReady(
        transaction,
        input.eventParticipationId,
        now,
      );
      return "recorded" as const;
    });
}

export async function decideAdminEventCoordinatorRegistration(
  input: {
    eventOccurrenceId: string;
    registrationId: string;
    decision: "coordinator_approved" | "coordinator_declined";
    priority: number | null;
  },
  actor: AuthenticatedUser,
) {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const registration = await transaction
        .selectFrom("event_registration")
        .selectAll()
        .where("id", "=", input.registrationId)
        .where("eventOccurrenceId", "=", input.eventOccurrenceId)
        .forUpdate()
        .executeTakeFirst();
      if (!registration) return "not-found" as const;
      if (!registration.eventOccurrenceRegionId || !registration.reviewRoundId)
        return "invalid-transition" as const;
      const review = await transaction
        .selectFrom("event_region_review_round")
        .selectAll()
        .where("id", "=", registration.reviewRoundId)
        .forUpdate()
        .executeTakeFirst();
      if (!review) return "invalid-transition" as const;
      if (review.lockedAt || review.coordinatorLockAt <= new Date())
        return "region-locked" as const;
      if (
        !(
          ["submitted", "coordinator_approved", "coordinator_declined"] as const
        ).includes(registration.status as never)
      )
        return "invalid-transition" as const;
      const now = new Date();
      await transaction
        .updateTable("event_registration")
        .set({
          status: input.decision,
          coordinatorPriority:
            input.decision === "coordinator_approved" ? input.priority : null,
          coordinatorDecidedAt: now,
          coordinatorDecidedByUserId: actor.id,
        })
        .where("id", "=", registration.id)
        .execute();
      await transaction
        .insertInto("event_registration_transition")
        .values({
          id: `event_registration_transition_${randomUUID()}`,
          eventRegistrationId: registration.id,
          fromStatus: registration.status,
          toStatus: input.decision,
          source: "coordinator",
          actorUserId: actor.id,
          priority:
            input.decision === "coordinator_approved" ? input.priority : null,
          occurredAt: now,
        })
        .execute();
      await recordDurableAuditEvent(transaction, {
        actorUserId: actor.id,
        action: "event_registration.coordinator_reviewed",
        subjectType: "event_registration",
        subjectId: registration.id,
        aggregateId: input.eventOccurrenceId,
        metadata: { decision: input.decision, priority: input.priority },
        createdAt: now,
      });
      return "updated" as const;
    });
}

export async function lockAdminEventRegion(
  eventOccurrenceId: string,
  eventOccurrenceRegionId: string,
  actor: AuthenticatedUser,
  source: "manual" | "administrator" = "administrator",
) {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const occurrence = await transaction
        .selectFrom("event_occurrence")
        .select(["registrationClosesAt", "coordinatorLockAt"])
        .where("id", "=", eventOccurrenceId)
        .executeTakeFirst();
      if (!occurrence) return "not-found" as const;
      const region = await transaction
        .selectFrom("event_occurrence_region")
        .select("id")
        .where("id", "=", eventOccurrenceRegionId)
        .where("eventOccurrenceId", "=", eventOccurrenceId)
        .executeTakeFirst();
      if (!region) return "not-found" as const;
      const review = await ensureReviewRound(
        transaction,
        occurrence,
        region.id,
      );
      if (!review) return "invalid-transition" as const;
      if (review.lockedAt) return "locked" as const;
      const now = new Date();
      await transaction
        .updateTable("event_region_review_round")
        .set({
          lockedAt: now,
          lockedByUserId: actor.id,
          lockSource: source,
        })
        .where("id", "=", review.id)
        .execute();
      await recordDurableAuditEvent(transaction, {
        actorUserId: actor.id,
        action: "event_region_review.locked",
        subjectType: "event_region_review_round",
        subjectId: review.id,
        aggregateId: eventOccurrenceId,
        createdAt: now,
      });
      return "locked" as const;
    });
}

export async function decideAdminEventFinalRegistration(
  eventOccurrenceId: string,
  registrationId: string,
  decision: "selected" | "waitlisted" | "not_selected" | "cancelled",
  actor: AuthenticatedUser,
) {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const occurrence = await transaction
        .selectFrom("event_occurrence")
        .selectAll()
        .where("id", "=", eventOccurrenceId)
        .forUpdate()
        .executeTakeFirst();
      const registration = await transaction
        .selectFrom("event_registration")
        .selectAll()
        .where("id", "=", registrationId)
        .where("eventOccurrenceId", "=", eventOccurrenceId)
        .forUpdate()
        .executeTakeFirst();
      if (!occurrence || !registration) return "not-found" as const;
      if (occurrence.status !== "published")
        return "invalid-transition" as const;
      const attendance = await transaction
        .selectFrom("event_participation as participation")
        .innerJoin(
          "event_attendance as attendance",
          "attendance.eventParticipationId",
          "participation.id",
        )
        .select("attendance.state")
        .where("participation.registrationId", "=", registration.id)
        .where("attendance.state", "!=", "not_recorded")
        .executeTakeFirst();
      if (attendance) return "final-decision-locked" as const;
      const wasSelected = registration.status === "selected";
      if (decision === "selected" && !wasSelected) {
        const eligible = registration.reviewRoundId
          ? registration.status === "coordinator_approved"
          : (["submitted", "waitlisted", "not_selected"] as const).includes(
              registration.status as never,
            );
        if (!eligible) return "invalid-transition" as const;
        if (registration.reviewRoundId) {
          const review = await transaction
            .selectFrom("event_region_review_round")
            .select(["lockedAt", "coordinatorLockAt"])
            .where("id", "=", registration.reviewRoundId)
            .executeTakeFirst();
          if (
            !review ||
            (!review.lockedAt && review.coordinatorLockAt > new Date())
          )
            return "invalid-transition" as const;
        }
        if (
          occurrence.registrationMode === "required_restricted" &&
          registration.eligibilitySource !== "administrator_override"
        ) {
          const user = await transaction
            .selectFrom("user")
            .select(["email", "emailVerified"])
            .where("id", "=", registration.userId)
            .executeTakeFirst();
          const domain =
            user?.emailVerified === true ? domainFromEmail(user.email) : null;
          const allowed = domain
            ? await transaction
                .selectFrom("event_occurrence_domain")
                .select("domain")
                .where("eventOccurrenceId", "=", occurrence.id)
                .where("domain", "=", domain)
                .executeTakeFirst()
            : null;
          if (!allowed) return "domain-override-required" as const;
        }
        if (occurrence.confirmedCount >= occurrence.capacity)
          return "capacity-full" as const;
      }
      if (wasSelected !== (decision === "selected"))
        await transaction
          .updateTable("event_occurrence")
          .set({
            confirmedCount: sql<number>`"confirmedCount" + ${decision === "selected" ? 1 : -1}`,
            updatedAt: new Date(),
          })
          .where("id", "=", occurrence.id)
          .execute();
      const now = new Date();
      await transaction
        .updateTable("event_registration")
        .set({
          status: decision,
          finalDecidedAt: now,
          finalDecidedByUserId: actor.id,
          lockedInAt: decision === "selected" ? now : null,
        })
        .where("id", "=", registration.id)
        .execute();
      if (decision === "selected")
        await transaction
          .insertInto("event_participation")
          .values({
            id: `event_participation_${randomUUID()}`,
            eventOccurrenceId,
            userId: registration.userId,
            registrationId: registration.id,
            mode: "registered",
            nameSnapshot: registration.nameSnapshot,
            emailSnapshot: registration.emailSnapshot,
            detailsSubmittedAt: null,
            joinDisclosedAt: null,
            checkedInAt: null,
            createdAt: now,
          })
          .onConflict((conflict) =>
            conflict.column("registrationId").doNothing(),
          )
          .execute();
      await transaction
        .insertInto("event_registration_transition")
        .values({
          id: `event_registration_transition_${randomUUID()}`,
          eventRegistrationId: registration.id,
          fromStatus: registration.status,
          toStatus: decision,
          source: "administrator",
          actorUserId: actor.id,
          priority: registration.coordinatorPriority,
          occurredAt: now,
        })
        .execute();
      await recordDurableAuditEvent(transaction, {
        actorUserId: actor.id,
        action: "event_registration.final_decided",
        subjectType: "event_registration",
        subjectId: registration.id,
        aggregateId: eventOccurrenceId,
        metadata: { decision },
        createdAt: now,
      });
      return "updated" as const;
    });
}

export async function reassignAdminEventRegistrationRegion(
  input: {
    eventOccurrenceId: string;
    registrationId: string;
    eventOccurrenceRegionId: string;
    confirmFinalizedReassignment: boolean;
  },
  actor: AuthenticatedUser,
) {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const occurrence = await transaction
        .selectFrom("event_occurrence")
        .select(["id", "status", "registrationClosesAt", "coordinatorLockAt"])
        .where("id", "=", input.eventOccurrenceId)
        .forUpdate()
        .executeTakeFirst();
      const registration = await transaction
        .selectFrom("event_registration")
        .selectAll()
        .where("id", "=", input.registrationId)
        .where("eventOccurrenceId", "=", input.eventOccurrenceId)
        .forUpdate()
        .executeTakeFirst();
      const destination = await transaction
        .selectFrom("event_occurrence_region")
        .select("id")
        .where("id", "=", input.eventOccurrenceRegionId)
        .where("eventOccurrenceId", "=", input.eventOccurrenceId)
        .where("retiredAt", "is", null)
        .executeTakeFirst();
      if (!occurrence || !registration || !destination) return "not-found";
      if (
        occurrence.status !== "published" ||
        registration.eventOccurrenceRegionId === destination.id ||
        (["withdrawn", "cancelled"] as const).includes(
          registration.status as never,
        )
      )
        return "invalid-transition";

      const finalized =
        registration.finalDecidedAt !== null ||
        (["selected", "waitlisted", "not_selected"] as const).includes(
          registration.status as never,
        );
      if (finalized && !input.confirmFinalizedReassignment)
        return "finalized-confirmation-required";

      const destinationReview = await ensureReviewRound(
        transaction,
        occurrence,
        destination.id,
      );
      if (
        !finalized &&
        destinationReview &&
        (destinationReview.lockedAt ||
          destinationReview.coordinatorLockAt <= new Date())
      )
        return "region-locked";

      const resetCoordinatorDecision =
        registration.coordinatorDecidedAt !== null ||
        registration.coordinatorPriority !== null;
      const nextStatus = finalized ? registration.status : "submitted";
      const now = new Date();
      await transaction
        .updateTable("event_registration")
        .set({
          eventOccurrenceRegionId: destination.id,
          reviewRoundId: destinationReview?.id ?? null,
          status: nextStatus,
          coordinatorPriority: null,
          coordinatorDecidedAt: null,
          coordinatorDecidedByUserId: null,
        })
        .where("id", "=", registration.id)
        .execute();
      await transaction
        .insertInto("event_registration_transition")
        .values({
          id: `event_registration_transition_${randomUUID()}`,
          eventRegistrationId: registration.id,
          fromStatus: registration.status,
          toStatus: nextStatus,
          fromEventOccurrenceRegionId: registration.eventOccurrenceRegionId,
          toEventOccurrenceRegionId: destination.id,
          source: "administrator",
          actorUserId: actor.id,
          priority: registration.coordinatorPriority,
          occurredAt: now,
        })
        .execute();
      await recordDurableAuditEvent(transaction, {
        actorUserId: actor.id,
        action: "event_registration.region_reassigned",
        subjectType: "event_registration",
        subjectId: registration.id,
        aggregateId: occurrence.id,
        metadata: {
          fromEventOccurrenceRegionId: registration.eventOccurrenceRegionId,
          toEventOccurrenceRegionId: destination.id,
          resetCoordinatorDecision,
          finalizedOverride: finalized,
        },
        createdAt: now,
      });
      return "updated";
    });
}

export async function addAdminEventRegistration(
  input: {
    eventOccurrenceId: string;
    name: string;
    email: string;
    eventOccurrenceRegionId: string | null;
    overrideDomainRestriction: boolean;
  },
  actor: AuthenticatedUser,
) {
  try {
    return await getDatabase()
      .transaction()
      .execute(async (transaction) => {
        const occurrence = await transaction
          .selectFrom("event_occurrence")
          .selectAll()
          .where("id", "=", input.eventOccurrenceId)
          .forUpdate()
          .executeTakeFirst();
        if (!occurrence) return "not-found" as const;
        if (
          occurrence.status !== "published" ||
          occurrence.registrationMode === "open_entry"
        )
          return "unavailable" as const;
        const existingUser = await transaction
          .selectFrom("user")
          .select(["id", "name", "email", "emailVerified"])
          .where(
            sql<boolean>`lower(email) = ${normalizeUserEmail(input.email)}`,
          )
          .executeTakeFirst();
        const candidate = existingUser ?? {
          id: null,
          name: input.name.trim(),
          email: normalizeUserEmail(input.email),
          emailVerified: false,
        };
        if (candidate.id) {
          const duplicate = await transaction
            .selectFrom("event_registration")
            .select("id")
            .where("eventOccurrenceId", "=", occurrence.id)
            .where("userId", "=", candidate.id)
            .executeTakeFirst();
          if (duplicate) return "duplicate" as const;
        }
        let eligibilitySource:
          "unrestricted" | "verified_domain" | "administrator_override" =
          "unrestricted";
        if (occurrence.registrationMode === "required_restricted") {
          const domain = candidate.emailVerified
            ? domainFromEmail(candidate.email)
            : null;
          const domainAllowed = domain
            ? await transaction
                .selectFrom("event_occurrence_domain")
                .select("domain")
                .where("eventOccurrenceId", "=", occurrence.id)
                .where("domain", "=", domain)
                .executeTakeFirst()
            : null;
          if (!domainAllowed && !input.overrideDomainRestriction)
            return "override-required" as const;
          eligibilitySource = domainAllowed
            ? "verified_domain"
            : "administrator_override";
        }
        if (input.eventOccurrenceRegionId) {
          const region = await transaction
            .selectFrom("event_occurrence_region")
            .select("id")
            .where("id", "=", input.eventOccurrenceRegionId)
            .where("eventOccurrenceId", "=", occurrence.id)
            .where("retiredAt", "is", null)
            .executeTakeFirst();
          if (!region) return "not-found" as const;
        }
        const now = new Date();
        const id = `event_registration_${randomUUID()}`;
        const user =
          existingUser ??
          (
            await provisionUser(transaction, {
              name: candidate.name,
              email: candidate.email,
              source: "administrator",
              actorUserId: actor.id,
              sourceEventId: id,
              createdAt: now,
            })
          ).user;
        const concurrentDuplicate = await transaction
          .selectFrom("event_registration")
          .select("id")
          .where("eventOccurrenceId", "=", occurrence.id)
          .where("userId", "=", user.id)
          .executeTakeFirst();
        if (concurrentDuplicate)
          throw new Error("CONCURRENT_DUPLICATE_EVENT_REGISTRATION");
        await transaction
          .insertInto("event_registration")
          .values({
            id,
            eventOccurrenceId: occurrence.id,
            userId: user.id,
            eventOccurrenceRegionId: input.eventOccurrenceRegionId,
            reviewRoundId: null,
            nameSnapshot: user.name,
            emailSnapshot: user.email,
            source:
              eligibilitySource === "administrator_override"
                ? "administrator_override"
                : "late_invitation",
            eligibilitySource,
            status: "submitted",
            coordinatorPriority: null,
            submittedAt: now,
            coordinatorDecidedAt: null,
            coordinatorDecidedByUserId: null,
            finalDecidedAt: null,
            finalDecidedByUserId: null,
            lockedInAt: null,
          })
          .execute();
        await transaction
          .insertInto("event_registration_transition")
          .values({
            id: `event_registration_transition_${randomUUID()}`,
            eventRegistrationId: id,
            fromStatus: null,
            toStatus: "submitted",
            source: "administrator",
            actorUserId: actor.id,
            priority: null,
            occurredAt: now,
          })
          .execute();
        await recordDurableAuditEvent(transaction, {
          actorUserId: actor.id,
          action: "event_registration.administrator_added",
          subjectType: "event_registration",
          subjectId: id,
          aggregateId: occurrence.id,
          metadata: { eligibilitySource },
          createdAt: now,
        });
        return "created" as const;
      });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "CONCURRENT_DUPLICATE_EVENT_REGISTRATION"
    )
      return "duplicate" as const;
    throw error;
  }
}

export async function transitionAdminEventOccurrence(
  eventOccurrenceId: string,
  target: "cancelled" | "completed" | "archived",
  actor: AuthenticatedUser,
) {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const occurrence = await transaction
        .selectFrom("event_occurrence")
        .select("status")
        .where("id", "=", eventOccurrenceId)
        .forUpdate()
        .executeTakeFirst();
      if (!occurrence) return "not-found" as const;
      const allowed =
        ((target === "cancelled" || target === "completed") &&
          occurrence.status === "published") ||
        (target === "archived" &&
          (["cancelled", "completed"] as const).includes(
            occurrence.status as never,
          ));
      if (!allowed) return "invalid-transition" as const;
      const now = new Date();
      if (target === "cancelled") {
        const registrations = await transaction
          .selectFrom("event_registration")
          .select(["id", "status", "coordinatorPriority"])
          .where("eventOccurrenceId", "=", eventOccurrenceId)
          .where("status", "not in", ["cancelled", "withdrawn", "not_selected"])
          .execute();
        for (const registration of registrations) {
          await transaction
            .updateTable("event_registration")
            .set({
              status: "cancelled",
              finalDecidedAt: now,
              finalDecidedByUserId: actor.id,
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
              actorUserId: actor.id,
              priority: registration.coordinatorPriority,
              occurredAt: now,
            })
            .execute();
        }
      }
      await transaction
        .updateTable("event_occurrence")
        .set({
          status: target,
          ...(target === "cancelled" ? { confirmedCount: 0 } : {}),
          updatedAt: now,
        })
        .where("id", "=", eventOccurrenceId)
        .execute();
      await recordDurableAuditEvent(transaction, {
        actorUserId: actor.id,
        action: "event_occurrence.lifecycle_changed",
        subjectType: "event_occurrence",
        subjectId: eventOccurrenceId,
        metadata: { fromStatus: occurrence.status, target },
        createdAt: now,
      });
      return "updated" as const;
    });
}
