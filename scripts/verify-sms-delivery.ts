import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { Database } from "#/server/db/types";
import { handleTextBeeWebhook } from "#/server/notifications/textbee-webhook.server";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const signingSecret = "verification-only-textbee-secret";
process.env.TEXTBEE_WEBHOOK_SECRET = signingSecret;

const ids = {
  delivery: "verify_sms_delivery",
  batch: "verify_sms_batch",
};
const database = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});

function payload(event: string, batch: string, fields = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      data: { smsBatch: batch, ...fields },
    }),
  );
}

function signature(body: Buffer): string {
  return createHmac("sha256", signingSecret).update(body).digest("hex");
}

async function deliver(body: Buffer): Promise<string> {
  return await handleTextBeeWebhook(body, signature(body), undefined, database);
}

async function cleanup(): Promise<void> {
  await database
    .deleteFrom("sms_delivery_webhook_event")
    .where("providerBatchId", "in", [ids.batch, "verify_sms_unmatched"])
    .execute();
  await database
    .deleteFrom("sms_delivery")
    .where("id", "=", ids.delivery)
    .execute();
}

try {
  await cleanup();
  const createdAt = new Date(Date.now() - 1_000);
  await database
    .insertInto("sms_delivery")
    .values({
      id: ids.delivery,
      purpose: "onboarding_contact_verification",
      recipientPhone: "+61491570123",
      provider: "textbee",
      providerBatchId: ids.batch,
      status: "accepted",
      lastErrorCode: null,
      acceptedAt: createdAt,
      sentAt: null,
      deliveredAt: null,
      failedAt: null,
      createdAt,
      updatedAt: createdAt,
    })
    .execute();

  const sent = payload("MESSAGE_SENT", ids.batch, {
    sentAt: new Date().toISOString(),
  });
  assert.equal(await deliver(sent), "processed");
  assert.equal(await deliver(sent), "duplicate");
  assert.equal(
    (
      await database
        .selectFrom("sms_delivery")
        .select("status")
        .where("id", "=", ids.delivery)
        .executeTakeFirstOrThrow()
    ).status,
    "sent",
  );

  const delivered = payload("MESSAGE_DELIVERED", ids.batch, {
    deliveredAt: new Date().toISOString(),
  });
  assert.equal(await deliver(delivered), "processed");
  assert.equal(await deliver(payload("MESSAGE_SENT", ids.batch)), "processed");
  assert.equal(
    (
      await database
        .selectFrom("sms_delivery")
        .select(["status", "lastErrorCode"])
        .where("id", "=", ids.delivery)
        .executeTakeFirstOrThrow()
    ).status,
    "delivered",
  );
  assert.equal(
    await deliver(
      payload("MESSAGE_FAILED", ids.batch, {
        errorCode: "DEVICE_OFFLINE",
      }),
    ),
    "processed",
  );
  const terminal = await database
    .selectFrom("sms_delivery")
    .select(["status", "lastErrorCode"])
    .where("id", "=", ids.delivery)
    .executeTakeFirstOrThrow();
  assert.deepEqual(terminal, { status: "delivered", lastErrorCode: null });

  const unmatched = payload("MESSAGE_FAILED", "verify_sms_unmatched", {
    errorCode: "UNKNOWN_BATCH",
  });
  assert.equal(await deliver(unmatched), "unmatched");
  await assert.rejects(
    handleTextBeeWebhook(unmatched, "0".repeat(64), undefined, database),
    /TEXTBEE_WEBHOOK_INVALID_SIGNATURE/u,
  );
  const events = await database
    .selectFrom("sms_delivery_webhook_event")
    .select(["matchedDeliveryId", "payloadDigest"])
    .where("providerBatchId", "in", [ids.batch, "verify_sms_unmatched"])
    .execute();
  assert.equal(events.length, 5);
  assert.ok(events.some((event) => event.matchedDeliveryId === null));
  assert.ok(
    events.every((event) => /^[a-f0-9]{64}$/u.test(event.payloadDigest)),
  );
  console.log(
    "Verified signed, idempotent TextBee delivery updates, terminal-state ordering and unmatched receipts",
  );
} finally {
  await cleanup();
  await database.destroy();
}
