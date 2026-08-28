import { createFileRoute } from "@tanstack/react-router";
import { encodeCsv, type CsvValue } from "#/server/reporting/csv";

const noStoreHeaders = { "Cache-Control": "no-store" };

export const Route = createFileRoute(
  "/api/admin/contracts/$enterpriseContractId/utilisation.csv",
)({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!/^[A-Za-z0-9_-]{1,255}$/u.test(params.enterpriseContractId))
          return Response.json(
            { error: "invalid_request" },
            { status: 400, headers: noStoreHeaders },
          );
        const { getAdministratorRequest } =
          await import("#/server/admin/admin-access.server");
        const request = await getAdministratorRequest();
        if (request.status !== "ready")
          return Response.json(
            { error: request.status },
            {
              status: request.status === "unauthenticated" ? 401 : 403,
              headers: noStoreHeaders,
            },
          );
        const { findAdminEnterpriseContractUtilisationReport } =
          await import("#/server/admin/admin-enterprise-contract.server");
        const report = await findAdminEnterpriseContractUtilisationReport(
          params.enterpriseContractId,
          request.user,
        );
        if (!report)
          return Response.json(
            { error: "not_found" },
            { status: 404, headers: noStoreHeaders },
          );
        const asOf = new Date().toISOString();
        const rows: Array<Array<CsvValue>> = [
          [
            "schema_version",
            "enterprise_contract_id",
            "contract_reference",
            "organisation",
            "learner_name",
            "verified_email",
            "claimed_at",
            "offering_type",
            "offering_title",
            "access_status",
            "started_at",
            "completed_at",
            "as_of",
          ],
          ...report.rows.map((row) => [
            "enterprise-contract-utilisation-v1",
            report.contract.id,
            report.contract.reference,
            report.contract.organizationName,
            row.learnerName,
            row.learnerEmail,
            row.claimedAt,
            row.offeringType,
            row.offeringTitle,
            row.accessStatus,
            row.startedAt,
            row.completedAt,
            asOf,
          ]),
        ];
        return new Response(encodeCsv(rows), {
          headers: {
            ...noStoreHeaders,
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`enterprise-contract-${report.contract.reference}-utilisation.csv`)}`,
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
