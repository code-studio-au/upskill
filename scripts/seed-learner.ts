import { hashPassword } from "better-auth/crypto";
import { Kysely, PostgresDialect, type Transaction } from "kysely";
import { Pool } from "pg";
import { requestCompletionCertificate } from "#/server/certificate/completion-certificate.server";
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
const redeemer = {
  id: "user_local_redeemer",
  accountId: "account_local_redeemer",
  name: "Riley Redeemer",
  email: "redeemer@example.com",
};
const administrator = {
  id: "user_local_admin",
  accountId: "account_local_admin",
  name: "Avery Administrator",
  email: "admin@example.com",
};

async function seedCredentialUser(
  transaction: Transaction<Database>,
  profile: typeof learner,
  passwordHash: string,
): Promise<string> {
  await transaction
    .insertInto("user")
    .values({
      id: profile.id,
      name: profile.name,
      email: profile.email,
      emailVerified: true,
      image: null,
      stripeCustomerId: null,
    })
    .onConflict((conflict) =>
      conflict.column("email").doUpdateSet({
        name: profile.name,
        emailVerified: true,
        updatedAt: new Date(),
      }),
    )
    .execute();

  const user = await transaction
    .selectFrom("user")
    .select("id")
    .where("email", "=", profile.email)
    .executeTakeFirstOrThrow();
  await transaction
    .insertInto("account")
    .values({
      id: profile.accountId,
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
  return user.id;
}

const database = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});

try {
  const passwordHash = await hashPassword(password);
  await database.transaction().execute(async (transaction) => {
    const userId = await seedCredentialUser(transaction, learner, passwordHash);
    const redeemerId = await seedCredentialUser(
      transaction,
      redeemer,
      passwordHash,
    );
    const administratorId = await seedCredentialUser(
      transaction,
      administrator,
      passwordHash,
    );

    await transaction
      .insertInto("platform_admin")
      .values({
        userId: administratorId,
        grantedByUserId: null,
      })
      .onConflict((conflict) => conflict.column("userId").doNothing())
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
        userId,
        role: "learner",
      })
      .onConflict((conflict) =>
        conflict.columns(["organizationId", "userId"]).doUpdateSet({
          role: "learner",
        }),
      )
      .execute();

    await transaction
      .insertInto("organization_member")
      .values({
        organizationId: "organization_example",
        userId: redeemerId,
        role: "learner",
      })
      .onConflict((conflict) =>
        conflict.columns(["organizationId", "userId"]).doUpdateSet({
          role: "learner",
        }),
      )
      .execute();

    const redeemerEnrollmentIds = transaction
      .selectFrom("enrollment")
      .select("id")
      .where("userId", "=", redeemerId)
      .where("courseVersionId", "=", "course_version_psychological_safety_1");
    await transaction
      .deleteFrom("survey_progress")
      .where("enrollmentId", "in", redeemerEnrollmentIds)
      .execute();
    await transaction
      .deleteFrom("survey_response")
      .where("enrollmentId", "in", redeemerEnrollmentIds)
      .execute();
    await transaction
      .deleteFrom("enrollment")
      .where("id", "in", redeemerEnrollmentIds)
      .execute();

    await transaction
      .insertInto("access_grant")
      .values({
        id: "access_grant_example_psychological_safety",
        organizationId: "organization_example",
        orderId: null,
        courseVersionId: "course_version_psychological_safety_1",
        accessCode: "EXAMPLE-LEARN-2026",
        enrollmentDurationDays: 365,
        quantity: 100,
        redeemed: 0,
        expiresAt: new Date("2027-12-31T23:59:59.000Z"),
      })
      .onConflict((conflict) =>
        conflict.column("id").doUpdateSet({
          quantity: 100,
          redeemed: 0,
          accessCode: "EXAMPLE-LEARN-2026",
          enrollmentDurationDays: 365,
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
        userId,
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

    const completedEnrollment = await transaction
      .insertInto("enrollment")
      .values({
        id: "enrollment_local_responsible_ai",
        userId,
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
      .returning("id")
      .executeTakeFirstOrThrow();
    await requestCompletionCertificate(
      transaction,
      {
        enrollmentId: completedEnrollment.id,
        courseVersionId: "course_version_responsible_ai_1",
      },
      new Date("2026-06-10T00:00:00.000Z"),
    );
  });

  console.log(
    `Seeded verified learners ${learner.email} and ${redeemer.email}, plus administrator ${administrator.email}`,
  );
} finally {
  await database.destroy();
}
