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
    setupUrl: string;
    createdAt: Date;
  },
): Promise<string> {
  const emailDesignVersion = await transaction
    .selectFrom("email_design")
    .innerJoin(
      "email_design_version",
      "email_design_version.id",
      "email_design.activeVersionId",
    )
    .select("email_design_version.id")
    .where("email_design.systemKey", "=", "account_setup_requested")
    .where("email_design.catalogue", "=", "system")
    .where("email_design_version.publishedAt", "is not", null)
    .executeTakeFirstOrThrow();
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
      emailDesignVersionId: emailDesignVersion.id,
      deduplicationKey: input.deduplicationKey,
      payload: { version: 1, setupUrl: input.setupUrl },
      lastErrorCode: null,
      deliveredAt: null,
      supersededAt: null,
      renderedSubject: null,
      renderedTextBody: null,
      renderedHtmlBody: null,
      renderedAt: null,
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
