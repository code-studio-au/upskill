import "@tanstack/react-start/server-only";

import {
  indexContentCourseVersionUsage,
  type ContentCourseVersionUsage,
} from "#/features/admin-course/course-version-usage";
import { getDatabase } from "#/server/db/database.server";

export async function findContentCourseVersionUsage(): Promise<ContentCourseVersionUsage> {
  const rows = await getDatabase()
    .selectFrom("course_version_item")
    .innerJoin(
      "course_version",
      "course_version.id",
      "course_version_item.courseVersionId",
    )
    .innerJoin("course", "course.id", "course_version.courseId")
    .select([
      "course.id as courseId",
      "course.title as courseTitle",
      "course.status as courseStatus",
      "course_version.id as courseVersionId",
      "course_version.version",
      "course_version.publishedAt",
      "course_version_item.kind",
      "course_version_item.learningActivityVersionId",
    ])
    .orderBy("course.title")
    .orderBy("course_version.version", "desc")
    .execute();

  return indexContentCourseVersionUsage(
    rows.map(({ publishedAt, ...row }) => ({
      ...row,
      versionState: publishedAt ? "published" : "draft",
    })),
  );
}
