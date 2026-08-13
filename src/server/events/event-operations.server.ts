import "@tanstack/react-start/server-only";

import type {
  AssignedEventOperationsSummary,
  EventOperationsWorkspace,
} from "#/features/event-operations/event-operations.schema";
import { findAdminEventOccurrenceOperations } from "#/server/admin/admin-event-operations.server";
import { getDatabase } from "#/server/db/database.server";
import {
  canAdministerEvent,
  type EventOperationsAccess,
} from "./event-operations-access.server";

export async function findAssignedEventOperations(
  userId: string,
): Promise<Array<AssignedEventOperationsSummary>> {
  const database = getDatabase();
  const [administratorRows, coordinatorRows, presenterRows] = await Promise.all(
    [
      database
        .selectFrom("event_admin_assignment")
        .select("eventOccurrenceId")
        .where("userId", "=", userId)
        .where("endedAt", "is", null)
        .execute(),
      database
        .selectFrom("event_coordinator_assignment as assignment")
        .innerJoin(
          "event_occurrence_region as occurrence_region",
          "occurrence_region.id",
          "assignment.eventOccurrenceRegionId",
        )
        .innerJoin(
          "coordination_region as region",
          "region.id",
          "occurrence_region.regionId",
        )
        .select(["occurrence_region.eventOccurrenceId", "region.name"])
        .where("assignment.userId", "=", userId)
        .where("assignment.endedAt", "is", null)
        .where("occurrence_region.retiredAt", "is", null)
        .execute(),
      database
        .selectFrom("event_presenter_assignment as assignment")
        .leftJoin(
          "event_session as session",
          "session.id",
          "assignment.eventSessionId",
        )
        .select(["assignment.eventOccurrenceId", "session.title"])
        .where("assignment.userId", "=", userId)
        .where("assignment.endedAt", "is", null)
        .execute(),
    ],
  );
  const occurrenceIds = [
    ...new Set([
      ...administratorRows.map((row) => row.eventOccurrenceId),
      ...coordinatorRows.map((row) => row.eventOccurrenceId),
      ...presenterRows.map((row) => row.eventOccurrenceId),
    ]),
  ];
  if (occurrenceIds.length === 0) return [];
  const occurrences = await database
    .selectFrom("event_occurrence")
    .select([
      "id",
      "title",
      "status",
      "deliveryMode",
      "timezone",
      "startsAt",
      "endsAt",
      "venueName",
    ])
    .where("id", "in", occurrenceIds)
    .where("status", "!=", "archived")
    .orderBy("startsAt", "asc")
    .execute();

  return occurrences.map((occurrence) => {
    const roles: AssignedEventOperationsSummary["roles"] = [];
    if (
      administratorRows.some((row) => row.eventOccurrenceId === occurrence.id)
    )
      roles.push("administrator");
    if (coordinatorRows.some((row) => row.eventOccurrenceId === occurrence.id))
      roles.push("coordinator");
    if (presenterRows.some((row) => row.eventOccurrenceId === occurrence.id))
      roles.push("presenter");
    return {
      ...occurrence,
      startsAt: occurrence.startsAt.toISOString(),
      endsAt: occurrence.endsAt.toISOString(),
      venueName: occurrence.venueName ?? "",
      roles,
      regions: [
        ...new Set(
          coordinatorRows
            .filter((row) => row.eventOccurrenceId === occurrence.id)
            .map((row) => row.name),
        ),
      ],
      sessions: [
        ...new Set(
          presenterRows
            .filter((row) => row.eventOccurrenceId === occurrence.id)
            .flatMap((row) => (row.title ? [row.title] : [])),
        ),
      ],
    };
  });
}

