import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type {
  AdminCourseEnrollmentCreateInput,
  AdminCourseEnrollmentRemoveInput,
} from "#/features/admin-course/admin-course.schema";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import { getDatabase } from "#/server/db/database.server";

type AddEnrollmentOutcome =
  | { status: "enrolled" | "restored"; enrollmentId: string }
  | { status: "not-found"; entity: "course-version" | "learner" }
  | { status: "conflict"; reason: "already-enrolled" };

type RemoveEnrollmentOutcome =
  | { status: "removed" | "unchanged"; enrollmentId: string }
  | { status: "not-found"; entity: "enrollment" };

function learnerPredicate() {
  return sql<boolean>`not exists (
    select 1 from platform_admin
    where platform_admin."userId" = "user".id
  )`;
}

export async function addAdminCourseEnrollment(
  input: AdminCourseEnrollmentCreateInput,
  administrator: AuthenticatedUser,
): Promise<AddEnrollmentOutcome> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const [courseVersion, learner] = await Promise.all([
        transaction
          .selectFrom("course_version")
          .innerJoin("course", "course.id", "course_version.courseId")
          .select(["course_version.id", "course_version.version"])
          .where("course_version.id", "=", input.courseVersionId)
          .where("course_version.courseId", "=", input.courseId)
          .where("course_version.publishedAt", "is not", null)
          .where("course.status", "=", "published")
          .executeTakeFirst(),
        transaction
          .selectFrom("user")
          .select(["user.id", "user.email"])
          .where(
            sql<boolean>`lower("user".email) = lower(${input.learnerEmail.trim()})`,
          )
          .where("user.emailVerified", "=", true)
          .where(learnerPredicate())
          .executeTakeFirst(),
      ]);
      if (!courseVersion)
        return { status: "not-found", entity: "course-version" };
      if (!learner) return { status: "not-found", entity: "learner" };

      await sql`select pg_advisory_xact_lock(
        hashtextextended(${`${learner.id}:${courseVersion.id}`}, 0)
      )`.execute(transaction);
      const existing = await transaction
        .selectFrom("enrollment")
        .select(["id", "status", "completedAt", "expiresAt", "removedAt"])
        .where("userId", "=", learner.id)
        .where("courseVersionId", "=", courseVersion.id)
        .forUpdate()
        .executeTakeFirst();
      const now = new Date();
      const hasCurrentAccess =
        existing &&
        !existing.removedAt &&
        existing.status !== "cancelled" &&
        existing.status !== "expired" &&
        (!existing.expiresAt || existing.expiresAt > now);
      if (hasCurrentAccess)
        return { status: "conflict", reason: "already-enrolled" };

      const enrollmentId = existing?.id ?? `enrollment_${randomUUID()}`;
      const outcome = existing ? "restored" : "enrolled";
      if (existing) {
        await transaction
          .updateTable("enrollment")
          .set({
            status: existing.completedAt ? "completed" : "active",
            expiresAt: null,
            removedAt: null,
          })
          .where("id", "=", existing.id)
          .executeTakeFirstOrThrow();
      } else {
        await transaction
          .insertInto("enrollment")
          .values({
            id: enrollmentId,
            userId: learner.id,
            courseVersionId: courseVersion.id,
            accessGrantId: null,
            status: "active",
            enrolledAt: now,
            completedAt: null,
            expiresAt: null,
            removedAt: null,
          })
          .execute();
      }

      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "enrollment.administrator_added",
        subjectType: "enrollment",
        subjectId: enrollmentId,
        metadata: {
          courseId: input.courseId,
          courseVersionId: courseVersion.id,
          courseVersion: courseVersion.version,
          learnerUserId: learner.id,
          operation: outcome,
        },
        createdAt: now,
      });
      return { status: outcome, enrollmentId };
    });
}

export async function removeAdminCourseEnrollment(
  input: AdminCourseEnrollmentRemoveInput,
  administrator: AuthenticatedUser,
): Promise<RemoveEnrollmentOutcome> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const enrollment = await transaction
        .selectFrom("enrollment")
        .innerJoin(
          "course_version",
          "course_version.id",
          "enrollment.courseVersionId",
        )
        .select([
          "enrollment.id",
          "enrollment.userId",
          "enrollment.courseVersionId",
          "enrollment.status",
          "enrollment.removedAt",
        ])
        .where("enrollment.id", "=", input.enrollmentId)
        .where("course_version.courseId", "=", input.courseId)
        .forUpdate()
        .executeTakeFirst();
      if (!enrollment) return { status: "not-found", entity: "enrollment" };
      if (enrollment.removedAt || enrollment.status === "cancelled")
        return { status: "unchanged", enrollmentId: enrollment.id };

      const now = new Date();
      await transaction
        .updateTable("enrollment")
        .set({ status: "cancelled", removedAt: now })
        .where("id", "=", enrollment.id)
        .executeTakeFirstOrThrow();
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "enrollment.administrator_removed",
        subjectType: "enrollment",
        subjectId: enrollment.id,
        metadata: {
          courseId: input.courseId,
          courseVersionId: enrollment.courseVersionId,
          learnerUserId: enrollment.userId,
        },
        createdAt: now,
      });
      return { status: "removed", enrollmentId: enrollment.id };
    });
}
