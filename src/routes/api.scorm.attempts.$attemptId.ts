import { createFileRoute } from "@tanstack/react-router";
import {
  scormAttemptParamsSchema,
  scormOpaqueTokenSchema,
  scormProgressInputSchema,
} from "#/features/scorm/scorm.schema";
import {
  authorizeScormAttemptSession,
  recordScormProgress,
} from "#/server/scorm/scorm-attempt.server";
import {
  isLearningOrigin,
  readScormSessionCookie,
} from "#/server/scorm/scorm-http.server";

const MAX_PROGRESS_BYTES = 70_000;
const noStoreHeaders = { "Cache-Control": "no-store" };

function requestIdentity(request: Request, attemptId: string) {
  if (!isLearningOrigin(request)) return null;
  const params = scormAttemptParamsSchema.safeParse({ attemptId });
  if (!params.success) return null;
  const sessionToken = scormOpaqueTokenSchema.safeParse(
    readScormSessionCookie(request),
  );
  if (!sessionToken.success) return null;
  return { attemptId: params.data.attemptId, sessionToken: sessionToken.data };
}

export const Route = createFileRoute("/api/scorm/attempts/$attemptId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const identity = requestIdentity(request, params.attemptId);
        if (
          !identity ||
          !(await authorizeScormAttemptSession(
            identity.attemptId,
            identity.sessionToken,
          ))
        ) {
          return Response.json(
            { error: "attempt_unauthorized" },
            { status: 401, headers: noStoreHeaders },
          );
        }
        return Response.json(
          { attemptId: identity.attemptId, status: "authorized" },
          { headers: noStoreHeaders },
        );
      },
      POST: async ({ request, params }) => {
        const identity = requestIdentity(request, params.attemptId);
        if (!identity)
          return Response.json(
            { error: "attempt_unauthorized" },
            { status: 401, headers: noStoreHeaders },
          );
        if (request.headers.get("origin") !== new URL(request.url).origin)
          return Response.json(
            { error: "invalid_origin" },
            { status: 403, headers: noStoreHeaders },
          );
        const declaredLength = Number(request.headers.get("content-length"));
        if (
          Number.isFinite(declaredLength) &&
          declaredLength > MAX_PROGRESS_BYTES
        ) {
          return Response.json(
            { error: "payload_too_large" },
            { status: 413, headers: noStoreHeaders },
          );
        }
        const rawBody = await request.text();
        if (Buffer.byteLength(rawBody, "utf8") > MAX_PROGRESS_BYTES)
          return Response.json(
            { error: "payload_too_large" },
            { status: 413, headers: noStoreHeaders },
          );
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(rawBody);
        } catch {
          return Response.json(
            { error: "invalid_progress" },
            { status: 400, headers: noStoreHeaders },
          );
        }
        const progress = scormProgressInputSchema.safeParse(parsedJson);
        if (!progress.success)
          return Response.json(
            { error: "invalid_progress" },
            { status: 400, headers: noStoreHeaders },
          );
        const result = await recordScormProgress(
          identity.attemptId,
          identity.sessionToken,
          progress.data,
        );
        if (result === "unauthorized")
          return Response.json(
            { error: "attempt_unauthorized" },
            { status: 401, headers: noStoreHeaders },
          );
        return Response.json({ status: result }, { headers: noStoreHeaders });
      },
    },
  },
});
