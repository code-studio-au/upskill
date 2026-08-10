import assert from "node:assert/strict";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { withAuditMaintenance } from "./audit-maintenance";
import { digestAccessCode } from "#/server/access/access-code.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import type { Database } from "#/server/db/types";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const pepper = process.env.ACCESS_CODE_PEPPER;
if (!pepper || pepper.length < 32)
  throw new Error("ACCESS_CODE_PEPPER must contain at least 32 characters");

const ids = {
  administrator: "verify_admin_access_administrator",
  firstLearner: "verify_admin_access_learner_a",
  secondLearner: "verify_admin_access_learner_b",
  thirdLearner: "verify_admin_access_learner_c",
  course: "verify_admin_access_course",
  version: "verify_admin_access_version",
};
const administrator: AuthenticatedUser = {
  id: ids.administrator,
  name: "Access Grant Administrator",
  email: "access-grant-administrator@example.com",
  emailVerified: true,
};
const firstLearner: AuthenticatedUser = {
  id: ids.firstLearner,
  name: "Access Grant Learner A",
  email: "access-grant-a@verified.example.com",
  emailVerified: true,
};
const secondLearner: AuthenticatedUser = {
  id: ids.secondLearner,
  name: "Access Grant Learner B",
  email: "access-grant-b@another-domain.example.org",
  emailVerified: true,
};
const thirdLearner: AuthenticatedUser = {
  id: ids.thirdLearner,
  name: "Access Grant Learner C",
  email: "access-grant-c@third-domain.example.net",
  emailVerified: true,
};
const learnerIds = [ids.firstLearner, ids.secondLearner, ids.thirdLearner];
const organizationName = "Access Grant Verification Organisation";
const database = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});

async function cleanup(): Promise<void> {
  const grants = await database
    .selectFrom("access_grant")
    .select(["id", "organizationId"])
    .where("createdByUserId", "=", ids.administrator)
    .execute();
  const grantIds = grants.map((grant) => grant.id);
  const organizationIds = grants.flatMap((grant) =>
    grant.organizationId ? [grant.organizationId] : [],
  );
  const enrollments = await database
    .selectFrom("enrollment")
    .select("id")
    .where("userId", "in", learnerIds)
    .execute();
  const enrollmentIds = enrollments.map((enrollment) => enrollment.id);
  await database
    .deleteFrom("outbox_event")
    .where("aggregateId", "in", [...grantIds, ...enrollmentIds, "none"])
    .execute();
  await withAuditMaintenance(database, async (transaction) => {
    await transaction
      .deleteFrom("audit_event")
      .where((expression) =>
        expression.or([
          expression("actorUserId", "=", ids.administrator),
          expression("subjectId", "in", [...enrollmentIds, "none"]),
        ]),
      )
      .execute();
  });
  await database
    .deleteFrom("enrollment")
    .where("userId", "in", learnerIds)
    .execute();
  if (grantIds.length > 0) {
    await database
      .deleteFrom("access_grant_domain")
      .where("accessGrantId", "in", grantIds)
      .execute();
    await database
      .deleteFrom("access_grant")
      .where("id", "in", grantIds)
      .execute();
  }
  if (organizationIds.length > 0)
    await database
      .deleteFrom("organization")
      .where("id", "in", organizationIds)
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
    .where("id", "in", [ids.administrator, ...learnerIds])
    .execute();
}

const courseContent = {
  title: "Access grant verification",
  summary: "Verifies administrator-managed organisation access.",
  description: "A published course used by the access-grant verifier.",
  topic: "technology",
  durationMinutes: 30,
  priceCents: 0,
  salePriceCents: null,
  currency: "AUD",
  featured: false,
  listInStore: false,
  hasCompletionCertificate: false,
  prerequisites: [],
  accreditations: [],
  modules: [],
  sections: [],
} as const;

