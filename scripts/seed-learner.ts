import { hashPassword } from "better-auth/crypto";
import { Kysely, PostgresDialect, type Transaction } from "kysely";
import { Pool } from "pg";
import { encryptAccessCode } from "#/server/access/access-code-encryption.server";
import { issueAccessCode } from "#/server/access/access-code.server";
import type { Database } from "#/server/db/types";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const password = process.env.SEED_LEARNER_PASSWORD;
if (!password || password.length < 12)
  throw new Error("SEED_LEARNER_PASSWORD must contain at least 12 characters");

interface CredentialProfile {
  id: string;
  accountId: string;
  name: string;
  email: string;
}

const learner: CredentialProfile = {
  id: "user_local_learner",
  accountId: "account_local_learner",
  name: "Alex Learner",
  email: "learner@example.com",
};
const redeemer: CredentialProfile = {
  id: "user_local_redeemer",
  accountId: "account_local_redeemer",
  name: "Riley Redeemer",
  email: "redeemer@example.com",
};
const bulkAccessOwner: CredentialProfile = {
  id: "user_local_redeemer_2",
  accountId: "account_local_redeemer_2",
  name: "Redeemer 2",
  email: "redeemer2@example.com",
};
const administrator: CredentialProfile = {
  id: "user_local_admin",
  accountId: "account_local_admin",
  name: "Avery Administrator",
  email: "admin@example.com",
};
const scenarioLearners: Array<CredentialProfile> = Array.from(
  { length: 10 },
  (_, index) => {
    const number = index + 1;
    return {
      id: `user_local_learner_${String(number)}`,
      accountId: `account_local_learner_${String(number)}`,
      name: `Learner ${String(number)}`,
      email: `learner${String(number)}@example.com`,
    };
  },
);
const scenarioCoordinators: Array<CredentialProfile> = Array.from(
  { length: 3 },
  (_, index) => {
    const number = index + 1;
    return {
      id: `user_local_coordinator_${String(number)}`,
      accountId: `account_local_coordinator_${String(number)}`,
      name: `Coordinator ${String(number)}`,
      email: `coordinator${String(number)}@example.com`,
    };
  },
);
const exampleAccessGrantId = "access_grant_example_psychological_safety";
const bulkAccessGrantId = "access_grant_example_reseller_batch";
const exampleIssuedCode = issueAccessCode("EXAMPLE-LEARN-2026", "EXAMP7E26X");
if (!exampleIssuedCode)
  throw new Error("Local access-code fixture was invalid");
const exampleEncryptedCode = encryptAccessCode({
  accessGrantId: exampleAccessGrantId,
  lookupId: exampleIssuedCode.lookupId,
  accessCode: exampleIssuedCode.accessCode,
});
const bulkCodeSuffixes = "23456789AB";
const bulkIssuedCodes = Array.from({ length: 10 }, (_, index) => {
  const suffix = bulkCodeSuffixes[index];
  if (!suffix) throw new Error("Local bulk access-code suffix was missing");
  const issued = issueAccessCode("RESELLER-BULK-2026", `BATCHC9D2${suffix}`);
  if (!issued) throw new Error("Local bulk access-code fixture was invalid");
  return issued;
});

