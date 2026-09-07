import "@tanstack/react-start/server-only";

import { sql, type Kysely } from "kysely";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { Database } from "#/server/db/types";
import { advanceEventVirtualLobbyRevision } from "./event-virtual-join-access.server";
import { lockEventVirtualAdmissionEligibility } from "./event-virtual-lobby-eligibility.server";
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
        const batchNow = options.clock?.() ?? new Date();
        const occurrence = await transaction
          .selectFrom("event_occurrence")
          .select(["status", "eventTemplateVersionId"])
          .where("id", "=", input.eventOccurrenceId)
          .forUpdate()
          .executeTakeFirst();
        const session = await transaction
          .selectFrom("event_session")
          .select(["id", "endsAt", "livekitOpenEntryGuestsAllowed"])
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
          (room.doorState === "scheduled" && session.endsAt <= batchNow) ||
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

        const version = await transaction
          .selectFrom("event_template_version")
          .select("registrationSurveyVersionId")
          .where("id", "=", occurrence.eventTemplateVersionId)
          .executeTakeFirst();
        if (!version)
          return {
            admittedCount: 0,
            cursor: null,
            hasMore: false,
            stopped: true,
          };

        let query = transaction
          .selectFrom("event_virtual_lobby_entry as lobby")
          .select([
            "lobby.id",
            "lobby.requestedAt",
            "lobby.eventParticipationId",
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
          if (
            !(await lockEventVirtualAdmissionEligibility(transaction, {
              eventOccurrenceId: input.eventOccurrenceId,
              eventParticipationId: entry.eventParticipationId,
              registrationSurveyVersionId: version.registrationSurveyVersionId,
              openEntryGuestsAllowed:
                session.livekitOpenEntryGuestsAllowed === true,
            }))
          )
            continue;
          const lockedEntry = await transaction
            .selectFrom("event_virtual_lobby_entry")
            .select("state")
            .where("id", "=", entry.id)
            .where("eventVirtualJoinAccessId", "=", access.id)
            .forUpdate()
            .executeTakeFirst();
          if (lockedEntry?.state !== "waiting") continue;
          const admittedAt = new Date(
            Math.max(batchNow.getTime(), entry.requestedAt.getTime()),
          );
          const admitted = await transaction
            .updateTable("event_virtual_lobby_entry")
            .set({
              state: "admitted",
              admittedAt,
              admittedByUserId: input.actorUserId,
              updatedAt: admittedAt,
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
            createdAt: admittedAt,
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
