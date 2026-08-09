import { hashPassword } from "better-auth/crypto";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { Database } from "#/server/db/types";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const password = process.env.SEED_LEARNER_PASSWORD;
if (!password || password.length < 12)
  throw new Error("SEED_LEARNER_PASSWORD must contain at least 12 characters");

const learner = {
  id: "user_local_learner",
  accountId: "account_local_learner",
  name: "Alex Learner",
  email: "learner@example.com",
};

const database = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});

try {
  const passwordHash = await hashPassword(password);
  await database.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("user")
      .values({
        id: learner.id,
        name: learner.name,
        email: learner.email,
        emailVerified: true,
        image: null,
        stripeCustomerId: null,
      })
      .onConflict((conflict) =>
        conflict.column("email").doUpdateSet({
          name: learner.name,
          emailVerified: true,
          updatedAt: new Date(),
        }),
      )
      .execute();

    const user = await transaction
      .selectFrom("user")
      .select("id")
      .where("email", "=", learner.email)
      .executeTakeFirstOrThrow();

    await transaction
      .insertInto("account")
      .values({
        id: learner.accountId,
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        accessToken: null,
        refreshToken: null,
        idToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        scope: null,
        password: passwordHash,
      })
      .onConflict((conflict) =>
        conflict.columns(["providerId", "accountId"]).doUpdateSet({
          password: passwordHash,
          updatedAt: new Date(),
        }),
      )
      .execute();

    await transaction
      .insertInto("organization")
      .values({
        id: "organization_example",
        name: "Example Organisation",
        slug: "example-organisation",
      })
      .onConflict((conflict) =>
        conflict.column("slug").doUpdateSet({ name: "Example Organisation" }),
      )
      .execute();

    await transaction
      .insertInto("organization_member")
      .values({
        organizationId: "organization_example",
        userId: user.id,
        role: "learner",
      })
      .onConflict((conflict) =>
        conflict.columns(["organizationId", "userId"]).doUpdateSet({
          role: "learner",
        }),
      )
      .execute();

    await transaction
      .insertInto("access_grant")
      .values({
        id: "access_grant_example_psychological_safety",
        organizationId: "organization_example",
        orderId: null,
        courseVersionId: "course_version_psychological_safety_1",
        quantity: 100,
        redeemed: 0,
        expiresAt: new Date("2027-12-31T23:59:59.000Z"),
      })
      .onConflict((conflict) =>
        conflict.column("id").doUpdateSet({
          quantity: 100,
          expiresAt: new Date("2027-12-31T23:59:59.000Z"),
        }),
      )
      .execute();

    await transaction
      .insertInto("access_grant_domain")
      .values({
        accessGrantId: "access_grant_example_psychological_safety",
        domain: "example.com",
      })
      .onConflict((conflict) => conflict.doNothing())
      .execute();

    await transaction
      .insertInto("enrollment")
      .values({
        id: "enrollment_local_leading_change",
        userId: user.id,
        courseVersionId: "course_version_leading_through_change_1",
        accessGrantId: null,
        status: "active",
        enrolledAt: new Date("2026-08-01T00:00:00.000Z"),
        completedAt: null,
        expiresAt: new Date("2027-08-01T00:00:00.000Z"),
        removedAt: null,
      })
      .onConflict((conflict) =>
        conflict.columns(["userId", "courseVersionId"]).doUpdateSet({
          status: "active",
          completedAt: null,
          expiresAt: new Date("2027-08-01T00:00:00.000Z"),
          removedAt: null,
        }),
      )
      .execute();

    await transaction
      .insertInto("enrollment")
      .values({
        id: "enrollment_local_responsible_ai",
        userId: user.id,
        courseVersionId: "course_version_responsible_ai_1",
        accessGrantId: null,
        status: "completed",
        enrolledAt: new Date("2026-06-01T00:00:00.000Z"),
        completedAt: new Date("2026-06-10T00:00:00.000Z"),
        expiresAt: null,
        removedAt: null,
      })
      .onConflict((conflict) =>
        conflict.columns(["userId", "courseVersionId"]).doUpdateSet({
          status: "completed",
          completedAt: new Date("2026-06-10T00:00:00.000Z"),
          expiresAt: null,
          removedAt: null,
        }),
      )
      .execute();
  });

  console.log(
    `Seeded verified learner ${learner.email} and learner access data`,
  );
} finally {
  await database.destroy();
}
