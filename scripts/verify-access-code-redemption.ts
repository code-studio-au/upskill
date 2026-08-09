import assert from "node:assert/strict";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { digestAccessCode } from "#/server/access/access-code.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import type { Database } from "#/server/db/types";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const pepper = process.env.ACCESS_CODE_PEPPER;
if (!pepper || pepper.length < 32)
  throw new Error("ACCESS_CODE_PEPPER must contain at least 32 characters");

const ids = {
  course: "verify_access_code_course",
  version: "verify_access_code_version",
  capacityGrant: "verify_access_code_capacity_grant",
  restrictedGrant: "verify_access_code_restricted_grant",
  expiredGrant: "verify_access_code_expired_grant",
  firstUser: "verify_access_code_user_a",
  secondUser: "verify_access_code_user_b",
  unverifiedUser: "verify_access_code_user_unverified",
};
const users: Record<"first" | "second" | "unverified", AuthenticatedUser> = {
  first: {
    id: ids.firstUser,
    name: "Access Verifier A",
    email: "verifier-a@example.com",
    emailVerified: true,
  },
  second: {
    id: ids.secondUser,
    name: "Access Verifier B",
    email: "verifier-b@example.com",
    emailVerified: true,
  },
  unverified: {
    id: ids.unverifiedUser,
    name: "Access Verifier Unverified",
    email: "unverified@example.com",
    emailVerified: false,
  },
};

const database = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});

async function cleanup(): Promise<void> {
  const enrollmentRows = await database
    .selectFrom("enrollment")
    .select("id")
    .where("userId", "in", [ids.firstUser, ids.secondUser, ids.unverifiedUser])
    .execute();
  const enrollmentIds = enrollmentRows.map((row) => row.id);
  if (enrollmentIds.length > 0) {
    await database
      .deleteFrom("outbox_event")
      .where("aggregateId", "in", enrollmentIds)
      .execute();
    await database
      .deleteFrom("audit_event")
      .where("subjectId", "in", enrollmentIds)
      .execute();
  }
  await database
    .deleteFrom("enrollment")
    .where("userId", "in", [ids.firstUser, ids.secondUser, ids.unverifiedUser])
    .execute();
  await database
    .deleteFrom("access_grant_domain")
    .where("accessGrantId", "in", [
      ids.capacityGrant,
      ids.restrictedGrant,
      ids.expiredGrant,
    ])
    .execute();
  await database
    .deleteFrom("access_grant")
    .where("id", "in", [
      ids.capacityGrant,
      ids.restrictedGrant,
      ids.expiredGrant,
    ])
    .execute();
  await database
    .deleteFrom("course_version")
    .where("id", "=", ids.version)
    .execute();
  await database.deleteFrom("course").where("id", "=", ids.course).execute();
  await database
    .deleteFrom("user")
    .where("id", "in", [ids.firstUser, ids.secondUser, ids.unverifiedUser])
    .execute();
}

try {
  await cleanup();
  await database
    .insertInto("user")
    .values(
      Object.values(users).map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: null,
        stripeCustomerId: null,
      })),
    )
    .execute();
  await database
    .insertInto("course")
    .values({
      id: ids.course,
      slug: "verify-access-code-course",
      title: "Verified access-code course",
      status: "published",
    })
    .execute();
  await database
    .insertInto("course_version")
    .values({
      id: ids.version,
      courseId: ids.course,
      version: 1,
      content: {},
      publishedAt: new Date(),
    })
    .execute();
  await database
    .insertInto("access_grant")
    .values([
      {
        id: ids.capacityGrant,
        organizationId: null,
        orderId: null,
        courseVersionId: ids.version,
        accessCodeDigest: digestAccessCode("VERIFY-CAPACITY-2026", pepper),
        enrollmentDurationDays: 30,
        quantity: 1,
        redeemed: 0,
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        id: ids.restrictedGrant,
        organizationId: null,
        orderId: null,
        courseVersionId: ids.version,
        accessCodeDigest: digestAccessCode("VERIFY-DOMAIN-2026", pepper),
        enrollmentDurationDays: 30,
        quantity: 1,
        redeemed: 0,
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        id: ids.expiredGrant,
        organizationId: null,
        orderId: null,
        courseVersionId: ids.version,
        accessCodeDigest: digestAccessCode("VERIFY-EXPIRED-2026", pepper),
        enrollmentDurationDays: 30,
        quantity: 1,
        redeemed: 0,
        expiresAt: new Date(Date.now() - 60_000),
      },
    ])
    .execute();
  await database
    .insertInto("access_grant_domain")
    .values([
      { accessGrantId: ids.capacityGrant, domain: "example.com" },
      { accessGrantId: ids.restrictedGrant, domain: "example.com" },
    ])
    .execute();

  const { redeemAccessCode } =
    await import("#/server/access/redeem-access-code.server");
  const concurrentResults = await Promise.all([
    redeemAccessCode("VERIFY-CAPACITY-2026", users.first),
    redeemAccessCode("VERIFY-CAPACITY-2026", users.second),
  ]);
  assert.deepEqual(concurrentResults.map((result) => result.status).sort(), [
    "enrolled",
    "invalid",
  ]);
  const winner =
    concurrentResults[0].status === "enrolled" ? users.first : users.second;
  assert.equal(
    (await redeemAccessCode("VERIFY-CAPACITY-2026", winner)).status,
    "already-enrolled",
  );
  assert.equal(
    (await redeemAccessCode("VERIFY-DOMAIN-2026", users.unverified)).status,
    "invalid",
  );
  assert.equal(
    (await redeemAccessCode("VERIFY-EXPIRED-2026", users.unverified)).status,
    "invalid",
  );

  const capacityGrant = await database
    .selectFrom("access_grant")
    .select("redeemed")
    .where("id", "=", ids.capacityGrant)
    .executeTakeFirstOrThrow();
  assert.equal(capacityGrant.redeemed, 1);
  const enrollments = await database
    .selectFrom("enrollment")
    .select(["id", "expiresAt"])
    .where("userId", "in", [ids.firstUser, ids.secondUser])
    .execute();
  assert.equal(enrollments.length, 1);
  const enrollment = enrollments[0];
  assert.ok(enrollment);
  assert.ok(enrollment.expiresAt);
  const enrollmentId = enrollment.id;
  assert.equal(
    await database
      .selectFrom("audit_event")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("subjectId", "=", enrollmentId)
      .executeTakeFirstOrThrow()
      .then((row) => row.count),
    1,
  );
  assert.equal(
    await database
      .selectFrom("outbox_event")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("aggregateId", "=", enrollmentId)
      .executeTakeFirstOrThrow()
      .then((row) => row.count),
    1,
  );
  console.log(
    "Verified atomic access-code capacity, domain and expiry enforcement with audit/outbox writes",
  );
} finally {
  await cleanup();
  await database.destroy();
  const { destroyDatabase } = await import("#/server/db/database.server");
  await destroyDatabase();
}
