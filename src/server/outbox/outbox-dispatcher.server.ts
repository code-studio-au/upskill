import "@tanstack/react-start/server-only";

import {
  AUDIT_LOG_TOPIC,
  parseAuditLogProjection,
} from "#/server/audit/audit-event.server";
import { getDatabase } from "#/server/db/database.server";
import { logAuditEvent } from "#/server/logging/server-logger";
import {
  CERTIFICATE_GENERATION_TOPIC,
  parseContentWorkMessage,
  RESOURCE_DELETION_TOPIC,
  SCORM_DELETION_TOPIC,
  SCORM_INGESTION_TOPIC,
} from "#/server/queue/work-message";
import { sendQueueMessage } from "#/server/queue/sqs.server";

const OUTBOX_LEASE_MILLISECONDS = 15 * 60 * 1_000;
const DEFAULT_OUTBOX_DISPATCH_BATCH_SIZE = 100;

export type OutboxDispatchOutcome =
  | { status: "no-work" }
  | { status: "logged"; eventId: string }
  | { status: "dispatched"; eventId: string; messageId: string }
  | { status: "retry"; eventId: string };

type ProcessedOutboxDispatchOutcome = Exclude<
  OutboxDispatchOutcome,
  { status: "no-work" }
>;

export interface OutboxDispatchBatch {
  outcomes: ProcessedOutboxDispatchOutcome[];
  limitReached: boolean;
}

export async function dispatchNextOutboxEvent(): Promise<OutboxDispatchOutcome> {
  const database = getDatabase();
  const claimed = await database.transaction().execute(async (transaction) => {
    const event = await transaction
      .selectFrom("outbox_event")
      .select(["id", "topic", "aggregateId", "payload", "attempts"])
      .where("topic", "in", [
        AUDIT_LOG_TOPIC,
        CERTIFICATE_GENERATION_TOPIC,
        RESOURCE_DELETION_TOPIC,
        SCORM_INGESTION_TOPIC,
        SCORM_DELETION_TOPIC,
      ])
      .where("processedAt", "is", null)
      .where("availableAt", "<=", new Date())
      .orderBy("createdAt")
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();
    if (!event) return undefined;
    const claimAttempt = event.attempts + 1;
    await transaction
      .updateTable("outbox_event")
      .set({
        attempts: claimAttempt,
        availableAt: new Date(Date.now() + OUTBOX_LEASE_MILLISECONDS),
      })
      .where("id", "=", event.id)
      .executeTakeFirstOrThrow();
    return { ...event, claimAttempt };
  });
  if (!claimed) return { status: "no-work" };

  try {
    if (claimed.topic === AUDIT_LOG_TOPIC) {
      const projection = parseAuditLogProjection(claimed.payload);
      if (projection.aggregateId !== claimed.aggregateId)
        throw new Error("Outbox aggregate and audit projection do not match");
      logAuditEvent({
        event: projection.event,
        fields: {
          eventId: projection.eventId,
          actorUserId: projection.actorUserId,
          entityType: projection.entityType,
          entityId: projection.entityId,
          aggregateId: projection.aggregateId,
          outcome: projection.outcome,
          reasonCode: projection.reasonCode,
          affectedCount: projection.affectedCount,
        },
      });
      await database
        .updateTable("outbox_event")
        .set({ processedAt: new Date() })
        .where("id", "=", claimed.id)
        .where("processedAt", "is", null)
        .where("attempts", "=", claimed.claimAttempt)
        .execute();
      return { status: "logged", eventId: projection.eventId };
    }
    const message = parseContentWorkMessage(
      JSON.stringify({
        version: 1,
        eventId: claimed.id,
        topic: claimed.topic,
        aggregateId: claimed.aggregateId,
        payload: claimed.payload,
      }),
    );
    const subjectId =
      message.topic === CERTIFICATE_GENERATION_TOPIC
        ? message.payload.certificateId
        : message.topic === RESOURCE_DELETION_TOPIC
          ? message.payload.resourceVersionId
          : message.payload.packageVersionId;
    if (subjectId !== claimed.aggregateId)
      throw new Error("Outbox aggregate and work subject do not match");
    const messageId = await sendQueueMessage(JSON.stringify(message));
    await database
      .updateTable("outbox_event")
      .set({ processedAt: new Date() })
      .where("id", "=", claimed.id)
      .where("processedAt", "is", null)
      .where("attempts", "=", claimed.claimAttempt)
      .execute();
    return { status: "dispatched", eventId: claimed.id, messageId };
  } catch {
    const delaySeconds = Math.min(
      30 * 2 ** (claimed.claimAttempt - 1),
      15 * 60,
    );
    await database
      .updateTable("outbox_event")
      .set({ availableAt: new Date(Date.now() + delaySeconds * 1_000) })
      .where("id", "=", claimed.id)
      .where("processedAt", "is", null)
      .where("attempts", "=", claimed.claimAttempt)
      .execute();
    return { status: "retry", eventId: claimed.id };
  }
}

export async function dispatchAvailableOutboxEvents(
  limit = DEFAULT_OUTBOX_DISPATCH_BATCH_SIZE,
): Promise<OutboxDispatchBatch> {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new RangeError(
      "Outbox dispatch batch limit must be a positive integer",
    );

  const outcomes: ProcessedOutboxDispatchOutcome[] = [];
  for (let index = 0; index < limit; index += 1) {
    const outcome = await dispatchNextOutboxEvent();
    if (outcome.status === "no-work") return { outcomes, limitReached: false };
    outcomes.push(outcome);
  }
  return { outcomes, limitReached: true };
}
