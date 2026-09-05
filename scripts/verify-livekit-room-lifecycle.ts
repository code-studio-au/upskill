import assert from "node:assert/strict";
import { sql } from "kysely";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { destroyDatabase, getDatabase } from "#/server/db/database.server";
import { getEventOperationsAccess } from "#/server/events/event-operations-access.server";
import { transitionAdminEventOccurrence } from "#/server/admin/admin-event-operations.server";
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
  type LiveKitJoinCredential,
  type EnsureLiveKitRoomInput,
  type LiveKitRoomSnapshot,
} from "#/server/livekit/livekit-provider.server";

const ids = {
  template: "verify_livekit_room_template",
  version: "verify_livekit_room_version",
  definition: "verify_livekit_room_definition",
  raceDefinition: "verify_livekit_room_race_definition",
  occurrence: "verify_livekit_room_occurrence",
  session: "verify_livekit_room_session",
  raceSession: "verify_livekit_room_race_session",
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
  ): Promise<LiveKitJoinCredential> {
    const credential = await super.createJoinToken(input);
    await this.invalidate();
    return credential;
  }
}

class InvalidatingEnsureProvider extends FakeLiveKitProvider {
  constructor(private readonly invalidate: () => Promise<void>) {
    super();
  }

  override async ensureRoom(
    input: EnsureLiveKitRoomInput,
  ): Promise<LiveKitRoomSnapshot> {
    const room = await super.ensureRoom(input);
    await this.invalidate();
    return room;
  }
}

class DeferredEnsureProvider extends FakeLiveKitProvider {
  private releaseEnsure!: () => void;
  private signalEnsureStarted!: () => void;
  private readonly ensureRelease = new Promise<void>((resolve) => {
    this.releaseEnsure = resolve;
  });
  private readonly ensureStarted = new Promise<void>((resolve) => {
    this.signalEnsureStarted = resolve;
  });

  override async ensureRoom(
    input: EnsureLiveKitRoomInput,
  ): Promise<LiveKitRoomSnapshot> {
    this.signalEnsureStarted();
    await this.ensureRelease;
    return super.ensureRoom(input);
  }

  waitUntilEnsureStarts(): Promise<void> {
    return this.ensureStarted;
  }

  release(): void {
    this.releaseEnsure();
  }
}

class LeaseCrossingEnsureProvider extends FakeLiveKitProvider {
  private ensureCalls = 0;
  private releaseFirstEnsure!: () => void;
  private signalFirstEnsureStarted!: () => void;
  private readonly firstEnsureRelease = new Promise<void>((resolve) => {
    this.releaseFirstEnsure = resolve;
  });
  private readonly firstEnsureStarted = new Promise<void>((resolve) => {
    this.signalFirstEnsureStarted = resolve;
  });

  override async ensureRoom(
    input: EnsureLiveKitRoomInput,
  ): Promise<LiveKitRoomSnapshot> {
    this.ensureCalls += 1;
    if (this.ensureCalls === 1) {
      this.signalFirstEnsureStarted();
      await this.firstEnsureRelease;
    }
    return super.ensureRoom(input);
  }

  waitUntilFirstEnsureStarts(): Promise<void> {
    return this.firstEnsureStarted;
  }

  release(): void {
    this.releaseFirstEnsure();
  }
}

