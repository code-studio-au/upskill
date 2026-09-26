import { createFileRoute } from "@tanstack/react-router";
import { offlineScormCleanupConfirmationSchema } from "#/features/scorm/offline-scorm-activation";
import { getRequestUser } from "#/server/auth/session.server";
import { getServerEnv } from "#/server/env.server";
import { readBoundedJsonRequest } from "#/server/http/bounded-json-request.server";
import { confirmOfflineScormPackageCleanup } from "#/server/scorm/offline-scorm-lifecycle.server";

const noStoreHeaders = { "Cache-Control": "no-store" };

export const Route = createFileRoute("/api/scorm/offline/cleanup")({
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
        const input = offlineScormCleanupConfirmationSchema.safeParse(
          body.value,
        );
        if (!input.success)
          return Response.json(
            { error: "invalid_cleanup" },
            { status: 400, headers: noStoreHeaders },
          );
        const user = await getRequestUser();
        if (!user)
          return Response.json(
            { error: "unauthenticated" },
            { status: 401, headers: noStoreHeaders },
          );
        const result = await confirmOfflineScormPackageCleanup(
          input.data,
          user,
        );
        return Response.json(result, {
          status: result.status === "cleared" ? 200 : 409,
          headers: noStoreHeaders,
        });
      },
    },
  },
});
