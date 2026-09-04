import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
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
import { revokeOutstandingEventLateInvitations } from "#/server/events/event-late-registration-invitation.server";
import { endEventVirtualRoomsForOccurrence } from "#/server/events/event-virtual-room.server";
import {
  enqueueEventOccurrenceLifecycleCommunications,
  enqueueRegistrationOutcomeEventCommunications,
  enqueueRegistrationSelectedEventCommunications,
  enqueueRegistrationSubmittedEventCommunications,
  supersedeEventCommunicationSchedules,
} from "#/server/notifications/event-communication-execution.server";
import {
  enqueueRegionalListLockedNotifications,
  supersedeEventOperationalCommunicationSchedules,
} from "#/server/notifications/event-operational-communication.server";
import {
  eventRegistrationQuestionnaireComplete,
  eventRegistrationQuestionnaireSubmittedAt,
} from "#/server/registration/registration-questionnaire-access.server";

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

type RegionDecisionResolution =
  | "registered_region_confirmed"
  | "profile_region_confirmed"
  | "profile_aligned_to_registration"
  | "region_guest_confirmed";
type RegionDecisionClassification =
  "event_region" | "outside_event_region" | "no_region_guest";

async function recordRegistrationRegionDecision(
  transaction: Transaction<Database>,
  input: {
    eventOccurrenceId: string;
    registrationId: string;
    registrationEventOccurrenceRegionId: string | null;
    resolution: RegionDecisionResolution;
    classification: RegionDecisionClassification;
    reportingRegionId: string | null;
    actor: AuthenticatedUser;
    decidedAt: Date;
  },
) {
  const reportingRegion = input.reportingRegionId
    ? await transaction
        .selectFrom("coordination_region as region")
        .leftJoin(
          "coordination_region as parent",
          "parent.id",
          "region.parentId",
        )
        .select([
          "region.id",
          "region.code",
          "region.name",
          "parent.code as groupCode",
          "parent.name as groupName",
        ])
        .where("region.id", "=", input.reportingRegionId)
        .executeTakeFirst()
    : null;
  if (input.reportingRegionId && !reportingRegion)
    throw new Error("Reporting region no longer exists");

  await transaction
    .updateTable("event_registration_region_decision")
    .set({ supersededAt: input.decidedAt })
    .where("eventRegistrationId", "=", input.registrationId)
    .where("supersededAt", "is", null)
    .execute();
  const decisionId = `event_registration_region_decision_${randomUUID()}`;
  await transaction
    .insertInto("event_registration_region_decision")
    .values({
      id: decisionId,
      eventRegistrationId: input.registrationId,
      registrationEventOccurrenceRegionId:
        input.registrationEventOccurrenceRegionId,
      resolution: input.resolution,
      classification: input.classification,
      reportingRegionId: reportingRegion?.id ?? null,
      reportingRegionCodeSnapshot: reportingRegion?.code ?? null,
      reportingRegionNameSnapshot: reportingRegion?.name ?? null,
      reportingRegionGroupCodeSnapshot: reportingRegion?.groupCode ?? null,
      reportingRegionGroupNameSnapshot: reportingRegion?.groupName ?? null,
      decidedByUserId: input.actor.id,
      decidedAt: input.decidedAt,
      supersededAt: null,
    })
    .execute();
  await recordDurableAuditEvent(transaction, {
    actorUserId: input.actor.id,
    action: "event_registration.region_decided",
    subjectType: "event_registration",
    subjectId: input.registrationId,
    aggregateId: input.eventOccurrenceId,
    metadata: {
      decisionId,
      resolution: input.resolution,
      classification: input.classification,
      reportingRegionId: input.reportingRegionId,
      registrationEventOccurrenceRegionId:
        input.registrationEventOccurrenceRegionId,
    },
    createdAt: input.decidedAt,
  });
}

