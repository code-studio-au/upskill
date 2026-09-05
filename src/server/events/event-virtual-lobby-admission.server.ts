import "@tanstack/react-start/server-only";

import { sql, type Transaction } from "kysely";
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
    source: "automatic_mode_enabled" | "staff_admit_all";
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
  let cursor: { requestedAt: Date; id: string } | null = null;
  let hasMore = true;
  while (hasMore) {
    let query = transaction
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
      .leftJoin("registration_questionnaire_assignment as assignment", (join) =>
        join
          .onRef("assignment.eventOccurrenceId", "=", "lobby.eventOccurrenceId")
          .onRef("assignment.userId", "=", "participation.userId")
          .onRef(
            "assignment.surveyVersionId",
            "=",
            "version.registrationSurveyVersionId",
          ),
      )
      .select([
        "lobby.id",
        "lobby.requestedAt",
        "registration.status as registrationStatus",
        "version.registrationSurveyVersionId",
        "assignment.status as questionnaireStatus",
      ])
      .where("lobby.eventVirtualJoinAccessId", "=", access.id)
      .where("lobby.state", "=", "waiting");
    if (cursor)
      query = query.where(
        sql<boolean>`("lobby"."requestedAt", "lobby"."id") > (${cursor.requestedAt}, ${cursor.id})`,
      );
    const waiting = await query
      .orderBy("lobby.requestedAt")
      .orderBy("lobby.id")
      .limit(500)
      .forUpdate("lobby")
      .execute();
    if (!waiting.length) {
      hasMore = false;
      continue;
    }
    for (const entry of waiting) {
      if (entry.registrationStatus !== "selected") continue;
      if (
        entry.registrationSurveyVersionId &&
        entry.questionnaireStatus !== "completed" &&
        entry.questionnaireStatus !== "waived"
      )
        continue;
      const admitted = await transaction
        .updateTable("event_virtual_lobby_entry")
        .set({
          state: "admitted",
          admittedAt: input.now,
          admittedByUserId: input.actorUserId,
          updatedAt: input.now,
        })
        .where("id", "=", entry.id)
        .where("state", "=", "waiting")
        .returning("id")
        .executeTakeFirst();
      if (!admitted) continue;
      await recordDurableAuditEvent(transaction, {
        actorUserId: input.actorUserId,
        action: "event_virtual_lobby.admission_changed",
        subjectType: "event_virtual_lobby_entry",
        subjectId: entry.id,
        aggregateId: input.eventOccurrenceId,
        metadata: {
          action: "admit",
          eventSessionId: input.eventSessionId,
          source: input.source,
        },
        createdAt: input.now,
      });
    }
    const last = waiting.at(-1);
    hasMore = Boolean(last) && waiting.length === 500;
    if (last) cursor = { requestedAt: last.requestedAt, id: last.id };
  }
}