try {
  await cleanup();
  await database
    .insertInto("user")
    .values(
      [administrator, firstLearner, secondLearner, thirdLearner].map(
        (user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          image: null,
          stripeCustomerId: null,
        }),
      ),
    )
    .execute();
  await database
    .insertInto("platform_admin")
    .values({ userId: administrator.id, grantedByUserId: null })
    .execute();
  await database
    .insertInto("course")
    .values({
      id: ids.course,
      slug: "verify-admin-access-grants",
      title: courseContent.title,
      status: "published",
    })
    .execute();
  await database
    .insertInto("course_version")
    .values({
      id: ids.version,
      courseId: ids.course,
      version: 1,
      content: courseContent,
      publishedAt: new Date(),
    })
    .execute();

  const {
    createAdminAccessGrant,
    findAdminAccessGrants,
    revealAdminAccessGrantCode,
    revokeAdminAccessGrant,
    updateAdminAccessGrantCapacity,
  } = await import("#/server/admin/admin-access-grant.server");
  const created = await createAdminAccessGrant(
    {
      label: "Verification cohort",
      organizationName,
      accessCode: "verify organisation 2027",
      courseVersionId: ids.version,
      quantity: 2,
      enrollmentDurationDays: 60,
      expiresOn: "",
      domains: "",
    },
    administrator,
  );
  assert.equal(created.status, "created");
  assert.equal(created.accessCode, "VERIFY-ORGANISATION-2027");
  const stored = await database
    .selectFrom("access_grant")
    .select([
      "accessCode",
      "accessCodeDigest",
      "quantity",
      "redeemed",
      "revokedAt",
      "organizationId",
    ])
    .where("id", "=", created.accessGrantId)
    .executeTakeFirstOrThrow();
  assert.equal(
    stored.accessCodeDigest,
    digestAccessCode(created.accessCode, pepper),
  );
  assert.equal(stored.accessCode, created.accessCode);
  assert.equal(stored.quantity, 2);
  assert.equal(stored.redeemed, 0);
  assert.equal(stored.revokedAt, null);
  assert.ok(stored.organizationId);
  assert.deepEqual(
    await database
      .selectFrom("access_grant_domain")
      .select("domain")
      .where("accessGrantId", "=", created.accessGrantId)
      .execute(),
    [],
  );
  const directory = await findAdminAccessGrants();
  assert.ok(
    directory.targets.some((target) => target.courseVersionId === ids.version),
  );
  assert.deepEqual(
    directory.grants.find((grant) => grant.id === created.accessGrantId)
      ?.domains,
    [],
  );
  assert.equal(
    directory.grants.find((grant) => grant.id === created.accessGrantId)
      ?.codeRetrievable,
    true,
  );
  assert.deepEqual(
    await revealAdminAccessGrantCode(
      { accessGrantId: created.accessGrantId },
      administrator,
    ),
    {
      status: "ready",
      accessGrantId: created.accessGrantId,
      accessCode: created.accessCode,
    },
  );

  assert.deepEqual(
    await updateAdminAccessGrantCapacity(
      { accessGrantId: created.accessGrantId, quantity: 4 },
      administrator,
    ),
    { status: "capacity-updated", accessGrantId: created.accessGrantId },
  );
  assert.deepEqual(
    await updateAdminAccessGrantCapacity(
      { accessGrantId: created.accessGrantId, quantity: 4 },
      administrator,
    ),
    { status: "unchanged", accessGrantId: created.accessGrantId },
  );

  const { redeemAccessCode } =
    await import("#/server/access/redeem-access-code.server");
  const redeemed = await redeemAccessCode(created.accessCode, firstLearner);
  assert.equal(redeemed.status, "enrolled");
  assert.equal(
    (await redeemAccessCode(created.accessCode, secondLearner)).status,
    "enrolled",
  );
  const enrollment = await database
    .selectFrom("enrollment")
    .select(["id", "accessGrantId", "expiresAt"])
    .where("userId", "=", firstLearner.id)
    .executeTakeFirstOrThrow();
  assert.equal(enrollment.accessGrantId, created.accessGrantId);
  assert.ok(enrollment.expiresAt);
  assert.deepEqual(
    await updateAdminAccessGrantCapacity(
      { accessGrantId: created.accessGrantId, quantity: 1 },
      administrator,
    ),
    { status: "conflict", reason: "capacity_below_redeemed" },
  );

  assert.deepEqual(
    await revokeAdminAccessGrant(
      { accessGrantId: created.accessGrantId },
      administrator,
    ),
    { status: "revoked", accessGrantId: created.accessGrantId },
  );
  assert.deepEqual(
    await revokeAdminAccessGrant(
      { accessGrantId: created.accessGrantId },
      administrator,
    ),
    { status: "unchanged", accessGrantId: created.accessGrantId },
  );
  assert.deepEqual(await redeemAccessCode(created.accessCode, thirdLearner), {
    status: "invalid",
  });
  assert.ok(
    await database
      .selectFrom("enrollment")
      .select("id")
      .where("id", "=", enrollment.id)
      .executeTakeFirst(),
  );
  assert.equal(
    await database
      .selectFrom("audit_event")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("subjectId", "=", created.accessGrantId)
      .executeTakeFirstOrThrow()
      .then((row) => row.count),
    4,
  );
  console.log(
    "Verified retrievable human-readable codes, unrestricted organisations, editable capacity, redemption visibility and non-destructive revocation",
  );
} finally {
  await cleanup();
  await database.destroy();
  const { destroyDatabase } = await import("#/server/db/database.server");
  await destroyDatabase();
}
