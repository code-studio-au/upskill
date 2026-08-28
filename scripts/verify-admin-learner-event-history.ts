import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  findAdminLearnerEventDetail,
  findAdminLearnerEvents,
} from "#/server/admin/admin-learner-events.server";
import { findAdminLearnerProfile } from "#/server/admin/admin-learner.server";
import { destroyDatabase, getDatabase } from "#/server/db/database.server";

const database = getDatabase();
const suffix = randomUUID();
const ids = {
  actor: `verify_event_history_actor_${suffix}`,
  learner: `verify_event_history_learner_${suffix}`,
  template: `verify_event_history_template_${suffix}`,
  version: `verify_event_history_version_${suffix}`,
  sessionDefinition: `verify_event_history_session_definition_${suffix}`,
  legacySessionDefinition: `verify_event_history_legacy_session_definition_${suffix}`,
  section: `verify_event_history_section_${suffix}`,
  item: `verify_event_history_item_${suffix}`,
  occurrence: `verify_event_history_occurrence_${suffix}`,
  region: `verify_event_history_region_${suffix}`,
  occurrenceRegion: `verify_event_history_occurrence_region_${suffix}`,
  registration: `verify_event_history_registration_${suffix}`,
  decision: `verify_event_history_decision_${suffix}`,
  transitionSubmitted: `verify_event_history_transition_submitted_${suffix}`,
  transitionSelected: `verify_event_history_transition_selected_${suffix}`,
  participation: `verify_event_history_participation_${suffix}`,
  session: `verify_event_history_session_${suffix}`,
  legacySession: `verify_event_history_legacy_session_${suffix}`,
  attendanceAudit: `verify_event_history_attendance_audit_${suffix}`,
};

