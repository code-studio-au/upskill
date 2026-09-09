import "@tanstack/react-start/server-only";

import { createHash } from "node:crypto";
import { WebhookReceiver, type EgressInfo } from "livekit-server-sdk";
import type { ServerEnv } from "#/server/env.server";
import { getServerEnv } from "#/server/env.server";
import { z } from "#/validation/zod.server";
import { getEnabledLiveKitConfiguration } from "./livekit-provider.server";

const liveKitWebhookEventNames = [
  "room_started",
  "room_finished",
  "participant_joined",
  "participant_left",
  "participant_connection_aborted",
  "track_published",
  "track_unpublished",
  "egress_started",
  "egress_updated",
  "egress_ended",
  "ingress_started",
  "ingress_ended",
] as const;

const providerOpaqueIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u);

const providerRoomNameSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9:_-]*$/u);

const liveKitWebhookPayloadSchema = z.looseObject({
  id: providerOpaqueIdSchema,
  createdAt: z.union([
    z.number().int().nonnegative(),
    z.string().regex(/^\d+$/u),
  ]),
  event: z.enum(liveKitWebhookEventNames),
});

export interface VerifiedLiveKitWebhook {
  providerEnvironment: NonNullable<ServerEnv["LIVEKIT_PROJECT_ENVIRONMENT"]>;
  providerEventId: string;
  event: (typeof liveKitWebhookEventNames)[number];
  createdAtSeconds: number;
  payloadDigest: string;
  roomSid?: string;
  roomName?: string;
  participantSid?: string;
  participantIdentity?: string;
  egressId?: string;
  egressInfo?: EgressInfo;
  ingressId?: string;
}

export type LiveKitWebhookErrorCode =
  "LIVEKIT_WEBHOOK_NOT_CONFIGURED" | "LIVEKIT_WEBHOOK_INVALID";

export class LiveKitWebhookError extends Error {
  constructor(readonly code: LiveKitWebhookErrorCode) {
    super(code);
    this.name = "LiveKitWebhookError";
  }
}

export async function verifyLiveKitWebhook(
  payload: Buffer,
  authorization: string | null,
  environment: ServerEnv = getServerEnv(),
): Promise<VerifiedLiveKitWebhook> {
  const configuration = getEnabledLiveKitConfiguration(environment);
  if (!configuration)
    throw new LiveKitWebhookError("LIVEKIT_WEBHOOK_NOT_CONFIGURED");
  if (!authorization) throw new LiveKitWebhookError("LIVEKIT_WEBHOOK_INVALID");

  try {
    const rawBody = payload.toString("utf8");
    const decoded = await new WebhookReceiver(
      configuration.apiKey,
      configuration.apiSecret,
    ).receive(rawBody, authorization);
    const validated = liveKitWebhookPayloadSchema.parse(JSON.parse(rawBody));
    const createdAtSeconds = Number(validated.createdAt);
    if (
      !Number.isSafeInteger(createdAtSeconds) ||
      createdAtSeconds > 8_640_000_000_000 ||
      decoded.id !== validated.id ||
      decoded.event !== validated.event ||
      Number(decoded.createdAt) !== createdAtSeconds
    )
      throw new Error("LiveKit webhook fields did not decode consistently");
    const providerEnvironment = environment.LIVEKIT_PROJECT_ENVIRONMENT;
    if (!providerEnvironment)
      throw new Error("LiveKit provider environment is missing");
    const isEgressEvent =
      validated.event === "egress_started" ||
      validated.event === "egress_updated" ||
      validated.event === "egress_ended";
    const egressId = decoded.egressInfo?.egressId;
    const egressRoomName = decoded.egressInfo?.roomName;
    if (isEgressEvent) {
      providerOpaqueIdSchema.parse(egressId);
      providerRoomNameSchema.parse(egressRoomName);
    }
    return {
      providerEnvironment,
      providerEventId: validated.id,
      event: validated.event,
      createdAtSeconds,
      payloadDigest: createHash("sha256").update(payload).digest("hex"),
      ...(decoded.room?.sid ? { roomSid: decoded.room.sid } : {}),
      ...(decoded.room?.name ? { roomName: decoded.room.name } : {}),
      ...(decoded.participant?.sid
        ? { participantSid: decoded.participant.sid }
        : {}),
      ...(decoded.participant?.identity
        ? { participantIdentity: decoded.participant.identity }
        : {}),
      ...(isEgressEvent && decoded.egressInfo && egressId && egressRoomName
        ? {
            egressId,
            roomName: egressRoomName,
            egressInfo: decoded.egressInfo,
          }
        : {}),
      ...(decoded.ingressInfo?.ingressId
        ? { ingressId: decoded.ingressInfo.ingressId }
        : {}),
    };
  } catch {
    throw new LiveKitWebhookError("LIVEKIT_WEBHOOK_INVALID");
  }
}
