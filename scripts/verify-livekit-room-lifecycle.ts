import assert from "node:assert/strict";
import { sql } from "kysely";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { destroyDatabase, getDatabase } from "#/server/db/database.server";
import { getEventOperationsAccess } from "#/server/events/event-operations-access.server";
import {
  checkEventVirtualSessionProviderHealth,
  ensureEventVirtualRoomForStaff,
  findEventVirtualSessionOperations,
  issueEventVirtualPresenterCredential,
  processAvailableEventVirtualRoomOperations,
  replaceEventVirtualRoom,
  setEventVirtualRoomAdmissionMode,
  transitionEventVirtualRoom,
  type VirtualRoomRuntime,
} from "#/server/events/event-virtual-room.server";
import { FakeLiveKitProvider } from "#/server/livekit/livekit-provider.fake";
import {
  type CreateLiveKitJoinTokenInput,
  LiveKitProviderError,
  type EnsureLiveKitRoomInput,
  type LiveKitRoomSnapshot,
} from "#/server/livekit/livekit-provider.server";

const ids = {
  template: "verify_livekit_room_template",
  version: "verify_livekit_room_version",
  definition: "verify_livekit_room_definition",
  occurrence: "verify_livekit_room_occurrence",
  session: "verify_livekit_room_session",
  region: "verify_livekit_room_region",
  occurrenceRegion: "verify_livekit_room_occurrence_region",
  administrator: "verify_livekit_room_administrator",
  presenter: "verify_livekit_room_presenter",
  wholePresenter: "verify_livekit_room_whole_presenter",
  coordinator: "verify_livekit_room_coordinator",
  platformAdministrator: "verify_livekit_room_platform_administrator",
};

function user(id: string, name: string): AuthenticatedUser {
  return {
    id,
    name,
    email: `${id}@example.com`,
    emailVerified: true,
  };
}

const administrator = user(ids.administrator, "Occurrence Administrator");
const presenter = user(ids.presenter, "Exact Session Presenter");
const wholePresenter = user(ids.wholePresenter, "Whole Occurrence Presenter");
const coordinator = user(ids.coordinator, "Regional Coordinator");
const platformAdministrator = user(
  ids.platformAdministrator,
  "Platform Administrator",
);
const startsAt = new Date("2030-09-04T00:00:00.000Z");
const endsAt = new Date("2030-09-04T01:00:00.000Z");
const preparationTime = new Date("2030-09-03T23:30:00.000Z");
class FailFirstEnsureProvider extends FakeLiveKitProvider {
  private failed = false;

  override ensureRoom(
    input: EnsureLiveKitRoomInput,
  ): Promise<LiveKitRoomSnapshot> {
    if (!this.failed) {
      this.failed = true;
      return Promise.reject(new LiveKitProviderError("ensure_room"));
    }
    return super.ensureRoom(input);
  }
}

class InvalidatingJoinProvider extends FakeLiveKitProvider {
  constructor(private readonly invalidate: () => Promise<void>) {
    super();
  }

  override async createJoinToken(
    input: CreateLiveKitJoinTokenInput,
  ): Promise<string> {
    const token = await super.createJoinToken(input);
    await this.invalidate();
    return token;
  }
}

const fakeProvider = new FailFirstEnsureProvider();
const runtime: VirtualRoomRuntime = {
  provider: fakeProvider,
  websocketUrl: "wss://verify-livekit.example.com",
  approvedMaxParticipants: 100,
};
const database = getDatabase();

