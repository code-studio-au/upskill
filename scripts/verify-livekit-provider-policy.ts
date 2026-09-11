import assert from "node:assert/strict";
import { sql } from "kysely";
import {
  createAdminEventOccurrence,
  publishAdminEventOccurrence,
  rescheduleAdminEventOccurrence,
  updateAdminEventOccurrence,
} from "#/server/admin/admin-event-occurrence.server";
import { destroyDatabase, getDatabase } from "#/server/db/database.server";
import { FakeLiveKitRecordingProvider } from "#/server/livekit/livekit-recording-provider.fake";
import { LIVEKIT_ROLE_CHAINED_RECORDING_AUTHORIZATION_POLICY } from "#/server/livekit/livekit-recording-duration-policy.server";
import {
  down as downProviderPolicy,
  up as upProviderPolicy,
} from "#/server/db/migrations/0085_livekit_versioned_provider_policy";
import {
  down as downRoomLifecycle,
  up as upRoomLifecycle,
} from "#/server/db/migrations/0086_livekit_room_lifecycle";
import {
  down as downAttendeeLobby,
  up as upAttendeeLobby,
} from "#/server/db/migrations/0087_livekit_attendee_lobby";
import {
  down as downLobbyRevision,
  up as upLobbyRevision,
} from "#/server/db/migrations/0088_livekit_lobby_revision";
import {
  down as downParticipantOperations,
  up as upParticipantOperations,
} from "#/server/db/migrations/0089_livekit_participant_operations";
import {
  down as downRecoveryDeliveryQueue,
  up as upRecoveryDeliveryQueue,
} from "#/server/db/migrations/0090_livekit_recovery_delivery_queue";
import {
  down as downCredentialReservationIndex,
  up as upCredentialReservationIndex,
} from "#/server/db/migrations/0091_livekit_credential_reservation_index";
import {
  down as downRecoveryOutcomeAudit,
  up as upRecoveryOutcomeAudit,
} from "#/server/db/migrations/0092_livekit_recovery_outcome_audit";
import {
  down as downAttendeeTokenDenialAudit,
  up as upAttendeeTokenDenialAudit,
} from "#/server/db/migrations/0093_livekit_attendee_token_denial_audit";
import {
  down as downPresenterTokenDenialAudit,
  up as upPresenterTokenDenialAudit,
} from "#/server/db/migrations/0094_livekit_presenter_token_denial_audit";
import {
  down as downPresenterCredentialReservations,
  up as upPresenterCredentialReservations,
} from "#/server/db/migrations/0095_livekit_presenter_credential_reservations";
import {
  down as downPresenterParticipantOperations,
  up as upPresenterParticipantOperations,
} from "#/server/db/migrations/0096_livekit_presenter_participant_operations";
import {
  down as downOpenEntryJoinSessions,
  up as upOpenEntryJoinSessions,
} from "#/server/db/migrations/0097_livekit_open_entry_join_sessions";
import {
  down as downParticipantRemovalEnforcement,
  up as upParticipantRemovalEnforcement,
} from "#/server/db/migrations/0098_livekit_participant_removal_enforcement";
import {
  down as downRecordingEvidence,
  up as upRecordingEvidence,
} from "#/server/db/migrations/0099_livekit_recording_evidence";
import {
  down as downRecordingOperations,
  up as upRecordingOperations,
} from "#/server/db/migrations/0100_livekit_recording_operations";
import {
  down as downRecordingStartDispatch,
  up as upRecordingStartDispatch,
} from "#/server/db/migrations/0101_livekit_recording_start_dispatch";
import {
  down as downRecordingLifecycleAudit,
  up as upRecordingLifecycleAudit,
} from "#/server/db/migrations/0102_livekit_recording_lifecycle_audit";
import {
  down as downRecordingStopDispatch,
  up as upRecordingStopDispatch,
} from "#/server/db/migrations/0103_livekit_recording_stop_dispatch";
import {
  down as downRecordingStopOutcome,
  up as upRecordingStopOutcome,
} from "#/server/db/migrations/0104_livekit_recording_stop_outcome";
import {
  down as downRecordingWebhookReceipts,
  up as upRecordingWebhookReceipts,
} from "#/server/db/migrations/0105_livekit_recording_webhook_receipts";
import {
  down as downRecordingReceiptAttention,
  up as upRecordingReceiptAttention,
} from "#/server/db/migrations/0106_livekit_recording_receipt_attention";
import {
  down as downRecordingAccessAudit,
  up as upRecordingAccessAudit,
} from "#/server/db/migrations/0107_livekit_recording_access_audit";
import type { AuthenticatedUser } from "#/server/auth/session.server";

