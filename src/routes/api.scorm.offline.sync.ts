import { createFileRoute } from "@tanstack/react-router";
import { offlineScormSyncRequestSchema } from "#/features/scorm/offline-scorm-activation";
import { getRequestUser } from "#/server/auth/session.server";
import { getServerEnv } from "#/server/env.server";
import { readBoundedJsonRequest } from "#/server/http/bounded-json-request.server";
import { reconcileOfflineScormProgress } from "#/server/scorm/offline-scorm-reconciliation.server";

const noStoreHeaders = { "Cache-Control": "no-store" };

export const Route = createFileRoute("/api/scorm/offline/sync")({
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
        const body = await readBoundedJsonRequest(request, 1_200_000);
        if (body.status === "error")
          return Response.json(
            { error: body.error },
            { status: body.responseStatus, headers: noStoreHeaders },
          );
        const input = offlineScormSyncRequestSchema.safeParse(body.value);
        if (!input.success)
          return Response.json(
            { error: "invalid_sync" },
            { status: 400, headers: noStoreHeaders },
          );
        const user = await getRequestUser();
        if (!user)
          return Response.json(
            { error: "unauthenticated" },
            { status: 401, headers: noStoreHeaders },
          );
        const result = await reconcileOfflineScormProgress(
          input.data.batch,
          user,
        );
        return Response.json(result, {
          status:
            result.status === "denied"
              ? result.reason === "entitlement_unavailable"
                ? 404
                : 403
              : result.status === "conflict"
                ? 409
                : 200,
          headers: noStoreHeaders,
        });
      },
    },
  },
});
