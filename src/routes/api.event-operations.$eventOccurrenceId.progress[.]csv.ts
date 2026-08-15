import { createFileRoute } from "@tanstack/react-router";
import {
  eventOperationsParamsSchema,
  eventProgressFilterSchema,
} from "#/features/event-operations/event-operations.schema";
import { filterEventParticipantProgress } from "#/features/event-operations/event-progress";
import { encodeCsv, type CsvValue } from "#/server/reporting/csv";

const noStoreHeaders = { "Cache-Control": "no-store" };

export const Route = createFileRoute(
  "/api/event-operations/$eventOccurrenceId/progress.csv",
)({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const path = eventOperationsParamsSchema.safeParse(params);
        const url = new URL(request.url);
        const filters = eventProgressFilterSchema.safeParse({
          q: url.searchParams.get("q") ?? "",
          state: url.searchParams.get("state") ?? "all",
        });
        if (!path.success || !filters.success)
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
        const { getEventOperationsAccess } =
          await import("#/server/events/event-operations-access.server");
        const access = await getEventOperationsAccess(
          user,
          path.data.eventOccurrenceId,
        );
        if (!access)
          return Response.json(
            { error: "forbidden" },
            { status: 403, headers: noStoreHeaders },
          );
        const { findEventOperationsWorkspace } =
          await import("#/server/events/event-operations.server");
        const workspace = await findEventOperationsWorkspace(
          path.data.eventOccurrenceId,
          access,
        );
        if (!workspace)
          return Response.json(
            { error: "not_found" },
            { status: 404, headers: noStoreHeaders },
          );
        if (!workspace.access.canViewProgress)
          return Response.json(
            { error: "forbidden" },
            { status: 403, headers: noStoreHeaders },
          );
        const participants = filterEventParticipantProgress(
          workspace.participantProgress,
          filters.data,
        );
        const asOf = new Date().toISOString();
        const rows: Array<Array<CsvValue>> = [
          [
            "schema_version",
            "event_occurrence_id",
            "event_participation_id",
            "participant_name",
            "participant_email",
            "participation_region",
            "overall_state",
            "completed_at",
            "section_id",
            "section_title",
            "section_phase",
            "section_state",
            "section_release_at",
            "completed_items",
            "total_items",
            "as_of",
          ],
          ...participants.flatMap((participant) =>
            participant.sections.map((section) => [
              "event-section-progress-v1",
              workspace.occurrence.id,
              participant.eventParticipationId,
              participant.name,
              participant.email,
              participant.regionName,
              participant.state,
              participant.completedAt,
              section.id,
              section.title,
              section.phase,
              section.state,
              section.releaseAt,
              section.completedItems,
              section.totalItems,
              asOf,
            ]),
          ),
        ];
        const body = encodeCsv(rows);
        return new Response(body, {
          headers: {
            ...noStoreHeaders,
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`event-section-progress-${workspace.occurrence.id}.csv`)}`,
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