export async function setAdminEventGuestAttendanceMode(
  eventOccurrenceId: string,
  mode: "checked_in" | "attended",
  actor: AuthenticatedUser,
): Promise<"updated" | "not-found"> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const updated = await transaction
        .updateTable("event_occurrence")
        .set({ openEntryAttendanceMode: mode, updatedAt: new Date() })
        .where("id", "=", eventOccurrenceId)
        .where("registrationMode", "=", "open_entry")
        .returning("id")
        .executeTakeFirst();
      if (!updated) return "not-found" as const;
      await recordDurableAuditEvent(transaction, {
        actorUserId: actor.id,
        action: "event_occurrence.updated",
        subjectType: "event_occurrence",
        subjectId: eventOccurrenceId,
        metadata: { openEntryAttendanceMode: mode },
        createdAt: new Date(),
      });
      return "updated" as const;
    });
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
        {
          eventParticipationId: input.eventParticipationId,
          source: "attendance",
        },
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
      if (
        !(await eventRegistrationQuestionnaireComplete(
          transaction,
          input.eventOccurrenceId,
          registration.userId,
        ))
      )
        return "invalid-transition" as const;
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
      await enqueueRegionalListLockedNotifications(transaction, {
        eventOccurrenceId,
        eventRegionReviewRoundId: review.id,
        lockedAt: now,
        lockSource: source,
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
      if (registration.status === decision) return "unchanged" as const;
      if (
        decision !== "cancelled" &&
        !(await eventRegistrationQuestionnaireComplete(
          transaction,
          eventOccurrenceId,
          registration.userId,
        ))
      )
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
      if (decision === "selected") {
        const detailsSubmittedAt =
          await eventRegistrationQuestionnaireSubmittedAt(
            transaction,
            eventOccurrenceId,
            registration.userId,
          );
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
            detailsSubmittedAt,
            joinDisclosedAt: null,
            checkedInAt: null,
            createdAt: now,
          })
          .onConflict((conflict) =>
            conflict.column("registrationId").doNothing(),
          )
          .execute();
      }
      const transitionId = `event_registration_transition_${randomUUID()}`;
      await transaction
        .insertInto("event_registration_transition")
        .values({
          id: transitionId,
          eventRegistrationId: registration.id,
          fromStatus: registration.status,
          toStatus: decision,
          source: "administrator",
          actorUserId: actor.id,
          priority: registration.coordinatorPriority,
          occurredAt: now,
        })
        .execute();
      if (decision === "selected" && !wasSelected)
        await enqueueRegistrationSelectedEventCommunications(transaction, {
          eventOccurrenceId,
          eventRegistrationId: registration.id,
          triggerEventId: transitionId,
          createdAt: now,
        });
      else if (decision !== "selected")
        await enqueueRegistrationOutcomeEventCommunications(transaction, {
          eventOccurrenceId,
          eventRegistrationId: registration.id,
          triggerEventId: transitionId,
          outcome: decision,
          createdAt: now,
        });
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
    confirmLockedDestinationReassignment: boolean;
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
        .selectFrom("event_registration as registration")
        .innerJoin("user", "user.id", "registration.userId")
        .selectAll("registration")
        .select("user.currentRegionId as profileRegionId")
        .where("registration.id", "=", input.registrationId)
        .where("registration.eventOccurrenceId", "=", input.eventOccurrenceId)
        .forUpdate("registration")
        .executeTakeFirst();
      const destination = await transaction
        .selectFrom("event_occurrence_region")
        .select(["id", "regionId"])
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
      const destinationLocked = Boolean(
        destinationReview &&
        (destinationReview.lockedAt ||
          destinationReview.coordinatorLockAt <= new Date()),
      );
      if (
        !finalized &&
        destinationLocked &&
        !input.confirmLockedDestinationReassignment
      )
        return "locked-destination-confirmation-required" as const;

      const resetCoordinatorDecision =
        registration.coordinatorDecidedAt !== null ||
        registration.coordinatorPriority !== null;
      const nextStatus = finalized ? registration.status : "submitted";
      const now = new Date();
      const regionalReviewWaived = !finalized && destinationLocked;
      const profileRegionConfirmed =
        destination.regionId === registration.profileRegionId;
      await transaction
        .updateTable("event_registration")
        .set({
          eventOccurrenceRegionId: destination.id,
          reviewRoundId: regionalReviewWaived
            ? null
            : (destinationReview?.id ?? null),
          status: nextStatus,
          coordinatorPriority: null,
          coordinatorDecidedAt: null,
          coordinatorDecidedByUserId: null,
          regionMismatchAcknowledgedProfileRegionId: profileRegionConfirmed
            ? registration.profileRegionId
            : null,
          regionMismatchAcknowledgedAt: profileRegionConfirmed ? now : null,
          regionMismatchAcknowledgedByUserId: profileRegionConfirmed
            ? actor.id
            : null,
          regionalReviewWaivedAt: regionalReviewWaived ? now : null,
          regionalReviewWaivedByUserId: regionalReviewWaived ? actor.id : null,
        })
        .where("id", "=", registration.id)
        .execute();
      await recordRegistrationRegionDecision(transaction, {
        eventOccurrenceId: occurrence.id,
        registrationId: registration.id,
        registrationEventOccurrenceRegionId: destination.id,
        resolution: profileRegionConfirmed
          ? "profile_region_confirmed"
          : "registered_region_confirmed",
        classification: "event_region",
        reportingRegionId: destination.regionId,
        actor,
        decidedAt: now,
      });
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
          regionalReviewWaived,
          profileRegionConfirmed,
        },
        createdAt: now,
      });
      return "updated";
    });
}

