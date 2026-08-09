import assert from "node:assert/strict";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import type { Database } from "#/server/db/types";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const ids = {
  administrator: "verify_admin_progress_administrator",
  learner: "verify_admin_progress_learner",
  course: "verify_admin_progress_course",
  version: "verify_admin_progress_version",
  enrollment: "verify_admin_progress_enrollment",
  package: "verify_admin_progress_package",
  packageVersion: "verify_admin_progress_package_version",
  completedAttempt: "verify_admin_progress_attempt_completed",
  activeAttempt: "verify_admin_progress_attempt_active",
};
const administrator: AuthenticatedUser = {
  id: ids.administrator,
  name: "Admin Progress Verifier",
  email: "admin-progress@example.com",
  emailVerified: true,
};

const database = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});

async function cleanup(): Promise<void> {
  await database
    .deleteFrom("outbox_event")
    .where("aggregateId", "=", ids.enrollment)
    .execute();
  await database
    .deleteFrom("audit_event")
    .where("actorUserId", "=", ids.administrator)
    .execute();
  await database
    .deleteFrom("learning_progress_override")
    .where("enrollmentId", "=", ids.enrollment)
    .execute();
  await database
    .deleteFrom("scorm_attempt")
    .where("enrollmentId", "=", ids.enrollment)
    .execute();
  await database
    .deleteFrom("course_version_module")
    .where("courseVersionId", "=", ids.version)
    .execute();
  await database
    .deleteFrom("enrollment")
    .where("id", "=", ids.enrollment)
    .execute();
  await database
    .deleteFrom("scorm_package_version")
    .where("id", "=", ids.packageVersion)
    .execute();
  await database
    .deleteFrom("scorm_package")
    .where("id", "=", ids.package)
    .execute();
  await database
    .deleteFrom("course_version")
    .where("id", "=", ids.version)
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
        id: ids.learner,
        name: "Progress Override Learner",
        email: "progress-override-learner@example.com",
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
      slug: "verify-admin-progress",
      title: "Verified administration progress",
      status: "published",
    })
    .execute();
  await database
    .insertInto("course_version")
    .values({
      id: ids.version,
      courseId: ids.course,
      version: 4,
      content: {
        title: "Verified administration progress",
        summary: "Audited progress override verification fixture.",
        description: "Verifies append-only learning corrections.",
        topic: "technology",
        durationMinutes: 40,
        priceCents: 1200,
        salePriceCents: null,
        currency: "AUD",
        featured: false,
        listInStore: false,
        hasCompletionCertificate: false,
        prerequisites: [],
        accreditations: [],
        modules: [
          { title: "Completed module", phase: "content", durationMinutes: 20 },
          { title: "Active module", phase: "content", durationMinutes: 20 },
        ],
      },
      publishedAt: new Date(),
    })
    .execute();
  await database
    .insertInto("scorm_package")
    .values({ id: ids.package, title: "Verified progress module" })
    .execute();
  await database
    .insertInto("scorm_package_version")
    .values({
      id: ids.packageVersion,
      packageId: ids.package,
      version: 1,
      status: "ready",
      standard: "scorm-1.2",
      contentPrefix: "verify/admin-progress/v1",
      launchPath: "index.html",
      sha256: "1".repeat(64),
      manifest: {},
      publishedAt: new Date(),
    })
    .execute();
  await database
    .insertInto("course_version_module")
    .values(
      [0, 1].map((position) => ({
        courseVersionId: ids.version,
        position,
        scormPackageVersionId: ids.packageVersion,
      })),
    )
    .execute();
  await database
    .insertInto("enrollment")
    .values({
      id: ids.enrollment,
      userId: ids.learner,
      courseVersionId: ids.version,
      accessGrantId: null,
      status: "active",
      enrolledAt: new Date(),
      completedAt: null,
      expiresAt: new Date(Date.now() + 86_400_000),
      removedAt: null,
    })
    .execute();
  await database
    .insertInto("scorm_attempt")
    .values([
      {
        id: ids.completedAttempt,
        enrollmentId: ids.enrollment,
        modulePosition: 0,
        scormPackageVersionId: ids.packageVersion,
        attemptNumber: 1,
        status: "completed",
        lessonStatus: "passed",
        location: "complete",
        suspendData: "",
        scoreRaw: 100,
        scoreMin: 0,
        scoreMax: 100,
        totalTimeSeconds: 120,
        startedAt: new Date(),
        lastActivityAt: new Date(),
        completedAt: new Date(),
      },
      {
        id: ids.activeAttempt,
        enrollmentId: ids.enrollment,
        modulePosition: 1,
        scormPackageVersionId: ids.packageVersion,
        attemptNumber: 1,
        status: "in_progress",
        lessonStatus: "incomplete",
        location: "page-2",
        suspendData: "",
        scoreRaw: null,
        scoreMin: null,
        scoreMax: null,
        totalTimeSeconds: 30,
        startedAt: new Date(),
        lastActivityAt: new Date(),
        completedAt: null,
      },
    ])
    .execute();

  const { applyAdminProgressOverride, findAdminEnrollmentDetail } =
    await import("#/server/admin/admin-learner.server");
  const initial = await findAdminEnrollmentDetail(ids.learner, ids.enrollment);
  assert.ok(initial);
  assert.equal(initial.enrollment.completionState, "incomplete");
  const completedModule = initial.modules[0];
  const activeModule = initial.modules[1];
  assert.ok(completedModule);
  assert.ok(activeModule);
  assert.equal(completedModule.state, "completed");
  assert.equal(completedModule.source, "scorm");
  assert.equal(activeModule.state, "incomplete");
  assert.equal(
    await findAdminEnrollmentDetail(ids.administrator, ids.enrollment),
    null,
  );

  assert.equal(
    await applyAdminProgressOverride(
      {
        enrollmentId: ids.enrollment,
        scope: "module",
        modulePosition: 0,
        state: "incomplete",
        reason: "Completion evidence was attached to the wrong learner.",
      },
      administrator,
    ),
    "changed",
  );
  assert.equal(
    await applyAdminProgressOverride(
      {
        enrollmentId: ids.enrollment,
        scope: "module",
        modulePosition: 0,
        state: "incomplete",
        reason: "This duplicate correction must not append another record.",
      },
      administrator,
    ),
    "unchanged",
  );
  assert.equal(
    await applyAdminProgressOverride(
      {
        enrollmentId: ids.enrollment,
        scope: "module",
        modulePosition: 0,
        state: "completed",
        reason: "The learner supplied verified completion evidence.",
      },
      administrator,
    ),
    "changed",
  );
  assert.equal(
    await applyAdminProgressOverride(
      {
        enrollmentId: ids.enrollment,
        scope: "module",
        modulePosition: 1,
        state: "completed",
        reason: "The facilitator confirmed this module was completed offline.",
      },
      administrator,
    ),
    "changed",
  );
  let enrollment = await database
    .selectFrom("enrollment")
    .select(["status", "completedAt"])
    .where("id", "=", ids.enrollment)
    .executeTakeFirstOrThrow();
  assert.equal(enrollment.status, "completed");
  assert.ok(enrollment.completedAt);

  assert.equal(
    await applyAdminProgressOverride(
      {
        enrollmentId: ids.enrollment,
        scope: "enrollment",
        modulePosition: null,
        state: "incomplete",
        reason: "The final assessment requires a supervised resubmission.",
      },
      administrator,
    ),
    "changed",
  );
  assert.equal(
    await applyAdminProgressOverride(
      {
        enrollmentId: ids.enrollment,
        scope: "enrollment",
        modulePosition: null,
        state: "completed",
        reason: "The supervised resubmission was reviewed and accepted.",
      },
      administrator,
    ),
    "changed",
  );

  enrollment = await database
    .selectFrom("enrollment")
    .select(["status", "completedAt"])
    .where("id", "=", ids.enrollment)
    .executeTakeFirstOrThrow();
  assert.equal(enrollment.status, "completed");
  assert.ok(enrollment.completedAt);
  const overrides = await database
    .selectFrom("learning_progress_override")
    .selectAll()
    .where("enrollmentId", "=", ids.enrollment)
    .orderBy("sequence")
    .execute();
  assert.equal(overrides.length, 5);
  assert.ok(overrides.every((override) => override.reason.length >= 10));
  const audits = await database
    .selectFrom("audit_event")
    .select(["action", "actorUserId", "reason"])
    .where("actorUserId", "=", ids.administrator)
    .where("action", "=", "learning.progress_overridden")
    .execute();
  assert.equal(audits.length, 5);
  assert.ok(audits.every((audit) => audit.reason));
  const outbox = await database
    .selectFrom("outbox_event")
    .select("topic")
    .where("aggregateId", "=", ids.enrollment)
    .orderBy("createdAt")
    .orderBy("id")
    .execute();
  assert.deepEqual(
    outbox.map((event) => event.topic),
    [
      "enrollment.completed",
      "enrollment.completion_revoked",
      "enrollment.completed",
    ],
  );

  const corrected = await findAdminEnrollmentDetail(
    ids.learner,
    ids.enrollment,
  );
  assert.ok(corrected);
  assert.equal(corrected.enrollment.completionState, "completed");
  assert.equal(corrected.enrollment.completionSource, "administrator");
  assert.equal(corrected.modules[0]?.source, "administrator");
  assert.equal(corrected.overrideHistory.length, 5);

  console.log(
    "Verified append-only administrator progress corrections, idempotency, projections, audit history and outbox events",
  );
} finally {
  await cleanup();
  await database.destroy();
  const { destroyDatabase } = await import("#/server/db/database.server");
  await destroyDatabase();
}