const ids = {
  administrator: "verify_livekit_policy_administrator",
  template: "verify_livekit_policy_template",
  version: "verify_livekit_policy_version",
  definition: "verify_livekit_policy_definition",
  legacyOccurrence: "verify_livekit_policy_legacy_occurrence",
  legacySession: "verify_livekit_policy_legacy_session",
  compatibilityOccurrence: "verify_livekit_policy_compatibility_occurrence",
  compatibilitySession: "verify_livekit_policy_compatibility_session",
  preparedRoom: "verify_livekit_policy_prepared_room",
};

const database = getDatabase();
const administrator: AuthenticatedUser = {
  id: ids.administrator,
  name: "LiveKit Policy Administrator",
  email: "verify-livekit-policy@example.com",
  emailVerified: true,
};

const startsAt = new Date("2030-09-04T00:00:00.000Z");
const endsAt = new Date("2030-09-04T01:00:00.000Z");
let migrationRestored = false;

try {
  await downRecordingAccessAudit(database);
  await downRecordingReceiptAttention(database);
  await downRecordingWebhookReceipts(database);
  await downRecordingStopOutcome(database);
  await downRecordingStopDispatch(database);
  await downRecordingLifecycleAudit(database);
  await downRecordingStartDispatch(database);
  await downRecordingOperations(database);
  await downRecordingEvidence(database);
  await downParticipantRemovalEnforcement(database);
  await downOpenEntryJoinSessions(database);
  await downPresenterParticipantOperations(database);
  await downPresenterCredentialReservations(database);
  await downPresenterTokenDenialAudit(database);
  await downAttendeeTokenDenialAudit(database);
  await downRecoveryOutcomeAudit(database);
  await downCredentialReservationIndex(database);
  await downRecoveryDeliveryQueue(database);
  await downParticipantOperations(database);
  await downLobbyRevision(database);
  await downAttendeeLobby(database);
  await downRoomLifecycle(database);
  await downProviderPolicy(database);
  await database
    .insertInto("user")
    .values({
      id: administrator.id,
      name: administrator.name,
      email: administrator.email,
      emailVerified: true,
      image: null,
      stripeCustomerId: null,
    })
    .execute();
  await database
    .insertInto("platform_admin")
    .values({
      userId: administrator.id,
      grantedByUserId: null,
    })
    .execute();
  await database
    .insertInto("event_template")
    .values({
      id: ids.template,
      title: "LiveKit policy verification",
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
      summary: "LiveKit policy verification.",
      description: "Verifies provider backfill and exact-session snapshots.",
      coverImage: null,
      hasCompletionCertificate: false,
      accreditations: JSON.stringify([]),
      registrationSurveyVersionId: null,
      publishedAt: new Date(),
    })
    .execute();
  await sql`insert into event_template_session_definition
      (id, "eventTemplateVersionId", position, title, "durationMinutes", "presenterRequired")
    values (${ids.definition}, ${ids.version}, 0, 'Policy session', 60, false)`.execute(
    database,
  );
  await database
    .insertInto("event_template_version_admin_default")
    .values({
      eventTemplateVersionId: ids.version,
      userId: administrator.id,
    })
    .execute();
  await database
    .insertInto("event_occurrence")
    .values({
      id: ids.legacyOccurrence,
      eventTemplateVersionId: ids.version,
      title: "Legacy virtual event",
      slug: "verify-livekit-policy-legacy",
      status: "published",
      deliveryMode: "virtual",
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
      virtualJoinUrl: "https://meet.example.com/legacy",
      priceCents: null,
      salePriceCents: null,
      currency: "AUD",
      bulkPricing: JSON.stringify({ enabled: false, tiers: [] }),
      listInStore: false,
      featured: false,
      openEntryAttendanceMode: "checked_in",
      publishedAt: new Date(),
      createdByUserId: administrator.id,
    })
    .execute();
  await database
    .insertInto("event_session")
    .values({
      id: ids.legacySession,
      eventOccurrenceId: ids.legacyOccurrence,
      sessionDefinitionId: ids.definition,
      position: 0,
      title: "Legacy virtual session",
      localStartsAt: "2030-09-04T10:00:00",
      localEndsAt: "2030-09-04T11:00:00",
      startsAt,
      endsAt,
      presenterRequired: false,
      venueName: null,
      venueAddress: null,
      virtualJoinUrl: "https://meet.example.com/legacy",
    })
    .execute();

  await upProviderPolicy(database);
  await upRoomLifecycle(database);
  await upAttendeeLobby(database);
  await upLobbyRevision(database);
  await upParticipantOperations(database);
  await upRecoveryDeliveryQueue(database);
  await upCredentialReservationIndex(database);
  await upRecoveryOutcomeAudit(database);
  await upAttendeeTokenDenialAudit(database);
  await upPresenterTokenDenialAudit(database);
  await upPresenterCredentialReservations(database);
  await upPresenterParticipantOperations(database);
  await upOpenEntryJoinSessions(database);
  await upParticipantRemovalEnforcement(database);
  await upRecordingEvidence(database);
  await upRecordingOperations(database);
  await upRecordingStartDispatch(database);
  await upRecordingLifecycleAudit(database);
  await upRecordingStopDispatch(database);
  await upRecordingStopOutcome(database);
  await upRecordingWebhookReceipts(database);
  await upRecordingReceiptAttention(database);
  await upRecordingAccessAudit(database);
  migrationRestored = true;

  const backfilledOccurrence = await database
    .selectFrom("event_occurrence")
    .select(["virtualDeliveryProvider", "virtualJoinUrl"])
    .where("id", "=", ids.legacyOccurrence)
    .executeTakeFirstOrThrow();
  assert.deepEqual(backfilledOccurrence, {
    virtualDeliveryProvider: "external_url",
    virtualJoinUrl: "https://meet.example.com/legacy",
  });
  const backfilledSession = await database
    .selectFrom("event_session")
    .select(["virtualDeliveryProvider", "livekitAdmissionMode"])
    .where("id", "=", ids.legacySession)
    .executeTakeFirstOrThrow();
  assert.deepEqual(backfilledSession, {
    virtualDeliveryProvider: "external_url",
    livekitAdmissionMode: null,
  });

  await sql`insert into event_occurrence (
      id, "eventTemplateVersionId", title, slug, status, "deliveryMode",
      "registrationMode", "approvalMode", timezone, "localStartsAt", "localEndsAt",
      "localRegistrationOpensAt", "localRegistrationClosesAt", "localCoordinatorLockAt",
      "startsAt", "endsAt", "registrationOpensAt", "registrationClosesAt",
      "coordinatorLockAt", capacity, "confirmedCount", "venueName", "venueAddress",
      "virtualJoinUrl", "priceCents", "salePriceCents", currency, "bulkPricing",
      "listInStore", featured, "openEntryAttendanceMode", "publishedAt",
      "createdByUserId", "createdAt", "updatedAt"
    )
    select ${ids.compatibilityOccurrence}, "eventTemplateVersionId", title,
      'verify-livekit-policy-compatibility', 'draft', "deliveryMode",
      "registrationMode", "approvalMode", timezone, "localStartsAt", "localEndsAt",
      "localRegistrationOpensAt", "localRegistrationClosesAt", "localCoordinatorLockAt",
      "startsAt", "endsAt", "registrationOpensAt", "registrationClosesAt",
      "coordinatorLockAt", capacity, 0, "venueName", "venueAddress", "virtualJoinUrl",
      "priceCents", "salePriceCents", currency, "bulkPricing", false, false,
      "openEntryAttendanceMode", null, "createdByUserId", now(), now()
    from event_occurrence
    where id = ${ids.legacyOccurrence}`.execute(database);
  await sql`insert into event_session (
      id, "eventOccurrenceId", "sessionDefinitionId", position, title,
      "localStartsAt", "localEndsAt", "startsAt", "endsAt", "presenterRequired",
      "venueName", "venueAddress", "virtualJoinUrl"
    )
    select ${ids.compatibilitySession}, ${ids.compatibilityOccurrence},
      "sessionDefinitionId", position, title, "localStartsAt", "localEndsAt",
      "startsAt", "endsAt", "presenterRequired", "venueName", "venueAddress",
      "virtualJoinUrl"
    from event_session
    where id = ${ids.legacySession}`.execute(database);
  assert.deepEqual(
    await database
      .selectFrom("event_occurrence")
      .select("virtualDeliveryProvider")
      .where("id", "=", ids.compatibilityOccurrence)
      .executeTakeFirstOrThrow(),
    { virtualDeliveryProvider: "external_url" },
  );
  assert.deepEqual(
    await database
      .selectFrom("event_session")
      .select("virtualDeliveryProvider")
      .where("id", "=", ids.compatibilitySession)
      .executeTakeFirstOrThrow(),
    { virtualDeliveryProvider: "external_url" },
  );
  await sql`update event_occurrence
    set "deliveryMode" = 'in_person', "venueName" = 'Compatibility venue',
      "virtualJoinUrl" = null
    where id = ${ids.compatibilityOccurrence}`.execute(database);
  await sql`update event_session
    set "venueName" = 'Compatibility venue', "virtualJoinUrl" = null
    where id = ${ids.compatibilitySession}`.execute(database);
  assert.equal(
    (
      await database
        .selectFrom("event_occurrence")
        .select("virtualDeliveryProvider")
        .where("id", "=", ids.compatibilityOccurrence)
        .executeTakeFirstOrThrow()
    ).virtualDeliveryProvider,
    null,
  );
  assert.equal(
    (
      await database
        .selectFrom("event_session")
        .select("virtualDeliveryProvider")
        .where("id", "=", ids.compatibilitySession)
        .executeTakeFirstOrThrow()
    ).virtualDeliveryProvider,
    null,
  );
  const defaultPolicy = await database
    .selectFrom("event_template_session_definition")
    .select([
      "livekitAdmissionMode",
      "livekitAttendanceMode",
      "livekitPresenterPreparationMinutes",
      "livekitAttendeeRejoinGraceMinutes",
      "livekitCapacityHeadroom",
      "livekitOpenEntryGuestsAllowed",
      "livekitRecordingMode",
    ])
    .where("id", "=", ids.definition)
    .executeTakeFirstOrThrow();
  assert.deepEqual(defaultPolicy, {
    livekitAdmissionMode: "automatic",
    livekitAttendanceMode: "manual",
    livekitPresenterPreparationMinutes: 60,
    livekitAttendeeRejoinGraceMinutes: 10,
    livekitCapacityHeadroom: 5,
    livekitOpenEntryGuestsAllowed: false,
    livekitRecordingMode: "off",
  });

  const occurrenceInput = {
    eventTemplateVersionId: ids.version,
    title: "LiveKit exact-session snapshot",
    slug: "verify-livekit-policy-snapshot",
    deliveryMode: "virtual" as const,
    virtualDeliveryProvider: "livekit" as const,
    registrationMode: "required_unrestricted" as const,
    approvalMode: "automatic" as const,
    timezone: "Australia/Sydney",
    localStartsAt: "2030-09-04T12:00:00",
    localEndsAt: "2030-09-04T13:00:00",
    localRegistrationOpensAt: "2030-08-01T10:00:00",
    localRegistrationClosesAt: "2030-09-01T10:00:00",
    localCoordinatorLockAt: "",
    startsAt: "2030-09-04T02:00:00.000Z",
    endsAt: "2030-09-04T03:00:00.000Z",
    registrationOpensAt: "2030-08-01T00:00:00.000Z",
    registrationClosesAt: "2030-09-01T00:00:00.000Z",
    coordinatorLockAt: "",
    capacity: 20,
    priceCents: null,
    salePriceCents: null,
    currency: "AUD" as const,
    bulkPricing: { enabled: false, tiers: [] },
    listInStore: false,
    featured: false,
    venueName: "",
    venueAddress: "",
    virtualJoinUrl: "",
    domains: "",
  };
  const created = await createAdminEventOccurrence(
    occurrenceInput,
    administrator,
  );
  assert.equal(created.status, "created");

  const snapshot = await database
    .selectFrom("event_session")
    .select([
      "virtualDeliveryProvider",
      "virtualJoinUrl",
      "livekitAdmissionMode",
      "livekitAttendanceMode",
      "livekitPresenterPreparationMinutes",
      "livekitAttendeeRejoinGraceMinutes",
      "livekitCapacityHeadroom",
      "livekitOpenEntryGuestsAllowed",
      "livekitRecordingMode",
    ])
    .where("eventOccurrenceId", "=", created.eventOccurrenceId)
    .executeTakeFirstOrThrow();
  assert.deepEqual(snapshot, {
    virtualDeliveryProvider: "livekit",
    virtualJoinUrl: null,
    livekitAdmissionMode: "automatic",
    livekitAttendanceMode: "manual",
    livekitPresenterPreparationMinutes: 60,
    livekitAttendeeRejoinGraceMinutes: 10,
    livekitCapacityHeadroom: 5,
    livekitOpenEntryGuestsAllowed: false,
    livekitRecordingMode: "off",
  });

  const legacyExternalEdit = await createAdminEventOccurrence(
    {
      ...occurrenceInput,
      title: "LiveKit rollback external edit",
      slug: "verify-livekit-policy-rollback-external",
    },
    administrator,
  );
  assert.equal(legacyExternalEdit.status, "created");
  await sql`update event_occurrence
    set "virtualJoinUrl" = 'https://meet.example.com/rollback-external'
    where id = ${legacyExternalEdit.eventOccurrenceId}`.execute(database);
  await sql`update event_session
    set "virtualJoinUrl" = 'https://meet.example.com/rollback-external'
    where "eventOccurrenceId" = ${legacyExternalEdit.eventOccurrenceId}`.execute(
    database,
  );
  assert.equal(
    (
      await database
        .selectFrom("event_occurrence")
        .select("virtualDeliveryProvider")
        .where("id", "=", legacyExternalEdit.eventOccurrenceId)
        .executeTakeFirstOrThrow()
    ).virtualDeliveryProvider,
    "external_url",
  );
  assert.deepEqual(
    await database
      .selectFrom("event_session")
      .select([
        "virtualDeliveryProvider",
        "livekitAdmissionMode",
        "livekitRecordingMode",
      ])
      .where("eventOccurrenceId", "=", legacyExternalEdit.eventOccurrenceId)
      .executeTakeFirstOrThrow(),
    {
      virtualDeliveryProvider: "external_url",
      livekitAdmissionMode: null,
      livekitRecordingMode: null,
    },
  );

  let confirmOccurrenceLock: (() => void) | undefined;
  let releaseOccurrenceLock: (() => void) | undefined;
  const occurrenceLockHeld = new Promise<void>((resolve) => {
    confirmOccurrenceLock = resolve;
  });
  const releaseOccurrence = new Promise<void>((resolve) => {
    releaseOccurrenceLock = resolve;
  });
  const publicationTransaction = database
    .transaction()
    .execute(async (transaction) => {
      await transaction
        .selectFrom("event_occurrence")
        .select("id")
        .where("id", "=", legacyExternalEdit.eventOccurrenceId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      confirmOccurrenceLock?.();
      await releaseOccurrence;
      await transaction
        .updateTable("event_occurrence")
        .set({ status: "published", publishedAt: new Date() })
        .where("id", "=", legacyExternalEdit.eventOccurrenceId)
        .executeTakeFirstOrThrow();
    });
  await occurrenceLockHeld;
  let concurrentDraftSaveSettled = false;
  const concurrentDraftSave = updateAdminEventOccurrence(
    legacyExternalEdit.eventOccurrenceId,
    {
      ...occurrenceInput,
      title: "Blocked concurrent LiveKit draft save",
      slug: "verify-livekit-policy-rollback-external",
    },
    administrator,
  ).finally(() => {
    concurrentDraftSaveSettled = true;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      concurrentDraftSaveSettled,
      false,
      "A draft save must wait behind a concurrent publication lock",
    );
  } finally {
    releaseOccurrenceLock?.();
    await publicationTransaction;
  }
  assert.equal(await concurrentDraftSave, "conflict");
  assert.deepEqual(
    await database
      .selectFrom("event_occurrence")
      .select(["status", "virtualDeliveryProvider"])
      .where("id", "=", legacyExternalEdit.eventOccurrenceId)
      .executeTakeFirstOrThrow(),
    { status: "published", virtualDeliveryProvider: "external_url" },
  );

  const legacyInPersonEdit = await createAdminEventOccurrence(
    {
      ...occurrenceInput,
      title: "LiveKit rollback in-person edit",
      slug: "verify-livekit-policy-rollback-in-person",
    },
    administrator,
  );
  assert.equal(legacyInPersonEdit.status, "created");
  await sql`update event_occurrence
    set "deliveryMode" = 'in_person', "venueName" = 'Rollback venue'
    where id = ${legacyInPersonEdit.eventOccurrenceId}`.execute(database);
  await sql`update event_session
    set "venueName" = 'Rollback venue'
    where "eventOccurrenceId" = ${legacyInPersonEdit.eventOccurrenceId}`.execute(
    database,
  );
  assert.equal(
    (
      await database
        .selectFrom("event_occurrence")
        .select("virtualDeliveryProvider")
        .where("id", "=", legacyInPersonEdit.eventOccurrenceId)
        .executeTakeFirstOrThrow()
    ).virtualDeliveryProvider,
    null,
  );
  assert.deepEqual(
    await database
      .selectFrom("event_session")
      .select([
        "virtualDeliveryProvider",
        "livekitAdmissionMode",
        "livekitRecordingMode",
      ])
      .where("eventOccurrenceId", "=", legacyInPersonEdit.eventOccurrenceId)
      .executeTakeFirstOrThrow(),
    {
      virtualDeliveryProvider: null,
      livekitAdmissionMode: null,
      livekitRecordingMode: null,
    },
  );
  assert.equal(
    await publishAdminEventOccurrence(
      created.eventOccurrenceId,
      administrator,
      null,
    ),
    "livekit-unavailable",
  );
  await database
    .updateTable("event_session")
    .set({
      livekitRecordingMode: "automatic",
      livekitRecordingRetentionDays: 30,
      livekitAttendeeRecordingNotice: "This session will be recorded.",
      livekitPresenterRecordingNotice: "This session will be recorded.",
    })
    .where("eventOccurrenceId", "=", created.eventOccurrenceId)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("event_session")
    .set({
      livekitAttendanceMode: "automatic_check_in",
    })
    .where("eventOccurrenceId", "=", created.eventOccurrenceId)
    .executeTakeFirstOrThrow();
  assert.equal(
    await publishAdminEventOccurrence(
      created.eventOccurrenceId,
      administrator,
      { approvedMaxParticipants: 25 },
    ),
    "livekit-policy-unavailable",
    "Automatic check-in must remain dormant while automatic recording is publishable",
  );
  await database
    .updateTable("event_session")
    .set({
      livekitAttendanceMode: "automatic_duration",
      livekitAttendanceMinimumMinutes: 30,
    })
    .where("eventOccurrenceId", "=", created.eventOccurrenceId)
    .executeTakeFirstOrThrow();
  assert.equal(
    await publishAdminEventOccurrence(
      created.eventOccurrenceId,
      administrator,
      { approvedMaxParticipants: 25 },
    ),
    "livekit-policy-unavailable",
    "Automatic duration attendance must remain dormant until reconciliation is active",
  );
  await database
    .updateTable("event_session")
    .set({
      livekitAttendanceMode: "manual",
      livekitAttendanceMinimumMinutes: null,
    })
    .where("eventOccurrenceId", "=", created.eventOccurrenceId)
    .executeTakeFirstOrThrow();
  assert.equal(
    await publishAdminEventOccurrence(
      created.eventOccurrenceId,
      administrator,
      { approvedMaxParticipants: 25 },
      null,
    ),
    "livekit-unavailable",
    "Automatic recording must remain unpublished without an upload-authorized recording provider",
  );
  const recordingProvider = new FakeLiveKitRecordingProvider();
  await database
    .updateTable("event_session")
    .set({
      localEndsAt: "2030-09-04T12:01:00",
      endsAt: new Date("2030-09-04T02:01:00.000Z"),
    })
    .where("eventOccurrenceId", "=", created.eventOccurrenceId)
    .executeTakeFirstOrThrow();
  assert.equal(
    await publishAdminEventOccurrence(
      created.eventOccurrenceId,
      administrator,
      { approvedMaxParticipants: 25 },
      new FakeLiveKitRecordingProvider(
        LIVEKIT_ROLE_CHAINED_RECORDING_AUTHORIZATION_POLICY,
      ),
    ),
    "livekit-policy-unavailable",
    "Even a short retained automatic recording must include its full presenter-preparation window in publication policy",
  );
  await database
    .updateTable("event_session")
    .set({
      localEndsAt: occurrenceInput.localEndsAt,
      endsAt: new Date(occurrenceInput.endsAt),
    })
    .where("eventOccurrenceId", "=", created.eventOccurrenceId)
    .executeTakeFirstOrThrow();
  assert.equal(
    await publishAdminEventOccurrence(
      created.eventOccurrenceId,
      administrator,
      {
        approvedMaxParticipants: 24,
      },
      recordingProvider,
    ),
    "livekit-capacity-exceeded",
  );
  assert.equal(
    await publishAdminEventOccurrence(
      created.eventOccurrenceId,
      administrator,
      {
        approvedMaxParticipants: 25,
      },
      recordingProvider,
    ),
    "published",
    "Automatic recording with manual attendance must publish",
  );
  const publishedOccurrence = await database
    .selectFrom("event_occurrence")
    .select(["status", "publishedAt"])
    .where("id", "=", created.eventOccurrenceId)
    .executeTakeFirstOrThrow();
  assert.equal(publishedOccurrence.status, "published");
  assert.ok(publishedOccurrence.publishedAt instanceof Date);

  const rescheduleInput = {
    occurrence: { ...occurrenceInput, capacity: 21 },
    registrationWindowPolicy: "keep" as const,
    regionsConfirmed: true as const,
    regionalCoverage: { regions: [], retirements: [] },
  };
  assert.equal(
    await rescheduleAdminEventOccurrence(
      created.eventOccurrenceId,
      rescheduleInput,
      administrator,
      null,
    ),
    "livekit-unavailable",
  );
  assert.equal(
    await rescheduleAdminEventOccurrence(
      created.eventOccurrenceId,
      rescheduleInput,
      administrator,
      { approvedMaxParticipants: 25 },
    ),
    "livekit-capacity-exceeded",
  );
  assert.equal(
    await rescheduleAdminEventOccurrence(
      created.eventOccurrenceId,
      rescheduleInput,
      administrator,
      { approvedMaxParticipants: 26 },
    ),
    "rescheduled",
  );
  assert.equal(
    (
      await database
        .selectFrom("event_occurrence")
        .select("capacity")
        .where("id", "=", created.eventOccurrenceId)
        .executeTakeFirstOrThrow()
    ).capacity,
    21,
  );
  const preparedSession = await database
    .selectFrom("event_session")
    .select("id")
    .where("eventOccurrenceId", "=", created.eventOccurrenceId)
    .executeTakeFirstOrThrow();
  const preparedAt = new Date("2030-09-03T23:30:00.000Z");
  await database
    .insertInto("event_virtual_room")
    .values({
      id: ids.preparedRoom,
      eventSessionId: preparedSession.id,
      provider: "livekit",
      generation: 1,
      providerRoomName: "upskill_room_verify_livekit_policy_prepared",
      providerRoomSid: null,
      doorState: "scheduled",
      admissionMode: "automatic",
      attendanceMode: "manual",
      attendanceMinimumMinutes: null,
      recordingMode: "off",
      recordingRetentionDays: null,
      maxParticipants: 26,
      providerStatus: "pending",
      providerErrorCode: null,
      createdByUserId: administrator.id,
      createdAt: preparedAt,
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
  assert.equal(
    await rescheduleAdminEventOccurrence(
      created.eventOccurrenceId,
      {
        ...rescheduleInput,
        occurrence: { ...rescheduleInput.occurrence, capacity: 22 },
      },
      administrator,
      { approvedMaxParticipants: 27 },
    ),
    "conflict",
    "A prepared room must prevent a capacity reschedule from silently retaining its old limit",
  );
  assert.equal(
    (
      await database
        .selectFrom("event_occurrence")
        .select("capacity")
        .where("id", "=", created.eventOccurrenceId)
        .executeTakeFirstOrThrow()
    ).capacity,
    21,
  );

  await database
    .updateTable("event_template_session_definition")
    .set({ livekitAdmissionMode: "manual" })
    .where("id", "=", ids.definition)
    .executeTakeFirstOrThrow();
  assert.equal(
    (
      await database
        .selectFrom("event_session")
        .select("livekitAdmissionMode")
        .where("eventOccurrenceId", "=", created.eventOccurrenceId)
        .executeTakeFirstOrThrow()
    ).livekitAdmissionMode,
    "automatic",
    "Exact-session policy snapshots must not follow later template changes",
  );

  await assert.rejects(
    database
      .updateTable("event_session")
      .set({
        livekitAttendanceMode: "automatic_duration",
        livekitAttendanceMinimumMinutes: 61,
      })
      .where("eventOccurrenceId", "=", created.eventOccurrenceId)
      .execute(),
    /event_session_livekit_delivery_ck/u,
  );

  console.log(
    "Verified LiveKit provider backfill, legacy-writer and rollback-edit compatibility, serialized configured publication, versioned defaults, exact-session snapshots, disabled, dormant automation and capacity publication gates, reschedule gating, and database constraints",
  );
} finally {
  if (!migrationRestored)
    try {
      await upProviderPolicy(database);
      await upRoomLifecycle(database);
      await upAttendeeLobby(database);
      await upLobbyRevision(database);
      await upParticipantOperations(database);
      await upRecoveryDeliveryQueue(database);
      await upCredentialReservationIndex(database);
      await upRecoveryOutcomeAudit(database);
      await upAttendeeTokenDenialAudit(database);
      await upPresenterTokenDenialAudit(database);
      await upPresenterCredentialReservations(database);
      await upPresenterParticipantOperations(database);
      await upOpenEntryJoinSessions(database);
      await upParticipantRemovalEnforcement(database);
      await upRecordingEvidence(database);
      await upRecordingOperations(database);
      await upRecordingStartDispatch(database);
      await upRecordingLifecycleAudit(database);
      await upRecordingStopDispatch(database);
      await upRecordingStopOutcome(database);
      await upRecordingWebhookReceipts(database);
      await upRecordingReceiptAttention(database);
      await upRecordingAccessAudit(database);
    } catch {
      // Preserve the original verification failure when restoration cannot run.
    }
  if (migrationRestored) {
    await database
      .deleteFrom("event_virtual_join_access")
      .where("eventOccurrenceId", "in", (builder) =>
        builder
          .selectFrom("event_occurrence")
          .select("id")
          .where("eventTemplateVersionId", "=", ids.version),
      )
      .execute();
    await database
      .deleteFrom("event_virtual_room")
      .where("id", "=", ids.preparedRoom)
      .execute();
    await database
      .deleteFrom("event_admin_assignment")
      .where("eventOccurrenceId", "in", (builder) =>
        builder
          .selectFrom("event_occurrence")
          .select("id")
          .where("eventTemplateVersionId", "=", ids.version),
      )
      .execute();
    await database
      .deleteFrom("event_occurrence_reschedule")
      .where("eventOccurrenceId", "in", (builder) =>
        builder
          .selectFrom("event_occurrence")
          .select("id")
          .where("eventTemplateVersionId", "=", ids.version),
      )
      .execute();
    await database
      .deleteFrom("event_occurrence")
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
      .where("id", "=", ids.administrator)
      .execute();
  }
  await destroyDatabase();
}
