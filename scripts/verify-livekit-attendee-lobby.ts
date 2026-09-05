import assert from "node:assert/strict";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { destroyDatabase, getDatabase } from "#/server/db/database.server";
import { ensureEventVirtualJoinAccess } from "#/server/events/event-virtual-join-access.server";
import {
  issueEventVirtualAttendeeCredential,
  mutateEventVirtualLobbyAdmission,
  requestEventVirtualRecoveryCode,
  resolveEventVirtualLobby,
  verifyEventVirtualRecoveryCode,
} from "#/server/events/event-virtual-lobby.server";
import { setEventVirtualRoomAdmissionMode } from "#/server/events/event-virtual-room.server";
import { FakeLiveKitProvider } from "#/server/livekit/livekit-provider.fake";

const ids = {
  administrator: "verify_livekit_lobby_administrator",
  learner: "verify_livekit_lobby_learner",
  secondLearner: "verify_livekit_lobby_second_learner",
  template: "verify_livekit_lobby_template",
  version: "verify_livekit_lobby_version",
  definition: "verify_livekit_lobby_definition",
  occurrence: "verify_livekit_lobby_occurrence",
  session: "verify_livekit_lobby_session",
  room: "verify_livekit_lobby_room",
  registration: "verify_livekit_lobby_registration",
  secondRegistration: "verify_livekit_lobby_second_registration",
  participation: "verify_livekit_lobby_participation",
  secondParticipation: "verify_livekit_lobby_second_participation",
};

