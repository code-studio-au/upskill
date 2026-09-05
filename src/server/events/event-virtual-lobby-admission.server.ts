import "@tanstack/react-start/server-only";

import { sql, type Kysely } from "kysely";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { Database } from "#/server/db/types";
import { advanceEventVirtualLobbyRevision } from "./event-virtual-join-access.server";
import { lockVirtualRoomStaffAccess } from "./event-virtual-staff-access.server";

const DEFAULT_ADMISSION_BATCH_SIZE = 100;
const MAXIMUM_ADMISSION_BATCH_SIZE = 500;

interface AdmissionCursor {
  requestedAt: Date;
  id: string;
}

interface AdmissionBatchOutcome {
  admittedCount: number;
  cursor: AdmissionCursor | null;
  hasMore: boolean;
  stopped: boolean;
}

export async function admitEligibleWaitingEntries(
  database: Kysely<Database>,
  input: {
    eventOccurrenceId: string;
    eventSessionId: string;
    roomGeneration: number;
    actorUserId: string;
    now: Date;
    source: "automatic_mode_enabled" | "staff_admit_all";
  },
  options: {
    batchSize?: number;
    clock?: () => Date;
    afterBatch?: (outcome: {
      admittedCount: number;
      hasMore: boolean;
    }) => Promise<void>;
  } = {},
): Promise<void> {
  const batchSize = Math.max(
    1,
    Math.min(
      MAXIMUM_ADMISSION_BATCH_SIZE,
      Math.trunc(options.batchSize ?? DEFAULT_ADMISSION_BATCH_SIZE),
    ),
  );
  let cursor: AdmissionCursor | null = null;
  let hasMore = true;
  while (hasMore) {
    const outcome: AdmissionBatchOutcome = await database
      .transaction()
      .execute(async (transaction) => {
        const occurrence = await transaction
          .selectFrom("event_occurrence")
          .select("status")
          .where("id", "=", input.eventOccurrenceId)
          .forUpdate()
          .executeTakeFirst();
        const session = await transaction
          .selectFrom("event_session")
          .select(["id", "endsAt"])
          .where("id", "=", input.eventSessionId)
          .where("eventOccurrenceId", "=", input.eventOccurrenceId)
          .forUpdate()
          .executeTakeFirst();
        const room = await transaction
          .selectFrom("event_virtual_room")
          .select(["admissionMode", "doorState"])
          .where("eventSessionId", "=", input.eventSessionId)
          .where("generation", "=", input.roomGeneration)
          .where("replacedAt", "is", null)
          .forUpdate()
          .executeTakeFirst();
        const access = await transaction
          .selectFrom("event_virtual_join_access")
          .select("id")
          .where("eventOccurrenceId", "=", input.eventOccurrenceId)
          .where("eventSessionId", "=", input.eventSessionId)
          .where("roomGeneration", "=", input.roomGeneration)
          .where("revokedAt", "is", null)
          .forUpdate()
          .executeTakeFirst();
        if (
          occurrence?.status !== "published" ||
          !session ||
          !room ||
          room.doorState === "ended" ||
          (room.doorState === "scheduled" &&
            session.endsAt <= (options.clock?.() ?? new Date())) ||
          !access ||
          (input.source === "automatic_mode_enabled" &&
            room.admissionMode !== "automatic") ||
          !(await lockVirtualRoomStaffAccess(
            transaction,
            input.eventOccurrenceId,
            input.eventSessionId,
            input.actorUserId,
          ))
        )
          return {
            admittedCount: 0,
            cursor: null,
            hasMore: false,
            stopped: true,
          };

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
          .leftJoin(
            "registration_questionnaire_assignment as assignment",
            (join) =>
              join
                .onRef(
                  "assignment.eventOccurrenceId",
                  "=",
                  "lobby.eventOccurrenceId",
                )
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
          .limit(batchSize)
          .forUpdate("lobby")
          .execute();
        if (!waiting.length)
          return {
            admittedCount: 0,
            cursor: null,
            hasMore: false,
            stopped: false,
          };

        let admittedCount = 0;
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
          admittedCount += 1;
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
        if (admittedCount > 0)
          await advanceEventVirtualLobbyRevision(transaction, access.id);
        const last = waiting.at(-1);
        return {
          admittedCount,
          cursor: last ? { requestedAt: last.requestedAt, id: last.id } : null,
          hasMore: waiting.length === batchSize,
          stopped: false,
        };
      });
    if (outcome.stopped || !outcome.cursor) return;
    await options.afterBatch?.({
      admittedCount: outcome.admittedCount,
      hasMore: outcome.hasMore,
    });
    hasMore = outcome.hasMore;
    cursor = outcome.cursor;
  }
}
