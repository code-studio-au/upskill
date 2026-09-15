import assert from "node:assert/strict";
import { sql } from "kysely";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { recordAdminEventAttendance } from "#/server/admin/admin-event-registration-operations.server";
import {
  exportAdminEventAttendanceReport,
  findAdminEventAttendanceReport,
} from "#/server/admin/admin-event-attendance-report.server";
import { destroyDatabase, getDatabase } from "#/server/db/database.server";
import {
  down as downAutomaticAttendanceMigration,
  up as upAutomaticAttendanceMigration,
} from "#/server/db/migrations/0112_livekit_automatic_attendance";
import { getServerEnv } from "#/server/env.server";
import {
  ensureEventVirtualAttendanceReconciliation,
  isEventVirtualAttendanceReconciliationComplete,
  processAvailableEventVirtualAttendanceReconciliations,
  wakeEventVirtualAttendanceReconciliation,
} from "#/server/events/event-virtual-attendance.server";
import { ensureEventVirtualJoinAccess } from "#/server/events/event-virtual-join-access.server";
import {
  eventVirtualAttendeeIdentity,
  eventVirtualAttendeeIdentityDigest,
} from "#/server/events/event-virtual-participant-identity.server";
import { FakeLiveKitProvider } from "#/server/livekit/livekit-provider.fake";
import { ingestVerifiedLiveKitParticipantWebhook } from "#/server/livekit/livekit-participant-webhook.server";
import type { VerifiedLiveKitWebhook } from "#/server/livekit/livekit-webhook.server";

const ids = {
  administrator: "verify_livekit_attendance_administrator",
  firstLearner: "verify_livekit_attendance_first_learner",
  secondLearner: "verify_livekit_attendance_second_learner",
  template: "verify_livekit_attendance_template",
  version: "verify_livekit_attendance_version",
  definition: "verify_livekit_attendance_definition",
  section: "verify_livekit_attendance_section",
  item: "verify_livekit_attendance_item",
  occurrence: "verify_livekit_attendance_occurrence",
  session: "verify_livekit_attendance_session",
  room: "verify_livekit_attendance_room",
  firstRegistration: "verify_livekit_attendance_first_registration",
  secondRegistration: "verify_livekit_attendance_second_registration",
  firstParticipation: "verify_livekit_attendance_first_participation",
  secondParticipation: "verify_livekit_attendance_second_participation",
  firstLobby: "verify_livekit_attendance_first_lobby",
  secondLobby: "verify_livekit_attendance_second_lobby",
};

const administrator: AuthenticatedUser = {
  id: ids.administrator,
  name: "Automatic attendance administrator",
  email: "verify-livekit-attendance-admin@example.com",
  emailVerified: true,
};
const createdAt = new Date(Date.now() - 60 * 60_000);
const startsAt = new Date(Date.now() - 20 * 60_000);
const endsAt = new Date(startsAt.getTime() + 60 * 60_000);
const finalAt = new Date(startsAt.getTime() + 20 * 60_000);
const roomName = "event:verify_attendance:g1";
const database = getDatabase();
const provider = new FakeLiveKitProvider();
let automaticAttendanceMigrationApplied = true;

