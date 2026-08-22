import { createFileRoute } from "@tanstack/react-router";
import { getAdministratorRequest } from "#/server/admin/admin-access.server";
import { getAdminOfferingImage } from "#/server/admin/admin-offering-image.server";

const noStoreHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export const Route = createFileRoute("/api/admin/offering-images/$assetId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const administrator = await getAdministratorRequest();
        if (administrator.status === "unauthenticated")
          return new Response(null, { status: 401, headers: noStoreHeaders });
        if (administrator.status === "forbidden")
          return new Response(null, { status: 403, headers: noStoreHeaders });
        const image = await getAdminOfferingImage(params.assetId);
        if (image.status === "not-found")
          return new Response(null, { status: 404, headers: noStoreHeaders });
        return new Response(image.bytes as BodyInit, {
          headers: { ...noStoreHeaders, "Content-Type": image.mediaType },
        });
      },
    },
  },
});
