import "@tanstack/react-start/server-only";

import { sql } from "kysely";
import type { AdminEventOccurrenceOperations } from "#/features/admin-event/admin-event-operations.schema";
import { getDatabase } from "#/server/db/database.server";
import { ensureEventGuestAccessRecord } from "#/server/events/event-guest-access.server";
import { getEnabledLiveKitConfiguration } from "#/server/livekit/livekit-provider.server";

export async function findAdminEventOccurrenceOperations(
  eventOccurrenceId: string,
): Promise<AdminEventOccurrenceOperations | null> {
  const database = getDatabase();
  const liveKitConfiguration = getEnabledLiveKitConfiguration();
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
      "version.registrationSurveyVersionId",
      "occurrence.deliveryMode",
      "occurrence.virtualDeliveryProvider",
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
      "occurrence.priceCents",
      "occurrence.salePriceCents",
      "occurrence.currency",
      "occurrence.bulkPricing",
      "occurrence.listInStore",
      "occurrence.featured",
      "occurrence.confirmedCount",
      "occurrence.venueName",
      "occurrence.venueAddress",
      "occurrence.virtualJoinUrl",
      "occurrence.openEntryAttendanceMode",
    ])
    .where("occurrence.id", "=", eventOccurrenceId)
    .executeTakeFirst();
  if (!occurrence) return null;

  const guestAccess =
    occurrence.registrationMode === "open_entry" &&
    occurrence.registrationSurveyVersionId === null
      ? await database
          .transaction()
          .execute(
            async (transaction) =>
              await ensureEventGuestAccessRecord(
                transaction,
                eventOccurrenceId,
                new Date(),
              ),
          )
      : null;

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
    regionDecisionRows,
    invitationRows,
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
      .leftJoin(
        "registration_questionnaire_assignment as registration_assignment",
        (join) =>
          join
            .onRef("registration_assignment.userId", "=", "registration.userId")
            .on(
              "registration_assignment.eventOccurrenceId",
              "=",
              eventOccurrenceId,
            ),
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
        "registration.regionMismatchAcknowledgedProfileRegionId",
        "registration.regionMismatchAcknowledgedAt",
        "registration.regionalReviewWaivedAt",
        "user.accountState",
        "user.setupRequestedAt",
        "registration_assignment.status as registrationQuestionnaireStatus",
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
        "mode",
        "nameSnapshot as name",
        "emailSnapshot as email",
        "detailsSubmittedAt",
        "joinDisclosedAt",
        "checkedInAt",
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
    database
      .selectFrom("event_registration_region_decision as decision")
      .innerJoin(
        "event_registration as registration",
        "registration.id",
        "decision.eventRegistrationId",
      )
      .select([
        "decision.id",
        "decision.eventRegistrationId",
        "decision.resolution",
        "decision.classification",
        "decision.reportingRegionId",
        "decision.reportingRegionCodeSnapshot",
        "decision.reportingRegionNameSnapshot",
        "decision.reportingRegionGroupCodeSnapshot",
        "decision.reportingRegionGroupNameSnapshot",
        "decision.decidedAt",
      ])
      .where("registration.eventOccurrenceId", "=", eventOccurrenceId)
      .where("decision.supersededAt", "is", null)
      .execute(),
    database
      .selectFrom("event_late_registration_invitation as invitation")
      .leftJoin(
        "event_occurrence_region as occurrenceRegion",
        "occurrenceRegion.id",
        "invitation.eventOccurrenceRegionId",
      )
      .leftJoin(
        "coordination_region as region",
        "region.id",
        "occurrenceRegion.regionId",
      )
      .select([
        "invitation.id",
        "invitation.userId",
        "invitation.recipientNameSnapshot as name",
        "invitation.recipientEmailSnapshot as email",
        "region.name as regionName",
        "invitation.createdAt",
        "invitation.expiresAt",
        "invitation.acceptedAt",
        "invitation.revokedAt",
      ])
      .where("invitation.eventOccurrenceId", "=", eventOccurrenceId)
      .orderBy("invitation.createdAt", "desc")
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
  const regionDecisionByRegistration = new Map(
    regionDecisionRows.map((decision) => [
      decision.eventRegistrationId,
      decision,
    ]),
  );
  return {
    liveKit: {
      enabled: liveKitConfiguration !== null,
      approvedMaxParticipants:
        liveKitConfiguration?.approvedMaxParticipants ?? null,
    },
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
    guestAccess: guestAccess
      ? {
          publicReference: guestAccess.publicReference,
          generation: guestAccess.generation,
          createdAt: guestAccess.createdAt.toISOString(),
        }
      : null,
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
    registrations: registrationRows.map((row) => {
      const regionMismatch =
        row.profileRegionId !== row.registeredDirectoryRegionId;
      const retainedReviewMatchesProfile =
        row.regionMismatchAcknowledgedAt !== null &&
        row.regionMismatchAcknowledgedProfileRegionId === row.profileRegionId;
      const regionDecision = regionDecisionByRegistration.get(row.id);
      return {
        ...row,
        registrationQuestionnaireStatus:
          occurrence.registrationSurveyVersionId === null
            ? "not_required"
            : (row.registrationQuestionnaireStatus ?? "not_started"),
        status: row.status,
        submittedAt: row.submittedAt.toISOString(),
        coordinatorDecidedAt: row.coordinatorDecidedAt?.toISOString() ?? null,
        finalDecidedAt: row.finalDecidedAt?.toISOString() ?? null,
        regionalReviewWaivedAt:
          row.regionalReviewWaivedAt?.toISOString() ?? null,
        setupRequestedAt: row.setupRequestedAt?.toISOString() ?? null,
        finalDecisionLocked: participationWithAttendance.has(
          participationByRegistration.get(row.id) ?? "",
        ),
        regionMismatch,
        regionMismatchAcknowledged:
          retainedReviewMatchesProfile ||
          (!regionMismatch && row.regionalReviewWaivedAt !== null),
        regionDecision:
          regionDecision && retainedReviewMatchesProfile
            ? {
                ...regionDecision,
                decidedAt: regionDecision.decidedAt.toISOString(),
              }
            : null,
      };
    }),
    invitations: invitationRows.map((invitation) => ({
      ...invitation,
      createdAt: invitation.createdAt.toISOString(),
      expiresAt: invitation.expiresAt.toISOString(),
      acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
      revokedAt: invitation.revokedAt?.toISOString() ?? null,
      status: invitation.acceptedAt
        ? ("accepted" as const)
        : invitation.revokedAt
          ? ("revoked" as const)
          : invitation.expiresAt <= now
            ? ("expired" as const)
            : ("pending" as const),
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
          mode: participation.mode,
          detailsSubmittedAt:
            participation.detailsSubmittedAt?.toISOString() ?? null,
          joinDisclosedAt: participation.joinDisclosedAt?.toISOString() ?? null,
          checkedInAt: participation.checkedInAt?.toISOString() ?? null,
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

export {
  acknowledgeAdminEventRegistrationRegionMismatch,
  addAdminEventRegistration,
  alignAdminEventRegistrationProfileRegion,
  confirmAdminEventRegistrationRegionGuest,
  decideAdminEventCoordinatorRegistration,
  decideAdminEventFinalRegistration,
  lockAdminEventRegion,
  reassignAdminEventRegistrationRegion,
  recordAdminEventAttendance,
  resendAdminEventAccountSetup,
  setAdminEventGuestAttendanceMode,
  transitionAdminEventOccurrence,
} from "./admin-event-registration-operations.server";
