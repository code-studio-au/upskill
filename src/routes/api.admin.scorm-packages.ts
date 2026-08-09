import { createFileRoute } from "@tanstack/react-router";
import {
  adminScormUploadQuerySchema,
  SCORM_MAX_ARCHIVE_BYTES,
} from "#/features/scorm/scorm-package.schema";
import { getAdministratorRequest } from "#/server/admin/admin-access.server";
import { getServerEnv } from "#/server/env.server";
import { ScormPackageValidationError } from "#/server/scorm/scorm-package-archive";
import {
  ScormPackageNotFoundError,
  stageScormPackageStream,
} from "#/server/scorm/scorm-package-ingestion.server";

const responseHeaders = { "Cache-Control": "no-store" };

function errorResponse(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: responseHeaders });
}

export const Route = createFileRoute("/api/admin/scorm-packages")({
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
        const contentType = request.headers
          .get("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase();
        if (contentType !== "application/zip")
          return errorResponse("invalid_content_type", 415);
        const rawLength = request.headers.get("content-length");
        if (!rawLength) return errorResponse("content_length_required", 411);
        const contentLength = Number(rawLength);
        if (
          !Number.isSafeInteger(contentLength) ||
          contentLength < 1 ||
          contentLength > SCORM_MAX_ARCHIVE_BYTES
        )
          return errorResponse("payload_too_large", 413);
        const url = new URL(request.url);
        const input = adminScormUploadQuerySchema.safeParse({
          title: url.searchParams.get("title"),
          packageId: url.searchParams.get("packageId") ?? undefined,
        });
        if (!input.success) return errorResponse("invalid_upload", 400);
        const administrator = await getAdministratorRequest();
        if (administrator.status === "unauthenticated")
          return errorResponse("unauthenticated", 401);
        if (administrator.status === "forbidden")
          return errorResponse("forbidden", 403);
        if (!request.body) return errorResponse("invalid_upload", 400);
        try {
          const staged = await stageScormPackageStream({
            actorUserId: administrator.user.id,
            archive: request.body,
            archiveBytes: contentLength,
            ...(input.data.packageId
              ? { packageId: input.data.packageId }
              : {}),
            title: input.data.title,
          });
          return Response.json(
            {
              status: "accepted",
              packageId: staged.packageId,
              packageVersionId: staged.packageVersionId,
              version: staged.version,
            },
            { status: 202, headers: responseHeaders },
          );
        } catch (error) {
          if (error instanceof ScormPackageNotFoundError)
            return errorResponse("package_not_found", 404);
          if (error instanceof ScormPackageValidationError)
            return errorResponse(
              error.code,
              error.code === "archive_too_large" ? 413 : 400,
            );
          console.error("Administrator SCORM upload failed", {
            error: error instanceof Error ? error.name : "UnknownError",
          });
          return errorResponse("upload_failed", 500);
        }
      },
    },
  },
});
