import { createFileRoute } from "@tanstack/react-router";
import { getRequestUser } from "#/server/auth/session.server";
import { getLearnerEventCompletionCertificate } from "#/server/certificate/learner-certificate.server";
import { z } from "#/validation/zod.server";

const identifierSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_-]+$/);
const noStoreHeaders = { "Cache-Control": "private, no-store" };

export const Route = createFileRoute(
  "/api/learning/event-certificates/$eventParticipationId",
)({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const parsed = identifierSchema.safeParse(params.eventParticipationId);
        if (!parsed.success)
          return Response.json(
            { error: "invalid_participation" },
            { status: 400, headers: noStoreHeaders },
          );
        const user = await getRequestUser();
        if (!user)
          return Response.json(
            { error: "unauthenticated" },
            { status: 401, headers: noStoreHeaders },
          );
        const certificate = await getLearnerEventCompletionCertificate(
          parsed.data,
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
