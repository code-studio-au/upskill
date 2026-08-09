import "@tanstack/react-start/server-only";

import { courseContentSchema } from "#/features/catalog/catalog.schema";
import type { LearnerWorkspaceResult } from "#/features/learning/learning.schema";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";

export async function findLearnerWorkspace(
  enrollmentId: string,
  user: AuthenticatedUser,
): Promise<Exclude<LearnerWorkspaceResult, { status: "unauthenticated" }>> {
  const row = await getDatabase()
    .selectFrom("enrollment")
    .innerJoin(
      "course_version",
      "course_version.id",
      "enrollment.courseVersionId",
    )
    .innerJoin("course", "course.id", "course_version.courseId")
    .select([
      "enrollment.id as enrollmentId",
      "enrollment.status",
      "enrollment.enrolledAt",
      "enrollment.expiresAt",
      "enrollment.removedAt",
      "course.slug as courseSlug",
      "course_version.content",
    ])
    .where("enrollment.id", "=", enrollmentId)
    .where("enrollment.userId", "=", user.id)
    .executeTakeFirst();
  if (!row) return { status: "not-found" };
  if (row.removedAt || row.status === "cancelled")
    return { status: "removed", courseSlug: row.courseSlug };
  if (
    row.status === "expired" ||
    (row.expiresAt !== null && row.expiresAt <= new Date())
  ) {
    return { status: "expired", courseSlug: row.courseSlug };
  }

  const content = courseContentSchema.parse(row.content);
  return {
    status: "available",
    workspace: {
      enrollmentId: row.enrollmentId,
      courseSlug: row.courseSlug,
      courseTitle: content.title,
      courseSummary: content.summary,
      completionStatus: row.status === "completed" ? "completed" : "incomplete",
      enrolledAt: row.enrolledAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      modules: content.modules.map((module, position) => ({
        position,
        title: module.title,
        phase: module.phase,
        durationMinutes: module.durationMinutes,
      })),
    },
  };
}
