import "@tanstack/react-start/server-only";

import type { Kysely } from "kysely";
import type { Database } from "#/server/db/types";
import { getServerEnv } from "#/server/env.server";
import { logServerEvent } from "#/server/logging/server-logger";
import { z } from "#/validation/zod.server";

interface SecuritySmsDelivery {
  deliveryId: string;
  recipientUserId: string;
  recipientName: string;
  recipientPhone: string;
  message: string;
}

type SmsDeliveryPurpose =
  "event_prerequisite_recovery" | "onboarding_contact_verification";
type LocalCaptureTarget = "event" | "onboarding";

const textBeeResponseSchema = z.object({
  data: z.object({
    success: z.boolean().optional(),
    smsBatchId: z.string().min(1).optional(),
    successCount: z.number().int().min(0).optional(),
    failureCount: z.number().int().min(0).optional(),
  }),
});

export interface SmsProvider {
  readonly id: "local_capture" | "textbee";
  send(message: SecuritySmsDelivery): Promise<{ messageId: string }>;
}

class LocalCaptureSmsProvider implements SmsProvider {
  readonly id = "local_capture";

  constructor(
    private readonly database: Kysely<Database>,
    private readonly target: LocalCaptureTarget,
  ) {}

  async send(message: SecuritySmsDelivery): Promise<{ messageId: string }> {
    const capture = {
      challengeId: message.deliveryId,
      recipientPhone: message.recipientPhone,
      message: message.message,
      createdAt: new Date(),
    };
    if (this.target === "event")
      await this.database
        .insertInto("event_prerequisite_sms_capture")
        .values(capture)
        .onConflict((conflict) => conflict.column("challengeId").doNothing())
        .execute();
    else
      await this.database
        .insertInto("onboarding_sms_verification_capture")
        .values(capture)
        .onConflict((conflict) => conflict.column("challengeId").doNothing())
        .execute();
    return { messageId: `local:${message.deliveryId}` };
  }
}

class TextBeeSmsProvider implements SmsProvider {
  readonly id = "textbee";

  constructor(
    private readonly configuration: {
      apiBaseUrl: string;
      apiKey: string;
      deviceId?: string;
    },
  ) {}

