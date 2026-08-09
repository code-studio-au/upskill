import assert from "node:assert/strict";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import type { Database } from "#/server/db/types";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const ids = {
  administrator: "verify_admin_visibility_administrator",
  learner: "verify_admin_visibility_learner",
  course: "verify_admin_visibility_course",
  version: "verify_admin_visibility_version",
  enrollment: "verify_admin_visibility_enrollment",
  order: "verify_admin_visibility_order",
  package: "verify_admin_visibility_package",
  packageVersion: "verify_admin_visibility_package_version",
  attempt: "verify_admin_visibility_attempt",
};
const administrator: AuthenticatedUser = {
  id: ids.administrator,
  name: "Admin Visibility Verifier",
  email: "admin-visibility@example.com",
  emailVerified: true,
};
const learner: AuthenticatedUser = {
  id: ids.learner,
  name: "Learner Visibility Verifier",
  email: "admin-visibility-learner@example.com",
  emailVerified: true,
};

const database = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});

async function cleanup(): Promise<void> {
  await database
    .deleteFrom("scorm_attempt")
    .where("id", "=", ids.attempt)
    .execute();
  await database
    .deleteFrom("course_version_module")
    .where("courseVersionId", "=", ids.version)
    .execute();
  await database
    .deleteFrom("enrollment")
    .where("id", "=", ids.enrollment)
    .execute();
  await database.deleteFrom("order").where("id", "=", ids.order).execute();
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

  const { isPlatformAdministrator } =
    await import("#/server/admin/admin-access.server");
  assert.equal(await isPlatformAdministrator(administrator.id), true);
  assert.equal(await isPlatformAdministrator(learner.id), false);

  const { findAdminLearnerProfile, findAdminLearners, findAdminOverview } =
    await import("#/server/admin/admin-learner.server");
  const baseline = await findAdminOverview(administrator);

  await database
    .insertInto("course")
    .values({
      id: ids.course,
      slug: "verify-admin-visibility",
      title: "Verified administration visibility",
      status: "published",
    })
    .execute();
  await database
    .insertInto("course_version")
    .values({
      id: ids.version,
      courseId: ids.course,
      version: 3,
      content: {
        title: "Verified administration visibility",
        summary: "Administration learner profile verification fixture.",
        description: "Verifies read-only administration boundaries.",
        topic: "technology",
        durationMinutes: 20,
        priceCents: 1234,
        salePriceCents: null,
        currency: "AUD",
        featured: false,
        listInStore: false,
        hasCompletionCertificate: false,
        prerequisites: [],
        accreditations: [],
        modules: [
          { title: "Verified module", phase: "content", durationMinutes: 20 },
        ],
      },
      publishedAt: new Date(),
    })
    .execute();
  await database
    .insertInto("scorm_package")
    .values({ id: ids.package, title: "Verified administration module" })
    .execute();
  await database
    .insertInto("scorm_package_version")
    .values({
      id: ids.packageVersion,
      packageId: ids.package,
      version: 1,
      status: "ready",
      standard: "scorm-1.2",
      contentPrefix: "verify/admin-visibility/v1",
      launchPath: "index.html",
      sha256: "0".repeat(64),
      manifest: {},
      publishedAt: new Date(),
    })
    .execute();
  await database
    .insertInto("course_version_module")
    .values({
      courseVersionId: ids.version,
      position: 0,
      scormPackageVersionId: ids.packageVersion,
    })
    .execute();
  await database
    .insertInto("enrollment")
    .values({
      id: ids.enrollment,
      userId: learner.id,
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
    .values({
      id: ids.attempt,
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
    })
    .execute();
  await database
    .insertInto("order")
    .values({
      id: ids.order,
      purchaserUserId: learner.id,
      stripeCheckoutSessionId: null,
      stripePaymentIntentId: null,
      status: "paid",
      currency: "AUD",
      totalCents: 1234,
    })
    .execute();

  const overview = await findAdminOverview(administrator);
  assert.equal(overview.statistics.learners, baseline.statistics.learners);
  assert.equal(
    overview.statistics.activeEnrollments,
    baseline.statistics.activeEnrollments + 1,
  );
  assert.equal(
    overview.statistics.paidOrders,
    baseline.statistics.paidOrders + 1,
  );
  assert.equal(
    overview.statistics.paidRevenueCents,
    baseline.statistics.paidRevenueCents + 1234,
  );

  const directory = await findAdminLearners({ q: learner.email, page: 1 });
  assert.equal(directory.pagination.total, 1);
  const learnerSummary = directory.learners[0];
  assert.ok(learnerSummary);
  assert.equal(learnerSummary.id, learner.id);
  assert.equal(learnerSummary.activeEnrollments, 1);

  const profile = await findAdminLearnerProfile(learner.id);
  assert.ok(profile);
  const enrollment = profile.enrollments[0];
  assert.ok(enrollment);
  assert.equal(enrollment.courseVersion, 3);
  assert.equal(enrollment.moduleCount, 1);
  assert.equal(enrollment.completedModuleCount, 1);
  assert.ok(enrollment.lastActivityAt);
  assert.equal(await findAdminLearnerProfile(administrator.id), null);

  console.log(
    "Verified platform-admin authorization, statistics, learner search and versioned progress profiles",
  );
} finally {
  await cleanup();
  await database.destroy();
  const { destroyDatabase } = await import("#/server/db/database.server");
  await destroyDatabase();
}
