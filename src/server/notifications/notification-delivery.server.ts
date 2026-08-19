import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import { z } from "#/validation/zod.server";
import { getEmailProvider } from "./email-provider.server";
import { renderEmailTemplate } from "./email-template-contracts";

export type NotificationDeliveryOutcome =
  | { status: "delivered" }
  | { status: "already-delivered" }
  | { status: "superseded" };

function safeErrorCode(error: unknown): string {
  if (
    error instanceof Error &&
    [
      "EMAIL_PROVIDER_INVALID_RESPONSE",
      "EMAIL_PROVIDER_NOT_CONFIGURED",
      "EMAIL_PROVIDER_REJECTED",
    ].includes(error.message)
  )
    return error.message;
  return "EMAIL_DELIVERY_FAILED";
}

const accountSetupPayloadSchema = z.object({
  version: z.literal(1),
  setupUrl: z.url(),
});

export async function deliverNotification(
  notificationId: string,
): Promise<NotificationDeliveryOutcome> {
  const database = getDatabase();
  const notification = await database
    .selectFrom("notification")
    .selectAll()
    .where("id", "=", notificationId)
    .executeTakeFirstOrThrow();
  const emailDesignVersion = await database
    .selectFrom("email_design_version")
    .select(["contractKey", "contractVersion", "subject", "textBody"])
    .where("id", "=", notification.emailDesignVersionId)
    .where("publishedAt", "is not", null)
    .executeTakeFirstOrThrow();
  if (notification.status === "delivered")
    return { status: "already-delivered" };
  if (notification.status === "superseded") return { status: "superseded" };

  const attempt = notification.attempts + 1;
  const claimTime = new Date();
  const staleBefore = new Date(
    claimTime.getTime() - getServerEnv().SQS_VISIBILITY_TIMEOUT_SECONDS * 1_000,
  );
  const claimed = await database
    .updateTable("notification")
    .set({ attempts: attempt, status: "processing", updatedAt: claimTime })
    .where("id", "=", notification.id)
    .where((expression) =>
      expression.or([
        expression("status", "in", ["pending", "failed"]),
        expression.and([
          expression("status", "=", "processing"),
          expression("updatedAt", "<=", staleBefore),
        ]),
      ]),
    )
    .returning("id")
    .executeTakeFirst();
  if (!claimed) {
    const current = await database
      .selectFrom("notification")
      .select("status")
      .where("id", "=", notification.id)
      .executeTakeFirstOrThrow();
    if (current.status === "delivered") return { status: "already-delivered" };
    if (current.status === "superseded") return { status: "superseded" };
    throw new Error("EMAIL_DELIVERY_IN_PROGRESS");
  }

  let provider: ReturnType<typeof getEmailProvider> | undefined;
  try {
    const activeProvider = getEmailProvider(database);
    provider = activeProvider;
    const payload = accountSetupPayloadSchema.parse(notification.payload);
    const rendered = renderEmailTemplate({
      contractKey: emailDesignVersion.contractKey,
      contractVersion: emailDesignVersion.contractVersion,
      subject: emailDesignVersion.subject,
      textBody: emailDesignVersion.textBody,
      variables: {
        "user.fullName": notification.recipientName,
        "account.setupUrl": payload.setupUrl,
      },
    });
    const renderedAt = new Date();
    await database
      .updateTable("notification")
      .set({
        renderedSubject: rendered.subject,
        renderedTextBody: rendered.textBody,
        renderedHtmlBody: rendered.htmlBody,
        renderedAt,
        updatedAt: renderedAt,
      })
      .where("id", "=", notification.id)
      .where("status", "=", "processing")
      .executeTakeFirstOrThrow();
    const delivery = await activeProvider.send({
      notificationId: notification.id,
      recipientEmail: notification.recipientEmail,
      subject: rendered.subject,
      textBody: rendered.textBody,
      htmlBody: rendered.htmlBody,
    });
    const deliveredAt = new Date();
    const recorded = await database
      .transaction()
      .execute(async (transaction) => {
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
        return await transaction
          .updateTable("notification")
          .set({
            status: "delivered",
            payload: { version: 1 },
            deliveredAt,
            lastErrorCode: null,
            supersededAt: null,
            updatedAt: deliveredAt,
          })
          .where("id", "=", notification.id)
          .where("status", "=", "processing")
          .returning("id")
          .executeTakeFirst();
      });
    return recorded ? { status: "delivered" } : { status: "superseded" };
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
        .where("status", "=", "processing")
        .execute();
    });
    throw error;
  }
}