async function seedCredentialUser(
  transaction: Transaction<Database>,
  profile: CredentialProfile,
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
    const bulkAccessOwnerId = await seedCredentialUser(
      transaction,
      bulkAccessOwner,
      passwordHash,
    );
    const administratorId = await seedCredentialUser(
      transaction,
      administrator,
      passwordHash,
    );
    const scenarioLearnerIds = await Promise.all(
      scenarioLearners.map((profile) =>
        seedCredentialUser(transaction, profile, passwordHash),
      ),
    );
    await Promise.all(
      scenarioCoordinators.map((profile) =>
        seedCredentialUser(transaction, profile, passwordHash),
      ),
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
      .values(
        scenarioLearnerIds.map((scenarioLearnerId) => ({
          organizationId: "organization_example",
          userId: scenarioLearnerId,
          role: "learner" as const,
        })),
      )
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
      .deleteFrom("entitlement")
      .where("enrollmentId", "in", redeemerEnrollmentIds)
      .execute();
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
        id: exampleAccessGrantId,
        organizationId: "organization_example",
        orderId: null,
        courseVersionId: "course_version_psychological_safety_1",
        enrollmentDurationDays: 365,
        quantity: 100,
        redeemed: 0,
        expiresAt: new Date("2027-12-31T23:59:59.000Z"),
        fulfillmentMode: "shared_code",
        codePrefix: "UPSKILL-2027",
      })
      .onConflict((conflict) =>
        conflict.column("id").doUpdateSet({
          quantity: 100,
          redeemed: 0,
          enrollmentDurationDays: 365,
          expiresAt: new Date("2027-12-31T23:59:59.000Z"),
          fulfillmentMode: "shared_code",
          codePrefix: "UPSKILL-2027",
        }),
      )
      .execute();

    await transaction
      .insertInto("access_grant_code")
      .values({
        id: "access_grant_code_example_psychological_safety",
        accessGrantId: exampleAccessGrantId,
        lookupId: exampleIssuedCode.lookupId,
        encryptedAccessCode: exampleEncryptedCode,
        ordinal: null,
        createdAt: new Date(),
      })
      .onConflict((conflict) =>
        conflict.column("lookupId").doUpdateSet({
          lookupId: exampleIssuedCode.lookupId,
          encryptedAccessCode: exampleEncryptedCode,
          ordinal: null,
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
      .insertInto("access_grant")
      .values({
        id: bulkAccessGrantId,
        organizationId: "organization_example",
        orderId: null,
        courseVersionId: "course_version_psychological_safety_1",
        label: "Third-party reseller allocation",
        createdByUserId: administratorId,
        enrollmentDurationDays: 365,
        quantity: bulkIssuedCodes.length,
        redeemed: 0,
        expiresAt: new Date("2027-12-31T23:59:59.000Z"),
        kind: "bulk_purchase",
        customerExtendable: true,
        fulfillmentMode: "single_use_codes",
        codePrefix: "RESELLER-BULK-2026",
      })
      .onConflict((conflict) =>
        conflict.column("id").doUpdateSet({
          label: "Third-party reseller allocation",
          createdByUserId: administratorId,
          enrollmentDurationDays: 365,
          quantity: bulkIssuedCodes.length,
          expiresAt: new Date("2027-12-31T23:59:59.000Z"),
          kind: "bulk_purchase",
          customerExtendable: true,
          fulfillmentMode: "single_use_codes",
          codePrefix: "RESELLER-BULK-2026",
        }),
      )
      .execute();

    await transaction
      .insertInto("access_grant_code")
      .values(
        bulkIssuedCodes.map((issued, index) => ({
          id: `access_grant_code_example_reseller_${String(index + 1)}`,
          accessGrantId: bulkAccessGrantId,
          lookupId: issued.lookupId,
          encryptedAccessCode: encryptAccessCode({
            accessGrantId: bulkAccessGrantId,
            lookupId: issued.lookupId,
            accessCode: issued.accessCode,
          }),
          ordinal: index + 1,
          createdAt: new Date(),
        })),
      )
      .onConflict((conflict) =>
        conflict.column("id").doUpdateSet((expression) => ({
          lookupId: expression.ref("excluded.lookupId"),
          encryptedAccessCode: expression.ref("excluded.encryptedAccessCode"),
          ordinal: expression.ref("excluded.ordinal"),
        })),
      )
      .execute();

    await transaction
      .insertInto("access_grant_owner_assignment")
      .values({
        id: "access_owner_example_reseller",
        accessGrantId: bulkAccessGrantId,
        userId: bulkAccessOwnerId,
        invitedEmail: bulkAccessOwner.email,
        invitedByUserId: administratorId,
        invitedAt: new Date(),
        activatedAt: new Date(),
        revokedAt: null,
        revokedByUserId: null,
      })
      .onConflict((conflict) =>
        conflict.column("id").doUpdateSet({
          userId: bulkAccessOwnerId,
          invitedEmail: bulkAccessOwner.email,
          invitedByUserId: administratorId,
          activatedAt: new Date(),
          revokedAt: null,
          revokedByUserId: null,
        }),
      )
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

    await transaction
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
      .executeTakeFirstOrThrow();
  });

  console.log(
    `Seeded ${String(scenarioLearners.length)} scenario learners, ${String(scenarioCoordinators.length)} coordinators, compatibility learners ${learner.email} and ${redeemer.email}, bulk Access Owner ${bulkAccessOwner.email}, plus administrator ${administrator.email}`,
  );
} finally {
  await database.destroy();
}
