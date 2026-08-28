import { createFileRoute } from "@tanstack/react-router";
import { encodeCsv, type CsvValue } from "#/server/reporting/csv";

const noStoreHeaders = { "Cache-Control": "no-store" };

export const Route = createFileRoute(
  "/api/access-management/contracts/$enterpriseContractId/utilisation.csv",
)({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!/^[A-Za-z0-9_-]{1,255}$/u.test(params.enterpriseContractId))
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
        const {
          findAccessOwnerDashboard,
          recordEnterpriseContractReportExport,
        } = await import("#/server/access/access-owner.server");
        const dashboard = await findAccessOwnerDashboard(user);
        const contract = dashboard?.contracts.find(
          (candidate) => candidate.id === params.enterpriseContractId,
        );
        if (
          !contract ||
          !(await recordEnterpriseContractReportExport(contract.id, user))
        )
          return Response.json(
            { error: "forbidden" },
            { status: 403, headers: noStoreHeaders },
          );
        const { getDatabase } = await import("#/server/db/database.server");
        const { findEnterpriseContractUtilisationReport } =
          await import("#/server/enterprise/enterprise-contract-report.server");
        const report = await findEnterpriseContractUtilisationReport(
          getDatabase(),
          contract.id,
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
            contract.id,
            contract.reference,
            contract.organizationName,
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
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`enterprise-contract-${contract.reference}-utilisation.csv`)}`,
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
