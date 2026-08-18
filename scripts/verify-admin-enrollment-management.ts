import assert from "node:assert/strict";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { withAuditMaintenance } from "./audit-maintenance";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import type { Database } from "#/server/db/types";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const ids = {
  administrator: "verify_admin_enrollment_administrator",
  learner: "verify_admin_enrollment_learner",
  course: "verify_admin_enrollment_course",
  version: "verify_admin_enrollment_version",
  draftVersion: "verify_admin_enrollment_draft_version",
};
const administrator: AuthenticatedUser = {
  id: ids.administrator,
  name: "Admin Enrollment Verifier",
  email: "admin-enrollment-verifier@example.com",
  emailVerified: true,
};
const learner: AuthenticatedUser = {
  id: ids.learner,
  name: "Managed Enrollment Learner",
  email: "managed-enrollment-learner@example.com",
  emailVerified: true,
};
const database = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});

async function cleanup(): Promise<void> {
  const enrollments = await database
    .selectFrom("enrollment")
    .select("id")
    .where("userId", "=", ids.learner)
    .execute();
  const enrollmentIds = enrollments.map((enrollment) => enrollment.id);
  if (enrollmentIds.length > 0) {
    await database
      .deleteFrom("entitlement")
      .where("enrollmentId", "in", enrollmentIds)
      .execute();
    await database
      .deleteFrom("outbox_event")
      .where("aggregateId", "in", enrollmentIds)
      .execute();
  }
  await database
    .deleteFrom("outbox_event")
    .where(sql<boolean>`payload ->> 'actorUserId' = ${ids.administrator}`)
    .execute();
  await withAuditMaintenance(database, async (database) => {
    await database
      .deleteFrom("audit_event")
      .where("actorUserId", "=", ids.administrator)
      .execute();
  });
  await database
    .deleteFrom("enrollment")
    .where("userId", "=", ids.learner)
    .execute();
  await database
    .deleteFrom("course_version")
    .where("id", "in", [ids.version, ids.draftVersion])
    .execute();
  await database.deleteFrom("course").where("id", "=", ids.course).execute();
  await database
    .deleteFrom("platform_admin")
    .where("userId", "=", ids.administrator)
    .execute();
  await database
    .deleteFrom("user")
    .where("id", "in", [ids.administrator, ids.learner])
    .execute();
}

const courseContent = {
  title: "Managed enrollment verification",
  summary: "Verifies administrator-managed learner access.",
  description: "A published course used by the database verifier.",
  topic: "technology",
  durationMinutes: 30,
  priceCents: 0,
  salePriceCents: null,
  currency: "AUD",
  featured: false,
  listInStore: false,
  hasCompletionCertificate: false,
  prerequisites: [],
  accreditations: [],
  modules: [],
  sections: [],
} as const;

