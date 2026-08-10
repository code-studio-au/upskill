import { createFileRoute } from "@tanstack/react-router";
import {
  adminResourceUploadQuerySchema,
  adminResourceRemovalInputSchema,
  PDF_RESOURCE_MAX_BYTES,
} from "#/features/resource/resource.schema";
import { getAdministratorRequest } from "#/server/admin/admin-access.server";
import {
  PdfResourceValidationError,
  uploadAdminPdfResource,
} from "#/server/admin/admin-resource.server";
import { getServerEnv } from "#/server/env.server";
import { logServerEvent } from "#/server/logging/server-logger";

const responseHeaders = { "Cache-Control": "no-store" };

function errorResponse(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: responseHeaders });
}

export const Route = createFileRoute("/api/admin/resources")({
  server: {
    handlers: {
      DELETE: async ({ request }) => {
        if (
          request.headers.get("origin") !==
          new URL(getServerEnv().APP_ORIGIN).origin
        )
          return errorResponse("invalid_origin", 403);
        const url = new URL(request.url);
        const input = adminResourceRemovalInputSchema.safeParse({
          resourceVersionId: url.searchParams.get("resourceVersionId"),
        });
        if (!input.success) return errorResponse("invalid_removal", 400);
        const administrator = await getAdministratorRequest();
        if (administrator.status === "unauthenticated")
          return errorResponse("unauthenticated", 401);
        if (administrator.status === "forbidden")
          return errorResponse("forbidden", 403);
        const { removeAdminResourceVersion } =
          await import("#/server/admin/admin-resource.server");
        const removal = await removeAdminResourceVersion(
          input.data.resourceVersionId,
          administrator.user.id,
        );
        if (removal.status === "not-found")
          return errorResponse("resource_version_not_found", 404);
        if (removal.status === "in-use")
          return errorResponse("resource_version_in_use", 409);
        return new Response(null, { status: 204, headers: responseHeaders });
      },
      POST: async ({ request }) => {
        if (
          request.headers.get("origin") !==
          new URL(getServerEnv().APP_ORIGIN).origin
        )
          return errorResponse("invalid_origin", 403);
        if (request.headers.get("content-encoding"))
          return errorResponse("unsupported_content_encoding", 415);
        const contentType = request.headers
          .get("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase();
        if (contentType !== "application/pdf")
          return errorResponse("invalid_content_type", 415);
        const rawLength = request.headers.get("content-length");
        if (!rawLength) return errorResponse("content_length_required", 411);
        const contentLength = Number(rawLength);
        if (
          !Number.isSafeInteger(contentLength) ||
          contentLength < 1 ||
          contentLength > PDF_RESOURCE_MAX_BYTES
        )
          return errorResponse("payload_too_large", 413);
        const url = new URL(request.url);
        const metadata = adminResourceUploadQuerySchema.safeParse({
          title: url.searchParams.get("title"),
          description: url.searchParams.get("description") ?? "",
          displayName: url.searchParams.get("displayName"),
          resourceId: url.searchParams.get("resourceId") ?? undefined,
        });
        if (!metadata.success) return errorResponse("invalid_upload", 400);
        const administrator = await getAdministratorRequest();
        if (administrator.status === "unauthenticated")
          return errorResponse("unauthenticated", 401);
        if (administrator.status === "forbidden")
          return errorResponse("forbidden", 403);
        try {
          const bytes = new Uint8Array(await request.arrayBuffer());
          if (bytes.byteLength !== contentLength)
            return errorResponse("invalid_content_length", 400);
          const resource = await uploadAdminPdfResource({
            metadata: metadata.data,
            bytes,
            administrator: administrator.user,
          });
          return Response.json(
            { status: "ready", resource },
            { status: 201, headers: responseHeaders },
          );
        } catch (error) {
          if (error instanceof PdfResourceValidationError)
            return errorResponse(error.code, 400);
          logServerEvent({
            level: "error",
            event: "resource.admin_upload_failed",
            error,
            fields: { actorUserId: administrator.user.id },
          });
          return errorResponse("upload_failed", 500);
        }
      },
    },
  },
});
