import "@tanstack/react-start/server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Kysely } from "kysely";
import type { Database } from "#/server/db/types";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import { z } from "#/validation/zod.server";

const webhookEventSchema = z.object({
  event: z.enum([
    "MESSAGE_SENT",
    "MESSAGE_DELIVERED",
    "MESSAGE_FAILED",
    "UNKNOWN_STATE",
    "SMS_STATUS_UPDATED",
  ]),
  timestamp: z.string().optional(),
  data: z.record(z.string(), z.unknown()),
});

export type TextBeeWebhookOutcome = "processed" | "duplicate" | "unmatched";

function stringField(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = record[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function eventTime(
  value: string | undefined,
  fallback: Date,
  notBefore: Date,
): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) || parsed < notBefore
    ? fallback
    : parsed;
}

function safeErrorCode(data: Record<string, unknown>): string {
  const value = stringField(data, "errorCode");
  return value && /^[A-Za-z0-9_.:-]{1,100}$/u.test(value)
    ? value
    : "provider_failed";
}

function providerBatchId(data: Record<string, unknown>): string | undefined {
  return stringField(data, "smsBatch") ?? stringField(data, "smsBatchId");
}

function targetStatus(
  event: z.infer<typeof webhookEventSchema>,
): "accepted" | "sent" | "delivered" | "failed" | "unknown" {
  if (event.event === "MESSAGE_SENT") return "sent";
  if (event.event === "MESSAGE_DELIVERED") return "delivered";
  if (event.event === "MESSAGE_FAILED") return "failed";
  if (event.event === "UNKNOWN_STATE") return "unknown";
  const status = stringField(event.data, "status");
  if (status === "sent") return "sent";
  if (status === "delivered") return "delivered";
  if (status === "failed") return "failed";
  if (status === "unknown") return "unknown";
  return "accepted";
}

export function verifyTextBeeWebhookSignature(
  payload: Buffer,
  signature: string,
  secret: string,
): boolean {
  if (!/^[a-f0-9]{64}$/iu.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const actual = Buffer.from(signature, "hex");
  return (
    actual.byteLength === expected.byteLength &&
    timingSafeEqual(actual, expected)
  );
}

async function applyDeliveryStatus(
  database: Kysely<Database>,
  delivery: {
    id: string;
    createdAt: Date;
  },
  event: z.infer<typeof webhookEventSchema>,
  receivedAt: Date,
): Promise<void> {
  const status = targetStatus(event);
  if (status === "accepted") return;
  const providerTime =
    status === "delivered"
      ? stringField(event.data, "deliveredAt")
      : status === "failed"
        ? stringField(event.data, "failedAt")
        : status === "sent"
          ? stringField(event.data, "sentAt")
          : event.timestamp;
  const occurredAt = eventTime(
    providerTime ?? event.timestamp,
    receivedAt,
    delivery.createdAt,
  );
  let query = database
    .updateTable("sms_delivery")
    .where("id", "=", delivery.id);
  if (status === "sent") {
    query = query.where("status", "in", ["pending", "accepted", "unknown"]);
    await query
      .set({
        status,
        sentAt: occurredAt,
        lastErrorCode: null,
        updatedAt: receivedAt,
      })
      .execute();
    return;
  }
  if (status === "delivered") {
    await query
      .where("status", "!=", "delivered")
      .set({
        status,
        deliveredAt: occurredAt,
        lastErrorCode: null,
        updatedAt: receivedAt,
      })
      .execute();
    return;
  }
  if (status === "failed") {
    await query
      .where("status", "!=", "delivered")
      .set({
        status,
        failedAt: occurredAt,
        lastErrorCode: safeErrorCode(event.data),
        updatedAt: receivedAt,
      })
      .execute();
    return;
  }
  await query
    .where("status", "in", ["pending", "accepted", "sent", "unknown"])
    .set({ status, updatedAt: receivedAt })
    .execute();
}

export async function handleTextBeeWebhook(
  payload: Buffer,
  signature: string,
  providerEventId?: string,
  database: Kysely<Database> = getDatabase(),
): Promise<TextBeeWebhookOutcome> {
  const secret = getServerEnv().TEXTBEE_WEBHOOK_SECRET;
  if (!secret) throw new Error("TEXTBEE_WEBHOOK_NOT_CONFIGURED");
  if (!verifyTextBeeWebhookSignature(payload, signature, secret))
    throw new Error("TEXTBEE_WEBHOOK_INVALID_SIGNATURE");

  let decoded: unknown;
  try {
    decoded = JSON.parse(payload.toString("utf8"));
  } catch {
    throw new Error("TEXTBEE_WEBHOOK_INVALID_PAYLOAD");
  }
  const parsed = webhookEventSchema.safeParse(decoded);
  if (!parsed.success) throw new Error("TEXTBEE_WEBHOOK_INVALID_PAYLOAD");

  const digest = createHash("sha256").update(payload).digest("hex");
  const eventId = `textbee_event_${digest}`;
  const batchId = providerBatchId(parsed.data.data);
  const receivedAt = new Date();
  return await database.transaction().execute(async (transaction) => {
    const inserted = await transaction
      .insertInto("sms_delivery_webhook_event")
      .values({
        id: eventId,
        providerEventId: providerEventId?.slice(0, 255) ?? null,
        eventType: parsed.data.event,
        providerBatchId: batchId ?? null,
        matchedDeliveryId: null,
        payloadDigest: digest,
        receivedAt,
      })
      .onConflict((conflict) => conflict.column("id").doNothing())
      .returning("id")
      .executeTakeFirst();
    if (!inserted) return "duplicate";
    if (!batchId) return "unmatched";

    const delivery = await transaction
      .selectFrom("sms_delivery")
      .select(["id", "createdAt"])
      .where("provider", "=", "textbee")
      .where("providerBatchId", "=", batchId)
      .forUpdate()
      .executeTakeFirst();
    if (!delivery) return "unmatched";
    await transaction
      .updateTable("sms_delivery_webhook_event")
      .set({ matchedDeliveryId: delivery.id })
      .where("id", "=", eventId)
      .execute();
    await applyDeliveryStatus(transaction, delivery, parsed.data, receivedAt);
    return "processed";
  });
}
