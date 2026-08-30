import "@tanstack/react-start/server-only";

import type { Transaction } from "kysely";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { Database } from "#/server/db/types";

export type EventCompletionSource =
  "attendance" | "resource" | "scorm" | "survey" | "workspace";

export async function completeEventParticipationIfReady(
  transaction: Transaction<Database>,
  input: {
    eventParticipationId: string;
    source: EventCompletionSource;
  },
  now: Date,
): Promise<boolean> {
  const { eventParticipationId } = input;
  const participation = await transaction
    .selectFrom("event_participation as participation")
    .innerJoin(
      "event_occurrence as occurrence",
      "occurrence.id",
      "participation.eventOccurrenceId",
    )
    .leftJoin(
      "event_registration as registration",
      "registration.id",
      "participation.registrationId",
    )
    .select([
      "participation.completedAt",
      "participation.mode",
      "registration.status as registrationStatus",
      "occurrence.eventTemplateVersionId",
    ])
    .where("participation.id", "=", eventParticipationId)
    .executeTakeFirst();
  if (!participation) return false;
  if (
    participation.mode === "registered" &&
    participation.registrationStatus !== "selected"
  )
    return false;
  const [sections, items, progress, attendance] = await Promise.all([
    transaction
      .selectFrom("event_template_version_section")
      .select("id")
      .where(
        "eventTemplateVersionId",
        "=",
        participation.eventTemplateVersionId,
      )
      .execute(),
    transaction
      .selectFrom("event_template_version_item")
      .select(["id", "sectionId", "kind", "required", "sessionDefinitionId"])
      .where(
        "eventTemplateVersionId",
        "=",
        participation.eventTemplateVersionId,
      )
      .execute(),
    transaction
      .selectFrom("learning_item_progress")
      .select("eventTemplateVersionItemId")
      .where("eventParticipationId", "=", eventParticipationId)
      .where("state", "=", "completed")
      .execute(),
    transaction
      .selectFrom("event_attendance as attendance")
      .innerJoin(
        "event_session as session",
        "session.id",
        "attendance.eventSessionId",
      )
      .select(["session.sessionDefinitionId", "attendance.state"])
      .where("attendance.eventParticipationId", "=", eventParticipationId)
      .execute(),
  ]);
  const completedItems = new Set(
    progress.flatMap((row) =>
      row.eventTemplateVersionItemId ? [row.eventTemplateVersionItemId] : [],
    ),
  );
  const attendedSessions = new Set(
    attendance
      .filter((row) => row.state === "attended")
      .map((row) => row.sessionDefinitionId),
  );
  const complete =
    sections.length > 0 &&
    sections.every((section) => {
      const sectionItems = items.filter(
        (item) => item.sectionId === section.id,
      );
      const required = sectionItems.filter((item) => item.required);
      const targets = required.length > 0 ? required : sectionItems;
      return (
        targets.length > 0 &&
        targets.every((item) =>
          item.kind === "session"
            ? Boolean(
                item.sessionDefinitionId &&
                attendedSessions.has(item.sessionDefinitionId),
              )
            : completedItems.has(item.id),
        )
      );
    });
  if (complete && !participation.completedAt) {
    const completed = await transaction
      .updateTable("event_participation")
      .set({ completedAt: now })
      .where("id", "=", eventParticipationId)
      .where("completedAt", "is", null)
      .returning("id")
      .executeTakeFirst();
    if (completed) {
      await recordDurableAuditEvent(transaction, {
        actorUserId: null,
        action: "event_participation.completed",
        subjectType: "event_participation",
        subjectId: eventParticipationId,
        metadata: {
          eventTemplateVersionId: participation.eventTemplateVersionId,
          source: input.source,
        },
        createdAt: now,
      });
      const { enqueueEventParticipationCommunications } =
        await import("#/server/notifications/event-communication-execution.server");
      await enqueueEventParticipationCommunications(transaction, {
        eventParticipationId,
        triggerEventId: `event-completed:${eventParticipationId}:${now.toISOString()}`,
        trigger: "event_completed",
        createdAt: now,
      });
    }
  }
  if (!complete && participation.completedAt) {
    const revoked = await transaction
      .updateTable("event_participation")
      .set({ completedAt: null })
      .where("id", "=", eventParticipationId)
      .where("completedAt", "is not", null)
      .returning("id")
      .executeTakeFirst();
    if (revoked)
      await recordDurableAuditEvent(transaction, {
        actorUserId: null,
        action: "event_participation.completion_revoked",
        subjectType: "event_participation",
        subjectId: eventParticipationId,
        metadata: {
          eventTemplateVersionId: participation.eventTemplateVersionId,
          source: input.source,
        },
        createdAt: now,
      });
  }
  return complete;
}
