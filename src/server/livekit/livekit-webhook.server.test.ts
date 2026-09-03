import { createHash } from "node:crypto";
import { AccessToken } from "livekit-server-sdk";
import { describe, expect, it } from "vitest";
import { parseServerEnvironment } from "#/server/runtime-environment";
import {
  LiveKitWebhookError,
  verifyLiveKitWebhook,
} from "./livekit-webhook.server";

const apiKey = "development-key";
const apiSecret = "development-secret-with-at-least-32-characters";

const enabledEnvironment = parseServerEnvironment({
  DATABASE_URL: "postgresql://upskill:upskill@localhost:5433/upskill",
  BETTER_AUTH_SECRET: "local-only-secret-with-more-than-32-characters",
  STRIPE_SECRET_KEY: "sk_test_local",
  STRIPE_WEBHOOK_SECRET: "whsec_local",
  LIVEKIT_ENABLED: "true",
  LIVEKIT_PROJECT_ENVIRONMENT: "development",
  LIVEKIT_URL: "ws://127.0.0.1:7880",
  LIVEKIT_API_KEY: apiKey,
  LIVEKIT_API_SECRET: apiSecret,
  LIVEKIT_APPROVED_MAX_PARTICIPANTS: "10",
  LIVEKIT_APPROVED_MAX_CONCURRENT_ROOMS: "1",
});

function webhookPayload(event = "participant_joined"): Buffer {
  return Buffer.from(
    JSON.stringify({
      event,
      id: "5f0ee8c3-5330-4e20-9886-e97b16661e44",
      createdAt: "1788400800",
      room: { sid: "RM_1", name: "room_generation_1" },
      participant: {
        sid: "PA_1",
        identity: "attendee:opaque_1",
        name: "Learner One",
      },
    }),
  );
}

async function sign(payload: Buffer): Promise<string> {
  const token = new AccessToken(apiKey, apiSecret);
  token.sha256 = createHash("sha256").update(payload).digest("base64");
  return await token.toJwt();
}

describe("LiveKit webhook verification", () => {
  it("verifies the exact raw bytes and returns a bounded normalized event", async () => {
    const payload = webhookPayload();
    await expect(
      verifyLiveKitWebhook(payload, await sign(payload), enabledEnvironment),
    ).resolves.toEqual({
      providerEventId: "5f0ee8c3-5330-4e20-9886-e97b16661e44",
      event: "participant_joined",
      createdAtSeconds: 1_788_400_800,
      roomSid: "RM_1",
      roomName: "room_generation_1",
      participantSid: "PA_1",
      participantIdentity: "attendee:opaque_1",
    });
  });

  it("rejects altered bytes, missing signatures and unsupported events", async () => {
    const payload = webhookPayload();
    const authorization = await sign(payload);
    await expect(
      verifyLiveKitWebhook(
        Buffer.from(`${payload.toString()}\n`),
        authorization,
        enabledEnvironment,
      ),
    ).rejects.toMatchObject({ code: "LIVEKIT_WEBHOOK_INVALID" });
    await expect(
      verifyLiveKitWebhook(payload, null, enabledEnvironment),
    ).rejects.toMatchObject({ code: "LIVEKIT_WEBHOOK_INVALID" });
    const unsupported = webhookPayload("unknown_event");
    await expect(
      verifyLiveKitWebhook(
        unsupported,
        await sign(unsupported),
        enabledEnvironment,
      ),
    ).rejects.toMatchObject({ code: "LIVEKIT_WEBHOOK_INVALID" });
  });

  it("stays unavailable when the feature is disabled", async () => {
    const disabledEnvironment = parseServerEnvironment({
      DATABASE_URL: "postgresql://upskill:upskill@localhost:5433/upskill",
      BETTER_AUTH_SECRET: "local-only-secret-with-more-than-32-characters",
      STRIPE_SECRET_KEY: "sk_test_local",
      STRIPE_WEBHOOK_SECRET: "whsec_local",
    });
    const payload = webhookPayload();
    const failure = await verifyLiveKitWebhook(
      payload,
      await sign(payload),
      disabledEnvironment,
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LiveKitWebhookError);
    expect(failure).toMatchObject({ code: "LIVEKIT_WEBHOOK_NOT_CONFIGURED" });
  });
});
