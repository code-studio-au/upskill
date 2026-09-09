import assert from "node:assert/strict";
import { sql } from "kysely";
import {
  EgressInfo,
  EgressStatus,
  EncodedFileType,
  FileOutput,
  Output,
  S3Upload,
  StartEgressRequest,
  StorageConfig,
  TemplateSource,
} from "livekit-server-sdk";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { removePlatformAdministrator } from "#/server/admin/admin-account.server";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import { destroyDatabase, getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import { getEventOperationsAccess } from "#/server/events/event-operations-access.server";
import { transitionAdminEventOccurrence } from "#/server/admin/admin-event-operations.server";
import {
  checkEventVirtualSessionProviderHealth,
  ensureEventVirtualRoomForStaff,
  findEventVirtualLobbyQueue,
  findEventVirtualSessionOperations,
  issueEventVirtualPresenterCredential,
  processAvailableEventVirtualRoomOperations,
  replaceEventVirtualRoom,
  setEventVirtualRoomAdmissionMode,
  transitionEventVirtualRoom,
  type VirtualRoomRuntime,
} from "#/server/events/event-virtual-room.server";
import { FakeLiveKitProvider } from "#/server/livekit/livekit-provider.fake";
import { ingestVerifiedLiveKitRecordingWebhook } from "#/server/livekit/livekit-recording-webhook.server";
import { FakeLiveKitRecordingProvider } from "#/server/livekit/livekit-recording-provider.fake";
import { eventVirtualPresenterIdentity } from "#/server/events/event-virtual-participant-identity.server";
import {
  type CreateLiveKitJoinTokenInput,
  LiveKitProviderError,
  type LiveKitJoinCredential,
  type EnsureLiveKitRoomInput,
  type LiveKitRoomSnapshot,
} from "#/server/livekit/livekit-provider.server";
import {
  LiveKitRecordingProviderError,
  parseLiveKitRecordingSnapshot,
  type LiveKitRecordingSnapshot,
  type PreparedLiveKitRoomCompositeRecording,
  type StartLiveKitRoomCompositeRecordingInput,
} from "#/server/livekit/livekit-recording-provider.server";

const ids = {
  template: "verify_livekit_room_template",
  version: "verify_livekit_room_version",
  definition: "verify_livekit_room_definition",
  raceDefinition: "verify_livekit_room_race_definition",
  failureDefinition: "verify_livekit_room_failure_definition",
  occurrence: "verify_livekit_room_occurrence",
  session: "verify_livekit_room_session",
  raceSession: "verify_livekit_room_race_session",
  failureSession: "verify_livekit_room_failure_session",
  region: "verify_livekit_room_region",
  occurrenceRegion: "verify_livekit_room_occurrence_region",
  administrator: "verify_livekit_room_administrator",
  presenter: "verify_livekit_room_presenter",
  wholePresenter: "verify_livekit_room_whole_presenter",
  coordinator: "verify_livekit_room_coordinator",
  platformAdministrator: "verify_livekit_room_platform_administrator",
  expiredPlatformAdministrator:
    "verify_livekit_room_expired_platform_administrator",
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
const expiredPlatformAdministrator = user(
  ids.expiredPlatformAdministrator,
  "Expired-token Platform Administrator",
);
const startsAt = new Date("2030-09-04T00:00:00.000Z");
const endsAt = new Date("2030-09-04T01:00:00.000Z");
const preparationTime = new Date("2030-09-03T23:30:00.000Z");
const providerRecordingStartedAt = new Date("2030-09-04T00:00:30.000Z");
const providerRecordingEndedAt = new Date("2030-09-04T00:02:00.000Z");
const recoveredProviderRecordingStartedAt = new Date(
  "2030-09-04T00:31:30.000Z",
);

function recordingWebhookEgress(input: {
  egressId: string;
  roomName: string;
  storageObjectKey: string;
  bucket?: string;
}): EgressInfo {
  return new EgressInfo({
    egressId: input.egressId,
    roomName: input.roomName,
    status: EgressStatus.EGRESS_ACTIVE,
    startedAt:
      BigInt(recoveredProviderRecordingStartedAt.getTime()) * 1_000_000n,
    request: {
      case: "egress",
      value: new StartEgressRequest({
        roomName: input.roomName,
        source: {
          case: "template",
          value: new TemplateSource({ layout: "speaker" }),
        },
        outputs: [
          new Output({
            config: {
              case: "file",
              value: new FileOutput({
                fileType: EncodedFileType.MP4,
                filepath: input.storageObjectKey,
                disableManifest: true,
              }),
            },
          }),
        ],
        storage: new StorageConfig({
          provider: {
            case: "s3",
            value: new S3Upload({
              region: "ap-southeast-2",
              bucket: input.bucket ?? "upskill-recordings",
            }),
          },
        }),
      }),
    },
  });
}

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

class FailFirstEnsureProvider extends FakeLiveKitProvider {
  private failed = false;
  private deferredClose:
    | {
        started: Promise<void>;
        waitForRelease: Promise<void>;
        signalStarted: () => void;
        release: () => void;
      }
    | undefined;

  override ensureRoom(
    input: EnsureLiveKitRoomInput,
  ): Promise<LiveKitRoomSnapshot> {
    if (!this.failed) {
      this.failed = true;
      return Promise.reject(new LiveKitProviderError("ensure_room"));
    }
    return super.ensureRoom(input);
  }

  deferNextClose(): {
    waitUntilStarted: () => Promise<void>;
    release: () => void;
  } {
    assert.equal(this.deferredClose, undefined);
    let signalStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const waitForRelease = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.deferredClose = {
      started,
      waitForRelease,
      signalStarted,
      release,
    };
    return {
      waitUntilStarted: () => started,
      release,
    };
  }

  override async closeRoom(roomName: string): Promise<void> {
    const deferredClose = this.deferredClose;
    if (deferredClose) {
      this.deferredClose = undefined;
      deferredClose.signalStarted();
      await deferredClose.waitForRelease;
    }
    await super.closeRoom(roomName);
  }
}

class LeaseCrossingLostResponseRecordingProvider extends FakeLiveKitRecordingProvider {
  private failFirstPreparation = true;
  private loseFirstStartResponse = true;
  private loseFirstStopResponse = false;
  private roomListingsRejected = false;
  private deferredStart:
    | {
        started: Promise<void>;
        waitForRelease: Promise<void>;
        signalStarted: () => void;
        release: () => void;
      }
    | undefined;

  deferNextStart(): {
    waitUntilStarted: () => Promise<void>;
    release: () => void;
  } {
    assert.equal(this.deferredStart, undefined);
    let signalStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const waitForRelease = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.deferredStart = {
      started,
      waitForRelease,
      signalStarted,
      release,
    };
    return { waitUntilStarted: () => started, release };
  }

  rejectRoomListings(): void {
    this.roomListingsRejected = true;
  }

  loseNextStopResponse(): void {
    this.loseFirstStopResponse = true;
  }

  override listRoomCompositeRecordings(
    roomName: string,
    storageObjectKey: string,
  ): Promise<LiveKitRecordingSnapshot[]> {
    if (this.roomListingsRejected)
      return Promise.reject(
        new LiveKitRecordingProviderError("list_recordings"),
      );
    return super.listRoomCompositeRecordings(roomName, storageObjectKey);
  }

  override async prepareRoomCompositeRecording(
    input: StartLiveKitRoomCompositeRecordingInput,
  ): Promise<PreparedLiveKitRoomCompositeRecording> {
    if (this.failFirstPreparation) {
      this.failFirstPreparation = false;
      throw new LiveKitRecordingProviderError("prepare_recording");
    }
    const prepared = await super.prepareRoomCompositeRecording(input);
    return {
      dispatch: async (): Promise<LiveKitRecordingSnapshot> => {
        const deferredStart = this.deferredStart;
        if (deferredStart) {
          this.deferredStart = undefined;
          deferredStart.signalStarted();
          await deferredStart.waitForRelease;
        }
        const snapshot = await prepared.dispatch();
        if (this.loseFirstStartResponse) {
          this.loseFirstStartResponse = false;
          this.recordings.set(
            snapshot.providerEgressId,
            parseLiveKitRecordingSnapshot({
              ...snapshot,
              status: "stopping",
              startedAt: providerRecordingStartedAt,
            }),
          );
          throw new LiveKitRecordingProviderError("start_recording");
        }
        const active = parseLiveKitRecordingSnapshot({
          ...snapshot,
          status: "active",
          startedAt: recoveredProviderRecordingStartedAt,
        });
        this.recordings.set(snapshot.providerEgressId, active);
        return active;
      },
    };
  }

  override async stopRoomCompositeRecording(
    target: Parameters<
      FakeLiveKitRecordingProvider["stopRoomCompositeRecording"]
    >[0],
  ): Promise<LiveKitRecordingSnapshot> {
    const snapshot = await super.stopRoomCompositeRecording(target);
    if (this.loseFirstStopResponse) {
      this.loseFirstStopResponse = false;
      throw new LiveKitRecordingProviderError("stop_recording");
    }
    return snapshot;
  }
}

class DeferredPreparationRecordingProvider extends FakeLiveKitRecordingProvider {
  private releasePreparation!: () => void;
  private signalPreparationStarted!: () => void;
  private readonly preparationStarted = new Promise<void>((resolve) => {
    this.signalPreparationStarted = resolve;
  });
  private readonly preparationRelease = new Promise<void>((resolve) => {
    this.releasePreparation = resolve;
  });

  waitUntilPreparationStarts(): Promise<void> {
    return this.preparationStarted;
  }

  release(): void {
    this.releasePreparation();
  }

  override async prepareRoomCompositeRecording(
    input: StartLiveKitRoomCompositeRecordingInput,
  ): Promise<PreparedLiveKitRoomCompositeRecording> {
    this.signalPreparationStarted();
    await this.preparationRelease;
    return super.prepareRoomCompositeRecording(input);
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

class AdvancingParticipantsProvider extends FakeLiveKitProvider {
  constructor(
    clock: () => Date,
    private readonly advance: () => void,
  ) {
    super(clock);
  }

  override async listParticipants(roomName: string) {
    const participants = await super.listParticipants(roomName);
    this.advance();
    return participants;
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

class DeferredFailingEnsureProvider extends DeferredEnsureProvider {
  override async ensureRoom(
    input: EnsureLiveKitRoomInput,
  ): Promise<LiveKitRoomSnapshot> {
    await super.ensureRoom(input);
    throw new LiveKitProviderError("ensure_room");
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
        expiredPlatformAdministrator,
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
      {
        userId: expiredPlatformAdministrator.id,
        grantedByUserId: platformAdministrator.id,
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
        {
          id: ids.failureDefinition,
          position: 2,
          title: "LiveKit failed-ensure session",
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
        {
          id: ids.failureSession,
          sessionDefinitionId: ids.failureDefinition,
          position: 2,
          title: "LiveKit failed-ensure session",
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
    .set({ recordingMode: "automatic", recordingRetentionDays: 30 })
    .where("id", "=", room.id)
    .executeTakeFirstOrThrow();
  const recordingRequestedAt = new Date("2030-09-03T23:31:30.000Z");
  const recordingId = "verify_livekit_room_recording";
  const recordingValues = {
    id: recordingId,
    roomId: room.id,
    eventSessionId: ids.session,
    roomGeneration: room.generation,
    provider: "livekit" as const,
    recordingMode: "automatic" as const,
    status: "requested" as const,
    providerEgressId: null,
    storageObjectKey: "recordings/opaque_room/opaque_recording.mp4",
    retentionDays: 30,
    attendeeNoticeDigest: "a".repeat(43),
    presenterNoticeDigest: "p".repeat(43),
    requestedByUserId: administrator.id,
    requestedAt: recordingRequestedAt,
    startedAt: null,
    stopRequestedByUserId: null,
    stopRequestedAt: null,
    endedAt: null,
    completedAt: null,
    fileSizeBytes: null,
    durationNanoseconds: null,
    retentionDeadline: null,
    failureCode: null,
    deletedByUserId: null,
    deletedAt: null,
    deletionReason: null,
    updatedAt: recordingRequestedAt,
  };
  for (const initialStatus of [
    "starting",
    "active",
    "stopping",
    "complete",
    "failed",
    "deleted",
  ] as const)
    await assert.rejects(
      database
        .insertInto("event_virtual_recording")
        .values({
          ...recordingValues,
          id: `verify_livekit_forged_${initialStatus}`,
          status: initialStatus,
          storageObjectKey: `recordings/opaque_room/forged_${initialStatus}.mp4`,
        })
        .executeTakeFirstOrThrow(),
      {
        code: "23514",
        message: /Recording evidence must begin in the requested state/u,
      },
    );
  await database
    .insertInto("event_virtual_recording")
    .values(recordingValues)
    .executeTakeFirstOrThrow();
  const unclassifiedFailureAt = new Date("2030-09-03T23:31:45.000Z");
  await assertDatabaseConstraint(
    () =>
      database
        .updateTable("event_virtual_recording")
        .set({
          status: "failed",
          completedAt: unclassifiedFailureAt,
          failureCode: null,
          updatedAt: unclassifiedFailureAt,
        })
        .where("id", "=", recordingId)
        .executeTakeFirstOrThrow(),
    "23514",
    "event_virtual_recording_state_ck",
  );
  await assert.rejects(
    database
      .updateTable("event_virtual_recording")
      .set({
        storageObjectKey: "recordings/other_room/other_recording.mp4",
      })
      .where("id", "=", recordingId)
      .executeTakeFirstOrThrow(),
    {
      code: "23514",
      message: /Recording contractual evidence is immutable/u,
    },
  );
  await assertDatabaseConstraint(
    () =>
      database
        .insertInto("event_virtual_recording")
        .values({
          ...recordingValues,
          id: "verify_livekit_room_recording_duplicate",
          storageObjectKey:
            "recordings/opaque_room/opaque_recording_duplicate.mp4",
        })
        .executeTakeFirstOrThrow(),
    "23505",
    "event_virtual_recording_room_uq",
  );
  await assert.rejects(
    database
      .updateTable("event_virtual_recording")
      .set({ roomGeneration: room.generation + 1 })
      .where("id", "=", recordingId)
      .executeTakeFirstOrThrow(),
    {
      code: "23514",
      message: /Recording contractual evidence is immutable/u,
    },
  );
  await assert.rejects(
    database
      .updateTable("event_virtual_recording")
      .set({ status: "active" })
      .where("id", "=", recordingId)
      .executeTakeFirstOrThrow(),
    {
      code: "23514",
      message: /Recording lifecycle transition is not allowed/u,
    },
  );
  await assertDatabaseConstraint(
    () =>
      database
        .updateTable("event_virtual_room")
        .set({ recordingMode: "off", recordingRetentionDays: null })
        .where("id", "=", room.id)
        .executeTakeFirstOrThrow(),
    "23503",
    "event_virtual_recording_room_fk",
  );
  const recordingStartedAt = new Date("2030-09-03T23:32:00.000Z");
  const recordingEndedAt = new Date("2030-09-04T00:32:00.000Z");
  const recordingCompletedAt = new Date("2030-09-04T00:33:00.000Z");
  const retentionDeadline = new Date("2030-10-04T00:33:00.000Z");
  await database
    .updateTable("event_virtual_recording")
    .set({
      status: "starting",
      providerEgressId: "EG_VERIFY_1",
      updatedAt: recordingStartedAt,
    })
    .where("id", "=", recordingId)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("event_virtual_recording")
    .set({
      status: "active",
      startedAt: recordingStartedAt,
      updatedAt: recordingStartedAt,
    })
    .where("id", "=", recordingId)
    .executeTakeFirstOrThrow();
  await assert.rejects(
    database
      .updateTable("event_virtual_recording")
      .set({ status: "requested" })
      .where("id", "=", recordingId)
      .executeTakeFirstOrThrow(),
    {
      code: "23514",
      message: /Recording lifecycle transition is not allowed/u,
    },
  );
  for (const invalidRetentionDeadline of [
    new Date("2030-09-05T00:33:00.000Z"),
    new Date("2030-10-05T00:33:00.000Z"),
  ])
    await assertDatabaseConstraint(
      () =>
        database
          .updateTable("event_virtual_recording")
          .set({
            status: "complete",
            endedAt: recordingEndedAt,
            completedAt: recordingCompletedAt,
            fileSizeBytes: 1_048_576,
            durationNanoseconds: 3_600_000_000_000n,
            retentionDeadline: invalidRetentionDeadline,
            updatedAt: recordingCompletedAt,
          })
          .where("id", "=", recordingId)
          .executeTakeFirstOrThrow(),
      "23514",
      "event_virtual_recording_timeline_ck",
    );
  await database
    .updateTable("event_virtual_recording")
    .set({
      status: "complete",
      endedAt: recordingEndedAt,
      completedAt: recordingCompletedAt,
      fileSizeBytes: 1_048_576,
      durationNanoseconds: 3_600_000_000_000n,
      retentionDeadline,
      updatedAt: recordingCompletedAt,
    })
    .where("id", "=", recordingId)
    .executeTakeFirstOrThrow();
  await assert.rejects(
    database
      .updateTable("event_virtual_recording")
      .set({ updatedAt: new Date("2030-09-04T00:34:00.000Z") })
      .where("id", "=", recordingId)
      .executeTakeFirstOrThrow(),
    {
      code: "23514",
      message: /Completed recording evidence is immutable/u,
    },
  );
  await assertDatabaseConstraint(
    () =>
      database
        .updateTable("event_virtual_recording")
        .set({
          status: "deleted",
          deletedByUserId: administrator.id,
          deletedAt: new Date("2030-09-04T00:34:00.000Z"),
          deletionReason: "retention_expired",
          updatedAt: new Date("2030-09-04T00:34:00.000Z"),
        })
        .where("id", "=", recordingId)
        .executeTakeFirstOrThrow(),
    "23514",
    "event_virtual_recording_timeline_ck",
  );
  const recordingDeletedAt = new Date("2030-10-04T00:34:00.000Z");
  await database
    .updateTable("event_virtual_recording")
    .set({
      status: "deleted",
      deletedByUserId: administrator.id,
      deletedAt: recordingDeletedAt,
      deletionReason: "retention_expired",
      updatedAt: recordingDeletedAt,
    })
    .where("id", "=", recordingId)
    .executeTakeFirstOrThrow();
  await assert.rejects(
    database
      .updateTable("event_virtual_recording")
      .set({ updatedAt: new Date("2030-10-04T00:35:00.000Z") })
      .where("id", "=", recordingId)
      .executeTakeFirstOrThrow(),
    {
      code: "23514",
      message: /Terminal recording evidence is immutable/u,
    },
  );
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_recording")
      .select([
        "status",
        "providerEgressId",
        "storageObjectKey",
        "retentionDays",
        "deletedAt",
        "deletionReason",
      ])
      .where("id", "=", recordingId)
      .executeTakeFirstOrThrow(),
    {
      status: "deleted",
      providerEgressId: "EG_VERIFY_1",
      storageObjectKey: "recordings/opaque_room/opaque_recording.mp4",
      retentionDays: 30,
      deletedAt: recordingDeletedAt,
      deletionReason: "retention_expired",
    },
    "Recording completion and deletion must retain the logical evidence row",
  );
  await database
    .deleteFrom("event_virtual_recording")
    .where("id", "=", recordingId)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("event_virtual_room")
    .set({ recordingMode: "off", recordingRetentionDays: null })
    .where("id", "=", room.id)
    .executeTakeFirstOrThrow();
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
  let delayedPresenterNow = providerRetryTime;
  const expiredPresenterRuntime: VirtualRoomRuntime = {
    ...runtime,
    provider: new AdvancingParticipantsProvider(
      () => delayedPresenterNow,
      () => {
        delayedPresenterNow = new Date(
          providerRetryTime.getTime() + 5 * 60_000,
        );
      },
    ),
  };
  assert.deepEqual(
    await issueEventVirtualPresenterCredential(
      ids.occurrence,
      ids.session,
      presenter,
      {
        runtime: expiredPresenterRuntime,
        clock: () => delayedPresenterNow,
      },
    ),
    { status: "conflict", reason: "provider_unavailable" },
    "A presenter credential that expires before reservation must be retried",
  );
  assert.equal(
    await database
      .selectFrom("event_virtual_presenter_credential_reservation")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("roomId", "=", room.id)
      .where("userId", "=", presenter.id)
      .executeTakeFirstOrThrow()
      .then((result) => result.count),
    0,
    "An expired presenter credential must not reserve capacity",
  );
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
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_presenter_credential_reservation")
      .select(["roomId", "userId", "credentialExpiresAt"])
      .where("roomId", "=", room.id)
      .where("userId", "=", presenter.id)
      .executeTakeFirstOrThrow(),
    {
      roomId: room.id,
      userId: presenter.id,
      credentialExpiresAt: new Date("2030-09-03T23:37:00.000Z"),
    },
    "Presenter issuance must reserve provider capacity through token expiry",
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
  const laterOutstandingExpiry = new Date("2030-09-03T23:40:00.000Z");
  await database
    .updateTable("event_virtual_presenter_credential_reservation")
    .set({ credentialExpiresAt: laterOutstandingExpiry })
    .where("roomId", "=", room.id)
    .where("userId", "=", presenter.id)
    .executeTakeFirstOrThrow();
  fakeProvider.participants.set(
    room.providerRoomName,
    Array.from({ length: 24 }, (_, index) => ({
      sid: `existing-participant-${String(index)}`,
      identity: `existing-participant-${String(index)}`,
      displayName: `Existing participant ${String(index)}`,
    })),
  );
  assert.equal(
    (
      await issueEventVirtualPresenterCredential(
        ids.occurrence,
        ids.session,
        presenter,
        { runtime, clock: () => providerRetryTime },
      )
    ).status,
    "ready",
    "A presenter must be able to refresh their own reserved credential",
  );
  assert.equal(
    (
      await database
        .selectFrom("event_virtual_presenter_credential_reservation")
        .select("credentialExpiresAt")
        .where("roomId", "=", room.id)
        .where("userId", "=", presenter.id)
        .executeTakeFirstOrThrow()
    ).credentialExpiresAt.toISOString(),
    laterOutstandingExpiry.toISOString(),
    "A delayed token response must not shorten a newer outstanding reservation",
  );
  assert.deepEqual(
    await issueEventVirtualPresenterCredential(
      ids.occurrence,
      ids.session,
      wholePresenter,
      { runtime, clock: () => providerRetryTime },
    ),
    { status: "conflict", reason: "capacity_exceeded" },
    "Outstanding presenter credentials must consume the serialized room capacity",
  );
  assert.equal(
    await database
      .selectFrom("event_virtual_presenter_credential_reservation")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("roomId", "=", room.id)
      .executeTakeFirstOrThrow()
      .then((result) => result.count),
    1,
    "A rejected presenter token must not reserve capacity",
  );
  fakeProvider.participants.set(room.providerRoomName, []);
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
  const presenterTokenDenialReasons = new Set(
    (
      await database
        .selectFrom("audit_event")
        .select("reason")
        .where("action", "=", "event_virtual_room.presenter_token_denied")
        .execute()
    ).map((audit) => audit.reason),
  );
  for (const reason of [
    "forbidden",
    "capacity_exceeded",
    "occurrence_unavailable",
    "room_not_ready",
    "session_ended",
  ])
    assert.ok(
      presenterTokenDenialReasons.has(reason),
      `Presenter credential denial ${reason} must be durably audited`,
    );

  const administratorAccess = await getEventOperationsAccess(
    administrator,
    ids.occurrence,
  );
  assert.ok(administratorAccess?.isAssignedAdministrator);
  assert.equal(administratorAccess.isPlatformAdministrator, true);
  const administratorVirtualSessions = await findEventVirtualSessionOperations(
    ids.occurrence,
    administratorAccess,
    preparationTime,
  );
  assert.deepEqual(
    administratorVirtualSessions.map((session) => session.eventSessionId),
    [ids.session, ids.raceSession, ids.failureSession],
  );
  assert.equal(
    administratorVirtualSessions.find(
      (session) => session.eventSessionId === ids.session,
    )?.presenterRecordingNotice,
    "This webinar is recorded.",
    "The operations workspace must expose the immutable presenter notice before green-room entry",
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

  const expiredPresenterIssuedAt = new Date(Date.now() - 10 * 60_000);
  const expiredPresenterCredentialAt = new Date(
    expiredPresenterIssuedAt.getTime() + 5 * 60_000,
  );
  await database
    .insertInto("event_virtual_presenter_credential_reservation")
    .values({
      roomId: room.id,
      userId: expiredPlatformAdministrator.id,
      firstTokenIssuedAt: expiredPresenterIssuedAt,
      lastTokenIssuedAt: expiredPresenterIssuedAt,
      credentialExpiresAt: expiredPresenterCredentialAt,
    })
    .execute();
  const expiredPlatformIdentity = eventVirtualPresenterIdentity(
    room.id,
    expiredPlatformAdministrator.id,
  );
  fakeProvider.participants.set(room.providerRoomName, [
    {
      sid: "expired-platform-administrator-participant",
      identity: expiredPlatformIdentity,
      displayName: expiredPlatformAdministrator.name,
    },
  ]);
  assert.deepEqual(
    await removePlatformAdministrator(
      expiredPlatformAdministrator.id,
      administrator,
    ),
    { status: "revoked" },
  );
  const expiredPresenterRemoval = await database
    .selectFrom("event_virtual_room_operation")
    .select(["id", "status", "participantIdentity"])
    .where("roomId", "=", room.id)
    .where("kind", "=", "remove_participant")
    .where("targetKey", "=", `presenter:${expiredPlatformAdministrator.id}`)
    .executeTakeFirstOrThrow();
  assert.equal(expiredPresenterRemoval.status, "pending");
  assert.equal(
    expiredPresenterRemoval.participantIdentity,
    expiredPlatformIdentity,
  );
  await processAvailableEventVirtualRoomOperations(10, {
    runtime,
    now: new Date(),
  });
  assert.equal(
    await database
      .selectFrom("event_virtual_room_operation")
      .select("status")
      .where("id", "=", expiredPresenterRemoval.id)
      .executeTakeFirstOrThrow()
      .then((operation) => operation.status),
    "succeeded",
    "Expired presenter credentials must still trigger one provider removal pass",
  );
  assert.deepEqual(fakeProvider.participants.get(room.providerRoomName), []);

  assert.deepEqual(
    await checkEventVirtualSessionProviderHealth(
      ids.occurrence,
      ids.session,
      platformAdministrator.id,
      runtime,
    ),
    { status: "ready" },
  );
  const platformCredential = await issueEventVirtualPresenterCredential(
    ids.occurrence,
    ids.session,
    platformAdministrator,
    { runtime, clock: () => providerRetryTime },
  );
  assert.equal(platformCredential.status, "ready");
  const platformIdentity = eventVirtualPresenterIdentity(
    room.id,
    platformAdministrator.id,
  );
  fakeProvider.participants.set(room.providerRoomName, [
    {
      sid: "platform-administrator-participant",
      identity: platformIdentity,
      displayName: platformAdministrator.name,
    },
  ]);
  assert.deepEqual(
    await removePlatformAdministrator(platformAdministrator.id, administrator),
    { status: "revoked" },
  );
  const presenterRemoval = await database
    .selectFrom("event_virtual_room_operation")
    .select(["id", "status", "participantIdentity"])
    .where("roomId", "=", room.id)
    .where("kind", "=", "remove_participant")
    .where("targetKey", "=", `presenter:${platformAdministrator.id}`)
    .executeTakeFirstOrThrow();
  assert.equal(presenterRemoval.status, "pending");
  assert.equal(presenterRemoval.participantIdentity, platformIdentity);
  const firstPresenterRemoval =
    await processAvailableEventVirtualRoomOperations(10, {
      runtime,
      now: providerRetryTime,
    });
  assert.ok(
    firstPresenterRemoval.outcomes.some(
      (outcome) =>
        outcome.kind === "remove_participant" && outcome.status === "pending",
    ),
  );
  assert.deepEqual(fakeProvider.participants.get(room.providerRoomName), []);
  assert.deepEqual(
    await issueEventVirtualPresenterCredential(
      ids.occurrence,
      ids.session,
      platformAdministrator,
      { runtime, clock: () => providerRetryTime },
    ),
    { status: "forbidden" },
    "Revoking a platform role must prevent presenter credential refresh",
  );
  const platformCredentialExpiry = new Date(
    platformCredential.credential.expiresAt,
  );
  const completedPresenterRemoval =
    await processAvailableEventVirtualRoomOperations(10, {
      runtime,
      now: platformCredentialExpiry,
    });
  assert.ok(
    completedPresenterRemoval.outcomes.some(
      (outcome) =>
        outcome.kind === "remove_participant" && outcome.status === "processed",
    ),
    "Presenter removal must remain enforced until the issued credential expires",
  );
  await database
    .updateTable("event_virtual_room_operation")
    .set({ attempts: 6, lastAttemptAt: platformCredentialExpiry })
    .where("id", "=", presenterRemoval.id)
    .executeTakeFirstOrThrow();
  await database
    .insertInto("platform_admin")
    .values({
      userId: platformAdministrator.id,
      grantedByUserId: administrator.id,
    })
    .execute();
  assert.deepEqual(
    await removePlatformAdministrator(platformAdministrator.id, administrator),
    { status: "revoked" },
  );
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_room_operation")
      .select(["status", "attempts", "lastAttemptAt"])
      .where("id", "=", presenterRemoval.id)
      .executeTakeFirstOrThrow(),
    { status: "pending", attempts: 0, lastAttemptAt: null },
    "Reopening a presenter removal must start a fresh retry cycle",
  );
  const reopenedPresenterRemoval =
    await processAvailableEventVirtualRoomOperations(10, {
      runtime,
      now: platformCredentialExpiry,
    });
  assert.ok(
    reopenedPresenterRemoval.outcomes.some(
      (outcome) =>
        outcome.operationId === presenterRemoval.id &&
        outcome.status === "processed",
    ),
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
  const originalJoinAccess = await database
    .selectFrom("event_virtual_join_access")
    .select(["id", "publicReference", "roomGeneration"])
    .where("eventSessionId", "=", ids.session)
    .where("revokedAt", "is", null)
    .executeTakeFirstOrThrow();
  assert.equal(originalJoinAccess.roomGeneration, 1);
  assert.deepEqual(
    await replaceEventVirtualRoom(ids.occurrence, ids.session, administrator, {
      clock: () => replacementTime,
    }),
    { status: "ready" },
  );
  const replacementJoinAccess = await database
    .selectFrom("event_virtual_join_access")
    .select(["id", "publicReference", "roomGeneration"])
    .where("eventSessionId", "=", ids.session)
    .where("revokedAt", "is", null)
    .executeTakeFirstOrThrow();
  assert.equal(replacementJoinAccess.roomGeneration, 2);
  assert.notEqual(replacementJoinAccess.id, originalJoinAccess.id);
  assert.notEqual(
    replacementJoinAccess.publicReference,
    originalJoinAccess.publicReference,
  );
  assert.ok(
    await database
      .selectFrom("event_virtual_join_access")
      .select("revokedAt")
      .where("id", "=", originalJoinAccess.id)
      .executeTakeFirstOrThrow()
      .then((row) => row.revokedAt),
    "Replacing a room must revoke access to its previous generation",
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
  assert.deepEqual(
    await setEventVirtualRoomAdmissionMode(
      ids.occurrence,
      ids.session,
      "automatic",
      administrator,
      { clock: () => endsAt },
    ),
    { status: "conflict", reason: "session_ended" },
    "Auto-admit must not activate after a scheduled session expires",
  );
  assert.equal(
    await database
      .selectFrom("event_virtual_room")
      .select("admissionMode")
      .where("eventSessionId", "=", ids.session)
      .where("replacedAt", "is", null)
      .executeTakeFirstOrThrow()
      .then((currentRoom) => currentRoom.admissionMode),
    "manual",
    "An expired auto-admit request must not mutate room policy",
  );

  await database
    .updateTable("event_virtual_room")
    .set({ recordingMode: "automatic", recordingRetentionDays: 30 })
    .where("eventSessionId", "=", ids.session)
    .where("replacedAt", "is", null)
    .executeTakeFirstOrThrow();
  const recordingProvider = new LeaseCrossingLostResponseRecordingProvider();
  const recordingRuntime: VirtualRoomRuntime = {
    ...runtime,
    recordingProvider,
  };

  const startRoom = await database
    .selectFrom("event_virtual_room")
    .select(["id", "providerRoomName"])
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
      { runtime: recordingRuntime, clock: () => startsAt },
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
  const failedRecordingPreparation =
    await processAvailableEventVirtualRoomOperations(1, {
      runtime: recordingRuntime,
      now: startsAt,
    });
  assert.equal(failedRecordingPreparation.outcomes[0]?.kind, "start_recording");
  assert.equal(failedRecordingPreparation.outcomes[0].status, "retry");
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_room_operation")
      .select(["recordingStartDispatchedAt", "lastErrorCode"])
      .where("roomId", "=", startRoom.id)
      .where("kind", "=", "start_recording")
      .executeTakeFirstOrThrow(),
    {
      recordingStartDispatchedAt: null,
      lastErrorCode: "livekit_recording_prepare_recording",
    },
    "A retryable upload-authorization failure must not set the durable LiveKit dispatch fence",
  );
  assert.deepEqual(
    (
      await findEventVirtualSessionOperations(
        ids.occurrence,
        administratorAccess,
        startsAt,
      )
    ).find((session) => session.eventSessionId === ids.session)?.recording,
    {
      status: "requested",
      warning:
        "Automatic recording is delayed. Background retries are continuing; ask an administrator to check the recording service if this persists.",
    },
    "The operations workspace must expose a recording operation under retry without leaking its provider error",
  );
  const retryingRecordingQueue = await findEventVirtualLobbyQueue(
    ids.occurrence,
    ids.session,
    administrator.id,
    0,
  );
  assert.equal(retryingRecordingQueue.status, "ready");
  assert.deepEqual(
    retryingRecordingQueue.data.recording,
    {
      status: "requested",
      warning:
        "Automatic recording is delayed. Background retries are continuing; ask an administrator to check the recording service if this persists.",
    },
    "The live learner-list poll must refresh recording retry status for staff",
  );
  assert.equal(
    recordingProvider.operations.filter(
      (operation) => operation.operation === "start_recording",
    ).length,
    0,
  );
  const recordingDispatchAt = new Date(startsAt.getTime() + 30_001);
  const deferredRecordingStart = recordingProvider.deferNextStart();
  const firstRecordingAttempt = processAvailableEventVirtualRoomOperations(1, {
    runtime: recordingRuntime,
    now: recordingDispatchAt,
  });
  const firstRecordingProgress = await Promise.race([
    deferredRecordingStart
      .waitUntilStarted()
      .then(() => ({ state: "started" as const })),
    firstRecordingAttempt.then((batch) => ({
      state: "completed" as const,
      batch,
    })),
  ]);
  assert.equal(
    firstRecordingProgress.state,
    "started",
    firstRecordingProgress.state === "completed"
      ? `Expected recording dispatch to start, received ${JSON.stringify(firstRecordingProgress.batch)}`
      : "Expected recording dispatch to start",
  );
  const reclaimedRecordingAttempt =
    await processAvailableEventVirtualRoomOperations(1, {
      runtime: recordingRuntime,
      now: new Date(recordingDispatchAt.getTime() + 2 * 60_000 + 1),
    });
  assert.equal(reclaimedRecordingAttempt.outcomes[0]?.kind, "start_recording");
  assert.equal(reclaimedRecordingAttempt.outcomes[0].status, "retry");
  assert.equal(
    recordingProvider.operations.filter(
      (operation) => operation.operation === "start_recording",
    ).length,
    0,
    "A reclaimed operation must not dispatch a second start while the first provider request remains in flight",
  );
  deferredRecordingStart.release();
  const staleRecordingAttempt = await firstRecordingAttempt;
  assert.equal(staleRecordingAttempt.outcomes[0]?.kind, "start_recording");
  assert.equal(staleRecordingAttempt.outcomes[0].status, "retry");
  const recordingReconciledAt = new Date(
    recordingDispatchAt.getTime() + 4 * 60_000 + 2,
  );
  const reconciledRecordingAttempt =
    await processAvailableEventVirtualRoomOperations(1, {
      runtime: recordingRuntime,
      now: recordingReconciledAt,
    });
  assert.equal(reconciledRecordingAttempt.outcomes[0]?.kind, "start_recording");
  assert.equal(reconciledRecordingAttempt.outcomes[0].status, "retry");
  assert.equal(
    recordingProvider.operations.filter(
      (operation) => operation.operation === "start_recording",
    ).length,
    1,
    "A lease-crossing lost response must reconcile the exact object instead of starting a second Egress",
  );
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_room_operation")
      .select(["status", "lastErrorCode"])
      .where("roomId", "=", startRoom.id)
      .where("kind", "=", "start_recording")
      .executeTakeFirstOrThrow(),
    { status: "pending", lastErrorCode: "recording_start_pending" },
    "A stopping snapshot found after an ambiguous start must remain under reconciliation",
  );
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_recording")
      .select(["status", "providerEgressId"])
      .where("eventSessionId", "=", ids.session)
      .executeTakeFirstOrThrow(),
    { status: "requested", providerEgressId: null },
    "A stopping provider snapshot must not be flattened into durable starting evidence",
  );
  const stoppingRecording = recordingProvider.recordings.get("EG_FAKE_1");
  assert.ok(stoppingRecording);
  const reconciledRecording = await database
    .selectFrom("event_virtual_recording")
    .select("id")
    .where("eventSessionId", "=", ids.session)
    .executeTakeFirstOrThrow();
  const queuedStopRequestedAt = new Date(
    recordingReconciledAt.getTime() + 1_000,
  );
  await database.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("event_virtual_room_operation")
      .values({
        id: "verify_livekit_reconciled_terminal_stop_operation",
        roomId: startRoom.id,
        kind: "stop_recording",
        targetKey: reconciledRecording.id,
        recordingId: reconciledRecording.id,
        deduplicationKey: `event_virtual_room:${startRoom.id}:stop_recording:${reconciledRecording.id}`,
        status: "pending",
        availableAt: new Date(recordingReconciledAt.getTime() + 4 * 60_000 + 2),
        leasedUntil: null,
        lastAttemptAt: null,
        completedAt: null,
        lastErrorCode: null,
        requestedByUserId: administrator.id,
        createdAt: queuedStopRequestedAt,
      })
      .executeTakeFirstOrThrow();
    await recordDurableAuditEvent(transaction, {
      actorUserId: administrator.id,
      action: "event_virtual_recording.stop_requested",
      subjectType: "event_virtual_recording",
      subjectId: reconciledRecording.id,
      aggregateId: startRoom.id,
      metadata: {
        roomId: startRoom.id,
        eventSessionId: ids.session,
        roomGeneration: 1,
        status: "requested",
      },
      createdAt: queuedStopRequestedAt,
    });
  });
  recordingProvider.recordings.set(
    stoppingRecording.providerEgressId,
    parseLiveKitRecordingSnapshot({
      ...stoppingRecording,
      status: "complete",
      endedAt: providerRecordingEndedAt,
      output: {
        storageObjectKey: stoppingRecording.storageObjectKey,
        fileSizeBytes: 2_048n,
        durationNanoseconds: 90_000_000_000n,
      },
    }),
  );
  const recordingTerminalReconciledAt = new Date(
    recordingReconciledAt.getTime() + 4 * 60_000 + 1,
  );
  const terminalStartRecordingAttempt =
    await processAvailableEventVirtualRoomOperations(1, {
      runtime: recordingRuntime,
      now: recordingTerminalReconciledAt,
    });
  assert.equal(
    terminalStartRecordingAttempt.outcomes[0]?.kind,
    "start_recording",
  );
  assert.equal(terminalStartRecordingAttempt.outcomes[0].status, "processed");
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_recording")
      .select([
        "status",
        "providerEgressId",
        "startedAt",
        "endedAt",
        "completedAt",
        "fileSizeBytes",
        "durationNanoseconds",
        "retentionDeadline",
        "failureCode",
        "stopRequestedByUserId",
        "stopRequestedAt",
      ])
      .where("eventSessionId", "=", ids.session)
      .executeTakeFirstOrThrow(),
    {
      status: "complete",
      providerEgressId: "EG_FAKE_1",
      startedAt: providerRecordingStartedAt,
      endedAt: providerRecordingEndedAt,
      completedAt: recordingTerminalReconciledAt,
      fileSizeBytes: "2048",
      durationNanoseconds: "90000000000",
      retentionDeadline: new Date(
        recordingTerminalReconciledAt.getTime() + 30 * 24 * 60 * 60_000,
      ),
      failureCode: null,
      stopRequestedByUserId: administrator.id,
      stopRequestedAt: queuedStopRequestedAt,
    },
    "A completed Egress found after a lost start response must retain its verified output and queued stop evidence",
  );
  const reconciledTerminalStop =
    await processAvailableEventVirtualRoomOperations(1, {
      runtime: recordingRuntime,
      now: new Date(recordingTerminalReconciledAt.getTime() + 1),
    });
  assert.deepEqual(
    reconciledTerminalStop.outcomes.map((outcome) => ({
      kind: outcome.kind,
      status: outcome.status,
    })),
    [{ kind: "stop_recording", status: "processed" }],
    "A queued stop may settle after terminal start reconciliation without losing its immutable request evidence",
  );
  const idempotentStartProvider = new FailFirstEnsureProvider();
  assert.deepEqual(
    await transitionEventVirtualRoom(
      ids.occurrence,
      ids.session,
      "start",
      administrator,
      {
        runtime: { ...runtime, provider: idempotentStartProvider },
        clock: () => startsAt,
      },
    ),
    { status: "ready" },
    "A lost-response Start retry must return ready without requiring provider availability",
  );
  assert.equal(
    idempotentStartProvider.operations.length,
    0,
    "An already-open Start retry must not reconcile the provider again",
  );
  assert.equal(
    await database
      .selectFrom("event_virtual_room")
      .select("providerStatus")
      .where("eventSessionId", "=", ids.session)
      .where("replacedAt", "is", null)
      .executeTakeFirstOrThrow()
      .then((currentRoom) => currentRoom.providerStatus),
    "ready",
  );
  assert.deepEqual(
    await setEventVirtualRoomAdmissionMode(
      ids.occurrence,
      ids.session,
      "automatic",
      wholePresenter,
      { clock: () => startsAt },
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
    runtime: recordingRuntime,
    now: recoveryEndTime,
  });
  assert.deepEqual(
    closeBatch.outcomes.map((outcome) => outcome.kind),
    ["close_room"],
  );
  assert.equal(
    await database
      .selectFrom("event_virtual_recording")
      .select("status")
      .where("eventSessionId", "=", ids.session)
      .executeTakeFirstOrThrow()
      .then((recording) => recording.status),
    "complete",
  );
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
    .select([
      "id",
      "generation",
      "doorState",
      "providerStatus",
      "providerRoomName",
    ])
    .where("eventSessionId", "=", ids.session)
    .where("replacedAt", "is", null)
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    {
      generation: recoveredRoom.generation,
      doorState: recoveredRoom.doorState,
      providerStatus: recoveredRoom.providerStatus,
    },
    {
      generation: 3,
      doorState: "scheduled",
      providerStatus: "ready",
    },
  );
  assert.deepEqual(
    await transitionEventVirtualRoom(
      ids.occurrence,
      ids.session,
      "start",
      administrator,
      { runtime: recordingRuntime, clock: () => recoveryTime },
    ),
    { status: "ready" },
  );
  const recoveredRecordingStartAt = new Date(recoveryTime.getTime() + 1);
  const recoveredRecordingStart =
    await processAvailableEventVirtualRoomOperations(10, {
      runtime: recordingRuntime,
      now: recoveredRecordingStartAt,
    });
  assert.deepEqual(
    recoveredRecordingStart.outcomes.map((outcome) => outcome.kind),
    ["start_recording"],
  );
  const recoveredRecording = await database
    .selectFrom("event_virtual_recording")
    .select(["id", "providerEgressId", "storageObjectKey", "status"])
    .where("roomId", "=", recoveredRoom.id)
    .executeTakeFirstOrThrow();
  assert.equal(
    recoveredRecording.status,
    "active",
    "An active StartEgress response must be persisted as active",
  );
  assert.ok(recoveredRecording.providerEgressId);
  const recordingWebhookEvent = {
    providerEnvironment: "test" as const,
    providerEventId: "EV_VerifyRecordingUpdate1",
    event: "egress_updated" as const,
    createdAtSeconds: Math.floor(recoveredRecordingStartAt.getTime() / 1_000),
    payloadDigest: "a".repeat(64),
    roomName: recoveredRoom.providerRoomName,
    egressId: recoveredRecording.providerEgressId,
    egressInfo: recordingWebhookEgress({
      egressId: recoveredRecording.providerEgressId,
      roomName: recoveredRoom.providerRoomName,
      storageObjectKey: recoveredRecording.storageObjectKey,
    }),
  };
  const recordingWebhookReceivedAt = new Date(
    recoveredRecordingStartAt.getTime() + 1,
  );
  const recordingWebhookEnvironment = {
    ...getServerEnv(),
    LIVEKIT_PROJECT_ENVIRONMENT: "test" as const,
    AWS_REGION: "ap-southeast-2",
    S3_RECORDING_BUCKET: "upskill-recordings",
  };
  const firstRecordingWebhook = await ingestVerifiedLiveKitRecordingWebhook(
    recordingWebhookEvent,
    database,
    recordingWebhookEnvironment,
    () => recordingWebhookReceivedAt,
  );
  assert.equal(firstRecordingWebhook.status, "pending");
  assert.deepEqual(
    await database
      .selectFrom("livekit_webhook_receipt")
      .select([
        "processingState",
        "matchedRecordingId",
        "matchedRoomId",
        "normalizedStatus",
        "startedAt",
        "endedAt",
        "fileSizeBytes",
        "durationNanoseconds",
        "failureCode",
      ])
      .where("providerEnvironment", "=", "test")
      .where("providerEventId", "=", recordingWebhookEvent.providerEventId)
      .executeTakeFirstOrThrow(),
    {
      processingState: "pending",
      matchedRecordingId: recoveredRecording.id,
      matchedRoomId: recoveredRoom.id,
      normalizedStatus: "active",
      startedAt: recoveredProviderRecordingStartedAt,
      endedAt: null,
      fileSizeBytes: null,
      durationNanoseconds: null,
      failureCode: null,
    },
    "A signed Egress update must retain only normalized evidence for the exact recording target",
  );
  await assert.rejects(
    database
      .updateTable("livekit_webhook_receipt")
      .set({ payloadDigest: "e".repeat(64) })
      .where("providerEventId", "=", recordingWebhookEvent.providerEventId)
      .execute(),
    /Webhook receipt identity evidence is immutable/u,
    "A valid replacement digest must not rewrite original receipt identity evidence",
  );
  await assert.rejects(
    database
      .updateTable("livekit_webhook_receipt")
      .set({
        startedAt: new Date(recoveredProviderRecordingStartedAt.getTime() + 1),
      })
      .where("providerEventId", "=", recordingWebhookEvent.providerEventId)
      .execute(),
    /Webhook receipt normalized evidence is immutable/u,
    "A valid replacement snapshot must not rewrite normalized provider evidence",
  );
  await assert.rejects(
    database
      .updateTable("livekit_webhook_receipt")
      .set({
        processingState: "processed",
        processingAttempts: 1,
        lastAttemptAt: recordingWebhookReceivedAt,
        processedAt: recordingWebhookReceivedAt,
      })
      .where("providerEventId", "=", recordingWebhookEvent.providerEventId)
      .execute(),
    /Webhook receipt claim transition is not allowed/u,
    "Receipt processing must follow the constrained claim transition",
  );
  assert.equal(
    (
      await ingestVerifiedLiveKitRecordingWebhook(
        recordingWebhookEvent,
        database,
        recordingWebhookEnvironment,
        () => new Date(recordingWebhookReceivedAt.getTime() + 1),
      )
    ).status,
    "duplicate",
    "Provider redelivery must resolve through the stable event identity",
  );
  await assert.rejects(
    ingestVerifiedLiveKitRecordingWebhook(
      { ...recordingWebhookEvent, payloadDigest: "b".repeat(64) },
      database,
      recordingWebhookEnvironment,
      () => new Date(recordingWebhookReceivedAt.getTime() + 2),
    ),
    /Webhook event identity was reused/u,
    "A reused provider event identity must not hide different signed bytes",
  );
  const unmatchedWebhookEvent = {
    ...recordingWebhookEvent,
    providerEventId: "EV_VerifyRecordingUnmatched1",
    payloadDigest: "c".repeat(64),
    roomName: "external.room",
    egressId: "EG_FOREIGN_1",
    egressInfo: recordingWebhookEgress({
      egressId: "EG_FOREIGN_1",
      roomName: "external.room",
      storageObjectKey: "recordings/foreign_session/1/foreign_recording.mp4",
    }),
  };
  assert.equal(
    (
      await ingestVerifiedLiveKitRecordingWebhook(
        unmatchedWebhookEvent,
        database,
        recordingWebhookEnvironment,
        () => new Date(recordingWebhookReceivedAt.getTime() + 3),
      )
    ).status,
    "unmatched",
    "A valid foreign Egress receipt must be acknowledged without attaching it to application evidence",
  );
  const invalidTargetWebhookEvent = {
    ...recordingWebhookEvent,
    providerEventId: "EV_VerifyRecordingInvalidTarget1",
    payloadDigest: "d".repeat(64),
    egressInfo: recordingWebhookEgress({
      egressId: recoveredRecording.providerEgressId,
      roomName: recoveredRoom.providerRoomName,
      storageObjectKey: recoveredRecording.storageObjectKey,
      bucket: "foreign-recording-bucket",
    }),
  };
  await assert.rejects(
    ingestVerifiedLiveKitRecordingWebhook(
      invalidTargetWebhookEvent,
      database,
      recordingWebhookEnvironment,
      () => new Date(recordingWebhookReceivedAt.getTime() + 4),
    ),
    /fixed contract/u,
    "A malformed exact-target receipt must roll back so LiveKit can retry it",
  );
  assert.equal(
    await database
      .selectFrom("livekit_webhook_receipt")
      .select(({ fn }) => fn.countAll<string>().as("count"))
      .where("providerEventId", "=", invalidTargetWebhookEvent.providerEventId)
      .executeTakeFirstOrThrow()
      .then((result) => Number(result.count)),
    0,
  );
  recordingProvider.rejectRoomListings();
  recordingProvider.loseNextStopResponse();
  const recoveredStopDispatchesBeforeEnd = recordingProvider.operations.filter(
    (operation) =>
      operation.operation === "stop_recording" &&
      operation.target.providerEgressId === recoveredRecording.providerEgressId,
  ).length;
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
  const deferredClose = fakeProvider.deferNextClose();
  const recoveredCloseProcessing = processAvailableEventVirtualRoomOperations(
    10,
    {
      runtime: recordingRuntime,
      now: endsAt,
    },
  );
  await deferredClose.waitUntilStarted();
  let confirmLifecycleRoomLock: (() => void) | undefined;
  let allowLifecycleRequeue: (() => void) | undefined;
  const lifecycleRoomLocked = new Promise<void>((resolve) => {
    confirmLifecycleRoomLock = resolve;
  });
  const lifecycleRequeueAllowed = new Promise<void>((resolve) => {
    allowLifecycleRequeue = resolve;
  });
  const lifecycleRequeue = database
    .transaction()
    .execute(async (transaction) => {
      await transaction
        .selectFrom("event_virtual_room")
        .select("id")
        .where("id", "=", recoveredRoom.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      confirmLifecycleRoomLock?.();
      await lifecycleRequeueAllowed;
      await transaction
        .insertInto("event_virtual_room_operation")
        .values({
          id: "verify_livekit_room_concurrent_close_operation",
          roomId: recoveredRoom.id,
          kind: "close_room",
          deduplicationKey: `event_virtual_room:${recoveredRoom.id}:close_room`,
          status: "pending",
          availableAt: endsAt,
          leasedUntil: null,
          lastAttemptAt: null,
          completedAt: null,
          lastErrorCode: null,
          requestedByUserId: administrator.id,
          createdAt: endsAt,
        })
        .onConflict((conflict) =>
          conflict.columns(["roomId", "kind", "targetKey"]).doNothing(),
        )
        .execute();
    });
  await lifecycleRoomLocked;
  deferredClose.release();
  await new Promise((resolve) => setTimeout(resolve, 100));
  allowLifecycleRequeue?.();
  const [recoveredCloseBatch] = await Promise.all([
    recoveredCloseProcessing,
    lifecycleRequeue,
  ]);
  assert.deepEqual(
    recoveredCloseBatch.outcomes.map((outcome) => outcome.kind),
    ["stop_recording", "close_room"],
    "Close completion must retain room-first lock order when lifecycle work requeues the same close operation",
  );
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_room_operation")
      .select([
        "status",
        "lastErrorCode",
        "recordingStopDispatchedAt",
        "recordingStopOutcomeUnknownAt",
      ])
      .where("roomId", "=", recoveredRoom.id)
      .where("kind", "=", "stop_recording")
      .executeTakeFirstOrThrow(),
    {
      status: "pending",
      lastErrorCode: "recording_stop_outcome_unknown",
      recordingStopDispatchedAt: endsAt,
      recordingStopOutcomeUnknownAt: endsAt,
    },
    "A lost stop response must retain durable ambiguous dispatch evidence",
  );
  assert.equal(
    await database
      .selectFrom("event_virtual_recording")
      .select("status")
      .where("id", "=", recoveredRecording.id)
      .executeTakeFirstOrThrow()
      .then((recording) => recording.status),
    "active",
    "A lost stop response must not invent a durable provider outcome before exact reconciliation",
  );
  assert.equal(
    (
      await database
        .selectFrom("audit_event")
        .select("id")
        .where("subjectType", "=", "event_virtual_recording")
        .where("subjectId", "=", recoveredRecording.id)
        .where("action", "=", "event_virtual_recording.stop_started")
        .execute()
    ).length,
    0,
    "An ambiguous stop dispatch must wait for exact provider reconciliation before audit emission",
  );
  const recoveredProviderRecording = recordingProvider.recordings.get(
    recoveredRecording.providerEgressId,
  );
  assert.ok(recoveredProviderRecording);
  const recoveredRecordingEndedAt = new Date(endsAt.getTime() + 10_000);
  recordingProvider.recordings.set(
    recoveredRecording.providerEgressId,
    parseLiveKitRecordingSnapshot({
      ...recoveredProviderRecording,
      status: "complete",
      startedAt: new Date(recoveryTime.getTime() + 30_000),
      endedAt: recoveredRecordingEndedAt,
      output: {
        storageObjectKey: recoveredRecording.storageObjectKey,
        fileSizeBytes: 4_096n,
        durationNanoseconds: 1_800_000_000_000n,
      },
    }),
  );
  const recoveredRecordingReconciledAt = new Date(endsAt.getTime() + 30_001);
  const recoveredRecordingReconciliation =
    await processAvailableEventVirtualRoomOperations(10, {
      runtime: recordingRuntime,
      now: recoveredRecordingReconciledAt,
    });
  assert.equal(
    recoveredRecordingReconciliation.outcomes.some(
      (outcome) =>
        outcome.kind === "stop_recording" && outcome.status === "processed",
    ),
    true,
    "A nonterminal stop response must be revisited until provider completion is durable",
  );
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_recording")
      .select([
        "status",
        "endedAt",
        "completedAt",
        "fileSizeBytes",
        "durationNanoseconds",
      ])
      .where("id", "=", recoveredRecording.id)
      .executeTakeFirstOrThrow(),
    {
      status: "complete",
      endedAt: recoveredRecordingEndedAt,
      completedAt: recoveredRecordingReconciledAt,
      fileSizeBytes: "4096",
      durationNanoseconds: "1800000000000",
    },
    "Stop reconciliation must preserve terminal provider evidence",
  );
  assert.deepEqual(
    await database
      .selectFrom("audit_event")
      .select("createdAt")
      .where("subjectType", "=", "event_virtual_recording")
      .where("subjectId", "=", recoveredRecording.id)
      .where("action", "=", "event_virtual_recording.stop_started")
      .execute(),
    [{ createdAt: endsAt }],
    "Reconciliation must emit the ambiguous provider stop dispatch exactly once at its durable dispatch time",
  );
  assert.equal(
    recordingProvider.operations.filter(
      (operation) =>
        operation.operation === "stop_recording" &&
        operation.target.providerEgressId ===
          recoveredRecording.providerEgressId,
    ).length,
    recoveredStopDispatchesBeforeEnd + 1,
    "A reconciled stopping or terminal snapshot must not dispatch a second provider stop",
  );
  assert.equal(
    recordingProvider.operations.some(
      (operation) =>
        operation.operation === "get_recording" &&
        operation.target.providerEgressId ===
          recoveredRecording.providerEgressId,
    ),
    true,
    "A known recording must be reconciled by exact Egress identity rather than a room-wide listing",
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

  const failingProvider = new DeferredFailingEnsureProvider();
  const failingRuntime: VirtualRoomRuntime = {
    ...runtime,
    provider: failingProvider,
  };
  const failingEnsureTime = new Date("2030-09-03T23:44:00.000Z");
  const failingPreparation = ensureEventVirtualRoomForStaff(
    ids.occurrence,
    ids.failureSession,
    wholePresenter,
    { runtime: failingRuntime, clock: () => failingEnsureTime },
  );
  await failingProvider.waitUntilEnsureStarts();
  const failingRoom = await database
    .selectFrom("event_virtual_room")
    .select(["id", "generation", "providerRoomName"])
    .where("eventSessionId", "=", ids.failureSession)
    .executeTakeFirstOrThrow();
  const failingEndTime = new Date("2030-09-03T23:45:00.000Z");
  assert.deepEqual(
    await transitionEventVirtualRoom(
      ids.occurrence,
      ids.failureSession,
      "end",
      wholePresenter,
      { clock: () => failingEndTime },
    ),
    { status: "ready" },
  );
  const failingReclaimTime = new Date("2030-09-03T23:46:01.000Z");
  const firstFailedCloseBatch =
    await processAvailableEventVirtualRoomOperations(10, {
      runtime: failingRuntime,
      now: failingReclaimTime,
    });
  assert.deepEqual(
    firstFailedCloseBatch.outcomes.map((outcome) => outcome.kind),
    ["ensure_room", "close_room"],
    "The expired terminal ensure must settle before the first queued close",
  );
  failingProvider.release();
  assert.deepEqual(await failingPreparation, {
    status: "conflict",
    reason: "provider_pending",
  });
  assert.equal(
    failingProvider.rooms.has(failingRoom.providerRoomName),
    true,
    "A failed provider request can leave an uncertain room side effect after an earlier close",
  );
  const requeuedClose = await database
    .selectFrom("event_virtual_room_operation")
    .select(["status", "lastErrorCode"])
    .where("roomId", "=", failingRoom.id)
    .where("kind", "=", "close_room")
    .executeTakeFirstOrThrow();
  assert.deepEqual(requeuedClose, {
    status: "pending",
    lastErrorCode: "failed_ensure_requires_close",
  });
  const secondFailedCloseBatch =
    await processAvailableEventVirtualRoomOperations(10, {
      runtime: failingRuntime,
      now: new Date(failingReclaimTime.getTime() + 1),
    });
  assert.deepEqual(
    secondFailedCloseBatch.outcomes.map((outcome) => outcome.kind),
    ["close_room"],
  );
  assert.equal(
    failingProvider.rooms.has(failingRoom.providerRoomName),
    false,
    "A failed expired ensure on a terminal generation must force a fresh durable close",
  );

  await database
    .updateTable("event_virtual_room")
    .set({ recordingMode: "automatic", recordingRetentionDays: 30 })
    .where("id", "=", failingRoom.id)
    .executeTakeFirstOrThrow();
  const naturalRecordingId = "verify_livekit_natural_recording_completion";
  const naturalProviderEgressId = "EG_NATURAL_COMPLETION";
  const naturalStorageObjectKey =
    "recordings/opaque_room/natural_completion.mp4";
  const naturalRequestedAt = new Date("2030-09-03T23:44:00.000Z");
  const naturalStartingAt = new Date("2030-09-03T23:44:30.000Z");
  const naturalStartedAt = new Date("2030-09-03T23:45:00.000Z");
  const naturalEndedAt = new Date("2030-09-03T23:46:00.000Z");
  const naturalStopRequestedAt = new Date("2030-09-03T23:46:30.000Z");
  const naturalReconciledAt = new Date("2030-09-03T23:47:00.000Z");
  const naturalCompletedAt = new Date(naturalReconciledAt.getTime() + 60_001);
  await database
    .insertInto("event_virtual_recording")
    .values({
      ...recordingValues,
      id: naturalRecordingId,
      roomId: failingRoom.id,
      eventSessionId: ids.failureSession,
      roomGeneration: failingRoom.generation,
      storageObjectKey: naturalStorageObjectKey,
      requestedAt: naturalRequestedAt,
      updatedAt: naturalRequestedAt,
    })
    .executeTakeFirstOrThrow();
  await database
    .updateTable("event_virtual_recording")
    .set({
      status: "starting",
      providerEgressId: naturalProviderEgressId,
      updatedAt: naturalStartingAt,
    })
    .where("id", "=", naturalRecordingId)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("event_virtual_recording")
    .set({
      status: "active",
      startedAt: naturalStartedAt,
      updatedAt: naturalStartedAt,
    })
    .where("id", "=", naturalRecordingId)
    .executeTakeFirstOrThrow();
  recordingProvider.recordings.set(
    naturalProviderEgressId,
    parseLiveKitRecordingSnapshot({
      providerEgressId: naturalProviderEgressId,
      roomName: failingRoom.providerRoomName,
      storageObjectKey: naturalStorageObjectKey,
      status: "active",
      startedAt: naturalStartedAt,
      endedAt: null,
      output: null,
      failureCode: null,
    }),
  );
  await database
    .insertInto("event_virtual_room_operation")
    .values({
      id: "verify_livekit_natural_recording_stop_operation",
      roomId: failingRoom.id,
      kind: "stop_recording",
      targetKey: naturalRecordingId,
      recordingId: naturalRecordingId,
      lobbyEntryId: null,
      presenterUserId: null,
      participantIdentity: null,
      removalEnforcedUntil: null,
      recordingStopDispatchedAt: naturalStopRequestedAt,
      recordingStopOutcomeUnknownAt: null,
      deduplicationKey: `event_virtual_room:${failingRoom.id}:stop_recording:${naturalRecordingId}`,
      status: "processing",
      availableAt: naturalStopRequestedAt,
      leasedUntil: new Date(naturalReconciledAt.getTime() - 1),
      lastAttemptAt: naturalStopRequestedAt,
      completedAt: null,
      lastErrorCode: null,
      attempts: 1,
      requestedByUserId: administrator.id,
      createdAt: naturalStopRequestedAt,
    })
    .executeTakeFirstOrThrow();
  const stopDispatchesBeforeNaturalCompletion =
    recordingProvider.operations.filter(
      (operation) => operation.operation === "stop_recording",
    ).length;
  const naturalCompletionBatch =
    await processAvailableEventVirtualRoomOperations(1, {
      runtime: recordingRuntime,
      now: naturalReconciledAt,
    });
  assert.deepEqual(
    naturalCompletionBatch.outcomes.map((outcome) => ({
      kind: outcome.kind,
      status: outcome.status,
    })),
    [{ kind: "stop_recording", status: "retry" }],
  );
  assert.equal(
    recordingProvider.operations.filter(
      (operation) => operation.operation === "stop_recording",
    ).length,
    stopDispatchesBeforeNaturalCompletion,
    "A lease-reclaimed stop with an existing dispatch fence must not issue a second provider command",
  );
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_room_operation")
      .select([
        "status",
        "lastErrorCode",
        "recordingStopDispatchedAt",
        "recordingStopOutcomeUnknownAt",
      ])
      .where("roomId", "=", failingRoom.id)
      .where("kind", "=", "stop_recording")
      .executeTakeFirstOrThrow(),
    {
      status: "pending",
      lastErrorCode: "recording_stop_dispatch_pending",
      recordingStopDispatchedAt: naturalStopRequestedAt,
      recordingStopOutcomeUnknownAt: null,
    },
    "A lease-reclaimed stop must retain its original one-shot dispatch fence while exact reconciliation remains pending",
  );
  recordingProvider.recordings.set(
    naturalProviderEgressId,
    parseLiveKitRecordingSnapshot({
      providerEgressId: naturalProviderEgressId,
      roomName: failingRoom.providerRoomName,
      storageObjectKey: naturalStorageObjectKey,
      status: "complete",
      startedAt: naturalStartedAt,
      endedAt: naturalEndedAt,
      output: {
        storageObjectKey: naturalStorageObjectKey,
        fileSizeBytes: 1_024n,
        durationNanoseconds: 60_000_000_000n,
      },
      failureCode: null,
    }),
  );
  assert.deepEqual(
    (
      await processAvailableEventVirtualRoomOperations(1, {
        runtime: recordingRuntime,
        now: naturalCompletedAt,
      })
    ).outcomes.map((outcome) => ({
      kind: outcome.kind,
      status: outcome.status,
    })),
    [{ kind: "stop_recording", status: "processed" }],
    "A fenced stop must settle once exact provider evidence becomes terminal",
  );
  assert.equal(
    (
      await database
        .selectFrom("audit_event")
        .select("id")
        .where("subjectType", "=", "event_virtual_recording")
        .where("subjectId", "=", naturalRecordingId)
        .where("action", "=", "event_virtual_recording.stop_started")
        .execute()
    ).length,
    0,
    "A pre-call stop intent followed by natural completion must not claim that Upskill dispatched a stop",
  );
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_recording")
      .select(["status", "stopRequestedAt", "completedAt"])
      .where("id", "=", naturalRecordingId)
      .executeTakeFirstOrThrow(),
    {
      status: "complete",
      stopRequestedAt: naturalStopRequestedAt,
      completedAt: naturalCompletedAt,
    },
    "Natural provider completion must still settle exact terminal evidence",
  );

  await database
    .updateTable("event_virtual_room")
    .set({ recordingMode: "automatic", recordingRetentionDays: 30 })
    .where("id", "=", deferredRoom.id)
    .executeTakeFirstOrThrow();
  const fencedTerminalRecordingId = "verify_livekit_fenced_terminal_recording";
  const fencedTerminalRequestedAt = new Date(
    deferredEndTime.getTime() - 3 * 60_000,
  );
  const fencedTerminalDispatchedAt = new Date(
    deferredEndTime.getTime() - 60_000,
  );
  const fencedTerminalReconciledAt = new Date(
    fencedTerminalDispatchedAt.getTime() + 2 * 60_000 + 1,
  );
  await database
    .insertInto("event_virtual_recording")
    .values({
      ...recordingValues,
      id: fencedTerminalRecordingId,
      roomId: deferredRoom.id,
      eventSessionId: ids.raceSession,
      roomGeneration: deferredRoom.generation,
      storageObjectKey: "recordings/opaque_room/fenced_terminal_recording.mp4",
      requestedAt: fencedTerminalRequestedAt,
      updatedAt: fencedTerminalRequestedAt,
    })
    .executeTakeFirstOrThrow();
  await database
    .insertInto("event_virtual_room_operation")
    .values([
      {
        id: "verify_livekit_fenced_terminal_start_operation",
        roomId: deferredRoom.id,
        kind: "start_recording" as const,
        targetKey: fencedTerminalRecordingId,
        recordingId: fencedTerminalRecordingId,
        deduplicationKey: `event_virtual_room:${deferredRoom.id}:start_recording:${fencedTerminalRecordingId}`,
        status: "processing" as const,
        attempts: 1,
        availableAt: fencedTerminalDispatchedAt,
        leasedUntil: new Date(
          fencedTerminalDispatchedAt.getTime() + 2 * 60_000,
        ),
        lastAttemptAt: fencedTerminalDispatchedAt,
        completedAt: null,
        lastErrorCode: null,
        recordingStartDispatchedAt: fencedTerminalDispatchedAt,
        requestedByUserId: administrator.id,
        createdAt: fencedTerminalRequestedAt,
      },
      {
        id: "verify_livekit_fenced_terminal_stop_operation",
        roomId: deferredRoom.id,
        kind: "stop_recording" as const,
        targetKey: fencedTerminalRecordingId,
        recordingId: fencedTerminalRecordingId,
        deduplicationKey: `event_virtual_room:${deferredRoom.id}:stop_recording:${fencedTerminalRecordingId}`,
        status: "pending" as const,
        availableAt: deferredEndTime,
        leasedUntil: null,
        lastAttemptAt: null,
        completedAt: null,
        lastErrorCode: null,
        requestedByUserId: administrator.id,
        createdAt: deferredEndTime,
      },
    ])
    .execute();
  const fencedTerminalRecordingProvider = new FakeLiveKitRecordingProvider();
  const fencedTerminalRuntime: VirtualRoomRuntime = {
    ...runtime,
    recordingProvider: fencedTerminalRecordingProvider,
  };
  const fencedTerminalBatch = await processAvailableEventVirtualRoomOperations(
    2,
    {
      runtime: fencedTerminalRuntime,
      now: fencedTerminalReconciledAt,
    },
  );
  assert.deepEqual(
    fencedTerminalBatch.outcomes.map((outcome) => ({
      kind: outcome.kind,
      status: outcome.status,
    })),
    [{ kind: "start_recording", status: "processed" }],
    "A terminal room must settle a start fence with no exact Egress after its bounded reconciliation window",
  );
  assert.equal(
    fencedTerminalRecordingProvider.operations.filter(
      (operation) => operation.operation === "start_recording",
    ).length,
    0,
    "A terminal fenced start with no exact Egress must not dispatch a replacement recording",
  );
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_recording")
      .select([
        "status",
        "failureCode",
        "completedAt",
        "stopRequestedByUserId",
        "stopRequestedAt",
      ])
      .where("id", "=", fencedTerminalRecordingId)
      .executeTakeFirstOrThrow(),
    {
      status: "failed",
      failureCode: "meeting_ended_before_recording_started",
      completedAt: fencedTerminalReconciledAt,
      stopRequestedByUserId: administrator.id,
      stopRequestedAt: deferredEndTime,
    },
    "A terminal fenced start must retain its queued stop-request actor and time",
  );
  assert.deepEqual(
    (
      await findEventVirtualSessionOperations(
        ids.occurrence,
        administratorAccess,
        fencedTerminalReconciledAt,
      )
    ).find((session) => session.eventSessionId === ids.raceSession)?.recording,
    {
      status: "failed",
      warning:
        "Automatic recording failed. Keep the webinar running and arrange a manual follow-up; an administrator can review the recording evidence after the session.",
    },
    "The operations workspace must expose a terminal automatic recording failure to staff",
  );
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_room_operation")
      .select(["kind", "status", "completedAt"])
      .where("recordingId", "=", fencedTerminalRecordingId)
      .orderBy("kind")
      .execute(),
    [
      {
        kind: "start_recording",
        status: "succeeded",
        completedAt: fencedTerminalReconciledAt,
      },
      {
        kind: "stop_recording",
        status: "succeeded",
        completedAt: fencedTerminalReconciledAt,
      },
    ],
    "Terminal start reconciliation must settle both the fenced start and its queued stop",
  );

  await database
    .updateTable("event_virtual_room")
    .set({
      replacedAt: reclaimedTime,
      replacedByUserId: administrator.id,
    })
    .where("id", "=", deferredRoom.id)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("event_session")
    .set({
      livekitRecordingMode: "automatic",
      livekitRecordingRetentionDays: 30,
      livekitAttendeeRecordingNotice: "This webinar is recorded.",
      livekitPresenterRecordingNotice: "This webinar is recorded.",
    })
    .where("id", "=", ids.raceSession)
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
  const recordingRaceRoom = await database
    .selectFrom("event_virtual_room")
    .select("id")
    .where("eventSessionId", "=", ids.raceSession)
    .where("replacedAt", "is", null)
    .executeTakeFirstOrThrow();
  const deferredRecordingProvider = new DeferredPreparationRecordingProvider();
  const deferredRecordingRuntime: VirtualRoomRuntime = {
    ...runtime,
    recordingProvider: deferredRecordingProvider,
  };
  const terminalRecordingAttemptAt = new Date("2030-09-04T00:09:00.000Z");
  const terminalRecordingAttempt = processAvailableEventVirtualRoomOperations(
    1,
    {
      runtime: deferredRecordingRuntime,
      now: terminalRecordingAttemptAt,
    },
  );
  await deferredRecordingProvider.waitUntilPreparationStarts();
  const terminalTransitionTime = new Date("2030-09-04T00:10:00.000Z");
  let lifecycleClockTime = new Date("2030-09-04T00:09:00.000Z");
  let confirmLifecycleOccurrenceLock: (() => void) | undefined;
  let releaseLifecycleOccurrenceLock: (() => void) | undefined;
  const lifecycleOccurrenceLocked = new Promise<void>((resolve) => {
    confirmLifecycleOccurrenceLock = resolve;
  });
  const lifecycleOccurrenceRelease = new Promise<void>((resolve) => {
    releaseLifecycleOccurrenceLock = resolve;
  });
  const blockingLifecycleTransaction = database
    .transaction()
    .execute(async (transaction) => {
      await transaction
        .selectFrom("event_occurrence")
        .select("id")
        .where("id", "=", ids.occurrence)
        .forUpdate()
        .executeTakeFirstOrThrow();
      confirmLifecycleOccurrenceLock?.();
      await lifecycleOccurrenceRelease;
      await transaction
        .updateTable("event_occurrence")
        .set({ updatedAt: new Date("2030-09-04T00:09:30.000Z") })
        .where("id", "=", ids.occurrence)
        .executeTakeFirstOrThrow();
    });
  await lifecycleOccurrenceLocked;
  let terminalTransitionSettled = false;
  const terminalTransition = transitionAdminEventOccurrence(
    ids.occurrence,
    "completed",
    administrator,
    { clock: () => lifecycleClockTime },
  ).finally(() => {
    terminalTransitionSettled = true;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      terminalTransitionSettled,
      false,
      "Occurrence lifecycle transition must wait behind the occurrence lock",
    );
    lifecycleClockTime = terminalTransitionTime;
  } finally {
    releaseLifecycleOccurrenceLock?.();
    await blockingLifecycleTransaction;
  }
  assert.equal(await terminalTransition, "updated");
  deferredRecordingProvider.release();
  const terminalRecordingBatch = await terminalRecordingAttempt;
  assert.deepEqual(
    terminalRecordingBatch.outcomes.map((outcome) => ({
      kind: outcome.kind,
      status: outcome.status,
    })),
    [{ kind: "start_recording", status: "processed" }],
  );
  assert.equal(
    deferredRecordingProvider.operations.some(
      (operation) => operation.operation === "start_recording",
    ),
    false,
    "A room ended during upload authorization must never dispatch Egress",
  );
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_recording")
      .select([
        "status",
        "failureCode",
        "completedAt",
        "updatedAt",
        "stopRequestedByUserId",
        "stopRequestedAt",
      ])
      .where("roomId", "=", recordingRaceRoom.id)
      .executeTakeFirstOrThrow(),
    {
      status: "failed",
      failureCode: "meeting_ended_before_recording_started",
      completedAt: terminalTransitionTime,
      updatedAt: terminalTransitionTime,
      stopRequestedByUserId: administrator.id,
      stopRequestedAt: terminalTransitionTime,
    },
    "A room ending during start authorization must retain its queued stop-request evidence",
  );
  assert.deepEqual(
    await database
      .selectFrom("event_virtual_room_operation")
      .select(["status", "recordingStartDispatchedAt", "completedAt"])
      .where("roomId", "=", recordingRaceRoom.id)
      .where("kind", "=", "start_recording")
      .executeTakeFirstOrThrow(),
    {
      status: "succeeded",
      recordingStartDispatchedAt: null,
      completedAt: terminalTransitionTime,
    },
    "Terminal room state must settle recording without committing the dispatch fence",
  );
  assert.equal(
    await database
      .selectFrom("event_occurrence")
      .select("updatedAt")
      .where("id", "=", ids.occurrence)
      .executeTakeFirstOrThrow()
      .then((occurrence) => occurrence.updatedAt.getTime()),
    terminalTransitionTime.getTime(),
    "Occurrence lifecycle evidence must sample time after the lifecycle lock is acquired",
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
    { runtime: deferredRecordingRuntime, now: terminalTransitionTime },
  );
  assert.deepEqual(
    terminalCloseBatch.outcomes.map((outcome) => ({
      roomId: outcome.roomId,
      kind: outcome.kind,
    })),
    [{ roomId: terminalRoom.id, kind: "close_room" }],
    "A recording that failed before provider start must settle its queued stop before room closure",
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
  const recordingAuditActions = await database
    .selectFrom("audit_event")
    .select(["action", "actorUserId", "reason"])
    .where("subjectType", "=", "event_virtual_recording")
    .execute();
  assert.deepEqual(
    [...new Set(recordingAuditActions.map((event) => event.action))].sort(),
    [
      "event_virtual_recording.completed",
      "event_virtual_recording.failed",
      "event_virtual_recording.requested",
      "event_virtual_recording.started",
      "event_virtual_recording.stop_requested",
      "event_virtual_recording.stop_started",
    ],
    "Recording request, provider start, stop, completion and failure transitions must all emit durable audit evidence",
  );
  assert.equal(
    recordingAuditActions.every((event) => event.actorUserId !== null),
    true,
    "Automatic recording audit evidence must retain its initiating staff actor",
  );
  assert.equal(
    recordingAuditActions.some(
      (event) =>
        event.action === "event_virtual_recording.failed" &&
        event.reason === "meeting_ended_before_recording_started",
    ),
    true,
    "Recording failure audit evidence must retain the safe failure code",
  );
  console.log(
    "Verified LiveKit exact staff authorization, preparation timing, capacity, idempotent room creation, health, lifecycle, recording evidence, closure, replacement, worker processing and durable audit evidence",
  );
} finally {
  await database
    .deleteFrom("event_virtual_presenter_credential_reservation")
    .where("roomId", "in", (builder) =>
      builder
        .selectFrom("event_virtual_room")
        .select("id")
        .where("eventSessionId", "in", [
          ids.session,
          ids.raceSession,
          ids.failureSession,
        ]),
    )
    .execute();
  await database
    .deleteFrom("event_virtual_room_operation")
    .where("roomId", "in", (builder) =>
      builder
        .selectFrom("event_virtual_room")
        .select("id")
        .where("eventSessionId", "in", [
          ids.session,
          ids.raceSession,
          ids.failureSession,
        ]),
    )
    .execute();
  await database
    .deleteFrom("outbox_event")
    .where("aggregateId", "in", (builder) =>
      builder
        .selectFrom("event_virtual_room")
        .select("id")
        .where("eventSessionId", "in", [
          ids.session,
          ids.raceSession,
          ids.failureSession,
        ]),
    )
    .execute();
  await database
    .deleteFrom("livekit_webhook_receipt")
    .where("providerEventId", "in", [
      "EV_VerifyRecordingUpdate1",
      "EV_VerifyRecordingUnmatched1",
      "EV_VerifyRecordingInvalidTarget1",
    ])
    .execute();
  await database
    .deleteFrom("event_virtual_recording")
    .where("eventSessionId", "in", [
      ids.session,
      ids.raceSession,
      ids.failureSession,
    ])
    .execute();
  await database
    .deleteFrom("event_virtual_room")
    .where("eventSessionId", "in", [
      ids.session,
      ids.raceSession,
      ids.failureSession,
    ])
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
      .where("subjectType", "in", [
        "event_virtual_room",
        "event_virtual_recording",
      ])
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
    .deleteFrom("event_virtual_join_access")
    .where("eventSessionId", "in", [
      ids.session,
      ids.raceSession,
      ids.failureSession,
    ])
    .execute();
  await database
    .deleteFrom("event_session")
    .where("id", "in", [ids.session, ids.raceSession, ids.failureSession])
    .execute();
  await database
    .deleteFrom("event_occurrence")
    .where("id", "=", ids.occurrence)
    .execute();
  await database
    .deleteFrom("event_template_session_definition")
    .where("id", "in", [
      ids.definition,
      ids.raceDefinition,
      ids.failureDefinition,
    ])
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
    .where("userId", "in", [
      administrator.id,
      platformAdministrator.id,
      expiredPlatformAdministrator.id,
    ])
    .execute();
  await database
    .deleteFrom("user")
    .where("id", "in", [
      administrator.id,
      presenter.id,
      wholePresenter.id,
      coordinator.id,
      platformAdministrator.id,
      expiredPlatformAdministrator.id,
    ])
    .execute();
  await destroyDatabase();
}
