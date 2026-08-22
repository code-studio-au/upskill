import "@tanstack/react-start/server-only";

import type { Kysely, Transaction } from "kysely";
import {
  ianaTimeZoneSchema,
  type EventReleaseOffsetUnit,
  type IsoDuration,
} from "#/features/shared/time.schema";
import type { Database } from "#/server/db/types";
import {
  addElapsedDuration,
  addZonedDuration,
  dateToInstant,
  instantToDate,
} from "#/server/time/time.server";

export type EventSectionReleaseAnchor =
  | "participation_created"
  | "occurrence_start"
  | "occurrence_end"
  | "final_session_end";

export function calculateEventSectionReleaseAt(input: {
  releaseAnchor: EventSectionReleaseAnchor;
  releaseOffsetAmount: number;
  releaseOffsetUnit: EventReleaseOffsetUnit;
  timezone: string;
  participationCreatedAt: Date;
  occurrenceStartsAt: Date;
  occurrenceEndsAt: Date;
  finalSessionEndsAt: Date;
}): Date {
  const anchor =
    input.releaseAnchor === "participation_created"
      ? input.participationCreatedAt
      : input.releaseAnchor === "occurrence_start"
        ? input.occurrenceStartsAt
        : input.releaseAnchor === "occurrence_end"
          ? input.occurrenceEndsAt
          : input.finalSessionEndsAt;
  const timezone = ianaTimeZoneSchema.parse(input.timezone);
  const sign = input.releaseOffsetAmount < 0 ? "-" : "";
  const amount = Math.abs(input.releaseOffsetAmount);
  const quantity = String(amount);
  const duration = `${sign}${
    input.releaseOffsetUnit === "minute"
      ? `PT${quantity}M`
      : input.releaseOffsetUnit === "hour"
        ? `PT${quantity}H`
        : input.releaseOffsetUnit === "day"
          ? `P${quantity}D`
          : input.releaseOffsetUnit === "week"
            ? `P${quantity}W`
            : `P${quantity}M`
  }` as IsoDuration;
  const anchorInstant = dateToInstant(anchor);
  const releaseInstant =
    input.releaseOffsetUnit === "minute" || input.releaseOffsetUnit === "hour"
      ? addElapsedDuration(anchorInstant, duration)
      : addZonedDuration(anchorInstant, timezone, duration);
  return instantToDate(releaseInstant);
}

export async function ensureEventSectionReleased(
  database: Kysely<Database> | Transaction<Database>,
  input: {
    eventParticipationId: string;
    eventTemplateVersionSectionId: string;
    calculatedReleaseAt: Date;
    now: Date;
  },
): Promise<boolean> {
  if (!database.isTransaction)
    return await database
      .transaction()
      .execute(
        async (transaction) =>
          await ensureEventSectionReleased(transaction, input),
      );
  const existing = await database
    .selectFrom("event_section_release")
    .select("releasedAt")
    .where("eventParticipationId", "=", input.eventParticipationId)
    .where(
      "eventTemplateVersionSectionId",
      "=",
      input.eventTemplateVersionSectionId,
    )
    .executeTakeFirst();
  if (existing) return true;
  if (input.calculatedReleaseAt > input.now) return false;
  const inserted = await database
    .insertInto("event_section_release")
    .values({
      eventParticipationId: input.eventParticipationId,
      eventTemplateVersionSectionId: input.eventTemplateVersionSectionId,
      releasedAt: input.now,
    })
    .onConflict((conflict) => conflict.doNothing())
    .returning("eventParticipationId")
    .executeTakeFirst();
  if (inserted) {
    const { enqueueEventParticipationCommunications } =
      await import("#/server/notifications/event-communication-execution.server");
    await enqueueEventParticipationCommunications(
      database as Transaction<Database>,
      {
        eventParticipationId: input.eventParticipationId,
        eventTemplateVersionSectionId: input.eventTemplateVersionSectionId,
        triggerEventId: `section-release:${input.eventParticipationId}:${input.eventTemplateVersionSectionId}`,
        trigger: "section_release",
        createdAt: input.now,
      },
    );
  }
  return true;
}
