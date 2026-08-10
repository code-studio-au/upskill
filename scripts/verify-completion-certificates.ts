import assert from "node:assert/strict";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { requestCompletionCertificate } from "#/server/certificate/completion-certificate.server";
import { destroyDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { findLearnerDashboard } from "#/server/learner/learner.server";
import {
  CERTIFICATE_GENERATION_TOPIC,
  parseContentWorkMessage,
} from "#/server/queue/work-message";

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
const database = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});

async function cleanup(): Promise<void> {
  const certificates = await database
    .selectFrom("completion_certificate")
    .select("id")
    .where("enrollmentId", "=", ids.enrollment)
    .execute();
  const certificateIds = certificates.map((certificate) => certificate.id);
  if (certificateIds.length > 0)
    await database
      .deleteFrom("outbox_event")
      .where("aggregateId", "in", certificateIds)
      .execute();
  await database
    .deleteFrom("outbox_event")
    .where("aggregateId", "=", ids.enrollment)
    .execute();
  await database
    .deleteFrom("completion_certificate")
    .where("enrollmentId", "=", ids.enrollment)
    .execute();
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
      {
        ...learner,
        image: null,
        stripeCustomerId: null,
      },
      {
        id: ids.otherUser,
        name: "Other Learner",
        email: "certificate-other@example.com",
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
        summary: "Verifies idempotent certificate issuance.",
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

  const firstCertificateId = await database
    .transaction()
    .execute(async (transaction) =>
      requestCompletionCertificate(
        transaction,
        {
          enrollmentId: ids.enrollment,
          courseVersionId: ids.courseVersion,
        },
        new Date("2026-08-10T01:01:00.000Z"),
      ),
    );
  assert.ok(firstCertificateId);
  const duplicateCertificateId = await database
    .transaction()
    .execute(async (transaction) =>
      requestCompletionCertificate(
        transaction,
        {
          enrollmentId: ids.enrollment,
          courseVersionId: ids.courseVersion,
        },
        new Date("2026-08-10T01:02:00.000Z"),
      ),
    );
  assert.equal(duplicateCertificateId, firstCertificateId);

  const certificates = await database
    .selectFrom("completion_certificate")
    .selectAll()
    .where("enrollmentId", "=", ids.enrollment)
    .execute();
  assert.equal(certificates.length, 1);
  const certificate = certificates[0];
  assert.ok(certificate);
  assert.equal(certificate.learnerName, learner.name);
  assert.equal(certificate.courseTitle, "Certificate verifier course");
  const workEvents = await database
    .selectFrom("outbox_event")
    .select(["id", "topic", "aggregateId", "payload"])
    .where("aggregateId", "=", firstCertificateId)
    .where("topic", "=", CERTIFICATE_GENERATION_TOPIC)
    .execute();
  assert.equal(workEvents.length, 1);
  const workEvent = workEvents[0];
  assert.ok(workEvent);
  assert.equal(
    parseContentWorkMessage(
      JSON.stringify({
        version: 1,
        eventId: workEvent.id,
        topic: workEvent.topic,
        aggregateId: workEvent.aggregateId,
        payload: workEvent.payload,
      }),
    ).aggregateId,
    firstCertificateId,
  );

  let dashboard = await findLearnerDashboard(learner);
  assert.deepEqual(dashboard.courses[0]?.certificate, {
    id: firstCertificateId,
    status: "pending",
  });
  await database
    .updateTable("completion_certificate")
    .set({
      status: "ready",
      issuedAt: new Date("2026-08-10T01:03:00.000Z"),
      updatedAt: new Date("2026-08-10T01:03:00.000Z"),
    })
    .where("id", "=", firstCertificateId)
    .executeTakeFirstOrThrow();
  dashboard = await findLearnerDashboard(learner);
  assert.equal(dashboard.courses[0]?.certificate?.status, "ready");

  await database
    .updateTable("enrollment")
    .set({ status: "active", completedAt: null })
    .where("id", "=", ids.enrollment)
    .executeTakeFirstOrThrow();
  dashboard = await findLearnerDashboard(learner);
  assert.equal(dashboard.courses[0]?.certificate, null);

  const secondCompletedAt = new Date("2026-08-10T02:00:00.000Z");
  await database
    .updateTable("enrollment")
    .set({ status: "completed", completedAt: secondCompletedAt })
    .where("id", "=", ids.enrollment)
    .executeTakeFirstOrThrow();
  const secondCertificateId = await database
    .transaction()
    .execute(async (transaction) =>
      requestCompletionCertificate(
        transaction,
        {
          enrollmentId: ids.enrollment,
          courseVersionId: ids.courseVersion,
        },
        new Date("2026-08-10T02:01:00.000Z"),
      ),
    );
  assert.ok(secondCertificateId);
  assert.notEqual(secondCertificateId, firstCertificateId);

  console.log(
    "Verified snapshot certificates, idempotent generation work, revocation and recompletion issuance",
  );
} finally {
  await cleanup();
  await destroyDatabase();
  await database.destroy();
}
