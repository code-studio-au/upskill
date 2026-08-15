import "@tanstack/react-start/server-only";

import type { Kysely, Transaction } from "kysely";
import type { Database } from "#/server/db/types";

export type EventSectionReleaseAnchor =
  | "participation_created"
  | "occurrence_start"
  | "occurrence_end"
  | "final_session_end";

export function calculateEventSectionReleaseAt(input: {
  releaseAnchor: EventSectionReleaseAnchor;
  releaseOffsetMinutes: number;
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
  return new Date(anchor.getTime() + input.releaseOffsetMinutes * 60_000);
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
  await database
    .insertInto("event_section_release")
    .values({
      eventParticipationId: input.eventParticipationId,
      eventTemplateVersionSectionId: input.eventTemplateVersionSectionId,
      releasedAt: input.now,
    })
    .onConflict((conflict) => conflict.doNothing())
    .execute();
  return true;
}
