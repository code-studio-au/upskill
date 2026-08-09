import assert from "node:assert/strict";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import type { Database } from "#/server/db/types";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const ids = {
  user: "verify_scorm_user",
  anotherUser: "verify_scorm_another_user",
  course: "verify_scorm_course",
  courseVersion: "verify_scorm_course_version",
  enrollment: "verify_scorm_enrollment",
  package: "verify_scorm_package",
  packageVersion: "verify_scorm_package_version",
};
const user: AuthenticatedUser = {
  id: ids.user,
  name: "SCORM Verifier",
  email: "scorm-verifier@example.com",
  emailVerified: true,
};
const anotherUser: AuthenticatedUser = {
  id: ids.anotherUser,
  name: "Another SCORM Learner",
  email: "another-scorm-verifier@example.com",
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
    .where((expression) =>
      expression.or([
        expression("subjectId", "=", ids.enrollment),
        expression("metadata", "@>", { enrollmentId: ids.enrollment }),
      ]),
    )
    .execute();
  const attempts = await database
    .selectFrom("scorm_attempt")
    .select("id")
    .where("enrollmentId", "=", ids.enrollment)
    .execute();
  const attemptIds = attempts.map((attempt) => attempt.id);
  if (attemptIds.length > 0) {
    await database
      .deleteFrom("scorm_attempt_session")
      .where("attemptId", "in", attemptIds)
      .execute();
    await database
      .deleteFrom("scorm_launch_token")
      .where("attemptId", "in", attemptIds)
      .execute();
    await database
      .deleteFrom("audit_event")
      .where("subjectId", "in", attemptIds)
      .execute();
  }
  await database
    .deleteFrom("scorm_attempt")
    .where("enrollmentId", "=", ids.enrollment)
    .execute();
  await database
    .deleteFrom("course_version_module")
    .where("courseVersionId", "=", ids.courseVersion)
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
    .where("id", "=", ids.courseVersion)
    .execute();
  await database.deleteFrom("course").where("id", "=", ids.course).execute();
  await database
    .deleteFrom("user")
    .where("id", "in", [ids.user, ids.anotherUser])
    .execute();
}

