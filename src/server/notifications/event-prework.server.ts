import "@tanstack/react-start/server-only";

import type { Kysely } from "kysely";
import type { Database } from "#/server/db/types";
import { calculateEventSectionReleaseAt } from "#/server/learning/event-section-release.server";

export async function hasIncompleteAvailableEventPrework(
  database: Kysely<Database>,
  input: {
    eventOccurrenceId: string;
    eventParticipationId: string;
    eventRegistrationId: string;
    userId: string;
    now: Date;
  },
): Promise<boolean> {
  const participation = await database
    .selectFrom("event_participation as participation")
    .innerJoin(
      "event_registration as registration",
      "registration.id",
      "participation.registrationId",
    )
    .innerJoin(
      "event_occurrence as occurrence",
      "occurrence.id",
      "participation.eventOccurrenceId",
    )
    .select([
      "participation.createdAt",
      "occurrence.eventTemplateVersionId",
      "occurrence.startsAt",
      "occurrence.endsAt",
      "occurrence.timezone",
      "occurrence.status",
      "registration.status as registrationStatus",
    ])
    .where("participation.id", "=", input.eventParticipationId)
    .where("participation.registrationId", "=", input.eventRegistrationId)
    .where("participation.eventOccurrenceId", "=", input.eventOccurrenceId)
    .where("participation.userId", "=", input.userId)
    .executeTakeFirst();
  if (
    !participation ||
    participation.status !== "published" ||
    participation.registrationStatus !== "selected"
  )
    return false;

  const [sections, items, completed, attendance, lastSession, releases] =
    await Promise.all([
      database
        .selectFrom("event_template_version_section")
        .select([
          "id",
          "releaseAnchor",
          "releaseOffsetAmount",
          "releaseOffsetUnit",
        ])
        .where(
          "eventTemplateVersionId",
          "=",
          participation.eventTemplateVersionId,
        )
        .where("phase", "=", "pre_event")
        .execute(),
      database
        .selectFrom("event_template_version_item")
        .select(["id", "sectionId", "kind", "required", "sessionDefinitionId"])
        .where(
          "eventTemplateVersionId",
          "=",
          participation.eventTemplateVersionId,
        )
        .execute(),
      database
        .selectFrom("learning_item_progress")
        .select("eventTemplateVersionItemId")
        .where("eventParticipationId", "=", input.eventParticipationId)
        .where("state", "=", "completed")
        .execute(),
      database
        .selectFrom("event_attendance as attendance")
        .innerJoin(
          "event_session as session",
          "session.id",
          "attendance.eventSessionId",
        )
        .select(["attendance.state", "session.sessionDefinitionId"])
        .where(
          "attendance.eventParticipationId",
          "=",
          input.eventParticipationId,
        )
        .execute(),
      database
        .selectFrom("event_session")
        .select("endsAt")
        .where("eventOccurrenceId", "=", input.eventOccurrenceId)
        .orderBy("endsAt", "desc")
        .executeTakeFirst(),
      database
        .selectFrom("event_section_release")
        .select("eventTemplateVersionSectionId")
        .where("eventParticipationId", "=", input.eventParticipationId)
        .execute(),
    ]);
  const completedIds = new Set(
    completed.flatMap((row) =>
      row.eventTemplateVersionItemId ? [row.eventTemplateVersionItemId] : [],
    ),
  );
  const attendedSessions = new Set(
    attendance
      .filter((row) => row.state === "attended")
      .map((row) => row.sessionDefinitionId),
  );
  const releasedSectionIds = new Set(
    releases.map((release) => release.eventTemplateVersionSectionId),
  );
  return sections.some((section) => {
    const releaseAt = calculateEventSectionReleaseAt({
      releaseAnchor: section.releaseAnchor,
      releaseOffsetAmount: section.releaseOffsetAmount,
      releaseOffsetUnit: section.releaseOffsetUnit,
      timezone: participation.timezone,
      participationCreatedAt: participation.createdAt,
      occurrenceStartsAt: participation.startsAt,
      occurrenceEndsAt: participation.endsAt,
      finalSessionEndsAt: lastSession?.endsAt ?? participation.endsAt,
    });
    if (!releasedSectionIds.has(section.id) && releaseAt > input.now)
      return false;
    const sectionItems = items.filter((item) => item.sectionId === section.id);
    const required = sectionItems.filter((item) => item.required);
    const targets = required.length ? required : sectionItems;
    return targets.some((item) =>
      item.kind === "session"
        ? !item.sessionDefinitionId ||
          !attendedSessions.has(item.sessionDefinitionId)
        : !completedIds.has(item.id),
    );
  });
}
