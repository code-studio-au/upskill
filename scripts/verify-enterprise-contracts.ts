import assert from "node:assert/strict";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { INFORMATION_RELEASE_NOTICE_VERSION } from "#/features/access/access-code.schema";
import type { LocalDateIso } from "#/features/shared/time.schema";
import {
  createAdminEnterpriseContract,
  findAdminEnterpriseContracts,
  revealAdminEnterpriseContractCode,
  replaceAdminEnterpriseContractEligibility,
  renewAdminEnterpriseContract,
  rotateAdminEnterpriseContractCode,
  transitionAdminEnterpriseContract,
} from "#/server/admin/admin-enterprise-contract.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { destroyDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import {
  claimEnterpriseContractAccess,
  enrollWithEnterpriseContract,
  findEnterpriseCourseAccess,
  findEnterpriseEventAccess,
  previewEnterpriseContractCode,
  registerWithEnterpriseContract,
} from "#/server/enterprise/enterprise-contract-access.server";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const database = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});
const ids = {
  administrator: "verify_enterprise_contract_administrator",
  eligibleLearner: "verify_enterprise_contract_eligible",
  secondEligibleLearner: "verify_enterprise_contract_eligible_second",
  wrongDomainLearner: "verify_enterprise_contract_wrong_domain",
  unverifiedLearner: "verify_enterprise_contract_unverified",
  coveredCourse: "verify_enterprise_contract_course",
  coveredVersionOne: "verify_enterprise_contract_version_1",
  coveredVersionTwo: "verify_enterprise_contract_version_2",
  uncoveredCourse: "verify_enterprise_contract_uncovered_course",
  uncoveredVersion: "verify_enterprise_contract_uncovered_version",
  eventTemplate: "verify_enterprise_contract_event_template",
  eventTemplateVersion: "verify_enterprise_contract_event_template_version",
  eventOccurrence: "verify_enterprise_contract_event_occurrence",
};
const coveredSlug = "verify-enterprise-contract-course";
const uncoveredSlug = "verify-enterprise-contract-uncovered";
const users = {
  administrator: {
    id: ids.administrator,
    name: "Enterprise Contract Administrator",
    email: "enterprise-contract-administrator@example.com",
    emailVerified: true,
  },
  eligible: {
    id: ids.eligibleLearner,
    name: "Eligible Enterprise Learner",
    email: "eligible@verified.example.com",
    emailVerified: true,
  },
  secondEligible: {
    id: ids.secondEligibleLearner,
    name: "Second Eligible Enterprise Learner",
    email: "eligible-two@verified.example.com",
    emailVerified: true,
  },
  wrongDomain: {
    id: ids.wrongDomainLearner,
    name: "Wrong Domain Learner",
    email: "learner@outside.example.org",
    emailVerified: true,
  },
  unverified: {
    id: ids.unverifiedLearner,
    name: "Unverified Enterprise Learner",
    email: "unverified@verified.example.com",
    emailVerified: false,
  },
} satisfies Record<string, AuthenticatedUser>;
const userIds = Object.values(users).map((user) => user.id);

function dateOnly(offsetDays: number): LocalDateIso {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10) as LocalDateIso;
}