try {
  await cleanup();
  await database
    .insertInto("user")
    .values([
      {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: true,
        image: null,
        stripeCustomerId: null,
      },
      {
        id: anotherUser.id,
        name: anotherUser.name,
        email: anotherUser.email,
        emailVerified: true,
        image: null,
        stripeCustomerId: null,
      },
    ])
    .execute();
  await database
    .insertInto("course")
    .values({
      id: ids.course,
      slug: "verify-scorm-course",
      title: "Verified SCORM course",
      status: "published",
    })
    .execute();
  await database
    .insertInto("course_version")
    .values({
      id: ids.courseVersion,
      courseId: ids.course,
      version: 1,
      content: {
        title: "Verified SCORM course",
        summary: "Attempt boundary verification fixture.",
        description: "Verifies SCORM entitlement and progress persistence.",
        topic: "technology",
        durationMinutes: 20,
        priceCents: 10_000,
        salePriceCents: null,
        currency: "AUD",
        featured: false,
        listInStore: true,
        hasCompletionCertificate: false,
        prerequisites: [],
        accreditations: [],
        modules: [
          { title: "Verified SCO", phase: "content", durationMinutes: 20 },
        ],
      },
      publishedAt: new Date(),
    })
    .execute();
  await database
    .insertInto("scorm_package")
    .values({ id: ids.package, title: "Verified SCORM package" })
    .execute();
  await database
    .insertInto("scorm_package_version")
    .values({
      id: ids.packageVersion,
      packageId: ids.package,
      version: 1,
      status: "ready",
      standard: "scorm-1.2",
      contentPrefix: "verified/package/v1",
      launchPath: "index.html",
      sha256: "a".repeat(64),
      manifest: { identifier: "verified-sco" },
      publishedAt: new Date(),
    })
    .execute();
  await database
    .insertInto("course_version_module")
    .values({
      courseVersionId: ids.courseVersion,
      position: 0,
      scormPackageVersionId: ids.packageVersion,
    })
    .execute();
  await database
    .insertInto("enrollment")
    .values({
      id: ids.enrollment,
      userId: ids.user,
      courseVersionId: ids.courseVersion,
      accessGrantId: null,
      status: "active",
      enrolledAt: new Date(),
      completedAt: null,
      expiresAt: new Date("2027-08-01T00:00:00.000Z"),
      removedAt: null,
    })
    .execute();

  const {
    authorizeScormAttemptSession,
    createScormLaunch,
    exchangeScormLaunchToken,
    recordScormProgress,
  } = await import("#/server/scorm/scorm-attempt.server");
  assert.deepEqual(await createScormLaunch(ids.enrollment, 0, anotherUser), {
    status: "not-found",
  });
  const launch = await createScormLaunch(ids.enrollment, 0, user);
  assert.equal(launch.status, "ready");
  assert.match(
    launch.launchUrl,
    /^http:\/\/localhost:3001\/api\/scorm\/launch/,
  );
  const launchToken = new URL(launch.launchUrl).searchParams.get("token");
  assert.ok(launchToken);
  assert.equal(launchToken.length, 43);

  const exchange = await exchangeScormLaunchToken(launchToken);
  assert.ok(exchange);
  assert.equal(await exchangeScormLaunchToken(launchToken), null);
  assert.equal(
    await authorizeScormAttemptSession(
      exchange.attemptId,
      exchange.sessionToken,
    ),
    true,
  );
  assert.equal(
    await authorizeScormAttemptSession(exchange.attemptId, "x".repeat(43)),
    false,
  );

  const progress = {
    lessonStatus: "incomplete" as const,
    location: "slide-4",
    suspendData: "verified-state",
    scoreRaw: 75,
    scoreMin: 0,
    scoreMax: 100,
    totalTimeSeconds: 180,
  };
  assert.equal(
    await recordScormProgress(
      exchange.attemptId,
      exchange.sessionToken,
      progress,
    ),
    "updated",
  );
  assert.equal(
    await recordScormProgress(exchange.attemptId, exchange.sessionToken, {
      ...progress,
      lessonStatus: "passed",
      totalTimeSeconds: 300,
    }),
    "completed",
  );
  assert.equal(
    await recordScormProgress(
      exchange.attemptId,
      exchange.sessionToken,
      progress,
    ),
    "completed",
  );

  const attempt = await database
    .selectFrom("scorm_attempt")
    .select(["status", "lessonStatus", "location", "totalTimeSeconds"])
    .where("id", "=", exchange.attemptId)
    .executeTakeFirstOrThrow();
  assert.deepEqual(attempt, {
    status: "completed",
    lessonStatus: "passed",
    location: "slide-4",
    totalTimeSeconds: 300,
  });
  const enrollment = await database
    .selectFrom("enrollment")
    .select(["status", "completedAt"])
    .where("id", "=", ids.enrollment)
    .executeTakeFirstOrThrow();
  assert.equal(enrollment.status, "completed");
  assert.ok(enrollment.completedAt);
  const completionEvents = await database
    .selectFrom("outbox_event")
    .select(sql<number>`count(*)::integer`.as("count"))
    .where("aggregateId", "=", ids.enrollment)
    .where("topic", "=", "enrollment.completed")
    .executeTakeFirstOrThrow();
  assert.equal(completionEvents.count, 1);

  await database
    .updateTable("enrollment")
    .set({ removedAt: new Date() })
    .where("id", "=", ids.enrollment)
    .executeTakeFirstOrThrow();
  assert.deepEqual(await createScormLaunch(ids.enrollment, 0, user), {
    status: "unavailable",
  });

  console.log(
    "Verified SCORM ownership, one-time launch exchange, attempt sessions, progress persistence and replay-safe course completion",
  );
} finally {
  await cleanup();
  await database.destroy();
  const { destroyDatabase } = await import("#/server/db/database.server");
  await destroyDatabase();
}
