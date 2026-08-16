import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import { getEmailProvider } from "./email-provider.server";

export type NotificationDeliveryOutcome =
  { status: "delivered" } | { status: "already-delivered" };

function safeErrorCode(error: unknown): string {
  if (
    error instanceof Error &&
    error.message === "EMAIL_PROVIDER_NOT_CONFIGURED"
  )
    return error.message;
  return "EMAIL_DELIVERY_FAILED";
}

export async function deliverNotification(
  notificationId: string,
): Promise<NotificationDeliveryOutcome> {
  const database = getDatabase();
  const notification = await database
    .selectFrom("notification")
    .selectAll()
    .where("id", "=", notificationId)
    .executeTakeFirstOrThrow();
  if (notification.status === "delivered")
    return { status: "already-delivered" };

  const attempt = notification.attempts + 1;
  await database
    .updateTable("notification")
    .set({ attempts: attempt, status: "pending", updatedAt: new Date() })
    .where("id", "=", notification.id)
    .where("status", "!=", "delivered")
    .execute();

  let provider: ReturnType<typeof getEmailProvider> | undefined;
  try {
    const activeProvider = getEmailProvider(database);
    provider = activeProvider;
    const delivery = await activeProvider.send({
      notificationId: notification.id,
      recipientEmail: notification.recipientEmail,
      subject: "Your Upskill account has been created",
      textBody: `${notification.recipientName}, an Upskill account has been created for you. Visit ${getServerEnv().APP_ORIGIN}/login to access Upskill.`,
    });
    const deliveredAt = new Date();
    await database.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("notification_delivery_attempt")
        .values({
          id: `notification_delivery_${randomUUID()}`,
          notificationId: notification.id,
          attempt,
          provider: activeProvider.id,
          status: "delivered",
          providerMessageId: delivery.messageId,
          errorCode: null,
          createdAt: deliveredAt,
        })
        .onConflict((conflict) =>
          conflict.columns(["notificationId", "attempt"]).doNothing(),
        )
        .execute();
      await transaction
        .updateTable("notification")
        .set({
          status: "delivered",
          deliveredAt,
          lastErrorCode: null,
          updatedAt: deliveredAt,
        })
        .where("id", "=", notification.id)
        .execute();
    });
    return { status: "delivered" };
  } catch (error) {
    const errorCode = safeErrorCode(error);
    const failedAt = new Date();
    await database.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("notification_delivery_attempt")
        .values({
          id: `notification_delivery_${randomUUID()}`,
          notificationId: notification.id,
          attempt,
          provider: provider?.id ?? "unconfigured",
          status: "failed",
          providerMessageId: null,
          errorCode,
          createdAt: failedAt,
        })
        .onConflict((conflict) =>
          conflict.columns(["notificationId", "attempt"]).doNothing(),
        )
        .execute();
      await transaction
        .updateTable("notification")
        .set({
          status: "failed",
          lastErrorCode: errorCode,
          updatedAt: failedAt,
        })
        .where("id", "=", notification.id)
        .where("status", "!=", "delivered")
        .execute();
    });
    throw error;
  }
}
