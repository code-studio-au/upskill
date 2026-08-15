import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import type { LearnerResourceInput } from "#/features/learning/learning.schema";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import { completeEnrollmentIfReady } from "#/server/learning/learning-completion.server";
import { completeEventParticipationIfReady } from "#/server/learning/event-learning-completion.server";
import {
  calculateEventSectionReleaseAt,
  ensureEventSectionReleased,
} from "#/server/learning/event-section-release.server";
import { getObjectBytes } from "#/server/storage/object-storage.server";

const MAX_RESOURCE_BYTES = 25 * 1024 * 1024;

export type LearnerResourceResult =
  | {
      status: "ready";
      bytes: Uint8Array;
      displayName: string;
    }
  | { status: "not-found" | "unavailable" };

export async function getLearnerPdfResource(
  input: LearnerResourceInput,
  user: AuthenticatedUser,
): Promise<LearnerResourceResult> {
  const database = getDatabase();
  const now = new Date();
  const resource =
    "enrollmentId" in input
      ? await database
          .selectFrom("enrollment")
          .innerJoin(
            "course_version_item",
            "course_version_item.courseVersionId",
            "enrollment.courseVersionId",
          )
          .innerJoin(
            "learning_resource_version",
            "learning_resource_version.id",
            "course_version_item.learningActivityVersionId",
          )
          .select([
            "course_version_item.id as itemId",
            "enrollment.courseVersionId",
            "learning_resource_version.objectKey",
            "learning_resource_version.displayName",
          ])
          .where("enrollment.id", "=", input.enrollmentId)
          .where("enrollment.userId", "=", user.id)
          .where("enrollment.removedAt", "is", null)
          .where("enrollment.status", "in", ["active", "completed"])
          .where((expression) =>
            expression.or([
              expression("enrollment.expiresAt", "is", null),
              expression("enrollment.expiresAt", ">", now),
            ]),
          )
          .where("course_version_item.kind", "=", "resource")
          .where("learning_resource_version.id", "=", input.resourceVersionId)
          .executeTakeFirst()
      : await database
          .selectFrom("event_participation as participation")
          .innerJoin(
            "event_occurrence as occurrence",
            "occurrence.id",
            "participation.eventOccurrenceId",
          )
          .innerJoin("event_template_version_item as item", (join) =>
            join.onRef(
              "item.eventTemplateVersionId",
              "=",
              "occurrence.eventTemplateVersionId",
            ),
          )
          .innerJoin(
            "event_template_version_section as section",
            "section.id",
            "item.sectionId",
          )
          .innerJoin(
            "learning_resource_version as resource",
            "resource.id",
            "item.learningActivityVersionId",
          )
          .select([
            "item.id as itemId",
            "participation.createdAt as participationCreatedAt",
            "participation.eventOccurrenceId",
            "occurrence.startsAt",
            "occurrence.endsAt",
            "occurrence.timezone",
            "occurrence.status as occurrenceStatus",
            "section.releaseAnchor",
            "section.releaseOffsetAmount",
            "section.releaseOffsetUnit",
            "section.id as eventTemplateVersionSectionId",
            "resource.objectKey",
            "resource.displayName",
          ])
          .where("participation.id", "=", input.eventParticipationId)
          .where("participation.userId", "=", user.id)
          .where("item.id", "=", input.eventTemplateVersionItemId)
          .where("item.kind", "=", "resource")
          .where("resource.id", "=", input.resourceVersionId)
          .executeTakeFirst();
  if (!resource) return { status: "not-found" };
  if (!("enrollmentId" in input) && !("courseVersionId" in resource)) {
    if (["cancelled", "archived"].includes(resource.occurrenceStatus))
      return { status: "not-found" };
    const finalSession = await database
      .selectFrom("event_session")
      .select("endsAt")
      .where("eventOccurrenceId", "=", resource.eventOccurrenceId)
      .orderBy("endsAt", "desc")
      .executeTakeFirst();
    if (
      !(await ensureEventSectionReleased(database, {
        eventParticipationId: input.eventParticipationId,
        eventTemplateVersionSectionId: resource.eventTemplateVersionSectionId,
        calculatedReleaseAt: calculateEventSectionReleaseAt({
          releaseAnchor: resource.releaseAnchor,
          releaseOffsetAmount: resource.releaseOffsetAmount,
          releaseOffsetUnit: resource.releaseOffsetUnit,
          timezone: resource.timezone,
          participationCreatedAt: resource.participationCreatedAt,
          occurrenceStartsAt: resource.startsAt,
          occurrenceEndsAt: resource.endsAt,
          finalSessionEndsAt: finalSession?.endsAt ?? resource.endsAt,
        }),
        now,
      }))
    )
      return { status: "not-found" };
  }

  let bytes: Uint8Array;
  try {
    bytes = await getObjectBytes(
      getServerEnv().S3_PRIVATE_RESOURCES_BUCKET,
      resource.objectKey,
      MAX_RESOURCE_BYTES,
    );
  } catch {
    return { status: "unavailable" };
  }

  await database.transaction().execute(async (transaction) => {
    if ("enrollmentId" in input && "courseVersionId" in resource) {
      await transaction
        .insertInto("learning_item_progress")
        .values({
          id: `learning_progress_${randomUUID()}`,
          enrollmentId: input.enrollmentId,
          courseVersionItemId: resource.itemId,
          eventParticipationId: null,
          eventTemplateVersionItemId: null,
          state: "completed",
          completedAt: now,
          updatedAt: now,
        })
        .onConflict((conflict) =>
          conflict
            .columns(["enrollmentId", "courseVersionItemId"])
            .where("enrollmentId", "is not", null)
            .doUpdateSet({ state: "completed", updatedAt: now }),
        )
        .execute();
      await completeEnrollmentIfReady(
        transaction,
        {
          enrollmentId: input.enrollmentId,
          courseVersionId: resource.courseVersionId,
          source: "resource",
        },
        now,
      );
    } else if (!("enrollmentId" in input)) {
      await transaction
        .insertInto("learning_item_progress")
        .values({
          id: `learning_progress_${randomUUID()}`,
          enrollmentId: null,
          courseVersionItemId: null,
          eventParticipationId: input.eventParticipationId,
          eventTemplateVersionItemId: input.eventTemplateVersionItemId,
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
        input.eventParticipationId,
        now,
      );
    }
  });
  return { status: "ready", bytes, displayName: resource.displayName };
}
