import { createFileRoute } from "@tanstack/react-router";
import { accessOwnerGrantInputSchema } from "#/features/access-owner/access-owner.schema";
import { encodeCsv, type CsvValue } from "#/server/reporting/csv";

const noStoreHeaders = { "Cache-Control": "no-store" };
export const Route = createFileRoute(
  "/api/access-management/$accessGrantId/learners.csv",
)({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const parsed = accessOwnerGrantInputSchema.safeParse(params);
        if (!parsed.success)
          return Response.json(
            { error: "invalid_request" },
            { status: 400, headers: noStoreHeaders },
          );
        const { getRequestUser } = await import("#/server/auth/session.server");
        const user = await getRequestUser();
        if (!user)
          return Response.json(
            { error: "unauthenticated" },
            { status: 401, headers: noStoreHeaders },
          );
        const { findAccessOwnerDashboard } =
          await import("#/server/access/access-owner.server");
        const dashboard = await findAccessOwnerDashboard(user);
        const grant = dashboard?.grants.find(
          (candidate) => candidate.id === parsed.data.accessGrantId,
        );
        if (!grant)
          return Response.json(
            { error: "forbidden" },
            { status: 403, headers: noStoreHeaders },
          );
        const asOf = new Date().toISOString();
        const rows: Array<Array<CsvValue>> = [
          [
            "schema_version",
            "access_grant_id",
            "organisation",
            "course",
            "code_number",
            "learner_name",
            "redemption_email",
            "enrolled_at",
            "progress_percent",
            "completion_state",
            "as_of",
          ],
          ...grant.learners.map((learner) => [
            "access-owner-learners-v1",
            grant.id,
            grant.organizationName,
            grant.offeringTitle,
            learner.codeNumber,
            learner.name,
            learner.email,
            learner.enrolledAt,
            learner.progressPercent,
            learner.completionState,
            asOf,
          ]),
        ];
        return new Response(encodeCsv(rows), {
          headers: {
            ...noStoreHeaders,
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`access-grant-${grant.id}-learners.csv`)}`,
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