async function cleanUp(): Promise<void> {
  await database.transaction().execute(async (transaction) => {
    await sql`select set_config('upskill.audit_maintenance', 'on', true)`.execute(
      transaction,
    );
    await transaction
      .deleteFrom("audit_event")
      .where("subjectId", "in", [
        ids.occurrence,
        ids.room,
        ids.firstParticipation,
        ids.secondParticipation,
        `${ids.firstParticipation}:${ids.session}`,
        `${ids.secondParticipation}:${ids.session}`,
      ])
      .execute();
  });
  await database
    .deleteFrom("event_virtual_attendance_decision")
    .where("eventOccurrenceId", "=", ids.occurrence)
    .execute();
  await database
    .deleteFrom("event_virtual_attendance_reconciliation")
    .where("roomId", "=", ids.room)
    .execute();
  await database
    .deleteFrom("event_virtual_connection_interval")
    .where("eventOccurrenceId", "=", ids.occurrence)
    .execute();
  await database
    .deleteFrom("livekit_participant_webhook_receipt")
    .where("matchedEventOccurrenceId", "=", ids.occurrence)
    .execute();
  await database
    .deleteFrom("event_virtual_lobby_revision")
    .where("eventVirtualJoinAccessId", "in", (query) =>
      query
        .selectFrom("event_virtual_join_access")
        .select("id")
        .where("eventOccurrenceId", "=", ids.occurrence),
    )
    .execute();
  await database
    .deleteFrom("event_virtual_lobby_entry")
    .where("eventOccurrenceId", "=", ids.occurrence)
    .execute();
  await database
    .deleteFrom("event_virtual_join_access")
    .where("eventOccurrenceId", "=", ids.occurrence)
    .execute();
  await database
    .deleteFrom("event_virtual_room")
    .where("id", "=", ids.room)
    .execute();
  await database
    .deleteFrom("event_attendance")
    .where("eventSessionId", "=", ids.session)
    .execute();
  await database
    .deleteFrom("event_participation")
    .where("eventOccurrenceId", "=", ids.occurrence)
    .execute();
  await database
    .deleteFrom("event_registration")
    .where("eventOccurrenceId", "=", ids.occurrence)
    .execute();
  await database
    .deleteFrom("event_admin_assignment")
    .where("eventOccurrenceId", "=", ids.occurrence)
    .execute();
  await database
    .deleteFrom("event_session")
    .where("eventOccurrenceId", "=", ids.occurrence)
    .execute();
  await database
    .deleteFrom("event_occurrence")
    .where("id", "=", ids.occurrence)
    .execute();
  await database
    .deleteFrom("event_template_version_item")
    .where("eventTemplateVersionId", "=", ids.version)
    .execute();
  await database
    .deleteFrom("event_template_version_section")
    .where("eventTemplateVersionId", "=", ids.version)
    .execute();
  await database
    .deleteFrom("event_template_session_definition")
    .where("eventTemplateVersionId", "=", ids.version)
    .execute();
  await database
    .deleteFrom("event_template_version")
    .where("id", "=", ids.version)
    .execute();
  await database
    .deleteFrom("event_template")
    .where("id", "=", ids.template)
    .execute();
  await database
    .deleteFrom("platform_admin")
    .where("userId", "=", ids.administrator)
    .execute();
  await database
    .deleteFrom("user")
    .where("id", "in", [ids.administrator, ids.firstLearner, ids.secondLearner])
    .execute();
}

