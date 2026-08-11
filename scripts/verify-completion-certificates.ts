import assert from "node:assert/strict";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getLearnerCompletionCertificate } from "#/server/certificate/learner-certificate.server";
import { destroyDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { findLearnerDashboard } from "#/server/learner/learner.server";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const ids = {
  learner: "verify_certificate_learner",
  otherUser: "verify_certificate_other",
  course: "verify_certificate_course",
  courseVersion: "verify_certificate_course_version",
  enrollment: "verify_certificate_enrollment",
};
const learner: AuthenticatedUser = {
  id: ids.learner,
  name: "Certificate Learner",
  email: "certificate-learner@example.com",
  emailVerified: true,
};
const otherUser: AuthenticatedUser = {
  id: ids.otherUser,
  name: "Other Learner",
  email: "certificate-other@example.com",
  emailVerified: true,
};
const database = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});

async function cleanup(): Promise<void> {
  await database
    .deleteFrom("enrollment")
    .where("id", "=", ids.enrollment)
    .execute();
  await database
    .deleteFrom("course_version")
    .where("id", "=", ids.courseVersion)
    .execute();
  await database.deleteFrom("course").where("id", "=", ids.course).execute();
  await database
    .deleteFrom("user")
    .where("id", "in", [ids.learner, ids.otherUser])
    .execute();
}

try {
  await cleanup();
  await database
    .insertInto("user")
    .values([
      { ...learner, image: null, stripeCustomerId: null },
      { ...otherUser, image: null, stripeCustomerId: null },
    ])
    .execute();
  await database
    .insertInto("course")
    .values({
      id: ids.course,
      slug: "verify-completion-certificate",
      title: "Certificate verifier course",
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
        title: "Certificate verifier course",
        summary: "Verifies on-demand certificate rendering.",
        description: "Certificate workflow verification fixture.",
        topic: "technology",
        durationMinutes: 15,
        priceCents: 0,
        salePriceCents: null,
        currency: "AUD",
        featured: false,
        listInStore: false,
        hasCompletionCertificate: true,
        prerequisites: [],
        accreditations: [],
        modules: [],
      },
      publishedAt: new Date(),
    })
    .execute();
  const firstCompletedAt = new Date("2026-08-10T01:00:00.000Z");
  await database
    .insertInto("enrollment")
    .values({
      id: ids.enrollment,
      userId: ids.learner,
      courseVersionId: ids.courseVersion,
      accessGrantId: null,
      status: "completed",
      enrolledAt: new Date("2026-08-09T01:00:00.000Z"),
      completedAt: firstCompletedAt,
      expiresAt: null,
      removedAt: null,
    })
    .execute();

  let dashboard = await findLearnerDashboard(learner);
  assert.deepEqual(dashboard.courses[0]?.certificate, {
    enrollmentId: ids.enrollment,
  });

  const generated = await getLearnerCompletionCertificate(
    ids.enrollment,
    learner,
  );
  assert.equal(generated.status, "generated");
  assert.equal(new TextDecoder().decode(generated.bytes.slice(0, 5)), "%PDF-");
  assert.equal(
    generated.displayName,
    "Certificate-verifier-course-completion-certificate.pdf",
  );
  assert.deepEqual(
    await getLearnerCompletionCertificate(ids.enrollment, otherUser),
    { status: "not-found" },
  );

  await database
    .updateTable("enrollment")
    .set({ status: "active", completedAt: null })
    .where("id", "=", ids.enrollment)
    .executeTakeFirstOrThrow();
  dashboard = await findLearnerDashboard(learner);
  assert.equal(dashboard.courses[0]?.certificate, null);
  assert.deepEqual(
    await getLearnerCompletionCertificate(ids.enrollment, learner),
    { status: "not-found" },
  );

  await database
    .updateTable("enrollment")
    .set({
      status: "completed",
      completedAt: new Date("2026-08-10T02:00:00.000Z"),
    })
    .where("id", "=", ids.enrollment)
    .executeTakeFirstOrThrow();
  assert.equal(
    (await getLearnerCompletionCertificate(ids.enrollment, learner)).status,
    "generated",
  );

  const certificateTables = await sql<{ table_name: string }>`select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'completion_certificate'`.execute(database);
  assert.equal(certificateTables.rows.length, 0);

  console.log(
    "Verified authorization-scoped on-demand certificate rendering and immediate completion revocation/recompletion behavior",
  );
} finally {
  await cleanup();
  await destroyDatabase();
  await database.destroy();
}
