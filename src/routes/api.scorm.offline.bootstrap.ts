import { createFileRoute } from "@tanstack/react-router";
import { getRequestUser } from "#/server/auth/session.server";
import { getServerEnv } from "#/server/env.server";

const noStoreHeaders = { "Cache-Control": "no-store" };

export const Route = createFileRoute("/api/scorm/offline/bootstrap")({
  server: {
    handlers: {
      GET: async () => {
        const user = await getRequestUser();
        if (!user)
          return Response.json(
            { error: "unauthenticated" },
            { status: 401, headers: noStoreHeaders },
          );
        const environment = getServerEnv();
        return Response.json(
          {
            schemaVersion: 1,
            learner: { id: user.id, name: user.name },
            learningRuntimeUrl: new URL(
              "/api/scorm/offline-runtime/frame.html",
              environment.LEARNING_ORIGIN,
            ).href,
          },
          { headers: noStoreHeaders },
        );
      },
    },
  },
});
