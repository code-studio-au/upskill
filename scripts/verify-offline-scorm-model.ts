import assert from "node:assert/strict";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { Database } from "#/server/db/types";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const ids = {
  user: "verify_offline_scorm_user",
  anotherUser: "verify_offline_scorm_other_user",
  course: "verify_offline_scorm_course",
  courseVersion: "verify_offline_scorm_course_version",
  section: "verify_offline_scorm_section",
  item: "verify_offline_scorm_item",
  enrollment: "verify_offline_scorm_enrollment",
  activity: "verify_offline_scorm_activity",
  packageVersion: "verify_offline_scorm_package_version",
  attempt: "verify_offline_scorm_attempt",
  token: "verify_offline_scorm_token",
  session: "verify_offline_scorm_session",
  installation: "verify_offline_scorm_installation",
  otherInstallation: "verify_offline_scorm_other_installation",
  duplicateInstallation: "verify_offline_scorm_duplicate_installation",
  entitlement: "verify_offline_scorm_entitlement",
  duplicateEntitlement: "verify_offline_scorm_duplicate_entitlement",
  receipt: "verify_offline_scorm_receipt",
  duplicateReceipt: "verify_offline_scorm_duplicate_receipt",
  duplicateSequenceReceipt: "verify_offline_scorm_duplicate_sequence_receipt",
  cleanup: "verify_offline_scorm_cleanup",
  invalidCleanup: "verify_offline_scorm_invalid_cleanup",
} as const;

const issuedAt = new Date("2030-01-01T00:00:00.000Z");
const intendedLaunchExpiresAt = new Date("2030-02-01T00:00:00.000Z");
const commitAcceptanceDeadline = new Date("2030-03-01T00:00:00.000Z");
const packageSha256 = "a".repeat(64);
const publicKeySha256 = "b".repeat(64);

const database = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});

async function assertDatabaseConstraint(
  operation: () => Promise<unknown>,
  code: string,
  constraint: string,
): Promise<void> {
  const failure = await operation().catch((error: unknown) => error);
  assert.ok(failure instanceof Error);
  const databaseFailure = failure as Error & {
    code?: string;
    constraint?: string;
  };
  assert.equal(databaseFailure.code, code);
  assert.equal(databaseFailure.constraint, constraint);
}

async function cleanup(): Promise<void> {
  await database
    .deleteFrom("offline_scorm_cleanup_inventory")
    .where("userId", "in", [ids.user, ids.anotherUser])
    .execute();
  await database
    .deleteFrom("offline_scorm_reconciliation_receipt")
    .where("attemptId", "=", ids.attempt)
    .execute();
  const attempt = await database
    .selectFrom("scorm_attempt")
    .select(["writerMode", "credentialGeneration", "offlineEntitlementId"])
    .where("id", "=", ids.attempt)
    .executeTakeFirst();
  if (attempt?.writerMode === "offline")
    await database.transaction().execute(async (transaction) => {
      await transaction
        .updateTable("scorm_attempt")
        .set({
          writerMode: "online",
          offlineEntitlementId: null,
          credentialGeneration: attempt.credentialGeneration + 1,
        })
        .where("id", "=", ids.attempt)
        .execute();
      if (attempt.offlineEntitlementId)
        await transaction
          .updateTable("offline_learning_entitlement")
          .set({
            status: "resolved",
            resolution: "discarded",
            endedAt: new Date("2030-03-02T00:00:00.000Z"),
          })
          .where("id", "=", attempt.offlineEntitlementId)
          .where("status", "=", "active")
          .execute();
    });
  await database
    .deleteFrom("offline_learning_entitlement")
    .where("attemptId", "=", ids.attempt)
    .execute();
  await database
    .deleteFrom("offline_learning_installation")
    .where("userId", "in", [ids.user, ids.anotherUser])
    .execute();
  await database
    .deleteFrom("scorm_attempt_session")
    .where("attemptId", "=", ids.attempt)
    .execute();
  await database
    .deleteFrom("scorm_launch_token")
    .where("attemptId", "=", ids.attempt)
    .execute();
  await database
    .deleteFrom("scorm_attempt")
    .where("id", "=", ids.attempt)
    .execute();
  await database
    .deleteFrom("course_version_item")
    .where("id", "=", ids.item)
    .execute();
  await database
    .deleteFrom("course_version_section")
    .where("id", "=", ids.section)
    .execute();
  await database
    .deleteFrom("enrollment")
    .where("id", "=", ids.enrollment)
    .execute();
  await database
    .deleteFrom("scorm_package_version")
    .where("id", "=", ids.packageVersion)
    .execute();
  await database
    .deleteFrom("learning_activity_version")
    .where("id", "=", ids.packageVersion)
    .execute();
  await database
    .deleteFrom("learning_activity")
    .where("id", "=", ids.activity)
    .execute();
  await database
    .deleteFrom("course_version")
    .where("id", "=", ids.courseVersion)
    .execute();
  await database.deleteFrom("course").where("id", "=", ids.course).execute();
  await database
    .deleteFrom("user")
    .where("id", "in", [ids.user, ids.anotherUser])
    .execute();
}

