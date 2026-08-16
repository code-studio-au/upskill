import "@tanstack/react-start/server-only";

import type { Kysely } from "kysely";
import type { Database } from "#/server/db/types";
import { getServerEnv } from "#/server/env.server";

interface EmailDelivery {
  notificationId: string;
  recipientEmail: string;
  subject: string;
  textBody: string;
}

export interface EmailProvider {
  readonly id: string;
  send(message: EmailDelivery): Promise<{ messageId: string }>;
}

class LocalCaptureEmailProvider implements EmailProvider {
  readonly id = "local_capture";

  constructor(private readonly database: Kysely<Database>) {}

  async send(message: EmailDelivery): Promise<{ messageId: string }> {
    await this.database
      .insertInto("email_delivery_capture")
      .values({
        notificationId: message.notificationId,
        recipientEmail: message.recipientEmail,
        subject: message.subject,
        textBody: message.textBody,
        createdAt: new Date(),
      })
      .onConflict((conflict) => conflict.column("notificationId").doNothing())
      .execute();
    return { messageId: `local:${message.notificationId}` };
  }
}

export function getEmailProvider(database: Kysely<Database>): EmailProvider {
  const environment = getServerEnv().APP_ENV;
  if (environment === "development" || environment === "test")
    return new LocalCaptureEmailProvider(database);
  throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");
}
