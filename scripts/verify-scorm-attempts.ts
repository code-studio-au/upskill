import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { withAuditMaintenance } from "./audit-maintenance";
import {
  canonicalizeOfflineScormCommit,
  offlineScormUnsignedCommitSchema,
  type OfflineScormSignedCommit,
  type OfflineScormUnsignedCommit,
} from "#/features/scorm/offline-scorm-reconciliation";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import type { Database } from "#/server/db/types";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const ids = {
  user: "verify_scorm_user",
  anotherUser: "verify_scorm_another_user",
  course: "verify_scorm_course",
  courseVersion: "verify_scorm_course_version",
  section: "verify_scorm_section",
  item: "verify_scorm_item",
  enrollment: "verify_scorm_enrollment",
  package: "verify_scorm_package",
  packageVersion: "verify_scorm_package_version",
  installation: "verify_scorm_installation",
  eventTemplate: "verify_scorm_event_template",
  eventTemplateVersion: "verify_scorm_event_template_version",
  eventSection: "verify_scorm_event_section",
  eventItem: "verify_scorm_event_item",
  eventOccurrence: "verify_scorm_event_occurrence",
  eventParticipation: "verify_scorm_event_participation",
};
const user: AuthenticatedUser = {
  id: ids.user,
  name: "SCORM Verifier",
  email: "scorm-verifier@example.com",
  emailVerified: true,
};
const anotherUser: AuthenticatedUser = {
  id: ids.anotherUser,
  name: "Another SCORM Learner",
  email: "another-scorm-verifier@example.com",
  emailVerified: true,
};
const offlineKeyPair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const offlinePublicKeySpki = offlineKeyPair.publicKey.export({
  format: "der",
  type: "spki",
});

function signedOfflineCommit(
  input: OfflineScormUnsignedCommit,
): OfflineScormSignedCommit {
  const commit = offlineScormUnsignedCommitSchema.parse(input);
  const signature = sign(
    "sha256",
    Buffer.from(canonicalizeOfflineScormCommit(commit), "utf8"),
    { key: offlineKeyPair.privateKey, dsaEncoding: "ieee-p1363" },
  ).toString("base64url");
  return { ...commit, signature };
}

const database = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});

