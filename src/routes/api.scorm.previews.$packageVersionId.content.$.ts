import { createFileRoute } from "@tanstack/react-router";
import { adminScormPreviewParamsSchema } from "#/features/scorm/scorm-package.schema";
import { getServerEnv } from "#/server/env.server";
import {
  parseScormContentPath,
  parseScormRange,
  resolveScormContentType,
} from "#/server/scorm/scorm-content-path";
import {
  isLearningOrigin,
  scormResponseHeaders,
} from "#/server/scorm/scorm-http.server";
import { authorizedScormPreview } from "#/server/scorm/scorm-preview.server";
import { getObjectStream } from "#/server/storage/object-storage.server";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

function objectErrorStatus(error: unknown): number {
  if (typeof error !== "object" || error === null || !("name" in error))
    return 500;
  if (error.name === "NoSuchKey" || error.name === "NotFound") return 404;
  if (
    error.name === "InvalidRange" ||
    error.name === "RequestedRangeNotSatisfiable"
  )
    return 416;
  return 500;
}

export const Route = createFileRoute(
  "/api/scorm/previews/$packageVersionId/content/$",
)({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const headers = scormResponseHeaders(request, noStoreHeaders);
        const input = adminScormPreviewParamsSchema.safeParse(params);
        const path = parseScormContentPath(params._splat);
        if (!isLearningOrigin(request) || !input.success || !path)
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
        try {
          const object = await getObjectStream(
            getServerEnv().S3_LEARNING_CONTENT_BUCKET,
            `${player.contentPrefix}/${path}`,
            parseScormRange(request.headers.get("range")),
          );
          headers.set(
            "Content-Type",
            resolveScormContentType(path, object.contentType),
          );
          headers.set("Accept-Ranges", "bytes");
          if (object.contentLength !== undefined)
            headers.set("Content-Length", String(object.contentLength));
          if (object.contentRange)
            headers.set("Content-Range", object.contentRange);
          if (object.etag) headers.set("ETag", object.etag);
          return new Response(object.body, {
            status: object.contentRange ? 206 : 200,
            headers,
          });
        } catch (error) {
          const status = objectErrorStatus(error);
          if (status === 500) throw error;
          return new Response(null, { status, headers });
        }
      },
    },
  },
});
