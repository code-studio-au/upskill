import assert from "node:assert/strict";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import type { Database } from "#/server/db/types";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const ids = {
  user: "verify_workspace_user",
  anotherUser: "verify_workspace_another_user",
  course: "verify_workspace_course",
  version: "verify_workspace_version",
  enrollment: "verify_workspace_enrollment",
};
const user: AuthenticatedUser = {
  id: ids.user,
  name: "Workspace Verifier",
  email: "workspace-verifier@example.com",
  emailVerified: true,
};
const anotherUser: AuthenticatedUser = {
  id: ids.anotherUser,
  name: "Another Learner",
  email: "another-workspace-verifier@example.com",
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
    .where("id", "=", ids.version)
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
        emailVerified: user.emailVerified,
        image: null,
        stripeCustomerId: null,
      },
      {
        id: anotherUser.id,
        name: anotherUser.name,
        email: anotherUser.email,
        emailVerified: anotherUser.emailVerified,
        image: null,
        stripeCustomerId: null,
      },
    ])
    .execute();
  await database
    .insertInto("course")
    .values({
      id: ids.course,
      slug: "verify-learning-workspace",
      title: "Verified learner workspace",
      status: "published",
    })
    .execute();
  await database
    .insertInto("course_version")
    .values({
      id: ids.version,
      courseId: ids.course,
      version: 1,
      content: {
        title: "Verified learner workspace",
        summary: "Immutable course workspace verification fixture.",
        description: "Verifies entitlement-scoped learner course access.",
        topic: "technology",
        durationMinutes: 30,
        priceCents: 10_000,
        salePriceCents: null,
        currency: "AUD",
        featured: false,
        listInStore: true,
        hasCompletionCertificate: false,
        prerequisites: [],
        accreditations: [],
        modules: [
          {
            title: "Verified module",
            phase: "content",
            durationMinutes: 30,
          },
        ],
      },
      publishedAt: new Date(),
    })
    .execute();
  await database
    .insertInto("enrollment")
    .values({
      id: ids.enrollment,
      userId: ids.user,
      courseVersionId: ids.version,
      accessGrantId: null,
      status: "active",
      enrolledAt: new Date("2026-08-01T00:00:00.000Z"),
      completedAt: null,
      expiresAt: new Date("2027-08-01T00:00:00.000Z"),
      removedAt: null,
    })
    .execute();

  const { findLearnerWorkspace } =
    await import("#/server/learning/learner-workspace.server");
  const available = await findLearnerWorkspace(ids.enrollment, user);
  assert.equal(available.status, "available");
  assert.equal(available.workspace.courseTitle, "Verified learner workspace");
  assert.equal(available.workspace.completionStatus, "incomplete");
  assert.deepEqual(available.workspace.modules, [
    {
      position: 0,
      title: "Verified module",
      phase: "content",
      durationMinutes: 30,
      completionState: "incomplete",
    },
  ]);
  assert.deepEqual(await findLearnerWorkspace(ids.enrollment, anotherUser), {
    status: "not-found",
  });

  await database
    .updateTable("enrollment")
    .set({ status: "completed", completedAt: new Date() })
    .where("id", "=", ids.enrollment)
    .executeTakeFirstOrThrow();
  const completed = await findLearnerWorkspace(ids.enrollment, user);
  assert.equal(completed.status, "available");
  assert.equal(completed.workspace.completionStatus, "completed");

  await database
    .updateTable("enrollment")
    .set({ expiresAt: new Date("2026-01-01T00:00:00.000Z") })
    .where("id", "=", ids.enrollment)
    .executeTakeFirstOrThrow();
  assert.deepEqual(await findLearnerWorkspace(ids.enrollment, user), {
    status: "expired",
    courseSlug: "verify-learning-workspace",
  });

  await database
    .updateTable("enrollment")
    .set({ removedAt: new Date() })
    .where("id", "=", ids.enrollment)
    .executeTakeFirstOrThrow();
  assert.deepEqual(await findLearnerWorkspace(ids.enrollment, user), {
    status: "removed",
    courseSlug: "verify-learning-workspace",
  });

  console.log(
    "Verified learner workspace ownership, immutable version mapping, completion access, expiry and removal boundaries",
  );
} finally {
  await cleanup();
  await database.destroy();
  const { destroyDatabase } = await import("#/server/db/database.server");
  await destroyDatabase();
}
