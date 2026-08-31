import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type { AdminSurveyDraft } from "#/features/survey/survey.schema";
import { ianaTimeZoneSchema } from "#/features/shared/time.schema";
import {
  createAdminEventOccurrence,
  createAdminEventTemplate,
  deleteAdminEventTemplateVersion,
  findAdminEventTemplate,
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
  acknowledgeAdminEventRegistrationRegionMismatch,
  addAdminEventRegistration,
  alignAdminEventRegistrationProfileRegion,
  confirmAdminEventRegistrationRegionGuest,
  decideAdminEventFinalRegistration,
  findAdminEventOccurrenceOperations,
  lockAdminEventRegion,
  recordAdminEventAttendance,
  reassignAdminEventRegistrationRegion,
  transitionAdminEventOccurrence,
} from "#/server/admin/admin-event-operations.server";
import {
  createAdminSurvey,
  publishAdminSurveyVersion,
  saveAdminSurveyDraft,
} from "#/server/admin/admin-survey.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { destroyDatabase, getDatabase } from "#/server/db/database.server";
import { getEventOperationsAccess } from "#/server/events/event-operations-access.server";
import { findEventOperationsWorkspace } from "#/server/events/event-operations.server";
import {
  findEventSurveyQrCatalogue,
  resolveLearnerEventSurveyReference,
} from "#/server/events/event-survey-access.server";
import {
  requestEventRecoveryCode,
  verifyEventRecoveryCode,
} from "#/server/events/event-prerequisite-recovery.server";
import {
  acceptEventLateRegistrationInvitation,
  createEventLateRegistrationInvitation,
  findEventLateRegistrationInvitation,
  revokeEventLateRegistrationInvitation,
} from "#/server/events/event-late-registration-invitation.server";
import {
  ensureEventGuestAccessRecord,
  findPublicEventGuestAccess,
  rotateEventGuestAccessRecord,
  submitPublicEventGuestAccess,
} from "#/server/events/event-guest-access.server";
import {
  registerLearnerForEvent,
  withdrawLearnerEventRegistration,
} from "#/server/learner/learner-event.server";
import { findLearnerEventsDashboard } from "#/server/learner/learner.server";
import { ensureEventSectionReleased } from "#/server/learning/event-section-release.server";
import { findLearnerEventWorkspace } from "#/server/learning/learner-event-workspace.server";
import {
  processNextEventOperationalCommunicationSchedule,
  refreshEventOperationalCommunicationSchedules,
} from "#/server/notifications/event-operational-communication.server";
import { deliverNotification } from "#/server/notifications/notification-delivery.server";
import {
  dateToInstant,
  instantToLocalDateTime,
} from "#/server/time/time.server";

const database = getDatabase();
const verificationTimezone = ianaTimeZoneSchema.parse("Australia/Sydney");
const localVerificationTime = (value: Date) =>
  instantToLocalDateTime(dateToInstant(value), verificationTimezone);
