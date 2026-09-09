import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as RecordingWebhookModule from "#/server/livekit/livekit-recording-webhook.server";
import type * as LiveKitWebhookModule from "#/server/livekit/livekit-webhook.server";

const mocks = vi.hoisted(() => ({
  verifyLiveKitWebhook: vi.fn(),
  ingestVerifiedLiveKitRecordingWebhook: vi.fn(),
  logServerEvent: vi.fn(),
}));

vi.mock("#/server/livekit/livekit-webhook.server", async (importOriginal) => ({
  ...(await importOriginal<typeof LiveKitWebhookModule>()),
  verifyLiveKitWebhook: mocks.verifyLiveKitWebhook,
}));
vi.mock(
  "#/server/livekit/livekit-recording-webhook.server",
  async (importOriginal) => ({
    ...(await importOriginal<typeof RecordingWebhookModule>()),
    ingestVerifiedLiveKitRecordingWebhook:
      mocks.ingestVerifiedLiveKitRecordingWebhook,
  }),
);
vi.mock("#/server/logging/server-logger", () => ({
  logServerEvent: mocks.logServerEvent,
}));

import { LiveKitWebhookError } from "#/server/livekit/livekit-webhook.server";
import { handleLiveKitWebhookRequest } from "./api.livekit.webhook";

function request(body = "{}", headers: Record<string, string> = {}): Request {
  return new Request("https://upskill.example/api/livekit/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/webhook+json",
      authorization: "signed-token",
      ...headers,
    },
    body,
  });
}

describe("LiveKit webhook route", () => {
  beforeEach(() => {
    mocks.verifyLiveKitWebhook.mockReset();
    mocks.ingestVerifiedLiveKitRecordingWebhook.mockReset();
    mocks.logServerEvent.mockReset();
  });

  it("rejects unsupported content types and oversized declared payloads", async () => {
    const unsupported = await handleLiveKitWebhookRequest(
      request("{}", { "content-type": "application/json" }),
    );
    expect(unsupported.status).toBe(415);
    expect(await unsupported.json()).toEqual({
      error: "unsupported_media_type",
    });

    const oversized = await handleLiveKitWebhookRequest(
      request("{}", { "content-length": "262145" }),
    );
    expect(oversized.status).toBe(413);
    expect(mocks.verifyLiveKitWebhook).not.toHaveBeenCalled();
  });

  it.each([
    ["LIVEKIT_WEBHOOK_NOT_CONFIGURED", 404, "not_found"],
    ["LIVEKIT_WEBHOOK_INVALID", 401, "invalid_webhook"],
  ] as const)(
    "maps %s without exposing details",
    async (code, status, message) => {
      mocks.verifyLiveKitWebhook.mockRejectedValueOnce(
        new LiveKitWebhookError(code),
      );
      const response = await handleLiveKitWebhookRequest(request());
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: message });
    },
  );

  it("asks LiveKit to retry a valid event whose ingestion slice has not landed", async () => {
    mocks.verifyLiveKitWebhook.mockResolvedValueOnce({
      providerEventId: "EV_GZDoCEnjEwhx",
      event: "room_started",
      createdAtSeconds: 1_788_400_800,
    });
    mocks.ingestVerifiedLiveKitRecordingWebhook.mockResolvedValueOnce({
      status: "unsupported",
    });
    const response = await handleLiveKitWebhookRequest(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toEqual({
      error: "webhook_ingestion_not_ready",
    });
    expect(mocks.logServerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "livekit.webhook_ingestion_not_ready",
      }),
    );
  });

  it.each(["pending", "duplicate", "unmatched"] as const)(
    "acknowledges an idempotently persisted Egress receipt with %s status",
    async (status) => {
      const event = {
        providerEnvironment: "development",
        providerEventId: "EV_EgressUpdate1",
        event: "egress_updated",
        createdAtSeconds: 1_788_400_800,
        payloadDigest: "a".repeat(64),
      };
      mocks.verifyLiveKitWebhook.mockResolvedValueOnce(event);
      mocks.ingestVerifiedLiveKitRecordingWebhook.mockResolvedValueOnce({
        status,
        receiptId: "livekit_webhook_receipt_1",
        ...(status === "pending"
          ? { recordingId: "event_virtual_recording_1" }
          : {}),
      });
      const response = await handleLiveKitWebhookRequest(request());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true });
      expect(mocks.ingestVerifiedLiveKitRecordingWebhook).toHaveBeenCalledWith(
        event,
      );
      expect(mocks.logServerEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "info",
          event: "livekit.recording_webhook_received",
        }),
      );
    },
  );

  it("returns a retryable failure when durable ingestion fails", async () => {
    mocks.verifyLiveKitWebhook.mockResolvedValueOnce({
      providerEventId: "EV_EgressUpdate1",
      event: "egress_updated",
    });
    mocks.ingestVerifiedLiveKitRecordingWebhook.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    const response = await handleLiveKitWebhookRequest(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "webhook_processing_failed",
    });
    expect(mocks.logServerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        event: "livekit.webhook_processing_failed",
      }),
    );
  });
});
