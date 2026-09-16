import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import type { Database } from "#/server/db/types";
import { completeEnrollmentIfReady } from "#/server/learning/learning-completion.server";
import { completeEventParticipationIfReady } from "#/server/learning/event-learning-completion.server";

export type LockedScormProgressOwner =
  | {
      kind: "course";
      enrollmentId: string;
      courseVersionId: string;
    }
  | {
      kind: "event";
      eventParticipationId: string;
    };

export async function lockScormProgressOwner(
  transaction: Transaction<Database>,
  identity: {
    enrollmentId: string | null;
    eventParticipationId: string | null;
  },
): Promise<LockedScormProgressOwner | undefined> {
  if (identity.enrollmentId) {
    const enrollment = await transaction
      .selectFrom("enrollment")
      .select("courseVersionId")
      .where("id", "=", identity.enrollmentId)
      .forUpdate()
      .executeTakeFirst();
    return enrollment
      ? {
          kind: "course",
          enrollmentId: identity.enrollmentId,
          courseVersionId: enrollment.courseVersionId,
        }
      : undefined;
  }
  if (identity.eventParticipationId) {
    const participation = await transaction
      .selectFrom("event_participation")
      .select("id")
      .where("id", "=", identity.eventParticipationId)
      .forUpdate()
      .executeTakeFirst();
    return participation
      ? {
          kind: "event",
          eventParticipationId: participation.id,
        }
      : undefined;
  }
  return undefined;
}

export async function deriveScormCompletion(
  transaction: Transaction<Database>,
  owner: LockedScormProgressOwner,
  eventTemplateVersionItemId: string | null,
  now: Date,
): Promise<void> {
  if (owner.kind === "course") {
    await completeEnrollmentIfReady(
      transaction,
      {
        enrollmentId: owner.enrollmentId,
        courseVersionId: owner.courseVersionId,
        source: "scorm",
      },
      now,
    );
    return;
  }
  if (!eventTemplateVersionItemId) return;
  await transaction
    .insertInto("learning_item_progress")
    .values({
      id: `learning_progress_${randomUUID()}`,
      enrollmentId: null,
      courseVersionItemId: null,
      eventParticipationId: owner.eventParticipationId,
      eventTemplateVersionItemId,
      state: "completed",
      completedAt: now,
      updatedAt: now,
    })
    .onConflict((conflict) =>
      conflict
        .columns(["eventParticipationId", "eventTemplateVersionItemId"])
        .where("eventParticipationId", "is not", null)
        .doUpdateSet({ state: "completed", updatedAt: now }),
    )
    .execute();
  await completeEventParticipationIfReady(
    transaction,
    {
      eventParticipationId: owner.eventParticipationId,
      source: "scorm",
    },
    now,
  );
}
