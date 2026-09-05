import "@tanstack/react-start/server-only";

import type { Kysely, Transaction } from "kysely";
import type { Database } from "#/server/db/types";

type DatabaseConnection = Kysely<Database> | Transaction<Database>;

export async function hasVirtualRoomStaffAccess(
  connection: DatabaseConnection,
  eventOccurrenceId: string,
  eventSessionId: string,
  userId: string,
): Promise<boolean> {
  const [platformAdministrator, presenter] = await Promise.all([
    connection
      .selectFrom("platform_admin")
      .select("userId")
      .where("userId", "=", userId)
      .executeTakeFirst(),
    connection
      .selectFrom("event_presenter_assignment")
      .select("id")
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .where("userId", "=", userId)
      .where("endedAt", "is", null)
      .where((expression) =>
        expression.or([
          expression("eventSessionId", "=", eventSessionId),
          expression("eventSessionId", "is", null),
        ]),
      )
      .executeTakeFirst(),
  ]);
  return Boolean(presenter || platformAdministrator);
}

export async function lockVirtualRoomStaffAccess(
  transaction: Transaction<Database>,
  eventOccurrenceId: string,
  eventSessionId: string,
  userId: string,
): Promise<boolean> {
  const platformAdministrator = await transaction
    .selectFrom("platform_admin")
    .select("userId")
    .where("userId", "=", userId)
    .forUpdate()
    .executeTakeFirst();
  if (platformAdministrator) return true;
  return Boolean(
    await transaction
      .selectFrom("event_presenter_assignment")
      .select("id")
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .where("userId", "=", userId)
      .where("endedAt", "is", null)
      .where((expression) =>
        expression.or([
          expression("eventSessionId", "=", eventSessionId),
          expression("eventSessionId", "is", null),
        ]),
      )
      .forUpdate()
      .executeTakeFirst(),
  );
}
