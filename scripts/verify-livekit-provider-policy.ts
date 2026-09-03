import assert from "node:assert/strict";
import { sql } from "kysely";
import {
  createAdminEventOccurrence,
  publishAdminEventOccurrence,
  rescheduleAdminEventOccurrence,
} from "#/server/admin/admin-event-occurrence.server";
import { destroyDatabase, getDatabase } from "#/server/db/database.server";
import {
  down,
  up,
} from "#/server/db/migrations/0085_livekit_versioned_provider_policy";
import type { AuthenticatedUser } from "#/server/auth/session.server";

const ids = {
  administrator: "verify_livekit_policy_administrator",
  template: "verify_livekit_policy_template",
  version: "verify_livekit_policy_version",
  definition: "verify_livekit_policy_definition",
  legacyOccurrence: "verify_livekit_policy_legacy_occurrence",
  legacySession: "verify_livekit_policy_legacy_session",
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
  await down(database);
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

  await up(database);
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
  assert.equal(
    await publishAdminEventOccurrence(
      created.eventOccurrenceId,
      administrator,
      null,
    ),
    "livekit-unavailable",
  );
  assert.equal(
    await publishAdminEventOccurrence(
      created.eventOccurrenceId,
      administrator,
      {
        approvedMaxParticipants: 24,
      },
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
    ),
    "livekit-unavailable",
  );

  // Published LiveKit rows become reachable only after the later delivery
  // slices remove the runtime publication guard. Seed that future lifecycle
  // state directly so this slice still proves reschedule capacity safety.
  await database
    .updateTable("event_occurrence")
    .set({ status: "published", publishedAt: new Date() })
    .where("id", "=", created.eventOccurrenceId)
    .executeTakeFirstOrThrow();

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
    "Verified LiveKit provider backfill, versioned defaults, exact-session snapshots, dormant publication and reschedule gating, and database constraints",
  );
} finally {
  if (!migrationRestored)
    try {
      await up(database);
    } catch {
      // Preserve the original verification failure when restoration cannot run.
    }
  if (migrationRestored) {
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
