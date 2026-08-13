import "@tanstack/react-start/server-only";

import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getRequestUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";

export interface EventOperationsAccess {
  user: AuthenticatedUser;
  isPlatformAdministrator: boolean;
  isAssignedAdministrator: boolean;
  coordinatorRegionIds: Array<string>;
  presenterSessionIds: Array<string>;
  presentsWholeOccurrence: boolean;
}

export type EventOperationsRequest =
  | { status: "ready"; access: EventOperationsAccess }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

export function canAdministerEvent(access: EventOperationsAccess): boolean {
  return access.isPlatformAdministrator || access.isAssignedAdministrator;
}

export async function getEventOperationsAccess(
  user: AuthenticatedUser,
  eventOccurrenceId: string,
): Promise<EventOperationsAccess | null> {
  const database = getDatabase();
  const [
    platformAdministrator,
    assignedAdministrator,
    coordinatorRows,
    presenterRows,
  ] = await Promise.all([
    database
      .selectFrom("platform_admin")
      .select("userId")
      .where("userId", "=", user.id)
      .executeTakeFirst(),
    database
      .selectFrom("event_admin_assignment")
      .select("id")
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .where("userId", "=", user.id)
      .where("endedAt", "is", null)
      .executeTakeFirst(),
    database
      .selectFrom("event_coordinator_assignment as assignment")
      .innerJoin(
        "event_occurrence_region as occurrence_region",
        "occurrence_region.id",
        "assignment.eventOccurrenceRegionId",
      )
      .select("assignment.eventOccurrenceRegionId")
      .where("occurrence_region.eventOccurrenceId", "=", eventOccurrenceId)
      .where("occurrence_region.retiredAt", "is", null)
      .where("assignment.userId", "=", user.id)
      .where("assignment.endedAt", "is", null)
      .execute(),
    database
      .selectFrom("event_presenter_assignment")
      .select(["eventSessionId", "scopeKey"])
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .where("userId", "=", user.id)
      .where("endedAt", "is", null)
      .execute(),
  ]);

  const access: EventOperationsAccess = {
    user,
    isPlatformAdministrator: Boolean(platformAdministrator),
    isAssignedAdministrator: Boolean(
      platformAdministrator && assignedAdministrator,
    ),
    coordinatorRegionIds: coordinatorRows.map(
      (row) => row.eventOccurrenceRegionId,
    ),
    presenterSessionIds: presenterRows.flatMap((row) =>
      row.eventSessionId ? [row.eventSessionId] : [],
    ),
    presentsWholeOccurrence: presenterRows.some(
      (row) =>
        row.eventSessionId === null || row.scopeKey === eventOccurrenceId,
    ),
  };
  return canAdministerEvent(access) ||
    access.coordinatorRegionIds.length > 0 ||
    access.presenterSessionIds.length > 0 ||
    access.presentsWholeOccurrence
    ? access
    : null;
}

export async function getEventOperationsRequest(
  eventOccurrenceId: string,
): Promise<EventOperationsRequest> {
  const user = await getRequestUser();
  if (!user) return { status: "unauthenticated" };
  const access = await getEventOperationsAccess(user, eventOccurrenceId);
  return access ? { status: "ready", access } : { status: "forbidden" };
}

export async function hasAssignedEventOperations(
  userId: string,
): Promise<boolean> {
  const database = getDatabase();
  const [administrator, coordinator, presenter] = await Promise.all([
    database
      .selectFrom("event_admin_assignment as assignment")
      .innerJoin("platform_admin", "platform_admin.userId", "assignment.userId")
      .select("assignment.id")
      .where("assignment.userId", "=", userId)
      .where("assignment.endedAt", "is", null)
      .executeTakeFirst(),
    database
      .selectFrom("event_coordinator_assignment")
      .select("id")
      .where("userId", "=", userId)
      .where("endedAt", "is", null)
      .executeTakeFirst(),
    database
      .selectFrom("event_presenter_assignment")
      .select("id")
      .where("userId", "=", userId)
      .where("endedAt", "is", null)
      .executeTakeFirst(),
  ]);
  return Boolean(administrator || coordinator || presenter);
}