export async function alignAdminEventRegistrationProfileRegion(
  eventOccurrenceId: string,
  registrationId: string,
  actor: AuthenticatedUser,
) {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const registration = await transaction
        .selectFrom("event_registration as registration")
        .innerJoin(
          "event_occurrence as occurrence",
          "occurrence.id",
          "registration.eventOccurrenceId",
        )
        .innerJoin(
          "event_occurrence_region as occurrenceRegion",
          "occurrenceRegion.id",
          "registration.eventOccurrenceRegionId",
        )
        .innerJoin("user", "user.id", "registration.userId")
        .select([
          "registration.id",
          "registration.userId",
          "registration.eventOccurrenceRegionId",
          "occurrence.status as occurrenceStatus",
          "occurrenceRegion.regionId as registeredRegionId",
          "user.currentRegionId as profileRegionId",
        ])
        .where("registration.id", "=", registrationId)
        .where("registration.eventOccurrenceId", "=", eventOccurrenceId)
        .forUpdate(["registration", "user"])
        .executeTakeFirst();
      if (!registration) return "not-found" as const;
      if (registration.occurrenceStatus !== "published")
        return "invalid-transition" as const;
      if (registration.profileRegionId === registration.registeredRegionId)
        return "no-mismatch" as const;

      const now = new Date();
      await transaction
        .updateTable("user")
        .set({ currentRegionId: registration.registeredRegionId })
        .where("id", "=", registration.userId)
        .execute();
      await transaction
        .updateTable("event_registration")
        .set({
          regionMismatchAcknowledgedProfileRegionId:
            registration.registeredRegionId,
          regionMismatchAcknowledgedAt: now,
          regionMismatchAcknowledgedByUserId: actor.id,
        })
        .where("id", "=", registration.id)
        .execute();
      await recordRegistrationRegionDecision(transaction, {
        eventOccurrenceId,
        registrationId: registration.id,
        registrationEventOccurrenceRegionId:
          registration.eventOccurrenceRegionId,
        resolution: "profile_aligned_to_registration",
        classification: "event_region",
        reportingRegionId: registration.registeredRegionId,
        actor,
        decidedAt: now,
      });
      await recordDurableAuditEvent(transaction, {
        actorUserId: actor.id,
        action: "user.region_updated",
        subjectType: "user",
        subjectId: registration.userId,
        aggregateId: eventOccurrenceId,
        metadata: {
          fromRegionId: registration.profileRegionId,
          toRegionId: registration.registeredRegionId,
          eventRegistrationId: registration.id,
        },
        createdAt: now,
      });
      await recordDurableAuditEvent(transaction, {
        actorUserId: actor.id,
        action: "event_registration.region_mismatch_acknowledged",
        subjectType: "event_registration",
        subjectId: registration.id,
        aggregateId: eventOccurrenceId,
        metadata: {
          decision: "profile_aligned_to_registration",
          profileRegionId: registration.registeredRegionId,
        },
        createdAt: now,
      });
      return "updated" as const;
    });
}

export async function confirmAdminEventRegistrationRegionGuest(
  eventOccurrenceId: string,
  registrationId: string,
  actor: AuthenticatedUser,
) {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const registration = await transaction
        .selectFrom("event_registration as registration")
        .innerJoin(
          "event_occurrence as occurrence",
          "occurrence.id",
          "registration.eventOccurrenceId",
        )
        .innerJoin("user", "user.id", "registration.userId")
        .select([
          "registration.id",
          "registration.eventOccurrenceRegionId",
          "occurrence.status as occurrenceStatus",
          "user.currentRegionId as profileRegionId",
        ])
        .where("registration.id", "=", registrationId)
        .where("registration.eventOccurrenceId", "=", eventOccurrenceId)
        .forUpdate("registration")
        .executeTakeFirst();
      if (!registration) return "not-found" as const;
      if (registration.occurrenceStatus !== "published")
        return "invalid-transition" as const;

      const profileRegionInEvent = registration.profileRegionId
        ? await transaction
            .selectFrom("event_occurrence_region")
            .select("id")
            .where("eventOccurrenceId", "=", eventOccurrenceId)
            .where("regionId", "=", registration.profileRegionId)
            .where("retiredAt", "is", null)
            .executeTakeFirst()
        : null;
      if (profileRegionInEvent) return "no-mismatch" as const;

      const now = new Date();
      await transaction
        .updateTable("event_registration")
        .set({
          regionMismatchAcknowledgedProfileRegionId:
            registration.profileRegionId,
          regionMismatchAcknowledgedAt: now,
          regionMismatchAcknowledgedByUserId: actor.id,
        })
        .where("id", "=", registration.id)
        .execute();
      await recordRegistrationRegionDecision(transaction, {
        eventOccurrenceId,
        registrationId: registration.id,
        registrationEventOccurrenceRegionId:
          registration.eventOccurrenceRegionId,
        resolution: "region_guest_confirmed",
        classification: registration.profileRegionId
          ? "outside_event_region"
          : "no_region_guest",
        reportingRegionId: registration.profileRegionId,
        actor,
        decidedAt: now,
      });
      return "updated" as const;
    });
}

