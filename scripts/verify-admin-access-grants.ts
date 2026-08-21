import assert from "node:assert/strict";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { withAuditMaintenance } from "./audit-maintenance";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import type { Database } from "#/server/db/types";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const ids = {
  administrator: "verify_admin_access_administrator",
  firstLearner: "verify_admin_access_learner_a",
  secondLearner: "verify_admin_access_learner_b",
  thirdLearner: "verify_admin_access_learner_c",
  eventLearner: "verify_admin_access_event_learner",
  course: "verify_admin_access_course",
  version: "verify_admin_access_version",
  eventTemplate: "verify_admin_access_event_template",
  eventTemplateVersion: "verify_admin_access_event_version",
  eventOccurrence: "verify_admin_access_event_occurrence",
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
const eventLearner: AuthenticatedUser = {
  id: ids.eventLearner,
  name: "Access Grant Event Learner",
  email: "access-grant-event@verified.example.com",
  emailVerified: true,
};
const learnerIds = [
  ids.firstLearner,
  ids.secondLearner,
  ids.thirdLearner,
  ids.eventLearner,
];
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
  const eventRedemptions = await database
    .selectFrom("event_access_redemption")
    .select(["id", "eventRegistrationId", "eventParticipationId"])
    .where("userId", "in", learnerIds)
    .execute();
  const eventRegistrationIds = eventRedemptions.map(
    (redemption) => redemption.eventRegistrationId,
  );
  const eventParticipationIds = eventRedemptions.map(
    (redemption) => redemption.eventParticipationId,
  );
  if (enrollmentIds.length > 0)
    await database
      .deleteFrom("entitlement")
      .where("enrollmentId", "in", enrollmentIds)
      .execute();
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
          expression("actorUserId", "in", learnerIds),
          expression("subjectId", "in", [...enrollmentIds, "none"]),
        ]),
      )
      .execute();
  });
  await database
    .deleteFrom("enrollment")
    .where("userId", "in", learnerIds)
    .execute();
  if (eventRedemptions.length > 0) {
    await database
      .deleteFrom("event_access_redemption")
      .where(
        "id",
        "in",
        eventRedemptions.map((redemption) => redemption.id),
      )
      .execute();
    await database
      .deleteFrom("event_registration_transition")
      .where("eventRegistrationId", "in", eventRegistrationIds)
      .execute();
    await database
      .deleteFrom("event_participation")
      .where("id", "in", eventParticipationIds)
      .execute();
    await database
      .deleteFrom("event_registration")
      .where("id", "in", eventRegistrationIds)
      .execute();
  }
  if (grantIds.length > 0) {
    await database
      .deleteFrom("access_grant_owner_assignment")
      .where("accessGrantId", "in", grantIds)
      .execute();
    await database
      .deleteFrom("access_grant_domain")
      .where("accessGrantId", "in", grantIds)
      .execute();
    await database
      .deleteFrom("access_grant_code")
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
    .deleteFrom("event_occurrence")
    .where("id", "=", ids.eventOccurrence)
    .execute();
  await database
    .deleteFrom("event_template_version")
    .where("id", "=", ids.eventTemplateVersion)
    .execute();
  await database
    .deleteFrom("event_template")
    .where("id", "=", ids.eventTemplate)
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
      [
        administrator,
        firstLearner,
        secondLearner,
        thirdLearner,
        eventLearner,
      ].map((user) => ({
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
  const now = new Date();
  await database
    .insertInto("event_template")
    .values({
      id: ids.eventTemplate,
      title: "Access grant verification event",
      status: "published",
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  await database
    .insertInto("event_template_version")
    .values({
      id: ids.eventTemplateVersion,
      eventTemplateId: ids.eventTemplate,
      version: 1,
      topic: "clinical-practice",
      summary: "Verifies event enterprise access.",
      description: "A published event used by the access-grant verifier.",
      coverImage: null,
      hasCompletionCertificate: true,
      accreditations: JSON.stringify([]),
      publishedAt: now,
      createdAt: now,
    })
    .execute();
  await database
    .insertInto("event_occurrence")
    .values({
      id: ids.eventOccurrence,
      eventTemplateVersionId: ids.eventTemplateVersion,
      title: "Access grant verification event — Sydney",
      slug: "verify-admin-access-event",
      status: "published",
      deliveryMode: "virtual",
      registrationMode: "required_unrestricted",
      approvalMode: "automatic",
      timezone: "Australia/Sydney",
      localStartsAt: "2027-11-15T09:00:00",
      localEndsAt: "2027-11-15T17:00:00",
      localRegistrationOpensAt: null,
      localRegistrationClosesAt: null,
      localCoordinatorLockAt: null,
      startsAt: new Date("2027-11-14T22:00:00.000Z"),
      endsAt: new Date("2027-11-15T06:00:00.000Z"),
      registrationOpensAt: null,
      registrationClosesAt: null,
      coordinatorLockAt: null,
      capacity: 20,
      priceCents: null,
      salePriceCents: null,
      currency: "AUD",
      bulkPricing: JSON.stringify({ enabled: false, tiers: [] }),
      listInStore: false,
      featured: false,
      venueName: null,
      venueAddress: null,
      virtualJoinUrl: "https://meet.example.test/access-grant-verification",
      publishedAt: now,
      createdByUserId: administrator.id,
      createdAt: now,
      updatedAt: now,
    })
    .execute();

  const {
    createAdminAccessGrant,
    findAdminAccessGrantRedemptions,
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
      targetType: "course",
      targetId: ids.version,
      quantity: 2,
      enrollmentDurationDays: 60,
      expiresOn: "",
      domains: "",
      kind: "bulk_purchase",
      fulfillmentMode: "shared_code",
      customerExtendable: true,
      ownerEmails: administrator.email,
    },
    administrator,
  );
  assert.equal(created.status, "created");
  assert.ok(created.accessCode);
  assert.match(
    created.accessCode,
    /^VERIFY-ORGANISATION-2027-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/u,
  );
  const sameBase = await createAdminAccessGrant(
    {
      label: "Independent code with the same memorable base",
      organizationName,
      accessCode: "verify organisation 2027",
      targetType: "course",
      targetId: ids.version,
      quantity: 1,
      enrollmentDurationDays: 60,
      expiresOn: "",
      domains: "",
      kind: "bulk_purchase",
      fulfillmentMode: "shared_code",
      customerExtendable: false,
      ownerEmails: administrator.email,
    },
    administrator,
  );
  assert.equal(sameBase.status, "created");
  assert.ok(sameBase.accessCode);
  assert.notEqual(sameBase.accessCode, created.accessCode);
  const stored = await database
    .selectFrom("access_grant")
    .select([
      "quantity",
      "redeemed",
      "revokedAt",
      "organizationId",
      "fulfillmentMode",
    ])
    .where("id", "=", created.accessGrantId)
    .executeTakeFirstOrThrow();
  const storedCode = await database
    .selectFrom("access_grant_code")
    .select(["lookupId", "encryptedAccessCode", "ordinal"])
    .where("accessGrantId", "=", created.accessGrantId)
    .executeTakeFirstOrThrow();
  assert.equal(stored.fulfillmentMode, "shared_code");
  assert.equal(storedCode.lookupId, created.accessCode.slice(-10));
  assert.equal(storedCode.ordinal, null);
  assert.ok(storedCode.encryptedAccessCode.startsWith("v1."));
  assert.ok(!storedCode.encryptedAccessCode.includes("VERIFY"));
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
  const directory = await findAdminAccessGrants();
  assert.ok(directory.targets.some((target) => target.id === ids.version));
  assert.deepEqual(
    directory.grants.find((grant) => grant.id === created.accessGrantId)
      ?.domains,
    [],
  );
  assert.deepEqual(
    directory.grants.find((grant) => grant.id === created.accessGrantId)
      ?.owners,
    [
      {
        id: directory.grants.find((grant) => grant.id === created.accessGrantId)
          ?.owners[0]?.id,
        name: administrator.name,
        email: administrator.email,
        status: "active",
      },
    ],
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
  const redemption = (code: string) => ({
    code,
    informationReleaseAccepted: true as const,
    noticeVersion: "access-owner-v1" as const,
  });
  const redeemed = await redeemAccessCode(
    redemption(
      created.accessCode.replaceAll("-", " ").toLocaleLowerCase("en-AU"),
    ),
    firstLearner,
  );
  assert.equal(redeemed.status, "enrolled");
  assert.equal(
    (await redeemAccessCode(redemption(created.accessCode), secondLearner))
      .status,
    "enrolled",
  );
  const redemptionPage = await findAdminAccessGrantRedemptions({
    accessGrantId: created.accessGrantId,
    page: 1,
  });
  assert.equal(redemptionPage?.total, 2);
  assert.deepEqual(
    redemptionPage.rows.map((row) => row.learnerEmail).sort(),
    [firstLearner.email, secondLearner.email].sort(),
  );
  const {
    exportAccessOwnerCodes,
    findAccessOwnerDashboard,
    revealAccessOwnerCode,
  } = await import("#/server/access/access-owner.server");
  const ownerDashboard = await findAccessOwnerDashboard(administrator);
  const ownedGrant = ownerDashboard?.grants.find(
    (grant) => grant.id === created.accessGrantId,
  );
  assert.equal(ownedGrant?.learners.length, 2);
  assert.deepEqual(
    ownedGrant.learners.map((learner) => learner.email).sort(),
    [firstLearner.email, secondLearner.email].sort(),
  );
  assert.deepEqual(
    await revealAccessOwnerCode(created.accessGrantId, administrator),
    { status: "ready", accessCode: created.accessCode },
  );
  assert.equal(await findAccessOwnerDashboard(firstLearner), null);
  assert.deepEqual(
    await revealAccessOwnerCode(created.accessGrantId, firstLearner),
    { status: "not-found" },
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
  assert.deepEqual(
    await redeemAccessCode(redemption(created.accessCode), thirdLearner),
    { status: "invalid" },
  );

  const batch = await createAdminAccessGrant(
    {
      label: "Third-party single-use resale codes",
      organizationName,
      accessCode: "verify reseller 2027",
      targetType: "course",
      targetId: ids.version,
      quantity: 2,
      enrollmentDurationDays: 60,
      expiresOn: "",
      domains: "",
      kind: "bulk_purchase",
      fulfillmentMode: "single_use_codes",
      customerExtendable: true,
      ownerEmails: administrator.email,
    },
    administrator,
  );
  assert.equal(batch.status, "created");
  assert.equal(batch.accessCode, null);
  assert.equal(batch.generatedCodeCount, 2);
  const initialBatchExport = await exportAccessOwnerCodes(
    batch.accessGrantId,
    administrator,
  );
  assert.equal(initialBatchExport.status, "ready");
  const firstBatchCode = initialBatchExport.data.codes.at(0);
  assert.ok(firstBatchCode);
  assert.deepEqual(
    initialBatchExport.data.codes.map((code) => code.status),
    ["available", "available"],
  );
  assert.equal(
    (
      await redeemAccessCode(
        redemption(firstBatchCode.accessCode),
        thirdLearner,
      )
    ).status,
    "enrolled",
  );
  assert.equal(
    (
      await redeemAccessCode(
        redemption(firstBatchCode.accessCode),
        firstLearner,
      )
    ).status,
    "invalid",
  );
  assert.deepEqual(
    await updateAdminAccessGrantCapacity(
      { accessGrantId: batch.accessGrantId, quantity: 1 },
      administrator,
    ),
    { status: "conflict", reason: "batch_capacity_reduction" },
  );
  assert.deepEqual(
    await updateAdminAccessGrantCapacity(
      { accessGrantId: batch.accessGrantId, quantity: 3 },
      administrator,
    ),
    { status: "capacity-updated", accessGrantId: batch.accessGrantId },
  );
  const extendedBatchExport = await exportAccessOwnerCodes(
    batch.accessGrantId,
    administrator,
  );
  assert.equal(extendedBatchExport.status, "ready");
  assert.equal(extendedBatchExport.data.codes.length, 3);
  const [firstExtendedCode, , thirdExtendedCode] =
    extendedBatchExport.data.codes;
  assert.ok(firstExtendedCode);
  assert.ok(thirdExtendedCode);
  assert.equal(firstExtendedCode.status, "redeemed");
  assert.equal(firstExtendedCode.codeNumber, 1);
  assert.equal(thirdExtendedCode.codeNumber, 3);
  assert.deepEqual(
    await revealAccessOwnerCode(batch.accessGrantId, administrator),
    { status: "not-found" },
  );

  const eventGrant = await createAdminAccessGrant(
    {
      label: "Event enterprise access",
      organizationName,
      accessCode: "verify event enterprise",
      targetType: "event",
      targetId: ids.eventOccurrence,
      quantity: 2,
      enrollmentDurationDays: 365,
      expiresOn: "",
      domains: "",
      kind: "enterprise_contract",
      fulfillmentMode: "shared_code",
      customerExtendable: true,
      ownerEmails: administrator.email,
    },
    administrator,
  );
  assert.equal(eventGrant.status, "created");
  assert.ok(eventGrant.accessCode);
  const { previewAccessCode } =
    await import("#/server/access/redeem-access-code.server");
  assert.deepEqual(
    await previewAccessCode(eventGrant.accessCode, eventLearner),
    {
      status: "ready",
      offeringTitle: "Access grant verification event — Sydney",
      offeringType: "event",
      organizationName,
      accessKind: "enterprise_contract",
      noticeVersion: "access-owner-v1",
    },
  );
  assert.deepEqual(
    await redeemAccessCode(redemption(eventGrant.accessCode), eventLearner),
    {
      status: "enrolled",
      offeringTitle: "Access grant verification event — Sydney",
      offeringType: "event",
    },
  );
  const eventRegistration = await database
    .selectFrom("event_registration")
    .select(["id", "status", "source", "eligibilitySource"])
    .where("eventOccurrenceId", "=", ids.eventOccurrence)
    .where("userId", "=", eventLearner.id)
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    {
      status: eventRegistration.status,
      source: eventRegistration.source,
      eligibilitySource: eventRegistration.eligibilitySource,
    },
    {
      status: "selected",
      source: "access_code",
      eligibilitySource: "access_code",
    },
  );
  assert.ok(
    await database
      .selectFrom("event_access_redemption")
      .select("id")
      .where("eventRegistrationId", "=", eventRegistration.id)
      .executeTakeFirst(),
  );
  const eventRedemptionPage = await findAdminAccessGrantRedemptions({
    accessGrantId: eventGrant.accessGrantId,
    page: 1,
  });
  assert.equal(eventRedemptionPage?.total, 1);
  assert.equal(eventRedemptionPage.rows[0]?.learnerEmail, eventLearner.email);
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
    6,
  );
  console.log(
    "Verified encrypted course and event enterprise codes, shared and single-use fulfilment, Access Owner assignments, consent-bounded progress, capacity extension and non-destructive revocation",
  );
} finally {
  await cleanup();
  await database.destroy();
  const { destroyDatabase } = await import("#/server/db/database.server");
  await destroyDatabase();
}
