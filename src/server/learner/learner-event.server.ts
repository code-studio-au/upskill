import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import {
  enqueueRegistrationSelectedEventCommunications,
  enqueueRegistrationSubmittedEventCommunications,
} from "#/server/notifications/event-communication-execution.server";

function emailDomain(email: string): string | null {
  const separator = email.lastIndexOf("@");
  if (separator <= 0 || separator === email.length - 1) return null;
  return email.slice(separator + 1).toLocaleLowerCase("en-AU");
}

export async function registerLearnerForEvent(
  eventOccurrenceId: string,
  eventOccurrenceRegionId: string | null,
  user: AuthenticatedUser,
): Promise<
  | { status: "registered"; registrationStatus: "submitted" | "selected" }
  | { status: "already-registered" }
  | { status: "questionnaire-required" }
  | { status: "unavailable" }
  | { status: "ineligible" }
> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const occurrence = await transaction
        .selectFrom("event_occurrence")
        .innerJoin(
          "event_template_version",
          "event_template_version.id",
          "event_occurrence.eventTemplateVersionId",
        )
        .select([
          "event_occurrence.status",
          "event_occurrence.registrationMode",
          "event_occurrence.approvalMode",
          "event_occurrence.registrationOpensAt",
          "event_occurrence.registrationClosesAt",
          "event_occurrence.coordinatorLockAt",
          "event_occurrence.capacity",
          "event_occurrence.confirmedCount",
          "event_template_version.registrationSurveyVersionId",
        ])
        .where("event_occurrence.id", "=", eventOccurrenceId)
        .forUpdate("event_occurrence")
        .executeTakeFirst();
      if (
        !occurrence ||
        occurrence.status !== "published" ||
        occurrence.registrationMode === "open_entry" ||
        occurrence.registrationMode === "paid_entry"
      )
        return { status: "unavailable" } as const;

      if (occurrence.registrationSurveyVersionId) {
        const questionnaire = await transaction
          .selectFrom("registration_questionnaire_assignment")
          .select("status")
          .where("eventOccurrenceId", "=", eventOccurrenceId)
          .where("userId", "=", user.id)
          .executeTakeFirst();
        if (
          questionnaire?.status !== "completed" &&
          questionnaire?.status !== "waived"
        )
          return { status: "questionnaire-required" } as const;
      }

      const existing = await transaction
        .selectFrom("event_registration")
        .select("id")
        .where("eventOccurrenceId", "=", eventOccurrenceId)
        .where("userId", "=", user.id)
        .executeTakeFirst();
      if (existing) return { status: "already-registered" } as const;

      const now = new Date();
      if (
        !occurrence.registrationOpensAt ||
        !occurrence.registrationClosesAt ||
        occurrence.registrationOpensAt > now ||
        occurrence.registrationClosesAt <= now
      )
        return { status: "unavailable" } as const;

      let eligibilitySource: "unrestricted" | "verified_domain" =
        "unrestricted";
      if (occurrence.registrationMode === "required_restricted") {
        const domain = user.emailVerified ? emailDomain(user.email) : null;
        if (!domain) return { status: "ineligible" } as const;
        const permitted = await transaction
          .selectFrom("event_occurrence_domain")
          .select("domain")
          .where("eventOccurrenceId", "=", eventOccurrenceId)
          .where("domain", "=", domain)
          .executeTakeFirst();
        if (!permitted) return { status: "ineligible" } as const;
        eligibilitySource = "verified_domain";
      }

      const occurrenceRegions = await transaction
        .selectFrom("event_occurrence_region")
        .select("id")
        .where("eventOccurrenceId", "=", eventOccurrenceId)
        .where("retiredAt", "is", null)
        .execute();
      if (
        (occurrenceRegions.length > 0 && !eventOccurrenceRegionId) ||
        (eventOccurrenceRegionId &&
          !occurrenceRegions.some(
            (region) => region.id === eventOccurrenceRegionId,
          ))
      )
        return { status: "unavailable" } as const;

      let reviewRoundId: string | null = null;
      if (
        eventOccurrenceRegionId &&
        occurrence.approvalMode === "manual" &&
        occurrence.coordinatorLockAt
      ) {
        if (occurrence.coordinatorLockAt <= now)
          return { status: "unavailable" } as const;
        await sql`select pg_advisory_xact_lock(hashtext(${eventOccurrenceRegionId}))`.execute(
          transaction,
        );
        const existingRound = await transaction
          .selectFrom("event_region_review_round")
          .select(["id", "coordinatorLockAt", "lockedAt"])
          .where("eventOccurrenceRegionId", "=", eventOccurrenceRegionId)
          .orderBy("round", "desc")
          .executeTakeFirst();
        if (
          existingRound &&
          (existingRound.lockedAt || existingRound.coordinatorLockAt <= now)
        )
          return { status: "unavailable" } as const;
        reviewRoundId =
          existingRound?.id ?? `event_region_review_round_${randomUUID()}`;
        if (!existingRound)
          await transaction
            .insertInto("event_region_review_round")
            .values({
              id: reviewRoundId,
              eventOccurrenceRegionId,
              round: 1,
              registrationClosesAt: occurrence.registrationClosesAt,
              coordinatorLockAt: occurrence.coordinatorLockAt,
              lockedAt: null,
              lockedByUserId: null,
              lockSource: null,
            })
            .execute();
      }

      const automaticallySelected = occurrence.approvalMode === "automatic";
      if (
        automaticallySelected &&
        occurrence.confirmedCount >= occurrence.capacity
      )
        return { status: "unavailable" } as const;

      const registrationId = `event_registration_${randomUUID()}`;
      const registrationStatus = automaticallySelected
        ? "selected"
        : "submitted";
      await transaction
        .insertInto("event_registration")
        .values({
          id: registrationId,
          eventOccurrenceId,
          userId: user.id,
          eventOccurrenceRegionId,
          reviewRoundId,
          nameSnapshot: user.name,
          emailSnapshot: user.email,
          source: "ordinary",
          eligibilitySource,
          status: registrationStatus,
          coordinatorPriority: null,
          submittedAt: now,
          coordinatorDecidedAt: null,
          coordinatorDecidedByUserId: null,
          finalDecidedAt: automaticallySelected ? now : null,
          finalDecidedByUserId: null,
          lockedInAt: automaticallySelected ? now : null,
        })
        .execute();

      const transitionId = `event_registration_transition_${randomUUID()}`;
      await transaction
        .insertInto("event_registration_transition")
        .values({
          id: transitionId,
          eventRegistrationId: registrationId,
          fromStatus: null,
          toStatus: registrationStatus,
          source: automaticallySelected ? "automatic" : "learner",
          actorUserId: user.id,
          priority: null,
          occurredAt: now,
        })
        .execute();

      await enqueueRegistrationSubmittedEventCommunications(transaction, {
        eventOccurrenceId,
        eventRegistrationId: registrationId,
        triggerEventId: transitionId,
        createdAt: now,
      });

      if (automaticallySelected) {
        await transaction
          .updateTable("event_occurrence")
          .set({
            confirmedCount: sql<number>`"confirmedCount" + 1`,
            updatedAt: now,
          })
          .where("id", "=", eventOccurrenceId)
          .execute();
        await transaction
          .insertInto("event_participation")
          .values({
            id: `event_participation_${randomUUID()}`,
            eventOccurrenceId,
            userId: user.id,
            registrationId,
            mode: "registered",
            nameSnapshot: user.name,
            emailSnapshot: user.email,
            detailsSubmittedAt: occurrence.registrationSurveyVersionId
              ? now
              : null,
            joinDisclosedAt: null,
            checkedInAt: null,
            createdAt: now,
          })
          .execute();
        await enqueueRegistrationSelectedEventCommunications(transaction, {
          eventOccurrenceId,
          eventRegistrationId: registrationId,
          triggerEventId: transitionId,
          createdAt: now,
        });
      }

      await recordDurableAuditEvent(transaction, {
        actorUserId: user.id,
        action: "event_registration.submitted",
        subjectType: "event_registration",
        subjectId: registrationId,
        aggregateId: eventOccurrenceId,
        metadata: { registrationStatus, eligibilitySource },
        createdAt: now,
      });
      return { status: "registered", registrationStatus } as const;
    });
}

