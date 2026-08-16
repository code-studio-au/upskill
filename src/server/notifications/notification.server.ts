import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import type { Database } from "#/server/db/types";
import { NOTIFICATION_DELIVERY_TOPIC } from "#/server/queue/work-message";

export async function enqueueAccountSetupNotification(
  transaction: Transaction<Database>,
  input: {
    userId: string;
    name: string;
    email: string;
    deduplicationKey: string;
    createdAt: Date;
  },
): Promise<string> {
  const notificationId = `notification_${randomUUID()}`;
  const notification = await transaction
    .insertInto("notification")
    .values({
      id: notificationId,
      channel: "email",
      templateKey: "account_setup_requested",
      recipientUserId: input.userId,
      recipientName: input.name,
      recipientEmail: input.email,
      deduplicationKey: input.deduplicationKey,
      payload: { version: 1 },
      lastErrorCode: null,
      deliveredAt: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    })
    .onConflict((conflict) => conflict.column("deduplicationKey").doNothing())
    .returning("id")
    .executeTakeFirst();
  if (!notification) {
    const existing = await transaction
      .selectFrom("notification")
      .select("id")
      .where("deduplicationKey", "=", input.deduplicationKey)
      .executeTakeFirstOrThrow();
    return existing.id;
  }
  await transaction
    .insertInto("outbox_event")
    .values({
      id: `outbox_${randomUUID()}`,
      topic: NOTIFICATION_DELIVERY_TOPIC,
      aggregateId: notification.id,
      payload: { notificationId: notification.id },
      availableAt: input.createdAt,
      processedAt: null,
      createdAt: input.createdAt,
    })
    .execute();
  return notification.id;
}
