import { createFileRoute } from "@tanstack/react-router";
import { logServerEvent } from "#/server/logging/server-logger";
import { ingestVerifiedLiveKitRecordingWebhook } from "#/server/livekit/livekit-recording-webhook.server";
import {
  LiveKitWebhookError,
  verifyLiveKitWebhook,
} from "#/server/livekit/livekit-webhook.server";

const MAX_WEBHOOK_BYTES = 262_144;
const responseHeaders = { "Cache-Control": "no-store" };

export async function handleLiveKitWebhookRequest(
  request: Request,
): Promise<Response> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/webhook+json")
    return Response.json(
      { error: "unsupported_media_type" },
      { status: 415, headers: responseHeaders },
    );

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES)
    return Response.json(
      { error: "payload_too_large" },
      { status: 413, headers: responseHeaders },
    );

  const payload = Buffer.from(await request.arrayBuffer());
  if (payload.byteLength > MAX_WEBHOOK_BYTES)
    return Response.json(
      { error: "payload_too_large" },
      { status: 413, headers: responseHeaders },
    );

  try {
    const event = await verifyLiveKitWebhook(
      payload,
      request.headers.get("authorization"),
    );
    const outcome = await ingestVerifiedLiveKitRecordingWebhook(event);
    if (outcome.status !== "unsupported") {
      logServerEvent({
        level: "info",
        event: "livekit.recording_webhook_received",
        fields: {
          providerEventId: event.providerEventId,
          providerEvent: event.event,
          ingestionStatus: outcome.status,
        },
      });
      return Response.json(
        { received: true },
        { status: 200, headers: responseHeaders },
      );
    }
    logServerEvent({
      level: "warn",
      event: "livekit.webhook_ingestion_not_ready",
      fields: {
        providerEventId: event.providerEventId,
        providerEvent: event.event,
      },
    });
    // Participant evidence belongs to Slice 7a. Ask LiveKit to retry rather
    // than acknowledging and silently discarding those valid lifecycle events.
    return Response.json(
      { error: "webhook_ingestion_not_ready" },
      {
        status: 503,
        headers: { ...responseHeaders, "Retry-After": "60" },
      },
    );
  } catch (error) {
    if (
      error instanceof LiveKitWebhookError &&
      error.code === "LIVEKIT_WEBHOOK_NOT_CONFIGURED"
    )
      return Response.json(
        { error: "not_found" },
        { status: 404, headers: responseHeaders },
      );
    if (
      error instanceof LiveKitWebhookError &&
      error.code === "LIVEKIT_WEBHOOK_INVALID"
    )
      return Response.json(
        { error: "invalid_webhook" },
        { status: 401, headers: responseHeaders },
      );
    logServerEvent({
      level: "error",
      event: "livekit.webhook_processing_failed",
      error,
    });
    return Response.json(
      { error: "webhook_processing_failed" },
      { status: 500, headers: responseHeaders },
    );
  }
}

export const Route = createFileRoute("/api/livekit/webhook")({
  server: {
    handlers: { POST: ({ request }) => handleLiveKitWebhookRequest(request) },
  },
});
