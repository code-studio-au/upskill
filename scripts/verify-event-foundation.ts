import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import {
  createAdminEventOccurrence,
  createAdminEventTemplate,
  findAdminEventStaffCandidates,
  grantAdminEventStaffEligibility,
  publishAdminEventOccurrence,
  publishAdminEventTemplateVersion,
  rescheduleAdminEventOccurrence,
  revokeAdminEventStaffEligibility,
  saveAdminCoordinationRegion,
  saveAdminEventTemplateDraft,
  updateAdminEventOccurrence,
} from "#/server/admin/admin-event.server";
import {
  addAdminEventRegistration,
  decideAdminEventFinalRegistration,
  findAdminEventOccurrenceOperations,
  lockAdminEventRegion,
  recordAdminEventAttendance,
  transitionAdminEventOccurrence,
} from "#/server/admin/admin-event-operations.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { destroyDatabase, getDatabase } from "#/server/db/database.server";
import { getEventOperationsAccess } from "#/server/events/event-operations-access.server";
import { findEventOperationsWorkspace } from "#/server/events/event-operations.server";
import {
  registerLearnerForEvent,
  withdrawLearnerEventRegistration,
} from "#/server/learner/learner-event.server";
import { findLearnerEventsDashboard } from "#/server/learner/learner.server";
import { ensureEventSectionReleased } from "#/server/learning/event-section-release.server";
import { findLearnerEventWorkspace } from "#/server/learning/learner-event-workspace.server";

const database = getDatabase();
const suffix = randomUUID();
const administrator: AuthenticatedUser = {
  id: `verify_event_admin_${suffix}`,
  name: "Event verifier",
  email: `verify-event-${suffix}@example.com`,
  emailVerified: true,
};
const learner: AuthenticatedUser = {
  id: `verify_event_learner_${suffix}`,
  name: "Event learner",
  email: `verify-event-${suffix}@health.example.org`,
  emailVerified: true,
};
const coordinator: AuthenticatedUser = {
  id: `verify_event_coordinator_${suffix}`,
  name: "Event coordinator",
  email: `verify-event-coordinator-${suffix}@example.com`,
  emailVerified: true,
};
const presenter: AuthenticatedUser = {
  id: `verify_event_presenter_${suffix}`,
  name: "Event presenter",
  email: `verify-event-presenter-${suffix}@example.com`,
  emailVerified: true,
};
const coordinationRegionId = `coordination_region_${suffix}`;
const addedCoordinationRegionId = `coordination_region_added_${suffix}`;
let eventTemplateId: string | null = null;
let eventTemplateVersionId: string | null = null;
let eventOccurrenceId: string | null = null;
let coordinationRegionGroupId: string | null = null;

