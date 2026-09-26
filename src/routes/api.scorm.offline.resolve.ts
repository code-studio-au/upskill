import { createFileRoute } from "@tanstack/react-router";
import { offlineScormResolutionRequestSchema } from "#/features/scorm/offline-scorm-activation";
import { getRequestUser } from "#/server/auth/session.server";
import { getServerEnv } from "#/server/env.server";
import { readBoundedJsonRequest } from "#/server/http/bounded-json-request.server";
import { resolveOfflineScormCourseEntitlement } from "#/server/scorm/offline-scorm-lifecycle.server";

const noStoreHeaders = { "Cache-Control": "no-store" };

export const Route = createFileRoute("/api/scorm/offline/resolve")({
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
        const body = await readBoundedJsonRequest(request, 2_048);
        if (body.status === "error")
          return Response.json(
            { error: body.error },
            { status: body.responseStatus, headers: noStoreHeaders },
          );
        const input = offlineScormResolutionRequestSchema.safeParse(body.value);
        if (!input.success)
          return Response.json(
            { error: "invalid_resolution" },
            { status: 400, headers: noStoreHeaders },
          );
        const user = await getRequestUser();
        if (!user)
          return Response.json(
            { error: "unauthenticated" },
            { status: 401, headers: noStoreHeaders },
          );
        const result = await resolveOfflineScormCourseEntitlement(
          input.data,
          user,
        );
        return Response.json(result, {
          status: result.status === "cleanup-required" ? 200 : 409,
          headers: noStoreHeaders,
        });
      },
    },
  },
});