export async function findEventOperationsWorkspace(
  eventOccurrenceId: string,
  access: EventOperationsAccess,
): Promise<EventOperationsWorkspace | null> {
  const workspace = await findAdminEventOccurrenceOperations(eventOccurrenceId);
  if (!workspace) return null;
  const administrator = canAdministerEvent(access);
  const coordinatorRegionIds = new Set(access.coordinatorRegionIds);
  const assignedSessionIds = new Set(access.presenterSessionIds);
  const registrations = administrator
    ? workspace.registrations
    : workspace.registrations.filter(
        (registration) =>
          registration.regionId !== null &&
          coordinatorRegionIds.has(registration.regionId),
      );
  const regions = administrator
    ? workspace.regions
    : workspace.regions.filter((region) => coordinatorRegionIds.has(region.id));
  const participationRegions = administrator
    ? []
    : await getDatabase()
        .selectFrom("event_participation as participation")
        .leftJoin(
          "event_registration as registration",
          "registration.id",
          "participation.registrationId",
        )
        .select([
          "participation.id",
          "registration.eventOccurrenceRegionId as regionId",
        ])
        .where("participation.eventOccurrenceId", "=", eventOccurrenceId)
        .execute();
  const participantRegionById = new Map(
    participationRegions.map((row) => [row.id, row.regionId]),
  );
  const coordinator = coordinatorRegionIds.size > 0;
  const presenter =
    access.presentsWholeOccurrence || assignedSessionIds.size > 0;
  const sessions = workspace.sessions
    .filter(
      (session) =>
        administrator ||
        coordinator ||
        access.presentsWholeOccurrence ||
        assignedSessionIds.has(session.id),
    )
    .map((session) => {
      const presenterMayRecord =
        access.presentsWholeOccurrence || assignedSessionIds.has(session.id);
      return {
        id: session.id,
        title: session.title,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        canRecordAttendance: administrator || coordinator || presenterMayRecord,
        attendance: session.attendance
          .filter(
            (participant) =>
              administrator ||
              presenterMayRecord ||
              coordinatorRegionIds.has(
                participantRegionById.get(participant.eventParticipationId) ??
                  "",
              ),
          )
          .map((participant) => ({
            eventParticipationId: participant.eventParticipationId,
            name: participant.name,
            email: participant.email,
            state: participant.state,
          })),
      };
    });
  const roles: EventOperationsWorkspace["access"]["roles"] = [];
  if (administrator) roles.push("administrator");
  if (coordinator) roles.push("coordinator");
  if (presenter) roles.push("presenter");

  return {
    occurrence: {
      id: workspace.occurrence.id,
      title: workspace.occurrence.title,
      status: workspace.occurrence.status,
      deliveryMode: workspace.occurrence.deliveryMode,
      timezone: workspace.occurrence.timezone,
      startsAt: workspace.occurrence.startsAt,
      endsAt: workspace.occurrence.endsAt,
      venueName: workspace.occurrence.venueName,
      venueAddress: workspace.occurrence.venueAddress,
      virtualJoinUrl: workspace.occurrence.virtualJoinUrl,
      capacity: workspace.occurrence.capacity,
      confirmedCount: workspace.occurrence.confirmedCount,
    },
    access: {
      roles,
      canReviewRegistrations: administrator || coordinator,
      canViewRegistrations: administrator || coordinator,
      canRecordAttendance: administrator || coordinator || presenter,
    },
    metrics: {
      registrations: registrations.length,
      awaitingReview: registrations.filter(
        (registration) => registration.status === "submitted",
      ).length,
      candidates: registrations.filter(
        (registration) => registration.status === "coordinator_approved",
      ).length,
      confirmed: registrations.filter(
        (registration) => registration.status === "selected",
      ).length,
    },
    regions: regions.map((region) => ({
      id: region.id,
      name: region.name,
      code: region.code,
      effectivelyLocked: region.effectivelyLocked,
      registrationCount: region.registrationCount,
    })),
    registrations: registrations.map((registration) => ({
      id: registration.id,
      name: registration.name,
      email: registration.email,
      status: registration.status,
      regionId: registration.regionId,
      regionName: registration.regionName,
      reviewRoundId: registration.reviewRoundId,
      coordinatorPriority: registration.coordinatorPriority,
    })),
    sessions,
  };
}
