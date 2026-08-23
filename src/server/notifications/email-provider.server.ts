import "@tanstack/react-start/server-only";

import type { Kysely } from "kysely";
import type { Database } from "#/server/db/types";
import { getServerEnv } from "#/server/env.server";
import { z } from "#/validation/zod.server";

interface EmailDelivery {
  notificationId: string;
  recipientEmail: string;
  subject: string;
  textBody: string;
  htmlBody: string;
}

const mailgunResponseSchema = z.object({ id: z.string().min(1) });

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
        htmlBody: message.htmlBody,
        createdAt: new Date(),
      })
      .onConflict((conflict) => conflict.column("notificationId").doNothing())
      .execute();
    return { messageId: `local:${message.notificationId}` };
  }
}

class MailgunEmailProvider implements EmailProvider {
  readonly id = "mailgun";

  constructor(
    private readonly configuration: {
      apiBaseUrl: string;
      apiKey: string;
      domain: string;
      from: string;
    },
  ) {}

  async send(message: EmailDelivery): Promise<{ messageId: string }> {
    const form = new FormData();
    form.set("from", this.configuration.from);
    form.set("to", message.recipientEmail);
    form.set("subject", message.subject);
    form.set("text", message.textBody);
    form.set("html", message.htmlBody);
    let response: Response;
    try {
      response = await fetch(
        `${this.configuration.apiBaseUrl}/v3/${encodeURIComponent(this.configuration.domain)}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`api:${this.configuration.apiKey}`).toString("base64")}`,
          },
          body: form,
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw new Error("EMAIL_PROVIDER_REQUEST_FAILED");
    }
    if (!response.ok) throw new Error("EMAIL_PROVIDER_REJECTED");
    const result = mailgunResponseSchema.safeParse(await response.json());
    if (!result.success) throw new Error("EMAIL_PROVIDER_INVALID_RESPONSE");
    return { messageId: result.data.id };
  }
}

export function isAmbiguousEmailDeliveryError(error: unknown): boolean {
  return (
    error instanceof Error && error.message === "EMAIL_PROVIDER_REQUEST_FAILED"
  );
}

export function getEmailProvider(database: Kysely<Database>): EmailProvider {
  const environment = getServerEnv();
  if (environment.EMAIL_PROVIDER === "local_capture")
    return new LocalCaptureEmailProvider(database);
  if (
    !environment.MAILGUN_API_KEY ||
    !environment.MAILGUN_DOMAIN ||
    !environment.MAILGUN_FROM
  )
    throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");
  return new MailgunEmailProvider({
    apiBaseUrl: environment.MAILGUN_API_BASE_URL,
    apiKey: environment.MAILGUN_API_KEY,
    domain: environment.MAILGUN_DOMAIN,
    from: environment.MAILGUN_FROM,
  });
}

export async function sendEventPrerequisiteRecoveryEmail(
  database: Kysely<Database>,
  message: Omit<EmailDelivery, "notificationId"> & { challengeId: string },
): Promise<{ messageId: string }> {
  const environment = getServerEnv();
  if (environment.EMAIL_PROVIDER === "local_capture") {
    await database
      .insertInto("event_prerequisite_email_capture")
      .values({
        challengeId: message.challengeId,
        recipientEmail: message.recipientEmail,
        subject: message.subject,
        textBody: message.textBody,
        htmlBody: message.htmlBody,
        createdAt: new Date(),
      })
      .onConflict((conflict) => conflict.column("challengeId").doNothing())
      .execute();
    return { messageId: `local:${message.challengeId}` };
  }
  return await getEmailProvider(database).send({
    notificationId: message.challengeId,
    recipientEmail: message.recipientEmail,
    subject: message.subject,
    textBody: message.textBody,
    htmlBody: message.htmlBody,
  });
}

export async function sendOnboardingVerificationEmail(
  database: Kysely<Database>,
  message: Omit<EmailDelivery, "notificationId"> & { challengeId: string },
): Promise<{ messageId: string }> {
  const environment = getServerEnv();
  if (environment.EMAIL_PROVIDER === "local_capture") {
    await database
      .insertInto("onboarding_email_verification_capture")
      .values({
        challengeId: message.challengeId,
        recipientEmail: message.recipientEmail,
        subject: message.subject,
        textBody: message.textBody,
        htmlBody: message.htmlBody,
        createdAt: new Date(),
      })
      .onConflict((conflict) => conflict.column("challengeId").doNothing())
      .execute();
    return { messageId: `local:${message.challengeId}` };
  }
  return await getEmailProvider(database).send({
    notificationId: message.challengeId,
    recipientEmail: message.recipientEmail,
    subject: message.subject,
    textBody: message.textBody,
    htmlBody: message.htmlBody,
  });
}
