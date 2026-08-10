import { createFileRoute } from "@tanstack/react-router";
import {
  scormAttemptParamsSchema,
  scormOpaqueTokenSchema,
} from "#/features/scorm/scorm.schema";
import { getServerEnv } from "#/server/env.server";
import { findAuthorizedScormPlayer } from "#/server/scorm/scorm-attempt.server";
import {
  parseScormContentPath,
  parseScormRange,
  resolveScormContentType,
} from "#/server/scorm/scorm-content-path";
import {
  isLearningOrigin,
  readScormSessionCookie,
  scormResponseHeaders,
} from "#/server/scorm/scorm-http.server";
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
  "/api/scorm/attempts/$attemptId/content/$",
)({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const responseHeaders = scormResponseHeaders(request, noStoreHeaders);
        if (!isLearningOrigin(request))
          return new Response(null, { status: 404, headers: responseHeaders });
        const attempt = scormAttemptParamsSchema.safeParse(params);
        const path = parseScormContentPath(params._splat);
        const session = scormOpaqueTokenSchema.safeParse(
          readScormSessionCookie(request),
        );
        if (!attempt.success || !path || !session.success)
          return new Response(null, { status: 404, headers: responseHeaders });
        const player = await findAuthorizedScormPlayer(
          attempt.data.attemptId,
          session.data,
        );
        if (!player)
          return Response.json(
            { error: "attempt_unauthorized" },
            { status: 401, headers: responseHeaders },
          );
        try {
          const object = await getObjectStream(
            getServerEnv().S3_LEARNING_CONTENT_BUCKET,
            `${player.contentPrefix}/${path}`,
            parseScormRange(request.headers.get("range")),
          );
          const headers = responseHeaders;
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
          return new Response(null, { status, headers: responseHeaders });
        }
      },
    },
  },
});