function authenticatedUser(id: string, name: string): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@example.com`,
    emailVerified: true,
  };
}

const administrator = authenticatedUser(
  ids.administrator,
  "Lobby administrator",
);
const learner = authenticatedUser(ids.learner, "Lobby learner");
const secondLearner = authenticatedUser(
  ids.secondLearner,
  "Second lobby learner",
);
const createdAt = new Date("2030-09-04T00:00:00.000Z");
const startsAt = new Date("2030-09-04T01:00:00.000Z");
const endsAt = new Date("2030-09-04T02:00:00.000Z");
const database = getDatabase();

try {
  await database
    .insertInto("user")
    .values(
      [administrator, learner, secondLearner].map((item) => ({
        id: item.id,
        name: item.name,
        email: item.email,
        emailVerified: true,
        emailEnabled: true,
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
    .insertInto("event_template")
    .values({
      id: ids.template,
      title: "Lobby verification",
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
      summary: "Lobby verification.",
      description: "Verifies attendee admission and recovery.",
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
      title: "Lobby session",
      durationMinutes: 60,
      presenterRequired: true,
      livekitAdmissionMode: "manual",
      livekitAttendanceMode: "manual",
      livekitAttendanceMinimumMinutes: null,
      livekitPresenterPreparationMinutes: 60,
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
    .insertInto("event_occurrence")
    .values({
      id: ids.occurrence,
      eventTemplateVersionId: ids.version,
      title: "Lobby verification",
      slug: "verify-livekit-attendee-lobby",
      status: "published",
      deliveryMode: "virtual",
      virtualDeliveryProvider: "livekit",
      registrationMode: "required_unrestricted",
      approvalMode: "automatic",
      timezone: "Australia/Sydney",
      localStartsAt: "2030-09-04T11:00:00",
      localEndsAt: "2030-09-04T12:00:00",
      localRegistrationOpensAt: "2030-08-01T10:00:00",
      localRegistrationClosesAt: "2030-09-01T10:00:00",
      localCoordinatorLockAt: null,
      startsAt,
      endsAt,
      registrationOpensAt: new Date("2030-08-01T00:00:00.000Z"),
      registrationClosesAt: new Date("2030-09-01T00:00:00.000Z"),
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
      createdByUserId: administrator.id,
      createdAt,
      updatedAt: createdAt,
    })
    .execute();
  await database
    .insertInto("event_session")
    .values({
      id: ids.session,
      eventOccurrenceId: ids.occurrence,
      sessionDefinitionId: ids.definition,
      position: 0,
      title: "Lobby session",
      localStartsAt: "2030-09-04T11:00:00",
      localEndsAt: "2030-09-04T12:00:00",
      startsAt,
      endsAt,
      presenterRequired: true,
      venueName: null,
      venueAddress: null,
      virtualJoinUrl: null,
      virtualDeliveryProvider: "livekit",
      livekitAdmissionMode: "manual",
      livekitAttendanceMode: "manual",
      livekitAttendanceMinimumMinutes: null,
      livekitPresenterPreparationMinutes: 60,
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
          id: ids.registration,
          eventOccurrenceId: ids.occurrence,
          userId: learner.id,
          nameSnapshot: learner.name,
          emailSnapshot: learner.email,
        },
        {
          id: ids.secondRegistration,
          eventOccurrenceId: ids.occurrence,
          userId: secondLearner.id,
          nameSnapshot: secondLearner.name,
          emailSnapshot: secondLearner.email,
        },
      ].map((registration) => ({
        ...registration,
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
        finalDecidedByUserId: administrator.id,
        lockedInAt: createdAt,
      })),
    )
    .execute();
  await database
    .insertInto("event_participation")
    .values(
      [
        {
          id: ids.participation,
          userId: learner.id,
          registrationId: ids.registration,
          nameSnapshot: learner.name,
          emailSnapshot: learner.email,
        },
        {
          id: ids.secondParticipation,
          userId: secondLearner.id,
          registrationId: ids.secondRegistration,
          nameSnapshot: secondLearner.name,
          emailSnapshot: secondLearner.email,
        },
      ].map((participation) => ({
        ...participation,
        eventOccurrenceId: ids.occurrence,
        mode: "registered" as const,
        detailsSubmittedAt: null,
        joinDisclosedAt: null,
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
      providerRoomName: "event:verify_lobby:g1",
      providerRoomSid: "RM_VERIFY_LOBBY",
      doorState: "scheduled",
      admissionMode: "manual",
      attendanceMode: "manual",
      attendanceMinimumMinutes: null,
      recordingMode: "off",
      recordingRetentionDays: null,
      maxParticipants: 25,
      providerStatus: "ready",
      providerErrorCode: null,
      createdByUserId: administrator.id,
      createdAt,
      startedByUserId: null,
      startedAt: null,
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
  const access = await database.transaction().execute(async (transaction) =>
    ensureEventVirtualJoinAccess(transaction, {
      eventOccurrenceId: ids.occurrence,
      eventSessionId: ids.session,
      roomGeneration: 1,
      actorUserId: administrator.id,
      now: createdAt,
    }),
  );

  const anonymous = await resolveEventVirtualLobby(
    access.publicReference,
    null,
    { joinSessionToken: null },
  );
  assert.equal(
    anonymous.status === "ready" ? anonymous.data.outcome : null,
    "authentication_required",
  );
  const early = await resolveEventVirtualLobby(access.publicReference, learner);
  assert.equal(
    early.status === "ready" ? early.data.outcome : null,
    "meeting_not_started",
  );
  assert.equal(
    early.status === "ready" ? early.data.admissionState : null,
    "waiting",
  );

  await database
    .updateTable("event_virtual_room")
    .set({
      doorState: "open",
      startedAt: createdAt,
      startedByUserId: administrator.id,
    })
    .where("id", "=", ids.room)
    .execute();
  const waitingCredential = await issueEventVirtualAttendeeCredential(
    access.publicReference,
    learner,
    {
      provider: new FakeLiveKitProvider(),
      websocketUrl: "wss://verify.example.com",
    },
  );
  assert.deepEqual(waitingCredential, {
    status: "conflict",
    reason: "waiting_for_admission",
  });

  assert.deepEqual(
    await setEventVirtualRoomAdmissionMode(
      ids.occurrence,
      ids.session,
      "automatic",
      administrator,
    ),
    { status: "ready" },
  );
  const admitted = await resolveEventVirtualLobby(
    access.publicReference,
    learner,
  );
  assert.equal(
    admitted.status === "ready" ? admitted.data.outcome : null,
    "ready_to_join",
  );
  const provider = new FakeLiveKitProvider(() => createdAt);
  const credential = await issueEventVirtualAttendeeCredential(
    access.publicReference,
    learner,
    { provider, websocketUrl: "wss://verify.example.com" },
  );
  assert.equal(credential.status, "ready");
  assert.equal(
    provider.operations.find(
      (operation) => operation.operation === "create_join_token",
    )?.input.role,
    "attendee",
  );

  await setEventVirtualRoomAdmissionMode(
    ids.occurrence,
    ids.session,
    "manual",
    administrator,
  );
  const secondLobby = await resolveEventVirtualLobby(
    access.publicReference,
    secondLearner,
  );
  assert.equal(
    secondLobby.status === "ready" ? secondLobby.data.outcome : null,
    "waiting_for_admission",
  );
  const secondEntry = await database
    .selectFrom("event_virtual_lobby_entry")
    .select("id")
    .where("eventParticipationId", "=", ids.secondParticipation)
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    await mutateEventVirtualLobbyAdmission(
      {
        eventOccurrenceId: ids.occurrence,
        eventSessionId: ids.session,
        lobbyEntryId: secondEntry.id,
        action: "admit",
      },
      administrator,
    ),
    { status: "ready" },
  );

  const challenge = await requestEventVirtualRecoveryCode(
    { publicReference: access.publicReference, identifier: learner.email },
    "v".repeat(43),
  );
  assert.equal(challenge.status, "accepted");
  assert.ok("challengeReference" in challenge);
  const capture = await database
    .selectFrom("event_virtual_recovery_email_capture")
    .select("textBody")
    .executeTakeFirstOrThrow();
  const code = capture.textBody.match(/\b\d{6}\b/u)?.[0];
  assert.ok(code);
  const verified = await verifyEventVirtualRecoveryCode({
    publicReference: access.publicReference,
    challengeReference: challenge.challengeReference,
    code,
  });
  assert.equal(verified.status, "ready");
  assert.ok(verified.joinSessionToken);
  const recovered = await resolveEventVirtualLobby(
    access.publicReference,
    null,
    {
      joinSessionToken: verified.joinSessionToken,
    },
  );
  assert.equal(
    recovered.status === "ready" ? recovered.data.outcome : null,
    "ready_to_join",
  );
  assert.equal(
    (
      await verifyEventVirtualRecoveryCode({
        publicReference: access.publicReference,
        challengeReference: challenge.challengeReference,
        code,
      })
    ).status,
    "expired",
  );
  await database
    .updateTable("event_registration")
    .set({ status: "cancelled", lockedInAt: null })
    .where("id", "=", ids.registration)
    .execute();
  const revokedRecovery = await resolveEventVirtualLobby(
    access.publicReference,
    null,
    { joinSessionToken: verified.joinSessionToken },
  );
  assert.equal(
    revokedRecovery.status === "ready" ? revokedRecovery.data.outcome : null,
    "revoked",
  );
  assert.equal(
    await database
      .selectFrom("event_virtual_join_session")
      .select("revokedAt")
      .executeTakeFirstOrThrow()
      .then((row) => Boolean(row.revokedAt)),
    true,
  );

  const auditRows = await database
    .selectFrom("audit_event")
    .select("metadata")
    .where("subjectId", "like", "event_virtual_%")
    .execute();
  assert.doesNotMatch(JSON.stringify(auditRows), /fake-livekit-token/u);

  const replacement = await database
    .transaction()
    .execute(async (transaction) =>
      ensureEventVirtualJoinAccess(transaction, {
        eventOccurrenceId: ids.occurrence,
        eventSessionId: ids.session,
        roomGeneration: 2,
        actorUserId: administrator.id,
        now: new Date(createdAt.getTime() + 60_000),
      }),
    );
  assert.notEqual(replacement.publicReference, access.publicReference);
  assert.equal(
    (await resolveEventVirtualLobby(access.publicReference, learner)).status,
    "not-found",
  );
  console.log(
    "Verified LiveKit attendee lobby, early waiting, admission, recovery, token scoping and generation revocation",
  );
} finally {
  await destroyDatabase();
}