try {
  const now = new Date();
  const startsAt = new Date("2025-08-19T23:00:00.000Z");
  const sessionEndsAt = new Date("2025-08-20T00:00:00.000Z");
  const endsAt = new Date("2025-08-20T01:00:00.000Z");
  await database
    .insertInto("user")
    .values([
      {
        id: ids.actor,
        name: "Event history administrator",
        email: `event-history-admin-${suffix}@example.com`,
        emailVerified: true,
        image: null,
        stripeCustomerId: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: ids.learner,
        name: "Event history learner",
        email: `event-history-learner-${suffix}@example.com`,
        emailVerified: true,
        image: null,
        stripeCustomerId: null,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .execute();
  await database
    .insertInto("platform_admin")
    .values({
      userId: ids.actor,
      grantedByUserId: null,
      createdAt: now,
    })
    .execute();
  await database
    .insertInto("event_template")
    .values({
      id: ids.template,
      title: "Historical event template",
      status: "published",
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  await database
    .insertInto("event_template_version")
    .values({
      id: ids.version,
      eventTemplateId: ids.template,
      version: 3,
      summary: "Historical event evidence verification",
      description: "Historical event evidence verification",
      hasCompletionCertificate: true,
      accreditations: JSON.stringify([]),
      publishedAt: now,
      createdAt: now,
    })
    .execute();
  await database
    .insertInto("event_template_session_definition")
    .values([
      {
        id: ids.sessionDefinition,
        eventTemplateVersionId: ids.version,
        position: 0,
        title: "Verified session",
        durationMinutes: 60,
        presenterRequired: false,
        createdAt: now,
      },
      {
        id: ids.legacySessionDefinition,
        eventTemplateVersionId: ids.version,
        position: 1,
        title: "Legacy self-check-in session",
        durationMinutes: 60,
        presenterRequired: false,
        createdAt: now,
      },
    ])
    .execute();
  await database
    .insertInto("event_template_version_section")
    .values({
      id: ids.section,
      eventTemplateVersionId: ids.version,
      position: 0,
      title: "Live session",
      description: "Attendance-backed completion",
      phase: "session",
      releaseAnchor: "occurrence_start",
      releaseOffsetAmount: 0,
      releaseOffsetUnit: "minute",
      createdAt: now,
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
      title: "Verified session",
      required: true,
      durationMinutes: 60,
      learningActivityVersionId: null,
      sessionDefinitionId: ids.sessionDefinition,
      createdAt: now,
    })
    .execute();
  await database
    .insertInto("event_occurrence")
    .values({
      id: ids.occurrence,
      eventTemplateVersionId: ids.version,
      title: "Historical event occurrence",
      slug: `historical-event-${suffix}`,
      status: "completed",
      deliveryMode: "in_person",
      registrationMode: "required_unrestricted",
      approvalMode: "manual",
      timezone: "Australia/Sydney",
      localStartsAt: "2025-08-20T09:00:00",
      localEndsAt: "2025-08-20T11:00:00",
      localRegistrationOpensAt: null,
      localRegistrationClosesAt: null,
      localCoordinatorLockAt: null,
      startsAt,
      endsAt,
      registrationOpensAt: null,
      registrationClosesAt: null,
      coordinatorLockAt: null,
      capacity: 10,
      venueName: "Verification venue",
      venueAddress: "Sydney NSW",
      virtualJoinUrl: null,
      priceCents: null,
      salePriceCents: null,
      currency: "AUD",
      bulkPricing: JSON.stringify({ enabled: false, tiers: [] }),
      listInStore: false,
      featured: false,
      publishedAt: now,
      createdByUserId: ids.actor,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  await database
    .insertInto("coordination_region")
    .values({
      id: ids.region,
      parentId: null,
      code: "VERIFY-EVENT-HISTORY",
      name: "Historical region snapshot",
      kind: "operational",
      status: "active",
      createdAt: now,
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
    .insertInto("event_session")
    .values([
      {
        id: ids.session,
        eventOccurrenceId: ids.occurrence,
        sessionDefinitionId: ids.sessionDefinition,
        position: 0,
        title: "Verified session",
        localStartsAt: "2025-08-20T09:00:00",
        localEndsAt: "2025-08-20T10:00:00",
        startsAt,
        endsAt: sessionEndsAt,
        presenterRequired: false,
        venueName: "Verification venue",
        venueAddress: "Sydney NSW",
        virtualJoinUrl: null,
      },
      {
        id: ids.legacySession,
        eventOccurrenceId: ids.occurrence,
        sessionDefinitionId: ids.legacySessionDefinition,
        position: 1,
        title: "Legacy self-check-in session",
        localStartsAt: "2025-08-20T10:00:00",
        localEndsAt: "2025-08-20T11:00:00",
        startsAt: sessionEndsAt,
        endsAt,
        presenterRequired: false,
        venueName: "Verification venue",
        venueAddress: "Sydney NSW",
        virtualJoinUrl: null,
      },
    ])
    .execute();
  await database
    .insertInto("event_registration")
    .values({
      id: ids.registration,
      eventOccurrenceId: ids.occurrence,
      userId: ids.learner,
      eventOccurrenceRegionId: ids.occurrenceRegion,
      reviewRoundId: null,
      nameSnapshot: "Learner registration snapshot",
      emailSnapshot: `registration-snapshot-${suffix}@example.com`,
      source: "ordinary",
      eligibilitySource: "unrestricted",
      status: "selected",
      coordinatorPriority: null,
      submittedAt: startsAt,
      coordinatorDecidedAt: null,
      coordinatorDecidedByUserId: null,
      finalDecidedAt: now,
      finalDecidedByUserId: ids.actor,
      lockedInAt: now,
    })
    .execute();
  await database
    .insertInto("event_registration_transition")
    .values([
      {
        id: ids.transitionSubmitted,
        eventRegistrationId: ids.registration,
        fromStatus: null,
        toStatus: "submitted",
        fromEventOccurrenceRegionId: null,
        toEventOccurrenceRegionId: ids.occurrenceRegion,
        source: "learner",
        actorUserId: ids.learner,
        priority: null,
        occurredAt: startsAt,
      },
      {
        id: ids.transitionSelected,
        eventRegistrationId: ids.registration,
        fromStatus: "submitted",
        toStatus: "selected",
        fromEventOccurrenceRegionId: ids.occurrenceRegion,
        toEventOccurrenceRegionId: ids.occurrenceRegion,
        source: "administrator",
        actorUserId: ids.actor,
        priority: null,
        occurredAt: now,
      },
    ])
    .execute();
  await database
    .insertInto("event_registration_region_decision")
    .values({
      id: ids.decision,
      eventRegistrationId: ids.registration,
      registrationEventOccurrenceRegionId: ids.occurrenceRegion,
      resolution: "registered_region_confirmed",
      classification: "event_region",
      reportingRegionId: ids.region,
      reportingRegionCodeSnapshot: "VERIFY-EVENT-HISTORY",
      reportingRegionNameSnapshot: "Historical region snapshot",
      reportingRegionGroupCodeSnapshot: "VERIFY-GROUP",
      reportingRegionGroupNameSnapshot: "Historical group snapshot",
      decidedByUserId: ids.actor,
      decidedAt: now,
      supersededAt: null,
    })
    .execute();
  await database
    .insertInto("event_participation")
    .values({
      id: ids.participation,
      eventOccurrenceId: ids.occurrence,
      userId: ids.learner,
      registrationId: ids.registration,
      mode: "registered",
      nameSnapshot: "Learner participation snapshot",
      emailSnapshot: `participation-snapshot-${suffix}@example.com`,
      detailsSubmittedAt: now,
      joinDisclosedAt: now,
      checkedInAt: now,
      completedAt: now,
      createdAt: startsAt,
    })
    .execute();
  await database
    .insertInto("event_attendance")
    .values([
      {
        eventParticipationId: ids.participation,
        eventSessionId: ids.session,
        state: "attended",
        source: "administrator",
        recordedByUserId: ids.actor,
        recordedAt: now,
        updatedAt: now,
      },
      {
        eventParticipationId: ids.participation,
        eventSessionId: ids.legacySession,
        state: "checked_in",
        source: "self_check_in",
        recordedByUserId: null,
        recordedAt: now,
        updatedAt: now,
      },
    ])
    .execute();
  await database
    .insertInto("audit_event")
    .values({
      id: ids.attendanceAudit,
      actorUserId: ids.actor,
      action: "event_attendance.recorded",
      subjectType: "event_attendance",
      subjectId: `${ids.participation}:${ids.session}`,
      reason: null,
      metadata: { state: "attended", source: "administrator" },
      createdAt: now,
    })
    .execute();

  const events = await findAdminLearnerEvents(ids.learner);
  assert.equal(events.length, 1);
  const event = events[0];
  assert.ok(event);
  assert.equal(event.occurrence.eventTemplateVersion, 3);
  assert.ok(event.registration);
  assert.equal(
    event.registration.nameSnapshot,
    "Learner registration snapshot",
  );
  assert.ok(event.registration.reportingRegionSnapshot);
  assert.equal(
    event.registration.reportingRegionSnapshot.groupName,
    "Historical group snapshot",
  );
  assert.ok(event.participation);
  assert.equal(
    event.participation.nameSnapshot,
    "Learner participation snapshot",
  );
  assert.deepEqual(event.sessions, []);
  assert.equal(event.progress, null);
  assert.deepEqual(event.history, []);
  assert.deepEqual(event.certificate, { offered: true, eligible: true });
  const profile = await findAdminLearnerProfile(ids.learner);
  assert.ok(profile);
  assert.equal(profile.events[0]?.key, ids.registration);

  await database
    .updateTable("event_registration")
    .set({ status: "withdrawn", lockedInAt: null })
    .where("id", "=", ids.registration)
    .execute();
  const detail = await findAdminLearnerEventDetail(ids.learner, ids.occurrence);
  assert.ok(detail);
  assert.equal(
    detail.learner.email,
    `event-history-learner-${suffix}@example.com`,
  );
  assert.equal(detail.event.key, ids.registration);
  assert.equal(detail.event.registration?.status, "withdrawn");
  const session = detail.event.sessions.find((item) => item.id === ids.session);
  assert.ok(session);
  assert.equal(session.attendance.state, "attended");
  assert.equal(
    session.attendance.recordedByName,
    "Event history administrator",
  );
  assert.ok(detail.event.progress);
  assert.equal(detail.event.progress.state, "completed");
  const section = detail.event.progress.sections[0];
  assert.ok(section);
  assert.equal(section.state, "completed");
  assert.equal(
    detail.event.history.filter((item) => item.kind === "registration").length,
    2,
  );
  assert.equal(
    detail.event.history.some(
      (item) => item.kind === "attendance" && item.state === "attended",
    ),
    true,
  );
  assert.equal(
    detail.event.history.some((item) => item.kind === "region_decision"),
    true,
  );
  assert.equal(
    detail.event.history.some(
      (item) =>
        item.kind === "attendance" &&
        item.state === "checked_in" &&
        item.source === "self_check_in",
    ),
    true,
  );
  assert.equal(
    await findAdminLearnerEventDetail(ids.learner, "missing_occurrence"),
    null,
  );
} finally {
  await database
    .deleteFrom("event_attendance")
    .where("eventParticipationId", "=", ids.participation)
    .execute();
  await database
    .deleteFrom("event_participation")
    .where("id", "=", ids.participation)
    .execute();
  await database
    .deleteFrom("event_registration_region_decision")
    .where("id", "=", ids.decision)
    .execute();
  await database
    .deleteFrom("event_registration_transition")
    .where("eventRegistrationId", "=", ids.registration)
    .execute();
  await database
    .deleteFrom("event_registration")
    .where("id", "=", ids.registration)
    .execute();
  await database
    .deleteFrom("event_session")
    .where("eventOccurrenceId", "=", ids.occurrence)
    .execute();
  await database
    .deleteFrom("event_occurrence_region")
    .where("id", "=", ids.occurrenceRegion)
    .execute();
  await database
    .deleteFrom("coordination_region")
    .where("id", "=", ids.region)
    .execute();
  await database
    .deleteFrom("event_occurrence")
    .where("id", "=", ids.occurrence)
    .execute();
  await database
    .deleteFrom("event_template_version_item")
    .where("id", "=", ids.item)
    .execute();
  await database
    .deleteFrom("event_template_version_section")
    .where("id", "=", ids.section)
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
    .where("userId", "=", ids.actor)
    .execute();
  await database
    .deleteFrom("user")
    .where("id", "in", [ids.actor, ids.learner])
    .execute();
  await destroyDatabase();
}
