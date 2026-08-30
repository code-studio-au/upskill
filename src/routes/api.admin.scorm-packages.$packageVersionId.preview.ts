import { createFileRoute } from "@tanstack/react-router";
import { adminScormPreviewParamsSchema } from "#/features/scorm/scorm-package.schema";
import { getAdministratorRequest } from "#/server/admin/admin-access.server";
import { getServerEnv } from "#/server/env.server";
import { logServerEvent } from "#/server/logging/server-logger";
import {
  findScormPreviewPlayer,
  issueScormPreviewToken,
} from "#/server/scorm/scorm-preview.server";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

export const Route = createFileRoute(
  "/api/admin/scorm-packages/$packageVersionId/preview",
)({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const input = adminScormPreviewParamsSchema.safeParse(params);
        if (!input.success)
          return new Response(null, { status: 404, headers: noStoreHeaders });
        const request = await getAdministratorRequest();
        if (request.status !== "ready")
          return Response.json(
            { error: request.status },
            {
              status: request.status === "unauthenticated" ? 401 : 403,
              headers: noStoreHeaders,
            },
          );
        if (!(await findScormPreviewPlayer(input.data.packageVersionId)))
          return new Response(null, { status: 404, headers: noStoreHeaders });
        const launchUrl = new URL(
          "/api/scorm/preview",
          getServerEnv().LEARNING_ORIGIN,
        );
        launchUrl.searchParams.set(
          "token",
          issueScormPreviewToken(input.data.packageVersionId),
        );
        logServerEvent({
          level: "info",
          event: "scorm.admin_preview_issued",
          fields: {
            actorUserId: request.user.id,
            entityType: "scorm_package_version",
            entityId: input.data.packageVersionId,
          },
        });
        return new Response(null, {
          status: 303,
          headers: { ...noStoreHeaders, Location: launchUrl.toString() },
        });
      },
    },
  },
});
