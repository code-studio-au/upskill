import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  secret: "test-only-signing-secret",
}));

vi.mock("#/server/env.server", () => ({
  getServerEnv: () => ({ TEXTBEE_WEBHOOK_SECRET: mocks.secret }),
}));

import {
  handleTextBeeWebhook,
  verifyTextBeeWebhookSignature,
} from "./textbee-webhook.server";

function signature(payload: Buffer): string {
  return createHmac("sha256", mocks.secret).update(payload).digest("hex");
}

function webhook(
  event: string,
  data: Record<string, unknown>,
  timestamp = "2026-08-22T10:00:00.000Z",
): Buffer {
  return Buffer.from(JSON.stringify({ event, timestamp, data }));
}

function fakeDatabase({
  delivery = {
    id: "delivery_1",
    createdAt: new Date("2026-08-22T09:00:00.000Z"),
  },
  inserted = true,
}: {
  delivery?: { id: string; createdAt: Date } | null;
  inserted?: boolean;
} = {}) {
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  const transaction = {
    insertInto: vi.fn(() => {
      const builder = {
        values(values: Record<string, unknown>) {
          inserts.push(values);
          return builder;
        },
        onConflict() {
          return builder;
        },
        returning() {
          return builder;
        },
        executeTakeFirst: () => (inserted ? { id: "event_1" } : undefined),
      };
      return builder;
    }),
    selectFrom: vi.fn(() => {
      const builder = {
        select() {
          return builder;
        },
        where() {
          return builder;
        },
        forUpdate() {
          return builder;
        },
        executeTakeFirst: () => delivery ?? undefined,
      };
      return builder;
    }),
    updateTable: vi.fn((table: string) => {
      const builder = {
        where() {
          return builder;
        },
        set(values: Record<string, unknown>) {
          updates.push({ table, values });
          return builder;
        },
        execute() {},
      };
      return builder;
    }),
  };
  return {
    database: {
      transaction: () => ({
        execute: async (callback: (value: typeof transaction) => unknown) =>
          await callback(transaction),
      }),
    },
    inserts,
    updates,
  };
}

describe("TextBee webhook boundary", () => {
  beforeEach(() => {
    mocks.secret = "test-only-signing-secret";
  });

  it("validates the exact raw request bytes", () => {
    const payload = webhook("MESSAGE_SENT", { smsBatch: "batch_1" });
    const signed = signature(payload);
    expect(verifyTextBeeWebhookSignature(payload, signed, mocks.secret)).toBe(
      true,
    );
    expect(
      verifyTextBeeWebhookSignature(
        Buffer.from(`${payload.toString()}\n`),
        signed,
        mocks.secret,
      ),
    ).toBe(false);
    expect(
      verifyTextBeeWebhookSignature(payload, "not-a-signature", mocks.secret),
    ).toBe(false);
  });

  it("rejects missing configuration, bad signatures and invalid payloads", async () => {
    const payload = webhook("MESSAGE_SENT", { smsBatch: "batch_1" });
    mocks.secret = "";
    await expect(
      handleTextBeeWebhook(payload, signature(payload), undefined, {} as never),
    ).rejects.toThrow("TEXTBEE_WEBHOOK_NOT_CONFIGURED");
    mocks.secret = "test-only-signing-secret";
    await expect(
      handleTextBeeWebhook(payload, "0".repeat(64), undefined, {} as never),
    ).rejects.toThrow("TEXTBEE_WEBHOOK_INVALID_SIGNATURE");
    const invalidJson = Buffer.from("{");
    await expect(
      handleTextBeeWebhook(
        invalidJson,
        signature(invalidJson),
        undefined,
        {} as never,
      ),
    ).rejects.toThrow("TEXTBEE_WEBHOOK_INVALID_PAYLOAD");
    const incoming = webhook("MESSAGE_RECEIVED", {});
    await expect(
      handleTextBeeWebhook(
        incoming,
        signature(incoming),
        undefined,
        {} as never,
      ),
    ).rejects.toThrow("TEXTBEE_WEBHOOK_INVALID_PAYLOAD");
  });

  it("deduplicates receipts and retains authentic unmatched events", async () => {
    const duplicate = fakeDatabase({ inserted: false });
    const sent = webhook("MESSAGE_SENT", { smsBatch: "batch_1" });
    await expect(
      handleTextBeeWebhook(
        sent,
        signature(sent),
        undefined,
        duplicate.database as never,
      ),
    ).resolves.toBe("duplicate");

    const noBatch = fakeDatabase();
    const unknown = webhook("UNKNOWN_STATE", { smsBatch: 42 });
    await expect(
      handleTextBeeWebhook(
        unknown,
        signature(unknown),
        "provider-event-1",
        noBatch.database as never,
      ),
    ).resolves.toBe("unmatched");
    expect(noBatch.inserts[0]?.providerEventId).toBe("provider-event-1");

    const missingDelivery = fakeDatabase({ delivery: null });
    await expect(
      handleTextBeeWebhook(
        sent,
        signature(sent),
        undefined,
        missingDelivery.database as never,
      ),
    ).resolves.toBe("unmatched");
  });

  it.each([
    [
      "MESSAGE_SENT",
      { smsBatch: "batch_1", sentAt: "2026-08-22T10:00:00Z" },
      "sent",
    ],
    [
      "MESSAGE_DELIVERED",
      { smsBatchId: "batch_1", deliveredAt: "invalid" },
      "delivered",
    ],
    [
      "MESSAGE_FAILED",
      {
        smsBatch: "batch_1",
        failedAt: "2026-08-22T08:00:00Z",
        errorCode: "DEVICE_OFFLINE",
      },
      "failed",
    ],
    ["UNKNOWN_STATE", { smsBatch: "batch_1" }, "unknown"],
    ["SMS_STATUS_UPDATED", { smsBatch: "batch_1", status: "sent" }, "sent"],
    [
      "SMS_STATUS_UPDATED",
      { smsBatch: "batch_1", status: "delivered" },
      "delivered",
    ],
    [
      "SMS_STATUS_UPDATED",
      {
        smsBatch: "batch_1",
        status: "failed",
        errorCode: "unsafe error text",
      },
      "failed",
    ],
    [
      "SMS_STATUS_UPDATED",
      { smsBatch: "batch_1", status: "unknown" },
      "unknown",
    ],
  ])("processes %s as %s", async (event, data, expectedStatus) => {
    const fake = fakeDatabase();
    const payload = webhook(event, data);
    await expect(
      handleTextBeeWebhook(
        payload,
        signature(payload),
        undefined,
        fake.database as never,
      ),
    ).resolves.toBe("processed");
    expect(
      fake.updates.find((update) => update.table === "sms_delivery")?.values
        .status,
    ).toBe(expectedStatus);
  });

  it("accepts non-terminal status updates without downgrading the ledger", async () => {
    const fake = fakeDatabase();
    const payload = webhook("SMS_STATUS_UPDATED", {
      smsBatch: "batch_1",
      status: "dispatched",
    });
    await expect(
      handleTextBeeWebhook(
        payload,
        signature(payload),
        undefined,
        fake.database as never,
      ),
    ).resolves.toBe("processed");
    expect(fake.updates.some((update) => update.table === "sms_delivery")).toBe(
      false,
    );
  });
});
