import { createFileRoute } from "@tanstack/react-router";
import { learnerResourceInputSchema } from "#/features/learning/learning.schema";
import { getRequestUser } from "#/server/auth/session.server";
import { getLearnerPdfResource } from "#/server/learning/learner-resource.server";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

export const Route = createFileRoute(
  "/api/learning/resources/$resourceVersionId",
)({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const url = new URL(request.url);
        const input = learnerResourceInputSchema.safeParse({
          resourceVersionId: params.resourceVersionId,
          enrollmentId: url.searchParams.get("enrollmentId"),
          eventParticipationId: url.searchParams.get("eventParticipationId"),
          eventTemplateVersionItemId: url.searchParams.get(
            "eventTemplateVersionItemId",
          ),
        });
        if (!input.success)
          return Response.json(
            { error: "invalid_resource" },
            { status: 400, headers: noStoreHeaders },
          );
        const user = await getRequestUser();
        if (!user)
          return Response.json(
            { error: "unauthenticated" },
            { status: 401, headers: noStoreHeaders },
          );
        const resource = await getLearnerPdfResource(input.data, user);
        if (resource.status !== "ready")
          return Response.json(
            { error: resource.status },
            {
              status: resource.status === "not-found" ? 404 : 503,
              headers: noStoreHeaders,
            },
          );
        return new Response(resource.bytes as BodyInit, {
          headers: {
            ...noStoreHeaders,
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(resource.displayName)}`,
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