export async function withdrawLearnerEventRegistration(
  eventOccurrenceId: string,
  user: AuthenticatedUser,
): Promise<"withdrawn" | "not-found" | "unavailable"> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const occurrence = await transaction
        .selectFrom("event_occurrence")
        .select(["status", "endsAt"])
        .where("id", "=", eventOccurrenceId)
        .forUpdate()
        .executeTakeFirst();
      if (!occurrence) return "not-found" as const;
      const registration = await transaction
        .selectFrom("event_registration")
        .selectAll()
        .where("eventOccurrenceId", "=", eventOccurrenceId)
        .where("userId", "=", user.id)
        .forUpdate()
        .executeTakeFirst();
      if (!registration) return "not-found" as const;
      const now = new Date();
      if (occurrence.status !== "published" || occurrence.endsAt <= now)
        return "unavailable" as const;
      if (
        (["withdrawn", "cancelled", "not_selected"] as const).includes(
          registration.status as never,
        )
      )
        return "unavailable" as const;
      if (registration.status === "selected")
        await transaction
          .updateTable("event_occurrence")
          .set({
            confirmedCount: sql<number>`greatest(0, "confirmedCount" - 1)`,
            updatedAt: now,
          })
          .where("id", "=", eventOccurrenceId)
          .execute();
      await transaction
        .updateTable("event_registration")
        .set({
          status: "withdrawn",
          finalDecidedAt: now,
          finalDecidedByUserId: user.id,
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
          toStatus: "withdrawn",
          source: "learner",
          actorUserId: user.id,
          priority: registration.coordinatorPriority,
          occurredAt: now,
        })
        .execute();
      await recordDurableAuditEvent(transaction, {
        actorUserId: user.id,
        action: "event_registration.withdrawn",
        subjectType: "event_registration",
        subjectId: registration.id,
        aggregateId: eventOccurrenceId,
        createdAt: now,
      });
      return "withdrawn" as const;
    });
}
