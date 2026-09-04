import "@tanstack/react-start/server-only";

import type {
  AssignedEventOperationsSummary,
  EventParticipantProgress,
  EventOperationsWorkspace,
} from "#/features/event-operations/event-operations.schema";
import { findAdminEventOccurrenceOperations } from "#/server/admin/admin-event-operations.server";
import { getDatabase } from "#/server/db/database.server";
import {
  canAdministerEvent,
  type EventOperationsAccess,
} from "./event-operations-access.server";
import { calculateEventSectionReleaseAt } from "#/server/learning/event-section-release.server";
import { findEventSurveyQrCatalogue } from "./event-survey-access.server";
import { findEventVirtualSessionOperations } from "./event-virtual-room.server";

interface EventParticipantProgressVisibility {
  administrator: boolean;
  coordinatorRegionIds: Array<string>;
  participantUserId?: string;
  includeInactiveRegistrations?: boolean;
}

export interface EventParticipantProgressOccurrence {
  eventOccurrenceId: string;
  eventTemplateVersionId: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
}

function groupBy<Value>(
  values: ReadonlyArray<Value>,
  keyFor: (value: Value) => string,
): Map<string, Array<Value>> {
  const grouped = new Map<string, Array<Value>>();
  for (const value of values) {
    const key = keyFor(value);
    const group = grouped.get(key);
    if (group) group.push(value);
    else grouped.set(key, [value]);
  }
  return grouped;
}

