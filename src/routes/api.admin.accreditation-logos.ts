import { createFileRoute } from "@tanstack/react-router";
import {
  ACCREDITATION_LOGO_MAX_BYTES,
  accreditationLogoUploadQuerySchema,
} from "#/features/shared/certificate-accreditation-upload.schema";
import { getAdministratorRequest } from "#/server/admin/admin-access.server";
import {
  AccreditationLogoValidationError,
  uploadAdminAccreditationLogo,
} from "#/server/admin/admin-accreditation-logo.server";
import { getServerEnv } from "#/server/env.server";
import { logServerEvent } from "#/server/logging/server-logger";

const responseHeaders = { "Cache-Control": "no-store" };

function errorResponse(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: responseHeaders });
}

export const Route = createFileRoute("/api/admin/accreditation-logos")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (
          request.headers.get("origin") !==
          new URL(getServerEnv().APP_ORIGIN).origin
        )
          return errorResponse("invalid_origin", 403);
        if (request.headers.get("content-encoding"))
          return errorResponse("unsupported_content_encoding", 415);
        const mediaType = request.headers
          .get("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase();
        if (mediaType !== "image/png" && mediaType !== "image/jpeg")
          return errorResponse("invalid_content_type", 415);
        const contentLength = Number(request.headers.get("content-length"));
        if (
          !Number.isSafeInteger(contentLength) ||
          contentLength < 1 ||
          contentLength > ACCREDITATION_LOGO_MAX_BYTES
        )
          return errorResponse("payload_too_large", 413);
        const url = new URL(request.url);
        const metadata = accreditationLogoUploadQuerySchema.safeParse({
          displayName: url.searchParams.get("displayName"),
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
          const logo = await uploadAdminAccreditationLogo({
            displayName: metadata.data.displayName,
            mediaType,
            bytes,
            administrator: administrator.user,
          });
          return Response.json(
            { status: "ready", logo },
            { status: 201, headers: responseHeaders },
          );
        } catch (error) {
          if (error instanceof AccreditationLogoValidationError)
            return errorResponse("invalid_image", 400);
          logServerEvent({
            level: "error",
            event: "accreditation_logo.admin_upload_failed",
            error,
            fields: { actorUserId: administrator.user.id },
          });
          return errorResponse("upload_failed", 500);
        }
      },
    },
  },
});
