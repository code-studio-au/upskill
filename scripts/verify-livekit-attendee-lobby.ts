import assert from "node:assert/strict";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { destroyDatabase, getDatabase } from "#/server/db/database.server";
import { ensureEventVirtualJoinAccess } from "#/server/events/event-virtual-join-access.server";
import {
  acknowledgeEventVirtualRecording,
  issueEventVirtualAttendeeCredential,
  mutateEventVirtualLobbyAdmission,
  requestEventVirtualRecoveryCode,
  resolveEventVirtualLobby,
  verifyEventVirtualRecoveryCode,
} from "#/server/events/event-virtual-lobby.server";
import {
  findEventVirtualLobbyQueue,
  setEventVirtualRoomAdmissionMode,
} from "#/server/events/event-virtual-room.server";
import { FakeLiveKitProvider } from "#/server/livekit/livekit-provider.fake";
import type { CreateLiveKitJoinTokenInput } from "#/server/livekit/livekit-provider.server";

class MutatingJoinProvider extends FakeLiveKitProvider {
  constructor(private readonly mutation: () => Promise<void>) {
    super();
  }

  override async createJoinToken(input: CreateLiveKitJoinTokenInput) {
    const credential = await super.createJoinToken(input);
    await this.mutation();
    return credential;
  }
}

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
  survey: "verify_livekit_lobby_survey",
  surveyVersion: "verify_livekit_lobby_survey_version",
  questionnaireAssignment: "verify_livekit_lobby_questionnaire_assignment",
  secondQuestionnaireAssignment:
    "verify_livekit_lobby_second_questionnaire_assignment",
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
    .insertInto("learning_activity")
    .values({
      id: ids.survey,
      kind: "survey",
      title: "Lobby registration questionnaire",
      surveyUsage: "registration",
      surveyType: "registration",
      surveyPosition: 0,
      createdAt,
    })
    .execute();
  await database
    .insertInto("learning_activity_version")
    .values({
      id: ids.surveyVersion,
      activityId: ids.survey,
      kind: "survey",
      version: 1,
      publishedAt: createdAt,
      createdAt,
    })
    .execute();
  await database
    .insertInto("survey_version")
    .values({ id: ids.surveyVersion, content: { sections: [] } })
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
  assert.deepEqual(
    await issueEventVirtualAttendeeCredential(access.publicReference, null, {
      joinSessionToken: "x".repeat(43),
    }),
    { status: "unauthenticated" },
    "An expired attendee actor must remain distinguishable from revoked admission",
  );
  await database
    .updateTable("event_template_version")
    .set({ registrationSurveyVersionId: ids.surveyVersion })
    .where("id", "=", ids.version)
    .executeTakeFirstOrThrow();
  await database
    .insertInto("registration_questionnaire_assignment")
    .values({
      id: ids.questionnaireAssignment,
      userId: learner.id,
      surveyVersionId: ids.surveyVersion,
      eventOccurrenceId: ids.occurrence,
      eventOccurrenceRegionId: null,
      enrollmentId: null,
      status: "assigned",
      assignedAt: createdAt,
      startedAt: null,
      completedAt: null,
      waivedAt: null,
      waivedByUserId: null,
      waiverReason: null,
    })
    .execute();
  const questionnaireRequired = await resolveEventVirtualLobby(
    access.publicReference,
    learner,
  );
  assert.equal(questionnaireRequired.status, "ready");
  assert.equal(questionnaireRequired.data.outcome, "questionnaire_required");
  assert.equal(
    questionnaireRequired.data.questionnaireUrl,
    `/my-events/${ids.occurrence}`,
  );
  assert.equal(questionnaireRequired.data.eventOccurrenceId, ids.occurrence);
  await database
    .updateTable("registration_questionnaire_assignment")
    .set({ status: "completed", startedAt: createdAt, completedAt: createdAt })
    .where("id", "=", ids.questionnaireAssignment)
    .executeTakeFirstOrThrow();
  await database
    .insertInto("registration_questionnaire_assignment")
    .values({
      id: ids.secondQuestionnaireAssignment,
      userId: secondLearner.id,
      surveyVersionId: ids.surveyVersion,
      eventOccurrenceId: ids.occurrence,
      eventOccurrenceRegionId: null,
      enrollmentId: null,
      status: "completed",
      assignedAt: createdAt,
      startedAt: createdAt,
      completedAt: createdAt,
      waivedAt: null,
      waivedByUserId: null,
      waiverReason: null,
    })
    .execute();
  const early = await resolveEventVirtualLobby(access.publicReference, learner);
  assert.equal(
    early.status === "ready" ? early.data.outcome : null,
    "meeting_not_started",
  );
  assert.equal(
    early.status === "ready" ? early.data.admissionState : null,
    "waiting",
  );
  const expiredUnstarted = await resolveEventVirtualLobby(
    access.publicReference,
    learner,
    { clock: () => endsAt },
  );
  assert.equal(
    expiredUnstarted.status === "ready" ? expiredUnstarted.data.outcome : null,
    "ended",
  );
  assert.equal(
    expiredUnstarted.status === "ready"
      ? expiredUnstarted.data.pollAfterMilliseconds
      : 1,
    null,
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
  const tokenIssuedEntry = await database
    .selectFrom("event_virtual_lobby_entry")
    .select(["id", "state", "admittedByUserId"])
    .where("eventParticipationId", "=", ids.participation)
    .executeTakeFirstOrThrow();
  const tokenIssuedAuditCount = await database
    .selectFrom("audit_event")
    .select((expression) => expression.fn.countAll<string>().as("count"))
    .where("subjectId", "=", tokenIssuedEntry.id)
    .where("action", "=", "event_virtual_lobby.admission_changed")
    .executeTakeFirstOrThrow()
    .then((row) => Number(row.count));
  assert.deepEqual(
    await mutateEventVirtualLobbyAdmission(
      {
        eventOccurrenceId: ids.occurrence,
        eventSessionId: ids.session,
        lobbyEntryId: tokenIssuedEntry.id,
        action: "admit",
      },
      administrator,
    ),
    { status: "ready" },
  );
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_lobby_entry")
      .select(["state", "admittedByUserId"])
      .where("id", "=", tokenIssuedEntry.id)
      .executeTakeFirstOrThrow(),
    {
      state: tokenIssuedEntry.state,
      admittedByUserId: tokenIssuedEntry.admittedByUserId,
    },
    "A repeated admit must preserve token-issued lifecycle evidence",
  );
  assert.equal(
    await database
      .selectFrom("audit_event")
      .select((expression) => expression.fn.countAll<string>().as("count"))
      .where("subjectId", "=", tokenIssuedEntry.id)
      .where("action", "=", "event_virtual_lobby.admission_changed")
      .executeTakeFirstOrThrow()
      .then((row) => Number(row.count)),
    tokenIssuedAuditCount,
  );
  await database
    .updateTable("event_virtual_lobby_entry")
    .set({
      state: "connected",
      firstConnectedAt: createdAt,
      lastSeenAt: createdAt,
      updatedAt: createdAt,
    })
    .where("id", "=", tokenIssuedEntry.id)
    .executeTakeFirstOrThrow();
  const connectedQueueRevision = await database
    .selectFrom("event_virtual_join_access")
    .select("lobbyRevision")
    .where("id", "=", access.id)
    .executeTakeFirstOrThrow();
  assert.equal(
    (
      await issueEventVirtualAttendeeCredential(
        access.publicReference,
        learner,
        {
          provider: new FakeLiveKitProvider(),
          websocketUrl: "wss://verify.example.com",
        },
      )
    ).status,
    "ready",
  );
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_lobby_entry")
      .select(["state", "firstConnectedAt"])
      .where("id", "=", tokenIssuedEntry.id)
      .executeTakeFirstOrThrow(),
    { state: "connected", firstConnectedAt: createdAt },
    "Refreshing a credential must preserve connected lifecycle evidence",
  );
  assert.equal(
    await database
      .selectFrom("event_virtual_join_access")
      .select("lobbyRevision")
      .where("id", "=", access.id)
      .executeTakeFirstOrThrow()
      .then((row) => row.lobbyRevision),
    connectedQueueRevision.lobbyRevision,
    "A credential refresh without a queue-visible transition must not advance the queue revision",
  );
  const rejoinNow = new Date();
  const recentLeave = new Date(rejoinNow.getTime() - 60_000);
  await database
    .updateTable("event_virtual_lobby_entry")
    .set({
      state: "left",
      firstConnectedAt: new Date(rejoinNow.getTime() - 2 * 60_000),
      lastSeenAt: recentLeave,
      leftAt: recentLeave,
      updatedAt: rejoinNow,
    })
    .where("id", "=", tokenIssuedEntry.id)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("event_virtual_room")
    .set({
      doorState: "locked",
      lockedAt: rejoinNow,
      lockedByUserId: administrator.id,
    })
    .where("id", "=", ids.room)
    .executeTakeFirstOrThrow();
  const graceRejoin = await resolveEventVirtualLobby(
    access.publicReference,
    learner,
    { clock: () => rejoinNow },
  );
  assert.equal(
    graceRejoin.status === "ready" ? graceRejoin.data.outcome : null,
    "ready_to_join",
    "A previously connected attendee may rejoin a locked room during the configured grace period",
  );
  assert.equal(
    (
      await issueEventVirtualAttendeeCredential(
        access.publicReference,
        learner,
        {
          provider: new FakeLiveKitProvider(),
          websocketUrl: "wss://verify.example.com",
        },
      )
    ).status,
    "ready",
  );
  const expiredLeave = new Date(rejoinNow.getTime() - 11 * 60_000);
  await database
    .updateTable("event_virtual_lobby_entry")
    .set({ state: "left", lastSeenAt: expiredLeave, leftAt: expiredLeave })
    .where("id", "=", tokenIssuedEntry.id)
    .executeTakeFirstOrThrow();
  const expiredGrace = await resolveEventVirtualLobby(
    access.publicReference,
    learner,
    { clock: () => rejoinNow },
  );
  assert.equal(
    expiredGrace.status === "ready" ? expiredGrace.data.outcome : null,
    "locked",
  );
  await database
    .updateTable("event_virtual_room")
    .set({
      doorState: "open",
      reopenedAt: rejoinNow,
      reopenedByUserId: administrator.id,
    })
    .where("id", "=", ids.room)
    .executeTakeFirstOrThrow();
  assert.equal(
    (
      await issueEventVirtualAttendeeCredential(
        access.publicReference,
        learner,
        {
          provider: new FakeLiveKitProvider(),
          websocketUrl: "wss://verify.example.com",
        },
      )
    ).status,
    "ready",
    "Reopening the door must restore normal admitted attendee token issuance",
  );
  await database
    .insertInto("event_presenter_assignment")
    .values({
      id: "verify_livekit_lobby_presenter_assignment",
      eventOccurrenceId: ids.occurrence,
      eventSessionId: ids.session,
      userId: secondLearner.id,
      scopeKey: ids.session,
      source: "occurrence_local",
      assignedByUserId: administrator.id,
      assignedAt: createdAt,
      endedAt: null,
      endReason: null,
    })
    .execute();
  await database
    .updateTable("event_presenter_assignment")
    .set({ endedAt: new Date(), endReason: "assignment_ended" })
    .where("id", "=", "verify_livekit_lobby_presenter_assignment")
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    await mutateEventVirtualLobbyAdmission(
      {
        eventOccurrenceId: ids.occurrence,
        eventSessionId: ids.session,
        lobbyEntryId: tokenIssuedEntry.id,
        action: "revoke",
      },
      secondLearner,
    ),
    { status: "forbidden" },
  );
  await database
    .updateTable("event_session")
    .set({
      livekitRecordingMode: "automatic",
      livekitRecordingRetentionDays: 30,
      livekitAttendeeRecordingNotice: "This webinar is recorded.",
      livekitPresenterRecordingNotice: "This webinar is recorded.",
    })
    .where("id", "=", ids.session)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("event_virtual_room")
    .set({
      recordingMode: "automatic",
      recordingRetentionDays: 30,
      doorState: "ended",
      endedAt: new Date(),
      endedByUserId: administrator.id,
    })
    .where("id", "=", ids.room)
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    await acknowledgeEventVirtualRecording(access.publicReference, learner),
    { status: "conflict", reason: "session_ended" },
  );
  assert.equal(
    await database
      .selectFrom("event_virtual_lobby_entry")
      .select("recordingAcknowledgedAt")
      .where("id", "=", tokenIssuedEntry.id)
      .executeTakeFirstOrThrow()
      .then((row) => row.recordingAcknowledgedAt),
    null,
  );
  await database
    .updateTable("event_virtual_room")
    .set({ doorState: "open", endedAt: null, endedByUserId: null })
    .where("id", "=", ids.room)
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    await acknowledgeEventVirtualRecording(access.publicReference, learner),
    { status: "ready" },
  );
  const acknowledgement = await database
    .selectFrom("event_virtual_lobby_entry")
    .select(["recordingAcknowledgedAt", "recordingNoticeDigest"])
    .where("id", "=", tokenIssuedEntry.id)
    .executeTakeFirstOrThrow();
  assert.ok(acknowledgement.recordingAcknowledgedAt);
  assert.ok(acknowledgement.recordingNoticeDigest);
  await database
    .updateTable("event_virtual_lobby_entry")
    .set({ recordingAcknowledgedAt: createdAt, updatedAt: createdAt })
    .where("id", "=", tokenIssuedEntry.id)
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    await acknowledgeEventVirtualRecording(access.publicReference, learner),
    { status: "ready" },
  );
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_lobby_entry")
      .select(["recordingAcknowledgedAt", "recordingNoticeDigest", "updatedAt"])
      .where("id", "=", tokenIssuedEntry.id)
      .executeTakeFirstOrThrow(),
    {
      recordingAcknowledgedAt: createdAt,
      recordingNoticeDigest: acknowledgement.recordingNoticeDigest,
      updatedAt: createdAt,
    },
    "Replayed acknowledgement must preserve the original consent evidence",
  );
  await database
    .updateTable("event_virtual_room")
    .set({ recordingMode: "off", recordingRetentionDays: null })
    .where("id", "=", ids.room)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("event_session")
    .set({
      livekitRecordingMode: "off",
      livekitRecordingRetentionDays: null,
      livekitAttendeeRecordingNotice: "",
      livekitPresenterRecordingNotice: "",
    })
    .where("id", "=", ids.session)
    .executeTakeFirstOrThrow();

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

  const bulkLearners = Array.from({ length: 501 }, (_, index) => ({
    id: `verify_livekit_lobby_bulk_learner_${String(index).padStart(3, "0")}`,
    name: `Bulk learner ${String(index + 1)}`,
    email: `verify_livekit_lobby_bulk_${String(index)}@example.com`,
  }));
  await database
    .updateTable("event_occurrence")
    .set({ capacity: 600 })
    .where("id", "=", ids.occurrence)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("event_virtual_room")
    .set({ maxParticipants: 605 })
    .where("id", "=", ids.room)
    .executeTakeFirstOrThrow();
  await database
    .insertInto("user")
    .values(
      bulkLearners.map((item) => ({
        ...item,
        emailVerified: true,
        emailEnabled: true,
        image: null,
        stripeCustomerId: null,
      })),
    )
    .execute();
  const bulkRequestedAt = new Date(Date.now() - 10_000);
  await database
    .insertInto("event_registration")
    .values(
      bulkLearners.map((item) => ({
        id: `verify_livekit_lobby_bulk_registration_${item.id}`,
        eventOccurrenceId: ids.occurrence,
        userId: item.id,
        eventOccurrenceRegionId: null,
        reviewRoundId: null,
        nameSnapshot: item.name,
        emailSnapshot: item.email,
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
      bulkLearners.map((item) => ({
        id: `verify_livekit_lobby_bulk_participation_${item.id}`,
        eventOccurrenceId: ids.occurrence,
        userId: item.id,
        registrationId: `verify_livekit_lobby_bulk_registration_${item.id}`,
        mode: "registered" as const,
        nameSnapshot: item.name,
        emailSnapshot: item.email,
        detailsSubmittedAt: createdAt,
        joinDisclosedAt: null,
        checkedInAt: null,
        createdAt,
      })),
    )
    .execute();
  await database
    .insertInto("registration_questionnaire_assignment")
    .values(
      bulkLearners.map((item) => ({
        id: `verify_livekit_lobby_bulk_questionnaire_${item.id}`,
        userId: item.id,
        surveyVersionId: ids.surveyVersion,
        eventOccurrenceId: ids.occurrence,
        eventOccurrenceRegionId: null,
        enrollmentId: null,
        status: "completed" as const,
        assignedAt: createdAt,
        startedAt: createdAt,
        completedAt: createdAt,
        waivedAt: null,
        waivedByUserId: null,
        waiverReason: null,
      })),
    )
    .execute();
  await database
    .insertInto("event_virtual_lobby_entry")
    .values(
      bulkLearners.map((item, index) => ({
        id: `verify_livekit_lobby_bulk_entry_${item.id}`,
        eventVirtualJoinAccessId: access.id,
        eventOccurrenceId: ids.occurrence,
        eventSessionId: ids.session,
        roomGeneration: 1,
        eventParticipationId: `verify_livekit_lobby_bulk_participation_${item.id}`,
        state: "waiting" as const,
        accessMethod: "authenticated" as const,
        requestedAt: new Date(bulkRequestedAt.getTime() + index),
        admittedAt: null,
        admittedByUserId: null,
        declinedAt: null,
        declinedByUserId: null,
        revokedAt: null,
        revokedByUserId: null,
        firstTokenIssuedAt: null,
        recordingAcknowledgedAt: null,
        recordingNoticeDigest: null,
        firstConnectedAt: null,
        lastSeenAt: null,
        leftAt: null,
        updatedAt: new Date(bulkRequestedAt.getTime() + index),
      })),
    )
    .execute();
  const firstQueuePage = await findEventVirtualLobbyQueue(
    ids.occurrence,
    ids.session,
    administrator.id,
    0,
  );
  assert.equal(firstQueuePage.status, "ready");
  assert.equal(firstQueuePage.data.entries.length, 50);
  assert.equal(firstQueuePage.data.hasNextPage, true);
  const firstQueueEntry = firstQueuePage.data.entries[0];
  assert.ok(firstQueueEntry);
  const lastQueuePage = await findEventVirtualLobbyQueue(
    ids.occurrence,
    ids.session,
    administrator.id,
    10,
  );
  assert.equal(lastQueuePage.status, "ready");
  assert.equal(lastQueuePage.data.entries.length, 3);
  assert.equal(lastQueuePage.data.hasNextPage, false);
  await database
    .insertInto("event_admin_assignment")
    .values({
      id: "verify_livekit_lobby_assignment_only_admin",
      eventOccurrenceId: ids.occurrence,
      userId: secondLearner.id,
      source: "occurrence_local",
      assignedByUserId: administrator.id,
      assignedAt: createdAt,
      endedAt: null,
      endReason: null,
    })
    .execute();
  assert.deepEqual(
    await findEventVirtualLobbyQueue(
      ids.occurrence,
      ids.session,
      secondLearner.id,
      0,
    ),
    { status: "forbidden" },
    "An occurrence assignment must not survive revocation of the Platform Administrator role",
  );
  assert.deepEqual(
    await mutateEventVirtualLobbyAdmission(
      {
        eventOccurrenceId: ids.occurrence,
        eventSessionId: ids.session,
        lobbyEntryId: firstQueueEntry.id,
        action: "admit",
      },
      secondLearner,
    ),
    { status: "forbidden" },
  );
  await database
    .updateTable("event_admin_assignment")
    .set({ endedAt: new Date(), endReason: "assignment_ended" })
    .where("id", "=", "verify_livekit_lobby_assignment_only_admin")
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    await findEventVirtualLobbyQueue(
      ids.occurrence,
      ids.session,
      learner.id,
      0,
    ),
    { status: "forbidden" },
  );
  assert.deepEqual(
    await mutateEventVirtualLobbyAdmission(
      {
        eventOccurrenceId: ids.occurrence,
        eventSessionId: ids.session,
        action: "admit_all",
      },
      administrator,
    ),
    { status: "ready" },
  );
  const changedQueuePage = await findEventVirtualLobbyQueue(
    ids.occurrence,
    ids.session,
    administrator.id,
    0,
  );
  assert.equal(changedQueuePage.status, "ready");
  assert.notEqual(
    changedQueuePage.data.etag,
    firstQueuePage.data.etag,
    "Admission changes must advance the queue revision used to reset remote pages",
  );
  assert.equal(
    await database
      .selectFrom("event_virtual_lobby_entry")
      .select((expression) => expression.fn.countAll<string>().as("count"))
      .where("eventVirtualJoinAccessId", "=", access.id)
      .where("state", "=", "waiting")
      .executeTakeFirstOrThrow()
      .then((row) => Number(row.count)),
    0,
    "Admit all must process eligible attendees beyond the first 500",
  );
  await database
    .updateTable("event_virtual_lobby_entry")
    .set({ state: "waiting", admittedAt: null, admittedByUserId: null })
    .where(
      "id",
      "in",
      bulkLearners.map((item) => `verify_livekit_lobby_bulk_entry_${item.id}`),
    )
    .execute();
  assert.deepEqual(
    await setEventVirtualRoomAdmissionMode(
      ids.occurrence,
      ids.session,
      "automatic",
      administrator,
    ),
    { status: "ready" },
  );
  assert.equal(
    await database
      .selectFrom("event_virtual_lobby_entry")
      .select((expression) => expression.fn.countAll<string>().as("count"))
      .where("eventVirtualJoinAccessId", "=", access.id)
      .where("state", "=", "waiting")
      .executeTakeFirstOrThrow()
      .then((row) => Number(row.count)),
    0,
    "Enabling auto-admit must process eligible attendees beyond the first 500",
  );
  await setEventVirtualRoomAdmissionMode(
    ids.occurrence,
    ids.session,
    "manual",
    administrator,
  );

  await database
    .updateTable("event_virtual_lobby_entry")
    .set({ state: "waiting", admittedAt: null, admittedByUserId: null })
    .where("id", "=", secondEntry.id)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("event_virtual_room")
    .set({
      doorState: "ended",
      endedAt: new Date(),
      endedByUserId: administrator.id,
    })
    .where("id", "=", ids.room)
    .executeTakeFirstOrThrow();
  const admissionAuditCount = await database
    .selectFrom("audit_event")
    .select((expression) => expression.fn.countAll<string>().as("count"))
    .where("subjectId", "=", secondEntry.id)
    .executeTakeFirstOrThrow()
    .then((row) => Number(row.count));
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
    { status: "conflict", reason: "session_ended" },
  );
  assert.deepEqual(
    await mutateEventVirtualLobbyAdmission(
      {
        eventOccurrenceId: ids.occurrence,
        eventSessionId: ids.session,
        action: "admit_all",
      },
      administrator,
    ),
    { status: "conflict", reason: "session_ended" },
  );
  assert.equal(
    await database
      .selectFrom("event_virtual_lobby_entry")
      .select("state")
      .where("id", "=", secondEntry.id)
      .executeTakeFirstOrThrow()
      .then((row) => row.state),
    "waiting",
  );
  assert.equal(
    await database
      .selectFrom("audit_event")
      .select((expression) => expression.fn.countAll<string>().as("count"))
      .where("subjectId", "=", secondEntry.id)
      .executeTakeFirstOrThrow()
      .then((row) => Number(row.count)),
    admissionAuditCount,
  );
  const terminalAnonymous = await resolveEventVirtualLobby(
    access.publicReference,
    null,
  );
  assert.equal(
    terminalAnonymous.status === "ready"
      ? terminalAnonymous.data.outcome
      : null,
    "ended",
  );
  const recoveryCaptureCount = await database
    .selectFrom("event_virtual_recovery_email_capture")
    .select((expression) => expression.fn.countAll<string>().as("count"))
    .executeTakeFirstOrThrow()
    .then((row) => Number(row.count));
  assert.deepEqual(
    await requestEventVirtualRecoveryCode(
      { publicReference: access.publicReference, identifier: learner.email },
      "terminal-session".padEnd(43, "x"),
    ),
    { status: "unavailable" },
  );
  assert.equal(
    await database
      .selectFrom("event_virtual_recovery_email_capture")
      .select((expression) => expression.fn.countAll<string>().as("count"))
      .executeTakeFirstOrThrow()
      .then((row) => Number(row.count)),
    recoveryCaptureCount,
  );
  await database
    .updateTable("event_virtual_room")
    .set({ doorState: "open", endedAt: null, endedByUserId: null })
    .where("id", "=", ids.room)
    .executeTakeFirstOrThrow();

  const terminalChallenge = await requestEventVirtualRecoveryCode(
    { publicReference: access.publicReference, identifier: learner.email },
    "terminal-verification".padEnd(43, "x"),
    { requestLimitStore: new Map() },
  );
  assert.equal(terminalChallenge.status, "accepted");
  assert.ok("challengeReference" in terminalChallenge);
  const terminalChallengeId = await database
    .selectFrom("event_virtual_recovery_challenge")
    .select("id")
    .where("reference", "=", terminalChallenge.challengeReference)
    .executeTakeFirstOrThrow();
  const terminalCode = await database
    .selectFrom("event_virtual_recovery_email_capture")
    .select("textBody")
    .where("challengeId", "=", terminalChallengeId.id)
    .executeTakeFirstOrThrow()
    .then((row) => row.textBody.match(/\b\d{6}\b/u)?.[0]);
  assert.ok(terminalCode);
  await database
    .updateTable("event_virtual_room")
    .set({
      doorState: "ended",
      endedAt: new Date(),
      endedByUserId: administrator.id,
    })
    .where("id", "=", ids.room)
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    await verifyEventVirtualRecoveryCode({
      publicReference: access.publicReference,
      challengeReference: terminalChallenge.challengeReference,
      code: terminalCode,
    }),
    { status: "expired" },
  );
  assert.ok(
    await database
      .selectFrom("event_virtual_recovery_challenge")
      .select("consumedAt")
      .where("id", "=", terminalChallengeId.id)
      .executeTakeFirstOrThrow()
      .then((row) => row.consumedAt),
    "Terminal verification must consume the challenge without issuing a capability",
  );
  assert.equal(
    await database
      .selectFrom("event_virtual_join_session")
      .select((expression) => expression.fn.countAll<string>().as("count"))
      .where("challengeId", "=", terminalChallengeId.id)
      .executeTakeFirstOrThrow()
      .then((row) => Number(row.count)),
    0,
  );
  await database
    .updateTable("event_virtual_room")
    .set({ doorState: "open", endedAt: null, endedByUserId: null })
    .where("id", "=", ids.room)
    .executeTakeFirstOrThrow();

  const challenge = await requestEventVirtualRecoveryCode(
    { publicReference: access.publicReference, identifier: learner.email },
    "v".repeat(43),
  );
  assert.equal(challenge.status, "accepted");
  assert.ok("challengeReference" in challenge);
  const challengeId = await database
    .selectFrom("event_virtual_recovery_challenge")
    .select("id")
    .where("reference", "=", challenge.challengeReference)
    .executeTakeFirstOrThrow();
  const capture = await database
    .selectFrom("event_virtual_recovery_email_capture")
    .select("textBody")
    .where("challengeId", "=", challengeId.id)
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
  const recoveredJoinSession = await database
    .selectFrom("event_virtual_join_session")
    .select("id")
    .where("userId", "=", learner.id)
    .where("revokedAt", "is", null)
    .executeTakeFirstOrThrow();
  const recoveryRace = await issueEventVirtualAttendeeCredential(
    access.publicReference,
    null,
    {
      joinSessionToken: verified.joinSessionToken,
      websocketUrl: "wss://verify.example.com",
      provider: new MutatingJoinProvider(async () => {
        await database
          .updateTable("event_virtual_join_session")
          .set({ revokedAt: new Date() })
          .where("id", "=", recoveredJoinSession.id)
          .executeTakeFirstOrThrow();
      }),
    },
  );
  assert.deepEqual(recoveryRace, { status: "conflict", reason: "revoked" });
  await database
    .updateTable("event_virtual_join_session")
    .set({ revokedAt: null })
    .where("id", "=", recoveredJoinSession.id)
    .executeTakeFirstOrThrow();
  const occurrenceRace = await issueEventVirtualAttendeeCredential(
    access.publicReference,
    learner,
    {
      websocketUrl: "wss://verify.example.com",
      provider: new MutatingJoinProvider(async () => {
        await database
          .updateTable("event_occurrence")
          .set({ status: "cancelled" })
          .where("id", "=", ids.occurrence)
          .executeTakeFirstOrThrow();
      }),
    },
  );
  assert.deepEqual(occurrenceRace, { status: "conflict", reason: "revoked" });
  await database
    .updateTable("event_occurrence")
    .set({ status: "published" })
    .where("id", "=", ids.occurrence)
    .executeTakeFirstOrThrow();
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
    .updateTable("event_virtual_lobby_entry")
    .set({ admittedByUserId: administrator.id })
    .where("eventParticipationId", "=", ids.participation)
    .executeTakeFirstOrThrow();
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
  await database
    .updateTable("event_registration")
    .set({ status: "selected", lockedInAt: new Date() })
    .where("id", "=", ids.registration)
    .executeTakeFirstOrThrow();
  const restoredAuthenticated = await resolveEventVirtualLobby(
    access.publicReference,
    learner,
  );
  assert.equal(
    restoredAuthenticated.status === "ready"
      ? restoredAuthenticated.data.outcome
      : null,
    "waiting_for_admission",
  );
  const restoredEntry = await database
    .selectFrom("event_virtual_lobby_entry")
    .select([
      "id",
      "state",
      "admittedAt",
      "admittedByUserId",
      "revokedAt",
      "revokedByUserId",
    ])
    .where("eventParticipationId", "=", ids.participation)
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    {
      state: restoredEntry.state,
      admittedAt: restoredEntry.admittedAt,
      admittedByUserId: restoredEntry.admittedByUserId,
      revokedAt: restoredEntry.revokedAt,
      revokedByUserId: restoredEntry.revokedByUserId,
    },
    {
      state: "waiting",
      admittedAt: null,
      admittedByUserId: null,
      revokedAt: null,
      revokedByUserId: null,
    },
    "Manual eligibility restoration must clear the current admission metadata",
  );
  const restoredAudit = await database
    .selectFrom("audit_event")
    .select("metadata")
    .where("action", "=", "event_virtual_lobby.admission_changed")
    .where("subjectId", "=", restoredEntry.id)
    .orderBy("createdAt", "desc")
    .executeTakeFirstOrThrow();
  assert.match(
    JSON.stringify(restoredAudit.metadata),
    /"action":"reactivate"/u,
  );
  await database
    .updateTable("event_registration")
    .set({ status: "cancelled", lockedInAt: null })
    .where("id", "=", ids.registration)
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    await setEventVirtualRoomAdmissionMode(
      ids.occurrence,
      ids.session,
      "automatic",
      administrator,
    ),
    { status: "ready" },
  );
  assert.equal(
    await database
      .selectFrom("event_virtual_lobby_entry")
      .select("state")
      .where("id", "=", restoredEntry.id)
      .executeTakeFirstOrThrow()
      .then((row) => row.state),
    "waiting",
    "Automatic admission must skip a currently ineligible waiting entry",
  );
  await database
    .updateTable("event_registration")
    .set({ status: "selected", lockedInAt: new Date() })
    .where("id", "=", ids.registration)
    .executeTakeFirstOrThrow();
  const automaticRestoration = await resolveEventVirtualLobby(
    access.publicReference,
    learner,
  );
  assert.equal(
    automaticRestoration.status === "ready"
      ? automaticRestoration.data.outcome
      : null,
    "ready_to_join",
    "A re-selected waiting attendee must be reconciled against the locked automatic admission mode",
  );
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_lobby_entry")
      .select(["state", "admittedAt", "admittedByUserId"])
      .where("id", "=", restoredEntry.id)
      .executeTakeFirstOrThrow()
      .then((row) => ({
        state: row.state,
        admitted: Boolean(row.admittedAt),
        admittedByUserId: row.admittedByUserId,
      })),
    { state: "admitted", admitted: true, admittedByUserId: null },
    "Automatic eligibility restoration must record a fresh system admission",
  );
  await setEventVirtualRoomAdmissionMode(
    ids.occurrence,
    ids.session,
    "manual",
    administrator,
  );
  await database
    .updateTable("event_registration")
    .set({ status: "cancelled", lockedInAt: null })
    .where("id", "=", ids.registration)
    .executeTakeFirstOrThrow();
  const revokedAuthenticated = await resolveEventVirtualLobby(
    access.publicReference,
    learner,
  );
  assert.equal(
    revokedAuthenticated.status === "ready"
      ? revokedAuthenticated.data.outcome
      : null,
    "revoked",
  );
  await database
    .updateTable("event_registration")
    .set({ status: "selected", lockedInAt: new Date() })
    .where("id", "=", ids.registration)
    .executeTakeFirstOrThrow();
  const restoredChallenge = await requestEventVirtualRecoveryCode(
    { publicReference: access.publicReference, identifier: learner.email },
    "restored-eligibility".padEnd(43, "x"),
  );
  assert.equal(restoredChallenge.status, "accepted");
  assert.ok("challengeReference" in restoredChallenge);
  const restoredChallengeId = await database
    .selectFrom("event_virtual_recovery_challenge")
    .select("id")
    .where("reference", "=", restoredChallenge.challengeReference)
    .executeTakeFirstOrThrow();
  const restoredCode = await database
    .selectFrom("event_virtual_recovery_email_capture")
    .select("textBody")
    .where("challengeId", "=", restoredChallengeId.id)
    .executeTakeFirstOrThrow()
    .then((row) => row.textBody.match(/\b\d{6}\b/u)?.[0]);
  assert.ok(restoredCode);
  const restoredVerification = await verifyEventVirtualRecoveryCode({
    publicReference: access.publicReference,
    challengeReference: restoredChallenge.challengeReference,
    code: restoredCode,
  });
  assert.equal(restoredVerification.status, "ready");
  assert.ok(restoredVerification.joinSessionToken);
  const restoredRecovery = await resolveEventVirtualLobby(
    access.publicReference,
    null,
    { joinSessionToken: restoredVerification.joinSessionToken },
  );
  assert.equal(
    restoredRecovery.status === "ready" ? restoredRecovery.data.outcome : null,
    "waiting_for_admission",
  );
  assert.deepEqual(
    await mutateEventVirtualLobbyAdmission(
      {
        eventOccurrenceId: ids.occurrence,
        eventSessionId: ids.session,
        lobbyEntryId: restoredEntry.id,
        action: "revoke",
      },
      administrator,
    ),
    { status: "ready" },
  );
  const presenterRevoked = await resolveEventVirtualLobby(
    access.publicReference,
    learner,
  );
  assert.equal(
    presenterRevoked.status === "ready" ? presenterRevoked.data.outcome : null,
    "revoked",
    "An explicit presenter revocation must not be auto-reactivated",
  );
  const failedDelivery = await requestEventVirtualRecoveryCode(
    {
      publicReference: access.publicReference,
      identifier: secondLearner.email,
    },
    "failed-delivery".padEnd(43, "x"),
    {
      sendEmail: () =>
        Promise.reject(new Error("EMAIL_PROVIDER_NOT_CONFIGURED")),
      requestLimitStore: new Map(),
    },
  );
  assert.equal(failedDelivery.status, "accepted");
  assert.ok("challengeReference" in failedDelivery);
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_recovery_challenge")
      .select(["deliveryStatus", "consumedAt"])
      .where("reference", "=", failedDelivery.challengeReference)
      .executeTakeFirstOrThrow()
      .then((row) => ({
        deliveryStatus: row.deliveryStatus,
        consumed: Boolean(row.consumedAt),
      })),
    { deliveryStatus: "failed", consumed: true },
  );
  const distributedRequests = await Promise.all(
    Array.from({ length: 4 }, (_, index) => {
      return requestEventVirtualRecoveryCode(
        {
          publicReference: access.publicReference,
          identifier: secondLearner.email,
        },
        `distributed-${String(index)}`.padEnd(43, "x"),
        { requestLimitStore: new Map() },
      );
    }),
  );
  assert.deepEqual(
    distributedRequests.map((result) => result.status).toSorted(),
    ["accepted", "accepted", "accepted", "accepted"],
    "Durable throttling must remain externally indistinguishable from an unknown identifier",
  );
  assert.equal(
    new Set(
      distributedRequests.flatMap((result) =>
        "challengeReference" in result ? [result.challengeReference] : [],
      ),
    ).size,
    4,
    "Every enumeration-safe response must carry an opaque reference",
  );
  assert.equal(
    await database
      .selectFrom("event_virtual_recovery_challenge")
      .select((expression) => expression.fn.countAll<string>().as("count"))
      .where("userId", "=", secondLearner.id)
      .executeTakeFirstOrThrow()
      .then((row) => Number(row.count)),
    3,
    "Failed delivery history must remain part of the durable rate limit",
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
