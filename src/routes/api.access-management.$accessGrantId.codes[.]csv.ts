import { createFileRoute } from "@tanstack/react-router";
import { accessOwnerGrantInputSchema } from "#/features/access-owner/access-owner.schema";
import { encodeCsv, type CsvValue } from "#/server/reporting/csv";

const noStoreHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

export const Route = createFileRoute(
  "/api/access-management/$accessGrantId/codes.csv",
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
        const { exportAccessOwnerCodes } =
          await import("#/server/access/access-owner.server");
        const result = await exportAccessOwnerCodes(
          parsed.data.accessGrantId,
          user,
        );
        if (result.status !== "ready")
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
            "access_code",
            "status",
            "redeemed_at",
            "learner_name",
            "redemption_email",
            "as_of",
          ],
          ...result.data.codes.map((code) => [
            "access-owner-codes-v1",
            result.data.accessGrantId,
            result.data.organizationName,
            result.data.offeringTitle,
            code.codeNumber,
            code.accessCode,
            code.status,
            code.redeemedAt,
            code.learnerName,
            code.redemptionEmail,
            asOf,
          ]),
        ];
        return new Response(encodeCsv(rows), {
          headers: {
            ...noStoreHeaders,
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`access-grant-${result.data.accessGrantId}-codes.csv`)}`,
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
