import { createFileRoute } from "@tanstack/react-router";
import { getRequestUser } from "#/server/auth/session.server";
import { getLearnerCompletionCertificate } from "#/server/certificate/learner-certificate.server";
import { z } from "#/validation/zod.server";

const enrollmentIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);
const noStoreHeaders = { "Cache-Control": "private, no-store" };

export const Route = createFileRoute(
  "/api/learning/certificates/$enrollmentId",
)({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const enrollmentId = enrollmentIdSchema.safeParse(params.enrollmentId);
        if (!enrollmentId.success)
          return Response.json(
            { error: "invalid_enrollment" },
            { status: 400, headers: noStoreHeaders },
          );
        const user = await getRequestUser();
        if (!user)
          return Response.json(
            { error: "unauthenticated" },
            { status: 401, headers: noStoreHeaders },
          );
        const certificate = await getLearnerCompletionCertificate(
          enrollmentId.data,
          user,
        );
        if (certificate.status !== "generated")
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
