import { createHash } from "node:crypto";
import {
  AccessToken,
  EgressInfo,
  EgressStatus,
  EncodedFileType,
  FileOutput,
  Output,
  S3Upload,
  StartEgressRequest,
  StorageConfig,
  TemplateSource,
} from "livekit-server-sdk";
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
      id: "EV_GZDoCEnjEwhx",
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

function egressWebhookPayload(roomName = "room_generation_1"): Buffer {
  const egressInfo = new EgressInfo({
    egressId: "EG_recording_1",
    roomName,
    status: EgressStatus.EGRESS_ACTIVE,
    request: {
      case: "egress",
      value: new StartEgressRequest({
        roomName,
        source: {
          case: "template",
          value: new TemplateSource({ layout: "speaker" }),
        },
        outputs: [
          new Output({
            config: {
              case: "file",
              value: new FileOutput({
                fileType: EncodedFileType.MP4,
                filepath: "recordings/session_1/1/recording_1.mp4",
                disableManifest: true,
              }),
            },
          }),
        ],
        storage: new StorageConfig({
          provider: {
            case: "s3",
            value: new S3Upload({
              region: "ap-southeast-2",
              bucket: "upskill-recordings",
            }),
          },
        }),
      }),
    },
  });
  return Buffer.from(
    JSON.stringify({
      event: "egress_updated",
      id: "EV_EgressUpdate1",
      createdAt: "1788400800",
      egressInfo: egressInfo.toJson(),
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
      providerEnvironment: "development",
      providerEventId: "EV_GZDoCEnjEwhx",
      event: "participant_joined",
      createdAtSeconds: 1_788_400_800,
      payloadDigest: createHash("sha256").update(payload).digest("hex"),
      roomSid: "RM_1",
      roomName: "room_generation_1",
      participantSid: "PA_1",
      participantIdentity: "attendee:opaque_1",
    });
  });

  it("returns verified Egress information only after signature validation", async () => {
    const payload = egressWebhookPayload("external.room");
    await expect(
      verifyLiveKitWebhook(payload, await sign(payload), enabledEnvironment),
    ).resolves.toMatchObject({
      providerEnvironment: "development",
      providerEventId: "EV_EgressUpdate1",
      event: "egress_updated",
      payloadDigest: createHash("sha256").update(payload).digest("hex"),
      roomName: "external.room",
      egressId: "EG_recording_1",
      egressInfo: {
        egressId: "EG_recording_1",
        roomName: "external.room",
        status: EgressStatus.EGRESS_ACTIVE,
      },
    });
  });

  it("rejects malformed opaque provider event identifiers", async () => {
    const payload = Buffer.from(
      webhookPayload().toString().replace("EV_GZDoCEnjEwhx", "EV bad"),
    );
    await expect(
      verifyLiveKitWebhook(payload, await sign(payload), enabledEnvironment),
    ).rejects.toMatchObject({ code: "LIVEKIT_WEBHOOK_INVALID" });
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
    const missingEgressInfo = webhookPayload("egress_started");
    await expect(
      verifyLiveKitWebhook(
        missingEgressInfo,
        await sign(missingEgressInfo),
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
