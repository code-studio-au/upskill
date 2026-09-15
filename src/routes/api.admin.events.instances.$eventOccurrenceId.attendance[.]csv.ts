import { createFileRoute } from "@tanstack/react-router";
import {
  adminEventAttendanceFilterSchema,
  adminEventOccurrenceOperationsParamsSchema,
} from "#/features/admin-event/admin-event-operations.schema";

const noStoreHeaders = { "Cache-Control": "no-store" };

export const Route = createFileRoute(
  "/api/admin/events/instances/$eventOccurrenceId/attendance.csv",
)({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const path =
          adminEventOccurrenceOperationsParamsSchema.safeParse(params);
        const url = new URL(request.url);
        const filters = adminEventAttendanceFilterSchema.safeParse({
          q: url.searchParams.get("q") ?? "",
          sessionId: url.searchParams.get("sessionId") ?? "all",
          state: url.searchParams.get("state") ?? "all",
          evidence: url.searchParams.get("evidence") ?? "all",
        });
        if (!path.success || !filters.success)
          return Response.json(
            { error: "invalid_request" },
            { status: 400, headers: noStoreHeaders },
          );
        const { getAdministratorRequest } =
          await import("#/server/admin/admin-access.server");
        const administrator = await getAdministratorRequest();
        if (administrator.status !== "ready")
          return Response.json(
            { error: administrator.status },
            {
              status: administrator.status === "unauthenticated" ? 401 : 403,
              headers: noStoreHeaders,
            },
          );
        const { exportAdminEventAttendanceReport } =
          await import("#/server/admin/admin-event-attendance-report.server");
        const exported = await exportAdminEventAttendanceReport(
          path.data.eventOccurrenceId,
          filters.data,
          administrator.user,
        );
        if (!exported)
          return Response.json(
            { error: "not_found" },
            { status: 404, headers: noStoreHeaders },
          );

        return new Response(exported.body, {
          headers: {
            ...noStoreHeaders,
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`event-attendance-${exported.occurrenceId}.csv`)}`,
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
