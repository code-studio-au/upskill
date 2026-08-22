import { createFileRoute } from "@tanstack/react-router";
import { logServerEvent } from "#/server/logging/server-logger";
import { handleTextBeeWebhook } from "#/server/notifications/textbee-webhook.server";

const MAX_WEBHOOK_BYTES = 262_144;
const responseHeaders = { "Cache-Control": "no-store" };

export const Route = createFileRoute("/api/textbee/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const declaredLength = Number(request.headers.get("content-length"));
        if (
          Number.isFinite(declaredLength) &&
          declaredLength > MAX_WEBHOOK_BYTES
        )
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
        const signature = request.headers.get("x-signature");
        if (!signature)
          return Response.json(
            { error: "invalid_webhook" },
            { status: 400, headers: responseHeaders },
          );

        try {
          const outcome = await handleTextBeeWebhook(
            payload,
            signature,
            request.headers.get("idempotency-key") ?? undefined,
          );
          return Response.json(
            { received: true, outcome },
            { headers: responseHeaders },
          );
        } catch (error) {
          if (
            error instanceof Error &&
            (error.message === "TEXTBEE_WEBHOOK_INVALID_SIGNATURE" ||
              error.message === "TEXTBEE_WEBHOOK_INVALID_PAYLOAD")
          )
            return Response.json(
              { error: "invalid_webhook" },
              { status: 400, headers: responseHeaders },
            );
          logServerEvent({
            level: "error",
            event: "textbee.webhook_processing_failed",
            error,
          });
          return Response.json(
            { error: "webhook_processing_failed" },
            { status: 500, headers: responseHeaders },
          );
        }
      },
    },
  },
});
