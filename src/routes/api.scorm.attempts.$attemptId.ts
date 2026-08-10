import { createFileRoute } from "@tanstack/react-router";
import {
  scormAttemptParamsSchema,
  scormOpaqueTokenSchema,
  scormProgressInputSchema,
} from "#/features/scorm/scorm.schema";
import {
  findAuthorizedScormPlayer,
  recordScormProgress,
} from "#/server/scorm/scorm-attempt.server";
import {
  isLearningOrigin,
  readScormSessionCookie,
  scormResponseHeaders,
} from "#/server/scorm/scorm-http.server";
import {
  buildScormPlayerShell,
  SCORM_RUNTIME_STYLES,
} from "#/server/scorm/scorm-player-shell";
import { SCORM_12_RUNTIME } from "#/server/scorm/scorm-runtime";

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
        const responseHeaders = scormResponseHeaders(request, noStoreHeaders);
        const identity = requestIdentity(request, params.attemptId);
        const player = identity
          ? await findAuthorizedScormPlayer(
              identity.attemptId,
              identity.sessionToken,
            )
          : null;
        if (!identity || !player) {
          return Response.json(
            { error: "attempt_unauthorized" },
            { status: 401, headers: responseHeaders },
          );
        }
        const requestUrl = new URL(request.url);
        if (requestUrl.searchParams.get("runtime") === "script")
          return new Response(SCORM_12_RUNTIME, {
            headers: {
              ...Object.fromEntries(responseHeaders),
              "Content-Type": "text/javascript; charset=utf-8",
            },
          });
        if (requestUrl.searchParams.get("runtime") === "style")
          return new Response(SCORM_RUNTIME_STYLES, {
            headers: {
              ...Object.fromEntries(responseHeaders),
              "Content-Type": "text/css; charset=utf-8",
            },
          });
        if (requestUrl.searchParams.get("view") === "state")
          return Response.json(
            { ...player.state, launchPath: player.launchPath },
            { headers: responseHeaders },
          );
        return new Response(buildScormPlayerShell(player), {
          headers: {
            ...Object.fromEntries(responseHeaders),
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      },
      POST: async ({ request, params }) => {
        const responseHeaders = scormResponseHeaders(request, noStoreHeaders);
        const identity = requestIdentity(request, params.attemptId);
        if (!identity)
          return Response.json(
            { error: "attempt_unauthorized" },
            { status: 401, headers: responseHeaders },
          );
        if (request.headers.get("origin") !== new URL(request.url).origin)
          return Response.json(
            { error: "invalid_origin" },
            { status: 403, headers: responseHeaders },
          );
        const declaredLength = Number(request.headers.get("content-length"));
        if (
          Number.isFinite(declaredLength) &&
          declaredLength > MAX_PROGRESS_BYTES
        ) {
          return Response.json(
            { error: "payload_too_large" },
            { status: 413, headers: responseHeaders },
          );
        }
        const rawBody = await request.text();
        if (Buffer.byteLength(rawBody, "utf8") > MAX_PROGRESS_BYTES)
          return Response.json(
            { error: "payload_too_large" },
            { status: 413, headers: responseHeaders },
          );
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(rawBody);
        } catch {
          return Response.json(
            { error: "invalid_progress" },
            { status: 400, headers: responseHeaders },
          );
        }
        const progress = scormProgressInputSchema.safeParse(parsedJson);
        if (!progress.success)
          return Response.json(
            { error: "invalid_progress" },
            { status: 400, headers: responseHeaders },
          );
        const result = await recordScormProgress(
          identity.attemptId,
          identity.sessionToken,
          progress.data,
        );
        if (result === "unauthorized")
          return Response.json(
            { error: "attempt_unauthorized" },
            { status: 401, headers: responseHeaders },
          );
        return Response.json({ status: result }, { headers: responseHeaders });
      },
    },
  },
});