  async send(message: SecuritySmsDelivery): Promise<{ messageId: string }> {
    let response: Response;
    try {
      response = await fetch(
        `${this.configuration.apiBaseUrl}/api/v1/gateway/send-sms`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.configuration.apiKey,
          },
          body: JSON.stringify({
            recipients: [message.recipientPhone],
            message: message.message,
            ...(this.configuration.deviceId
              ? { deviceId: this.configuration.deviceId }
              : {}),
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw new Error("SMS_PROVIDER_REQUEST_FAILED");
    }
    if (!response.ok) throw new Error("SMS_PROVIDER_REJECTED");
    const result = textBeeResponseSchema.safeParse(await response.json());
    if (!result.success) throw new Error("SMS_PROVIDER_INVALID_RESPONSE");
    const accepted =
      result.data.data.success === true ||
      (result.data.data.successCount ?? 0) > 0;
    if (!accepted || (result.data.data.failureCount ?? 0) > 0)
      throw new Error("SMS_PROVIDER_REJECTED");
    if (!result.data.data.smsBatchId)
      throw new Error("SMS_PROVIDER_INVALID_RESPONSE");
    return { messageId: result.data.data.smsBatchId };
  }
}

export function getSmsProvider(
  database: Kysely<Database>,
  captureTarget: LocalCaptureTarget = "event",
): SmsProvider {
  const environment = getServerEnv();
  if (environment.SMS_PROVIDER === "local_capture")
    return new LocalCaptureSmsProvider(database, captureTarget);
  if (!environment.TEXTBEE_API_KEY)
    throw new Error("SMS_PROVIDER_NOT_CONFIGURED");
  return new TextBeeSmsProvider({
    apiBaseUrl: environment.TEXTBEE_API_BASE_URL.replace(/\/$/u, ""),
    apiKey: environment.TEXTBEE_API_KEY,
    ...(environment.TEXTBEE_DEVICE_ID
      ? { deviceId: environment.TEXTBEE_DEVICE_ID }
      : {}),
  });
}

function providerFailureCode(error: unknown): string {
  if (!(error instanceof Error)) return "provider_failed";
  const knownCodes = new Set([
    "SMS_PROVIDER_INVALID_RESPONSE",
    "SMS_PROVIDER_NOT_CONFIGURED",
    "SMS_PROVIDER_REJECTED",
    "SMS_PROVIDER_REQUEST_FAILED",
  ]);
  return knownCodes.has(error.message)
    ? error.message.toLowerCase()
    : "provider_failed";
}

export function isAmbiguousSmsDeliveryError(error: unknown): boolean {
  return (
    error instanceof Error && error.message === "SMS_PROVIDER_REQUEST_FAILED"
  );
}

async function sendTrackedSms(
  database: Kysely<Database>,
  message: SecuritySmsDelivery,
  purpose: SmsDeliveryPurpose,
  captureTarget: LocalCaptureTarget,
): Promise<{ messageId: string }> {
  const provider = getSmsProvider(database, captureTarget);
  const createdAt = new Date();
  await database
    .insertInto("sms_delivery")
    .values({
      id: message.deliveryId,
      purpose,
      recipientPhone: message.recipientPhone,
      recipientUserId: message.recipientUserId,
      recipientNameSnapshot: message.recipientName,
      provider: provider.id,
      providerBatchId: null,
      status: "pending",
      lastErrorCode: null,
      acceptedAt: null,
      sentAt: null,
      deliveredAt: null,
      failedAt: null,
      createdAt,
      updatedAt: createdAt,
    })
    .execute();

  let result: { messageId: string };
  try {
    result = await provider.send(message);
  } catch (error) {
    const failedAt = new Date();
    const ambiguous = isAmbiguousSmsDeliveryError(error);
    await database
      .updateTable("sms_delivery")
      .set({
        status: ambiguous ? "unknown" : "failed",
        lastErrorCode: providerFailureCode(error),
        failedAt: ambiguous ? null : failedAt,
        updatedAt: failedAt,
      })
      .where("id", "=", message.deliveryId)
      .execute();
    throw error;
  }

  const acceptedAt = new Date();
  try {
    await database
      .updateTable("sms_delivery")
      .set({
        status: "accepted",
        providerBatchId: provider.id === "textbee" ? result.messageId : null,
        acceptedAt,
        updatedAt: acceptedAt,
      })
      .where("id", "=", message.deliveryId)
      .execute();
  } catch (error) {
    try {
      await database
        .updateTable("sms_delivery")
        .set({
          status: "unknown",
          providerBatchId: provider.id === "textbee" ? result.messageId : null,
          lastErrorCode: "tracking_update_failed",
          updatedAt: acceptedAt,
        })
        .where("id", "=", message.deliveryId)
        .execute();
    } catch {
      // The provider result is still returned; operational reconciliation can
      // recover from the provider batch identifier in the structured log.
    }
    logServerEvent({
      level: "error",
      event: "sms.delivery_tracking_update_failed",
      error,
      fields: {
        entityType: "sms_delivery",
        entityId: message.deliveryId,
        provider: provider.id,
      },
    });
  }
  return result;
}

export async function sendEventPrerequisiteRecoverySms(
  database: Kysely<Database>,
  message: SecuritySmsDelivery,
): Promise<{ messageId: string }> {
  return await sendTrackedSms(
    database,
    message,
    "event_prerequisite_recovery",
    "event",
  );
}

export async function sendOnboardingVerificationSms(
  database: Kysely<Database>,
  message: SecuritySmsDelivery,
): Promise<{ messageId: string }> {
  return await sendTrackedSms(
    database,
    message,
    "onboarding_contact_verification",
    "onboarding",
  );
}
