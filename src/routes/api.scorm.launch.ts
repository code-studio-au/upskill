import { createFileRoute } from "@tanstack/react-router";
import { scormOpaqueTokenSchema } from "#/features/scorm/scorm.schema";
import {
  isLearningOrigin,
  scormResponseHeaders,
  scormSessionCookie,
} from "#/server/scorm/scorm-http.server";
import { exchangeScormLaunchToken } from "#/server/scorm/scorm-attempt.server";

const noStoreHeaders = { "Cache-Control": "no-store" };

export const Route = createFileRoute("/api/scorm/launch")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const responseHeaders = scormResponseHeaders(request, noStoreHeaders);
        if (!isLearningOrigin(request))
          return new Response(null, { status: 404, headers: responseHeaders });
        const token = scormOpaqueTokenSchema.safeParse(
          new URL(request.url).searchParams.get("token"),
        );
        if (!token.success)
          return Response.json(
            { error: "invalid_launch" },
            { status: 400, headers: responseHeaders },
          );
        const exchange = await exchangeScormLaunchToken(token.data);
        if (!exchange)
          return Response.json(
            { error: "launch_expired" },
            { status: 410, headers: responseHeaders },
          );

        const headers = responseHeaders;
        headers.set("Location", `/api/scorm/attempts/${exchange.attemptId}`);
        headers.append("Set-Cookie", scormSessionCookie(exchange.sessionToken));
        return new Response(null, { status: 303, headers });
      },
    },
  },
});
