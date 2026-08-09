import "@tanstack/react-start/server-only";

import { getDatabase } from "#/server/db/database.server";
import {
  parseScormWorkMessage,
  SCORM_DELETION_TOPIC,
  SCORM_INGESTION_TOPIC,
} from "#/server/queue/work-message";
import { sendQueueMessage } from "#/server/queue/sqs.server";

const OUTBOX_LEASE_MILLISECONDS = 15 * 60 * 1_000;

export type OutboxDispatchOutcome =
  | { status: "no-work" }
  | { status: "dispatched"; eventId: string; messageId: string }
  | { status: "retry"; eventId: string };

export async function dispatchNextOutboxEvent(): Promise<OutboxDispatchOutcome> {
  const database = getDatabase();
  const claimed = await database.transaction().execute(async (transaction) => {
    const event = await transaction
      .selectFrom("outbox_event")
      .select(["id", "topic", "aggregateId", "payload", "attempts"])
      .where("topic", "in", [SCORM_INGESTION_TOPIC, SCORM_DELETION_TOPIC])
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
    const message = parseScormWorkMessage(
      JSON.stringify({
        version: 1,
        eventId: claimed.id,
        topic: claimed.topic,
        aggregateId: claimed.aggregateId,
        payload: claimed.payload,
      }),
    );
    if (message.payload.packageVersionId !== claimed.aggregateId)
      throw new Error(
        "Outbox aggregate and SCORM package version do not match",
      );
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
