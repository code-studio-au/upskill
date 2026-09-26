import { createFileRoute } from "@tanstack/react-router";
import { offlineScormCourseActivationSchema } from "#/features/scorm/offline-scorm-activation";
import { getRequestAuthentication } from "#/server/auth/session.server";
import { getServerEnv } from "#/server/env.server";
import { readBoundedJsonRequest } from "#/server/http/bounded-json-request.server";
import { activateOfflineScormCourse } from "#/server/scorm/offline-scorm-course-activation.server";

const noStoreHeaders = { "Cache-Control": "no-store" };

export const Route = createFileRoute("/api/scorm/offline/activate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (
          request.headers.get("origin") !==
          new URL(getServerEnv().APP_ORIGIN).origin
        )
          return Response.json(
            { error: "invalid_origin" },
            { status: 403, headers: noStoreHeaders },
          );
        const body = await readBoundedJsonRequest(request, 8_192);
        if (body.status === "error")
          return Response.json(
            { error: body.error },
            { status: body.responseStatus, headers: noStoreHeaders },
          );
        const input = offlineScormCourseActivationSchema.safeParse(body.value);
        if (!input.success)
          return Response.json(
            { error: "invalid_activation" },
            { status: 400, headers: noStoreHeaders },
          );
        const authentication = await getRequestAuthentication(request.headers);
        if (!authentication)
          return Response.json(
            { error: "unauthenticated" },
            { status: 401, headers: noStoreHeaders },
          );
        const result = await activateOfflineScormCourse(
          input.data,
          authentication.user,
          authentication.sessionId,
        );
        return Response.json(result, {
          status:
            result.status === "ready-to-download"
              ? 200
              : result.reason === "session-unavailable"
                ? 401
                : result.reason === "activation-disabled"
                  ? 404
                  : result.reason === "not-found"
                    ? 404
                    : result.reason === "unavailable" ||
                        result.reason === "access-unavailable" ||
                        result.reason === "questionnaire-incomplete" ||
                        result.reason === "item-unavailable" ||
                        result.reason === "section-unreleased" ||
                        result.reason === "offline-writer-active"
                      ? 409
                      : 422,
          headers: noStoreHeaders,
        });
      },
    },
  },
});
