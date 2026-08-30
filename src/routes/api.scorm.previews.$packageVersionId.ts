import { createFileRoute } from "@tanstack/react-router";
import { adminScormPreviewParamsSchema } from "#/features/scorm/scorm-package.schema";
import {
  isLearningOrigin,
  scormResponseHeaders,
} from "#/server/scorm/scorm-http.server";
import {
  buildScormPreviewShell,
  SCORM_RUNTIME_STYLES,
} from "#/server/scorm/scorm-player-shell";
import { SCORM_12_PREVIEW_RUNTIME } from "#/server/scorm/scorm-runtime";
import { authorizedScormPreview } from "#/server/scorm/scorm-preview.server";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

export const Route = createFileRoute("/api/scorm/previews/$packageVersionId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const headers = scormResponseHeaders(request, noStoreHeaders);
        const input = adminScormPreviewParamsSchema.safeParse(params);
        if (!isLearningOrigin(request) || !input.success)
          return new Response(null, { status: 404, headers });
        const player = await authorizedScormPreview(
          request,
          input.data.packageVersionId,
        );
        if (!player)
          return Response.json(
            { error: "preview_unauthorized" },
            { status: 401, headers },
          );
        const url = new URL(request.url);
        if (url.searchParams.get("runtime") === "script")
          return new Response(SCORM_12_PREVIEW_RUNTIME, {
            headers: {
              ...Object.fromEntries(headers),
              "Content-Type": "text/javascript; charset=utf-8",
            },
          });
        if (url.searchParams.get("runtime") === "style")
          return new Response(SCORM_RUNTIME_STYLES, {
            headers: {
              ...Object.fromEntries(headers),
              "Content-Type": "text/css; charset=utf-8",
            },
          });
        if (url.searchParams.get("view") === "state")
          return Response.json({ launchPath: player.launchPath }, { headers });
        return new Response(buildScormPreviewShell(player.packageVersionId), {
          headers: {
            ...Object.fromEntries(headers),
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      },
    },
  },
});