async function waitForBlockedScormConnections(minimum: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await sql<{ count: number }>`
      select count(*)::integer as count
      from pg_stat_activity
      where datname = current_database()
        and pid <> pg_backend_pid()
        and wait_event_type = 'Lock'
        and (
          query ilike '%scorm_attempt%'
          or query ilike '%enrollment%'
          or query ilike '%event_participation%'
        )
    `.execute(database);
    if ((result.rows[0]?.count ?? 0) >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(
    `Expected at least ${String(minimum)} blocked SCORM connection(s)`,
  );
}

async function verifyOwnerFirstProgressLockOrder<TProgress, TLaunch>(input: {
  attemptId: string;
  beginProgress: () => Promise<TProgress>;
  beginLaunch: () => Promise<TLaunch>;
}): Promise<[TProgress, TLaunch]> {
  let markBlockerReady: () => void = () => undefined;
  const blockerReady = new Promise<void>((resolve) => {
    markBlockerReady = resolve;
  });
  let releaseBlocker: () => void = () => undefined;
  const blockerRelease = new Promise<void>((resolve) => {
    releaseBlocker = resolve;
  });
  const blocker = database.transaction().execute(async (transaction) => {
    await transaction
      .selectFrom("scorm_attempt")
      .select("id")
      .where("id", "=", input.attemptId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    markBlockerReady();
    await blockerRelease;
  });
  await blockerReady;

  const progress = input.beginProgress();
  let launch: Promise<TLaunch> | undefined;
  try {
    await waitForBlockedScormConnections(1);
    launch = input.beginLaunch();
    await waitForBlockedScormConnections(2);
  } catch (error) {
    releaseBlocker();
    await Promise.allSettled([blocker, progress, ...(launch ? [launch] : [])]);
    throw error;
  }

  releaseBlocker();
  assert.ok(launch);
  const [, progressResult, launchResult] = await Promise.all([
    blocker,
    progress,
    launch,
  ]);
  return [progressResult, launchResult];
}

async function cleanup(): Promise<void> {
  await withAuditMaintenance(database, async (database) => {
    await database
      .deleteFrom("outbox_event")
      .where("aggregateId", "=", ids.enrollment)
      .execute();
    await database
      .deleteFrom("audit_event")
      .where((expression) =>
        expression.or([
          expression("subjectId", "=", ids.enrollment),
          expression("metadata", "@>", { enrollmentId: ids.enrollment }),
        ]),
      )
      .execute();
    const attempts = await database
      .selectFrom("scorm_attempt")
      .select([
        "id",
        "writerMode",
        "credentialGeneration",
        "offlineEntitlementId",
      ])
      .where((expression) =>
        expression.or([
          expression("enrollmentId", "=", ids.enrollment),
          expression("eventParticipationId", "=", ids.eventParticipation),
        ]),
      )
      .execute();
    const attemptIds = attempts.map((attempt) => attempt.id);
    if (attemptIds.length > 0) {
      for (const attempt of attempts)
        if (attempt.writerMode === "offline") {
          await database
            .updateTable("scorm_attempt")
            .set({
              writerMode: "online",
              offlineEntitlementId: null,
              credentialGeneration: attempt.credentialGeneration + 1,
            })
            .where("id", "=", attempt.id)
            .executeTakeFirstOrThrow();
          if (attempt.offlineEntitlementId)
            await database
              .updateTable("offline_learning_entitlement")
              .set({
                status: "resolved",
                resolution: "discarded",
                endedAt: new Date(),
              })
              .where("id", "=", attempt.offlineEntitlementId)
              .where("status", "=", "active")
              .executeTakeFirstOrThrow();
        }
      await database
        .deleteFrom("offline_scorm_cleanup_inventory")
        .where("entitlementId", "in", (query) =>
          query
            .selectFrom("offline_learning_entitlement")
            .select("id")
            .where("attemptId", "in", attemptIds),
        )
        .execute();
      await database
        .deleteFrom("offline_scorm_reconciliation_receipt")
        .where("attemptId", "in", attemptIds)
        .execute();
      await database
        .deleteFrom("offline_learning_entitlement")
        .where("attemptId", "in", attemptIds)
        .execute();
      await database
        .deleteFrom("scorm_attempt_session")
        .where("attemptId", "in", attemptIds)
        .execute();
      await database
        .deleteFrom("scorm_launch_token")
        .where("attemptId", "in", attemptIds)
        .execute();
      await database
        .deleteFrom("audit_event")
        .where("subjectId", "in", attemptIds)
        .execute();
      await database
        .deleteFrom("scorm_attempt")
        .where("id", "in", attemptIds)
        .execute();
    }
    await database
      .deleteFrom("offline_learning_installation")
      .where("id", "=", ids.installation)
      .execute();
    await database
      .deleteFrom("learning_progress_override")
      .where("enrollmentId", "=", ids.enrollment)
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
      .deleteFrom("event_section_release")
      .where("eventParticipationId", "=", ids.eventParticipation)
      .execute();
    await database
      .deleteFrom("learning_item_progress")
      .where("eventParticipationId", "=", ids.eventParticipation)
      .execute();
    await database
      .deleteFrom("event_participation")
      .where("id", "=", ids.eventParticipation)
      .execute();
    await database
      .deleteFrom("event_occurrence")
      .where("id", "=", ids.eventOccurrence)
      .execute();
    await database
      .deleteFrom("event_template_version_item")
      .where("id", "=", ids.eventItem)
      .execute();
    await database
      .deleteFrom("event_template_version_section")
      .where("id", "=", ids.eventSection)
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
      .deleteFrom("learning_activity_version")
      .where("id", "=", ids.packageVersion)
      .execute();
    await database
      .deleteFrom("learning_activity")
      .where("id", "=", ids.package)
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
  });
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
        emailVerified: true,
        image: null,
        stripeCustomerId: null,
      },
      {
        id: anotherUser.id,
        name: anotherUser.name,
        email: anotherUser.email,
        emailVerified: true,
        image: null,
        stripeCustomerId: null,
      },
    ])
    .execute();
  await database
    .insertInto("offline_learning_installation")
    .values({
      id: ids.installation,
      userId: ids.user,
      publicKeySpki: offlinePublicKeySpki,
      publicKeySha256: createHash("sha256")
        .update(offlinePublicKeySpki)
        .digest("hex"),
      replacementInstallationId: null,
      registeredAt: new Date(),
      endedAt: null,
      updatedAt: new Date(),
    })
    .execute();
  await database
    .insertInto("course")
    .values({
      id: ids.course,
      slug: "verify-scorm-course",
      title: "Verified SCORM course",
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
        title: "Verified SCORM course",
        summary: "Attempt boundary verification fixture.",
        description: "Verifies SCORM entitlement and progress persistence.",
        topic: "technology",
        durationMinutes: 20,
        priceCents: 10_000,
        salePriceCents: null,
        currency: "AUD",
        featured: false,
        listInStore: true,
        hasCompletionCertificate: false,
        prerequisites: [],
        accreditations: [],
        modules: [
          { title: "Verified SCO", phase: "content", durationMinutes: 20 },
        ],
      },
      publishedAt: new Date(),
    })
    .execute();
  await database
    .insertInto("learning_activity")
    .values({
      id: ids.package,
      kind: "scorm",
      title: "Verified SCORM package",
    })
    .execute();
  await database
    .insertInto("learning_activity_version")
    .values({
      id: ids.packageVersion,
      activityId: ids.package,
      kind: "scorm",
      version: 1,
      publishedAt: new Date(),
    })
    .execute();
  await database
    .insertInto("scorm_package_version")
    .values({
      id: ids.packageVersion,
      status: "ready",
      standard: "scorm-1.2",
      contentPrefix: "verified/package/v1",
      launchPath: "index.html",
      sha256: "a".repeat(64),
      manifest: { identifier: "verified-sco" },
    })
    .execute();
  const eventFixtureNow = new Date();
  await database
    .insertInto("event_template")
    .values({
      id: ids.eventTemplate,
      title: "Verified SCORM event",
      status: "published",
      createdAt: eventFixtureNow,
      updatedAt: eventFixtureNow,
    })
    .execute();
  await database
    .insertInto("event_template_version")
    .values({
      id: ids.eventTemplateVersion,
      eventTemplateId: ids.eventTemplate,
      version: 1,
      summary: "Event SCORM policy verification",
      description: "Verifies the shared Course and Event launch policy.",
      hasCompletionCertificate: false,
      accreditations: JSON.stringify([]),
      publishedAt: eventFixtureNow,
      createdAt: eventFixtureNow,
    })
    .execute();
  await database
    .insertInto("event_template_version_section")
    .values({
      id: ids.eventSection,
      eventTemplateVersionId: ids.eventTemplateVersion,
      position: 0,
      title: "Released event learning",
      description: "Released SCORM policy fixture",
      phase: "post_event",
      releaseAnchor: "participation_created",
      releaseOffsetAmount: 0,
      releaseOffsetUnit: "minute",
      createdAt: eventFixtureNow,
    })
    .execute();
  await database
    .insertInto("event_template_version_item")
    .values({
      id: ids.eventItem,
      eventTemplateVersionId: ids.eventTemplateVersion,
      sectionId: ids.eventSection,
      position: 0,
      kind: "scorm",
      title: "Verified event SCO",
      required: true,
      durationMinutes: 20,
      learningActivityVersionId: ids.packageVersion,
      sessionDefinitionId: null,
      createdAt: eventFixtureNow,
    })
    .execute();
  await database
    .insertInto("event_occurrence")
    .values({
      id: ids.eventOccurrence,
      eventTemplateVersionId: ids.eventTemplateVersion,
      title: "Verified SCORM event occurrence",
      slug: "verify-scorm-event-occurrence",
      status: "completed",
      deliveryMode: "in_person",
      virtualDeliveryProvider: null,
      registrationMode: "open_entry",
      approvalMode: "automatic",
      timezone: "Australia/Sydney",
      localStartsAt: "2026-09-15T09:00:00",
      localEndsAt: "2026-09-15T17:00:00",
      localRegistrationOpensAt: null,
      localRegistrationClosesAt: null,
      localCoordinatorLockAt: null,
      startsAt: new Date("2026-09-14T23:00:00.000Z"),
      endsAt: new Date("2026-09-15T07:00:00.000Z"),
      registrationOpensAt: null,
      registrationClosesAt: null,
      coordinatorLockAt: null,
      capacity: 30,
      venueName: "Verification venue",
      venueAddress: "Sydney NSW",
      virtualJoinUrl: null,
      priceCents: null,
      salePriceCents: null,
      currency: "AUD",
      bulkPricing: JSON.stringify({ enabled: false, tiers: [] }),
      listInStore: false,
      featured: false,
      publishedAt: eventFixtureNow,
      createdByUserId: ids.user,
      createdAt: eventFixtureNow,
      updatedAt: eventFixtureNow,
    })
    .execute();
  await database
    .insertInto("event_participation")
    .values({
      id: ids.eventParticipation,
      eventOccurrenceId: ids.eventOccurrence,
      userId: ids.user,
      registrationId: null,
      mode: "open_entry",
      nameSnapshot: user.name,
      emailSnapshot: user.email,
      detailsSubmittedAt: eventFixtureNow,
      joinDisclosedAt: eventFixtureNow,
      checkedInAt: null,
      completedAt: null,
      createdAt: eventFixtureNow,
    })
    .execute();
  await database
    .insertInto("course_version_section")
    .values({
      courseVersionId: ids.courseVersion,
      id: ids.section,
      position: 0,
      title: "Verified section",
      description: "SCORM attempt verification",
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
      title: "Verified SCO",
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
      enrolledAt: new Date(),
      completedAt: null,
      expiresAt: new Date("2027-08-01T00:00:00.000Z"),
      removedAt: null,
    })
    .execute();

  const {
    authorizeScormAttemptSession,
    createEventScormLaunch,
    createScormLaunch,
    exchangeScormLaunchToken,
    findAuthorizedScormPlayer,
    recordScormProgress,
  } = await import("#/server/scorm/scorm-attempt.server");
  const { issueOfflineScormEntitlement } =
    await import("#/server/scorm/offline-scorm-entitlement.server");
  const { reconcileOfflineScormProgress } =
    await import("#/server/scorm/offline-scorm-reconciliation.server");
  const requireAuthorizedPlayer = async (
    attemptId: string,
    sessionToken: string,
  ) => {
    const player = await findAuthorizedScormPlayer(attemptId, sessionToken);
    if (!player || player === "offline-writer-active")
      assert.fail("Expected an authorized online SCORM player");
    return player;
  };
  const eventLaunch = await createEventScormLaunch(
    ids.eventParticipation,
    ids.eventItem,
    user,
  );
  assert.equal(eventLaunch.status, "ready");
  const eventLaunchToken = new URL(eventLaunch.launchUrl).searchParams.get(
    "token",
  );
  assert.ok(eventLaunchToken);
  const eventExchange = await exchangeScormLaunchToken(eventLaunchToken);
  if (!eventExchange || eventExchange === "offline-writer-active")
    assert.fail("Expected the event launch to create an online session");
  const [eventProgress, concurrentEventLaunch] =
    await verifyOwnerFirstProgressLockOrder({
      attemptId: eventExchange.attemptId,
      beginProgress: () =>
        recordScormProgress(
          eventExchange.attemptId,
          eventExchange.sessionToken,
          {
            lessonStatus: "passed",
            location: "event-owner-lock",
            suspendData: "event-owner-lock-state",
            scoreRaw: 100,
            scoreMin: 0,
            scoreMax: 100,
            totalTimeSeconds: 120,
          },
        ),
      beginLaunch: () =>
        createEventScormLaunch(ids.eventParticipation, ids.eventItem, user),
    });
  assert.equal(eventProgress, "completed");
  assert.equal(concurrentEventLaunch.status, "ready");
  assert.deepEqual(
    await issueOfflineScormEntitlement(
      {
        target: {
          kind: "event",
          eventParticipationId: ids.eventParticipation,
          eventTemplateVersionItemId: ids.eventItem,
        },
        installationId: ids.installation,
      },
      user,
    ),
    { status: "denied", reason: "finite-access-expiry-required" },
  );
  assert.deepEqual(
    await issueOfflineScormEntitlement(
      {
        target: {
          kind: "course",
          enrollmentId: ids.enrollment,
          modulePosition: 0,
        },
        installationId: ids.installation,
      },
      anotherUser,
    ),
    { status: "denied", reason: "installation-unavailable" },
  );
  assert.deepEqual(
    await issueOfflineScormEntitlement(
      {
        target: {
          kind: "course",
          enrollmentId: `${ids.enrollment}_forged`,
          modulePosition: 0,
        },
        installationId: ids.installation,
      },
      user,
    ),
    { status: "denied", reason: "not-found" },
  );
  await database
    .updateTable("enrollment")
    .set({ expiresAt: null })
    .where("id", "=", ids.enrollment)
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    await issueOfflineScormEntitlement(
      {
        target: {
          kind: "course",
          enrollmentId: ids.enrollment,
          modulePosition: 0,
        },
        installationId: ids.installation,
      },
      user,
    ),
    { status: "denied", reason: "finite-access-expiry-required" },
  );
  await database
    .updateTable("enrollment")
    .set({ expiresAt: new Date("2027-08-01T00:00:00.000Z") })
    .where("id", "=", ids.enrollment)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("enrollment")
    .set({ removedAt: new Date() })
    .where("id", "=", ids.enrollment)
    .executeTakeFirstOrThrow();
  assert.deepEqual(await createScormLaunch(ids.enrollment, 0, user), {
    status: "unavailable",
  });
  await database
    .updateTable("enrollment")
    .set({ removedAt: null })
    .where("id", "=", ids.enrollment)
    .executeTakeFirstOrThrow();
  assert.deepEqual(await createScormLaunch(ids.enrollment, 0, anotherUser), {
    status: "not-found",
  });
  const launch = await createScormLaunch(ids.enrollment, 0, user);
  assert.equal(launch.status, "ready");
  assert.match(
    launch.launchUrl,
    /^http:\/\/localhost:3001\/api\/scorm\/launch/,
  );
  const launchToken = new URL(launch.launchUrl).searchParams.get("token");
  assert.ok(launchToken);
  assert.equal(launchToken.length, 43);

  const exchange = await exchangeScormLaunchToken(launchToken);
  if (!exchange || exchange === "offline-writer-active")
    assert.fail("Expected the launch token to create an online session");
  assert.equal(await exchangeScormLaunchToken(launchToken), null);
  assert.equal(
    await authorizeScormAttemptSession(
      exchange.attemptId,
      exchange.sessionToken,
    ),
    "authorized",
  );
  assert.equal(
    await authorizeScormAttemptSession(exchange.attemptId, "x".repeat(43)),
    "unauthorized",
  );
  assert.deepEqual(
    await requireAuthorizedPlayer(exchange.attemptId, exchange.sessionToken),
    {
      contentPrefix: "verified/package/v1",
      launchPath: "index.html",
      state: {
        attemptId: exchange.attemptId,
        entry: "ab-initio",
        learnerId: user.id,
        learnerName: user.name,
        lessonStatus: "incomplete",
        location: "",
        scoreMax: null,
        scoreMin: null,
        scoreRaw: null,
        suspendData: "",
        totalTimeSeconds: 0,
      },
    },
  );

  const progress = {
    lessonStatus: "incomplete" as const,
    location: "slide-4",
    suspendData: "verified-state",
    scoreRaw: 75,
    scoreMin: 0,
    scoreMax: 100,
    totalTimeSeconds: 180,
  };
  assert.equal(
    await recordScormProgress(
      exchange.attemptId,
      exchange.sessionToken,
      progress,
    ),
    "updated",
  );
  assert.equal(
    await recordScormProgress(exchange.attemptId, exchange.sessionToken, {
      ...progress,
      lessonStatus: "passed",
      totalTimeSeconds: 300,
    }),
    "completed",
  );
  assert.equal(
    await recordScormProgress(
      exchange.attemptId,
      exchange.sessionToken,
      progress,
    ),
    "completed",
  );

  const attempt = await database
    .selectFrom("scorm_attempt")
    .select(["status", "lessonStatus", "location", "totalTimeSeconds"])
    .where("id", "=", exchange.attemptId)
    .executeTakeFirstOrThrow();
  assert.deepEqual(attempt, {
    status: "completed",
    lessonStatus: "passed",
    location: "slide-4",
    totalTimeSeconds: 300,
  });
  assert.equal(
    (await requireAuthorizedPlayer(exchange.attemptId, exchange.sessionToken))
      .state.entry,
    "resume",
  );
  const enrollment = await database
    .selectFrom("enrollment")
    .select(["status", "completedAt"])
    .where("id", "=", ids.enrollment)
    .executeTakeFirstOrThrow();
  assert.equal(enrollment.status, "completed");
  assert.ok(enrollment.completedAt);
  const completionEvents = await database
    .selectFrom("outbox_event")
    .select(sql<number>`count(*)::integer`.as("count"))
    .where("aggregateId", "=", ids.enrollment)
    .where("topic", "=", "enrollment.completed")
    .executeTakeFirstOrThrow();
  assert.equal(completionEvents.count, 1);

  const reviewLaunch = await createScormLaunch(ids.enrollment, 0, user);
  assert.equal(reviewLaunch.status, "ready");
  const reviewToken = new URL(reviewLaunch.launchUrl).searchParams.get("token");
  assert.ok(reviewToken);
  const reviewExchange = await exchangeScormLaunchToken(reviewToken);
  if (!reviewExchange || reviewExchange === "offline-writer-active")
    assert.fail("Expected the review launch to create an online session");
  assert.equal(reviewExchange.attemptId, exchange.attemptId);
  assert.deepEqual(
    (
      await requireAuthorizedPlayer(
        reviewExchange.attemptId,
        reviewExchange.sessionToken,
      )
    ).state,
    {
      attemptId: exchange.attemptId,
      entry: "resume",
      learnerId: user.id,
      learnerName: user.name,
      lessonStatus: "passed",
      location: "slide-4",
      scoreMax: 100,
      scoreMin: 0,
      scoreRaw: 75,
      suspendData: "verified-state",
      totalTimeSeconds: 300,
    },
  );
  const attemptCount = await database
    .selectFrom("scorm_attempt")
    .select(sql<number>`count(*)::integer`.as("count"))
    .where("enrollmentId", "=", ids.enrollment)
    .where("modulePosition", "=", 0)
    .executeTakeFirstOrThrow();
  assert.equal(attemptCount.count, 1);

  const { applyAdminProgressOverride } =
    await import("#/server/admin/admin-learner.server");
  const { findEffectiveModuleCompletion } =
    await import("#/server/learning/progress-overrides.server");
  assert.equal(
    await applyAdminProgressOverride(
      {
        enrollmentId: ids.enrollment,
        scope: "module",
        modulePosition: 0,
        state: "incomplete",
      },
      anotherUser,
    ),
    "changed",
  );
  const corrected = await findEffectiveModuleCompletion(
    database,
    ids.enrollment,
    ids.courseVersion,
  );
  assert.equal(corrected[0]?.state, "incomplete");
  assert.equal(corrected[0].source, "administrator");
  assert.ok(corrected[0].override);
  const [courseRecompletion, concurrentCourseLaunch] =
    await verifyOwnerFirstProgressLockOrder({
      attemptId: reviewExchange.attemptId,
      beginProgress: () =>
        recordScormProgress(
          reviewExchange.attemptId,
          reviewExchange.sessionToken,
          {
            ...progress,
            lessonStatus: "passed",
            totalTimeSeconds: 300,
          },
        ),
      beginLaunch: () => createScormLaunch(ids.enrollment, 0, user),
    });
  assert.equal(courseRecompletion, "completed");
  assert.equal(concurrentCourseLaunch.status, "ready");
  const reassessed = await findEffectiveModuleCompletion(
    database,
    ids.enrollment,
    ids.courseVersion,
  );
  assert.equal(reassessed[0]?.state, "completed");
  assert.equal(reassessed[0].source, "scorm");
  assert.equal(
    (
      await database
        .selectFrom("enrollment")
        .select("status")
        .where("id", "=", ids.enrollment)
        .executeTakeFirstOrThrow()
    ).status,
    "completed",
  );

  assert.equal(
    await applyAdminProgressOverride(
      {
        enrollmentId: ids.enrollment,
        scope: "enrollment",
        modulePosition: null,
        state: "incomplete",
      },
      anotherUser,
    ),
    "changed",
  );
  assert.equal(
    (
      await database
        .selectFrom("enrollment")
        .select("status")
        .where("id", "=", ids.enrollment)
        .executeTakeFirstOrThrow()
    ).status,
    "active",
  );
  assert.equal(
    await recordScormProgress(
      reviewExchange.attemptId,
      reviewExchange.sessionToken,
      {
        ...progress,
        lessonStatus: "passed",
        totalTimeSeconds: 300,
      },
    ),
    "completed",
  );
  assert.equal(
    (
      await database
        .selectFrom("enrollment")
        .select("status")
        .where("id", "=", ids.enrollment)
        .executeTakeFirstOrThrow()
    ).status,
    "completed",
  );

  const pendingLaunch = await createScormLaunch(ids.enrollment, 0, user);
  assert.equal(pendingLaunch.status, "ready");
  const pendingLaunchToken = new URL(pendingLaunch.launchUrl).searchParams.get(
    "token",
  );
  assert.ok(pendingLaunchToken);
  const [issuance, racingProgress] = await Promise.all([
    issueOfflineScormEntitlement(
      {
        target: {
          kind: "course",
          enrollmentId: ids.enrollment,
          modulePosition: 0,
        },
        installationId: ids.installation,
      },
      user,
    ),
    recordScormProgress(reviewExchange.attemptId, reviewExchange.sessionToken, {
      ...progress,
      lessonStatus: "passed",
      location: "writer-race",
      totalTimeSeconds: 301,
    }),
  ]);
  if (issuance.status !== "issued")
    assert.fail(`Expected offline issuance, received ${issuance.reason}`);
  assert.ok(
    racingProgress === "completed" ||
      racingProgress === "offline-writer-active",
  );
  const offlineAttempt = await database
    .selectFrom("scorm_attempt")
    .select([
      "writerMode",
      "credentialGeneration",
      "offlineEntitlementId",
      "progressRevision",
    ])
    .where("id", "=", reviewExchange.attemptId)
    .executeTakeFirstOrThrow();
  assert.deepEqual(offlineAttempt, {
    writerMode: "offline",
    credentialGeneration: issuance.writerGeneration,
    offlineEntitlementId: issuance.entitlementId,
    progressRevision: issuance.historyBaseRevision,
  });
  assert.equal(
    await authorizeScormAttemptSession(
      reviewExchange.attemptId,
      reviewExchange.sessionToken,
    ),
    "offline-writer-active",
  );
  assert.equal(
    await findAuthorizedScormPlayer(
      reviewExchange.attemptId,
      reviewExchange.sessionToken,
    ),
    "offline-writer-active",
  );
  assert.equal(
    await recordScormProgress(
      reviewExchange.attemptId,
      reviewExchange.sessionToken,
      {
        ...progress,
        lessonStatus: "passed",
        totalTimeSeconds: 302,
      },
    ),
    "offline-writer-active",
  );
  assert.equal(
    await exchangeScormLaunchToken(pendingLaunchToken),
    "offline-writer-active",
  );
  assert.deepEqual(await createScormLaunch(ids.enrollment, 0, user), {
    status: "offline-writer-active",
  });
  assert.deepEqual(
    await issueOfflineScormEntitlement(
      {
        target: {
          kind: "course",
          enrollmentId: ids.enrollment,
          modulePosition: 0,
        },
        installationId: ids.installation,
      },
      user,
    ),
    { status: "denied", reason: "offline-writer-active" },
  );
  assert.equal(
    (
      await database
        .selectFrom("scorm_attempt_session")
        .select(sql<number>`count(*)::integer`.as("count"))
        .where("attemptId", "=", reviewExchange.attemptId)
        .where("revokedAt", "is", null)
        .executeTakeFirstOrThrow()
    ).count,
    0,
  );

  await database
    .updateTable("enrollment")
    .set({ removedAt: new Date() })
    .where("id", "=", ids.enrollment)
    .executeTakeFirstOrThrow();
  assert.deepEqual(await createScormLaunch(ids.enrollment, 0, user), {
    status: "offline-writer-active",
  });

  const offlineBase = await database
    .selectFrom("scorm_attempt")
    .select([
      "status",
      "lessonStatus",
      "location",
      "suspendData",
      "scoreRaw",
      "scoreMin",
      "scoreMax",
      "totalTimeSeconds",
      "progressRevision",
    ])
    .where("id", "=", issuance.attemptId)
    .executeTakeFirstOrThrow();
  const courseCommit = (input: {
    commitId: string;
    clientSequence: number;
    lessonStatus: OfflineScormUnsignedCommit["snapshot"]["lessonStatus"];
    location: string;
    sessionTimeDeltaSeconds: number;
    totalTimeSeconds: number;
    historyBaseRevision?: number;
  }) =>
    signedOfflineCommit({
      schemaVersion: 1,
      entitlementId: issuance.entitlementId,
      attemptId: issuance.attemptId,
      commitId: input.commitId,
      clientSequence: input.clientSequence,
      historyBaseRevision:
        input.historyBaseRevision ?? issuance.historyBaseRevision,
      runtimeVersion: issuance.runtimeVersion,
      offering: {
        kind: "course",
        enrollmentId: ids.enrollment,
        courseVersionItemId: ids.item,
      },
      packageVersionId: issuance.packageVersionId,
      packageSha256: issuance.packageSha256,
      reason: input.lessonStatus === "passed" ? "finish" : "commit",
      snapshot: {
        lessonStatus: input.lessonStatus,
        location: input.location,
        suspendData: `offline-state-${String(input.clientSequence)}`,
        scoreRaw: input.lessonStatus === "passed" ? 100 : 80,
        scoreMin: 0,
        scoreMax: 100,
        totalTimeSeconds: input.totalTimeSeconds,
      },
      launchSessionId: "course_launch_0001",
      sessionElapsedSeconds: 60 + input.sessionTimeDeltaSeconds,
      sessionTimeDeltaSeconds: input.sessionTimeDeltaSeconds,
      clientObservedAt: "2026-09-16T03:00:00.000Z",
    });
  const gapCommit = courseCommit({
    commitId: "course_gap_commit_0002",
    clientSequence: 2,
    lessonStatus: "passed",
    location: "offline-gap",
    sessionTimeDeltaSeconds: 20,
    totalTimeSeconds: offlineBase.totalTimeSeconds + 20,
  });
  const gap = await reconcileOfflineScormProgress(
    {
      schemaVersion: 1,
      entitlementId: issuance.entitlementId,
      attemptId: issuance.attemptId,
      commits: [gapCommit],
    },
    user,
  );
  assert.equal(gap.status, "processed");
  assert.deepEqual(gap.receipts, []);
  assert.deepEqual(gap.block, {
    kind: "sequence_gap",
    commitId: gapCommit.commitId,
    clientSequence: 2,
    expectedSequence: 1,
    acknowledged: false,
  });
  assert.equal(
    (
      await database
        .selectFrom("offline_scorm_reconciliation_receipt")
        .select(sql<number>`count(*)::integer`.as("count"))
        .where("entitlementId", "=", issuance.entitlementId)
        .executeTakeFirstOrThrow()
    ).count,
    0,
  );

  const firstCommit = courseCommit({
    commitId: "course_commit_0001",
    clientSequence: 1,
    lessonStatus: "incomplete",
    location: "offline-slide-1",
    sessionTimeDeltaSeconds: 10,
    totalTimeSeconds: offlineBase.totalTimeSeconds + 10,
  });
  const firstResult = await reconcileOfflineScormProgress(
    {
      schemaVersion: 1,
      entitlementId: issuance.entitlementId,
      attemptId: issuance.attemptId,
      commits: [firstCommit],
    },
    user,
  );
  assert.equal(firstResult.status, "processed");
  assert.equal(firstResult.receipts[0]?.outcome, "accepted");
  assert.equal(firstResult.receipts[0].recovered, false);
  assert.equal(firstResult.authoritative.status, "completed");
  assert.equal(firstResult.authoritative.lessonStatus, "passed");
  assert.equal(
    firstResult.authoritative.totalTimeSeconds,
    offlineBase.totalTimeSeconds + 10,
  );

  const firstRetry = await reconcileOfflineScormProgress(
    {
      schemaVersion: 1,
      entitlementId: issuance.entitlementId,
      attemptId: issuance.attemptId,
      commits: [firstCommit],
    },
    user,
  );
  assert.equal(firstRetry.status, "processed");
  assert.equal(firstRetry.receipts[0]?.recovered, true);
  assert.equal(
    firstRetry.authoritative.totalTimeSeconds,
    offlineBase.totalTimeSeconds + 10,
  );

  const reusedPayload = signedOfflineCommit({
    schemaVersion: firstCommit.schemaVersion,
    entitlementId: firstCommit.entitlementId,
    attemptId: firstCommit.attemptId,
    commitId: firstCommit.commitId,
    clientSequence: firstCommit.clientSequence,
    historyBaseRevision: firstCommit.historyBaseRevision,
    runtimeVersion: firstCommit.runtimeVersion,
    offering: firstCommit.offering,
    packageVersionId: firstCommit.packageVersionId,
    packageSha256: firstCommit.packageSha256,
    reason: firstCommit.reason,
    snapshot: { ...firstCommit.snapshot, location: "reused-identity" },
    launchSessionId: firstCommit.launchSessionId,
    sessionElapsedSeconds: firstCommit.sessionElapsedSeconds,
    sessionTimeDeltaSeconds: firstCommit.sessionTimeDeltaSeconds,
    clientObservedAt: firstCommit.clientObservedAt,
  });
  assert.deepEqual(
    await reconcileOfflineScormProgress(
      {
        schemaVersion: 1,
        entitlementId: issuance.entitlementId,
        attemptId: issuance.attemptId,
        commits: [reusedPayload],
      },
      user,
    ),
    {
      status: "conflict",
      reason: "commit_id_reused",
      commitId: firstCommit.commitId,
      clientSequence: 1,
      acknowledged: false,
    },
  );

  assert.equal(
    await applyAdminProgressOverride(
      {
        enrollmentId: ids.enrollment,
        scope: "enrollment",
        modulePosition: null,
        state: "incomplete",
      },
      anotherUser,
    ),
    "changed",
  );
  const outboxBeforeOfflineCompletion = await database
    .selectFrom("outbox_event")
    .select(sql<number>`count(*)::integer`.as("count"))
    .where("aggregateId", "=", ids.enrollment)
    .where("topic", "=", "enrollment.completed")
    .executeTakeFirstOrThrow();
  const secondCommit = courseCommit({
    commitId: "course_commit_0002",
    clientSequence: 2,
    lessonStatus: "passed",
    location: "offline-finished",
    sessionTimeDeltaSeconds: 20,
    totalTimeSeconds: offlineBase.totalTimeSeconds + 30,
  });
  const thirdCommit = courseCommit({
    commitId: "course_commit_0003",
    clientSequence: 3,
    lessonStatus: "incomplete",
    location: "offline-after-finish",
    sessionTimeDeltaSeconds: 0,
    totalTimeSeconds: offlineBase.totalTimeSeconds + 30,
  });
  const orderedBatch = await reconcileOfflineScormProgress(
    {
      schemaVersion: 1,
      entitlementId: issuance.entitlementId,
      attemptId: issuance.attemptId,
      commits: [thirdCommit, secondCommit],
    },
    user,
  );
  assert.equal(orderedBatch.status, "processed");
  assert.deepEqual(
    orderedBatch.receipts.map((receipt) => receipt.clientSequence),
    [2, 3],
  );
  assert.equal(orderedBatch.block, null);
  assert.equal(orderedBatch.authoritative.status, "completed");
  assert.equal(orderedBatch.authoritative.lessonStatus, "passed");
  assert.equal(orderedBatch.authoritative.location, "offline-after-finish");
  assert.equal(
    orderedBatch.authoritative.totalTimeSeconds,
    offlineBase.totalTimeSeconds + 30,
  );
  assert.equal(
    (
      await database
        .selectFrom("enrollment")
        .select("status")
        .where("id", "=", ids.enrollment)
        .executeTakeFirstOrThrow()
    ).status,
    "completed",
  );
  const outboxAfterOfflineCompletion = await database
    .selectFrom("outbox_event")
    .select(sql<number>`count(*)::integer`.as("count"))
    .where("aggregateId", "=", ids.enrollment)
    .where("topic", "=", "enrollment.completed")
    .executeTakeFirstOrThrow();
  assert.ok(
    outboxAfterOfflineCompletion.count >= outboxBeforeOfflineCompletion.count,
  );

  const batchRetry = await reconcileOfflineScormProgress(
    {
      schemaVersion: 1,
      entitlementId: issuance.entitlementId,
      attemptId: issuance.attemptId,
      commits: [secondCommit, thirdCommit],
    },
    user,
  );
  assert.equal(batchRetry.status, "processed");
  assert.ok(batchRetry.receipts.every((receipt) => receipt.recovered));
  assert.equal(
    (
      await database
        .selectFrom("outbox_event")
        .select(sql<number>`count(*)::integer`.as("count"))
        .where("aggregateId", "=", ids.enrollment)
        .where("topic", "=", "enrollment.completed")
        .executeTakeFirstOrThrow()
    ).count,
    outboxAfterOfflineCompletion.count,
  );

  const concurrentCommit = courseCommit({
    commitId: "course_commit_concurrent",
    clientSequence: 4,
    lessonStatus: "incomplete",
    location: "offline-concurrent-retry",
    sessionTimeDeltaSeconds: 1,
    totalTimeSeconds: offlineBase.totalTimeSeconds + 31,
  });
  const concurrentResults = await Promise.all([
    reconcileOfflineScormProgress(
      {
        schemaVersion: 1,
        entitlementId: issuance.entitlementId,
        attemptId: issuance.attemptId,
        commits: [concurrentCommit],
      },
      user,
    ),
    reconcileOfflineScormProgress(
      {
        schemaVersion: 1,
        entitlementId: issuance.entitlementId,
        attemptId: issuance.attemptId,
        commits: [concurrentCommit],
      },
      user,
    ),
  ]);
  for (const concurrentResult of concurrentResults)
    assert.equal(concurrentResult.status, "processed");
  assert.deepEqual(
    concurrentResults
      .flatMap((result) =>
        result.status === "processed"
          ? result.receipts.map((receipt) => receipt.recovered)
          : [],
      )
      .toSorted(),
    [false, true],
  );
  assert.equal(
    (
      await database
        .selectFrom("offline_scorm_reconciliation_receipt")
        .select(sql<number>`count(*)::integer`.as("count"))
        .where("entitlementId", "=", issuance.entitlementId)
        .where("commitId", "=", concurrentCommit.commitId)
        .executeTakeFirstOrThrow()
    ).count,
    1,
  );

  const invalidSignatureCommit = courseCommit({
    commitId: "course_commit_bad_signature",
    clientSequence: 5,
    lessonStatus: "passed",
    location: "invalid-signature",
    sessionTimeDeltaSeconds: 1,
    totalTimeSeconds: offlineBase.totalTimeSeconds + 32,
  });
  invalidSignatureCommit.signature = `${invalidSignatureCommit.signature[0] === "A" ? "B" : "A"}${invalidSignatureCommit.signature.slice(1)}`;
  assert.deepEqual(
    await reconcileOfflineScormProgress(
      {
        schemaVersion: 1,
        entitlementId: issuance.entitlementId,
        attemptId: issuance.attemptId,
        commits: [invalidSignatureCommit],
      },
      user,
    ),
    { status: "denied", reason: "signature_invalid" },
  );

  const staleBaseCommit = courseCommit({
    commitId: "course_commit_stale_base",
    clientSequence: 5,
    lessonStatus: "passed",
    location: "stale-base",
    sessionTimeDeltaSeconds: 1,
    totalTimeSeconds: offlineBase.totalTimeSeconds + 32,
    historyBaseRevision: issuance.historyBaseRevision + 1,
  });
  const staleBase = await reconcileOfflineScormProgress(
    {
      schemaVersion: 1,
      entitlementId: issuance.entitlementId,
      attemptId: issuance.attemptId,
      commits: [staleBaseCommit],
    },
    user,
  );
  assert.equal(staleBase.status, "processed");
  assert.equal(staleBase.receipts[0]?.reasonCode, "history_base_mismatch");
  assert.equal(staleBase.receipts[0].outcome, "conflict");

  await database.transaction().execute(async (transaction) => {
    await transaction
      .updateTable("scorm_attempt")
      .set({
        writerMode: "online",
        offlineEntitlementId: null,
        credentialGeneration: issuance.writerGeneration + 1,
      })
      .where("id", "=", issuance.attemptId)
      .executeTakeFirstOrThrow();
    await transaction
      .updateTable("offline_learning_entitlement")
      .set({
        status: "hard_revoked",
        resolution: "hard_revoked",
        resolvedByUserId: anotherUser.id,
        endedAt: new Date(),
      })
      .where("id", "=", issuance.entitlementId)
      .executeTakeFirstOrThrow();
  });
  const retryAfterRevocation = await reconcileOfflineScormProgress(
    {
      schemaVersion: 1,
      entitlementId: issuance.entitlementId,
      attemptId: issuance.attemptId,
      commits: [firstCommit],
    },
    user,
  );
  assert.equal(retryAfterRevocation.status, "processed");
  assert.equal(retryAfterRevocation.receipts[0]?.recovered, true);
  const revokedCommit = courseCommit({
    commitId: "course_commit_after_revoke",
    clientSequence: 5,
    lessonStatus: "passed",
    location: "after-revoke",
    sessionTimeDeltaSeconds: 1,
    totalTimeSeconds: offlineBase.totalTimeSeconds + 32,
  });
  const rejectedAfterRevocation = await reconcileOfflineScormProgress(
    {
      schemaVersion: 1,
      entitlementId: issuance.entitlementId,
      attemptId: issuance.attemptId,
      commits: [revokedCommit],
    },
    user,
  );
  assert.equal(rejectedAfterRevocation.status, "processed");
  assert.equal(
    rejectedAfterRevocation.receipts[0]?.reasonCode,
    "entitlement_hard_revoked",
  );

  const eventAttempt = await database
    .selectFrom("scorm_attempt")
    .select([
      "id",
      "progressRevision",
      "credentialGeneration",
      "totalTimeSeconds",
    ])
    .where("eventParticipationId", "=", ids.eventParticipation)
    .where("eventTemplateVersionItemId", "=", ids.eventItem)
    .executeTakeFirstOrThrow();
  await database
    .deleteFrom("learning_item_progress")
    .where("eventParticipationId", "=", ids.eventParticipation)
    .where("eventTemplateVersionItemId", "=", ids.eventItem)
    .execute();
  await database
    .updateTable("event_participation")
    .set({ completedAt: null })
    .where("id", "=", ids.eventParticipation)
    .executeTakeFirstOrThrow();
  const eventEntitlementId = "event_entitlement_0001";
  const eventIssuedAt = new Date();
  const eventLaunchExpiresAt = new Date(
    eventIssuedAt.getTime() + 10 * 24 * 60 * 60 * 1_000,
  );
  const eventAcceptanceDeadline = new Date(
    eventLaunchExpiresAt.getTime() + 20 * 24 * 60 * 60 * 1_000,
  );
  const eventWriterGeneration = eventAttempt.credentialGeneration + 1;
  await database.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("offline_learning_entitlement")
      .values({
        id: eventEntitlementId,
        userId: user.id,
        attemptId: eventAttempt.id,
        installationId: ids.installation,
        scormPackageVersionId: ids.packageVersion,
        packageSha256: "a".repeat(64),
        runtimeVersion: "offline-scorm-1",
        historyBaseRevision: eventAttempt.progressRevision,
        writerGeneration: eventWriterGeneration,
        reconciliationCursorRevision: eventAttempt.progressRevision,
        resolution: null,
        resolvedByUserId: null,
        issuedAt: eventIssuedAt,
        intendedLaunchExpiresAt: eventLaunchExpiresAt,
        commitAcceptanceDeadline: eventAcceptanceDeadline,
        endedAt: null,
      })
      .executeTakeFirstOrThrow();
    await transaction
      .updateTable("scorm_attempt")
      .set({
        writerMode: "offline",
        offlineEntitlementId: eventEntitlementId,
        credentialGeneration: eventWriterGeneration,
      })
      .where("id", "=", eventAttempt.id)
      .executeTakeFirstOrThrow();
  });
  const eventCommit = signedOfflineCommit({
    schemaVersion: 1,
    entitlementId: eventEntitlementId,
    attemptId: eventAttempt.id,
    commitId: "event_commit_0001",
    clientSequence: 1,
    historyBaseRevision: eventAttempt.progressRevision,
    runtimeVersion: "offline-scorm-1",
    offering: {
      kind: "event",
      eventParticipationId: ids.eventParticipation,
      eventTemplateVersionItemId: ids.eventItem,
    },
    packageVersionId: ids.packageVersion,
    packageSha256: "a".repeat(64),
    reason: "finish",
    snapshot: {
      lessonStatus: "passed",
      location: "event-offline-finished",
      suspendData: "event-offline-state",
      scoreRaw: 100,
      scoreMin: 0,
      scoreMax: 100,
      totalTimeSeconds: eventAttempt.totalTimeSeconds + 15,
    },
    launchSessionId: "event_launch_0001",
    sessionElapsedSeconds: 15,
    sessionTimeDeltaSeconds: 15,
    clientObservedAt: "2026-09-16T04:00:00.000Z",
  });
  const eventReconciliation = await reconcileOfflineScormProgress(
    {
      schemaVersion: 1,
      entitlementId: eventEntitlementId,
      attemptId: eventAttempt.id,
      commits: [eventCommit],
    },
    user,
  );
  assert.equal(eventReconciliation.status, "processed");
  assert.equal(eventReconciliation.receipts[0]?.outcome, "accepted");
  assert.ok(
    (
      await database
        .selectFrom("event_participation")
        .select("completedAt")
        .where("id", "=", ids.eventParticipation)
        .executeTakeFirstOrThrow()
    ).completedAt,
  );
  assert.equal(
    (
      await database
        .selectFrom("learning_item_progress")
        .select("state")
        .where("eventParticipationId", "=", ids.eventParticipation)
        .where("eventTemplateVersionItemId", "=", ids.eventItem)
        .executeTakeFirstOrThrow()
    ).state,
    "completed",
  );

  await database.transaction().execute(async (transaction) => {
    await transaction
      .updateTable("scorm_attempt")
      .set({
        writerMode: "online",
        offlineEntitlementId: null,
        credentialGeneration: eventWriterGeneration + 1,
      })
      .where("id", "=", eventAttempt.id)
      .executeTakeFirstOrThrow();
    await transaction
      .updateTable("offline_learning_entitlement")
      .set({
        status: "resolved",
        resolution: "reconciled",
        endedAt: new Date(),
      })
      .where("id", "=", eventEntitlementId)
      .executeTakeFirstOrThrow();
  });
  const eventAfterReconciliation = await database
    .selectFrom("scorm_attempt")
    .select(["progressRevision", "credentialGeneration", "totalTimeSeconds"])
    .where("id", "=", eventAttempt.id)
    .executeTakeFirstOrThrow();
  const expiredEntitlementId = "event_expired_entitlement_0001";
  const expiryReference = Date.now();
  const expiredIssuedAt = new Date(expiryReference - 70 * 24 * 60 * 60 * 1_000);
  const expiredLaunchAt = new Date(expiryReference - 40 * 24 * 60 * 60 * 1_000);
  const expiredAcceptanceAt = new Date(
    expiryReference - 10 * 24 * 60 * 60 * 1_000,
  );
  const expiredWriterGeneration =
    eventAfterReconciliation.credentialGeneration + 1;
  await database.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("offline_learning_entitlement")
      .values({
        id: expiredEntitlementId,
        userId: user.id,
        attemptId: eventAttempt.id,
        installationId: ids.installation,
        scormPackageVersionId: ids.packageVersion,
        packageSha256: "a".repeat(64),
        runtimeVersion: "offline-scorm-1",
        historyBaseRevision: eventAfterReconciliation.progressRevision,
        writerGeneration: expiredWriterGeneration,
        reconciliationCursorRevision: eventAfterReconciliation.progressRevision,
        resolution: null,
        resolvedByUserId: null,
        issuedAt: expiredIssuedAt,
        intendedLaunchExpiresAt: expiredLaunchAt,
        commitAcceptanceDeadline: expiredAcceptanceAt,
        endedAt: null,
      })
      .executeTakeFirstOrThrow();
    await transaction
      .updateTable("scorm_attempt")
      .set({
        writerMode: "offline",
        offlineEntitlementId: expiredEntitlementId,
        credentialGeneration: expiredWriterGeneration,
      })
      .where("id", "=", eventAttempt.id)
      .executeTakeFirstOrThrow();
  });
  const expiredCommit = signedOfflineCommit({
    schemaVersion: 1,
    entitlementId: expiredEntitlementId,
    attemptId: eventAttempt.id,
    commitId: "event_expired_commit_0001",
    clientSequence: 1,
    historyBaseRevision: eventAfterReconciliation.progressRevision,
    runtimeVersion: "offline-scorm-1",
    offering: {
      kind: "event",
      eventParticipationId: ids.eventParticipation,
      eventTemplateVersionItemId: ids.eventItem,
    },
    packageVersionId: ids.packageVersion,
    packageSha256: "a".repeat(64),
    reason: "commit",
    snapshot: {
      lessonStatus: "passed",
      location: "event-expired",
      suspendData: "event-expired-state",
      scoreRaw: 100,
      scoreMin: 0,
      scoreMax: 100,
      totalTimeSeconds: eventAfterReconciliation.totalTimeSeconds + 1,
    },
    launchSessionId: "event_expired_launch_0001",
    sessionElapsedSeconds: 1,
    sessionTimeDeltaSeconds: 1,
    clientObservedAt: "2026-09-16T05:00:00.000Z",
  });
  const expiredResult = await reconcileOfflineScormProgress(
    {
      schemaVersion: 1,
      entitlementId: expiredEntitlementId,
      attemptId: eventAttempt.id,
      commits: [expiredCommit],
    },
    user,
  );
  assert.equal(expiredResult.status, "processed");
  assert.equal(
    expiredResult.receipts[0]?.reasonCode,
    "acceptance_deadline_expired",
  );
  const expiredRetry = await reconcileOfflineScormProgress(
    {
      schemaVersion: 1,
      entitlementId: expiredEntitlementId,
      attemptId: eventAttempt.id,
      commits: [expiredCommit],
    },
    user,
  );
  assert.equal(expiredRetry.status, "processed");
  assert.equal(expiredRetry.receipts[0]?.recovered, true);

  console.log(
    "Verified shared Course/Event launch policy, owner-first completion locks, finite offline delegation, locked writer races, online credential invalidation, progress revisions, signature-bound ordered reconciliation, concurrent retry and gap handling, monotonic completion, deadline and hard-revocation gates, and Course/Event completion effects",
  );
} finally {
  await cleanup();
  await database.destroy();
  const { destroyDatabase } = await import("#/server/db/database.server");
  await destroyDatabase();
}
