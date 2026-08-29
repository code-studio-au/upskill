import { createFileRoute } from "@tanstack/react-router";
import {
  isLearningOrigin,
  scormResponseHeaders,
} from "#/server/scorm/scorm-http.server";
import {
  findScormPreviewPlayer,
  scormPreviewCookie,
  verifyScormPreviewToken,
} from "#/server/scorm/scorm-preview.server";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

export const Route = createFileRoute("/api/scorm/preview")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const headers = scormResponseHeaders(request, noStoreHeaders);
        if (!isLearningOrigin(request))
          return new Response(null, { status: 404, headers });
        const token = new URL(request.url).searchParams.get("token");
        const claims = token ? verifyScormPreviewToken(token) : null;
        if (
          !token ||
          !claims ||
          !(await findScormPreviewPlayer(claims.packageVersionId))
        )
          return Response.json(
            { error: "preview_expired" },
            { status: 410, headers },
          );
        headers.set(
          "Location",
          `/api/scorm/previews/${encodeURIComponent(claims.packageVersionId)}`,
        );
        headers.append("Set-Cookie", scormPreviewCookie(token));
        return new Response(null, { status: 303, headers });
      },
    },
  },
});
