import { createFileRoute } from "@tanstack/react-router";
import { getRequestUser } from "#/server/auth/session.server";
import { getServerEnv } from "#/server/env.server";
import {
  hasRetainedOfflineScormServerState,
  listOfflineScormCourseRecoveryInventory,
} from "#/server/scorm/offline-scorm-inventory.server";

const noStoreHeaders = { "Cache-Control": "no-store" };
const internalIdPattern = /^[A-Za-z0-9_-]{1,255}$/u;
const maximumRequestedEntitlements = 32;

export const Route = createFileRoute("/api/scorm/offline/bootstrap")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await getRequestUser();
        if (!user)
          return Response.json(
            { error: "unauthenticated" },
            { status: 401, headers: noStoreHeaders },
          );
        const requestedEntitlementIds = [
          ...new Set(new URL(request.url).searchParams.getAll("entitlementId")),
        ];
        if (
          requestedEntitlementIds.length > maximumRequestedEntitlements ||
          requestedEntitlementIds.some(
            (entitlementId) => !internalIdPattern.test(entitlementId),
          )
        )
          return Response.json(
            { error: "invalid_entitlement_inventory" },
            { status: 400, headers: noStoreHeaders },
          );
        const environment = getServerEnv();
        const [hasRetainedServerState, retainedCourses] = await Promise.all([
          hasRetainedOfflineScormServerState(user.id),
          listOfflineScormCourseRecoveryInventory({
            requestedEntitlementIds,
            userId: user.id,
          }),
        ]);
        return Response.json(
          {
            schemaVersion: 1,
            learner: { id: user.id, name: user.name },
            learningRuntimeUrl: new URL(
              "/api/scorm/offline-runtime/frame.html",
              environment.LEARNING_ORIGIN,
            ).href,
            hasRetainedServerState,
            retainedCourses,
          },
          { headers: noStoreHeaders },
        );
      },
    },
  },
});