try {
  await cleanup();
  await database
    .insertInto("user")
    .values([
      {
        id: administrator.id,
        name: administrator.name,
        email: administrator.email,
        emailVerified: true,
        image: null,
        stripeCustomerId: null,
      },
      {
        id: learner.id,
        name: learner.name,
        email: learner.email,
        emailVerified: true,
        image: null,
        stripeCustomerId: null,
      },
    ])
    .execute();
  await database
    .insertInto("platform_admin")
    .values({ userId: administrator.id, grantedByUserId: null })
    .execute();
  await database
    .insertInto("course")
    .values({
      id: ids.course,
      slug: "verify-admin-enrollment-management",
      title: courseContent.title,
      status: "published",
    })
    .execute();
  await database
    .insertInto("course_version")
    .values([
      {
        id: ids.version,
        courseId: ids.course,
        version: 1,
        content: courseContent,
        publishedAt: new Date("2026-08-10T00:00:00.000Z"),
      },
      {
        id: ids.draftVersion,
        courseId: ids.course,
        version: 2,
        content: courseContent,
        publishedAt: null,
      },
    ])
    .execute();

  const { addAdminCourseEnrollment, removeAdminCourseEnrollment } =
    await import("#/server/admin/admin-enrollment.server");
  assert.deepEqual(
    await addAdminCourseEnrollment(
      {
        courseId: ids.course,
        courseVersionId: ids.draftVersion,
        learnerEmail: learner.email,
      },
      administrator,
    ),
    { status: "not-found", entity: "course-version" },
  );
  assert.deepEqual(
    await addAdminCourseEnrollment(
      {
        courseId: ids.course,
        courseVersionId: ids.version,
        learnerEmail: "missing-learner@example.com",
      },
      administrator,
    ),
    { status: "not-found", entity: "learner" },
  );

  const added = await addAdminCourseEnrollment(
    {
      courseId: ids.course,
      courseVersionId: ids.version,
      learnerEmail: learner.email.toUpperCase(),
    },
    administrator,
  );
  assert.equal(added.status, "enrolled");
  const enrollmentId = added.enrollmentId;
  assert.deepEqual(
    await addAdminCourseEnrollment(
      {
        courseId: ids.course,
        courseVersionId: ids.version,
        learnerEmail: learner.email,
      },
      administrator,
    ),
    { status: "conflict", reason: "already-enrolled" },
  );

  const completedAt = new Date("2026-08-10T02:00:00.000Z");
  await database
    .updateTable("enrollment")
    .set({ status: "completed", completedAt })
    .where("id", "=", enrollmentId)
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    await removeAdminCourseEnrollment(
      { courseId: "another_course", enrollmentId },
      administrator,
    ),
    { status: "not-found", entity: "enrollment" },
  );
  assert.deepEqual(
    await removeAdminCourseEnrollment(
      { courseId: ids.course, enrollmentId },
      administrator,
    ),
    { status: "removed", enrollmentId },
  );
  assert.deepEqual(
    await removeAdminCourseEnrollment(
      { courseId: ids.course, enrollmentId },
      administrator,
    ),
    { status: "unchanged", enrollmentId },
  );
  const removed = await database
    .selectFrom("enrollment")
    .select(["status", "completedAt", "removedAt"])
    .where("id", "=", enrollmentId)
    .executeTakeFirstOrThrow();
  assert.equal(removed.status, "cancelled");
  assert.equal(removed.completedAt?.toISOString(), completedAt.toISOString());
  assert.ok(removed.removedAt);
  const { findAdminEnrollmentDetail } =
    await import("#/server/admin/admin-learner.server");
  const removedDetail = await findAdminEnrollmentDetail(
    learner.id,
    enrollmentId,
  );
  assert.ok(removedDetail);
  assert.equal(removedDetail.enrollment.accessStatus, "cancelled");
  assert.equal(removedDetail.enrollment.completionState, "completed");
  assert.equal(removedDetail.enrollment.completedAt, completedAt.toISOString());

  assert.deepEqual(
    await addAdminCourseEnrollment(
      {
        courseId: ids.course,
        courseVersionId: ids.version,
        learnerEmail: learner.email,
      },
      administrator,
    ),
    { status: "restored", enrollmentId },
  );
  const restored = await database
    .selectFrom("enrollment")
    .select(["status", "completedAt", "expiresAt", "removedAt"])
    .where("id", "=", enrollmentId)
    .executeTakeFirstOrThrow();
  assert.deepEqual(restored, {
    status: "completed",
    completedAt,
    expiresAt: null,
    removedAt: null,
  });

  const audits = await database
    .selectFrom("audit_event")
    .select(["action", "subjectId", "metadata"])
    .where("actorUserId", "=", administrator.id)
    .orderBy("createdAt")
    .orderBy("id")
    .execute();
  assert.deepEqual(
    audits.map((audit) => ({
      action: audit.action,
      subjectId: audit.subjectId,
      operation:
        typeof audit.metadata === "object" &&
        audit.metadata !== null &&
        !Array.isArray(audit.metadata) &&
        "operation" in audit.metadata
          ? audit.metadata.operation
          : null,
    })),
    [
      {
        action: "enrollment.administrator_added",
        subjectId: enrollmentId,
        operation: "enrolled",
      },
      {
        action: "enrollment.administrator_removed",
        subjectId: enrollmentId,
        operation: null,
      },
      {
        action: "enrollment.administrator_added",
        subjectId: enrollmentId,
        operation: "restored",
      },
    ],
  );
  const projected = await database
    .selectFrom("outbox_event")
    .select("topic")
    .where("aggregateId", "=", enrollmentId)
    .execute();
  assert.equal(projected.length, 4);
  assert.equal(
    projected.filter((event) => event.topic === "audit.log_requested").length,
    3,
  );
  assert.equal(
    projected.filter((event) => event.topic === "enrollment.created").length,
    1,
  );

  console.log(
    "Verified administrator enrollment, duplicate protection, soft removal, history-preserving restoration and durable audit projections",
  );
} finally {
  await cleanup();
  await database.destroy();
  const { destroyDatabase } = await import("#/server/db/database.server");
  await destroyDatabase();
}
