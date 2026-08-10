import { createFileRoute } from "@tanstack/react-router";
import { z } from "#/validation/zod.server";
import { getRequestUser } from "#/server/auth/session.server";
import { getLearnerCompletionCertificate } from "#/server/certificate/learner-certificate.server";

const certificateIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);
const noStoreHeaders = { "Cache-Control": "private, no-store" };

export const Route = createFileRoute(
  "/api/learning/certificates/$certificateId",
)({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const certificateId = certificateIdSchema.safeParse(
          params.certificateId,
        );
        if (!certificateId.success)
          return Response.json(
            { error: "invalid_certificate" },
            { status: 400, headers: noStoreHeaders },
          );
        const user = await getRequestUser();
        if (!user)
          return Response.json(
            { error: "unauthenticated" },
            { status: 401, headers: noStoreHeaders },
          );
        const certificate = await getLearnerCompletionCertificate(
          certificateId.data,
          user,
        );
        if (certificate.status !== "ready")
          return Response.json(
            { error: certificate.status },
            {
              status: certificate.status === "not-found" ? 404 : 503,
              headers: noStoreHeaders,
            },
          );
        return new Response(certificate.bytes as BodyInit, {
          headers: {
            ...noStoreHeaders,
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(certificate.displayName)}`,
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
