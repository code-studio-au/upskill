import assert from "node:assert/strict";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { withAuditMaintenance } from "./audit-maintenance";
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
      publicKeySpki: Buffer.alloc(91, 7),
      publicKeySha256: "b".repeat(64),
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

  console.log(
    "Verified shared Course/Event launch policy, owner-first completion locks, finite offline delegation, locked writer races, online credential invalidation, progress revisions, authorized player state, post-correction reassessment, and replay-safe completion",
  );
} finally {
  await cleanup();
  await database.destroy();
  const { destroyDatabase } = await import("#/server/db/database.server");
  await destroyDatabase();
}