export async function findEventParticipantProgressForOccurrences(
  requestedOccurrences: ReadonlyArray<EventParticipantProgressOccurrence>,
  visibility: EventParticipantProgressVisibility,
): Promise<Array<EventParticipantProgress>> {
  if (requestedOccurrences.length === 0) return [];
  if (
    !visibility.administrator &&
    visibility.coordinatorRegionIds.length === 0 &&
    !visibility.participantUserId
  )
    return [];
  const occurrenceById = new Map<string, EventParticipantProgressOccurrence>();
  for (const occurrence of requestedOccurrences) {
    const existing = occurrenceById.get(occurrence.eventOccurrenceId);
    if (
      existing &&
      (existing.eventTemplateVersionId !== occurrence.eventTemplateVersionId ||
        existing.startsAt !== occurrence.startsAt ||
        existing.endsAt !== occurrence.endsAt ||
        existing.timezone !== occurrence.timezone)
    )
      throw new Error("Conflicting event occurrence progress descriptors");
    occurrenceById.set(occurrence.eventOccurrenceId, occurrence);
  }
  const occurrences = [...occurrenceById.values()];
  const occurrenceIds = occurrences.map(
    (occurrence) => occurrence.eventOccurrenceId,
  );
  const eventTemplateVersionIds = [
    ...new Set(
      occurrences.map((occurrence) => occurrence.eventTemplateVersionId),
    ),
  ];
  const database = getDatabase();
  let participantQuery = database
    .selectFrom("event_participation as participation")
    .leftJoin(
      "event_registration as registration",
      "registration.id",
      "participation.registrationId",
    )
    .leftJoin(
      "event_occurrence_region as occurrenceRegion",
      "occurrenceRegion.id",
      "registration.eventOccurrenceRegionId",
    )
    .leftJoin(
      "coordination_region as region",
      "region.id",
      "occurrenceRegion.regionId",
    )
    .select([
      "participation.id",
      "participation.eventOccurrenceId",
      "participation.nameSnapshot as name",
      "participation.emailSnapshot as email",
      "participation.createdAt",
      "participation.completedAt",
      "registration.eventOccurrenceRegionId as regionId",
      "region.name as regionName",
    ])
    .where("participation.eventOccurrenceId", "in", occurrenceIds)
    .orderBy("participation.eventOccurrenceId")
    .orderBy("participation.nameSnapshot")
    .orderBy("participation.emailSnapshot");
  if (!(visibility.administrator && visibility.includeInactiveRegistrations))
    participantQuery = participantQuery.where((expression) =>
      expression.or([
        expression("registration.status", "=", "selected"),
        expression("participation.mode", "=", "open_entry"),
      ]),
    );
  if (visibility.participantUserId)
    participantQuery = participantQuery.where(
      "participation.userId",
      "=",
      visibility.participantUserId,
    );
  if (!visibility.administrator && !visibility.participantUserId)
    participantQuery = participantQuery.where((expression) =>
      expression.or([
        expression(
          "registration.eventOccurrenceRegionId",
          "in",
          visibility.coordinatorRegionIds,
        ),
        expression("participation.mode", "=", "open_entry"),
      ]),
    );
  const participants = await participantQuery.execute();
  if (participants.length === 0) return [];
  const participantIds = participants.map((participant) => participant.id);
  const [sections, items, sessions, progress, attendance, releases] =
    await Promise.all([
      database
        .selectFrom("event_template_version_section")
        .select([
          "id",
          "eventTemplateVersionId",
          "position",
          "title",
          "description",
          "phase",
          "releaseAnchor",
          "releaseOffsetAmount",
          "releaseOffsetUnit",
        ])
        .where("eventTemplateVersionId", "in", eventTemplateVersionIds)
        .orderBy("eventTemplateVersionId")
        .orderBy("position")
        .execute(),
      database
        .selectFrom("event_template_version_item")
        .select([
          "id",
          "eventTemplateVersionId",
          "sectionId",
          "position",
          "title",
          "kind",
          "required",
          "sessionDefinitionId",
        ])
        .where("eventTemplateVersionId", "in", eventTemplateVersionIds)
        .orderBy("eventTemplateVersionId")
        .orderBy("position")
        .execute(),
      database
        .selectFrom("event_session")
        .select(["id", "eventOccurrenceId", "sessionDefinitionId", "endsAt"])
        .where("eventOccurrenceId", "in", occurrenceIds)
        .orderBy("eventOccurrenceId")
        .orderBy("position")
        .execute(),
      database
        .selectFrom("learning_item_progress")
        .select(["eventParticipationId", "eventTemplateVersionItemId"])
        .where("eventParticipationId", "in", participantIds)
        .where("state", "=", "completed")
        .execute(),
      database
        .selectFrom("event_attendance as attendance")
        .innerJoin(
          "event_session as session",
          "session.id",
          "attendance.eventSessionId",
        )
        .select([
          "attendance.eventParticipationId",
          "session.sessionDefinitionId",
          "attendance.state",
        ])
        .where("attendance.eventParticipationId", "in", participantIds)
        .execute(),
      database
        .selectFrom("event_section_release")
        .select(["eventParticipationId", "eventTemplateVersionSectionId"])
        .where("eventParticipationId", "in", participantIds)
        .execute(),
    ]);
  const sectionsByTemplateVersion = groupBy(
    sections,
    (section) => section.eventTemplateVersionId,
  );
  const itemsBySection = groupBy(items, (item) => item.sectionId);
  const sessionsByOccurrence = groupBy(
    sessions,
    (session) => session.eventOccurrenceId,
  );
  const sessionByOccurrenceAndDefinition = new Map(
    sessions.map((session) => [
      `${session.eventOccurrenceId}:${session.sessionDefinitionId}`,
      session,
    ]),
  );
  const completedEvidence = new Set(
    progress.flatMap((row) =>
      row.eventParticipationId && row.eventTemplateVersionItemId
        ? [`${row.eventParticipationId}:${row.eventTemplateVersionItemId}`]
        : [],
    ),
  );
  const attendanceByParticipantAndDefinition = new Map(
    attendance.map((row) => [
      `${row.eventParticipationId}:${row.sessionDefinitionId}`,
      row.state,
    ]),
  );
  const participantsWithRecordedAttendance = new Set(
    attendance
      .filter((row) => row.state !== "not_recorded")
      .map((row) => row.eventParticipationId),
  );
  const releasedSections = new Set(
    releases.map(
      (row) =>
        `${row.eventParticipationId}:${row.eventTemplateVersionSectionId}`,
    ),
  );
  const now = new Date();

  return participants.map((participant) => {
    const occurrence = occurrenceById.get(participant.eventOccurrenceId);
    if (!occurrence)
      throw new Error("Event participant has no progress descriptor");
    const occurrenceStart = new Date(occurrence.startsAt);
    const occurrenceEnd = new Date(occurrence.endsAt);
    const finalSessionEnd =
      sessionsByOccurrence.get(occurrence.eventOccurrenceId)?.at(-1)?.endsAt ??
      occurrenceEnd;
    const projectedSections = (
      sectionsByTemplateVersion.get(occurrence.eventTemplateVersionId) ?? []
    ).map((section) => {
      const releaseAt = calculateEventSectionReleaseAt({
        releaseAnchor: section.releaseAnchor,
        releaseOffsetAmount: section.releaseOffsetAmount,
        releaseOffsetUnit: section.releaseOffsetUnit,
        timezone: occurrence.timezone,
        participationCreatedAt: participant.createdAt,
        occurrenceStartsAt: occurrenceStart,
        occurrenceEndsAt: occurrenceEnd,
        finalSessionEndsAt: finalSessionEnd,
      });
      const available =
        releasedSections.has(`${participant.id}:${section.id}`) ||
        releaseAt <= now;
      const sectionItems = (itemsBySection.get(section.id) ?? []).map(
        (item) => {
          const session = item.sessionDefinitionId
            ? sessionByOccurrenceAndDefinition.get(
                `${occurrence.eventOccurrenceId}:${item.sessionDefinitionId}`,
              )
            : null;
          const attendanceState = session
            ? attendanceByParticipantAndDefinition.get(
                `${participant.id}:${session.sessionDefinitionId}`,
              )
            : null;
          const completed = session
            ? attendanceState === "attended"
            : completedEvidence.has(`${participant.id}:${item.id}`);
          return {
            id: item.id,
            title: item.title,
            kind: item.kind,
            required: item.required,
            state: completed ? ("completed" as const) : ("incomplete" as const),
            eventSessionId: session?.id ?? null,
          };
        },
      );
      const requiredItems = sectionItems.filter((item) => item.required);
      const targets = requiredItems.length > 0 ? requiredItems : sectionItems;
      const completedItems = targets.filter(
        (item) => item.state === "completed",
      ).length;
      const complete = targets.length > 0 && completedItems === targets.length;
      return {
        id: section.id,
        title: section.title,
        description: section.description,
        phase: section.phase,
        state: !available
          ? ("locked" as const)
          : complete
            ? ("completed" as const)
            : completedItems > 0
              ? ("in_progress" as const)
              : ("not_started" as const),
        releaseAt: releaseAt.toISOString(),
        completedItems,
        totalItems: targets.length,
        items: sectionItems,
      };
    });
    const availableSections = projectedSections.filter(
      (section) => section.state !== "locked",
    );
    const completedAvailableItems = availableSections.reduce(
      (total, section) => total + section.completedItems,
      0,
    );
    const availableItems = availableSections.reduce(
      (total, section) => total + section.totalItems,
      0,
    );
    const totalItems = projectedSections.reduce(
      (total, section) => total + section.totalItems,
      0,
    );
    const completed =
      projectedSections.length > 0 &&
      projectedSections.every((section) => section.state === "completed");
    const upToDate =
      !completed &&
      availableSections.length > 0 &&
      availableSections.every((section) => section.state === "completed") &&
      projectedSections.some((section) => section.state === "locked");
    const hasEvidence =
      participantsWithRecordedAttendance.has(participant.id) ||
      projectedSections.some((section) =>
        section.items.some((item) => item.state === "completed"),
      );
    return {
      eventParticipationId: participant.id,
      name: participant.name,
      email: participant.email,
      regionId: participant.regionId,
      regionName: participant.regionName,
      state: completed
        ? ("completed" as const)
        : upToDate
          ? ("up_to_date" as const)
          : hasEvidence
            ? ("in_progress" as const)
            : ("not_started" as const),
      completedAt:
        completed && participant.completedAt
          ? participant.completedAt.toISOString()
          : null,
      completedAvailableItems,
      availableItems,
      totalItems,
      sections: projectedSections,
    };
  });
}

