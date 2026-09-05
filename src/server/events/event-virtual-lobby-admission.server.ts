import "@tanstack/react-start/server-only";

import type { Transaction } from "kysely";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { Database } from "#/server/db/types";

export async function admitEligibleWaitingEntries(
  transaction: Transaction<Database>,
  input: {
    eventOccurrenceId: string;
    eventSessionId: string;
    roomGeneration: number;
    actorUserId: string;
    now: Date;
  },
): Promise<void> {
  const access = await transaction
    .selectFrom("event_virtual_join_access")
    .select("id")
    .where("eventOccurrenceId", "=", input.eventOccurrenceId)
    .where("eventSessionId", "=", input.eventSessionId)
    .where("roomGeneration", "=", input.roomGeneration)
    .where("revokedAt", "is", null)
    .executeTakeFirst();
  if (!access) return;
  const waiting = await transaction
    .selectFrom("event_virtual_lobby_entry as lobby")
    .innerJoin(
      "event_participation as participation",
      "participation.id",
      "lobby.eventParticipationId",
    )
    .innerJoin(
      "event_registration as registration",
      "registration.id",
      "participation.registrationId",
    )
    .innerJoin(
      "event_occurrence as occurrence",
      "occurrence.id",
      "lobby.eventOccurrenceId",
    )
    .innerJoin(
      "event_template_version as version",
      "version.id",
      "occurrence.eventTemplateVersionId",
    )
    .select([
      "lobby.id",
      "participation.userId",
      "registration.status as registrationStatus",
      "version.registrationSurveyVersionId",
    ])
    .where("lobby.eventVirtualJoinAccessId", "=", access.id)
    .where("lobby.state", "=", "waiting")
    .orderBy("lobby.requestedAt")
    .limit(500)
    .forUpdate("lobby")
    .execute();
  for (const entry of waiting) {
    if (entry.registrationStatus !== "selected") continue;
    if (entry.registrationSurveyVersionId) {
      const assignment = await transaction
        .selectFrom("registration_questionnaire_assignment")
        .select("status")
        .where("eventOccurrenceId", "=", input.eventOccurrenceId)
        .where("userId", "=", entry.userId)
        .where("surveyVersionId", "=", entry.registrationSurveyVersionId)
        .executeTakeFirst();
      if (assignment?.status !== "completed" && assignment?.status !== "waived")
        continue;
    }
    await transaction
      .updateTable("event_virtual_lobby_entry")
      .set({
        state: "admitted",
        admittedAt: input.now,
        admittedByUserId: input.actorUserId,
        updatedAt: input.now,
      })
      .where("id", "=", entry.id)
      .where("state", "=", "waiting")
      .execute();
    await recordDurableAuditEvent(transaction, {
      actorUserId: input.actorUserId,
      action: "event_virtual_lobby.admission_changed",
      subjectType: "event_virtual_lobby_entry",
      subjectId: entry.id,
      aggregateId: input.eventOccurrenceId,
      metadata: {
        action: "admit",
        eventSessionId: input.eventSessionId,
        source: "automatic_mode_enabled",
      },
      createdAt: input.now,
    });
  }
}