async function cleanup(): Promise<void> {
  if (eventOccurrenceId) {
    const rescheduleIds = await database
      .selectFrom("event_occurrence_reschedule")
      .select("id")
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .execute();
    const participationIds = await database
      .selectFrom("event_participation")
      .select("id")
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .execute();
    if (participationIds.length)
      await database
        .deleteFrom("event_section_release")
        .where(
          "eventParticipationId",
          "in",
          participationIds.map((row) => row.id),
        )
        .execute();
    if (participationIds.length)
      await database
        .deleteFrom("learning_item_progress")
        .where(
          "eventParticipationId",
          "in",
          participationIds.map((row) => row.id),
        )
        .execute();
    if (participationIds.length)
      await database
        .deleteFrom("survey_response")
        .where(
          "eventParticipationId",
          "in",
          participationIds.map((row) => row.id),
        )
        .execute();
    if (participationIds.length)
      await database
        .deleteFrom("survey_progress")
        .where(
          "eventParticipationId",
          "in",
          participationIds.map((row) => row.id),
        )
        .execute();
    if (participationIds.length)
      await database
        .deleteFrom("scorm_attempt")
        .where(
          "eventParticipationId",
          "in",
          participationIds.map((row) => row.id),
        )
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
    const registrationIds = await database
      .selectFrom("event_registration")
      .select("id")
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .execute();
    if (registrationIds.length)
      await database
        .deleteFrom("event_registration_transition")
        .where(
          "eventRegistrationId",
          "in",
          registrationIds.map((registration) => registration.id),
        )
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
    if (rescheduleIds.length) {
      const ids = rescheduleIds.map((row) => row.id);
      await database
        .deleteFrom("event_occurrence_reschedule_region_coordinator")
        .where("eventOccurrenceRescheduleId", "in", ids)
        .execute();
      await database
        .deleteFrom("event_occurrence_reschedule_region")
        .where("eventOccurrenceRescheduleId", "in", ids)
        .execute();
      await database
        .deleteFrom("event_occurrence_reschedule")
        .where("id", "in", ids)
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
  const aggregateIds = [
    ...(eventTemplateId ? [eventTemplateId] : []),
    ...(eventOccurrenceId ? [eventOccurrenceId] : []),
  ];
  if (aggregateIds.length)
    await database
      .deleteFrom("outbox_event")
      .where("aggregateId", "in", aggregateIds)
      .execute();
  await database.transaction().execute(async (transaction) => {
    await sql`select set_config('upskill.audit_maintenance', 'on', true)`.execute(
      transaction,
    );
    await transaction
      .deleteFrom("audit_event")
      .where("actorUserId", "in", [
        administrator.id,
        learner.id,
        coordinator.id,
        presenter.id,
      ])
      .execute();
  });
  await database
    .deleteFrom("platform_admin")
    .where("userId", "=", administrator.id)
    .execute();
  await database
    .deleteFrom("event_staff_eligibility")
    .where("userId", "in", [
      administrator.id,
      learner.id,
      coordinator.id,
      presenter.id,
    ])
    .execute();
  await database
    .deleteFrom("user")
    .where("id", "=", administrator.id)
    .execute();
  await database.deleteFrom("user").where("id", "=", learner.id).execute();
  await database
    .deleteFrom("user")
    .where("id", "in", [coordinator.id, presenter.id])
    .execute();
  await database
    .deleteFrom("coordination_region")
    .where("id", "in", [coordinationRegionId, addedCoordinationRegionId])
    .execute();
  if (coordinationRegionGroupId)
    await database
      .deleteFrom("coordination_region")
      .where("id", "=", coordinationRegionGroupId)
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
    .insertInto("user")
    .values([
      {
        id: coordinator.id,
        name: coordinator.name,
        email: coordinator.email,
        emailVerified: true,
      },
      {
        id: presenter.id,
        name: presenter.name,
        email: presenter.email,
        emailVerified: true,
      },
    ])
    .execute();
  await database
    .insertInto("coordination_region")
    .values([
      {
        id: coordinationRegionId,
        parentId: null,
        code: `VERIFY-${suffix}`.toLocaleUpperCase("en-AU"),
        name: "Verification region",
        kind: "operational",
        status: "active",
      },
      {
        id: addedCoordinationRegionId,
        parentId: null,
        code: `VERIFY-ADDED-${suffix}`.toLocaleUpperCase("en-AU"),
        name: "Added verification region",
        kind: "operational",
        status: "active",
      },
    ])
    .execute();
  await database
    .insertInto("platform_admin")
    .values({ userId: administrator.id, grantedByUserId: null })
    .execute();
  await database
    .insertInto("user")
    .values({
      id: learner.id,
      name: learner.name,
      email: learner.email,
      emailVerified: true,
    })
    .execute();

  const createdGroup = await saveAdminCoordinationRegion(
    {
      regionId: null,
      name: "Verification jurisdiction",
      code: `verify-group-${suffix}`,
      kind: "group",
      parentId: null,
    },
    administrator,
  );
  assert.equal(createdGroup.status, "created");
  assert.ok("regionId" in createdGroup);
  coordinationRegionGroupId = createdGroup.regionId;
  assert.deepEqual(
    await saveAdminCoordinationRegion(
      {
        regionId: coordinationRegionId,
        name: "Verification region",
        code: `verify-${suffix}`,
        kind: "operational",
        parentId: coordinationRegionGroupId,
      },
      administrator,
    ),
    { status: "updated", regionId: coordinationRegionId },
  );

  assert.equal(
    (
      await grantAdminEventStaffEligibility(
        {
          email: coordinator.email,
          responsibility: "coordinator",
          regionId: coordinationRegionId,
        },
        administrator,
      )
    )?.status,
    "granted",
  );
  assert.equal(
    (
      await grantAdminEventStaffEligibility(
        {
          email: presenter.email,
          responsibility: "presenter",
          regionId: null,
        },
        administrator,
      )
    )?.status,
    "granted",
  );
  assert.equal(
    (
      await grantAdminEventStaffEligibility(
        {
          email: administrator.email,
          responsibility: "coordinator",
          regionId: addedCoordinationRegionId,
        },
        administrator,
      )
    )?.status,
    "granted",
  );
  const temporaryEligibility = await grantAdminEventStaffEligibility(
    {
      email: learner.email,
      responsibility: "presenter",
      regionId: null,
    },
    administrator,
  );
  assert.ok(temporaryEligibility);
  assert.equal(
    await revokeAdminEventStaffEligibility(
      temporaryEligibility.eligibilityId,
      administrator,
    ),
    "revoked",
  );
  assert.equal(
    (
      await findAdminEventStaffCandidates({
        q: presenter.email,
        responsibility: "presenter",
        regionId: null,
      })
    ).length,
    0,
  );
  assert.deepEqual(
    (
      await findAdminEventStaffCandidates({
        q: learner.email,
        responsibility: "presenter",
        regionId: null,
      })
    ).map((candidate) => candidate.id),
    [learner.id],
  );
  assert.equal(
    (
      await findAdminEventStaffCandidates({
        q: coordinator.email,
        responsibility: "coordinator",
        regionId: coordinationRegionId,
      })
    ).length,
    0,
  );
  assert.deepEqual(
    (
      await findAdminEventStaffCandidates({
        q: coordinator.email,
        responsibility: "coordinator",
        regionId: addedCoordinationRegionId,
      })
    ).map((candidate) => candidate.id),
    [coordinator.id],
  );

  const createdTemplate = await createAdminEventTemplate(
    {
      title: "Verification workshop",
      defaultAdministratorIds: [administrator.id],
    },
    administrator,
  );
  assert.equal(createdTemplate.status, "created");
  eventTemplateId = createdTemplate.eventTemplateId;
  eventTemplateVersionId = createdTemplate.eventTemplateVersionId;
  assert.equal(
    await saveAdminEventTemplateDraft(
      {
        eventTemplateId,
        eventTemplateVersionId,
        title: "Verification workshop",
        summary: "A versioned Event Template verification fixture.",
        description:
          "Verifies exact-version occurrence provenance and durable staff attribution.",
        hasCompletionCertificate: true,
        defaultAdministratorIds: [administrator.id],
        regions: [
          {
            regionId: coordinationRegionId,
            coordinatorIds: [coordinator.id],
          },
        ],
        sections: [
          {
            id: `event_section_${suffix}`,
            title: "Event",
            description: "The event session.",
            phase: "session",
            releaseAnchor: "occurrence_start",
            releaseOffsetMinutes: 0,
            items: [
              {
                id: `event_item_${suffix}`,
                kind: "session",
                title: "Workshop session",
                required: true,
                durationMinutes: 120,
                presenterRequired: true,
                presenterIds: [presenter.id],
              },
            ],
          },
        ],
      },
      administrator,
    ),
    "saved",
  );
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
  const occurrenceInput = {
    eventTemplateVersionId,
    title: "Verification workshop · Sydney",
    slug: `verification-workshop-sydney-${suffix}`,
    deliveryMode: "in_person" as const,
    registrationMode: "required_restricted" as const,
    approvalMode: "manual" as const,
    timezone: "Australia/Sydney",
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    registrationOpensAt: registrationOpensAt.toISOString(),
    registrationClosesAt: registrationClosesAt.toISOString(),
    coordinatorLockAt: coordinatorLockAt.toISOString(),
    capacity: 2,
    venueName: "Verification Centre",
    venueAddress: "1 Test Street, Sydney NSW",
    virtualJoinUrl: "",
    domains: "example.com, health.example.org",
  };
  const createdOccurrence = await createAdminEventOccurrence(
    occurrenceInput,
    administrator,
  );
  assert.equal(createdOccurrence.status, "created");
  eventOccurrenceId = createdOccurrence.eventOccurrenceId;
  assert.deepEqual(
    await createAdminEventOccurrence(occurrenceInput, administrator),
    { status: "slug-in-use" },
  );
  const rescheduledStartsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
  const rescheduledEndsAt = new Date(endsAt.getTime() + 60 * 60 * 1000);
  assert.equal(
    await updateAdminEventOccurrence(
      eventOccurrenceId,
      {
        eventTemplateVersionId,
        title: "Verification workshop · Rescheduled",
        slug: `verification-workshop-rescheduled-${suffix}`,
        deliveryMode: "in_person",
        registrationMode: "required_restricted",
        approvalMode: "manual",
        timezone: "Australia/Sydney",
        startsAt: rescheduledStartsAt.toISOString(),
        endsAt: rescheduledEndsAt.toISOString(),
        registrationOpensAt: registrationOpensAt.toISOString(),
        registrationClosesAt: registrationClosesAt.toISOString(),
        coordinatorLockAt: coordinatorLockAt.toISOString(),
        capacity: 3,
        venueName: "Updated Verification Centre",
        venueAddress: "2 Test Street, Sydney NSW",
        virtualJoinUrl: "",
        domains: "health.example.org",
      },
      administrator,
    ),
    "updated",
  );
  await database
    .deleteFrom("platform_admin")
    .where("userId", "=", administrator.id)
    .execute();
  assert.equal(
    await getEventOperationsAccess(administrator, eventOccurrenceId),
    null,
  );
  assert.equal(
    await publishAdminEventOccurrence(eventOccurrenceId, administrator),
    "conflict",
  );
  await database
    .insertInto("platform_admin")
    .values({ userId: administrator.id, grantedByUserId: null })
    .execute();
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
      "slug",
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
    slug: `verification-workshop-rescheduled-${suffix}`,
    status: "published",
    deliveryMode: "in_person",
    registrationMode: "required_restricted",
    capacity: 3,
    confirmedCount: 0,
  });
  assert.deepEqual(
    await database
      .selectFrom("event_occurrence_domain")
      .select("domain")
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .orderBy("domain")
      .execute(),
    [{ domain: "health.example.org" }],
  );
  const session = await database
    .selectFrom("event_session")
    .select(["id", "title", "startsAt", "endsAt"])
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .executeTakeFirstOrThrow();
  const occurrenceRegion = await database
    .selectFrom("event_occurrence_region")
    .select("id")
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .where("regionId", "=", coordinationRegionId)
    .executeTakeFirstOrThrow();
  assert.equal(session.title, "Workshop session");
  assert.equal(
    session.startsAt.toISOString(),
    rescheduledStartsAt.toISOString(),
  );
  assert.equal(session.endsAt.toISOString(), rescheduledEndsAt.toISOString());
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

  const lockedAt = new Date();
  await database
    .insertInto("event_region_review_round")
    .values({
      id: `event_region_review_round_initial_${suffix}`,
      eventOccurrenceRegionId: occurrenceRegion.id,
      round: 1,
      registrationClosesAt,
      coordinatorLockAt,
      lockedAt,
      lockedByUserId: administrator.id,
      lockSource: "administrator",
    })
    .execute();
  const finalStartsAt = new Date(
    rescheduledStartsAt.getTime() + 24 * 60 * 60 * 1000,
  );
  const finalEndsAt = new Date(
    rescheduledEndsAt.getTime() + 24 * 60 * 60 * 1000,
  );
  const reopenedAt = new Date(Date.now() - 60 * 60 * 1000);
  const reopenedClosesAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
  const reopenedLockAt = new Date(Date.now() + 96 * 60 * 60 * 1000);
  const regionalExpansion = {
    regions: [
      {
        regionId: coordinationRegionId,
        coordinatorIds: [coordinator.id],
      },
      {
        regionId: addedCoordinationRegionId,
        coordinatorIds: [administrator.id],
      },
    ],
    retirements: [],
  };
  assert.equal(
    await rescheduleAdminEventOccurrence(
      eventOccurrenceId,
      {
        occurrence: {
          ...occurrenceInput,
          title: "Verification workshop · Invalid regional expansion",
          slug: `verification-workshop-invalid-expansion-${suffix}`,
          startsAt: finalStartsAt.toISOString(),
          endsAt: finalEndsAt.toISOString(),
          capacity: 3,
          venueName: "Updated Verification Centre",
          venueAddress: "2 Test Street, Sydney NSW",
          domains: "health.example.org",
        },
        registrationWindowPolicy: "keep",
        regionsConfirmed: true,
        regionalCoverage: regionalExpansion,
      },
      administrator,
    ),
    "invalid-window-policy",
  );
  assert.equal(
    await rescheduleAdminEventOccurrence(
      eventOccurrenceId,
      {
        occurrence: {
          ...occurrenceInput,
          title: "Verification workshop · Reopened",
          slug: `verification-workshop-reopened-${suffix}`,
          startsAt: finalStartsAt.toISOString(),
          endsAt: finalEndsAt.toISOString(),
          registrationOpensAt: reopenedAt.toISOString(),
          registrationClosesAt: reopenedClosesAt.toISOString(),
          coordinatorLockAt: reopenedLockAt.toISOString(),
          capacity: 3,
          venueName: "Updated Verification Centre",
          venueAddress: "2 Test Street, Sydney NSW",
          domains: "health.example.org",
        },
        registrationWindowPolicy: "reopen",
        regionsConfirmed: true,
        regionalCoverage: regionalExpansion,
      },
      administrator,
    ),
    "rescheduled",
  );
  const reschedule = await database
    .selectFrom("event_occurrence_reschedule")
    .select(["id", "registrationWindowPolicy"])
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .executeTakeFirstOrThrow();
  assert.equal(reschedule.registrationWindowPolicy, "reopen");
  const addedOccurrenceRegion = await database
    .selectFrom("event_occurrence_region")
    .select("id")
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .where("regionId", "=", addedCoordinationRegionId)
    .executeTakeFirstOrThrow();
  assert.equal(
    await database
      .selectFrom("event_occurrence_reschedule_region")
      .select("coverageAction")
      .where("eventOccurrenceRescheduleId", "=", reschedule.id)
      .where("eventOccurrenceRegionId", "=", addedOccurrenceRegion.id)
      .executeTakeFirstOrThrow()
      .then((row) => row.coverageAction),
    "added",
  );
  assert.deepEqual(
    await database
      .selectFrom("event_region_review_round")
      .select(["round", "lockedAt", "eventOccurrenceRescheduleId"])
      .where("eventOccurrenceRegionId", "=", occurrenceRegion.id)
      .orderBy("round")
      .execute(),
    [
      {
        round: 1,
        lockedAt,
        eventOccurrenceRescheduleId: null,
      },
      {
        round: 2,
        lockedAt: null,
        eventOccurrenceRescheduleId: reschedule.id,
      },
    ],
  );
  assert.equal(
    await database
      .selectFrom("event_occurrence_reschedule_region_coordinator")
      .select("userId")
      .where("eventOccurrenceRescheduleId", "=", reschedule.id)
      .where("eventOccurrenceRegionId", "=", occurrenceRegion.id)
      .executeTakeFirstOrThrow()
      .then((row) => row.userId),
    coordinator.id,
  );
  assert.deepEqual(
    await database
      .selectFrom("event_session")
      .select(["startsAt", "endsAt"])
      .where("id", "=", session.id)
      .executeTakeFirstOrThrow()
      .then((row) => ({
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
      })),
    {
      startsAt: finalStartsAt.toISOString(),
      endsAt: finalEndsAt.toISOString(),
    },
  );
  assert.equal(
    await lockAdminEventRegion(
      eventOccurrenceId,
      occurrenceRegion.id,
      administrator,
    ),
    "locked",
  );
  assert.deepEqual(
    await registerLearnerForEvent(
      eventOccurrenceId,
      occurrenceRegion.id,
      learner,
    ),
    { status: "unavailable" },
  );

  assert.equal(
    await addAdminEventRegistration(
      {
        eventOccurrenceId,
        userId: learner.id,
        eventOccurrenceRegionId: null,
        overrideDomainRestriction: false,
      },
      administrator,
    ),
    "created",
  );
  const operations =
    await findAdminEventOccurrenceOperations(eventOccurrenceId);
  assert.ok(operations);
  assert.equal(operations.metrics.total, 1);
  assert.deepEqual(
    operations.reschedules.map((entry) => ({
      registrationWindowPolicy: entry.registrationWindowPolicy,
      regionCount: entry.regionCount,
      coordinatorCount: entry.coordinatorCount,
    })),
    [
      {
        registrationWindowPolicy: "reopen",
        regionCount: 2,
        coordinatorCount: 2,
      },
    ],
  );
  const learnerRegistration = operations.registrations[0];
  assert.ok(learnerRegistration);
  assert.equal(learnerRegistration.status, "submitted");
  assert.equal(learnerRegistration.eligibilitySource, "verified_domain");
  assert.equal(
    await decideAdminEventFinalRegistration(
      eventOccurrenceId,
      learnerRegistration.id,
      "selected",
      administrator,
    ),
    "updated",
  );
  assert.equal(
    await database
      .selectFrom("event_occurrence")
      .select("confirmedCount")
      .where("id", "=", eventOccurrenceId)
      .executeTakeFirstOrThrow()
      .then((row) => row.confirmedCount),
    1,
  );
  assert.equal(
    await withdrawLearnerEventRegistration(eventOccurrenceId, learner),
    "withdrawn",
  );
  assert.equal(
    await database
      .selectFrom("event_registration_transition")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("eventRegistrationId", "=", learnerRegistration.id)
      .executeTakeFirstOrThrow()
      .then((row) => row.count),
    3,
  );
  assert.equal(
    await database
      .selectFrom("event_presenter_assignment")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .where("eventSessionId", "=", session.id)
      .where("userId", "=", presenter.id)
      .executeTakeFirstOrThrow()
      .then((row) => row.count),
    1,
  );
  const coordinatorAccess = await getEventOperationsAccess(
    coordinator,
    eventOccurrenceId,
  );
  assert.ok(coordinatorAccess);
  assert.deepEqual(coordinatorAccess.coordinatorRegionIds, [
    occurrenceRegion.id,
  ]);
  assert.deepEqual(coordinatorAccess.presenterSessionIds, []);
  const coordinatorWorkspace = await findEventOperationsWorkspace(
    eventOccurrenceId,
    coordinatorAccess,
  );
  assert.ok(coordinatorWorkspace);
  assert.deepEqual(
    coordinatorWorkspace.regions.map((region) => region.id),
    [occurrenceRegion.id],
  );
  assert.equal(coordinatorWorkspace.access.canReviewRegistrations, true);
  const presenterAccess = await getEventOperationsAccess(
    presenter,
    eventOccurrenceId,
  );
  assert.ok(presenterAccess);
  assert.deepEqual(presenterAccess.presenterSessionIds, [session.id]);
  const presenterWorkspace = await findEventOperationsWorkspace(
    eventOccurrenceId,
    presenterAccess,
  );
  assert.ok(presenterWorkspace);
  assert.equal(presenterWorkspace.access.canViewRegistrations, false);
  assert.deepEqual(presenterWorkspace.registrations, []);
  assert.deepEqual(
    presenterWorkspace.sessions.map((assignedSession) => assignedSession.id),
    [session.id],
  );
  assert.equal(
    await getEventOperationsAccess(learner, eventOccurrenceId),
    null,
  );

  const registrationId = `event_registration_${suffix}`;
  const participationId = `event_participation_${suffix}`;
  await database
    .insertInto("event_registration")
    .values({
      id: registrationId,
      eventOccurrenceId,
      userId: administrator.id,
      eventOccurrenceRegionId: occurrenceRegion.id,
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
    .updateTable("event_occurrence")
    .set({ confirmedCount: 1 })
    .where("id", "=", eventOccurrenceId)
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
  assert.equal(
    await recordAdminEventAttendance(
      {
        eventOccurrenceId,
        eventParticipationId: participationId,
        eventSessionId: session.id,
        state: "attended",
      },
      administrator,
    ),
    "recorded",
  );
  assert.equal(
    await database
      .selectFrom("event_attendance")
      .select("state")
      .where("eventParticipationId", "=", participationId)
      .executeTakeFirstOrThrow()
      .then((row) => row.state),
    "attended",
  );
  const templateSection = await database
    .selectFrom("event_template_version_section")
    .select("id")
    .where("eventTemplateVersionId", "=", eventTemplateVersionId)
    .executeTakeFirstOrThrow();
  assert.equal(
    await ensureEventSectionReleased(database, {
      eventParticipationId: participationId,
      eventTemplateVersionSectionId: templateSection.id,
      calculatedReleaseAt: new Date(Date.now() - 1_000),
      now: new Date(),
    }),
    true,
  );
  assert.equal(
    await ensureEventSectionReleased(database, {
      eventParticipationId: participationId,
      eventTemplateVersionSectionId: templateSection.id,
      calculatedReleaseAt: new Date(Date.now() + 86_400_000),
      now: new Date(),
    }),
    true,
  );
  const learnerWorkspace = await findLearnerEventWorkspace(
    eventOccurrenceId,
    administrator,
  );
  assert.equal(learnerWorkspace.status, "ready");
  assert.equal(learnerWorkspace.workspace.sections.length, 1);
  assert.equal(
    learnerWorkspace.workspace.sections[0]?.completionState,
    "completed",
  );
  assert.equal(learnerWorkspace.workspace.completionState, "completed");
  assert.equal(learnerWorkspace.workspace.certificateAvailable, true);
  assert.deepEqual(
    await findLearnerEventWorkspace(eventOccurrenceId, coordinator),
    { status: "not-found" },
  );
  await assert.rejects(
    database
      .updateTable("event_occurrence")
      .set({ confirmedCount: 4 })
      .where("id", "=", eventOccurrenceId)
      .execute(),
    /event_occurrence_capacity_ck/u,
  );

  const coverageRevisionStartsAt = new Date(
    finalStartsAt.getTime() + 24 * 60 * 60 * 1000,
  );
  const coverageRevisionEndsAt = new Date(
    finalEndsAt.getTime() + 24 * 60 * 60 * 1000,
  );
  assert.equal(
    await rescheduleAdminEventOccurrence(
      eventOccurrenceId,
      {
        occurrence: {
          ...occurrenceInput,
          title: "Verification workshop · Coverage revised",
          slug: `verification-workshop-coverage-revised-${suffix}`,
          startsAt: coverageRevisionStartsAt.toISOString(),
          endsAt: coverageRevisionEndsAt.toISOString(),
          capacity: 3,
          venueName: "Updated Verification Centre",
          venueAddress: "2 Test Street, Sydney NSW",
          domains: "health.example.org",
        },
        registrationWindowPolicy: "keep",
        regionsConfirmed: true,
        regionalCoverage: {
          regions: [
            {
              regionId: addedCoordinationRegionId,
              coordinatorIds: [administrator.id],
            },
          ],
          retirements: [
            {
              regionId: coordinationRegionId,
              disposition: "cancel_registrations",
            },
          ],
        },
      },
      administrator,
    ),
    "rescheduled",
  );
  assert.deepEqual(
    await database
      .selectFrom("event_occurrence")
      .select(["confirmedCount", "startsAt"])
      .where("id", "=", eventOccurrenceId)
      .executeTakeFirstOrThrow()
      .then((row) => ({
        confirmedCount: row.confirmedCount,
        startsAt: row.startsAt.toISOString(),
      })),
    {
      confirmedCount: 0,
      startsAt: coverageRevisionStartsAt.toISOString(),
    },
  );
  assert.equal(
    await database
      .selectFrom("event_registration")
      .select("status")
      .where("id", "=", registrationId)
      .executeTakeFirstOrThrow()
      .then((row) => row.status),
    "cancelled",
  );
  assert.ok(
    await database
      .selectFrom("event_occurrence_region")
      .select("retiredAt")
      .where("id", "=", occurrenceRegion.id)
      .executeTakeFirstOrThrow()
      .then((row) => row.retiredAt),
  );
  assert.equal(
    await database
      .selectFrom("event_occurrence_reschedule_region")
      .innerJoin(
        "event_occurrence_reschedule",
        "event_occurrence_reschedule.id",
        "event_occurrence_reschedule_region.eventOccurrenceRescheduleId",
      )
      .select("registrationDisposition")
      .where(
        "event_occurrence_reschedule.eventOccurrenceId",
        "=",
        eventOccurrenceId,
      )
      .where("coverageAction", "=", "retired")
      .executeTakeFirstOrThrow()
      .then((row) => row.registrationDisposition),
    "cancel_registrations",
  );
  assert.equal(
    await database
      .selectFrom("event_attendance")
      .select("state")
      .where("eventParticipationId", "=", participationId)
      .executeTakeFirstOrThrow()
      .then((row) => row.state),
    "attended",
  );
  await database
    .updateTable("event_registration")
    .set({ status: "selected", lockedInAt: new Date() })
    .where("id", "=", learnerRegistration.id)
    .execute();
  await database
    .updateTable("event_occurrence")
    .set({
      confirmedCount: 1,
      registrationOpensAt: new Date(Date.now() - 5 * 60 * 1000),
      registrationClosesAt: new Date(Date.now() - 4 * 60 * 1000),
      coordinatorLockAt: new Date(Date.now() - 3 * 60 * 1000),
      startsAt: new Date(Date.now() - 2 * 60 * 1000),
      endsAt: new Date(Date.now() - 60 * 1000),
    })
    .where("id", "=", eventOccurrenceId)
    .execute();
  assert.equal(
    await withdrawLearnerEventRegistration(eventOccurrenceId, learner),
    "unavailable",
  );
  assert.equal(
    await transitionAdminEventOccurrence(
      eventOccurrenceId,
      "completed",
      administrator,
    ),
    "updated",
  );
  assert.equal(
    await decideAdminEventFinalRegistration(
      eventOccurrenceId,
      learnerRegistration.id,
      "waitlisted",
      administrator,
    ),
    "invalid-transition",
  );
  assert.equal(
    await withdrawLearnerEventRegistration(eventOccurrenceId, learner),
    "unavailable",
  );
  assert.deepEqual(
    await database
      .selectFrom("event_occurrence")
      .innerJoin(
        "event_registration",
        "event_registration.eventOccurrenceId",
        "event_occurrence.id",
      )
      .select([
        "event_occurrence.status as occurrenceStatus",
        "event_occurrence.confirmedCount",
        "event_registration.status as registrationStatus",
      ])
      .where("event_registration.id", "=", learnerRegistration.id)
      .executeTakeFirstOrThrow(),
    {
      occurrenceStatus: "completed",
      confirmedCount: 1,
      registrationStatus: "selected",
    },
  );
  assert.equal(
    (await findLearnerEventsDashboard(administrator)).events.find(
      (event) => event.eventOccurrenceId === eventOccurrenceId,
    )?.registrationStatus,
    "cancelled",
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
    "Verified immutable Event Template publication, exact-version occurrence scheduling, retained reschedule history and review rounds, locked-round registration rejection, regional coverage retirement and registration disposition, staff/session snapshots, scoped coordinator and presenter operations, restricted-domain administrator addition, capacity-safe final selection, lifecycle-safe learner withdrawal and final decisions, retained registration transitions, attendance evidence and capacity constraints",
  );
} finally {
  await cleanup();
  await destroyDatabase();
}