try {
  await database
    .insertInto("user")
    .values([
      {
        id: ids.administrator,
        name: administrator.name,
        email: administrator.email,
        emailVerified: true,
      },
      {
        id: ids.firstLearner,
        name: "First attendance learner",
        email: "verify-livekit-attendance-first@example.com",
        emailVerified: true,
      },
      {
        id: ids.secondLearner,
        name: "Second attendance learner",
        email: "verify-livekit-attendance-second@example.com",
        emailVerified: true,
      },
    ])
    .execute();
  await database
    .insertInto("platform_admin")
    .values({ userId: ids.administrator, grantedByUserId: null })
    .execute();
  await database
    .insertInto("event_template")
    .values({
      id: ids.template,
      title: "Automatic attendance verification",
      status: "published",
    })
    .execute();
  await database
    .insertInto("event_template_version")
    .values({
      id: ids.version,
      eventTemplateId: ids.template,
      version: 1,
      topic: "General",
      summary: "Automatic attendance verification.",
      description: "Verifies connection-backed attendance decisions.",
      coverImage: null,
      hasCompletionCertificate: false,
      accreditations: JSON.stringify([]),
      registrationSurveyVersionId: null,
      publishedAt: createdAt,
    })
    .execute();
  await database
    .insertInto("event_template_session_definition")
    .values({
      id: ids.definition,
      eventTemplateVersionId: ids.version,
      position: 0,
      title: "Automatic attendance session",
      durationMinutes: 60,
      presenterRequired: false,
      livekitAdmissionMode: "automatic",
      livekitAttendanceMode: "automatic_duration",
      livekitAttendanceMinimumMinutes: 15,
      livekitPresenterPreparationMinutes: 30,
      livekitAttendeeRejoinGraceMinutes: 10,
      livekitCapacityHeadroom: 5,
      livekitOpenEntryGuestsAllowed: false,
      livekitRecordingMode: "off",
      livekitRecordingRetentionDays: null,
      livekitAttendeeRecordingNotice: "",
      livekitPresenterRecordingNotice: "",
    })
    .execute();
  await database
    .insertInto("event_template_version_section")
    .values({
      id: ids.section,
      eventTemplateVersionId: ids.version,
      position: 0,
      title: "Live session",
      description: "Attendance-backed completion.",
      phase: "session",
      releaseAnchor: "occurrence_start",
      releaseOffsetAmount: 0,
      releaseOffsetUnit: "minute",
      createdAt,
    })
    .execute();
  await database
    .insertInto("event_template_version_item")
    .values({
      id: ids.item,
      eventTemplateVersionId: ids.version,
      sectionId: ids.section,
      position: 0,
      kind: "session",
      title: "Automatic attendance session",
      required: true,
      durationMinutes: 60,
      learningActivityVersionId: null,
      sessionDefinitionId: ids.definition,
      createdAt,
    })
    .execute();
  await database
    .insertInto("event_occurrence")
    .values({
      id: ids.occurrence,
      eventTemplateVersionId: ids.version,
      title: "Automatic attendance verification",
      slug: "verify-livekit-automatic-attendance",
      status: "published",
      deliveryMode: "virtual",
      virtualDeliveryProvider: "livekit",
      registrationMode: "required_unrestricted",
      approvalMode: "automatic",
      timezone: "Australia/Sydney",
      localStartsAt: "2030-09-04T11:00:00",
      localEndsAt: "2030-09-04T12:00:00",
      localRegistrationOpensAt: null,
      localRegistrationClosesAt: null,
      localCoordinatorLockAt: null,
      startsAt,
      endsAt,
      registrationOpensAt: null,
      registrationClosesAt: null,
      coordinatorLockAt: null,
      capacity: 20,
      venueName: null,
      venueAddress: null,
      virtualJoinUrl: null,
      priceCents: null,
      salePriceCents: null,
      currency: "AUD",
      bulkPricing: JSON.stringify({ enabled: false, tiers: [] }),
      listInStore: false,
      featured: false,
      openEntryAttendanceMode: "checked_in",
      publishedAt: createdAt,
      createdByUserId: ids.administrator,
      createdAt,
      updatedAt: createdAt,
    })
    .execute();
  await database
    .insertInto("event_admin_assignment")
    .values({
      id: "verify_livekit_attendance_admin_assignment",
      eventOccurrenceId: ids.occurrence,
      userId: ids.administrator,
      source: "occurrence_local",
      assignedByUserId: ids.administrator,
      assignedAt: createdAt,
      endedAt: null,
      endReason: null,
    })
    .execute();
  await database
    .insertInto("event_session")
    .values({
      id: ids.session,
      eventOccurrenceId: ids.occurrence,
      sessionDefinitionId: ids.definition,
      position: 0,
      title: "Automatic attendance session",
      localStartsAt: "2030-09-04T11:00:00",
      localEndsAt: "2030-09-04T12:00:00",
      startsAt,
      endsAt,
      presenterRequired: false,
      venueName: null,
      venueAddress: null,
      virtualJoinUrl: null,
      virtualDeliveryProvider: "livekit",
      livekitAdmissionMode: "automatic",
      livekitAttendanceMode: "automatic_duration",
      livekitAttendanceMinimumMinutes: 15,
      livekitPresenterPreparationMinutes: 30,
      livekitAttendeeRejoinGraceMinutes: 10,
      livekitCapacityHeadroom: 5,
      livekitOpenEntryGuestsAllowed: false,
      livekitRecordingMode: "off",
      livekitRecordingRetentionDays: null,
      livekitAttendeeRecordingNotice: "",
      livekitPresenterRecordingNotice: "",
    })
    .execute();
  await database
    .insertInto("event_registration")
    .values(
      [
        {
          id: ids.firstRegistration,
          userId: ids.firstLearner,
          nameSnapshot: "First attendance learner",
          emailSnapshot: "verify-livekit-attendance-first@example.com",
        },
        {
          id: ids.secondRegistration,
          userId: ids.secondLearner,
          nameSnapshot: "Second attendance learner",
          emailSnapshot: "verify-livekit-attendance-second@example.com",
        },
      ].map((registration) => ({
        ...registration,
        eventOccurrenceId: ids.occurrence,
        eventOccurrenceRegionId: null,
        reviewRoundId: null,
        source: "ordinary" as const,
        eligibilitySource: "unrestricted" as const,
        status: "selected" as const,
        coordinatorPriority: null,
        submittedAt: createdAt,
        coordinatorDecidedAt: null,
        coordinatorDecidedByUserId: null,
        finalDecidedAt: createdAt,
        finalDecidedByUserId: ids.administrator,
        lockedInAt: createdAt,
      })),
    )
    .execute();
  await database
    .insertInto("event_participation")
    .values(
      [
        {
          id: ids.firstParticipation,
          userId: ids.firstLearner,
          registrationId: ids.firstRegistration,
          nameSnapshot: "First attendance learner",
          emailSnapshot: "verify-livekit-attendance-first@example.com",
        },
        {
          id: ids.secondParticipation,
          userId: ids.secondLearner,
          registrationId: ids.secondRegistration,
          nameSnapshot: "Second attendance learner",
          emailSnapshot: "verify-livekit-attendance-second@example.com",
        },
      ].map((participation) => ({
        ...participation,
        eventOccurrenceId: ids.occurrence,
        mode: "registered" as const,
        detailsSubmittedAt: createdAt,
        joinDisclosedAt: createdAt,
        checkedInAt: null,
        createdAt,
      })),
    )
    .execute();
  await database
    .insertInto("event_virtual_room")
    .values({
      id: ids.room,
      eventSessionId: ids.session,
      provider: "livekit",
      generation: 1,
      providerRoomName: roomName,
      providerRoomSid: "RM_VERIFY_ATTENDANCE",
      doorState: "open",
      admissionMode: "automatic",
      attendanceMode: "automatic_duration",
      attendanceMinimumMinutes: 15,
      recordingMode: "off",
      recordingRetentionDays: null,
      maxParticipants: 25,
      providerStatus: "ready",
      providerErrorCode: null,
      createdByUserId: ids.administrator,
      createdAt,
      startedByUserId: ids.administrator,
      startedAt: startsAt,
      lockedByUserId: null,
      lockedAt: null,
      reopenedByUserId: null,
      reopenedAt: null,
      endedByUserId: null,
      endedAt: null,
      replacesRoomId: null,
      replacedByUserId: null,
      replacedAt: null,
    })
    .execute();
  const access = await database.transaction().execute((transaction) =>
    ensureEventVirtualJoinAccess(transaction, {
      eventOccurrenceId: ids.occurrence,
      eventSessionId: ids.session,
      roomGeneration: 1,
      actorUserId: ids.administrator,
      now: createdAt,
    }),
  );
  await database
    .insertInto("event_virtual_lobby_entry")
    .values([
      {
        id: ids.firstLobby,
        eventVirtualJoinAccessId: access.id,
        eventOccurrenceId: ids.occurrence,
        eventSessionId: ids.session,
        roomGeneration: 1,
        eventParticipationId: ids.firstParticipation,
        participantIdentityDigest: eventVirtualAttendeeIdentityDigest(
          ids.room,
          ids.firstParticipation,
        ),
        state: "token_issued",
        accessMethod: "authenticated",
        requestedAt: createdAt,
        admittedAt: createdAt,
        admittedByUserId: ids.administrator,
        declinedAt: null,
        declinedByUserId: null,
        revokedAt: null,
        revokedByUserId: null,
        firstTokenIssuedAt: startsAt,
        recordingAcknowledgedAt: null,
        recordingNoticeDigest: null,
        firstConnectedAt: null,
        lastSeenAt: null,
        leftAt: null,
        updatedAt: startsAt,
      },
      {
        id: ids.secondLobby,
        eventVirtualJoinAccessId: access.id,
        eventOccurrenceId: ids.occurrence,
        eventSessionId: ids.session,
        roomGeneration: 1,
        eventParticipationId: ids.secondParticipation,
        participantIdentityDigest: eventVirtualAttendeeIdentityDigest(
          ids.room,
          ids.secondParticipation,
        ),
        state: "token_issued",
        accessMethod: "authenticated",
        requestedAt: createdAt,
        admittedAt: createdAt,
        admittedByUserId: ids.administrator,
        declinedAt: null,
        declinedByUserId: null,
        revokedAt: null,
        revokedByUserId: null,
        firstTokenIssuedAt: startsAt,
        recordingAcknowledgedAt: null,
        recordingNoticeDigest: null,
        firstConnectedAt: null,
        lastSeenAt: null,
        leftAt: null,
        updatedAt: startsAt,
      },
    ])
    .execute();
  provider.participants.set(roomName, [
    {
      sid: "PA_VERIFY_ATTENDANCE_FIRST",
      identity: eventVirtualAttendeeIdentity(ids.room, ids.firstParticipation),
      displayName: "First attendance learner",
    },
    {
      sid: "PA_VERIFY_ATTENDANCE_SECOND",
      identity: eventVirtualAttendeeIdentity(ids.room, ids.secondParticipation),
      displayName: "Second attendance learner",
    },
  ]);
  await database.transaction().execute(async (transaction) => {
    await ensureEventVirtualAttendanceReconciliation(
      transaction,
      ids.room,
      startsAt,
    );
  });
  const listParticipantsWithoutRace = provider.listParticipants.bind(provider);
  let injectedConcurrentWebhook = false;
  provider.listParticipants = async (providerRoomName) => {
    const snapshot = await listParticipantsWithoutRace(providerRoomName);
    if (!injectedConcurrentWebhook) {
      injectedConcurrentWebhook = true;
      const concurrentJoin: VerifiedLiveKitWebhook = {
        providerEnvironment: "test",
        providerEventId: "EV_VERIFY_ATTENDANCE_CONCURRENT_JOIN",
        event: "participant_joined",
        createdAtSeconds: Math.floor(startsAt.getTime() / 1_000),
        payloadDigest: "b".repeat(64),
        roomSid: "RM_VERIFY_ATTENDANCE",
        roomName,
        participantSid: "PA_VERIFY_ATTENDANCE_CONCURRENT",
        participantIdentity: eventVirtualAttendeeIdentity(
          ids.room,
          ids.firstParticipation,
        ),
      };
      assert.equal(
        (
          await ingestVerifiedLiveKitParticipantWebhook(
            concurrentJoin,
            database,
            { ...getServerEnv(), LIVEKIT_PROJECT_ENVIRONMENT: "test" },
            () => startsAt,
          )
        ).status,
        "processed",
      );
    }
    return snapshot;
  };
  assert.deepEqual(
    await processAvailableEventVirtualAttendanceReconciliations(1, {
      database,
      provider,
      now: startsAt,
    }),
    { outcomes: [], limitReached: false },
    "A provider snapshot must be discarded when newer webhook evidence commits before reconciliation",
  );
  provider.listParticipants = listParticipantsWithoutRace;
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_connection_interval")
      .select(["joinedSource", "leftAt", "leftSource"])
      .where("roomId", "=", ids.room)
      .where("providerParticipantSid", "=", "PA_VERIFY_ATTENDANCE_CONCURRENT")
      .executeTakeFirstOrThrow(),
    { joinedSource: "webhook", leftAt: null, leftSource: null },
    "Stale provider absence must not close a concurrently committed webhook interval",
  );
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_attendance_reconciliation")
      .select(["status", "evidenceRevision", "reconciledRevision"])
      .where("roomId", "=", ids.room)
      .executeTakeFirstOrThrow(),
    { status: "pending", evidenceRevision: 1, reconciledRevision: 0 },
    "Newer evidence must remain pending for a fresh provider snapshot",
  );
  provider.participants.set(roomName, [
    ...(provider.participants.get(roomName) ?? []),
    {
      sid: "PA_VERIFY_ATTENDANCE_CONCURRENT",
      identity: eventVirtualAttendeeIdentity(ids.room, ids.firstParticipation),
      displayName: "First attendance learner reconnect",
    },
  ]);
  assert.deepEqual(
    await processAvailableEventVirtualAttendanceReconciliations(1, {
      database,
      provider,
      now: startsAt,
    }),
    {
      outcomes: [{ status: "pending", roomId: ids.room }],
      limitReached: true,
    },
  );
  assert.deepEqual(
    await database
      .selectFrom("event_attendance")
      .select(["eventParticipationId", "state", "source"])
      .where("eventSessionId", "=", ids.session)
      .orderBy("eventParticipationId")
      .execute(),
    [],
    "Intervals with no elapsed overlap must not create check-in evidence",
  );
  assert.deepEqual(
    await processAvailableEventVirtualAttendanceReconciliations(1, {
      database,
      provider,
      now: new Date(startsAt.getTime() + 30_000),
    }),
    {
      outcomes: [{ status: "pending", roomId: ids.room }],
      limitReached: true,
    },
  );
  assert.deepEqual(
    await database
      .selectFrom("event_attendance")
      .select(["eventParticipationId", "state", "source"])
      .where("eventSessionId", "=", ids.session)
      .orderBy("eventParticipationId")
      .execute(),
    [
      {
        eventParticipationId: ids.firstParticipation,
        state: "checked_in",
        source: "system",
      },
      {
        eventParticipationId: ids.secondParticipation,
        state: "checked_in",
        source: "system",
      },
    ],
  );
  assert.equal(
    await isEventVirtualAttendanceReconciliationComplete(database, ids.room),
    false,
  );
  assert.equal(
    await recordAdminEventAttendance(
      {
        eventOccurrenceId: ids.occurrence,
        eventSessionId: ids.session,
        eventParticipationId: ids.secondParticipation,
        state: "absent",
      },
      administrator,
    ),
    "recorded",
  );
  provider.participants.set(roomName, [
    {
      sid: "PA_VERIFY_ATTENDANCE_TERMINAL_DISCOVERY",
      identity: eventVirtualAttendeeIdentity(ids.room, ids.secondParticipation),
      displayName: "Second attendance learner terminal discovery",
    },
  ]);
  await database.transaction().execute(async (transaction) => {
    await transaction
      .updateTable("event_virtual_room")
      .set({
        doorState: "ended",
        endedByUserId: ids.administrator,
        endedAt: finalAt,
      })
      .where("id", "=", ids.room)
      .executeTakeFirstOrThrow();
    await wakeEventVirtualAttendanceReconciliation(
      transaction,
      ids.room,
      finalAt,
      false,
    );
  });
  assert.deepEqual(
    await processAvailableEventVirtualAttendanceReconciliations(1, {
      database,
      provider,
      now: finalAt,
    }),
    {
      outcomes: [{ status: "processed", roomId: ids.room }],
      limitReached: true,
    },
  );
  assert.deepEqual(
    await database
      .selectFrom("event_attendance")
      .select(["eventParticipationId", "state", "source"])
      .where("eventSessionId", "=", ids.session)
      .orderBy("eventParticipationId")
      .execute(),
    [
      {
        eventParticipationId: ids.firstParticipation,
        state: "attended",
        source: "system",
      },
      {
        eventParticipationId: ids.secondParticipation,
        state: "absent",
        source: "administrator",
      },
    ],
  );
  assert.deepEqual(
    await database
      .selectFrom("event_participation")
      .select(["id", "completedAt"])
      .where("id", "in", [ids.firstParticipation, ids.secondParticipation])
      .orderBy("id")
      .execute()
      .then((rows) => rows.map((row) => [row.id, Boolean(row.completedAt)])),
    [
      [ids.firstParticipation, true],
      [ids.secondParticipation, false],
    ],
  );
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_attendance_decision")
      .select(["eventParticipationId", "attendanceState", "applicationOutcome"])
      .where("roomId", "=", ids.room)
      .orderBy("eventParticipationId")
      .orderBy("attendanceState")
      .execute(),
    [
      {
        eventParticipationId: ids.firstParticipation,
        attendanceState: "attended",
        applicationOutcome: "applied",
      },
      {
        eventParticipationId: ids.firstParticipation,
        attendanceState: "checked_in",
        applicationOutcome: "applied",
      },
      {
        eventParticipationId: ids.secondParticipation,
        attendanceState: "attended",
        applicationOutcome: "preserved_manual",
      },
      {
        eventParticipationId: ids.secondParticipation,
        attendanceState: "checked_in",
        applicationOutcome: "applied",
      },
    ],
  );
  assert.equal(
    await isEventVirtualAttendanceReconciliationComplete(database, ids.room),
    true,
  );
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_connection_interval")
      .select(["joinedAt", "leftAt", "joinedSource", "leftSource"])
      .where("roomId", "=", ids.room)
      .where(
        "providerParticipantSid",
        "=",
        "PA_VERIFY_ATTENDANCE_TERMINAL_DISCOVERY",
      )
      .executeTakeFirstOrThrow(),
    {
      joinedAt: finalAt,
      leftAt: finalAt,
      joinedSource: "provider_reconciliation",
      leftSource: "room_end",
    },
    "A participant first discovered by terminal reconciliation must produce closed evidence",
  );
  const delayedLeave: VerifiedLiveKitWebhook = {
    providerEnvironment: "test",
    providerEventId: "EV_VERIFY_ATTENDANCE_DELAYED_LEAVE",
    event: "participant_left",
    createdAtSeconds: Math.floor((startsAt.getTime() + 10 * 60_000) / 1_000),
    payloadDigest: "a".repeat(64),
    roomSid: "RM_VERIFY_ATTENDANCE",
    roomName,
    participantSid: "PA_VERIFY_ATTENDANCE_FIRST",
    participantIdentity: eventVirtualAttendeeIdentity(
      ids.room,
      ids.firstParticipation,
    ),
  };
  assert.equal(
    (
      await ingestVerifiedLiveKitParticipantWebhook(
        delayedLeave,
        database,
        { ...getServerEnv(), LIVEKIT_PROJECT_ENVIRONMENT: "test" },
        () => new Date(finalAt.getTime() + 1_000),
      )
    ).status,
    "processed",
  );
  await processAvailableEventVirtualAttendanceReconciliations(1, {
    database,
    provider,
    now: new Date(finalAt.getTime() + 1_000),
  });
  assert.equal(
    await database
      .selectFrom("event_virtual_attendance_decision")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("roomId", "=", ids.room)
      .executeTakeFirstOrThrow()
      .then((row) => row.count),
    4,
    "Rerunning a newer evidence revision must not duplicate decisions",
  );
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_connection_interval")
      .select(["leftAt", "leftSource"])
      .where("roomId", "=", ids.room)
      .where("providerParticipantSid", "=", "PA_VERIFY_ATTENDANCE_FIRST")
      .executeTakeFirstOrThrow(),
    {
      leftAt: new Date(
        Math.floor((startsAt.getTime() + 10 * 60_000) / 1_000) * 1_000,
      ),
      leftSource: "webhook",
    },
    "A delayed signed leave must replace conservative room-end evidence without rewriting the historical decision",
  );
  const attendanceReport = await findAdminEventAttendanceReport({
    eventOccurrenceId: ids.occurrence,
    q: "",
    sessionId: "all",
    state: "all",
    evidence: "all",
    page: 1,
  });
  assert.ok(attendanceReport);
  const firstAttendanceReview = attendanceReport.rows.find(
    (row) =>
      row.eventSessionId === ids.session &&
      row.eventParticipationId === ids.firstParticipation,
  );
  assert.ok(firstAttendanceReview);
  assert.deepEqual(
    {
      state: firstAttendanceReview.state,
      source: firstAttendanceReview.source,
      decisionStates: firstAttendanceReview.decisions.map(
        (decision) => decision.attendanceState,
      ),
      intervalSources: firstAttendanceReview.intervals
        .map(
          (interval) => [interval.joinedSource, interval.leftSource] as const,
        )
        .sort((left, right) => left[0].localeCompare(right[0])),
    },
    {
      state: "attended",
      source: "system",
      decisionStates: ["checked_in", "attended"],
      intervalSources: [
        ["provider_reconciliation", "webhook"],
        ["webhook", "room_end"],
      ],
    },
    "Administrator attendance review must explain system decisions with retained interval sources",
  );
  const correctedAttendanceReview = attendanceReport.rows.find(
    (row) =>
      row.eventSessionId === ids.session &&
      row.eventParticipationId === ids.secondParticipation,
  );
  assert.ok(correctedAttendanceReview);
  assert.equal(correctedAttendanceReview.state, "absent");
  assert.equal(correctedAttendanceReview.source, "administrator");
  assert.ok(
    correctedAttendanceReview.decisions.some(
      (decision) => decision.applicationOutcome === "preserved_manual",
    ),
    "Administrator attendance review must retain automatic evidence without obscuring the staff correction",
  );
  const staffFilteredAttendanceReport = await findAdminEventAttendanceReport({
    eventOccurrenceId: ids.occurrence,
    q: "Second attendance",
    sessionId: ids.session,
    state: "absent",
    evidence: "staff",
    page: 1,
  });
  assert.ok(staffFilteredAttendanceReport);
  assert.deepEqual(
    {
      total: staffFilteredAttendanceReport.pagination.total,
      participations: staffFilteredAttendanceReport.rows.map(
        (row) => row.eventParticipationId,
      ),
    },
    { total: 1, participations: [ids.secondParticipation] },
    "Administrator attendance review filtering and counts must be applied by the database read model",
  );
  const exportedAttendanceReport = await exportAdminEventAttendanceReport(
    ids.occurrence,
    {
      q: "First attendance",
      sessionId: ids.session,
      state: "attended",
      evidence: "automatic",
    },
    administrator,
  );
  assert.ok(exportedAttendanceReport);
  assert.equal(exportedAttendanceReport.rows.length, 1);
  assert.equal(
    exportedAttendanceReport.rows[0]?.eventParticipationId,
    ids.firstParticipation,
  );
  assert.ok(exportedAttendanceReport.rows[0].decisions.length);
  assert.ok(exportedAttendanceReport.rows[0].intervals.length);
  assert.deepEqual(
    await database
      .selectFrom("audit_event")
      .select(["actorUserId", "action", "subjectType", "subjectId", "metadata"])
      .where("action", "=", "event_attendance.report_exported")
      .where("subjectId", "=", ids.occurrence)
      .executeTakeFirstOrThrow(),
    {
      actorUserId: ids.administrator,
      action: "event_attendance.report_exported",
      subjectType: "event_occurrence",
      subjectId: ids.occurrence,
      metadata: {
        format: "csv",
        rowCount: 1,
        searchApplied: true,
        sessionId: ids.session,
        state: "attended",
        evidence: "automatic",
      },
    },
    "Attendance report exports must create durable audit evidence without retaining the search text",
  );
  await database
    .insertInto("event_virtual_attendance_decision")
    .values({
      id: "verify_livekit_attendance_maximum_threshold_decision",
      roomId: ids.room,
      eventVirtualJoinAccessId: access.id,
      eventOccurrenceId: ids.occurrence,
      eventSessionId: ids.session,
      roomGeneration: 1,
      lobbyEntryId: ids.firstLobby,
      eventParticipationId: ids.firstParticipation,
      attendanceState: "checked_in",
      attendanceMode: "automatic_duration",
      attendanceMinimumMinutes: 10_080,
      qualifyingConnectedSeconds: 0,
      calculationVersion: 2,
      decisionAt: new Date(finalAt.getTime() + 2_000),
      applicationOutcome: "already_satisfied",
      previousAttendanceState: "attended",
      previousAttendanceSource: "system",
    })
    .executeTakeFirstOrThrow();
  const retainedIntervalLeave: VerifiedLiveKitWebhook = {
    providerEnvironment: "test",
    providerEventId: "EV_VERIFY_ATTENDANCE_RETAINED_INTERVAL_LEAVE",
    event: "participant_left",
    createdAtSeconds: Math.floor((startsAt.getTime() + 15 * 60_000) / 1_000),
    payloadDigest: "c".repeat(64),
    roomSid: "RM_VERIFY_ATTENDANCE",
    roomName,
    participantSid: "PA_VERIFY_ATTENDANCE_CONCURRENT",
    participantIdentity: eventVirtualAttendeeIdentity(
      ids.room,
      ids.firstParticipation,
    ),
  };
  assert.equal(
    (
      await ingestVerifiedLiveKitParticipantWebhook(
        retainedIntervalLeave,
        database,
        { ...getServerEnv(), LIVEKIT_PROJECT_ENVIRONMENT: "test" },
        () => new Date(finalAt.getTime() + 2_000),
      )
    ).status,
    "processed",
  );
  await downAutomaticAttendanceMigration(database);
  automaticAttendanceMigrationApplied = false;
  await upAutomaticAttendanceMigration(database);
  automaticAttendanceMigrationApplied = true;
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_connection_interval")
      .select(["joinedSource", "leftSource"])
      .where("roomId", "=", ids.room)
      .where("providerParticipantSid", "=", "PA_VERIFY_ATTENDANCE_CONCURRENT")
      .executeTakeFirstOrThrow(),
    {
      joinedSource: "webhook",
      leftSource: "webhook",
    },
    "Automatic-attendance migration must upgrade retained closed webhook intervals",
  );
  console.log(
    "LiveKit automatic attendance verification passed: revision-safe provider reconciliation, generation-bounded and positive-overlap evidence, closed terminal discovery, retained closed-interval upgrades, full threshold range, duration promotion, completion, staff-correction preservation and idempotent reruns.",
  );
} finally {
  if (!automaticAttendanceMigrationApplied) {
    try {
      await upAutomaticAttendanceMigration(database);
      automaticAttendanceMigrationApplied = true;
    } catch {
      // Preserve the original migration failure; the disposable verifier drops
      // its database even when typed cleanup cannot safely run.
    }
  }
  if (automaticAttendanceMigrationApplied) await cleanUp();
  await destroyDatabase();
}
