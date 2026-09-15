import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ParticipantWebhookModule from "#/server/livekit/livekit-participant-webhook.server";
import type * as RecordingWebhookModule from "#/server/livekit/livekit-recording-webhook.server";
import type * as RoomWebhookModule from "#/server/livekit/livekit-room-webhook.server";
import type * as LiveKitWebhookModule from "#/server/livekit/livekit-webhook.server";

const mocks = vi.hoisted(() => ({
  verifyLiveKitWebhook: vi.fn(),
  ingestVerifiedLiveKitParticipantWebhook: vi.fn(),
  ingestVerifiedLiveKitRecordingWebhook: vi.fn(),
  ingestVerifiedLiveKitRoomWebhook: vi.fn(),
  logServerEvent: vi.fn(),
}));

vi.mock("#/server/livekit/livekit-webhook.server", async (importOriginal) => ({
  ...(await importOriginal<typeof LiveKitWebhookModule>()),
  verifyLiveKitWebhook: mocks.verifyLiveKitWebhook,
}));
vi.mock(
  "#/server/livekit/livekit-participant-webhook.server",
  async (importOriginal) => ({
    ...(await importOriginal<typeof ParticipantWebhookModule>()),
    ingestVerifiedLiveKitParticipantWebhook:
      mocks.ingestVerifiedLiveKitParticipantWebhook,
  }),
);
vi.mock(
  "#/server/livekit/livekit-recording-webhook.server",
  async (importOriginal) => ({
    ...(await importOriginal<typeof RecordingWebhookModule>()),
    ingestVerifiedLiveKitRecordingWebhook:
      mocks.ingestVerifiedLiveKitRecordingWebhook,
  }),
);
vi.mock(
  "#/server/livekit/livekit-room-webhook.server",
  async (importOriginal) => ({
    ...(await importOriginal<typeof RoomWebhookModule>()),
    ingestVerifiedLiveKitRoomWebhook: mocks.ingestVerifiedLiveKitRoomWebhook,
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
    mocks.ingestVerifiedLiveKitParticipantWebhook.mockReset();
    mocks.ingestVerifiedLiveKitParticipantWebhook.mockResolvedValue({
      status: "unsupported",
    });
    mocks.ingestVerifiedLiveKitRecordingWebhook.mockReset();
    mocks.ingestVerifiedLiveKitRoomWebhook.mockReset();
    mocks.ingestVerifiedLiveKitRoomWebhook.mockResolvedValue({
      status: "unsupported",
    });
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

  it("asks LiveKit to retry a valid event without a dedicated consumer", async () => {
    mocks.verifyLiveKitWebhook.mockResolvedValueOnce({
      providerEventId: "EV_GZDoCEnjEwhx",
      event: "track_published",
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

  it.each(["processed", "duplicate", "unmatched", "ignored"] as const)(
    "acknowledges an idempotently persisted room receipt with %s status",
    async (status) => {
      const event = {
        providerEnvironment: "development",
        providerEventId: "EV_RoomFinished1",
        event: "room_finished",
        createdAtSeconds: 1_788_400_800,
        payloadDigest: "a".repeat(64),
        roomSid: "RM_1",
        roomName: "room_generation_1",
      };
      mocks.verifyLiveKitWebhook.mockResolvedValueOnce(event);
      mocks.ingestVerifiedLiveKitRecordingWebhook.mockResolvedValueOnce({
        status: "unsupported",
      });
      mocks.ingestVerifiedLiveKitRoomWebhook.mockResolvedValueOnce({
        status,
        receiptId: "livekit_room_webhook_receipt_1",
        ...(status === "processed" || status === "ignored"
          ? { roomId: "event_virtual_room_1" }
          : {}),
      });
      const response = await handleLiveKitWebhookRequest(request());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true });
      expect(mocks.ingestVerifiedLiveKitRoomWebhook).toHaveBeenCalledWith(
        event,
      );
      expect(mocks.logServerEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "info",
          event: "livekit.room_webhook_received",
        }),
      );
    },
  );

  it.each(["processed", "duplicate", "unmatched", "ignored"] as const)(
    "acknowledges an idempotently persisted participant receipt with %s status",
    async (status) => {
      const event = {
        providerEnvironment: "development",
        providerEventId: "EV_ParticipantUpdate1",
        event: "participant_joined",
        createdAtSeconds: 1_788_400_800,
        payloadDigest: "a".repeat(64),
        roomSid: "RM_1",
        roomName: "room_generation_1",
        participantSid: "PA_1",
        participantIdentity: `attendee:${"a".repeat(43)}`,
      };
      mocks.verifyLiveKitWebhook.mockResolvedValueOnce(event);
      mocks.ingestVerifiedLiveKitRecordingWebhook.mockResolvedValueOnce({
        status: "unsupported",
      });
      mocks.ingestVerifiedLiveKitParticipantWebhook.mockResolvedValueOnce({
        status,
        receiptId: "livekit_participant_webhook_receipt_1",
        ...(status === "processed"
          ? { lobbyEntryId: "event_virtual_lobby_entry_1" }
          : {}),
      });
      const response = await handleLiveKitWebhookRequest(request());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true });
      expect(
        mocks.ingestVerifiedLiveKitParticipantWebhook,
      ).toHaveBeenCalledWith(event);
      expect(mocks.logServerEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "info",
          event: "livekit.participant_webhook_received",
        }),
      );
    },
  );

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
