import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import {
  createAdminEventOccurrence,
  createAdminEventTemplate,
  publishAdminEventOccurrence,
  publishAdminEventTemplateVersion,
} from "#/server/admin/admin-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { destroyDatabase, getDatabase } from "#/server/db/database.server";

const database = getDatabase();
const suffix = randomUUID();
const administrator: AuthenticatedUser = {
  id: `verify_event_admin_${suffix}`,
  name: "Event verifier",
  email: `verify-event-${suffix}@example.com`,
  emailVerified: true,
};
let eventTemplateId: string | null = null;
let eventTemplateVersionId: string | null = null;
let eventOccurrenceId: string | null = null;

async function cleanup(): Promise<void> {
  if (eventOccurrenceId) {
    const participationIds = await database
      .selectFrom("event_participation")
      .select("id")
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .execute();
    if (participationIds.length)
      await database
        .deleteFrom("event_attendance")
        .where(
          "eventParticipationId",
          "in",
          participationIds.map((row) => row.id),
        )
        .execute();
    await database
      .deleteFrom("event_participation")
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .execute();
    await database
      .deleteFrom("event_registration")
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .execute();
    await database
      .deleteFrom("event_presenter_assignment")
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .execute();
    const occurrenceRegionIds = await database
      .selectFrom("event_occurrence_region")
      .select("id")
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .execute();
    if (occurrenceRegionIds.length) {
      const ids = occurrenceRegionIds.map((row) => row.id);
      await database
        .deleteFrom("event_coordinator_assignment")
        .where("eventOccurrenceRegionId", "in", ids)
        .execute();
      await database
        .deleteFrom("event_region_review_round")
        .where("eventOccurrenceRegionId", "in", ids)
        .execute();
    }
    await database
      .deleteFrom("event_admin_assignment")
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .execute();
    await database
      .deleteFrom("event_session")
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .execute();
    await database
      .deleteFrom("event_occurrence_region")
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .execute();
    await database
      .deleteFrom("event_occurrence_domain")
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .execute();
    await database
      .deleteFrom("event_occurrence")
      .where("id", "=", eventOccurrenceId)
      .execute();
  }
  if (eventTemplateVersionId) {
    await database
      .deleteFrom("event_template_version_presenter_default")
      .where("eventTemplateVersionId", "=", eventTemplateVersionId)
      .execute();
    await database
      .deleteFrom("event_template_session_definition")
      .where("eventTemplateVersionId", "=", eventTemplateVersionId)
      .execute();
    await database
      .deleteFrom("event_template_version_coordinator_default")
      .where("eventTemplateVersionId", "=", eventTemplateVersionId)
      .execute();
    await database
      .deleteFrom("event_template_version_region")
      .where("eventTemplateVersionId", "=", eventTemplateVersionId)
      .execute();
    await database
      .deleteFrom("event_template_version_admin_default")
      .where("eventTemplateVersionId", "=", eventTemplateVersionId)
      .execute();
    await database
      .deleteFrom("event_template_version")
      .where("id", "=", eventTemplateVersionId)
      .execute();
  }
  if (eventTemplateId)
    await database
      .deleteFrom("event_template")
      .where("id", "=", eventTemplateId)
      .execute();
  await database
    .deleteFrom("outbox_event")
    .where("aggregateId", "in", [
      ...(eventTemplateId ? [eventTemplateId] : []),
      ...(eventOccurrenceId ? [eventOccurrenceId] : []),
    ])
    .execute();
  await database.transaction().execute(async (transaction) => {
    await sql`select set_config('upskill.audit_maintenance', 'on', true)`.execute(
      transaction,
    );
    await transaction
      .deleteFrom("audit_event")
      .where("subjectId", "in", [
        ...(eventTemplateId ? [eventTemplateId] : []),
        ...(eventTemplateVersionId ? [eventTemplateVersionId] : []),
        ...(eventOccurrenceId ? [eventOccurrenceId] : []),
      ])
      .execute();
  });
  await database
    .deleteFrom("platform_admin")
    .where("userId", "=", administrator.id)
    .execute();
  await database
    .deleteFrom("user")
    .where("id", "=", administrator.id)
    .execute();
}