async function cleanup(): Promise<void> {
  await database.transaction().execute(async (transaction) => {
    await sql`select set_config('upskill.audit_maintenance', 'on', true)`.execute(
      transaction,
    );
    await sql`select set_config('upskill.enterprise_contract_maintenance', 'on', true)`.execute(
      transaction,
    );
    const contracts = await transaction
      .selectFrom("enterprise_contract")
      .select(["id", "organizationId"])
      .where("createdByUserId", "=", ids.administrator)
      .execute();
    const contractIds = contracts.map((contract) => contract.id);
    const organizationIds = contracts.map(
      (contract) => contract.organizationId,
    );
    const enrollments = await transaction
      .selectFrom("enrollment")
      .select("id")
      .where("userId", "in", userIds)
      .execute();
    const enrollmentIds = enrollments.map((enrollment) => enrollment.id);
    if (enrollmentIds.length > 0) {
      await transaction
        .deleteFrom("notification_delivery_attempt")
        .where(
          "notificationId",
          "in",
          transaction
            .selectFrom("notification")
            .select("id")
            .where("recipientUserId", "in", userIds),
        )
        .execute();
      await transaction
        .deleteFrom("notification")
        .where("recipientUserId", "in", userIds)
        .execute();
      await transaction
        .deleteFrom("entitlement")
        .where("enrollmentId", "in", enrollmentIds)
        .execute();
      await transaction
        .deleteFrom("outbox_event")
        .where("aggregateId", "in", enrollmentIds)
        .execute();
    }
    await transaction
      .deleteFrom("audit_event")
      .where((expression) =>
        expression.or([expression("actorUserId", "in", userIds)]),
      )
      .execute();
    await transaction
      .deleteFrom("enrollment")
      .where("userId", "in", userIds)
      .execute();
    if (contractIds.length > 0) {
      await transaction
        .deleteFrom("enterprise_contract_event_registration")
        .where("enterpriseContractId", "in", contractIds)
        .execute();
      await transaction
        .deleteFrom("enterprise_contract_claim")
        .where("enterpriseContractId", "in", contractIds)
        .execute();
      await transaction
        .deleteFrom("enterprise_contract_owner_assignment")
        .where("enterpriseContractId", "in", contractIds)
        .execute();
      await transaction
        .deleteFrom("enterprise_contract_employee_eligibility")
        .where("enterpriseContractId", "in", contractIds)
        .execute();
      await transaction
        .deleteFrom("enterprise_contract_code")
        .where("enterpriseContractId", "in", contractIds)
        .execute();
      await transaction
        .deleteFrom("enterprise_contract_domain")
        .where("enterpriseContractId", "in", contractIds)
        .execute();
      await transaction
        .deleteFrom("enterprise_contract_course_coverage")
        .where("enterpriseContractId", "in", contractIds)
        .execute();
      await transaction
        .deleteFrom("enterprise_contract_event_coverage")
        .where("enterpriseContractId", "in", contractIds)
        .execute();
      await transaction
        .deleteFrom("enterprise_contract")
        .where("id", "in", contractIds)
        .execute();
    }
    const registrations = await transaction
      .selectFrom("event_registration")
      .select("id")
      .where("eventOccurrenceId", "=", ids.eventOccurrence)
      .execute();
    const registrationIds = registrations.map((row) => row.id);
    if (registrationIds.length > 0) {
      await transaction
        .deleteFrom("event_participation")
        .where("registrationId", "in", registrationIds)
        .execute();
      await transaction
        .deleteFrom("event_registration_transition")
        .where("eventRegistrationId", "in", registrationIds)
        .execute();
      await transaction
        .deleteFrom("event_registration")
        .where("id", "in", registrationIds)
        .execute();
    }
    await transaction
      .deleteFrom("event_occurrence")
      .where("id", "=", ids.eventOccurrence)
      .execute();
    await transaction
      .deleteFrom("event_template_version")
      .where("id", "=", ids.eventTemplateVersion)
      .execute();
    await transaction
      .deleteFrom("event_template")
      .where("id", "=", ids.eventTemplate)
      .execute();
    if (organizationIds.length > 0)
      await transaction
        .deleteFrom("organization")
        .where("id", "in", organizationIds)
        .execute();
    await transaction
      .deleteFrom("course_version")
      .where("id", "in", [
        ids.coveredVersionOne,
        ids.coveredVersionTwo,
        ids.uncoveredVersion,
      ])
      .execute();
    await transaction
      .deleteFrom("course")
      .where("id", "in", [ids.coveredCourse, ids.uncoveredCourse])
      .execute();
    await transaction
      .deleteFrom("platform_admin")
      .where("userId", "=", ids.administrator)
      .execute();
    await transaction.deleteFrom("user").where("id", "in", userIds).execute();
  });
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
    .insertInto("platform_admin")
    .values({ userId: ids.administrator, grantedByUserId: null })
    .execute();
  await database
    .insertInto("course")
    .values([
      {
        id: ids.coveredCourse,
        slug: coveredSlug,
        title: "Enterprise contract covered course",
        status: "published",
      },
      {
        id: ids.uncoveredCourse,
        slug: uncoveredSlug,
        title: "Enterprise contract uncovered course",
        status: "published",
      },
    ])
    .execute();
  const publishedAt = new Date();
  await database
    .insertInto("course_version")
    .values([
      {
        id: ids.coveredVersionOne,
        courseId: ids.coveredCourse,
        version: 1,
        content: {},
        publishedAt,
      },
      {
        id: ids.coveredVersionTwo,
        courseId: ids.coveredCourse,
        version: 2,
        content: {},
        publishedAt,
      },
      {
        id: ids.uncoveredVersion,
        courseId: ids.uncoveredCourse,
        version: 1,
        content: {},
        publishedAt,
      },
    ])
    .execute();
  const eventCreatedAt = new Date();
  const eventStartsAt = new Date(eventCreatedAt.getTime() + 20 * 86_400_000);
  const eventEndsAt = new Date(eventStartsAt.getTime() + 3_600_000);
  await database
    .insertInto("event_template")
    .values({
      id: ids.eventTemplate,
      title: "Enterprise covered event",
      status: "published",
      createdAt: eventCreatedAt,
      updatedAt: eventCreatedAt,
    })
    .execute();
  await database
    .insertInto("event_template_version")
    .values({
      id: ids.eventTemplateVersion,
      eventTemplateId: ids.eventTemplate,
      version: 1,
      topic: "clinical-practice",
      summary: "Enterprise event verification",
      description: "Verifies contract-funded event registration.",
      coverImage: null,
      hasCompletionCertificate: false,
      accreditations: JSON.stringify([]),
      publishedAt: eventCreatedAt,
      createdAt: eventCreatedAt,
    })
    .execute();
  await database
    .insertInto("event_occurrence")
    .values({
      id: ids.eventOccurrence,
      eventTemplateVersionId: ids.eventTemplateVersion,
      title: "Enterprise covered event",
      slug: "verify-enterprise-covered-event",
      status: "published",
      deliveryMode: "virtual",
      registrationMode: "paid_entry",
      approvalMode: "automatic",
      timezone: "Australia/Sydney",
      localStartsAt: "2027-11-15T09:00:00",
      localEndsAt: "2027-11-15T10:00:00",
      localRegistrationOpensAt: null,
      localRegistrationClosesAt: null,
      localCoordinatorLockAt: null,
      startsAt: eventStartsAt,
      endsAt: eventEndsAt,
      registrationOpensAt: null,
      registrationClosesAt: null,
      coordinatorLockAt: null,
      capacity: 2,
      priceCents: 10_000,
      salePriceCents: null,
      currency: "AUD",
      bulkPricing: JSON.stringify({ enabled: false, tiers: [] }),
      listInStore: true,
      featured: false,
      venueName: null,
      venueAddress: null,
      virtualJoinUrl: "https://meet.example.test/enterprise-contract",
      publishedAt: eventCreatedAt,
      createdByUserId: ids.administrator,
      createdAt: eventCreatedAt,
      updatedAt: eventCreatedAt,
    })
    .execute();

  const created = await createAdminEnterpriseContract(
    {
      name: "Verified Workforce Learning Agreement",
      reference: "VERIFY-ENTERPRISE-2026",
      organizationName: "Enterprise Contract Verification Organisation",
      startsOn: dateOnly(-1),
      expiresOn: dateOnly(30),
      enrollmentDurationDays: 90,
      autoEnrollCourses: false,
      accessCode: "VERIFY ENTERPRISE",
      domains: "verified.example.com",
      courseIds: [ids.coveredCourse],
      eventOccurrenceIds: [ids.eventOccurrence],
      ownerEmails: "",
    },
    users.administrator,
  );
  assert.equal(created.status, "created");
  const contractId = created.enterpriseContractId;
  const accessCode = created.accessCode;
  assert.ok(accessCode);

  const directory = await findAdminEnterpriseContracts();
  const directoryContract = directory.contracts.find(
    (contract) => contract.id === contractId,
  );
  assert.ok(directoryContract);
  assert.equal(directoryContract.status, "draft");
  assert.deepEqual(directoryContract.domains, ["verified.example.com"]);
  assert.deepEqual(
    directoryContract.coverage.map((coverage) => coverage.courseId),
    [ids.coveredCourse],
  );
  assert.deepEqual(
    directoryContract.eventCoverage.map(
      (coverage) => coverage.eventOccurrenceId,
    ),
    [ids.eventOccurrence],
  );
  assert.equal(
    directory.courses.find((course) => course.id === ids.coveredCourse)
      ?.version,
    2,
  );
  const revealed = await revealAdminEnterpriseContractCode(
    contractId,
    users.administrator,
  );
  assert.deepEqual(revealed, {
    status: "ready",
    enterpriseContractId: contractId,
    accessCode,
  });
  assert.equal(
    await previewEnterpriseContractCode(database, accessCode, users.eligible),
    null,
    "Draft contracts must not grant eligibility",
  );

  const activated = await transitionAdminEnterpriseContract(
    { enterpriseContractId: contractId, action: "activate" },
    users.administrator,
  );
  assert.equal(activated.status, "activated");
  await assert.rejects(
    database
      .updateTable("enterprise_contract")
      .set({ name: "Mutated active terms" })
      .where("id", "=", contractId)
      .execute(),
    /active enterprise contract terms are immutable/u,
  );
  await assert.rejects(
    database
      .insertInto("enterprise_contract_course_coverage")
      .values({
        id: "verify_enterprise_contract_illegal_coverage",
        enterpriseContractId: contractId,
        courseId: ids.uncoveredCourse,
        courseTitleSnapshot: "Illegally added coverage",
        createdAt: new Date(),
      })
      .execute(),
    /non-draft enterprise contract terms are immutable/u,
  );
  assert.equal(
    await previewEnterpriseContractCode(
      database,
      accessCode,
      users.wrongDomain,
    ),
    null,
  );
  const imported = await replaceAdminEnterpriseContractEligibility(
    {
      enterpriseContractId: contractId,
      csvText: 'email,name\nlearner@outside.example.org,"Outside, Eligible"',
    },
    users.administrator,
  );
  assert.equal(imported.status, "eligibility_replaced");
  assert.equal(
    (
      await previewEnterpriseContractCode(
        database,
        accessCode,
        users.wrongDomain,
      )
    )?.status,
    "ready",
    "An exact uploaded employee email must supplement domain eligibility",
  );
  assert.equal(
    await previewEnterpriseContractCode(database, accessCode, users.unverified),
    null,
  );
  const preview = await previewEnterpriseContractCode(
    database,
    accessCode,
    users.eligible,
  );
  assert.ok(preview);
  assert.equal(preview.status, "ready");
  assert.equal(preview.offeringType, "catalogue");

  const claimed = await database.transaction().execute(
    async (transaction) =>
      await claimEnterpriseContractAccess(
        transaction,
        {
          code: accessCode,
          noticeVersion: INFORMATION_RELEASE_NOTICE_VERSION,
        },
        users.eligible,
      ),
  );
  assert.equal(claimed?.status, "activated");
  assert.equal(
    await database
      .selectFrom("enrollment")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("userId", "=", users.eligible.id)
      .executeTakeFirstOrThrow()
      .then((row) => row.count),
    0,
    "A catalogue claim must not eagerly create course enrolments",
  );
  const duplicateClaim = await database.transaction().execute(
    async (transaction) =>
      await claimEnterpriseContractAccess(
        transaction,
        {
          code: accessCode,
          noticeVersion: INFORMATION_RELEASE_NOTICE_VERSION,
        },
        users.eligible,
      ),
  );
  assert.equal(duplicateClaim?.status, "already-activated");
  assert.equal(
    (await findEnterpriseCourseAccess(uncoveredSlug, users.eligible)).status,
    "unavailable",
  );
  assert.equal(
    (await findEnterpriseCourseAccess(coveredSlug, users.eligible)).status,
    "ready",
  );
  const rotated = await rotateAdminEnterpriseContractCode(
    { enterpriseContractId: contractId, accessCode: "ROTATED ENTERPRISE" },
    users.administrator,
  );
  assert.equal(rotated.status, "code_rotated");
  assert.equal(
    await previewEnterpriseContractCode(
      database,
      accessCode,
      users.secondEligible,
    ),
    null,
    "Rotation must revoke the previous code",
  );
  assert.equal(
    (
      await previewEnterpriseContractCode(
        database,
        rotated.accessCode,
        users.secondEligible,
      )
    )?.status,
    "ready",
  );

  const concurrentEnrollments = await Promise.all([
    enrollWithEnterpriseContract(coveredSlug, users.eligible),
    enrollWithEnterpriseContract(coveredSlug, users.eligible),
  ]);
  assert.deepEqual(
    concurrentEnrollments.map((result) => result.status).sort(),
    ["already-enrolled", "enrolled"],
    "Concurrent materialisation must remain idempotent",
  );
  const enrollment = concurrentEnrollments.find(
    (result) => result.status === "enrolled",
  );
  assert.ok(enrollment);
  const entitlement = await database
    .selectFrom("entitlement")
    .select([
      "courseVersionId",
      "originType",
      "originEnterpriseContractId",
      "originEnterpriseContractClaimId",
      "originEnterpriseContractCoverageId",
    ])
    .where("enrollmentId", "=", enrollment.enrollmentId)
    .executeTakeFirstOrThrow();
  assert.equal(entitlement.courseVersionId, ids.coveredVersionTwo);
  assert.equal(entitlement.originType, "enterprise_contract");
  assert.equal(entitlement.originEnterpriseContractId, contractId);
  assert.ok(entitlement.originEnterpriseContractClaimId);
  assert.ok(entitlement.originEnterpriseContractCoverageId);
  assert.equal(
    (await enrollWithEnterpriseContract(coveredSlug, users.eligible)).status,
    "already-enrolled",
  );

  const suspended = await transitionAdminEnterpriseContract(
    { enterpriseContractId: contractId, action: "suspend" },
    users.administrator,
  );
  assert.equal(suspended.status, "suspended");
  assert.equal(
    await previewEnterpriseContractCode(
      database,
      rotated.accessCode,
      users.secondEligible,
    ),
    null,
    "Suspension must prevent new eligibility claims",
  );
  assert.equal(
    (await findEnterpriseCourseAccess(coveredSlug, users.eligible)).status,
    "already-enrolled",
    "Suspension must preserve previously issued learning",
  );
  assert.equal(
    (
      await transitionAdminEnterpriseContract(
        { enterpriseContractId: contractId, action: "resume" },
        users.administrator,
      )
    ).status,
    "resumed",
  );
  assert.equal(
    (
      await previewEnterpriseContractCode(
        database,
        rotated.accessCode,
        users.secondEligible,
      )
    )?.status,
    "ready",
  );
  const secondClaim = await database.transaction().execute(
    async (transaction) =>
      await claimEnterpriseContractAccess(
        transaction,
        {
          code: rotated.accessCode,
          noticeVersion: INFORMATION_RELEASE_NOTICE_VERSION,
        },
        users.secondEligible,
      ),
  );
  assert.equal(secondClaim?.status, "activated");
  assert.equal(
    (
      await findEnterpriseEventAccess(
        "verify-enterprise-covered-event",
        users.secondEligible,
      )
    ).status,
    "ready",
  );
  assert.equal(
    (
      await registerWithEnterpriseContract(
        "verify-enterprise-covered-event",
        users.secondEligible,
      )
    ).status,
    "registered",
  );
  assert.equal(
    (
      await findEnterpriseEventAccess(
        "verify-enterprise-covered-event",
        users.secondEligible,
      )
    ).status,
    "already-registered",
  );
  assert.equal(
    (
      await transitionAdminEnterpriseContract(
        { enterpriseContractId: contractId, action: "terminate" },
        users.administrator,
      )
    ).status,
    "terminated",
  );
  assert.equal(
    await previewEnterpriseContractCode(
      database,
      rotated.accessCode,
      users.secondEligible,
    ),
    null,
  );
  const renewal = await renewAdminEnterpriseContract(
    {
      enterpriseContractId: contractId,
      name: "Verified Workforce Learning Agreement renewal",
      reference: "VERIFY-ENTERPRISE-2027",
      startsOn: dateOnly(31),
      expiresOn: dateOnly(61),
      accessCode: "VERIFY ENTERPRISE RENEWAL",
    },
    users.administrator,
  );
  assert.equal(renewal.status, "renewed");
  const renewedDirectory = await findAdminEnterpriseContracts();
  assert.equal(
    renewedDirectory.contracts.find((contract) => contract.id === contractId)
      ?.renewalContractId,
    renewal.enterpriseContractId,
  );
  assert.deepEqual(
    renewedDirectory.contracts
      .find((contract) => contract.id === renewal.enterpriseContractId)
      ?.eventCoverage.map((coverage) => coverage.eventOccurrenceId),
    [ids.eventOccurrence],
  );
  const automaticContract = await createAdminEnterpriseContract(
    {
      name: "Automatic workforce enrolment",
      reference: "VERIFY-ENTERPRISE-AUTOMATIC-2026",
      organizationName: "Enterprise Contract Verification Organisation",
      startsOn: dateOnly(-1),
      expiresOn: dateOnly(30),
      enrollmentDurationDays: 90,
      autoEnrollCourses: true,
      accessCode: "VERIFY AUTO ENTERPRISE",
      domains: "outside.example.org",
      courseIds: [ids.uncoveredCourse],
      eventOccurrenceIds: [],
      ownerEmails: "",
    },
    users.administrator,
  );
  assert.equal(automaticContract.status, "created");
  assert.equal(
    (
      await transitionAdminEnterpriseContract(
        {
          enterpriseContractId: automaticContract.enterpriseContractId,
          action: "activate",
        },
        users.administrator,
      )
    ).status,
    "activated",
  );
  assert.equal(
    (
      await database.transaction().execute(
        async (transaction) =>
          await claimEnterpriseContractAccess(
            transaction,
            {
              code: automaticContract.accessCode,
              noticeVersion: INFORMATION_RELEASE_NOTICE_VERSION,
            },
            users.wrongDomain,
          ),
      )
    )?.status,
    "activated",
  );
  assert.equal(
    (await findEnterpriseCourseAccess(uncoveredSlug, users.wrongDomain)).status,
    "already-enrolled",
    "Automatic fulfilment must occur only after the learner accepts the claim notice",
  );
  const auditActions = await database
    .selectFrom("audit_event")
    .select("action")
    .where("actorUserId", "in", [
      users.administrator.id,
      users.eligible.id,
      users.secondEligible.id,
    ])
    .execute();
  const actions = new Set(auditActions.map((event) => event.action));
  for (const action of [
    "enterprise_contract.claimed",
    "enterprise_contract.entitlement_issued",
    "enterprise_contract.activated",
    "enterprise_contract.suspended",
    "enterprise_contract.resumed",
    "enterprise_contract.code_rotated",
    "enterprise_contract.eligibility_replaced",
    "enterprise_contract.event_registered",
    "enterprise_contract.renewed",
    "enterprise_contract.terminated",
  ] as const)
    assert.ok(actions.has(action), `Expected durable audit action ${action}`);

  console.log(
    "Verified blanket contract authoring, domain eligibility, lazy exact-version enrolment, lifecycle preservation and audit lineage",
  );
} finally {
  await cleanup();
  await Promise.all([database.destroy(), destroyDatabase()]);
}