const credentialIssuedAt = new Date("2030-09-03T23:32:00.000Z");
const fakeProvider = new FailFirstEnsureProvider(() => credentialIssuedAt);
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
    .values(
      [
        { id: ids.definition, position: 0, title: "LiveKit session" },
        {
          id: ids.raceDefinition,
          position: 1,
          title: "LiveKit lease-race session",
        },
      ].map((definition) => ({
        ...definition,
        eventTemplateVersionId: ids.version,
        durationMinutes: 60,
        presenterRequired: true,
        livekitAdmissionMode: "manual" as const,
        livekitAttendanceMode: "manual" as const,
        livekitAttendanceMinimumMinutes: null,
        livekitPresenterPreparationMinutes: 60,
        livekitAttendeeRejoinGraceMinutes: 10,
        livekitCapacityHeadroom: 5,
        livekitOpenEntryGuestsAllowed: false,
        livekitRecordingMode: "off" as const,
        livekitRecordingRetentionDays: null,
        livekitAttendeeRecordingNotice: "",
        livekitPresenterRecordingNotice: "",
      })),
    )
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
    .values(
      [
        {
          id: ids.session,
          sessionDefinitionId: ids.definition,
          position: 0,
          title: "LiveKit session",
        },
        {
          id: ids.raceSession,
          sessionDefinitionId: ids.raceDefinition,
          position: 1,
          title: "LiveKit lease-race session",
        },
      ].map((session) => ({
        ...session,
        eventOccurrenceId: ids.occurrence,
        localStartsAt: "2030-09-04T10:00:00",
        localEndsAt: "2030-09-04T11:00:00",
        startsAt,
        endsAt,
        presenterRequired: true,
        venueName: null,
        venueAddress: null,
        virtualJoinUrl: null,
        virtualDeliveryProvider: "livekit" as const,
        livekitAdmissionMode: "manual" as const,
        livekitAttendanceMode: "manual" as const,
        livekitAttendanceMinimumMinutes: null,
        livekitPresenterPreparationMinutes: 60,
        livekitAttendeeRejoinGraceMinutes: 10,
        livekitCapacityHeadroom: 5,
        livekitOpenEntryGuestsAllowed: false,
        livekitRecordingMode: "off" as const,
        livekitRecordingRetentionDays: null,
        livekitAttendeeRecordingNotice: "",
        livekitPresenterRecordingNotice: "",
      })),
    )
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

  let confirmOccurrenceLock: (() => void) | undefined;
  let releaseOccurrenceLock: (() => void) | undefined;
  const occurrenceLockHeld = new Promise<void>((resolve) => {
    confirmOccurrenceLock = resolve;
  });
  const releaseOccurrence = new Promise<void>((resolve) => {
    releaseOccurrenceLock = resolve;
  });
  const terminalTransaction = database
    .transaction()
    .execute(async (transaction) => {
      await transaction
        .selectFrom("event_occurrence")
        .select("id")
        .where("id", "=", ids.occurrence)
        .forUpdate()
        .executeTakeFirstOrThrow();
      confirmOccurrenceLock?.();
      await releaseOccurrence;
      await transaction
        .updateTable("event_occurrence")
        .set({ status: "completed" })
        .where("id", "=", ids.occurrence)
        .executeTakeFirstOrThrow();
    });
  await occurrenceLockHeld;
  let stalePreparationSettled = false;
  const stalePreparation = ensureEventVirtualRoomForStaff(
    ids.occurrence,
    ids.session,
    presenter,
    { runtime, clock: () => preparationTime },
  ).finally(() => {
    stalePreparationSettled = true;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      stalePreparationSettled,
      false,
      "Room creation must wait behind the occurrence lifecycle lock",
    );
  } finally {
    releaseOccurrenceLock?.();
    await terminalTransaction;
  }
  assert.deepEqual(await stalePreparation, {
    status: "conflict",
    reason: "occurrence_unavailable",
  });
  assert.equal(
    await database
      .selectFrom("event_virtual_room")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("eventSessionId", "=", ids.session)
      .executeTakeFirstOrThrow()
      .then((row) => row.count),
    0,
    "A terminal occurrence must not gain a room generation from a stale request",
  );
  await database
    .updateTable("event_occurrence")
    .set({ status: "published" })
    .where("id", "=", ids.occurrence)
    .executeTakeFirstOrThrow();

  let confirmPreparationLock: (() => void) | undefined;
  let releasePreparationLock: (() => void) | undefined;
  const preparationLockHeld = new Promise<void>((resolve) => {
    confirmPreparationLock = resolve;
  });
  const releasePreparation = new Promise<void>((resolve) => {
    releasePreparationLock = resolve;
  });
  const blockingPreparationTransaction = database
    .transaction()
    .execute(async (transaction) => {
      await transaction
        .selectFrom("event_occurrence")
        .select("id")
        .where("id", "=", ids.occurrence)
        .forUpdate()
        .executeTakeFirstOrThrow();
      confirmPreparationLock?.();
      await releasePreparation;
    });
  await preparationLockHeld;
  let delayedPreparationTime = new Date("2030-09-04T00:59:59.000Z");
  let delayedPreparationSettled = false;
  const delayedPreparation = ensureEventVirtualRoomForStaff(
    ids.occurrence,
    ids.session,
    presenter,
    { runtime, clock: () => delayedPreparationTime },
  ).finally(() => {
    delayedPreparationSettled = true;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      delayedPreparationSettled,
      false,
      "Room preparation must wait behind the occurrence lifecycle lock",
    );
    delayedPreparationTime = endsAt;
  } finally {
    releasePreparationLock?.();
    await blockingPreparationTransaction;
  }
  assert.deepEqual(
    await delayedPreparation,
    { status: "conflict", reason: "session_ended" },
    "Room creation must sample policy time after waiting for lifecycle locks",
  );
  assert.equal(
    await database
      .selectFrom("event_virtual_room")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("eventSessionId", "=", ids.session)
      .executeTakeFirstOrThrow()
      .then((row) => row.count),
    0,
    "A preparation request that crosses the cutoff must not create a room generation",
  );

  assert.deepEqual(
    await ensureEventVirtualRoomForStaff(
      ids.occurrence,
      ids.session,
      presenter,
      {
        runtime,
        clock: () => new Date("2030-09-03T22:59:59.000Z"),
      },
    ),
    { status: "conflict", reason: "preparation_not_open" },
  );
  assert.deepEqual(
    await ensureEventVirtualRoomForStaff(
      ids.occurrence,
      ids.session,
      coordinator,
      { runtime, clock: () => preparationTime },
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
        clock: () => preparationTime,
      },
    ),
    { status: "conflict", reason: "capacity_exceeded" },
  );
  assert.deepEqual(
    await ensureEventVirtualRoomForStaff(
      ids.occurrence,
      ids.session,
      presenter,
      { runtime, clock: () => preparationTime },
    ),
    { status: "conflict", reason: "provider_unavailable" },
  );
  assert.deepEqual(
    await ensureEventVirtualRoomForStaff(
      ids.occurrence,
      ids.session,
      presenter,
      { runtime, clock: () => preparationTime },
    ),
    { status: "conflict", reason: "provider_pending" },
  );
  const providerRetryTime = new Date("2030-09-03T23:31:00.000Z");
  assert.deepEqual(
    await ensureEventVirtualRoomForStaff(
      ids.occurrence,
      ids.session,
      presenter,
      { runtime, clock: () => providerRetryTime },
    ),
    { status: "ready" },
  );
  assert.deepEqual(
    await ensureEventVirtualRoomForStaff(
      ids.occurrence,
      ids.session,
      wholePresenter,
      { runtime, clock: () => providerRetryTime },
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
  const authorityInvalidatingRuntime: VirtualRoomRuntime = {
    ...runtime,
    provider: new InvalidatingEnsureProvider(async () => {
      await database
        .updateTable("event_presenter_assignment")
        .set({
          endedAt: providerRetryTime,
          endReason: "assignment_ended",
        })
        .where("id", "=", "verify_livekit_room_exact_presenter")
        .executeTakeFirstOrThrow();
    }),
  };
  assert.deepEqual(
    await ensureEventVirtualRoomForStaff(
      ids.occurrence,
      ids.session,
      presenter,
      {
        runtime: authorityInvalidatingRuntime,
        clock: () => providerRetryTime,
      },
    ),
    { status: "forbidden" },
    "Room preparation must not acknowledge a provider side effect after authority is revoked",
  );
  await database
    .updateTable("event_presenter_assignment")
    .set({ endedAt: null, endReason: null })
    .where("id", "=", "verify_livekit_room_exact_presenter")
    .executeTakeFirstOrThrow();
  const presenterCredential = await issueEventVirtualPresenterCredential(
    ids.occurrence,
    ids.session,
    presenter,
    { runtime, clock: () => providerRetryTime },
  );
  assert.equal(presenterCredential.status, "ready");
  assert.equal(
    presenterCredential.credential.websocketUrl,
    runtime.websocketUrl,
  );
  assert.equal(presenterCredential.credential.generation, 1);
  assert.equal(
    presenterCredential.credential.expiresAt,
    "2030-09-03T23:37:00.000Z",
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
        { runtime: invalidatingRuntime, clock: () => providerRetryTime },
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
  const occurrenceInvalidatingRuntime: VirtualRoomRuntime = {
    ...runtime,
    provider: new InvalidatingJoinProvider(async () => {
      await database
        .updateTable("event_occurrence")
        .set({ status: "completed" })
        .where("id", "=", ids.occurrence)
        .executeTakeFirstOrThrow();
    }),
  };
  assert.deepEqual(
    await issueEventVirtualPresenterCredential(
      ids.occurrence,
      ids.session,
      presenter,
      {
        runtime: occurrenceInvalidatingRuntime,
        clock: () => providerRetryTime,
      },
    ),
    { status: "conflict", reason: "occurrence_unavailable" },
    "A credential must not escape after the occurrence becomes terminal",
  );
  assert.equal(await tokenAuditCount(), auditCountBeforeInvalidation);
  await database
    .updateTable("event_occurrence")
    .set({ status: "published" })
    .where("id", "=", ids.occurrence)
    .executeTakeFirstOrThrow();

  const sessionCutoffInvalidatingRuntime: VirtualRoomRuntime = {
    ...runtime,
    provider: new InvalidatingJoinProvider(async () => {
      await database
        .updateTable("event_session")
        .set({
          startsAt: new Date("2030-09-03T23:00:00.000Z"),
          endsAt: providerRetryTime,
        })
        .where("id", "=", ids.session)
        .executeTakeFirstOrThrow();
    }),
  };
  assert.deepEqual(
    await issueEventVirtualPresenterCredential(
      ids.occurrence,
      ids.session,
      presenter,
      {
        runtime: sessionCutoffInvalidatingRuntime,
        clock: () => providerRetryTime,
      },
    ),
    { status: "conflict", reason: "session_ended" },
    "A credential must not escape after the session cutoff changes",
  );
  assert.equal(await tokenAuditCount(), auditCountBeforeInvalidation);
  await database
    .updateTable("event_session")
    .set({ startsAt, endsAt })
    .where("id", "=", ids.session)
    .executeTakeFirstOrThrow();
  let credentialPolicyTime = new Date("2030-09-04T00:59:59.000Z");
  const crossingCutoffRuntime: VirtualRoomRuntime = {
    ...runtime,
    provider: new InvalidatingJoinProvider(() => {
      credentialPolicyTime = endsAt;
      return Promise.resolve();
    }),
  };
  assert.deepEqual(
    await issueEventVirtualPresenterCredential(
      ids.occurrence,
      ids.session,
      presenter,
      {
        runtime: crossingCutoffRuntime,
        clock: () => credentialPolicyTime,
      },
    ),
    { status: "conflict", reason: "session_ended" },
    "A token request that crosses the session cutoff must use fresh policy time",
  );
  assert.equal(await tokenAuditCount(), auditCountBeforeInvalidation);
  assert.deepEqual(
    await issueEventVirtualPresenterCredential(
      ids.occurrence,
      ids.session,
      coordinator,
      { runtime, clock: () => providerRetryTime },
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
    2,
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
  let releaseReplacementLock: (() => void) | undefined;
  const replacementLockHeld = new Promise<void>((resolve) => {
    confirmOccurrenceLock = resolve;
  });
  const releaseReplacement = new Promise<void>((resolve) => {
    releaseReplacementLock = resolve;
  });
  const replacementTerminalTransaction = database
    .transaction()
    .execute(async (transaction) => {
      await transaction
        .selectFrom("event_occurrence")
        .select("id")
        .where("id", "=", ids.occurrence)
        .forUpdate()
        .executeTakeFirstOrThrow();
      confirmOccurrenceLock?.();
      await releaseReplacement;
      await transaction
        .updateTable("event_occurrence")
        .set({ status: "completed" })
        .where("id", "=", ids.occurrence)
        .executeTakeFirstOrThrow();
    });
  await replacementLockHeld;
  let staleReplacementSettled = false;
  const staleReplacement = replaceEventVirtualRoom(
    ids.occurrence,
    ids.session,
    administrator,
    { clock: () => replacementTime },
  ).finally(() => {
    staleReplacementSettled = true;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      staleReplacementSettled,
      false,
      "Room replacement must wait behind the occurrence lifecycle lock",
    );
  } finally {
    releaseReplacementLock?.();
    await replacementTerminalTransaction;
  }
  assert.deepEqual(await staleReplacement, {
    status: "conflict",
    reason: "occurrence_unavailable",
  });
  assert.equal(
    await database
      .selectFrom("event_virtual_room")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("eventSessionId", "=", ids.session)
      .executeTakeFirstOrThrow()
      .then((row) => row.count),
    1,
    "A stale replacement request must not create a terminal room generation",
  );
  await database
    .updateTable("event_occurrence")
    .set({ status: "published" })
    .where("id", "=", ids.occurrence)
    .executeTakeFirstOrThrow();

  let confirmReplacementCutoffLock: (() => void) | undefined;
  let releaseReplacementCutoffLock: (() => void) | undefined;
  const replacementCutoffLockHeld = new Promise<void>((resolve) => {
    confirmReplacementCutoffLock = resolve;
  });
  const releaseReplacementCutoff = new Promise<void>((resolve) => {
    releaseReplacementCutoffLock = resolve;
  });
  const blockingReplacementCutoffTransaction = database
    .transaction()
    .execute(async (transaction) => {
      await transaction
        .selectFrom("event_occurrence")
        .select("id")
        .where("id", "=", ids.occurrence)
        .forUpdate()
        .executeTakeFirstOrThrow();
      confirmReplacementCutoffLock?.();
      await releaseReplacementCutoff;
    });
  await replacementCutoffLockHeld;
  let delayedReplacementTime = new Date("2030-09-04T00:59:59.000Z");
  let delayedReplacementSettled = false;
  const delayedReplacement = replaceEventVirtualRoom(
    ids.occurrence,
    ids.session,
    administrator,
    { clock: () => delayedReplacementTime },
  ).finally(() => {
    delayedReplacementSettled = true;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      delayedReplacementSettled,
      false,
      "Room replacement must wait behind the occurrence lifecycle lock",
    );
    delayedReplacementTime = endsAt;
  } finally {
    releaseReplacementCutoffLock?.();
    await blockingReplacementCutoffTransaction;
  }
  assert.deepEqual(
    await delayedReplacement,
    { status: "conflict", reason: "session_ended" },
    "Room replacement must sample policy time after waiting for lifecycle locks",
  );
  assert.equal(
    await database
      .selectFrom("event_virtual_room")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("eventSessionId", "=", ids.session)
      .executeTakeFirstOrThrow()
      .then((row) => row.count),
    1,
    "A replacement request that crosses the cutoff must not append a generation",
  );
  assert.deepEqual(
    await replaceEventVirtualRoom(ids.occurrence, ids.session, administrator, {
      clock: () => replacementTime,
    }),
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
    await replaceEventVirtualRoom(ids.occurrence, ids.session, administrator, {
      clock: () => new Date("2030-09-03T23:41:00.000Z"),
    }),
    { status: "conflict", reason: "invalid_transition" },
  );

  const laterStartsAt = new Date("2030-09-05T00:00:00.000Z");
  const laterEndsAt = new Date("2030-09-05T01:00:00.000Z");
  await database.transaction().execute(async (transaction) => {
    await transaction
      .updateTable("event_occurrence")
      .set({ startsAt: laterStartsAt, endsAt: laterEndsAt })
      .where("id", "=", ids.occurrence)
      .executeTakeFirstOrThrow();
    await transaction
      .updateTable("event_session")
      .set({ startsAt: laterStartsAt, endsAt: laterEndsAt })
      .where("id", "in", [ids.session, ids.raceSession])
      .execute();
  });
  assert.deepEqual(
    await transitionEventVirtualRoom(
      ids.occurrence,
      ids.session,
      "start",
      administrator,
      { runtime, clock: () => replacementTime },
    ),
    { status: "conflict", reason: "preparation_not_open" },
    "A retained prepared room must not start before a rescheduled preparation window",
  );
  await database.transaction().execute(async (transaction) => {
    await transaction
      .updateTable("event_occurrence")
      .set({ startsAt, endsAt })
      .where("id", "=", ids.occurrence)
      .executeTakeFirstOrThrow();
    await transaction
      .updateTable("event_session")
      .set({ startsAt, endsAt })
      .where("id", "in", [ids.session, ids.raceSession])
      .execute();
  });

  let confirmStartLock: (() => void) | undefined;
  let releaseStartLock: (() => void) | undefined;
  const startLockHeld = new Promise<void>((resolve) => {
    confirmStartLock = resolve;
  });
  const releaseStart = new Promise<void>((resolve) => {
    releaseStartLock = resolve;
  });
  const blockingStartTransaction = database
    .transaction()
    .execute(async (transaction) => {
      await transaction
        .selectFrom("event_occurrence")
        .select("id")
        .where("id", "=", ids.occurrence)
        .forUpdate()
        .executeTakeFirstOrThrow();
      confirmStartLock?.();
      await releaseStart;
    });
  await startLockHeld;
  let startPolicyTime = new Date("2030-09-04T00:59:59.000Z");
  let delayedStartSettled = false;
  const delayedStart = transitionEventVirtualRoom(
    ids.occurrence,
    ids.session,
    "start",
    administrator,
    { runtime, clock: () => startPolicyTime },
  ).finally(() => {
    delayedStartSettled = true;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      delayedStartSettled,
      false,
      "Start must wait behind the occurrence lifecycle lock",
    );
    startPolicyTime = endsAt;
  } finally {
    releaseStartLock?.();
    await blockingStartTransaction;
  }
  assert.deepEqual(
    await delayedStart,
    { status: "conflict", reason: "session_ended" },
    "Start must sample policy time after waiting for lifecycle locks",
  );
  assert.equal(
    await database
      .selectFrom("event_virtual_room")
      .select("doorState")
      .where("eventSessionId", "=", ids.session)
      .where("replacedAt", "is", null)
      .executeTakeFirstOrThrow()
      .then((currentRoom) => currentRoom.doorState),
    "scheduled",
    "A Start request that crosses the session cutoff must leave the door scheduled",
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
      { runtime, clock: () => startsAt },
    ),
    { status: "conflict", reason: "recording_unavailable" },
  );
  await database
    .updateTable("event_virtual_room")
    .set({ recordingMode: "off", recordingRetentionDays: null })
    .where("eventSessionId", "=", ids.session)
    .where("replacedAt", "is", null)
    .executeTakeFirstOrThrow();

  const startRoom = await database
    .selectFrom("event_virtual_room")
    .select("providerRoomName")
    .where("eventSessionId", "=", ids.session)
    .where("replacedAt", "is", null)
    .executeTakeFirstOrThrow();
  fakeProvider.rooms.delete(startRoom.providerRoomName);
  const ensureCountBeforeStart = fakeProvider.operations.filter(
    (operation) => operation.operation === "ensure_room",
  ).length;

  assert.deepEqual(
    await transitionEventVirtualRoom(
      ids.occurrence,
      ids.session,
      "start",
      administrator,
      { runtime, clock: () => startsAt },
    ),
    { status: "ready" },
  );
  assert.equal(
    fakeProvider.rooms.has(startRoom.providerRoomName),
    true,
    "Start must restore a provider room removed by its empty-room timeout",
  );
  assert.equal(
    fakeProvider.operations.filter(
      (operation) => operation.operation === "ensure_room",
    ).length,
    ensureCountBeforeStart + 1,
    "Start must reconcile provider state instead of trusting cached readiness",
  );
  assert.deepEqual(
    await transitionEventVirtualRoom(
      ids.occurrence,
      ids.session,
      "start",
      administrator,
      { runtime, clock: () => startsAt },
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
      { clock: () => startsAt },
    ),
    { status: "ready" },
  );
  assert.deepEqual(
    await transitionEventVirtualRoom(
      ids.occurrence,
      ids.session,
      "reopen",
      presenter,
      { clock: () => startsAt },
    ),
    { status: "ready" },
  );
  const recoveryEndTime = new Date("2030-09-04T00:30:00.000Z");
  assert.deepEqual(
    await transitionEventVirtualRoom(
      ids.occurrence,
      ids.session,
      "end",
      administrator,
      { clock: () => recoveryEndTime },
    ),
    { status: "ready" },
  );

  const closeBatch = await processAvailableEventVirtualRoomOperations(10, {
    runtime,
    now: recoveryEndTime,
  });
  assert.equal(closeBatch.outcomes.length, 1);
  assert.equal(closeBatch.outcomes[0]?.kind, "close_room");
  assert.equal(fakeProvider.rooms.size, 0);

  const recoveryTime = new Date("2030-09-04T00:31:00.000Z");
  assert.deepEqual(
    await replaceEventVirtualRoom(ids.occurrence, ids.session, presenter, {
      clock: () => recoveryTime,
    }),
    { status: "forbidden" },
    "Presenters must not recover an intentionally ended room generation",
  );
  assert.deepEqual(
    await replaceEventVirtualRoom(ids.occurrence, ids.session, administrator, {
      clock: () => recoveryTime,
    }),
    { status: "ready" },
    "An administrator must be able to append recovery after an ended generation",
  );
  const recoveryBatch = await processAvailableEventVirtualRoomOperations(10, {
    runtime,
    now: recoveryTime,
  });
  assert.deepEqual(
    recoveryBatch.outcomes.map((outcome) => outcome.kind),
    ["ensure_room"],
  );
  const recoveredRoom = await database
    .selectFrom("event_virtual_room")
    .select(["generation", "doorState", "providerStatus"])
    .where("eventSessionId", "=", ids.session)
    .where("replacedAt", "is", null)
    .executeTakeFirstOrThrow();
  assert.deepEqual(recoveredRoom, {
    generation: 3,
    doorState: "scheduled",
    providerStatus: "ready",
  });
  assert.deepEqual(
    await transitionEventVirtualRoom(
      ids.occurrence,
      ids.session,
      "start",
      administrator,
      { runtime, clock: () => recoveryTime },
    ),
    { status: "ready" },
  );
  assert.deepEqual(
    await transitionEventVirtualRoom(
      ids.occurrence,
      ids.session,
      "end",
      administrator,
      { clock: () => endsAt },
    ),
    { status: "ready" },
  );
  const recoveredCloseBatch = await processAvailableEventVirtualRoomOperations(
    10,
    { runtime, now: endsAt },
  );
  assert.deepEqual(
    recoveredCloseBatch.outcomes.map((outcome) => outcome.kind),
    ["close_room"],
  );
  assert.equal(fakeProvider.rooms.size, 0);

  assert.deepEqual(
    await replaceEventVirtualRoom(ids.occurrence, ids.session, administrator, {
      clock: () => new Date("2030-09-04T01:01:00.000Z"),
    }),
    { status: "conflict", reason: "session_ended" },
  );

  const leaseCrossingProvider = new LeaseCrossingEnsureProvider();
  const leaseCrossingRuntime: VirtualRoomRuntime = {
    ...runtime,
    provider: leaseCrossingProvider,
  };
  const leaseEnsureTime = new Date("2030-09-03T23:40:00.000Z");
  const leaseCrossingPreparation = ensureEventVirtualRoomForStaff(
    ids.occurrence,
    ids.raceSession,
    wholePresenter,
    { runtime: leaseCrossingRuntime, clock: () => leaseEnsureTime },
  );
  await leaseCrossingProvider.waitUntilFirstEnsureStarts();
  const leaseCrossingRoom = await database
    .selectFrom("event_virtual_room")
    .select(["id", "providerRoomName"])
    .where("eventSessionId", "=", ids.raceSession)
    .where("replacedAt", "is", null)
    .executeTakeFirstOrThrow();
  const leaseRetryTime = new Date("2030-09-03T23:42:01.000Z");
  const leaseRetryBatch = await processAvailableEventVirtualRoomOperations(10, {
    runtime: leaseCrossingRuntime,
    now: leaseRetryTime,
  });
  assert.deepEqual(
    leaseRetryBatch.outcomes.map((outcome) => outcome.kind),
    ["ensure_room"],
  );
  assert.equal(
    leaseCrossingProvider.rooms.has(leaseCrossingRoom.providerRoomName),
    true,
    "A reclaimed ensure attempt must establish the provider room",
  );
  leaseCrossingProvider.release();
  assert.deepEqual(await leaseCrossingPreparation, {
    status: "conflict",
    reason: "provider_pending",
  });
  assert.equal(
    leaseCrossingProvider.rooms.has(leaseCrossingRoom.providerRoomName),
    true,
    "An expired ensure attempt must not close the room confirmed by its successful retry",
  );
  assert.equal(
    leaseCrossingProvider.operations.some(
      (operation) => operation.operation === "close_room",
    ),
    false,
  );
  assert.equal(
    await database
      .selectFrom("event_virtual_room")
      .select("providerStatus")
      .where("id", "=", leaseCrossingRoom.id)
      .executeTakeFirstOrThrow()
      .then((currentRoom) => currentRoom.providerStatus),
    "ready",
  );

  const deferredProvider = new DeferredEnsureProvider();
  const deferredRuntime: VirtualRoomRuntime = {
    ...runtime,
    provider: deferredProvider,
  };
  const deferredEnsureTime = new Date("2030-09-03T23:45:00.000Z");
  const deferredPreparation = ensureEventVirtualRoomForStaff(
    ids.occurrence,
    ids.raceSession,
    wholePresenter,
    { runtime: deferredRuntime, clock: () => deferredEnsureTime },
  );
  await deferredProvider.waitUntilEnsureStarts();
  const deferredRoom = await database
    .selectFrom("event_virtual_room")
    .selectAll()
    .where("eventSessionId", "=", ids.raceSession)
    .executeTakeFirstOrThrow();
  const deferredEndTime = new Date("2030-09-03T23:46:00.000Z");
  assert.deepEqual(
    await transitionEventVirtualRoom(
      ids.occurrence,
      ids.raceSession,
      "end",
      wholePresenter,
      { clock: () => deferredEndTime },
    ),
    { status: "ready" },
  );
  const reclaimedTime = new Date("2030-09-03T23:47:01.000Z");
  const reclaimedBatch = await processAvailableEventVirtualRoomOperations(10, {
    runtime: deferredRuntime,
    now: reclaimedTime,
  });
  assert.deepEqual(
    reclaimedBatch.outcomes.map((outcome) => outcome.kind),
    ["ensure_room", "close_room"],
    "A reclaimed terminal ensure must finish before the queued close",
  );
  deferredProvider.release();
  assert.deepEqual(await deferredPreparation, {
    status: "conflict",
    reason: "provider_pending",
  });
  assert.equal(
    deferredProvider.rooms.size,
    0,
    "A stale provider ensure must compensate after its attempt fence is lost",
  );
  assert.equal(
    deferredProvider.operations.filter(
      (operation) => operation.operation === "close_room",
    ).length,
    2,
    "The stale ensure must close the room again after the earlier close completed",
  );

  await database
    .updateTable("event_virtual_room")
    .set({
      replacedAt: reclaimedTime,
      replacedByUserId: administrator.id,
    })
    .where("id", "=", deferredRoom.id)
    .executeTakeFirstOrThrow();
  const terminalRoomPreparationTime = new Date("2030-09-03T23:50:00.000Z");
  assert.deepEqual(
    await ensureEventVirtualRoomForStaff(
      ids.occurrence,
      ids.raceSession,
      wholePresenter,
      { runtime, clock: () => terminalRoomPreparationTime },
    ),
    { status: "ready" },
  );
  assert.deepEqual(
    await transitionEventVirtualRoom(
      ids.occurrence,
      ids.raceSession,
      "start",
      wholePresenter,
      { runtime, clock: () => startsAt },
    ),
    { status: "ready" },
  );
  const terminalTransitionTime = new Date("2030-09-04T00:10:00.000Z");
  assert.equal(
    await transitionAdminEventOccurrence(
      ids.occurrence,
      "completed",
      administrator,
      terminalTransitionTime,
    ),
    "updated",
  );
  const terminalRoom = await database
    .selectFrom("event_virtual_room")
    .select(["id", "doorState", "endedByUserId", "endedAt"])
    .where("eventSessionId", "=", ids.raceSession)
    .where("replacedAt", "is", null)
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    {
      doorState: terminalRoom.doorState,
      endedByUserId: terminalRoom.endedByUserId,
      endedAt: terminalRoom.endedAt,
    },
    {
      doorState: "ended",
      endedByUserId: administrator.id,
      endedAt: terminalTransitionTime,
    },
    "Completing an occurrence must terminate its current provider rooms",
  );
  const terminalCloseBatch = await processAvailableEventVirtualRoomOperations(
    10,
    { runtime, now: terminalTransitionTime },
  );
  assert.deepEqual(
    terminalCloseBatch.outcomes.map((outcome) => ({
      roomId: outcome.roomId,
      kind: outcome.kind,
    })),
    [{ roomId: terminalRoom.id, kind: "close_room" }],
  );
  assert.equal(fakeProvider.rooms.size, 0);

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
        .where("eventSessionId", "in", [ids.session, ids.raceSession]),
    )
    .execute();
  await database
    .deleteFrom("event_virtual_room")
    .where("eventSessionId", "in", [ids.session, ids.raceSession])
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
    .where("id", "in", [ids.session, ids.raceSession])
    .execute();
  await database
    .deleteFrom("event_occurrence")
    .where("id", "=", ids.occurrence)
    .execute();
  await database
    .deleteFrom("event_template_session_definition")
    .where("id", "in", [ids.definition, ids.raceDefinition])
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
