import "@tanstack/react-start/server-only";

import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import { completeEnrollmentIfReady } from "#/server/learning/learning-completion.server";
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
  enrollmentId: string,
  resourceVersionId: string,
  user: AuthenticatedUser,
): Promise<LearnerResourceResult> {
  const database = getDatabase();
  const now = new Date();
  const resource = await database
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
    .where("enrollment.id", "=", enrollmentId)
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
    .where("learning_resource_version.id", "=", resourceVersionId)
    .executeTakeFirst();
  if (!resource) return { status: "not-found" };

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
    await transaction
      .insertInto("learning_item_progress")
      .values({
        enrollmentId,
        courseVersionItemId: resource.itemId,
        state: "completed",
        completedAt: now,
        updatedAt: now,
      })
      .onConflict((conflict) =>
        conflict
          .columns(["enrollmentId", "courseVersionItemId"])
          .doUpdateSet({ state: "completed", updatedAt: now }),
      )
      .execute();
    await completeEnrollmentIfReady(
      transaction,
      {
        enrollmentId,
        courseVersionId: resource.courseVersionId,
        source: "resource",
      },
      now,
    );
  });
  return { status: "ready", bytes, displayName: resource.displayName };
}