try {
  await database
    .insertInto("user")
    .values({
      id: administrator.id,
      name: administrator.name,
      email: administrator.email,
      emailVerified: true,
    })
    .execute();
  await database
    .insertInto("platform_admin")
    .values({ userId: administrator.id, grantedByUserId: null })
    .execute();

  const createdTemplate = await createAdminEventTemplate(
    {
      title: "Verification workshop",
      slug: `verification-workshop-${suffix}`,
      summary: "A versioned Event Template verification fixture.",
      description:
        "Verifies exact-version occurrence provenance and durable staff attribution.",
      sessionTitle: "Workshop session",
      sessionDurationMinutes: 120,
      hasCompletionCertificate: true,
    },
    administrator,
  );
  assert.equal(createdTemplate.status, "created");
  eventTemplateId = createdTemplate.eventTemplateId;
  eventTemplateVersionId = createdTemplate.eventTemplateVersionId;
  assert.equal(
    await publishAdminEventTemplateVersion(
      eventTemplateId,
      eventTemplateVersionId,
      administrator,
    ),
    "published",
  );
  assert.equal(
    await publishAdminEventTemplateVersion(
      eventTemplateId,
      eventTemplateVersionId,
      administrator,
    ),
    "conflict",
  );

  const startsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);
  const registrationOpensAt = new Date();
  const registrationClosesAt = new Date(
    startsAt.getTime() - 48 * 60 * 60 * 1000,
  );
  const coordinatorLockAt = new Date(startsAt.getTime() - 24 * 60 * 60 * 1000);
  const createdOccurrence = await createAdminEventOccurrence(
    {
      eventTemplateVersionId,
      title: "Verification workshop · Sydney",
      deliveryMode: "hybrid",
      registrationMode: "required_restricted",
      approvalMode: "manual",
      timezone: "Australia/Sydney",
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      registrationOpensAt: registrationOpensAt.toISOString(),
      registrationClosesAt: registrationClosesAt.toISOString(),
      coordinatorLockAt: coordinatorLockAt.toISOString(),
      capacity: 2,
      venueName: "Verification Centre",
      venueAddress: "1 Test Street, Sydney NSW",
      virtualJoinUrl: "https://meet.example.com/verification",
      domains: "example.com, health.example.org",
    },
    administrator,
  );
  assert.equal(createdOccurrence.status, "created");
  eventOccurrenceId = createdOccurrence.eventOccurrenceId;
  assert.equal(
    await publishAdminEventOccurrence(eventOccurrenceId, administrator),
    "published",
  );
  assert.equal(
    await publishAdminEventOccurrence(eventOccurrenceId, administrator),
    "conflict",
  );

  const occurrence = await database
    .selectFrom("event_occurrence")
    .select([
      "eventTemplateVersionId",
      "status",
      "deliveryMode",
      "registrationMode",
      "capacity",
      "confirmedCount",
    ])
    .where("id", "=", eventOccurrenceId)
    .executeTakeFirstOrThrow();
  assert.deepEqual(occurrence, {
    eventTemplateVersionId,
    status: "published",
    deliveryMode: "hybrid",
    registrationMode: "required_restricted",
    capacity: 2,
    confirmedCount: 0,
  });
  assert.deepEqual(
    await database
      .selectFrom("event_occurrence_domain")
      .select("domain")
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .orderBy("domain")
      .execute(),
    [{ domain: "example.com" }, { domain: "health.example.org" }],
  );
  const session = await database
    .selectFrom("event_session")
    .select(["id", "title", "startsAt", "endsAt"])
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .executeTakeFirstOrThrow();
  assert.equal(session.title, "Workshop session");
  assert.equal(session.startsAt.toISOString(), startsAt.toISOString());
  assert.equal(session.endsAt.toISOString(), endsAt.toISOString());
  assert.equal(
    await database
      .selectFrom("event_admin_assignment")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .where("userId", "=", administrator.id)
      .where("source", "=", "template_default")
      .executeTakeFirstOrThrow()
      .then((row) => row.count),
    1,
  );
  assert.equal(
    await database
      .selectFrom("event_presenter_assignment")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .where("eventSessionId", "=", session.id)
      .where("userId", "=", administrator.id)
      .executeTakeFirstOrThrow()
      .then((row) => row.count),
    1,
  );

  const registrationId = `event_registration_${suffix}`;
  const participationId = `event_participation_${suffix}`;
  await database
    .insertInto("event_registration")
    .values({
      id: registrationId,
      eventOccurrenceId,
      userId: administrator.id,
      eventOccurrenceRegionId: null,
      reviewRoundId: null,
      nameSnapshot: administrator.name,
      emailSnapshot: administrator.email,
      source: "administrator_override",
      eligibilitySource: "administrator_override",
      status: "selected",
      coordinatorPriority: null,
      coordinatorDecidedAt: null,
      coordinatorDecidedByUserId: null,
      finalDecidedAt: new Date(),
      finalDecidedByUserId: administrator.id,
      lockedInAt: new Date(),
    })
    .execute();
  await database
    .insertInto("event_participation")
    .values({
      id: participationId,
      eventOccurrenceId,
      userId: administrator.id,
      registrationId,
      mode: "registered",
      nameSnapshot: administrator.name,
      emailSnapshot: administrator.email,
      detailsSubmittedAt: null,
      joinDisclosedAt: null,
      checkedInAt: null,
    })
    .execute();
  const recordedAt = new Date();
  await database
    .insertInto("event_attendance")
    .values({
      eventParticipationId: participationId,
      eventSessionId: session.id,
      state: "attended",
      source: "administrator",
      recordedByUserId: administrator.id,
      recordedAt,
      updatedAt: recordedAt,
    })
    .execute();
  assert.equal(
    await database
      .selectFrom("event_attendance")
      .select("state")
      .where("eventParticipationId", "=", participationId)
      .executeTakeFirstOrThrow()
      .then((row) => row.state),
    "attended",
  );
  await assert.rejects(
    database
      .updateTable("event_occurrence")
      .set({ confirmedCount: 3 })
      .where("id", "=", eventOccurrenceId)
      .execute(),
    /event_occurrence_capacity_ck/u,
  );

  await database
    .deleteFrom("platform_admin")
    .where("userId", "=", administrator.id)
    .execute();
  assert.equal(
    await database
      .selectFrom("event_admin_assignment")
      .select("userId")
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .executeTakeFirstOrThrow()
      .then((row) => row.userId),
    administrator.id,
  );

  console.log(
    "Verified immutable Event Template publication, exact-version occurrence scheduling, staff/session snapshots, restricted domains, registration/participation separation, attendance evidence and capacity constraints",
  );
} finally {
  await cleanup();
  await destroyDatabase();
}