const minutePrecision = (value: Date) => {
  value.setSeconds(0, 0);
  return value;
};
const suffix = randomUUID();
const administratorPhone = "+61491570150";
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
const outsideCoordinationRegionId = `coordination_region_outside_${suffix}`;
let eventTemplateId: string | null = null;
let eventTemplateVersionId: string | null = null;
let eventOccurrenceId: string | null = null;
let coordinationRegionGroupId: string | null = null;
let eventSurveyId: string | null = null;
let eventSurveyVersionId: string;

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
    const invitationIds = await database
      .selectFrom("event_late_registration_invitation")
      .select("id")
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .execute();
    await database
      .deleteFrom("notification")
      .where(
        sql<boolean>`payload ->> 'eventOccurrenceId' = ${eventOccurrenceId}`,
      )
      .execute();
    for (const invitation of invitationIds)
      await database
        .deleteFrom("notification")
        .where(
          sql<boolean>`payload ->> 'eventLateRegistrationInvitationId' = ${invitation.id}`,
        )
        .execute();
    await database
      .deleteFrom("event_late_registration_invitation")
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
    if (registrationIds.length)
      await database
        .deleteFrom("event_registration_region_decision")
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
  if (eventSurveyId) {
    await database
      .deleteFrom("learning_activity_version")
      .where("activityId", "=", eventSurveyId)
      .execute();
    await database
      .deleteFrom("learning_activity")
      .where("id", "=", eventSurveyId)
      .execute();
  }
  const aggregateIds = [
    ...(eventTemplateId ? [eventTemplateId] : []),
    ...(eventOccurrenceId ? [eventOccurrenceId] : []),
    ...(eventSurveyId ? [eventSurveyId] : []),
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
    .updateTable("user")
    .set({ currentRegionId: null })
    .where("currentRegionId", "in", [
      coordinationRegionId,
      addedCoordinationRegionId,
      outsideCoordinationRegionId,
    ])
    .execute();
  await database
    .deleteFrom("coordination_region")
    .where("id", "in", [
      coordinationRegionId,
      addedCoordinationRegionId,
      outsideCoordinationRegionId,
    ])
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
      phone: administratorPhone,
      smsEnabled: true,
      smsVerifiedAt: new Date(),
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
      {
        id: outsideCoordinationRegionId,
        parentId: null,
        code: `VERIFY-OUTSIDE-${suffix}`.toLocaleUpperCase("en-AU"),
        name: "Outside verification region",
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
  assert.deepEqual(
    await saveAdminCoordinationRegion(
      {
        regionId: outsideCoordinationRegionId,
        name: "Outside verification region",
        code: `verify-outside-${suffix}`,
        kind: "operational",
        parentId: coordinationRegionGroupId,
      },
      administrator,
    ),
    { status: "updated", regionId: outsideCoordinationRegionId },
  );

  const coordinatorEligibility = await grantAdminEventStaffEligibility(
    {
      email: coordinator.email,
      responsibility: "coordinator",
      regionId: coordinationRegionId,
    },
    administrator,
  );
  assert.ok(coordinatorEligibility);
  assert.equal(coordinatorEligibility.status, "granted");
  const coordinatorEligibilityId = coordinatorEligibility.eligibilityId;
  async function setCoordinatorEligibilityRevoked(revoked: boolean) {
    await database
      .updateTable("event_staff_eligibility")
      .set({
        revokedAt: revoked ? new Date() : null,
        revokedByUserId: revoked ? administrator.id : null,
      })
      .where("id", "=", coordinatorEligibilityId)
      .executeTakeFirstOrThrow();
  }
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
  assert.deepEqual(
    await revokeAdminEventStaffEligibility(
      temporaryEligibility.eligibilityId,
      administrator,
    ),
    { status: "revoked", endedAssignmentCount: 0 },
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

  const createdSurvey = await createAdminSurvey(
    "Verification event survey",
    "event",
    administrator,
  );
  eventSurveyId = createdSurvey.surveyId;
  eventSurveyVersionId = createdSurvey.versionId;
  const eventSurveyDraft: AdminSurveyDraft = {
    surveyId: createdSurvey.surveyId,
    versionId: createdSurvey.versionId,
    title: "Verification event survey",
    description: "An exact-version Event Survey QR verification fixture.",
    sections: [
      {
        id: `survey_section_${suffix}`,
        title: "Event feedback",
        description: "Verify guarded Event Survey access.",
        items: [
          {
            id: `survey_question_${suffix}`,
            kind: "single_choice",
            prompt: "Was this Event useful?",
            required: true,
            options: [
              {
                id: `survey_yes_${suffix}`,
                label: "Yes",
                nextSectionId: `survey_detail_section_${suffix}`,
              },
              {
                id: `survey_no_${suffix}`,
                label: "No",
                nextSectionId: `survey_finish_section_${suffix}`,
              },
            ],
          },
        ],
      },
      {
        id: `survey_detail_section_${suffix}`,
        title: "Additional feedback",
        description: "Only shown on the yes path.",
        items: [
          {
            id: `survey_detail_${suffix}`,
            kind: "long_text",
            prompt: "What was useful?",
            required: true,
            maximumLength: 500,
          },
        ],
      },
      {
        id: `survey_finish_section_${suffix}`,
        title: "Finish",
        description: "The common destination.",
        items: [
          {
            id: `survey_finish_${suffix}`,
            kind: "instruction",
            title: "Ready to submit",
            body: "Continue to finish the event survey.",
          },
        ],
      },
    ],
  };
  assert.equal(
    await saveAdminSurveyDraft(eventSurveyDraft, administrator),
    "saved",
  );
  assert.equal(
    await publishAdminSurveyVersion(
      createdSurvey.surveyId,
      createdSurvey.versionId,
      administrator,
    ),
    "published",
  );

  const disposableTemplate = await createAdminEventTemplate(
    {
      title: "Disposable verification template",
      defaultAdministratorIds: [administrator.id],
    },
    administrator,
  );
  assert.equal(disposableTemplate.status, "created");
  assert.deepEqual(
    await deleteAdminEventTemplateVersion(
      disposableTemplate.eventTemplateId,
      disposableTemplate.eventTemplateVersionId,
      administrator,
    ),
    { status: "deleted", templateDeleted: true },
  );
  assert.equal(
    await database
      .selectFrom("audit_event")
      .select("action")
      .where("action", "=", "event_template.draft_deleted")
      .where("subjectId", "=", disposableTemplate.eventTemplateId)
      .executeTakeFirstOrThrow()
      .then((row) => row.action),
    "event_template.draft_deleted",
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
  const initialTemplate = await findAdminEventTemplate(
    eventTemplateId,
    eventTemplateVersionId,
  );
  assert.ok(initialTemplate);
  assert.deepEqual(
    initialTemplate.draft.accreditations,
    [],
    "A new Event Template must persist accreditations as a JSON array",
  );
  assert.equal(
    await saveAdminEventTemplateDraft(
      {
        eventTemplateId,
        eventTemplateVersionId,
        title: "Verification workshop",
        topic: "Clinical workshops",
        summary: "A versioned Event Template verification fixture.",
        description:
          "Verifies exact-version occurrence provenance and durable staff attribution.",
        coverImage: null,
        hasCompletionCertificate: true,
        accreditations: [],
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
            releaseOffsetAmount: 0,
            releaseOffsetUnit: "minute",
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
              {
                id: `event_survey_item_${suffix}`,
                kind: "survey",
                title: "Event feedback",
                required: false,
                durationMinutes: 5,
                learningActivityVersionId: createdSurvey.versionId,
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
    await database
      .insertInto("event_template_version_section")
      .values({
        id: `event_empty_section_${suffix}`,
        eventTemplateVersionId,
        position: 1,
        title: "Empty section",
        description: "Must block publication.",
        phase: "post_event",
        releaseAnchor: "occurrence_end",
        releaseOffsetAmount: 0,
        releaseOffsetUnit: "minute",
      })
      .execute()
      .then(() =>
        publishAdminEventTemplateVersion(
          createdTemplate.eventTemplateId,
          createdTemplate.eventTemplateVersionId,
          administrator,
        ),
      ),
    "conflict",
  );
  await database
    .deleteFrom("event_template_version_section")
    .where("id", "=", `event_empty_section_${suffix}`)
    .executeTakeFirstOrThrow();
  await setCoordinatorEligibilityRevoked(true);
  assert.equal(
    await publishAdminEventTemplateVersion(
      eventTemplateId,
      eventTemplateVersionId,
      administrator,
    ),
    "conflict",
  );
  await setCoordinatorEligibilityRevoked(false);
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

  const startsAt = minutePrecision(
    new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  );
  const endsAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);
  const registrationOpensAt = minutePrecision(new Date());
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
    localStartsAt: localVerificationTime(startsAt),
    localEndsAt: localVerificationTime(endsAt),
    localRegistrationOpensAt: localVerificationTime(registrationOpensAt),
    localRegistrationClosesAt: localVerificationTime(registrationClosesAt),
    localCoordinatorLockAt: localVerificationTime(coordinatorLockAt),
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    registrationOpensAt: registrationOpensAt.toISOString(),
    registrationClosesAt: registrationClosesAt.toISOString(),
    coordinatorLockAt: coordinatorLockAt.toISOString(),
    capacity: 2,
    priceCents: null,
    salePriceCents: null,
    currency: "AUD" as const,
    bulkPricing: { enabled: false, tiers: [] },
    listInStore: false,
    featured: false,
    venueName: "Verification Centre",
    venueAddress: "1 Test Street, Sydney NSW",
    virtualJoinUrl: "",
    domains: "example.com, health.example.org",
  };
  assert.deepEqual(
    await createAdminEventOccurrence(
      {
        ...occurrenceInput,
        slug: `verification-workshop-too-short-${suffix}`,
        localEndsAt: localVerificationTime(
          new Date(startsAt.getTime() + 60 * 60 * 1000),
        ),
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000).toISOString(),
      },
      administrator,
    ),
    {
      status: "conflict",
      reason: "occurrence-window-too-short",
      minimumDurationMinutes: 120,
    },
  );
  await setCoordinatorEligibilityRevoked(true);
  assert.deepEqual(
    await createAdminEventOccurrence(
      {
        ...occurrenceInput,
        slug: `verification-workshop-stale-coordinator-${suffix}`,
      },
      administrator,
    ),
    { status: "conflict" },
  );
  await setCoordinatorEligibilityRevoked(false);
  const createdOccurrence = await createAdminEventOccurrence(
    occurrenceInput,
    administrator,
  );
  assert.equal(createdOccurrence.status, "created");
  eventOccurrenceId = createdOccurrence.eventOccurrenceId;
  const eventSurveyAccess = await database
    .selectFrom("event_survey_access as access")
    .innerJoin(
      "event_template_version_item as item",
      "item.id",
      "access.eventTemplateVersionItemId",
    )
    .select([
      "access.id",
      "access.publicReference",
      "access.generation",
      "access.accessPolicy",
      "item.learningActivityVersionId",
    ])
    .where("access.eventOccurrenceId", "=", eventOccurrenceId)
    .executeTakeFirstOrThrow();
  assert.match(eventSurveyAccess.publicReference, /^[A-Za-z0-9_-]{32}$/u);
  assert.equal(eventSurveyAccess.generation, 1);
  assert.equal(eventSurveyAccess.accessPolicy, "authenticated_participant");
  assert.equal(
    eventSurveyAccess.learningActivityVersionId,
    eventSurveyVersionId,
  );
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
        localStartsAt: localVerificationTime(rescheduledStartsAt),
        localEndsAt: localVerificationTime(rescheduledEndsAt),
        localRegistrationOpensAt: localVerificationTime(registrationOpensAt),
        localRegistrationClosesAt: localVerificationTime(registrationClosesAt),
        localCoordinatorLockAt: localVerificationTime(coordinatorLockAt),
        startsAt: rescheduledStartsAt.toISOString(),
        endsAt: rescheduledEndsAt.toISOString(),
        registrationOpensAt: registrationOpensAt.toISOString(),
        registrationClosesAt: registrationClosesAt.toISOString(),
        coordinatorLockAt: coordinatorLockAt.toISOString(),
        capacity: 3,
        venueName: "Updated Verification Centre",
        venueAddress: "2 Test Street, Sydney NSW",
        virtualJoinUrl: "",
        priceCents: null,
        salePriceCents: null,
        currency: "AUD",
        bulkPricing: { enabled: false, tiers: [] },
        listInStore: false,
        featured: false,
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

  assert.deepEqual(
    await database
      .selectFrom("event_operational_communication_schedule")
      .select(["kind", "dueAt", "status"])
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .orderBy("kind")
      .execute()
      .then((rows) =>
        rows.map((row) => ({
          ...row,
          dueAt: row.dueAt.toISOString(),
        })),
      ),
    [
      {
        kind: "regional_lock_due",
        dueAt: coordinatorLockAt.toISOString(),
        status: "pending",
      },
      {
        kind: "regional_review_due",
        dueAt: registrationClosesAt.toISOString(),
        status: "pending",
      },
    ],
  );
  const operationalEventOccurrenceId = eventOccurrenceId;
  assert.ok(operationalEventOccurrenceId);
  await database.transaction().execute(async (transaction) => {
    await transaction
      .updateTable("event_occurrence")
      .set({ approvalMode: "automatic" })
      .where("id", "=", operationalEventOccurrenceId)
      .executeTakeFirstOrThrow();
    await refreshEventOperationalCommunicationSchedules(
      transaction,
      operationalEventOccurrenceId,
      new Date(),
    );
  });
  assert.equal(
    await database
      .selectFrom("event_operational_communication_schedule")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("eventOccurrenceId", "=", operationalEventOccurrenceId)
      .where("status", "in", ["pending", "processing"])
      .executeTakeFirstOrThrow()
      .then((row) => row.count),
    0,
  );
  await database.transaction().execute(async (transaction) => {
    await transaction
      .updateTable("event_occurrence")
      .set({ approvalMode: "manual" })
      .where("id", "=", operationalEventOccurrenceId)
      .executeTakeFirstOrThrow();
    await refreshEventOperationalCommunicationSchedules(
      transaction,
      operationalEventOccurrenceId,
      new Date(),
    );
  });
  assert.equal(
    await database
      .selectFrom("event_operational_communication_schedule")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("eventOccurrenceId", "=", operationalEventOccurrenceId)
      .where("status", "in", ["pending", "processing"])
      .executeTakeFirstOrThrow()
      .then((row) => row.count),
    2,
  );
  const initialReviewRound = await database
    .selectFrom("event_region_review_round")
    .select("id")
    .where("eventOccurrenceRegionId", "=", occurrenceRegion.id)
    .where("round", "=", 1)
    .executeTakeFirstOrThrow();
  const lockedAt = new Date();
  await database
    .updateTable("event_region_review_round")
    .set({
      lockedAt,
      lockedByUserId: administrator.id,
      lockSource: "administrator",
    })
    .where("id", "=", initialReviewRound.id)
    .executeTakeFirstOrThrow();
  const finalStartsAt = new Date(
    rescheduledStartsAt.getTime() + 24 * 60 * 60 * 1000,
  );
  const finalEndsAt = new Date(
    rescheduledEndsAt.getTime() + 24 * 60 * 60 * 1000,
  );
  const reopenedAt = minutePrecision(new Date(Date.now() - 60 * 60 * 1000));
  const reopenedClosesAt = minutePrecision(
    new Date(Date.now() + 72 * 60 * 60 * 1000),
  );
  const reopenedLockAt = minutePrecision(
    new Date(Date.now() + 96 * 60 * 60 * 1000),
  );
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
          localStartsAt: localVerificationTime(finalStartsAt),
          localEndsAt: localVerificationTime(finalEndsAt),
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
          localStartsAt: localVerificationTime(finalStartsAt),
          localEndsAt: localVerificationTime(finalEndsAt),
          registrationOpensAt: reopenedAt.toISOString(),
          registrationClosesAt: reopenedClosesAt.toISOString(),
          coordinatorLockAt: reopenedLockAt.toISOString(),
          localRegistrationOpensAt: localVerificationTime(reopenedAt),
          localRegistrationClosesAt: localVerificationTime(reopenedClosesAt),
          localCoordinatorLockAt: localVerificationTime(reopenedLockAt),
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
  const regionalListLockedNotification = await database
    .selectFrom("notification")
    .select("id")
    .where("recipientUserId", "=", administrator.id)
    .where(
      "payload",
      "@>",
      JSON.stringify({
        trigger: "regional_list_locked",
        eventOccurrenceId,
      }),
    )
    .executeTakeFirstOrThrow();
  await database
    .updateTable("event_occurrence")
    .set({ approvalMode: "automatic" })
    .where("id", "=", eventOccurrenceId)
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    await deliverNotification(regionalListLockedNotification.id),
    { status: "superseded" },
  );
  await database
    .updateTable("event_occurrence")
    .set({ approvalMode: "manual" })
    .where("id", "=", eventOccurrenceId)
    .executeTakeFirstOrThrow();
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
        name: learner.name,
        email: learner.email,
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
  const regionGuestEmail = `event-region-guest-${suffix}@outside.example.net`;
  assert.equal(
    await addAdminEventRegistration(
      {
        eventOccurrenceId,
        name: "Region Guest Event Learner",
        email: regionGuestEmail,
        eventOccurrenceRegionId: addedOccurrenceRegion.id,
        overrideDomainRestriction: true,
      },
      administrator,
    ),
    "created",
  );
  const regionGuestUser = await database
    .selectFrom("user")
    .select(["id", "currentRegionId"])
    .where("email", "=", regionGuestEmail)
    .executeTakeFirstOrThrow();
  assert.equal(regionGuestUser.currentRegionId, null);
  const regionGuestRegistration = await database
    .selectFrom("event_registration")
    .select("id")
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .where("userId", "=", regionGuestUser.id)
    .executeTakeFirstOrThrow();
  const addedRegionReviewRound = await database
    .selectFrom("event_region_review_round")
    .select("id")
    .where("eventOccurrenceRegionId", "=", addedOccurrenceRegion.id)
    .orderBy("round", "desc")
    .executeTakeFirstOrThrow();
  await database
    .updateTable("event_registration")
    .set({ reviewRoundId: addedRegionReviewRound.id })
    .where("id", "=", regionGuestRegistration.id)
    .executeTakeFirstOrThrow();
  const regionalReviewOutcome =
    await processNextEventOperationalCommunicationSchedule(reopenedClosesAt);
  assert.equal(regionalReviewOutcome.status, "completed");
  assert.equal(regionalReviewOutcome.recipientCount, 1);
  const regionalReviewNotification = await database
    .selectFrom("notification")
    .select(["id", "payload"])
    .where("recipientUserId", "=", administrator.id)
    .where("payload", "@>", JSON.stringify({ trigger: "regional_review_due" }))
    .executeTakeFirstOrThrow();
  assert.equal(
    (
      regionalReviewNotification.payload as {
        variables: Record<string, string>;
      }
    ).variables["event.operationsUrl"],
    `http://localhost:3000/event-operations/${eventOccurrenceId}`,
  );
  await database
    .updateTable("event_occurrence")
    .set({ approvalMode: "automatic" })
    .where("id", "=", eventOccurrenceId)
    .executeTakeFirstOrThrow();
  assert.deepEqual(await deliverNotification(regionalReviewNotification.id), {
    status: "superseded",
  });
  await database
    .updateTable("event_occurrence")
    .set({ approvalMode: "manual" })
    .where("id", "=", eventOccurrenceId)
    .executeTakeFirstOrThrow();
  assert.equal(
    await alignAdminEventRegistrationProfileRegion(
      eventOccurrenceId,
      regionGuestRegistration.id,
      administrator,
    ),
    "updated",
  );
  assert.equal(
    await database
      .selectFrom("user")
      .select("currentRegionId")
      .where("id", "=", regionGuestUser.id)
      .executeTakeFirstOrThrow()
      .then((row) => row.currentRegionId),
    addedCoordinationRegionId,
  );
  await database
    .updateTable("user")
    .set({ currentRegionId: null })
    .where("id", "=", regionGuestUser.id)
    .execute();
  assert.equal(
    await confirmAdminEventRegistrationRegionGuest(
      eventOccurrenceId,
      regionGuestRegistration.id,
      administrator,
    ),
    "updated",
  );
  const regionGuestResolution = (
    await findAdminEventOccurrenceOperations(eventOccurrenceId)
  )?.registrations.find(
    (registration) => registration.id === regionGuestRegistration.id,
  );
  assert.ok(regionGuestResolution);
  assert.equal(regionGuestResolution.regionId, addedOccurrenceRegion.id);
  assert.equal(regionGuestResolution.profileRegionId, null);
  assert.equal(regionGuestResolution.regionMismatch, true);
  assert.equal(regionGuestResolution.regionMismatchAcknowledged, true);
  assert.equal(regionGuestResolution.regionalReviewWaivedAt, null);
  assert.equal(
    regionGuestResolution.regionDecision?.classification,
    "no_region_guest",
  );
  await database
    .updateTable("user")
    .set({ currentRegionId: outsideCoordinationRegionId })
    .where("id", "=", regionGuestUser.id)
    .execute();
  assert.equal(
    await confirmAdminEventRegistrationRegionGuest(
      eventOccurrenceId,
      regionGuestRegistration.id,
      administrator,
    ),
    "updated",
  );
  const outsideRegionGuestResolution = (
    await findAdminEventOccurrenceOperations(eventOccurrenceId)
  )?.registrations.find(
    (registration) => registration.id === regionGuestRegistration.id,
  );
  assert.equal(
    outsideRegionGuestResolution?.regionDecision?.classification,
    "outside_event_region",
  );
  assert.equal(
    outsideRegionGuestResolution.regionDecision.reportingRegionNameSnapshot,
    "Outside verification region",
  );
  assert.equal(
    outsideRegionGuestResolution.regionDecision
      .reportingRegionGroupNameSnapshot,
    "Verification jurisdiction",
  );
  const retainedRegionDecisions = await database
    .selectFrom("event_registration_region_decision")
    .select(["classification", "supersededAt"])
    .where("eventRegistrationId", "=", regionGuestRegistration.id)
    .orderBy("decidedAt", "asc")
    .execute();
  assert.equal(retainedRegionDecisions.length, 3);
  const [profileAlignment, noRegionGuest, outsideRegionGuest] =
    retainedRegionDecisions;
  assert.ok(profileAlignment && noRegionGuest && outsideRegionGuest);
  assert.equal(profileAlignment.supersededAt !== null, true);
  assert.equal(noRegionGuest.classification, "no_region_guest");
  assert.equal(noRegionGuest.supersededAt !== null, true);
  assert.equal(outsideRegionGuest.classification, "outside_event_region");
  assert.equal(outsideRegionGuest.supersededAt, null);
  assert.equal(
    await database
      .selectFrom("audit_event")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("action", "=", "user.region_updated")
      .where("subjectId", "=", regionGuestUser.id)
      .executeTakeFirstOrThrow()
      .then((row) => row.count),
    1,
  );
  const provisionalEmail = `event-provisional-${suffix}@outside.example.net`;
  assert.equal(
    await addAdminEventRegistration(
      {
        eventOccurrenceId,
        name: "Provisional Event Learner",
        email: provisionalEmail,
        eventOccurrenceRegionId: null,
        overrideDomainRestriction: true,
      },
      administrator,
    ),
    "created",
  );
  const provisionalEventUser = await database
    .selectFrom("user")
    .select(["id", "accountState", "emailVerified"])
    .where("email", "=", provisionalEmail)
    .executeTakeFirstOrThrow();
  assert.equal(provisionalEventUser.accountState, "provisional");
  assert.equal(provisionalEventUser.emailVerified, false);
  await database
    .updateTable("user")
    .set({ currentRegionId: addedCoordinationRegionId })
    .where("id", "=", provisionalEventUser.id)
    .execute();
  const provisionalRegistration = await database
    .selectFrom("event_registration")
    .select("id")
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .where("userId", "=", provisionalEventUser.id)
    .executeTakeFirstOrThrow();
  const mismatchBeforeReassignment = (
    await findAdminEventOccurrenceOperations(eventOccurrenceId)
  )?.registrations.find(
    (registration) => registration.id === provisionalRegistration.id,
  );
  assert.equal(mismatchBeforeReassignment?.regionMismatch, true);
  assert.equal(
    mismatchBeforeReassignment.profileRegionName,
    "Added verification region",
  );
  assert.equal(
    await acknowledgeAdminEventRegistrationRegionMismatch(
      eventOccurrenceId,
      provisionalRegistration.id,
      administrator,
    ),
    "updated",
  );
  assert.equal(
    (
      await findAdminEventOccurrenceOperations(eventOccurrenceId)
    )?.registrations.find(
      (registration) => registration.id === provisionalRegistration.id,
    )?.regionMismatchAcknowledged,
    true,
  );
  assert.equal(
    await database
      .selectFrom("audit_event")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("action", "=", "event_registration.region_mismatch_acknowledged")
      .where("subjectId", "=", provisionalRegistration.id)
      .executeTakeFirstOrThrow()
      .then((row) => row.count),
    1,
  );
  assert.equal(
    await reassignAdminEventRegistrationRegion(
      {
        eventOccurrenceId,
        registrationId: provisionalRegistration.id,
        eventOccurrenceRegionId: addedOccurrenceRegion.id,
        confirmFinalizedReassignment: false,
        confirmLockedDestinationReassignment: false,
      },
      administrator,
    ),
    "updated",
  );
  const profileRegionReassignment = (
    await findAdminEventOccurrenceOperations(eventOccurrenceId)
  )?.registrations.find(
    (registration) => registration.id === provisionalRegistration.id,
  );
  assert.equal(profileRegionReassignment?.regionMismatch, false);
  assert.equal(profileRegionReassignment.regionMismatchAcknowledged, true);
  assert.equal(
    await reassignAdminEventRegistrationRegion(
      {
        eventOccurrenceId,
        registrationId: provisionalRegistration.id,
        eventOccurrenceRegionId: occurrenceRegion.id,
        confirmFinalizedReassignment: false,
        confirmLockedDestinationReassignment: false,
      },
      administrator,
    ),
    "locked-destination-confirmation-required",
  );
  assert.equal(
    await reassignAdminEventRegistrationRegion(
      {
        eventOccurrenceId,
        registrationId: provisionalRegistration.id,
        eventOccurrenceRegionId: occurrenceRegion.id,
        confirmFinalizedReassignment: false,
        confirmLockedDestinationReassignment: true,
      },
      administrator,
    ),
    "updated",
  );
  const waivedReviewRegistration = (
    await findAdminEventOccurrenceOperations(eventOccurrenceId)
  )?.registrations.find(
    (registration) => registration.id === provisionalRegistration.id,
  );
  assert.equal(waivedReviewRegistration?.status, "submitted");
  assert.equal(waivedReviewRegistration.reviewRoundId, null);
  assert.ok(waivedReviewRegistration.regionalReviewWaivedAt);
  const mismatchCoordinatorAccess = await getEventOperationsAccess(
    coordinator,
    eventOccurrenceId,
  );
  assert.ok(mismatchCoordinatorAccess);
  const mismatchCoordinatorWorkspace = await findEventOperationsWorkspace(
    eventOccurrenceId,
    mismatchCoordinatorAccess,
  );
  const coordinatorMismatch = mismatchCoordinatorWorkspace?.registrations.find(
    (registration) => registration.id === provisionalRegistration.id,
  );
  assert.equal(coordinatorMismatch?.regionMismatch, true);
  assert.equal(
    coordinatorMismatch.profileRegionName,
    "Added verification region",
  );
  assert.equal(coordinatorMismatch.regionMismatchAcknowledged, false);
  assert.ok(coordinatorMismatch.regionalReviewWaivedAt);
  assert.equal(
    await reassignAdminEventRegistrationRegion(
      {
        eventOccurrenceId,
        registrationId: provisionalRegistration.id,
        eventOccurrenceRegionId: addedOccurrenceRegion.id,
        confirmFinalizedReassignment: false,
        confirmLockedDestinationReassignment: false,
      },
      administrator,
    ),
    "updated",
  );
  await database
    .updateTable("event_registration")
    .set({
      status: "waitlisted",
      finalDecidedAt: new Date(),
      finalDecidedByUserId: administrator.id,
    })
    .where("id", "=", provisionalRegistration.id)
    .execute();
  assert.equal(
    await reassignAdminEventRegistrationRegion(
      {
        eventOccurrenceId,
        registrationId: provisionalRegistration.id,
        eventOccurrenceRegionId: occurrenceRegion.id,
        confirmFinalizedReassignment: false,
        confirmLockedDestinationReassignment: false,
      },
      administrator,
    ),
    "finalized-confirmation-required",
  );
  assert.equal(
    await reassignAdminEventRegistrationRegion(
      {
        eventOccurrenceId,
        registrationId: provisionalRegistration.id,
        eventOccurrenceRegionId: occurrenceRegion.id,
        confirmFinalizedReassignment: true,
        confirmLockedDestinationReassignment: false,
      },
      administrator,
    ),
    "updated",
  );
  assert.deepEqual(
    await database
      .selectFrom("event_registration_transition")
      .select(["fromEventOccurrenceRegionId", "toEventOccurrenceRegionId"])
      .where("eventRegistrationId", "=", provisionalRegistration.id)
      .where("toEventOccurrenceRegionId", "is not", null)
      .orderBy("occurredAt")
      .execute(),
    [
      {
        fromEventOccurrenceRegionId: null,
        toEventOccurrenceRegionId: addedOccurrenceRegion.id,
      },
      {
        fromEventOccurrenceRegionId: addedOccurrenceRegion.id,
        toEventOccurrenceRegionId: occurrenceRegion.id,
      },
      {
        fromEventOccurrenceRegionId: occurrenceRegion.id,
        toEventOccurrenceRegionId: addedOccurrenceRegion.id,
      },
      {
        fromEventOccurrenceRegionId: addedOccurrenceRegion.id,
        toEventOccurrenceRegionId: occurrenceRegion.id,
      },
    ],
  );
  assert.equal(
    await database
      .selectFrom("notification")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("recipientUserId", "=", provisionalEventUser.id)
      .executeTakeFirstOrThrow()
      .then((row) => row.count),
    1,
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
    await decideAdminEventFinalRegistration(
      eventOccurrenceId,
      learnerRegistration.id,
      "waitlisted",
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
    "unchanged",
    "Repeating a final decision must not create another transition or outcome message",
  );
  const learnerParticipationId = await database
    .selectFrom("event_participation")
    .select("id")
    .where("registrationId", "=", learnerRegistration.id)
    .executeTakeFirstOrThrow()
    .then((row) => row.id);
  assert.equal(
    await recordAdminEventAttendance(
      {
        eventOccurrenceId,
        eventParticipationId: learnerParticipationId,
        eventSessionId: session.id,
        state: "attended",
      },
      administrator,
    ),
    "not-found",
  );
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
  assert.deepEqual(
    await findLearnerEventWorkspace(eventOccurrenceId, learner),
    { status: "not-found" },
  );
  assert.equal(
    await database
      .selectFrom("event_registration_transition")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("eventRegistrationId", "=", learnerRegistration.id)
      .executeTakeFirstOrThrow()
      .then((row) => row.count),
    5,
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
  assert.equal(coordinatorWorkspace.access.canViewSurveyQrCatalogue, true);
  assert.deepEqual(
    coordinatorWorkspace.surveyQrCatalogue.map((entry) => ({
      id: entry.id,
      reference: entry.publicReference,
      status: entry.status,
    })),
    [
      {
        id: eventSurveyAccess.id,
        reference: eventSurveyAccess.publicReference,
        status: "active",
      },
    ],
  );
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
  assert.equal(presenterWorkspace.access.canViewSurveyQrCatalogue, true);
  assert.equal(presenterWorkspace.surveyQrCatalogue.length, 1);
  assert.deepEqual(
    await findEventSurveyQrCatalogue(eventOccurrenceId, presenterAccess),
    presenterWorkspace.surveyQrCatalogue,
  );
  assert.deepEqual(presenterWorkspace.registrations, []);
  assert.deepEqual(
    presenterWorkspace.sessions.map((assignedSession) => assignedSession.id),
    [session.id],
  );
  const guestEventOccurrenceId = eventOccurrenceId;
  assert.ok(guestEventOccurrenceId);
  await database
    .updateTable("event_occurrence")
    .set({ registrationMode: "open_entry", approvalMode: "automatic" })
    .where("id", "=", guestEventOccurrenceId)
    .execute();
  const guestAccess = await database
    .transaction()
    .execute((transaction) =>
      ensureEventGuestAccessRecord(
        transaction,
        guestEventOccurrenceId,
        new Date(),
      ),
    );
  assert.match(guestAccess.publicReference, /^[A-Za-z0-9_-]{32}$/u);
  assert.equal(
    (await findPublicEventGuestAccess(guestAccess.publicReference)).status,
    "ready",
  );
  const guestSubmission = await submitPublicEventGuestAccess(
    {
      publicReference: guestAccess.publicReference,
      name: coordinator.name,
      email: coordinator.email,
    },
    `verification:${suffix}`,
  );
  assert.equal(guestSubmission.status, "ready");
  assert.equal(guestSubmission.data.attendanceState, "not_recorded");
  assert.equal(guestSubmission.data.accountSetupRequested, false);
  assert.equal(
    await database
      .selectFrom("event_participation")
      .select("mode")
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .where("userId", "=", coordinator.id)
      .executeTakeFirstOrThrow()
      .then((row) => row.mode),
    "open_entry",
  );
  assert.equal(
    (await findLearnerEventsDashboard(coordinator)).events.find(
      (event) => event.eventOccurrenceId === eventOccurrenceId,
    )?.participationMode,
    "open_entry",
  );
  const replacementGuestReference = await rotateEventGuestAccessRecord(
    eventOccurrenceId,
    administrator,
  );
  assert.ok(replacementGuestReference);
  assert.deepEqual(
    await findPublicEventGuestAccess(guestAccess.publicReference),
    { status: "not-found" },
  );
  await database
    .deleteFrom("event_participation")
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .where("userId", "=", coordinator.id)
    .execute();
  await database
    .deleteFrom("event_guest_access")
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .execute();
  await database
    .updateTable("event_occurrence")
    .set({ registrationMode: "required_restricted", approvalMode: "manual" })
    .where("id", "=", eventOccurrenceId)
    .execute();
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
  assert.equal(
    await decideAdminEventFinalRegistration(
      eventOccurrenceId,
      registrationId,
      "waitlisted",
      administrator,
    ),
    "final-decision-locked",
  );
  assert.equal(
    (
      await findAdminEventOccurrenceOperations(eventOccurrenceId)
    )?.registrations.find((registration) => registration.id === registrationId)
      ?.finalDecisionLocked,
    true,
  );
  assert.deepEqual(
    await resolveLearnerEventSurveyReference(
      eventSurveyAccess.publicReference,
      coordinator,
    ),
    { status: "not-found" },
  );
  assert.deepEqual(
    await resolveLearnerEventSurveyReference(
      eventSurveyAccess.publicReference,
      administrator,
    ),
    { status: "unavailable" },
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
  assert.deepEqual(
    await resolveLearnerEventSurveyReference(
      eventSurveyAccess.publicReference,
      administrator,
    ),
    {
      status: "ready",
      eventOccurrenceId,
      eventTemplateVersionItemId: `event_survey_item_${suffix}`,
    },
  );
  const recoveryRequest = await requestEventRecoveryCode(
    {
      publicReference: eventSurveyAccess.publicReference,
      identifier: administrator.email,
    },
    "f".repeat(43),
  );
  assert.equal(recoveryRequest.status, "accepted");
  const recoveryChallenge = await database
    .selectFrom("event_prerequisite_recovery_challenge as challenge")
    .innerJoin(
      "event_prerequisite_email_capture as capture",
      "capture.challengeId",
      "challenge.id",
    )
    .select([
      "challenge.id",
      "challenge.codeDigest",
      "challenge.identifierDigest",
      "capture.textBody",
    ])
    .where("challenge.reference", "=", recoveryRequest.challengeReference)
    .executeTakeFirstOrThrow();
  assert.match(recoveryChallenge.codeDigest, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(recoveryChallenge.identifierDigest, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(recoveryChallenge.textBody.includes(administrator.email), false);
  const recoveryCode = recoveryChallenge.textBody.match(/\b\d{6}\b/u)?.[0];
  assert.ok(recoveryCode);
  assert.deepEqual(
    await verifyEventRecoveryCode({
      publicReference: eventSurveyAccess.publicReference,
      challengeReference: recoveryRequest.challengeReference,
      code: "000000" === recoveryCode ? "999999" : "000000",
    }),
    { status: "invalid" },
  );
  const recoveryVerification = await verifyEventRecoveryCode({
    publicReference: eventSurveyAccess.publicReference,
    challengeReference: recoveryRequest.challengeReference,
    code: recoveryCode,
  });
  assert.equal(recoveryVerification.status, "ready");
  assert.match(
    recoveryVerification.taskSessionToken ?? "",
    /^[A-Za-z0-9_-]{43}$/u,
  );
  const taskSession = await database
    .selectFrom("event_prerequisite_task_session")
    .select([
      "id",
      "eventSurveyAccessId",
      "eventParticipationId",
      "userId",
      "tokenDigest",
      "completedAt",
      "revokedAt",
    ])
    .where("challengeId", "=", recoveryChallenge.id)
    .executeTakeFirstOrThrow();
  assert.deepEqual(taskSession, {
    id: taskSession.id,
    eventSurveyAccessId: eventSurveyAccess.id,
    eventParticipationId: participationId,
    userId: administrator.id,
    tokenDigest: taskSession.tokenDigest,
    completedAt: null,
    revokedAt: null,
  });
  assert.match(taskSession.tokenDigest, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(
    await database
      .selectFrom("audit_event")
      .select("action")
      .where("action", "=", "event_prerequisite.recovery_verified")
      .where("subjectId", "=", taskSession.id)
      .executeTakeFirst()
      .then((row) => row?.action),
    "event_prerequisite.recovery_verified",
  );
  const smsRecoveryRequest = await requestEventRecoveryCode(
    {
      publicReference: eventSurveyAccess.publicReference,
      identifier: administratorPhone,
    },
    "s".repeat(43),
  );
  assert.equal(smsRecoveryRequest.status, "accepted");
  const smsRecoveryChallenge = await database
    .selectFrom("event_prerequisite_recovery_challenge as challenge")
    .innerJoin(
      "event_prerequisite_sms_capture as capture",
      "capture.challengeId",
      "challenge.id",
    )
    .select([
      "challenge.reference",
      "challenge.deliveryChannel",
      "capture.recipientPhone",
      "capture.message",
    ])
    .where("challenge.reference", "=", smsRecoveryRequest.challengeReference)
    .executeTakeFirstOrThrow();
  assert.equal(smsRecoveryChallenge.deliveryChannel, "sms");
  assert.equal(smsRecoveryChallenge.recipientPhone, administratorPhone);
  const smsRecoveryCode = smsRecoveryChallenge.message.match(/\b\d{6}\b/u)?.[0];
  assert.ok(smsRecoveryCode);
  assert.equal(
    (
      await verifyEventRecoveryCode({
        publicReference: eventSurveyAccess.publicReference,
        challengeReference: smsRecoveryChallenge.reference,
        code: smsRecoveryCode,
      })
    ).status,
    "ready",
  );
  const { advanceLearnerEventSurvey, findLearnerEventSurvey } =
    await import("#/server/learning/learner-event-survey.server");
  const eventSurvey = await findLearnerEventSurvey(
    eventOccurrenceId,
    `event_survey_item_${suffix}`,
    administrator,
  );
  assert.notEqual(eventSurvey, null);
  assert.notEqual(eventSurvey, "unavailable");
  if (!eventSurvey || eventSurvey === "unavailable")
    throw new Error("Expected released learner event survey");
  const eventSurveyBranch = await advanceLearnerEventSurvey(
    {
      eventParticipationId: participationId,
      eventTemplateVersionItemId: `event_survey_item_${suffix}`,
      itemId: `survey_question_${suffix}`,
      answer: `survey_no_${suffix}`,
    },
    administrator,
  );
  assert.equal(eventSurveyBranch.status, "advanced");
  assert.equal(
    eventSurveyBranch.progress.currentItemId,
    `survey_finish_${suffix}`,
  );
  assert.equal(eventSurveyBranch.progress.totalItems, 2);
  const hiddenEventSurveyItem = await advanceLearnerEventSurvey(
    {
      eventParticipationId: participationId,
      eventTemplateVersionItemId: `event_survey_item_${suffix}`,
      itemId: `survey_detail_${suffix}`,
      answer: "This answer must not be accepted.",
    },
    administrator,
  );
  assert.equal(hiddenEventSurveyItem.status, "invalid");
  const eventSurveySubmitted = await advanceLearnerEventSurvey(
    {
      eventParticipationId: participationId,
      eventTemplateVersionItemId: `event_survey_item_${suffix}`,
      itemId: `survey_finish_${suffix}`,
    },
    administrator,
  );
  assert.equal(eventSurveySubmitted.status, "submitted");
  assert.equal(eventSurveySubmitted.progress.percent, 100);
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
  assert.equal(
    await database
      .selectFrom("audit_event")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("action", "=", "event_participation.completed")
      .where("subjectId", "=", participationId)
      .executeTakeFirstOrThrow()
      .then((row) => row.count),
    1,
  );
  assert.equal(
    await recordAdminEventAttendance(
      {
        eventOccurrenceId,
        eventParticipationId: participationId,
        eventSessionId: session.id,
        state: "absent",
      },
      administrator,
    ),
    "recorded",
  );
  assert.equal(
    await database
      .selectFrom("event_participation")
      .select("completedAt")
      .where("id", "=", participationId)
      .executeTakeFirstOrThrow()
      .then((row) => row.completedAt),
    null,
  );
  assert.equal(
    await database
      .selectFrom("audit_event")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("action", "=", "event_participation.completion_revoked")
      .where("subjectId", "=", participationId)
      .executeTakeFirstOrThrow()
      .then((row) => row.count),
    1,
  );
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
      .selectFrom("audit_event")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("action", "=", "event_participation.completed")
      .where("subjectId", "=", participationId)
      .executeTakeFirstOrThrow()
      .then((row) => row.count),
    2,
  );
  const administratorProgressAccess = await getEventOperationsAccess(
    administrator,
    eventOccurrenceId,
  );
  assert.ok(administratorProgressAccess);
  const administratorProgressWorkspace = await findEventOperationsWorkspace(
    eventOccurrenceId,
    administratorProgressAccess,
  );
  assert.ok(administratorProgressWorkspace);
  assert.equal(administratorProgressWorkspace.access.canViewProgress, true);
  assert.deepEqual(
    administratorProgressWorkspace.participantProgress.map((participant) => ({
      id: participant.eventParticipationId,
      state: participant.state,
      regionId: participant.regionId,
      sections: participant.sections.map((section) => section.state),
    })),
    [
      {
        id: participationId,
        state: "completed",
        regionId: occurrenceRegion.id,
        sections: ["completed"],
      },
    ],
  );
  const scopedCoordinatorWorkspace = await findEventOperationsWorkspace(
    eventOccurrenceId,
    coordinatorAccess,
  );
  assert.ok(scopedCoordinatorWorkspace);
  assert.deepEqual(
    scopedCoordinatorWorkspace.participantProgress.map(
      (participant) => participant.eventParticipationId,
    ),
    [participationId],
  );
  const attendanceOnlyPresenterWorkspace = await findEventOperationsWorkspace(
    eventOccurrenceId,
    presenterAccess,
  );
  assert.ok(attendanceOnlyPresenterWorkspace);
  assert.equal(attendanceOnlyPresenterWorkspace.access.canViewProgress, false);
  assert.deepEqual(attendanceOnlyPresenterWorkspace.participantProgress, []);
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
  await database
    .deleteFrom("event_section_release")
    .where("eventParticipationId", "=", participationId)
    .where("eventTemplateVersionSectionId", "=", templateSection.id)
    .execute();
  await database
    .updateTable("event_template_version_section")
    .set({ releaseAnchor: "final_session_end" })
    .where("id", "=", templateSection.id)
    .executeTakeFirstOrThrow();
  const elapsedReference = Date.now();
  const elapsedStart = new Date(elapsedReference - 2 * 60 * 60 * 1000);
  const elapsedEnd = new Date(elapsedStart.getTime() + 60 * 60 * 1000 + 1);
  const ongoingOccurrenceEnd = new Date(elapsedReference + 60 * 60 * 1000);
  await database
    .updateTable("event_occurrence")
    .set({ startsAt: elapsedStart, endsAt: ongoingOccurrenceEnd })
    .where("id", "=", eventOccurrenceId)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("event_session")
    .set({ startsAt: elapsedStart, endsAt: elapsedEnd })
    .where("id", "=", session.id)
    .executeTakeFirstOrThrow();
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
          localStartsAt: localVerificationTime(coverageRevisionStartsAt),
          localEndsAt: localVerificationTime(coverageRevisionEndsAt),
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
  assert.ok(
    await database
      .selectFrom("event_section_release")
      .select("releasedAt")
      .where("eventParticipationId", "=", participationId)
      .where("eventTemplateVersionSectionId", "=", templateSection.id)
      .executeTakeFirst(),
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
  const lateInvitationWindow = new Date(Date.now() - 60_000);
  await database
    .updateTable("event_occurrence")
    .set({ registrationClosesAt: lateInvitationWindow })
    .where("id", "=", eventOccurrenceId)
    .executeTakeFirstOrThrow();
  assert.equal(
    await createEventLateRegistrationInvitation(
      {
        eventOccurrenceId,
        name: presenter.name,
        email: presenter.email,
        eventOccurrenceRegionId: null,
        overrideDomainRestriction: true,
        expiresInDays: 7,
      },
      administrator,
    ),
    "not-found",
  );
  assert.equal(
    await createEventLateRegistrationInvitation(
      {
        eventOccurrenceId,
        name: presenter.name,
        email: presenter.email,
        eventOccurrenceRegionId: addedOccurrenceRegion.id,
        overrideDomainRestriction: true,
        expiresInDays: 7,
      },
      administrator,
    ),
    "created",
  );
  const lateInvitation = await database
    .selectFrom("event_late_registration_invitation")
    .select("id")
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .where("userId", "=", presenter.id)
    .executeTakeFirstOrThrow();
  const lateInvitationNotification = await database
    .selectFrom("notification")
    .select(["id", "payload"])
    .where("recipientUserId", "=", presenter.id)
    .where(
      "payload",
      "@>",
      JSON.stringify({
        eventLateRegistrationInvitationId: lateInvitation.id,
      }),
    )
    .executeTakeFirstOrThrow();
  const lateInvitationUrl = (
    lateInvitationNotification.payload as {
      variables: Record<string, string>;
    }
  ).variables["event.invitationUrl"];
  assert.ok(lateInvitationUrl);
  const lateInvitationToken = new URL(lateInvitationUrl).hash.replace(
    "#token=",
    "",
  );
  assert.match(lateInvitationToken, /^[A-Za-z0-9_-]{43}$/u);
  assert.deepEqual(
    await findEventLateRegistrationInvitation(lateInvitationToken, learner),
    { status: "forbidden" },
  );
  assert.equal(
    (await findEventLateRegistrationInvitation(lateInvitationToken, presenter))
      .status,
    "ready",
  );
  assert.deepEqual(
    await acceptEventLateRegistrationInvitation(lateInvitationToken, presenter),
    { status: "registered", eventOccurrenceId },
  );
  assert.deepEqual(
    await findEventLateRegistrationInvitation(lateInvitationToken, presenter),
    { status: "accepted", eventOccurrenceId },
  );
  assert.deepEqual(
    await database
      .selectFrom("event_registration")
      .select([
        "source",
        "status",
        "reviewRoundId",
        "regionalReviewWaivedByUserId",
      ])
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .where("userId", "=", presenter.id)
      .executeTakeFirstOrThrow(),
    {
      source: "late_invitation",
      status: "submitted",
      reviewRoundId: null,
      regionalReviewWaivedByUserId: administrator.id,
    },
  );
  assert.equal(
    await database
      .selectFrom("notification")
      .select("status")
      .where("id", "=", lateInvitationNotification.id)
      .executeTakeFirstOrThrow()
      .then((row) => row.status),
    "superseded",
  );

  assert.equal(
    await createEventLateRegistrationInvitation(
      {
        eventOccurrenceId,
        name: coordinator.name,
        email: coordinator.email,
        eventOccurrenceRegionId: addedOccurrenceRegion.id,
        overrideDomainRestriction: true,
        expiresInDays: 7,
      },
      administrator,
    ),
    "created",
  );
  const reconciledInvitation = await database
    .selectFrom("event_late_registration_invitation")
    .select("id")
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .where("userId", "=", coordinator.id)
    .executeTakeFirstOrThrow();
  const reconciledInvitationNotification = await database
    .selectFrom("notification")
    .select("payload")
    .where("recipientUserId", "=", coordinator.id)
    .where(
      "payload",
      "@>",
      JSON.stringify({
        eventLateRegistrationInvitationId: reconciledInvitation.id,
      }),
    )
    .executeTakeFirstOrThrow();
  const reconciledInvitationUrl = (
    reconciledInvitationNotification.payload as {
      variables: Record<string, string>;
    }
  ).variables["event.invitationUrl"];
  assert.ok(reconciledInvitationUrl);
  const reconciledInvitationToken = new URL(
    reconciledInvitationUrl,
  ).hash.replace("#token=", "");
  assert.equal(
    await addAdminEventRegistration(
      {
        eventOccurrenceId,
        name: coordinator.name,
        email: coordinator.email,
        eventOccurrenceRegionId: null,
        overrideDomainRestriction: true,
      },
      administrator,
    ),
    "created",
  );
  const reconciledRegistration = await database
    .selectFrom("event_registration")
    .select("id")
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .where("userId", "=", coordinator.id)
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    await acceptEventLateRegistrationInvitation(
      reconciledInvitationToken,
      coordinator,
    ),
    { status: "already-registered", eventOccurrenceId },
  );
  assert.deepEqual(
    await database
      .selectFrom("audit_event")
      .select(["action", "metadata"])
      .where("action", "=", "event_late_registration_invitation.accepted")
      .where("subjectId", "=", reconciledInvitation.id)
      .executeTakeFirstOrThrow(),
    {
      action: "event_late_registration_invitation.accepted",
      metadata: {
        registrationId: reconciledRegistration.id,
        reconciledExistingRegistration: true,
      },
    },
  );

  const allowedDomainInvitationEmail = `late-invitation-${suffix}@health.example.org`;
  assert.equal(
    await createEventLateRegistrationInvitation(
      {
        eventOccurrenceId,
        name: "Allowed-domain late learner",
        email: allowedDomainInvitationEmail,
        eventOccurrenceRegionId: addedOccurrenceRegion.id,
        overrideDomainRestriction: false,
        expiresInDays: 2,
      },
      administrator,
    ),
    "created",
  );
  const allowedDomainLateInvitation = await database
    .selectFrom("event_late_registration_invitation as invitation")
    .innerJoin("user", "user.id", "invitation.userId")
    .select("invitation.id")
    .where("invitation.eventOccurrenceId", "=", eventOccurrenceId)
    .where("user.email", "=", allowedDomainInvitationEmail)
    .executeTakeFirstOrThrow();
  assert.equal(
    await revokeEventLateRegistrationInvitation(
      eventOccurrenceId,
      allowedDomainLateInvitation.id,
      administrator,
    ),
    "revoked",
  );

  const provisionalInvitationEmail = `late-invitation-${suffix}@outside.example.net`;
  assert.equal(
    await createEventLateRegistrationInvitation(
      {
        eventOccurrenceId,
        name: "Late invitation learner",
        email: provisionalInvitationEmail,
        eventOccurrenceRegionId: addedOccurrenceRegion.id,
        overrideDomainRestriction: true,
        expiresInDays: 30,
      },
      administrator,
    ),
    "created",
  );
  const provisionalLateInvitation = await database
    .selectFrom("event_late_registration_invitation as invitation")
    .innerJoin("user", "user.id", "invitation.userId")
    .select(["invitation.id", "invitation.expiresAt", "user.accountState"])
    .where("invitation.eventOccurrenceId", "=", eventOccurrenceId)
    .where("user.email", "=", provisionalInvitationEmail)
    .executeTakeFirstOrThrow();
  assert.equal(provisionalLateInvitation.accountState, "provisional");
  assert.equal(
    provisionalLateInvitation.expiresAt.toISOString(),
    coverageRevisionStartsAt.toISOString(),
  );
  const provisionalSetupNotification = await database
    .selectFrom("notification")
    .select("payload")
    .where(
      "payload",
      "@>",
      JSON.stringify({
        purpose: "late_registration_invitation",
        eventLateRegistrationInvitationId: provisionalLateInvitation.id,
      }),
    )
    .executeTakeFirstOrThrow();
  const provisionalSetupUrl = (
    provisionalSetupNotification.payload as { setupUrl?: unknown }
  ).setupUrl;
  assert.equal(typeof provisionalSetupUrl, "string");
  const provisionalSetupToken = new URLSearchParams(
    new URL(provisionalSetupUrl as string).hash.slice(1),
  ).get("token");
  assert.ok(provisionalSetupToken);
  assert.equal(
    await database
      .selectFrom("verification")
      .select("expiresAt")
      .where("identifier", "=", `reset-password:${provisionalSetupToken}`)
      .executeTakeFirstOrThrow()
      .then((verification) => verification.expiresAt.toISOString()),
    provisionalLateInvitation.expiresAt.toISOString(),
  );
  assert.equal(
    await revokeEventLateRegistrationInvitation(
      eventOccurrenceId,
      provisionalLateInvitation.id,
      administrator,
    ),
    "revoked",
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
    await database
      .selectFrom("event_operational_communication_schedule")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .where("status", "in", ["pending", "processing"])
      .executeTakeFirstOrThrow()
      .then((row) => row.count),
    0,
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

  const historicalCoordinatorRevocation =
    await revokeAdminEventStaffEligibility(
      coordinatorEligibility.eligibilityId,
      administrator,
    );
  assert.equal(historicalCoordinatorRevocation.status, "revoked");
  assert.ok(
    await database
      .selectFrom("event_staff_eligibility")
      .select("revokedAt")
      .where("id", "=", coordinatorEligibility.eligibilityId)
      .executeTakeFirstOrThrow()
      .then((row) => row.revokedAt),
  );
  assert.ok(
    await database
      .selectFrom("event_coordinator_assignment")
      .select("endedAt")
      .where("eventOccurrenceRegionId", "=", occurrenceRegion.id)
      .where("userId", "=", coordinator.id)
      .executeTakeFirstOrThrow()
      .then((row) => row.endedAt),
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
    "Verified immutable Event Template publication, exact-version occurrence scheduling, retained reschedule history and review rounds, locked-round registration rejection, regional coverage retirement and registration disposition, assignment-ending optional Coordinator eligibility revocation, staff/session snapshots, scoped coordinator and presenter operations, occurrence-owned guarded Survey QR access, verified email/SMS OTP exact-Survey task recovery, restricted-domain administrator addition, acknowledged profile-region mismatches, region-guest overrides, audited profile-region alignment, exceptional locked-list reassignment, capacity-safe final selection, lifecycle-safe learner withdrawal and final decisions, retained registration transitions, attendance evidence, authorized participant progress projection and capacity constraints",
  );
} finally {
  await cleanup();
  await destroyDatabase();
}
