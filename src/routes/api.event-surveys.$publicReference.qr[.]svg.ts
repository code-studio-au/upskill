import { createFileRoute } from "@tanstack/react-router";
import { eventSurveyPublicReferenceSchema } from "#/features/event-operations/event-operations.schema";

const responseHeaders = {
  "Cache-Control": "private, no-store",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "X-Content-Type-Options": "nosniff",
};

export const Route = createFileRoute(
  "/api/event-surveys/$publicReference/qr.svg",
)({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const parsed = eventSurveyPublicReferenceSchema.safeParse(params);
        if (!parsed.success)
          return Response.json(
            { error: "invalid_reference" },
            { status: 400, headers: responseHeaders },
          );
        const { isEventSurveyPublicReferenceRenderable } =
          await import("#/server/events/event-survey-access.server");
        if (
          !(await isEventSurveyPublicReferenceRenderable(
            parsed.data.publicReference,
          ))
        )
          return Response.json(
            { error: "not_found" },
            { status: 404, headers: responseHeaders },
          );
        const { getServerEnv } = await import("#/server/env.server");
        const destination = new URL(
          `/event-surveys/${encodeURIComponent(parsed.data.publicReference)}`,
          getServerEnv().APP_ORIGIN,
        ).toString();
        const { toString } = await import("qrcode");
        const svg = await toString(destination, {
          type: "svg",
          errorCorrectionLevel: "M",
          margin: 4,
          width: 640,
          color: { dark: "#111827", light: "#ffffff" },
        });
        return new Response(svg, {
          headers: {
            ...responseHeaders,
            "Content-Type": "image/svg+xml; charset=utf-8",
          },
        });
      },
    },
  },
});
