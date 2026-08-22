import { createFileRoute } from "@tanstack/react-router";
import { getPublishedCourseOfferingImage } from "#/server/catalog/catalog-offering-image.server";
import { logServerEvent } from "#/server/logging/server-logger";

const notFoundHeaders = {
  "Cache-Control": "public, max-age=60",
  "X-Content-Type-Options": "nosniff",
};

export const Route = createFileRoute(
  "/api/catalog/courses/$slug/cover-images/$assetId",
)({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          const image = await getPublishedCourseOfferingImage(params);
          if (image.status === "not-found")
            return new Response(null, {
              status: 404,
              headers: notFoundHeaders,
            });
          return new Response(image.bytes as BodyInit, {
            headers: {
              "Cache-Control": "public, max-age=31536000, immutable",
              "Content-Type": image.mediaType,
              ETag: `"${image.sha256}"`,
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch (error) {
          logServerEvent({
            level: "error",
            event: "catalog.offering_image_load_failed",
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
