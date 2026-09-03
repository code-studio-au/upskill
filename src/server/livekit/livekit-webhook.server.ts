import "@tanstack/react-start/server-only";

import { WebhookReceiver } from "livekit-server-sdk";
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

const liveKitWebhookPayloadSchema = z.looseObject({
  id: z.uuid(),
  createdAt: z.union([
    z.number().int().nonnegative(),
    z.string().regex(/^\d+$/u),
  ]),
  event: z.enum(liveKitWebhookEventNames),
});

export interface VerifiedLiveKitWebhook {
  providerEventId: string;
  event: (typeof liveKitWebhookEventNames)[number];
  createdAtSeconds: number;
  roomSid?: string;
  roomName?: string;
  participantSid?: string;
  participantIdentity?: string;
  egressId?: string;
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
      decoded.id !== validated.id ||
      decoded.event !== validated.event ||
      Number(decoded.createdAt) !== createdAtSeconds
    )
      throw new Error("LiveKit webhook fields did not decode consistently");
    return {
      providerEventId: validated.id,
      event: validated.event,
      createdAtSeconds,
      ...(decoded.room?.sid ? { roomSid: decoded.room.sid } : {}),
      ...(decoded.room?.name ? { roomName: decoded.room.name } : {}),
      ...(decoded.participant?.sid
        ? { participantSid: decoded.participant.sid }
        : {}),
      ...(decoded.participant?.identity
        ? { participantIdentity: decoded.participant.identity }
        : {}),
      ...(decoded.egressInfo?.egressId
        ? { egressId: decoded.egressInfo.egressId }
        : {}),
      ...(decoded.ingressInfo?.ingressId
        ? { ingressId: decoded.ingressInfo.ingressId }
        : {}),
    };
  } catch {
    throw new LiveKitWebhookError("LIVEKIT_WEBHOOK_INVALID");
  }
}
