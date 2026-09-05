import { createServerFn } from "@tanstack/react-start";
import {
  eventOperationsAttendanceSchema,
  eventOperationsCoordinatorDecisionSchema,
  eventOperationsParamsSchema,
  eventOperationsRegionLockSchema,
  eventVirtualLobbyQueueSchema,
  eventVirtualRoomMutationSchema,
  eventSurveyQrPresentationParamsSchema,
  type AssignedEventOperationsResult,
  type EventOperationsMutationResult,
  type EventOperationsResult,
  type EventVirtualLobbyQueueResult,
  type EventSurveyQrPresentationResult,
} from "#/features/event-operations/event-operations.schema";
import {
  eventVirtualLobbyAdmissionSchema,
  type EventVirtualLobbyMutationResult,
} from "#/features/event-lobby/event-virtual-lobby.schema";
export const getAssignedEventOperations = createServerFn({
  method: "GET",
}).handler(async (): Promise<AssignedEventOperationsResult> => {
  const { getRequestUser } = await import("#/server/auth/session.server");
  const user = await getRequestUser();
  if (!user) return { status: "unauthenticated" };
  const { findAssignedEventOperations } =
    await import("#/server/events/event-operations.server");
  return { status: "ready", data: await findAssignedEventOperations(user.id) };
});

export const getEventOperationsWorkspace = createServerFn({ method: "GET" })
  .validator(eventOperationsParamsSchema)
  .handler(async ({ data }): Promise<EventOperationsResult> => {
    const { getEventOperationsRequest } =
      await import("#/server/events/event-operations-access.server");
    const request = await getEventOperationsRequest(data.eventOccurrenceId);
    if (request.status !== "ready") return request;
    const { findEventOperationsWorkspace } =
      await import("#/server/events/event-operations.server");
    const workspace = await findEventOperationsWorkspace(
      data.eventOccurrenceId,
      request.access,
    );
    return workspace
      ? { status: "ready", data: workspace }
      : { status: "not-found" };
  });

export const getEventSurveyQrPresentation = createServerFn({ method: "GET" })
  .validator(eventSurveyQrPresentationParamsSchema)
  .handler(async ({ data }): Promise<EventSurveyQrPresentationResult> => {
    const { getEventOperationsRequest } =
      await import("#/server/events/event-operations-access.server");
    const request = await getEventOperationsRequest(data.eventOccurrenceId);
    if (request.status !== "ready") return request;
    const { findEventSurveyQrPresentation } =
      await import("#/server/events/event-survey-access.server");
    const presentation = await findEventSurveyQrPresentation(
      data.eventOccurrenceId,
      data.eventSurveyAccessId,
      request.access,
    );
    return presentation
      ? { status: "ready", data: presentation }
      : { status: "not-found" };
  });

export const decideEventCoordinatorRegistration = createServerFn({
  method: "POST",
})
  .validator(eventOperationsCoordinatorDecisionSchema)
  .handler(async ({ data }): Promise<EventOperationsMutationResult> => {
    const { canAdministerEvent, getEventOperationsRequest } =
      await import("#/server/events/event-operations-access.server");
    const request = await getEventOperationsRequest(data.eventOccurrenceId);
    if (request.status !== "ready") return request;
    if (!canAdministerEvent(request.access)) {
      const { getDatabase } = await import("#/server/db/database.server");
      const registration = await getDatabase()
        .selectFrom("event_registration")
        .select("eventOccurrenceRegionId")
        .where("id", "=", data.registrationId)
        .where("eventOccurrenceId", "=", data.eventOccurrenceId)
        .executeTakeFirst();
      if (
        !registration?.eventOccurrenceRegionId ||
        !request.access.coordinatorRegionIds.includes(
          registration.eventOccurrenceRegionId,
        )
      )
        return { status: "forbidden" };
    }
    const { decideAdminEventCoordinatorRegistration: decide } =
      await import("#/server/admin/admin-event-operations.server");
    const outcome = await decide(data, request.access.user);
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "region-locked")
      return { status: "conflict", reason: "region_locked" };
    if (outcome === "invalid-transition")
      return { status: "conflict", reason: "invalid_transition" };
    return { status: "ready" };
  });

export const lockEventOperationsRegion = createServerFn({ method: "POST" })
  .validator(eventOperationsRegionLockSchema)
  .handler(async ({ data }): Promise<EventOperationsMutationResult> => {
    const { canAdministerEvent, getEventOperationsRequest } =
      await import("#/server/events/event-operations-access.server");
    const request = await getEventOperationsRequest(data.eventOccurrenceId);
    if (request.status !== "ready") return request;
    const administrator = canAdministerEvent(request.access);
    if (
      !administrator &&
      !request.access.coordinatorRegionIds.includes(
        data.eventOccurrenceRegionId,
      )
    )
      return { status: "forbidden" };
    const { lockAdminEventRegion: lock } =
      await import("#/server/admin/admin-event-operations.server");
    const outcome = await lock(
      data.eventOccurrenceId,
      data.eventOccurrenceRegionId,
      request.access.user,
      administrator ? "administrator" : "manual",
    );
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "invalid-transition")
      return { status: "conflict", reason: "invalid_transition" };
    return { status: "ready" };
  });