export async function acknowledgeAdminEventRegistrationRegionMismatch(
  eventOccurrenceId: string,
  registrationId: string,
  actor: AuthenticatedUser,
) {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const registration = await transaction
        .selectFrom("event_registration as registration")
        .innerJoin(
          "event_occurrence as occurrence",
          "occurrence.id",
          "registration.eventOccurrenceId",
        )
        .select([
          "registration.id",
          "registration.userId",
          "registration.eventOccurrenceRegionId",
          "occurrence.status as occurrenceStatus",
        ])
        .where("registration.id", "=", registrationId)
        .where("registration.eventOccurrenceId", "=", eventOccurrenceId)
        .forUpdate("registration")
        .executeTakeFirst();
      if (!registration) return "not-found" as const;
      if (registration.occurrenceStatus !== "published")
        return "invalid-transition" as const;
      const [user, registeredRegion] = await Promise.all([
        transaction
          .selectFrom("user")
          .select("currentRegionId")
          .where("id", "=", registration.userId)
          .executeTakeFirstOrThrow(),
        registration.eventOccurrenceRegionId
          ? transaction
              .selectFrom("event_occurrence_region")
              .select("regionId")
              .where("id", "=", registration.eventOccurrenceRegionId)
              .executeTakeFirst()
          : Promise.resolve(undefined),
      ]);
      const registeredRegionId = registeredRegion?.regionId ?? null;
      if (user.currentRegionId === registeredRegionId)
        return "no-mismatch" as const;
      const now = new Date();
      await transaction
        .updateTable("event_registration")
        .set({
          regionMismatchAcknowledgedProfileRegionId: user.currentRegionId,
          regionMismatchAcknowledgedAt: now,
          regionMismatchAcknowledgedByUserId: actor.id,
        })
        .where("id", "=", registration.id)
        .execute();
      await recordRegistrationRegionDecision(transaction, {
        eventOccurrenceId,
        registrationId: registration.id,
        registrationEventOccurrenceRegionId:
          registration.eventOccurrenceRegionId,
        resolution: "registered_region_confirmed",
        classification: registeredRegionId ? "event_region" : "no_region_guest",
        reportingRegionId: registeredRegionId,
        actor,
        decidedAt: now,
      });
      await recordDurableAuditEvent(transaction, {
        actorUserId: actor.id,
        action: "event_registration.region_mismatch_acknowledged",
        subjectType: "event_registration",
        subjectId: registration.id,
        aggregateId: eventOccurrenceId,
        metadata: {
          registeredRegionId,
          profileRegionId: user.currentRegionId,
        },
        createdAt: now,
      });
      return "updated" as const;
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
        const transitionId = `event_registration_transition_${randomUUID()}`;
        await transaction
          .insertInto("event_registration_transition")
          .values({
            id: transitionId,
            eventRegistrationId: id,
            fromStatus: null,
            toStatus: "submitted",
            source: "administrator",
            actorUserId: actor.id,
            priority: null,
            occurredAt: now,
          })
          .execute();
        await enqueueRegistrationSubmittedEventCommunications(transaction, {
          eventOccurrenceId: occurrence.id,
          eventRegistrationId: id,
          triggerEventId: transitionId,
          createdAt: now,
        });
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
  now = new Date(),
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
      if (target === "cancelled") {
        await revokeOutstandingEventLateInvitations(
          transaction,
          eventOccurrenceId,
          actor,
          now,
        );
        await enqueueEventOccurrenceLifecycleCommunications(transaction, {
          eventOccurrenceId,
          triggerEventId: `event-cancelled:${eventOccurrenceId}:${now.toISOString()}`,
          trigger: "event_cancelled",
          anchorAt: now,
          createdAt: now,
        });
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
      if (target === "cancelled" || target === "completed")
        await endEventVirtualRoomsForOccurrence(
          transaction,
          eventOccurrenceId,
          actor.id,
          now,
        );
      if (target === "cancelled" || target === "archived")
        await supersedeEventCommunicationSchedules(
          transaction,
          eventOccurrenceId,
          now,
        );
      await supersedeEventOperationalCommunicationSchedules(
        transaction,
        eventOccurrenceId,
        now,
      );
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