try {
  await database
    .insertInto("user")
    .values(
      [
        administrator,
        presenter,
        wholePresenter,
        coordinator,
        platformAdministrator,
      ].map((item) => ({
        id: item.id,
        name: item.name,
        email: item.email,
        emailVerified: true,
        image: null,
        stripeCustomerId: null,
      })),
    )
    .execute();
  await database
    .insertInto("platform_admin")
    .values([
      {
        userId: administrator.id,
        grantedByUserId: platformAdministrator.id,
      },
      {
        userId: platformAdministrator.id,
        grantedByUserId: null,
      },
    ])
    .execute();
  await database
    .insertInto("coordination_region")
    .values({
      id: ids.region,
      parentId: null,
      code: "VERIFY-LIVEKIT-ROOM",
      name: "LiveKit room verification region",
      kind: "operational",
      status: "active",
    })
    .execute();
  await database
    .insertInto("event_template")
    .values({
      id: ids.template,
      title: "LiveKit room lifecycle verification",
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
      summary: "LiveKit room lifecycle verification.",
      description: "Verifies exact-session room operations.",
      coverImage: null,
      hasCompletionCertificate: false,
      accreditations: JSON.stringify([]),
      registrationSurveyVersionId: null,
      publishedAt: preparationTime,
    })
    .execute();
  await database
    .insertInto("event_template_session_definition")
    .values({
      id: ids.definition,
      eventTemplateVersionId: ids.version,
      position: 0,
      title: "LiveKit session",
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
      title: "LiveKit room lifecycle verification",
      slug: "verify-livekit-room-lifecycle",
      status: "published",
      deliveryMode: "virtual",
      virtualDeliveryProvider: "livekit",
      registrationMode: "required_unrestricted",
      approvalMode: "automatic",
      timezone: "Australia/Sydney",
      localStartsAt: "2030-09-04T10:00:00",
      localEndsAt: "2030-09-04T11:00:00",
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
      publishedAt: preparationTime,
      createdByUserId: administrator.id,
      createdAt: preparationTime,
      updatedAt: preparationTime,
    })
    .execute();
  await database
    .insertInto("event_session")
    .values({
      id: ids.session,
      eventOccurrenceId: ids.occurrence,
      sessionDefinitionId: ids.definition,
      position: 0,
      title: "LiveKit session",
      localStartsAt: "2030-09-04T10:00:00",
      localEndsAt: "2030-09-04T11:00:00",
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
    .insertInto("event_occurrence_region")
    .values({
      id: ids.occurrenceRegion,
      eventOccurrenceId: ids.occurrence,
      regionId: ids.region,
      position: 0,
      retiredAt: null,
    })
    .execute();
  await database
    .insertInto("event_admin_assignment")
    .values({
      id: "verify_livekit_room_admin_assignment",
      eventOccurrenceId: ids.occurrence,
      userId: administrator.id,
      source: "occurrence_local",
      assignedByUserId: administrator.id,
      assignedAt: preparationTime,
      endedAt: null,
      endReason: null,
    })
    .execute();
  await database
    .insertInto("event_presenter_assignment")
    .values([
      {
        id: "verify_livekit_room_exact_presenter",
        eventOccurrenceId: ids.occurrence,
        eventSessionId: ids.session,
        userId: presenter.id,
        scopeKey: ids.session,
        source: "occurrence_local",
        assignedByUserId: administrator.id,
        assignedAt: preparationTime,
        endedAt: null,
        endReason: null,
      },
      {
        id: "verify_livekit_room_whole_presenter",
        eventOccurrenceId: ids.occurrence,
        eventSessionId: null,
        userId: wholePresenter.id,
        scopeKey: "occurrence",
        source: "occurrence_local",
        assignedByUserId: administrator.id,
        assignedAt: preparationTime,
        endedAt: null,
        endReason: null,
      },
    ])
    .execute();
  await database
    .insertInto("event_coordinator_assignment")
    .values({
      id: "verify_livekit_room_coordinator_assignment",
      eventOccurrenceRegionId: ids.occurrenceRegion,
      userId: coordinator.id,
      source: "occurrence_local",
      assignedByUserId: administrator.id,
      assignedAt: preparationTime,
      endedAt: null,
      endReason: null,
    })
    .execute();

  assert.deepEqual(
    await ensureEventVirtualRoomForStaff(
      ids.occurrence,
      ids.session,
      presenter,
      { runtime, now: new Date("2030-09-03T22:59:59.000Z") },
    ),
    { status: "conflict", reason: "preparation_not_open" },
  );
  assert.deepEqual(
    await ensureEventVirtualRoomForStaff(
      ids.occurrence,
      ids.session,
      coordinator,
      { runtime, now: preparationTime },
    ),
    { status: "forbidden" },
  );
  assert.deepEqual(
    await ensureEventVirtualRoomForStaff(
      ids.occurrence,
      ids.session,
      presenter,
      {
        runtime: { ...runtime, approvedMaxParticipants: 24 },
        now: preparationTime,
      },
    ),
    { status: "conflict", reason: "capacity_exceeded" },
  );
  assert.deepEqual(
    await ensureEventVirtualRoomForStaff(
      ids.occurrence,
      ids.session,
      presenter,
      { runtime, now: preparationTime },
    ),
    { status: "conflict", reason: "provider_unavailable" },
  );
  assert.deepEqual(
    await ensureEventVirtualRoomForStaff(
      ids.occurrence,
      ids.session,
      presenter,
      { runtime, now: preparationTime },
    ),
    { status: "conflict", reason: "provider_pending" },
  );
  const providerRetryTime = new Date("2030-09-03T23:31:00.000Z");
  assert.deepEqual(
    await ensureEventVirtualRoomForStaff(
      ids.occurrence,
      ids.session,
      presenter,
      { runtime, now: providerRetryTime },
    ),
    { status: "ready" },
  );
  assert.deepEqual(
    await ensureEventVirtualRoomForStaff(
      ids.occurrence,
      ids.session,
      wholePresenter,
      { runtime, now: providerRetryTime },
    ),
    { status: "ready" },
  );

  const room = await database
    .selectFrom("event_virtual_room")
    .selectAll()
    .where("eventSessionId", "=", ids.session)
    .executeTakeFirstOrThrow();
  assert.equal(room.generation, 1);
  assert.equal(room.providerStatus, "ready");
  assert.equal(room.maxParticipants, 25);
  assert.equal(room.providerRoomName.includes(ids.session), false);
  assert.equal(
    fakeProvider.operations.filter(
      (operation) => operation.operation === "ensure_room",
    ).length,
    2,
    "Repeated preparation must reuse the same provider room generation",
  );
  const presenterCredential = await issueEventVirtualPresenterCredential(
    ids.occurrence,
    ids.session,
    presenter,
    { runtime, now: providerRetryTime },
  );
  assert.equal(presenterCredential.status, "ready");
  assert.equal(
    presenterCredential.credential.websocketUrl,
    runtime.websocketUrl,
  );
  assert.equal(presenterCredential.credential.generation, 1);
  assert.equal(
    presenterCredential.credential.expiresAt,
    "2030-09-03T23:36:00.000Z",
  );
  const presenterTokenOperation = fakeProvider.operations.find(
    (operation) => operation.operation === "create_join_token",
  );
  assert.ok(presenterTokenOperation);
  assert.equal(presenterTokenOperation.input.role, "presenter");
  assert.equal(presenterTokenOperation.input.roomName, room.providerRoomName);
  assert.match(
    presenterTokenOperation.input.participantIdentity,
    /^staff_[a-f0-9]{64}$/u,
  );
  assert.equal(
    presenterTokenOperation.input.participantIdentity.includes(presenter.id),
    false,
  );
  const tokenAuditCount = async () =>
    (
      await database
        .selectFrom("audit_event")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("action", "=", "event_virtual_room.presenter_token_issued")
        .where("subjectId", "=", room.id)
        .executeTakeFirstOrThrow()
    ).count;
  const auditCountBeforeInvalidation = await tokenAuditCount();
  for (const invalidation of ["ended", "replaced"] as const) {
    const invalidatingRuntime: VirtualRoomRuntime = {
      ...runtime,
      provider: new InvalidatingJoinProvider(async () => {
        await database
          .updateTable("event_virtual_room")
          .set(
            invalidation === "ended"
              ? {
                  doorState: "ended",
                  endedAt: providerRetryTime,
                  endedByUserId: presenter.id,
                }
              : {
                  replacedAt: providerRetryTime,
                  replacedByUserId: presenter.id,
                },
          )
          .where("id", "=", room.id)
          .executeTakeFirstOrThrow();
      }),
    };
    assert.deepEqual(
      await issueEventVirtualPresenterCredential(
        ids.occurrence,
        ids.session,
        presenter,
        { runtime: invalidatingRuntime, now: providerRetryTime },
      ),
      { status: "conflict", reason: "room_not_ready" },
      `A credential must not escape after the room is ${invalidation}`,
    );
    assert.equal(
      await tokenAuditCount(),
      auditCountBeforeInvalidation,
      "Discarded credentials must not produce issuance evidence",
    );
    await database
      .updateTable("event_virtual_room")
      .set({
        doorState: "scheduled",
        endedAt: null,
        endedByUserId: null,
        replacedAt: null,
        replacedByUserId: null,
      })
      .where("id", "=", room.id)
      .executeTakeFirstOrThrow();
  }
  assert.deepEqual(
    await issueEventVirtualPresenterCredential(
      ids.occurrence,
      ids.session,
      coordinator,
      { runtime, now: providerRetryTime },
    ),
    { status: "forbidden" },
  );

  const administratorAccess = await getEventOperationsAccess(
    administrator,
    ids.occurrence,
  );
  assert.ok(administratorAccess?.isAssignedAdministrator);
  assert.equal(administratorAccess.isPlatformAdministrator, true);
  assert.equal(
    (
      await findEventVirtualSessionOperations(
        ids.occurrence,
        administratorAccess,
        preparationTime,
      )
    ).length,
    1,
  );
  const coordinatorAccess = await getEventOperationsAccess(
    coordinator,
    ids.occurrence,
  );
  assert.ok(coordinatorAccess);
  assert.deepEqual(
    await findEventVirtualSessionOperations(
      ids.occurrence,
      coordinatorAccess,
      preparationTime,
    ),
    [],
  );

  assert.deepEqual(
    await checkEventVirtualSessionProviderHealth(
      ids.occurrence,
      ids.session,
      platformAdministrator.id,
      runtime,
    ),
    { status: "ready" },
  );
  await database
    .updateTable("event_virtual_room")
    .set({
      providerStatus: "error",
      providerErrorCode: "verification_failure",
    })
    .where("id", "=", room.id)
    .executeTakeFirstOrThrow();
  const replacementTime = new Date("2030-09-03T23:40:00.000Z");
  assert.deepEqual(
    await replaceEventVirtualRoom(
      ids.occurrence,
      ids.session,
      administrator,
      replacementTime,
    ),
    { status: "ready" },
  );
  const replacementBatch = await processAvailableEventVirtualRoomOperations(
    10,
    { runtime, now: replacementTime },
  );
  assert.equal(replacementBatch.outcomes.length, 2);
  assert.deepEqual(
    new Set(replacementBatch.outcomes.map((outcome) => outcome.kind)),
    new Set(["close_room", "ensure_room"]),
  );
  const generations = await database
    .selectFrom("event_virtual_room")
    .select(["generation", "replacedAt", "providerStatus"])
    .where("eventSessionId", "=", ids.session)
    .orderBy("generation")
    .execute();
  assert.equal(generations.length, 2);
  assert.ok(generations[0]?.replacedAt);
  assert.equal(generations[1]?.providerStatus, "ready");
  assert.deepEqual(
    await replaceEventVirtualRoom(
      ids.occurrence,
      ids.session,
      administrator,
      new Date("2030-09-03T23:41:00.000Z"),
    ),
    { status: "conflict", reason: "invalid_transition" },
  );

  await database
    .updateTable("event_virtual_room")
    .set({ recordingMode: "automatic", recordingRetentionDays: 30 })
    .where("eventSessionId", "=", ids.session)
    .where("replacedAt", "is", null)
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    await transitionEventVirtualRoom(
      ids.occurrence,
      ids.session,
      "start",
      administrator,
      startsAt,
    ),
    { status: "conflict", reason: "recording_unavailable" },
  );
  await database
    .updateTable("event_virtual_room")
    .set({ recordingMode: "off", recordingRetentionDays: null })
    .where("eventSessionId", "=", ids.session)
    .where("replacedAt", "is", null)
    .executeTakeFirstOrThrow();

  assert.deepEqual(
    await transitionEventVirtualRoom(
      ids.occurrence,
      ids.session,
      "start",
      administrator,
      startsAt,
    ),
    { status: "ready" },
  );
  assert.deepEqual(
    await transitionEventVirtualRoom(
      ids.occurrence,
      ids.session,
      "start",
      administrator,
      startsAt,
    ),
    { status: "ready" },
  );
  assert.deepEqual(
    await setEventVirtualRoomAdmissionMode(
      ids.occurrence,
      ids.session,
      "automatic",
      wholePresenter,
      startsAt,
    ),
    { status: "ready" },
  );
  assert.deepEqual(
    await transitionEventVirtualRoom(
      ids.occurrence,
      ids.session,
      "lock",
      presenter,
      startsAt,
    ),
    { status: "ready" },
  );
  assert.deepEqual(
    await transitionEventVirtualRoom(
      ids.occurrence,
      ids.session,
      "reopen",
      presenter,
      startsAt,
    ),
    { status: "ready" },
  );
  assert.deepEqual(
    await transitionEventVirtualRoom(
      ids.occurrence,
      ids.session,
      "end",
      administrator,
      endsAt,
    ),
    { status: "ready" },
  );

  const closeBatch = await processAvailableEventVirtualRoomOperations(10, {
    runtime,
    now: endsAt,
  });
  assert.equal(closeBatch.outcomes.length, 1);
  assert.equal(closeBatch.outcomes[0]?.kind, "close_room");
  assert.equal(fakeProvider.rooms.size, 0);

  assert.deepEqual(
    await replaceEventVirtualRoom(
      ids.occurrence,
      ids.session,
      administrator,
      new Date("2030-09-04T01:01:00.000Z"),
    ),
    { status: "conflict", reason: "invalid_transition" },
  );

  const auditActions = await database
    .selectFrom("audit_event")
    .select("action")
    .where("subjectType", "=", "event_virtual_room")
    .where("actorUserId", "in", [
      administrator.id,
      presenter.id,
      wholePresenter.id,
    ])
    .execute();
  assert.ok(
    auditActions.some((event) => event.action === "event_virtual_room.created"),
  );
  assert.ok(
    auditActions.some(
      (event) => event.action === "event_virtual_room.presenter_token_issued",
    ),
  );
  assert.ok(
    auditActions.some(
      (event) => event.action === "event_virtual_room.lifecycle_changed",
    ),
  );
  console.log(
    "Verified LiveKit exact staff authorization, preparation timing, capacity, idempotent room creation, health, lifecycle, closure, replacement, worker processing and durable audit evidence",
  );
} finally {
  await database
    .deleteFrom("event_virtual_room_operation")
    .where("roomId", "in", (builder) =>
      builder
        .selectFrom("event_virtual_room")
        .select("id")
        .where("eventSessionId", "=", ids.session),
    )
    .execute();
  await database
    .deleteFrom("event_virtual_room")
    .where("eventSessionId", "=", ids.session)
    .execute();
  await database
    .deleteFrom("outbox_event")
    .where("aggregateId", "=", ids.occurrence)
    .execute();
  await database.transaction().execute(async (transaction) => {
    await sql`select set_config('upskill.audit_maintenance', 'on', true)`.execute(
      transaction,
    );
    await transaction
      .deleteFrom("audit_event")
      .where("subjectType", "=", "event_virtual_room")
      .where("actorUserId", "in", [
        administrator.id,
        presenter.id,
        wholePresenter.id,
      ])
      .execute();
  });
  await database
    .deleteFrom("event_coordinator_assignment")
    .where("id", "=", "verify_livekit_room_coordinator_assignment")
    .execute();
  await database
    .deleteFrom("event_presenter_assignment")
    .where("eventOccurrenceId", "=", ids.occurrence)
    .execute();
  await database
    .deleteFrom("event_admin_assignment")
    .where("eventOccurrenceId", "=", ids.occurrence)
    .execute();
  await database
    .deleteFrom("event_occurrence_region")
    .where("id", "=", ids.occurrenceRegion)
    .execute();
  await database
    .deleteFrom("event_session")
    .where("id", "=", ids.session)
    .execute();
  await database
    .deleteFrom("event_occurrence")
    .where("id", "=", ids.occurrence)
    .execute();
  await database
    .deleteFrom("event_template_session_definition")
    .where("id", "=", ids.definition)
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
    .deleteFrom("coordination_region")
    .where("id", "=", ids.region)
    .execute();
  await database
    .deleteFrom("platform_admin")
    .where("userId", "in", [administrator.id, platformAdministrator.id])
    .execute();
  await database
    .deleteFrom("user")
    .where("id", "in", [
      administrator.id,
      presenter.id,
      wholePresenter.id,
      coordinator.id,
      platformAdministrator.id,
    ])
    .execute();
  await destroyDatabase();
}
