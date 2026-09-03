import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as LiveKitWebhookModule from "#/server/livekit/livekit-webhook.server";

const mocks = vi.hoisted(() => ({
  verifyLiveKitWebhook: vi.fn(),
  logServerEvent: vi.fn(),
}));

vi.mock("#/server/livekit/livekit-webhook.server", async (importOriginal) => ({
  ...(await importOriginal<typeof LiveKitWebhookModule>()),
  verifyLiveKitWebhook: mocks.verifyLiveKitWebhook,
}));
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

  it("asks LiveKit to retry a valid event until durable persistence lands", async () => {
    mocks.verifyLiveKitWebhook.mockResolvedValueOnce({
      providerEventId: "EV_GZDoCEnjEwhx",
      event: "room_started",
      createdAtSeconds: 1_788_400_800,
    });
    const response = await handleLiveKitWebhookRequest(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toEqual({
      error: "webhook_persistence_not_ready",
    });
    expect(mocks.logServerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "livekit.webhook_persistence_not_ready",
      }),
    );
  });
});
