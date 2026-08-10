import "@tanstack/react-start/server-only";

import { sql } from "kysely";
import type {
  AvailableCourse,
  LearnerCourse,
  LearnerDashboard,
} from "#/features/learner/learner.schema";
import { courseContentSchema } from "#/features/catalog/catalog.schema";
import { getDatabase } from "#/server/db/database.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";

function emailDomain(email: string): string | null {
  const separator = email.lastIndexOf("@");
  if (separator <= 0 || separator === email.length - 1) return null;
  return email.slice(separator + 1).toLocaleLowerCase("en-AU");
}

export async function findLearnerDashboard(
  user: AuthenticatedUser,
): Promise<LearnerDashboard> {
  const now = new Date();
  const enrollmentRows = await getDatabase()
    .selectFrom("enrollment")
    .innerJoin(
      "course_version",
      "course_version.id",
      "enrollment.courseVersionId",
    )
    .innerJoin("course", "course.id", "course_version.courseId")
    .leftJoin("completion_certificate", (join) =>
      join
        .onRef("completion_certificate.enrollmentId", "=", "enrollment.id")
        .onRef(
          "completion_certificate.completedAt",
          "=",
          "enrollment.completedAt",
        ),
    )
    .select([
      "enrollment.id as enrollmentId",
      "enrollment.status",
      "enrollment.enrolledAt",
      "enrollment.completedAt",
      "enrollment.expiresAt",
      "enrollment.removedAt",
      "course.slug",
      "course_version.content",
      "completion_certificate.id as certificateId",
      "completion_certificate.status as certificateStatus",
    ])
    .where("enrollment.userId", "=", user.id)
    .orderBy("enrollment.enrolledAt", "desc")
    .execute();

  const courses: Array<LearnerCourse> = enrollmentRows.map((row) => {
    const content = courseContentSchema.parse(row.content);
    const state = row.removedAt
      ? "cancelled"
      : row.expiresAt && row.expiresAt <= now
        ? "expired"
        : row.status;
    return {
      enrollmentId: row.enrollmentId,
      slug: row.slug,
      title: content.title,
      summary: content.summary,
      durationMinutes: content.durationMinutes,
      state,
      enrolledAt: row.enrolledAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      certificate:
        row.certificateId && row.certificateStatus
          ? { id: row.certificateId, status: row.certificateStatus }
          : null,
    };
  });

  const domain = emailDomain(user.email);
  const availableCourses: Array<AvailableCourse> = [];
  if (user.emailVerified && domain) {
    const availableRows = await getDatabase()
      .selectFrom("access_grant_domain")
      .innerJoin(
        "access_grant",
        "access_grant.id",
        "access_grant_domain.accessGrantId",
      )
      .innerJoin(
        "course_version",
        "course_version.id",
        "access_grant.courseVersionId",
      )
      .innerJoin("course", "course.id", "course_version.courseId")
      .leftJoin("enrollment", (join) =>
        join
          .onRef("enrollment.courseVersionId", "=", "course_version.id")
          .on("enrollment.userId", "=", user.id),
      )
      .select([
        "course.slug",
        "course_version.content",
        "access_grant_domain.domain",
      ])
      .distinctOn("course_version.id")
      .where("access_grant_domain.domain", "=", domain)
      .where("course.status", "=", "published")
      .where("course_version.publishedAt", "is not", null)
      .where("access_grant.accessCodeDigest", "is not", null)
      .where("enrollment.id", "is", null)
      .whereRef("access_grant.redeemed", "<", "access_grant.quantity")
      .where((expression) =>
        expression.or([
          expression("access_grant.expiresAt", "is", null),
          expression("access_grant.expiresAt", ">", sql<Date>`now()`),
        ]),
      )
      .orderBy("course_version.id")
      .orderBy("course.title")
      .execute();

    for (const row of availableRows) {
      const content = courseContentSchema.parse(row.content);
      availableCourses.push({
        slug: row.slug,
        title: content.title,
        summary: content.summary,
        durationMinutes: content.durationMinutes,
        domain: row.domain,
      });
    }
  }

  const administratorAssignment = await getDatabase()
    .selectFrom("platform_admin")
    .select("userId")
    .where("userId", "=", user.id)
    .executeTakeFirst();

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      isPlatformAdministrator: Boolean(administratorAssignment),
    },
    courses,
    availableCourses,
  };
}