export const recordEventOperationsAttendance = createServerFn({
  method: "POST",
})
  .validator(eventOperationsAttendanceSchema)
  .handler(async ({ data }): Promise<EventOperationsMutationResult> => {
    const { canAdministerEvent, getEventOperationsRequest } =
      await import("#/server/events/event-operations-access.server");
    const request = await getEventOperationsRequest(data.eventOccurrenceId);
    if (request.status !== "ready") return request;
    const administrator = canAdministerEvent(request.access);
    const presenter =
      request.access.presentsWholeOccurrence ||
      request.access.presenterSessionIds.includes(data.eventSessionId);
    let coordinator = false;
    if (
      !administrator &&
      !presenter &&
      request.access.coordinatorRegionIds.length
    ) {
      const { getDatabase } = await import("#/server/db/database.server");
      const participation = await getDatabase()
        .selectFrom("event_participation as participation")
        .innerJoin(
          "event_registration as registration",
          "registration.id",
          "participation.registrationId",
        )
        .select("registration.eventOccurrenceRegionId as regionId")
        .where("participation.id", "=", data.eventParticipationId)
        .where("participation.eventOccurrenceId", "=", data.eventOccurrenceId)
        .executeTakeFirst();
      coordinator = Boolean(
        participation?.regionId &&
        request.access.coordinatorRegionIds.includes(participation.regionId),
      );
    }
    if (!administrator && !presenter && !coordinator)
      return { status: "forbidden" };
    const { recordAdminEventAttendance: record } =
      await import("#/server/admin/admin-event-operations.server");
    const outcome = await record(
      data,
      request.access.user,
      administrator ? "administrator" : presenter ? "presenter" : "coordinator",
    );
    return outcome === "not-found"
      ? { status: "conflict", reason: "attendance_unavailable" }
      : { status: "ready" };
  });

export const mutateEventVirtualRoom = createServerFn({ method: "POST" })
  .validator(eventVirtualRoomMutationSchema)
  .handler(async ({ data }): Promise<EventOperationsMutationResult> => {
    const { getEventOperationsRequest } =
      await import("#/server/events/event-operations-access.server");
    const request = await getEventOperationsRequest(data.eventOccurrenceId);
    if (request.status !== "ready") return request;
    const {
      checkEventVirtualSessionProviderHealth,
      ensureEventVirtualRoomForStaff,
      replaceEventVirtualRoom,
      setEventVirtualRoomAdmissionMode,
      transitionEventVirtualRoom,
    } = await import("#/server/events/event-virtual-room.server");
    const args = [data.eventOccurrenceId, data.eventSessionId] as const;
    if (data.action === "prepare")
      return ensureEventVirtualRoomForStaff(...args, request.access.user);
    if (data.action === "health")
      return checkEventVirtualSessionProviderHealth(
        ...args,
        request.access.user.id,
      );
    if (data.action === "replace")
      return replaceEventVirtualRoom(...args, request.access.user);
    if (
      data.action === "admission_manual" ||
      data.action === "admission_automatic"
    )
      return setEventVirtualRoomAdmissionMode(
        ...args,
        data.action === "admission_manual" ? "manual" : "automatic",
        request.access.user,
      );
    return transitionEventVirtualRoom(
      ...args,
      data.action,
      request.access.user,
    );
  });

export const getEventVirtualLobbyQueue = createServerFn({ method: "GET" })
  .validator(eventVirtualLobbyQueueSchema)
  .handler(async ({ data }): Promise<EventVirtualLobbyQueueResult> => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" };
    const { findEventVirtualLobbyQueue } =
      await import("#/server/events/event-virtual-room.server");
    return await findEventVirtualLobbyQueue(
      data.eventOccurrenceId,
      data.eventSessionId,
      user.id,
      data.page,
    );
  });

export const mutateEventVirtualLobbyAdmission = createServerFn({
  method: "POST",
})
  .validator(eventVirtualLobbyAdmissionSchema)
  .handler(async ({ data }): Promise<EventVirtualLobbyMutationResult> => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" };
    const { mutateEventVirtualLobbyAdmission: mutate } =
      await import("#/server/events/event-virtual-lobby.server");
    return await mutate(
      {
        eventOccurrenceId: data.eventOccurrenceId,
        eventSessionId: data.eventSessionId,
        action: data.action,
        ...(data.lobbyEntryId ? { lobbyEntryId: data.lobbyEntryId } : {}),
      },
      user,
    );
  });