async function findEventParticipantProgress(
  eventOccurrenceId: string,
  eventTemplateVersionId: string,
  occurrenceStartsAt: string,
  occurrenceEndsAt: string,
  occurrenceTimezone: string,
  visibility: EventParticipantProgressVisibility,
): Promise<Array<EventParticipantProgress>> {
  return findEventParticipantProgressForOccurrences(
    [
      {
        eventOccurrenceId,
        eventTemplateVersionId,
        startsAt: occurrenceStartsAt,
        endsAt: occurrenceEndsAt,
        timezone: occurrenceTimezone,
      },
    ],
    visibility,
  );
}

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
          "participation.mode",
          "registration.eventOccurrenceRegionId as regionId",
        ])
        .where("participation.eventOccurrenceId", "=", eventOccurrenceId)
        .execute();
  const participantRegionById = new Map(
    participationRegions.map((row) => [row.id, row.regionId]),
  );
  const openEntryParticipantIds = new Set(
    participationRegions
      .filter((row) => row.mode === "open_entry")
      .map((row) => row.id),
  );
  const coordinator = coordinatorRegionIds.size > 0;
  const presenter =
    access.presentsWholeOccurrence || assignedSessionIds.size > 0;
  const canViewProgress = administrator || coordinator;
  const canViewSurveyQrCatalogue = administrator || coordinator || presenter;
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
              openEntryParticipantIds.has(participant.eventParticipationId) ||
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
  const [participantProgress, surveyQrCatalogue, virtualSessions] =
    await Promise.all([
      canViewProgress
        ? findEventParticipantProgress(
            eventOccurrenceId,
            workspace.occurrence.eventTemplateVersionId,
            workspace.occurrence.startsAt,
            workspace.occurrence.endsAt,
            workspace.occurrence.timezone,
            {
              administrator,
              coordinatorRegionIds: access.coordinatorRegionIds,
            },
          )
        : [],
      canViewSurveyQrCatalogue
        ? findEventSurveyQrCatalogue(eventOccurrenceId, access)
        : [],
      findEventVirtualSessionOperations(eventOccurrenceId, access),
    ]);

  return {
    occurrence: {
      id: workspace.occurrence.id,
      title: workspace.occurrence.title,
      status: workspace.occurrence.status,
      deliveryMode: workspace.occurrence.deliveryMode,
      virtualDeliveryProvider: workspace.occurrence.virtualDeliveryProvider,
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
      canViewProgress,
      canViewSurveyQrCatalogue,
    },
    guestAccess: workspace.guestAccess,
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
      completed: participantProgress.filter(
        (participant) => participant.state === "completed",
      ).length,
      upToDate: participantProgress.filter(
        (participant) => participant.state === "up_to_date",
      ).length,
      preWorkAttention: participantProgress.filter((participant) =>
        participant.sections.some(
          (section) =>
            section.phase === "pre_event" &&
            section.state !== "locked" &&
            section.state !== "completed",
        ),
      ).length,
    },
    regions: regions.map((region) => ({
      id: region.id,
      regionId: region.regionId,
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
      registrationQuestionnaireStatus:
        registration.registrationQuestionnaireStatus,
      regionId: registration.regionId,
      regionName: registration.regionName,
      profileRegionId: registration.profileRegionId,
      profileRegionName: registration.profileRegionName,
      regionMismatch: registration.regionMismatch,
      regionMismatchAcknowledged: registration.regionMismatchAcknowledged,
      regionDecision: registration.regionDecision,
      regionalReviewWaivedAt: registration.regionalReviewWaivedAt,
      reviewRoundId: registration.reviewRoundId,
      coordinatorPriority: registration.coordinatorPriority,
      coordinatorDecidedAt: registration.coordinatorDecidedAt,
      finalDecidedAt: registration.finalDecidedAt,
    })),
    sessions,
    virtualSessions,
    participantProgress,
    surveyQrCatalogue,
  };
}