type EntitlementOverrides = Partial<{
  userId: string;
  installationId: string;
  packageSha256: string;
  commitAcceptanceDeadline: Date | string;
  signedEnvelope: string | null;
}>;

function createSignedEnvelope(id: string, overrides: EntitlementOverrides) {
  return {
    schemaVersion: 1,
    algorithm: "ecdsa-p256-sha256",
    signingKeyId: "verify-offline-scorm-key",
    entitlement: {
      schemaVersion: 1,
      entitlementId: id,
      attemptId: ids.attempt,
      installationId: overrides.installationId ?? ids.installation,
      learnerId: overrides.userId ?? ids.user,
      devicePublicKeySha256: publicKeySha256,
      historyBaseRevision: 0,
      runtimeVersion: "offline-scorm-1",
      offering: {
        kind: "course",
        enrollmentId: ids.enrollment,
        courseVersionItemId: ids.item,
      },
      packageVersionId: ids.packageVersion,
      packageSha256: overrides.packageSha256 ?? packageSha256,
      initialSnapshot: {
        lessonStatus: "not_attempted",
        location: "",
        suspendData: "",
        scoreRaw: null,
        scoreMin: null,
        scoreMax: null,
        totalTimeSeconds: 0,
      },
      issuedAt: issuedAt.toISOString(),
      intendedLaunchExpiresAt: intendedLaunchExpiresAt.toISOString(),
      commitAcceptanceDeadline: commitAcceptanceDeadline.toISOString(),
    },
    signature: "A".repeat(86),
  };
}

async function insertEntitlement(
  id: string,
  overrides: EntitlementOverrides = {},
  executor: Kysely<Database> = database,
): Promise<void> {
  await executor
    .insertInto("offline_learning_entitlement")
    .values({
      id,
      userId: overrides.userId ?? ids.user,
      attemptId: ids.attempt,
      installationId: overrides.installationId ?? ids.installation,
      scormPackageVersionId: ids.packageVersion,
      packageSha256: overrides.packageSha256 ?? packageSha256,
      runtimeVersion: "offline-scorm-1",
      historyBaseRevision: 0,
      writerGeneration: 1,
      reconciliationCursorRevision: 0,
      signedEnvelope:
        overrides.signedEnvelope === undefined
          ? JSON.stringify(createSignedEnvelope(id, overrides))
          : overrides.signedEnvelope,
      resolution: null,
      resolvedByUserId: null,
      issuedAt,
      intendedLaunchExpiresAt,
      commitAcceptanceDeadline:
        overrides.commitAcceptanceDeadline ?? commitAcceptanceDeadline,
      endedAt: null,
    })
    .executeTakeFirstOrThrow();
}

