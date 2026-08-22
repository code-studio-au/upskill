import { createFileRoute } from "@tanstack/react-router";
import { getPublishedCourseAccreditationLogo } from "#/server/catalog/catalog-accreditation-logo.server";
import { logServerEvent } from "#/server/logging/server-logger";

const notFoundHeaders = {
  "Cache-Control": "public, max-age=60",
  "X-Content-Type-Options": "nosniff",
};

export const Route = createFileRoute(
  "/api/catalog/courses/$slug/accreditation-logos/$assetId",
)({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          const logo = await getPublishedCourseAccreditationLogo(params);
          if (logo.status === "not-found")
            return new Response(null, {
              status: 404,
              headers: notFoundHeaders,
            });
          return new Response(logo.bytes as BodyInit, {
            headers: {
              "Cache-Control": "public, max-age=31536000, immutable",
              "Content-Type": logo.mediaType,
              ETag: `"${logo.sha256}"`,
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch (error) {
          logServerEvent({
            level: "error",
            event: "catalog.accreditation_logo_load_failed",
            error,
            fields: { entityId: params.assetId },
          });
          return new Response(null, {
            status: 503,
            headers: { "Cache-Control": "no-store" },
          });
        }
      },
    },
  },
});
