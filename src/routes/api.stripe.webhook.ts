import { createFileRoute } from "@tanstack/react-router";
import {
  constructStripeEvent,
  handleStripeEvent,
} from "#/server/checkout/stripe-webhook.server";

const MAX_WEBHOOK_BYTES = 1_048_576;
const responseHeaders = { "Cache-Control": "no-store" };

export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const declaredLength = Number(request.headers.get("content-length"));
        if (
          Number.isFinite(declaredLength) &&
          declaredLength > MAX_WEBHOOK_BYTES
        ) {
          return Response.json(
            { error: "payload_too_large" },
            { status: 413, headers: responseHeaders },
          );
        }

        const payload = Buffer.from(await request.arrayBuffer());
        if (payload.byteLength > MAX_WEBHOOK_BYTES) {
          return Response.json(
            { error: "payload_too_large" },
            { status: 413, headers: responseHeaders },
          );
        }
        const signature = request.headers.get("stripe-signature");
        if (!signature) {
          return Response.json(
            { error: "invalid_webhook" },
            { status: 400, headers: responseHeaders },
          );
        }

        let event;
        try {
          event = constructStripeEvent(payload, signature);
        } catch {
          return Response.json(
            { error: "invalid_webhook" },
            { status: 400, headers: responseHeaders },
          );
        }
        try {
          await handleStripeEvent(event);
          return Response.json(
            { received: true },
            { headers: responseHeaders },
          );
        } catch (error) {
          console.error("Stripe webhook processing failed", {
            error: error instanceof Error ? error.name : "UnknownError",
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