try {
  await cleanup();
  await database
    .insertInto("user")
    .values([
      {
        id: ids.user,
        name: "Offline SCORM verifier",
        email: "offline-scorm-verifier@example.com",
        emailVerified: true,
        image: null,
        stripeCustomerId: null,
      },
      {
        id: ids.anotherUser,
        name: "Other offline SCORM verifier",
        email: "offline-scorm-other@example.com",
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
      slug: "verify-offline-scorm-course",
      title: "Offline SCORM verification",
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
        title: "Offline SCORM verification",
        summary: "Verifies dormant offline SCORM invariants.",
        description: "Database-only verification fixture.",
        topic: "technology",
        durationMinutes: 20,
        priceCents: 0,
        salePriceCents: null,
        currency: "AUD",
        featured: false,
        listInStore: false,
        hasCompletionCertificate: false,
        prerequisites: [],
        accreditations: [],
        modules: [
          { title: "Offline SCO", phase: "content", durationMinutes: 20 },
        ],
      },
      publishedAt: issuedAt,
    })
    .execute();
  await database
    .insertInto("learning_activity")
    .values({
      id: ids.activity,
      kind: "scorm",
      title: "Offline SCORM verification package",
    })
    .execute();
  await database
    .insertInto("learning_activity_version")
    .values({
      id: ids.packageVersion,
      activityId: ids.activity,
      kind: "scorm",
      version: 1,
      publishedAt: issuedAt,
    })
    .execute();
  await database
    .insertInto("scorm_package_version")
    .values({
      id: ids.packageVersion,
      status: "ready",
      standard: "scorm-1.2",
      contentPrefix: "verified/offline/package/v1",
      launchPath: "index.html",
      sha256: packageSha256,
      manifest: { identifier: "verified-offline-sco" },
    })
    .execute();
  await database
    .insertInto("course_version_section")
    .values({
      courseVersionId: ids.courseVersion,
      id: ids.section,
      position: 0,
      title: "Offline SCORM verification",
      description: "Dormant model verification",
    })
    .execute();
  await database
    .insertInto("course_version_item")
    .values({
      id: ids.item,
      courseVersionId: ids.courseVersion,
      sectionId: ids.section,
      position: 0,
      kind: "scorm",
      title: "Offline SCO",
      required: true,
      durationMinutes: 20,
      modulePosition: 0,
      learningActivityVersionId: ids.packageVersion,
    })
    .execute();
  await database
    .insertInto("enrollment")
    .values({
      id: ids.enrollment,
      userId: ids.user,
      courseVersionId: ids.courseVersion,
      accessGrantId: null,
      status: "active",
      enrolledAt: issuedAt,
      completedAt: null,
      expiresAt: intendedLaunchExpiresAt,
      removedAt: null,
    })
    .execute();
  await database
    .insertInto("scorm_attempt")
    .values({
      id: ids.attempt,
      enrollmentId: ids.enrollment,
      modulePosition: 0,
      eventParticipationId: null,
      eventTemplateVersionItemId: null,
      scormPackageVersionId: ids.packageVersion,
      attemptNumber: 1,
      status: "in_progress",
      lessonStatus: "incomplete",
      location: "",
      suspendData: "",
      scoreRaw: null,
      scoreMin: null,
      scoreMax: null,
      totalTimeSeconds: 0,
      startedAt: issuedAt,
      lastActivityAt: issuedAt,
      completedAt: null,
      createdAt: issuedAt,
      updatedAt: issuedAt,
    })
    .execute();
  await database
    .insertInto("scorm_launch_token")
    .values({
      digest: ids.token,
      attemptId: ids.attempt,
      expiresAt: intendedLaunchExpiresAt,
      consumedAt: null,
      createdAt: issuedAt,
    })
    .execute();
  await database
    .insertInto("scorm_attempt_session")
    .values({
      digest: ids.session,
      attemptId: ids.attempt,
      expiresAt: intendedLaunchExpiresAt,
      revokedAt: null,
      createdAt: issuedAt,
    })
    .execute();

  const dormantAttempt = await database
    .selectFrom("scorm_attempt")
    .select([
      "progressRevision",
      "writerMode",
      "credentialGeneration",
      "offlineEntitlementId",
    ])
    .where("id", "=", ids.attempt)
    .executeTakeFirstOrThrow();
  assert.deepEqual(dormantAttempt, {
    progressRevision: 0,
    writerMode: "online",
    credentialGeneration: 0,
    offlineEntitlementId: null,
  });
  assert.equal(
    (
      await database
        .selectFrom("scorm_launch_token")
        .select("credentialGeneration")
        .where("digest", "=", ids.token)
        .executeTakeFirstOrThrow()
    ).credentialGeneration,
    0,
  );
  assert.equal(
    (
      await database
        .selectFrom("scorm_attempt_session")
        .select("credentialGeneration")
        .where("digest", "=", ids.session)
        .executeTakeFirstOrThrow()
    ).credentialGeneration,
    0,
  );

  await database
    .insertInto("offline_learning_installation")
    .values({
      id: ids.installation,
      userId: ids.user,
      publicKeySpki: Buffer.alloc(91, 1),
      publicKeySha256,
      replacementInstallationId: null,
      registeredAt: issuedAt,
      endedAt: null,
      updatedAt: issuedAt,
    })
    .execute();
  await database
    .insertInto("offline_learning_installation")
    .values({
      id: ids.otherInstallation,
      userId: ids.anotherUser,
      publicKeySpki: Buffer.alloc(91, 2),
      publicKeySha256: "c".repeat(64),
      replacementInstallationId: null,
      registeredAt: issuedAt,
      endedAt: null,
      updatedAt: issuedAt,
    })
    .execute();
  await assertDatabaseConstraint(
    () =>
      database
        .insertInto("offline_learning_installation")
        .values({
          id: ids.duplicateInstallation,
          userId: ids.user,
          publicKeySpki: Buffer.alloc(91, 3),
          publicKeySha256: "d".repeat(64),
          replacementInstallationId: null,
          registeredAt: issuedAt,
          endedAt: null,
          updatedAt: issuedAt,
        })
        .execute(),
    "23505",
    "offline_learning_installation_active_user_uq",
  );
  await assert.rejects(
    database
      .updateTable("offline_learning_installation")
      .set({ publicKeySha256: "e".repeat(64) })
      .where("id", "=", ids.installation)
      .execute(),
    {
      code: "23514",
      message: /Offline installation key identity is immutable/u,
    },
  );
  await assert.rejects(
    database
      .updateTable("offline_learning_installation")
      .set({
        status: "replaced",
        replacementInstallationId: ids.otherInstallation,
        endedAt: new Date("2030-01-02T00:00:00.000Z"),
        updatedAt: new Date("2030-01-02T00:00:00.000Z"),
      })
      .where("id", "=", ids.installation)
      .execute(),
    {
      code: "23514",
      message:
        /replacement requires an active installation for the same learner/u,
    },
  );
  await assert.rejects(
    database
      .updateTable("offline_learning_installation")
      .set({
        status: "replaced",
        replacementInstallationId: ids.installation,
        endedAt: new Date("2030-01-02T00:00:00.000Z"),
        updatedAt: new Date("2030-01-02T00:00:00.000Z"),
      })
      .where("id", "=", ids.installation)
      .execute(),
    {
      code: "23514",
      message:
        /replacement requires an active installation for the same learner/u,
    },
  );
  await assert.rejects(
    database
      .updateTable("offline_learning_installation")
      .set({
        status: "replaced",
        endedAt: new Date("2030-01-02T00:00:00.000Z"),
        updatedAt: new Date("2030-01-02T00:00:00.000Z"),
      })
      .where("id", "=", ids.installation)
      .execute(),
    {
      code: "23514",
      message: /installation requires an active successor/u,
    },
  );

  await assert.rejects(
    insertEntitlement(ids.duplicateEntitlement, {
      userId: ids.anotherUser,
      installationId: ids.otherInstallation,
    }),
    {
      code: "23514",
      message: /learner does not own the attempt/u,
    },
  );
  await assert.rejects(
    insertEntitlement(ids.duplicateEntitlement, {
      packageSha256: "f".repeat(64),
    }),
    {
      code: "23514",
      message: /package digest does not match/u,
    },
  );
  const completeEnvelope = createSignedEnvelope(ids.duplicateEntitlement, {});
  const missingSignature = structuredClone(completeEnvelope);
  Reflect.deleteProperty(missingSignature, "signature");
  const missingSnapshot = structuredClone(completeEnvelope);
  Reflect.deleteProperty(missingSnapshot.entitlement, "initialSnapshot");
  const incompleteOffering = structuredClone(completeEnvelope);
  Reflect.deleteProperty(
    incompleteOffering.entitlement.offering,
    "courseVersionItemId",
  );
  const invalidSnapshot = structuredClone(completeEnvelope);
  Object.assign(invalidSnapshot.entitlement.initialSnapshot, {
    lessonStatus: "not attempted",
  });
  const invalidEntitlementId = structuredClone(completeEnvelope);
  invalidEntitlementId.entitlement.entitlementId = "invalid entitlement id";
  const normalizedIssuedAt = structuredClone(completeEnvelope);
  normalizedIssuedAt.entitlement.issuedAt = "2029-12-31T24:00:00.000Z";
  const normalizedLaunchExpiry = structuredClone(completeEnvelope);
  normalizedLaunchExpiry.entitlement.intendedLaunchExpiresAt =
    "2030-01-31T24:00:00.000Z";
  const normalizedAcceptanceDeadline = structuredClone(completeEnvelope);
  normalizedAcceptanceDeadline.entitlement.commitAcceptanceDeadline =
    "2030-02-28T24:00:00.000Z";
  const normalizedLeapSecond = structuredClone(completeEnvelope);
  normalizedLeapSecond.entitlement.issuedAt = "2029-12-31T23:59:60.000Z";
  for (const mismatchedDeviceDigest of ["f".repeat(64), "c".repeat(64)]) {
    const mismatchedDeviceEnvelope = structuredClone(completeEnvelope);
    mismatchedDeviceEnvelope.entitlement.devicePublicKeySha256 =
      mismatchedDeviceDigest;
    await assert.rejects(
      insertEntitlement(ids.duplicateEntitlement, {
        signedEnvelope: JSON.stringify(mismatchedDeviceEnvelope),
      }),
      {
        code: "23514",
        message: /device key digest does not match installation/u,
      },
    );
  }
  for (const malformedEnvelope of [
    {},
    missingSignature,
    missingSnapshot,
    incompleteOffering,
    invalidSnapshot,
    invalidEntitlementId,
    normalizedIssuedAt,
    normalizedLaunchExpiry,
    normalizedAcceptanceDeadline,
    normalizedLeapSecond,
    { ...completeEnvelope, unexpected: true },
  ])
    await assertDatabaseConstraint(
      () =>
        insertEntitlement(ids.duplicateEntitlement, {
          signedEnvelope: JSON.stringify(malformedEnvelope),
        }),
      "23514",
      "offline_learning_entitlement_signed_envelope_ck",
    );
  await assert.rejects(
    insertEntitlement(ids.duplicateEntitlement, { signedEnvelope: null }),
    {
      code: "23514",
      message: /require signed evidence/u,
    },
  );
  await assertDatabaseConstraint(
    () =>
      insertEntitlement(ids.duplicateEntitlement, {
        commitAcceptanceDeadline: new Date("2030-03-04T00:00:00.000Z"),
      }),
    "23514",
    "offline_learning_entitlement_deadline_ck",
  );
  await assertDatabaseConstraint(
    () =>
      insertEntitlement(ids.duplicateEntitlement, {
        commitAcceptanceDeadline: "infinity",
      }),
    "23514",
    "offline_learning_entitlement_deadline_ck",
  );

  await assert.rejects(insertEntitlement(ids.entitlement), {
    code: "23514",
    message: /Active offline entitlement must own the attempt writer/u,
  });
  await assert.rejects(
    database.transaction().execute(async (transaction) => {
      await insertEntitlement(ids.entitlement, {}, transaction);
      await transaction
        .updateTable("scorm_attempt")
        .set({
          writerMode: "offline",
          offlineEntitlementId: ids.entitlement,
          credentialGeneration: 2,
        })
        .where("id", "=", ids.attempt)
        .execute();
    }),
    {
      code: "23514",
      message: /writer transitions must rotate credentials/u,
    },
  );
  await database.transaction().execute(async (transaction) => {
    await insertEntitlement(ids.entitlement, {}, transaction);
    await transaction
      .updateTable("scorm_attempt")
      .set({
        writerMode: "offline",
        offlineEntitlementId: ids.entitlement,
        credentialGeneration: 1,
      })
      .where("id", "=", ids.attempt)
      .executeTakeFirstOrThrow();
  });
  await assert.rejects(
    database
      .updateTable("offline_learning_entitlement")
      .set({ signedEnvelope: null })
      .where("id", "=", ids.entitlement)
      .execute(),
    {
      code: "23514",
      message: /signed entitlement evidence is immutable/u,
    },
  );
  await assertDatabaseConstraint(
    () => insertEntitlement(ids.duplicateEntitlement),
    "23505",
    "offline_learning_entitlement_active_attempt_uq",
  );

  await assert.rejects(
    database
      .updateTable("scorm_attempt")
      .set({ progressRevision: 1 })
      .where("id", "=", ids.attempt)
      .execute(),
    {
      code: "23514",
      message: /offline writer does not match its entitlement/u,
    },
  );
  await database.transaction().execute(async (transaction) => {
    await transaction
      .updateTable("offline_learning_entitlement")
      .set({
        highestContiguousSequence: 1,
        reconciliationCursorRevision: 1,
      })
      .where("id", "=", ids.entitlement)
      .executeTakeFirstOrThrow();
    await transaction
      .updateTable("scorm_attempt")
      .set({ progressRevision: 1 })
      .where("id", "=", ids.attempt)
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto("offline_scorm_reconciliation_receipt")
      .values({
        id: ids.receipt,
        entitlementId: ids.entitlement,
        attemptId: ids.attempt,
        commitId: "commit-1",
        clientSequence: 1,
        requestFingerprint: "1".repeat(64),
        launchSessionId: "model-launch-1",
        sessionElapsedSeconds: 10,
        sessionTimeDeltaSeconds: 10,
        outcome: "accepted",
        reasonCode: "accepted",
        resultingAttemptRevision: 1,
        receivedAt: new Date("2030-02-02T00:00:00.000Z"),
      })
      .execute();
  });
  assert.deepEqual(
    await database
      .selectFrom("offline_learning_entitlement")
      .innerJoin(
        "scorm_attempt",
        "scorm_attempt.id",
        "offline_learning_entitlement.attemptId",
      )
      .select([
        "offline_learning_entitlement.highestContiguousSequence",
        "offline_learning_entitlement.reconciliationCursorRevision",
        "scorm_attempt.progressRevision",
      ])
      .where("offline_learning_entitlement.id", "=", ids.entitlement)
      .executeTakeFirstOrThrow(),
    {
      highestContiguousSequence: 1,
      reconciliationCursorRevision: 1,
      progressRevision: 1,
    },
  );
  await assert.rejects(
    database
      .updateTable("scorm_attempt")
      .set({ progressRevision: 2 })
      .where("id", "=", ids.attempt)
      .execute(),
    {
      code: "23514",
      message: /offline writer does not match its entitlement/u,
    },
  );
  await assert.rejects(
    database
      .updateTable("offline_learning_entitlement")
      .set({
        highestContiguousSequence: 0,
        reconciliationCursorRevision: 0,
      })
      .where("id", "=", ids.entitlement)
      .execute(),
    {
      code: "23514",
      message: /reconciliation cursor cannot regress/u,
    },
  );
  await assertDatabaseConstraint(
    () =>
      database
        .insertInto("offline_scorm_reconciliation_receipt")
        .values({
          id: "verify_offline_scorm_missing_session_receipt",
          entitlementId: ids.entitlement,
          attemptId: ids.attempt,
          commitId: "commit-missing-session",
          clientSequence: 2,
          requestFingerprint: "4".repeat(64),
          launchSessionId: null,
          sessionElapsedSeconds: null,
          sessionTimeDeltaSeconds: null,
          outcome: "accepted",
          reasonCode: "accepted",
          resultingAttemptRevision: 2,
          receivedAt: new Date("2030-02-02T00:00:30.000Z"),
        })
        .execute(),
    "23514",
    "offline_scorm_receipt_accepted_session_time_ck",
  );
  await assertDatabaseConstraint(
    () =>
      database
        .insertInto("offline_scorm_reconciliation_receipt")
        .values({
          id: ids.duplicateReceipt,
          entitlementId: ids.entitlement,
          attemptId: ids.attempt,
          commitId: "commit-1",
          clientSequence: 2,
          requestFingerprint: "2".repeat(64),
          launchSessionId: "model-launch-1",
          sessionElapsedSeconds: 20,
          sessionTimeDeltaSeconds: 10,
          outcome: "accepted",
          reasonCode: "accepted",
          resultingAttemptRevision: 2,
          receivedAt: new Date("2030-02-02T00:01:00.000Z"),
        })
        .execute(),
    "23505",
    "offline_scorm_reconciliation_receipt_commit_uq",
  );
  await assertDatabaseConstraint(
    () =>
      database
        .insertInto("offline_scorm_reconciliation_receipt")
        .values({
          id: ids.duplicateSequenceReceipt,
          entitlementId: ids.entitlement,
          attemptId: ids.attempt,
          commitId: "commit-2",
          clientSequence: 1,
          requestFingerprint: "3".repeat(64),
          launchSessionId: "model-launch-2",
          sessionElapsedSeconds: 10,
          sessionTimeDeltaSeconds: 10,
          outcome: "accepted",
          reasonCode: "accepted",
          resultingAttemptRevision: 2,
          receivedAt: new Date("2030-02-02T00:02:00.000Z"),
        })
        .execute(),
    "23505",
    "offline_scorm_receipt_accepted_sequence_uq",
  );
  await assert.rejects(
    database
      .updateTable("offline_scorm_reconciliation_receipt")
      .set({ reasonCode: "changed" })
      .where("id", "=", ids.receipt)
      .execute(),
    {
      code: "23514",
      message: /receipts are immutable/u,
    },
  );

  await assertDatabaseConstraint(
    () =>
      database
        .insertInto("offline_scorm_cleanup_inventory")
        .values({
          id: ids.invalidCleanup,
          entitlementId: ids.entitlement,
          installationId: ids.installation,
          userId: ids.user,
          packageSiteOrigin: "http://offline-attempt.example.test/path",
          clearRequestedAt: null,
          clearedAt: null,
          cleanupReceiptSha256: null,
          lastErrorCode: null,
          createdAt: issuedAt,
          updatedAt: issuedAt,
        })
        .execute(),
    "23514",
    "offline_scorm_cleanup_inventory_origin_ck",
  );
  await database
    .insertInto("offline_scorm_cleanup_inventory")
    .values({
      id: ids.cleanup,
      entitlementId: ids.entitlement,
      installationId: ids.installation,
      userId: ids.user,
      packageSiteOrigin: "https://attempt-1.offline.example.test",
      clearRequestedAt: null,
      clearedAt: null,
      cleanupReceiptSha256: null,
      lastErrorCode: null,
      createdAt: issuedAt,
      updatedAt: issuedAt,
    })
    .execute();
  const clearRequestedAt = new Date("2030-02-03T00:00:00.000Z");
  await database
    .updateTable("offline_scorm_cleanup_inventory")
    .set({
      state: "clearing",
      clearRequestedAt,
      updatedAt: clearRequestedAt,
    })
    .where("id", "=", ids.cleanup)
    .execute();
  await database
    .updateTable("offline_scorm_cleanup_inventory")
    .set({
      state: "needs_attention",
      lastErrorCode: "site_unreachable",
      updatedAt: new Date("2030-02-03T00:01:00.000Z"),
    })
    .where("id", "=", ids.cleanup)
    .execute();
  await database
    .updateTable("offline_scorm_cleanup_inventory")
    .set({
      state: "clearing",
      lastErrorCode: null,
      updatedAt: new Date("2030-02-03T00:02:00.000Z"),
    })
    .where("id", "=", ids.cleanup)
    .execute();
  const clearedAt = new Date("2030-02-03T00:03:00.000Z");
  await database
    .updateTable("offline_scorm_cleanup_inventory")
    .set({
      state: "cleared",
      clearedAt,
      cleanupReceiptSha256: "4".repeat(64),
      updatedAt: clearedAt,
    })
    .where("id", "=", ids.cleanup)
    .execute();
  await assert.rejects(
    database
      .updateTable("offline_scorm_cleanup_inventory")
      .set({ updatedAt: new Date("2030-02-03T00:04:00.000Z") })
      .where("id", "=", ids.cleanup)
      .execute(),
    {
      code: "23514",
      message: /cleanup evidence is immutable/u,
    },
  );

  await assert.rejects(
    database
      .updateTable("scorm_attempt")
      .set({
        writerMode: "online",
        offlineEntitlementId: null,
        credentialGeneration: 2,
      })
      .where("id", "=", ids.attempt)
      .execute(),
    {
      code: "23514",
      message: /Active offline entitlement must own the attempt writer/u,
    },
  );
  await assert.rejects(
    database
      .updateTable("offline_learning_installation")
      .set({
        status: "revoked",
        endedAt: new Date("2030-02-03T00:04:00.000Z"),
        updatedAt: new Date("2030-02-03T00:04:00.000Z"),
      })
      .where("id", "=", ids.installation)
      .execute(),
    {
      code: "23514",
      message: /installation cannot retain active entitlements/u,
    },
  );
  const resolvedAt = new Date("2030-02-03T00:05:00.000Z");
  await assert.rejects(
    database
      .updateTable("offline_learning_entitlement")
      .set({
        status: "resolved",
        resolution: "reconciled",
        endedAt: resolvedAt,
      })
      .where("id", "=", ids.entitlement)
      .execute(),
    {
      code: "23514",
      message: /Offline attempt writer requires an active entitlement/u,
    },
  );
  await assertDatabaseConstraint(
    () =>
      database.transaction().execute(async (transaction) => {
        await transaction
          .updateTable("scorm_attempt")
          .set({
            writerMode: "online",
            offlineEntitlementId: null,
            credentialGeneration: 2,
          })
          .where("id", "=", ids.attempt)
          .execute();
        await transaction
          .updateTable("offline_learning_entitlement")
          .set({
            status: "resolved",
            resolution: "reconciled",
            endedAt: "infinity",
          })
          .where("id", "=", ids.entitlement)
          .execute();
      }),
    "23514",
    "offline_learning_entitlement_timeline_ck",
  );
  const replacedAt = new Date("2030-02-04T00:00:00.000Z");
  await database.transaction().execute(async (transaction) => {
    await transaction
      .updateTable("scorm_attempt")
      .set({
        writerMode: "online",
        offlineEntitlementId: null,
        credentialGeneration: 2,
      })
      .where("id", "=", ids.attempt)
      .execute();
    await transaction
      .updateTable("offline_learning_entitlement")
      .set({
        status: "resolved",
        resolution: "reconciled",
        endedAt: resolvedAt,
      })
      .where("id", "=", ids.entitlement)
      .execute();
    await transaction
      .updateTable("offline_learning_installation")
      .set({
        status: "replaced",
        endedAt: replacedAt,
        updatedAt: replacedAt,
      })
      .where("id", "=", ids.installation)
      .execute();
    await transaction
      .insertInto("offline_learning_installation")
      .values({
        id: ids.duplicateInstallation,
        userId: ids.user,
        publicKeySpki: Buffer.alloc(91, 3),
        publicKeySha256: "d".repeat(64),
        replacementInstallationId: null,
        registeredAt: replacedAt,
        endedAt: null,
        updatedAt: replacedAt,
      })
      .execute();
    await transaction
      .updateTable("offline_learning_installation")
      .set({
        replacementInstallationId: ids.duplicateInstallation,
        updatedAt: new Date("2030-02-04T00:01:00.000Z"),
      })
      .where("id", "=", ids.installation)
      .execute();
  });
  await assert.rejects(
    database
      .updateTable("offline_learning_entitlement")
      .set({ highestContiguousSequence: 1 })
      .where("id", "=", ids.entitlement)
      .execute(),
    {
      code: "23514",
      message: /entitlement lifecycle is terminal/u,
    },
  );

  await assert.rejects(
    database
      .updateTable("offline_learning_installation")
      .set({
        status: "replaced",
        replacementInstallationId: ids.installation,
        endedAt: new Date("2030-02-04T00:02:00.000Z"),
        updatedAt: new Date("2030-02-04T00:02:00.000Z"),
      })
      .where("id", "=", ids.duplicateInstallation)
      .execute(),
    {
      code: "23514",
      message:
        /replacement requires an active installation for the same learner/u,
    },
  );

  console.log(
    "Verified dormant offline SCORM installation identity, exact learner/package entitlements, exclusive writer transitions, immutable reconciliation receipts and authoritative cleanup inventory",
  );
} finally {
  await cleanup();
  await database.destroy();
}
