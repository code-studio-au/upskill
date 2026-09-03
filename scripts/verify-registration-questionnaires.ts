import assert from "node:assert/strict";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import type { Database } from "#/server/db/types";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const ids = {
  user: "verify_registration_questionnaire_user",
  otherUser: "verify_registration_questionnaire_other_user",
  administrator: "verify_registration_questionnaire_administrator",
  survey: "verify_registration_questionnaire_survey",
  surveyVersion: "verify_registration_questionnaire_survey_version",
  course: "verify_registration_questionnaire_course",
  courseVersion: "verify_registration_questionnaire_course_version",
  enrollment: "verify_registration_questionnaire_enrollment",
  waivedEnrollment: "verify_registration_questionnaire_waived_enrollment",
  eventSurvey: "verify_registration_questionnaire_event_survey",
  eventSurveyVersion: "verify_registration_questionnaire_event_survey_version",
  eventTemplate: "verify_registration_questionnaire_event_template",
  eventTemplateVersion:
    "verify_registration_questionnaire_event_template_version",
  eventOccurrence: "verify_registration_questionnaire_event_occurrence",
  eventOccurrenceRegion:
    "verify_registration_questionnaire_event_occurrence_region",
  eventRegistration: "verify_registration_questionnaire_event_registration",
  eventParticipation: "verify_registration_questionnaire_event_participation",
  zeroRegionEventRegistration:
    "verify_registration_questionnaire_zero_region_event_registration",
  zeroRegionEventParticipation:
    "verify_registration_questionnaire_zero_region_event_participation",
  eventGuestAccess: "verify_registration_questionnaire_event_guest_access",
  eventGuestReference: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef",
  regionGroup: "verify_registration_questionnaire_region_group",
  region: "verify_registration_questionnaire_region",
};

const user: AuthenticatedUser = {
  id: ids.user,
  name: "Original Learner Name",
  email: "registration-questionnaire@example.com",
  emailVerified: true,
};
const otherUser: AuthenticatedUser = {
  id: ids.otherUser,
  name: "Other Learner",
  email: "other-registration-questionnaire@example.com",
  emailVerified: true,
};
const administrator: AuthenticatedUser = {
  id: ids.administrator,
  name: "Registration Administrator",
  email: "registration-questionnaire-admin@example.com",
  emailVerified: true,
};

const database = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});

async function cleanup(): Promise<void> {
  const assignments = await database
    .selectFrom("registration_questionnaire_assignment")
    .select("id")
    .where("userId", "in", [ids.user, ids.otherUser])
    .execute();
  const assignmentIds = assignments.map((assignment) => assignment.id);
  if (assignmentIds.length) {
    await database
      .deleteFrom("outbox_event")
      .where("aggregateId", "in", assignmentIds)
      .execute();
    await database.transaction().execute(async (transaction) => {
      await sql`select set_config('upskill.audit_maintenance', 'on', true)`.execute(
        transaction,
      );
      await transaction
        .deleteFrom("audit_event")
        .where("subjectId", "in", assignmentIds)
        .execute();
    });
    await database
      .deleteFrom("registration_questionnaire_response")
      .where("assignmentId", "in", assignmentIds)
      .execute();
    await database
      .deleteFrom("registration_questionnaire_assignment")
      .where("id", "in", assignmentIds)
      .execute();
  }
  await database
    .deleteFrom("enrollment")
    .where("id", "in", [ids.enrollment, ids.waivedEnrollment])
    .execute();
  await database
    .deleteFrom("event_guest_access")
    .where("id", "=", ids.eventGuestAccess)
    .execute();
  const occurrenceRegistrations = await database
    .selectFrom("event_registration")
    .select("id")
    .where("eventOccurrenceId", "=", ids.eventOccurrence)
    .execute();
  const occurrenceRegistrationIds = occurrenceRegistrations.map(
    (registration) => registration.id,
  );
  await database
    .deleteFrom("event_participation")
    .where("eventOccurrenceId", "=", ids.eventOccurrence)
    .execute();
  if (occurrenceRegistrationIds.length)
    await database
      .deleteFrom("event_registration_transition")
      .where("eventRegistrationId", "in", occurrenceRegistrationIds)
      .execute();
  await database
    .deleteFrom("event_registration")
    .where("eventOccurrenceId", "=", ids.eventOccurrence)
    .execute();
  await database
    .deleteFrom("event_occurrence_region")
    .where("id", "=", ids.eventOccurrenceRegion)
    .execute();
  await database
    .deleteFrom("event_occurrence")
    .where("id", "=", ids.eventOccurrence)
    .execute();
  await database
    .deleteFrom("event_template_version")
    .where("id", "=", ids.eventTemplateVersion)
    .execute();
  await database
    .deleteFrom("event_template")
    .where("id", "=", ids.eventTemplate)
    .execute();
  await database
    .deleteFrom("course_version")
    .where("id", "=", ids.courseVersion)
    .execute();
  await database.deleteFrom("course").where("id", "=", ids.course).execute();
  await database
    .deleteFrom("survey_version")
    .where("id", "in", [ids.surveyVersion, ids.eventSurveyVersion])
    .execute();
  await database
    .deleteFrom("learning_activity_version")
    .where("id", "in", [ids.surveyVersion, ids.eventSurveyVersion])
    .execute();
  await database
    .deleteFrom("learning_activity")
    .where("id", "in", [ids.survey, ids.eventSurvey])
    .execute();
  await database
    .deleteFrom("user")
    .where("id", "in", [ids.user, ids.otherUser, ids.administrator])
    .execute();
  await database
    .deleteFrom("coordination_region")
    .where("id", "=", ids.region)
    .execute();
  await database
    .deleteFrom("coordination_region")
    .where("id", "=", ids.regionGroup)
    .execute();
}

try {
  await cleanup();
  const now = new Date();
  await database
    .insertInto("user")
    .values(
      [user, otherUser, administrator].map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        email: candidate.email,
        emailVerified: candidate.emailVerified,
        image: null,
        stripeCustomerId: null,
      })),
    )
    .execute();
  await database
    .insertInto("learning_activity")
    .values({
      id: ids.survey,
      kind: "survey",
      title: "Cohort registration details",
      surveyUsage: "registration",
      surveyType: "registration",
      surveyPosition: 0,
      createdAt: now,
    })
    .execute();
  await database
    .insertInto("learning_activity_version")
    .values({
      id: ids.surveyVersion,
      activityId: ids.survey,
      kind: "survey",
      version: 1,
      publishedAt: now,
      createdAt: now,
    })
    .execute();
  await database
    .insertInto("survey_version")
    .values({
      id: ids.surveyVersion,
      content: {
        title: "Cohort registration details",
        description: "Registration-specific learner information.",
        sections: [
          {
            id: "registration_section",
            title: "Your details",
            description: "",
            items: [
              {
                id: "profile_name",
                kind: "short_text",
                prompt: "Current name",
                required: true,
                maximumLength: 200,
                format: "plain",
                profileField: "name",
              },
              {
                id: "discipline",
                kind: "short_text",
                prompt: "Discipline",
                required: true,
                maximumLength: 200,
                format: "plain",
              },
            ],
          },
        ],
      },
    })
    .execute();
  await database
    .insertInto("coordination_region")
    .values([
      {
        id: ids.regionGroup,
        parentId: null,
        code: "VERIFY-REGISTRATION-GROUP",
        name: "Verification region group",
        kind: "group",
        status: "active",
      },
      {
        id: ids.region,
        parentId: ids.regionGroup,
        code: "VERIFY-REGISTRATION-REGION",
        name: "Verification operational region",
        kind: "operational",
        status: "active",
      },
    ])
    .execute();
  await database
    .insertInto("learning_activity")
    .values({
      id: ids.eventSurvey,
      kind: "survey",
      title: "Event registration region",
      surveyUsage: "registration",
      surveyType: "registration",
      surveyPosition: 1,
      createdAt: now,
    })
    .execute();
  await database
    .insertInto("learning_activity_version")
    .values({
      id: ids.eventSurveyVersion,
      activityId: ids.eventSurvey,
      kind: "survey",
      version: 1,
      publishedAt: now,
      createdAt: now,
    })
    .execute();
  await database
    .insertInto("survey_version")
    .values({
      id: ids.eventSurveyVersion,
      content: {
        title: "Event registration region",
        description: "Choose the region for this event registration.",
        sections: [
          {
            id: "event_registration_section",
            title: "Event details",
            description: "",
            items: [
              {
                id: "event_operational_region",
                kind: "dropdown",
                prompt: "Operational region",
                required: true,
                optionSource: "coordination_operational_regions",
                options: [
                  {
                    id: "event_region_option",
                    label: "Verification operational region",
                    externalValue: ids.region,
                    parentExternalValue: ids.regionGroup,
                  },
                ],
              },
            ],
          },
        ],
      },
    })
    .execute();
  await database
    .insertInto("course")
    .values({
      id: ids.course,
      slug: "verify-registration-questionnaire",
      title: "Registration questionnaire course",
      status: "published",
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  await database
    .insertInto("course_version")
    .values({
      id: ids.courseVersion,
      courseId: ids.course,
      version: 1,
      content: {
        title: "Registration questionnaire course",
        summary: "Summary",
        description: "Description",
        topic: "Clinical education",
        durationMinutes: 30,
        priceCents: 0,
        salePriceCents: null,
        currency: "AUD",
        featured: false,
        listInStore: false,
        hasCompletionCertificate: false,
        prerequisites: [],
        accreditations: [],
        modules: [],
        sections: [],
      },
      registrationSurveyVersionId: ids.surveyVersion,
      publishedAt: now,
      createdAt: now,
    })
    .execute();
  await database
    .insertInto("enrollment")
    .values([
      {
        id: ids.enrollment,
        userId: ids.user,
        courseVersionId: ids.courseVersion,
        accessGrantId: null,
        status: "active",
        enrolledAt: now,
        completedAt: null,
        expiresAt: null,
        removedAt: null,
      },
      {
        id: ids.waivedEnrollment,
        userId: ids.otherUser,
        courseVersionId: ids.courseVersion,
        accessGrantId: null,
        status: "active",
        enrolledAt: now,
        completedAt: null,
        expiresAt: null,
        removedAt: null,
      },
    ])
    .execute();
  const eventStartsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1_000);
  eventStartsAt.setMilliseconds(0);
  const eventEndsAt = new Date(eventStartsAt.getTime() + 60 * 60 * 1_000);
  await database
    .insertInto("event_template")
    .values({
      id: ids.eventTemplate,
      title: "Registration questionnaire event",
      status: "published",
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  await database
    .insertInto("event_template_version")
    .values({
      id: ids.eventTemplateVersion,
      eventTemplateId: ids.eventTemplate,
      version: 1,
      topic: "Clinical education",
      summary: "Summary",
      description: "Description",
      coverImage: null,
      hasCompletionCertificate: false,
      accreditations: JSON.stringify([]),
      registrationSurveyVersionId: ids.eventSurveyVersion,
      publishedAt: now,
      createdAt: now,
    })
    .execute();
  await database
    .insertInto("event_occurrence")
    .values({
      id: ids.eventOccurrence,
      eventTemplateVersionId: ids.eventTemplateVersion,
      title: "Registration questionnaire paid event",
      slug: "verify-registration-questionnaire-paid-event",
      status: "published",
      deliveryMode: "virtual",
      registrationMode: "paid_entry",
      approvalMode: "automatic",
      timezone: "Australia/Sydney",
      localStartsAt: "2027-09-16T10:00:00",
      localEndsAt: "2027-09-16T11:00:00",
      localRegistrationOpensAt: null,
      localRegistrationClosesAt: null,
      localCoordinatorLockAt: null,
      startsAt: eventStartsAt,
      endsAt: eventEndsAt,
      registrationOpensAt: null,
      registrationClosesAt: null,
      coordinatorLockAt: null,
      capacity: 10,
      confirmedCount: 1,
      venueName: null,
      venueAddress: null,
      virtualJoinUrl: "https://video.example.com/registration-verification",
      priceCents: 1_000,
      salePriceCents: null,
      currency: "AUD",
      bulkPricing: JSON.stringify({ enabled: false, tiers: [] }),
      listInStore: true,
      featured: false,
      publishedAt: now,
      createdByUserId: ids.administrator,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  await database
    .insertInto("event_occurrence_region")
    .values({
      id: ids.eventOccurrenceRegion,
      eventOccurrenceId: ids.eventOccurrence,
      regionId: ids.region,
      position: 0,
      retiredAt: null,
    })
    .execute();
  await database
    .insertInto("event_registration")
    .values({
      id: ids.eventRegistration,
      eventOccurrenceId: ids.eventOccurrence,
      userId: ids.user,
      eventOccurrenceRegionId: null,
      reviewRoundId: null,
      nameSnapshot: user.name,
      emailSnapshot: user.email,
      source: "paid_checkout",
      eligibilitySource: "paid",
      status: "selected",
      coordinatorPriority: null,
      submittedAt: now,
      coordinatorDecidedAt: null,
      coordinatorDecidedByUserId: null,
      finalDecidedAt: now,
      finalDecidedByUserId: ids.administrator,
      lockedInAt: now,
    })
    .execute();
  await database
    .insertInto("event_participation")
    .values({
      id: ids.eventParticipation,
      eventOccurrenceId: ids.eventOccurrence,
      userId: ids.user,
      registrationId: ids.eventRegistration,
      mode: "registered",
      nameSnapshot: user.name,
      emailSnapshot: user.email,
      detailsSubmittedAt: null,
      joinDisclosedAt: null,
      checkedInAt: null,
      createdAt: now,
    })
    .execute();

  const { createAdminEventOccurrence } =
    await import("#/server/admin/admin-event-occurrence.server");
  const { findPublicEventGuestAccess, submitPublicEventGuestAccess } =
    await import("#/server/events/event-guest-access.server");
  assert.deepEqual(
    await createAdminEventOccurrence(
      {
        eventTemplateVersionId: ids.eventTemplateVersion,
        title: "Invalid open-entry registration questionnaire event",
        slug: "verify-registration-questionnaire-open-entry-event",
        deliveryMode: "virtual",
        registrationMode: "open_entry",
        approvalMode: "automatic",
        timezone: "UTC",
        localStartsAt: eventStartsAt.toISOString().slice(0, 19),
        localEndsAt: eventEndsAt.toISOString().slice(0, 19),
        localRegistrationOpensAt: "",
        localRegistrationClosesAt: "",
        localCoordinatorLockAt: "",
        startsAt: eventStartsAt.toISOString(),
        endsAt: eventEndsAt.toISOString(),
        registrationOpensAt: "",
        registrationClosesAt: "",
        coordinatorLockAt: "",
        capacity: 10,
        priceCents: null,
        salePriceCents: null,
        currency: "AUD",
        bulkPricing: { enabled: false, tiers: [] },
        listInStore: false,
        featured: false,
        venueName: "",
        venueAddress: "",
        virtualJoinUrl: "https://video.example.com/invalid-open-entry",
        domains: "",
      },
      administrator,
    ),
    {
      status: "conflict",
      reason: "registration-questionnaire-requires-registration",
    },
  );
  await database
    .updateTable("event_occurrence")
    .set({ registrationMode: "open_entry", priceCents: null })
    .where("id", "=", ids.eventOccurrence)
    .executeTakeFirstOrThrow();
  await database
    .insertInto("event_guest_access")
    .values({
      id: ids.eventGuestAccess,
      eventOccurrenceId: ids.eventOccurrence,
      publicReference: ids.eventGuestReference,
      generation: 1,
      createdAt: now,
      revokedAt: null,
    })
    .execute();
  assert.deepEqual(await findPublicEventGuestAccess(ids.eventGuestReference), {
    status: "not-found",
  });
  assert.deepEqual(
    await submitPublicEventGuestAccess(
      {
        publicReference: ids.eventGuestReference,
        name: otherUser.name,
        email: otherUser.email,
      },
      "registration-questionnaire-open-entry-verification",
    ),
    { status: "not-found" },
  );
  await database
    .deleteFrom("event_guest_access")
    .where("id", "=", ids.eventGuestAccess)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("event_occurrence")
    .set({ registrationMode: "paid_entry", priceCents: 1_000 })
    .where("id", "=", ids.eventOccurrence)
    .executeTakeFirstOrThrow();

  const {
    advanceRegistrationQuestionnaire,
    findCourseRegistrationQuestionnaire,
    findEventRegistrationQuestionnaire,
  } =
    await import("#/server/registration/learner-registration-questionnaire.server");
  const {
    courseRegistrationQuestionnaireComplete,
    eventRegistrationQuestionnaireComplete,
    eventRegistrationQuestionnaireSubmittedAt,
  } =
    await import("#/server/registration/registration-questionnaire-access.server");
  const {
    findCourseRegistrationQuestionnaireAdminDetail,
    findEventRegistrationQuestionnaireAdminDetail,
    waiveCourseRegistrationQuestionnaire,
  } =
    await import("#/server/registration/admin-registration-questionnaire.server");
  const { findLearnerWorkspace } =
    await import("#/server/learning/learner-workspace.server");
  const { findLearnerEventWorkspace } =
    await import("#/server/learning/learner-event-workspace.server");
  const { findLearnerEventsDashboard } =
    await import("#/server/learner/learner.server");
  const { decideAdminEventFinalRegistration } =
    await import("#/server/admin/admin-event-registration-operations.server");
  const { findEventBySlug } = await import("#/server/catalog/catalog.server");

  const catalogEvent = await findEventBySlug(
    "verify-registration-questionnaire-paid-event",
  );
  assert.ok(catalogEvent);
  assert.equal(catalogEvent.eventOccurrenceId, ids.eventOccurrence);
  assert.equal(catalogEvent.hasRegistrationQuestionnaire, true);

  const questionnaire = await findCourseRegistrationQuestionnaire(
    ids.enrollment,
    user,
  );
  if (!questionnaire || typeof questionnaire === "string")
    throw new Error("Expected a configured registration questionnaire");
  assert.equal(questionnaire.surveyVersionId, ids.surveyVersion);
  assert.equal(questionnaire.progress.answers.profile_name, user.name);
  assert.equal(questionnaire.progress.currentItemId, "profile_name");
  assert.equal(questionnaire.profileUpdateOffered, true);
  assert.equal(
    await findCourseRegistrationQuestionnaire(ids.enrollment, otherUser),
    null,
  );
  assert.equal(
    await courseRegistrationQuestionnaireComplete(
      database,
      ids.enrollment,
      user.id,
    ),
    false,
  );
  assert.equal(
    (await findLearnerWorkspace(ids.enrollment, user)).status,
    "registration-required",
    "The Course entry route must render its configured questionnaire",
  );

  const firstStep = await advanceRegistrationQuestionnaire(
    {
      assignmentId: questionnaire.assignmentId,
      itemId: "profile_name",
      answer: "Registration Snapshot Name",
    },
    user,
  );
  assert.equal(firstStep.status, "advanced");
  const courseStartedAt = await database
    .selectFrom("registration_questionnaire_assignment")
    .select("startedAt")
    .where("id", "=", questionnaire.assignmentId)
    .executeTakeFirstOrThrow()
    .then((assignment) => assignment.startedAt);
  assert.ok(courseStartedAt);
  const completed = await advanceRegistrationQuestionnaire(
    {
      assignmentId: questionnaire.assignmentId,
      itemId: "discipline",
      answer: "Nursing",
      profileUpdateAccepted: false,
    },
    user,
  );
  assert.equal(completed.status, "submitted");
  assert.equal(
    await database
      .selectFrom("registration_questionnaire_assignment")
      .select("startedAt")
      .where("id", "=", questionnaire.assignmentId)
      .executeTakeFirstOrThrow()
      .then((assignment) => assignment.startedAt?.getTime()),
    courseStartedAt.getTime(),
    "Later steps must preserve the first accepted step time",
  );
  assert.equal(
    await courseRegistrationQuestionnaireComplete(
      database,
      ids.enrollment,
      user.id,
    ),
    true,
  );
  assert.equal(
    (await findLearnerWorkspace(ids.enrollment, user)).status,
    "available",
    "Course content must unlock after questionnaire completion",
  );
  assert.equal(
    await database
      .selectFrom("user")
      .select("name")
      .where("id", "=", user.id)
      .executeTakeFirstOrThrow()
      .then((row) => row.name),
    user.name,
    "A registration snapshot must not update the profile without consent",
  );
  const detail = await findCourseRegistrationQuestionnaireAdminDetail(
    ids.course,
    ids.enrollment,
  );
  assert.ok(detail);
  assert.equal(detail.status, "completed");
  assert.deepEqual(
    detail.answers.map((answer) => [answer.prompt, answer.answer]),
    [
      ["Current name", "Registration Snapshot Name"],
      ["Discipline", "Nursing"],
    ],
  );

  const staleCourseQuestionnaire = await findCourseRegistrationQuestionnaire(
    ids.waivedEnrollment,
    otherUser,
  );
  if (!staleCourseQuestionnaire || typeof staleCourseQuestionnaire === "string")
    throw new Error("Expected a Course questionnaire before cancellation");
  await database
    .updateTable("enrollment")
    .set({ status: "cancelled" })
    .where("id", "=", ids.waivedEnrollment)
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    await advanceRegistrationQuestionnaire(
      {
        assignmentId: staleCourseQuestionnaire.assignmentId,
        itemId: "profile_name",
        answer: "Stale learner update",
      },
      otherUser,
    ),
    { status: "unavailable" },
    "A cancelled enrolment must reject a stale questionnaire submission",
  );
  assert.equal(
    await database
      .selectFrom("registration_questionnaire_assignment")
      .select("status")
      .where("id", "=", staleCourseQuestionnaire.assignmentId)
      .executeTakeFirstOrThrow()
      .then((assignment) => assignment.status),
    "assigned",
  );
  await database
    .updateTable("enrollment")
    .set({ status: "active" })
    .where("id", "=", ids.waivedEnrollment)
    .executeTakeFirstOrThrow();

  let releaseAssignmentLock: (() => void) | undefined;
  let confirmAssignmentLock: (() => void) | undefined;
  const assignmentLockHeld = new Promise<void>((resolve) => {
    confirmAssignmentLock = resolve;
  });
  const releaseAssignment = new Promise<void>((resolve) => {
    releaseAssignmentLock = resolve;
  });
  const assignmentLock = database.transaction().execute(async (transaction) => {
    await transaction
      .selectFrom("registration_questionnaire_assignment")
      .select("id")
      .where("id", "=", staleCourseQuestionnaire.assignmentId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    confirmAssignmentLock?.();
    await releaseAssignment;
  });
  await assignmentLockHeld;
  const pendingStep = advanceRegistrationQuestionnaire(
    {
      assignmentId: staleCourseQuestionnaire.assignmentId,
      itemId: "profile_name",
      answer: "Concurrent learner update",
    },
    otherUser,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  let existingWaiverSettled = false;
  const pendingExistingWaiver = waiveCourseRegistrationQuestionnaire(
    ids.course,
    ids.waivedEnrollment,
    "Concurrent administrative waiver",
    administrator,
  ).finally(() => {
    existingWaiverSettled = true;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      existingWaiverSettled,
      false,
      "A concurrent waiver must wait behind the learner's target lock",
    );
  } finally {
    releaseAssignmentLock?.();
    await assignmentLock;
  }
  assert.equal((await pendingStep).status, "advanced");
  assert.equal(await pendingExistingWaiver, "waived");
  await database.transaction().execute(async (transaction) => {
    await sql`select set_config('upskill.audit_maintenance', 'on', true)`.execute(
      transaction,
    );
    await transaction
      .deleteFrom("audit_event")
      .where("subjectId", "=", staleCourseQuestionnaire.assignmentId)
      .execute();
  });

  await database
    .deleteFrom("registration_questionnaire_response")
    .where("assignmentId", "=", staleCourseQuestionnaire.assignmentId)
    .executeTakeFirstOrThrow();
  await database
    .deleteFrom("registration_questionnaire_assignment")
    .where("id", "=", staleCourseQuestionnaire.assignmentId)
    .executeTakeFirstOrThrow();
  let releaseEnrollmentLock: (() => void) | undefined;
  let confirmEnrollmentLock: (() => void) | undefined;
  const enrollmentLockHeld = new Promise<void>((resolve) => {
    confirmEnrollmentLock = resolve;
  });
  const releaseEnrollment = new Promise<void>((resolve) => {
    releaseEnrollmentLock = resolve;
  });
  const enrollmentLock = database.transaction().execute(async (transaction) => {
    await transaction
      .selectFrom("enrollment")
      .select("id")
      .where("id", "=", ids.waivedEnrollment)
      .forUpdate()
      .executeTakeFirstOrThrow();
    confirmEnrollmentLock?.();
    await releaseEnrollment;
  });
  await enrollmentLockHeld;
  let waiverSettled = false;
  const pendingWaiver = waiveCourseRegistrationQuestionnaire(
    ids.course,
    ids.waivedEnrollment,
    "Accessibility accommodation",
    administrator,
  ).finally(() => {
    waiverSettled = true;
  });
  let waiverOutcome: "waived" | "not-found" | "conflict" | undefined;
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      waiverSettled,
      false,
      "A waiver must lock the enrolment before lazily creating its assignment",
    );
  } finally {
    releaseEnrollmentLock?.();
    await enrollmentLock;
    waiverOutcome = await pendingWaiver;
  }

  assert.equal(waiverOutcome, "waived");
  assert.equal(
    await courseRegistrationQuestionnaireComplete(
      database,
      ids.waivedEnrollment,
      otherUser.id,
    ),
    true,
  );
  const waivedDetail = await findCourseRegistrationQuestionnaireAdminDetail(
    ids.course,
    ids.waivedEnrollment,
  );
  assert.ok(waivedDetail);
  assert.equal(waivedDetail.status, "waived");
  assert.equal(waivedDetail.answers.length, 0);
  assert.equal(waivedDetail.waiverReason, "Accessibility accommodation");
  assert.equal(
    await findCourseRegistrationQuestionnaire(ids.waivedEnrollment, otherUser),
    "complete",
    "A waived learner link must not reopen the questionnaire",
  );
  assert.equal(
    await database
      .selectFrom("audit_event")
      .select("action")
      .where("action", "=", "registration_questionnaire.waived")
      .executeTakeFirstOrThrow()
      .then((row) => row.action),
    "registration_questionnaire.waived",
  );

  const eventQuestionnaire = await findEventRegistrationQuestionnaire(
    ids.eventOccurrence,
    user,
  );
  if (!eventQuestionnaire || typeof eventQuestionnaire === "string")
    throw new Error("Expected a configured Event registration questionnaire");
  assert.equal(
    (await findLearnerEventWorkspace(ids.eventOccurrence, user)).status,
    "registration-required",
    "The Event entry route must render its configured questionnaire",
  );
  assert.equal(eventQuestionnaire.surveyVersionId, ids.eventSurveyVersion);
  assert.deepEqual(
    eventQuestionnaire.content.sections[0]?.items[0]?.kind === "dropdown"
      ? eventQuestionnaire.content.sections[0].items[0].options.map(
          (option) => option.externalValue,
        )
      : [],
    [ids.region],
    "Event registration options must be limited to occurrence regions",
  );
  assert.equal(
    await eventRegistrationQuestionnaireComplete(
      database,
      ids.eventOccurrence,
      user.id,
    ),
    false,
  );
  await database
    .updateTable("event_registration")
    .set({
      status: "submitted",
      finalDecidedAt: null,
      finalDecidedByUserId: null,
      lockedInAt: null,
    })
    .where("id", "=", ids.eventRegistration)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("event_occurrence")
    .set({ confirmedCount: 0 })
    .where("id", "=", ids.eventOccurrence)
    .executeTakeFirstOrThrow();
  const pendingEvent = (await findLearnerEventsDashboard(user)).events.find(
    (event) => event.eventOccurrenceId === ids.eventOccurrence,
  );
  assert.equal(pendingEvent?.registrationStatus, "submitted");
  assert.equal(
    pendingEvent.registrationRequired,
    true,
    "My Events must identify a pending questionnaire for an existing registration",
  );
  assert.equal(
    await decideAdminEventFinalRegistration(
      ids.eventOccurrence,
      ids.eventRegistration,
      "selected",
      administrator,
    ),
    "invalid-transition",
    "Final selection must wait for required registration details",
  );
  await database
    .updateTable("event_registration")
    .set({
      status: "selected",
      finalDecidedAt: now,
      finalDecidedByUserId: ids.administrator,
      lockedInAt: now,
    })
    .where("id", "=", ids.eventRegistration)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("event_occurrence")
    .set({ confirmedCount: 1, status: "cancelled" })
    .where("id", "=", ids.eventOccurrence)
    .executeTakeFirstOrThrow();
  assert.equal(
    (await findLearnerEventWorkspace(ids.eventOccurrence, user)).status,
    "cancelled",
    "Cancellation must take precedence over an incomplete questionnaire",
  );
  assert.equal(
    (await findLearnerEventsDashboard(user)).events.find(
      (event) => event.eventOccurrenceId === ids.eventOccurrence,
    )?.registrationRequired,
    false,
    "A cancelled Event must not expose a dashboard questionnaire action",
  );
  await database
    .updateTable("event_occurrence")
    .set({ status: "completed" })
    .where("id", "=", ids.eventOccurrence)
    .executeTakeFirstOrThrow();
  assert.equal(
    await findEventRegistrationQuestionnaire(ids.eventOccurrence, user),
    "unavailable",
    "A completed Event must not expose a questionnaire that cannot accept answers",
  );
  assert.equal(
    (await findLearnerEventsDashboard(user)).events.find(
      (event) => event.eventOccurrenceId === ids.eventOccurrence,
    )?.registrationRequired,
    false,
    "A completed Event must not expose a dashboard questionnaire action",
  );
  await database
    .updateTable("event_occurrence")
    .set({ status: "published" })
    .where("id", "=", ids.eventOccurrence)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("event_registration")
    .set({ status: "cancelled", lockedInAt: null })
    .where("id", "=", ids.eventRegistration)
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    await advanceRegistrationQuestionnaire(
      {
        assignmentId: eventQuestionnaire.assignmentId,
        itemId: "event_operational_region",
        answer: "event_region_option",
      },
      user,
    ),
    { status: "unavailable" },
    "A stale Event form must reject answers after registration cancellation",
  );
  await database
    .updateTable("event_registration")
    .set({ status: "selected", lockedInAt: now })
    .where("id", "=", ids.eventRegistration)
    .executeTakeFirstOrThrow();
  const eventCompleted = await advanceRegistrationQuestionnaire(
    {
      assignmentId: eventQuestionnaire.assignmentId,
      itemId: "event_operational_region",
      answer: "event_region_option",
      profileUpdateAccepted: false,
    },
    user,
  );
  assert.equal(eventCompleted.status, "submitted");
  assert.equal(
    await eventRegistrationQuestionnaireComplete(
      database,
      ids.eventOccurrence,
      user.id,
    ),
    true,
  );
  assert.equal(
    (await findLearnerEventWorkspace(ids.eventOccurrence, user)).status,
    "ready",
    "Event content must unlock after questionnaire completion",
  );
  const eventAssignment = await database
    .selectFrom("registration_questionnaire_assignment")
    .select(["eventOccurrenceRegionId", "completedAt"])
    .where("eventOccurrenceId", "=", ids.eventOccurrence)
    .where("userId", "=", user.id)
    .executeTakeFirstOrThrow();
  assert.equal(
    eventAssignment.eventOccurrenceRegionId,
    ids.eventOccurrenceRegion,
  );
  assert.ok(eventAssignment.completedAt);
  assert.equal(
    (
      await eventRegistrationQuestionnaireSubmittedAt(
        database,
        ids.eventOccurrence,
        user.id,
      )
    )?.getTime(),
    eventAssignment.completedAt.getTime(),
    "Manual approval must be able to retain the questionnaire completion time",
  );
  assert.deepEqual(
    await database
      .selectFrom("event_registration")
      .select(["id", "source", "eventOccurrenceRegionId"])
      .where("eventOccurrenceId", "=", ids.eventOccurrence)
      .where("userId", "=", user.id)
      .execute(),
    [
      {
        id: ids.eventRegistration,
        source: "paid_checkout",
        eventOccurrenceRegionId: ids.eventOccurrenceRegion,
      },
    ],
    "Completing a paid Event questionnaire must retain and update its existing registration",
  );
  assert.deepEqual(
    await database
      .selectFrom("event_registration_transition")
      .select([
        "fromStatus",
        "toStatus",
        "fromEventOccurrenceRegionId",
        "toEventOccurrenceRegionId",
        "source",
      ])
      .where("eventRegistrationId", "=", ids.eventRegistration)
      .where("fromEventOccurrenceRegionId", "is", null)
      .where("toEventOccurrenceRegionId", "=", ids.eventOccurrenceRegion)
      .executeTakeFirstOrThrow(),
    {
      fromStatus: "selected",
      toStatus: "selected",
      fromEventOccurrenceRegionId: null,
      toEventOccurrenceRegionId: ids.eventOccurrenceRegion,
      source: "learner",
    },
    "A questionnaire-driven region change must retain transition evidence",
  );
  assert.equal(
    await database
      .selectFrom("event_participation")
      .select("detailsSubmittedAt")
      .where("id", "=", ids.eventParticipation)
      .executeTakeFirstOrThrow()
      .then((participation) => participation.detailsSubmittedAt?.getTime()),
    eventAssignment.completedAt.getTime(),
  );
  const eventDetail = await findEventRegistrationQuestionnaireAdminDetail(
    ids.eventOccurrence,
    ids.eventRegistration,
  );
  assert.ok(eventDetail);
  assert.equal(eventDetail.status, "completed");
  assert.deepEqual(eventDetail.answers, [
    {
      questionId: "event_operational_region",
      prompt: "Operational region",
      answer: "Verification operational region",
    },
  ]);

  const originalEventSurveyContent = await database
    .selectFrom("survey_version")
    .select("content")
    .where("id", "=", ids.eventSurveyVersion)
    .executeTakeFirstOrThrow()
    .then((version) => version.content);
  await database
    .updateTable("survey_version")
    .set({
      content: {
        title: "Event registration region",
        description: "Choose the region for this event registration.",
        sections: [
          {
            id: "event_registration_section",
            title: "Event details",
            description: "",
            items: [
              {
                id: "event_operational_region",
                kind: "dropdown",
                prompt: "Operational region",
                required: false,
                optionSource: "coordination_operational_regions",
                options: [
                  {
                    id: "event_region_option",
                    label: "Verification operational region",
                    externalValue: ids.region,
                    parentExternalValue: ids.regionGroup,
                  },
                ],
              },
              {
                id: "event_region_confirmation",
                kind: "instruction",
                title: "Confirm details",
                body: "Continue to confirm your registration details.",
              },
            ],
          },
        ],
      },
    })
    .where("id", "=", ids.eventSurveyVersion)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("registration_questionnaire_assignment")
    .set({
      status: "in_progress",
      completedAt: null,
      eventOccurrenceRegionId: ids.eventOccurrenceRegion,
    })
    .where("id", "=", eventQuestionnaire.assignmentId)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("registration_questionnaire_response")
    .set({
      answers: JSON.stringify({
        event_operational_region: "event_region_option",
      }),
      visitedItemIds: JSON.stringify([]),
      currentItemId: "event_operational_region",
      submittedAt: null,
    })
    .where("assignmentId", "=", eventQuestionnaire.assignmentId)
    .executeTakeFirstOrThrow();
  assert.equal(
    (
      await advanceRegistrationQuestionnaire(
        {
          assignmentId: eventQuestionnaire.assignmentId,
          itemId: "event_operational_region",
        },
        user,
      )
    ).status,
    "advanced",
  );
  assert.equal(
    await database
      .selectFrom("registration_questionnaire_assignment")
      .select("eventOccurrenceRegionId")
      .where("id", "=", eventQuestionnaire.assignmentId)
      .executeTakeFirstOrThrow()
      .then((assignment) => assignment.eventOccurrenceRegionId),
    null,
    "Clearing an optional region answer must clear the retained occurrence region",
  );
  await database
    .updateTable("survey_version")
    .set({ content: originalEventSurveyContent })
    .where("id", "=", ids.eventSurveyVersion)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("registration_questionnaire_assignment")
    .set({
      status: "completed",
      completedAt: eventAssignment.completedAt,
      eventOccurrenceRegionId: ids.eventOccurrenceRegion,
    })
    .where("id", "=", eventQuestionnaire.assignmentId)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("registration_questionnaire_response")
    .set({
      answers: JSON.stringify({
        event_operational_region: "event_region_option",
      }),
      visitedItemIds: JSON.stringify(["event_operational_region"]),
      currentItemId: null,
      submittedAt: eventAssignment.completedAt,
    })
    .where("assignmentId", "=", eventQuestionnaire.assignmentId)
    .executeTakeFirstOrThrow();

  await database
    .updateTable("event_occurrence_region")
    .set({ retiredAt: new Date() })
    .where("id", "=", ids.eventOccurrenceRegion)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("registration_questionnaire_assignment")
    .set({
      status: "in_progress",
      completedAt: null,
      eventOccurrenceRegionId: ids.eventOccurrenceRegion,
    })
    .where("id", "=", eventQuestionnaire.assignmentId)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("registration_questionnaire_response")
    .set({
      answers: JSON.stringify({
        event_operational_region: "event_region_option",
      }),
      visitedItemIds: JSON.stringify([]),
      currentItemId: "event_operational_region",
      submittedAt: null,
    })
    .where("assignmentId", "=", eventQuestionnaire.assignmentId)
    .executeTakeFirstOrThrow();
  const retainedRegionQuestionnaire = await findEventRegistrationQuestionnaire(
    ids.eventOccurrence,
    user,
  );
  if (
    !retainedRegionQuestionnaire ||
    typeof retainedRegionQuestionnaire === "string"
  )
    throw new Error("Expected the retained-region Event questionnaire");
  assert.deepEqual(
    retainedRegionQuestionnaire.content.sections[0]?.items[0]?.kind ===
      "dropdown"
      ? retainedRegionQuestionnaire.content.sections[0].items[0].options.map(
          (option) => option.externalValue,
        )
      : [],
    [ids.region],
    "A live registration must retain its future-only retired region option",
  );
  assert.equal(
    (
      await advanceRegistrationQuestionnaire(
        {
          assignmentId: eventQuestionnaire.assignmentId,
          itemId: "event_operational_region",
          answer: "event_region_option",
          profileUpdateAccepted: false,
        },
        user,
      )
    ).status,
    "submitted",
    "A learner must be able to finish with a retained retired region",
  );
  assert.equal(
    await database
      .selectFrom("registration_questionnaire_assignment")
      .select("eventOccurrenceRegionId")
      .where("id", "=", eventQuestionnaire.assignmentId)
      .executeTakeFirstOrThrow()
      .then((assignment) => assignment.eventOccurrenceRegionId),
    ids.eventOccurrenceRegion,
  );
  await database
    .insertInto("event_registration")
    .values({
      id: ids.zeroRegionEventRegistration,
      eventOccurrenceId: ids.eventOccurrence,
      userId: ids.otherUser,
      eventOccurrenceRegionId: null,
      reviewRoundId: null,
      nameSnapshot: otherUser.name,
      emailSnapshot: otherUser.email,
      source: "paid_checkout",
      eligibilitySource: "paid",
      status: "selected",
      coordinatorPriority: null,
      submittedAt: now,
      coordinatorDecidedAt: null,
      coordinatorDecidedByUserId: null,
      finalDecidedAt: now,
      finalDecidedByUserId: ids.administrator,
      lockedInAt: now,
    })
    .execute();
  await database
    .insertInto("event_participation")
    .values({
      id: ids.zeroRegionEventParticipation,
      eventOccurrenceId: ids.eventOccurrence,
      userId: ids.otherUser,
      registrationId: ids.zeroRegionEventRegistration,
      mode: "registered",
      nameSnapshot: otherUser.name,
      emailSnapshot: otherUser.email,
      detailsSubmittedAt: null,
      joinDisclosedAt: null,
      checkedInAt: null,
      createdAt: now,
    })
    .execute();
  const zeroRegionQuestionnaire = await findEventRegistrationQuestionnaire(
    ids.eventOccurrence,
    otherUser,
  );
  if (!zeroRegionQuestionnaire || typeof zeroRegionQuestionnaire === "string")
    throw new Error("Expected a zero-region Event questionnaire");
  const zeroRegionCompleted = await advanceRegistrationQuestionnaire(
    {
      assignmentId: zeroRegionQuestionnaire.assignmentId,
      itemId: "event_operational_region",
      answer: "event_region_option",
      profileUpdateAccepted: false,
    },
    otherUser,
  );
  assert.equal(
    zeroRegionCompleted.status,
    "submitted",
    "A profile region answer must not require an occurrence region when the Event offers none",
  );
  assert.equal(
    await database
      .selectFrom("registration_questionnaire_assignment")
      .select("eventOccurrenceRegionId")
      .where("eventOccurrenceId", "=", ids.eventOccurrence)
      .where("userId", "=", ids.otherUser)
      .executeTakeFirstOrThrow()
      .then((assignment) => assignment.eventOccurrenceRegionId),
    null,
  );

  await database
    .updateTable("survey_version")
    .set({
      content: {
        title: "Registration communication preferences",
        description: "Confirm your communication preferences.",
        sections: [
          {
            id: "registration_preferences_section",
            title: "Communication preferences",
            description: "",
            items: [
              {
                id: "profile_sms_enabled",
                kind: "checkbox",
                prompt: "Receive SMS updates",
                required: false,
                profileField: "smsEnabled",
              },
            ],
          },
        ],
      },
    })
    .where("id", "=", ids.surveyVersion)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("registration_questionnaire_assignment")
    .set({ status: "assigned", startedAt: null, completedAt: null })
    .where("id", "=", questionnaire.assignmentId)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("registration_questionnaire_response")
    .set({
      answers: JSON.stringify({}),
      visitedItemIds: JSON.stringify([]),
      currentItemId: "profile_sms_enabled",
      submittedAt: null,
      profileUpdateAcceptedAt: null,
    })
    .where("assignmentId", "=", questionnaire.assignmentId)
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    await advanceRegistrationQuestionnaire(
      {
        assignmentId: questionnaire.assignmentId,
        itemId: "profile_sms_enabled",
        answer: true,
        profileUpdateAccepted: true,
      },
      user,
    ),
    {
      status: "invalid",
      message: "Enter a valid mobile number before enabling SMS updates.",
    },
    "Profile consent must reject SMS opt-in without an effective valid phone",
  );
  assert.equal(
    await database
      .selectFrom("user")
      .select("smsEnabled")
      .where("id", "=", user.id)
      .executeTakeFirstOrThrow()
      .then((profile) => profile.smsEnabled),
    false,
  );

  await database
    .updateTable("coordination_region")
    .set({ status: "retired" })
    .where("id", "=", ids.region)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("registration_questionnaire_assignment")
    .set({ status: "assigned", startedAt: null, completedAt: null })
    .where("id", "=", zeroRegionQuestionnaire.assignmentId)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("registration_questionnaire_response")
    .set({
      answers: JSON.stringify({}),
      visitedItemIds: JSON.stringify([]),
      currentItemId: "event_operational_region",
      submittedAt: null,
      profileUpdateAcceptedAt: null,
    })
    .where("assignmentId", "=", zeroRegionQuestionnaire.assignmentId)
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    await advanceRegistrationQuestionnaire(
      {
        assignmentId: zeroRegionQuestionnaire.assignmentId,
        itemId: "event_operational_region",
        answer: "event_region_option",
        profileUpdateAccepted: true,
      },
      otherUser,
    ),
    {
      status: "invalid",
      message:
        "Choose an active operational region before updating your profile.",
    },
    "Profile consent must reject a retired operational region",
  );
  assert.equal(
    await database
      .selectFrom("user")
      .select("currentRegionId")
      .where("id", "=", otherUser.id)
      .executeTakeFirstOrThrow()
      .then((profile) => profile.currentRegionId),
    null,
  );
  await database
    .updateTable("coordination_region")
    .set({ status: "active" })
    .where("id", "=", ids.region)
    .executeTakeFirstOrThrow();

  await database
    .deleteFrom("event_participation")
    .where("id", "=", ids.zeroRegionEventParticipation)
    .executeTakeFirstOrThrow();
  await database
    .deleteFrom("event_registration")
    .where("id", "=", ids.zeroRegionEventRegistration)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("event_occurrence")
    .set({
      registrationMode: "required_unrestricted",
      registrationOpensAt: new Date(now.getTime() - 60_000),
      registrationClosesAt: new Date(now.getTime() + 60_000),
      capacity: 1,
      confirmedCount: 1,
      priceCents: null,
    })
    .where("id", "=", ids.eventOccurrence)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("registration_questionnaire_assignment")
    .set({
      status: "assigned",
      startedAt: null,
      completedAt: null,
      eventOccurrenceRegionId: null,
    })
    .where("id", "=", zeroRegionQuestionnaire.assignmentId)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("registration_questionnaire_response")
    .set({
      answers: JSON.stringify({}),
      visitedItemIds: JSON.stringify([]),
      currentItemId: "event_operational_region",
      submittedAt: null,
      profileUpdateAcceptedAt: null,
    })
    .where("assignmentId", "=", zeroRegionQuestionnaire.assignmentId)
    .executeTakeFirstOrThrow();
  const unavailableEvent = (
    await findLearnerEventsDashboard(otherUser)
  ).events.find((event) => event.eventOccurrenceId === ids.eventOccurrence);
  assert.ok(unavailableEvent);
  assert.equal(unavailableEvent.canRegister, false);
  assert.equal(
    unavailableEvent.registrationRequired,
    false,
    "An unavailable new registration must not link to its questionnaire",
  );
  assert.equal(
    (
      await findEventBySlug(
        "verify-registration-questionnaire-paid-event",
        otherUser,
      )
    )?.registrationAvailability,
    "full",
    "The Event catalogue must expose full questionnaire registrations as unavailable",
  );
  await database
    .updateTable("event_occurrence")
    .set({
      registrationMode: "required_restricted",
      capacity: 10,
      confirmedCount: 0,
    })
    .where("id", "=", ids.eventOccurrence)
    .executeTakeFirstOrThrow();
  assert.equal(
    (
      await findEventBySlug(
        "verify-registration-questionnaire-paid-event",
        otherUser,
      )
    )?.registrationAvailability,
    "ineligible",
    "The Event catalogue must disable questionnaire registration for an ineligible domain",
  );
  await database
    .updateTable("event_occurrence")
    .set({
      registrationMode: "required_unrestricted",
      capacity: 1,
      confirmedCount: 1,
    })
    .where("id", "=", ids.eventOccurrence)
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    await advanceRegistrationQuestionnaire(
      {
        assignmentId: zeroRegionQuestionnaire.assignmentId,
        itemId: "event_operational_region",
        answer: "event_region_option",
      },
      otherUser,
    ),
    { status: "unavailable" },
    "Event questionnaire completion must stop before mutation when registration is unavailable",
  );
  assert.deepEqual(
    await database
      .selectFrom("registration_questionnaire_assignment as assignment")
      .innerJoin(
        "registration_questionnaire_response as response",
        "response.assignmentId",
        "assignment.id",
      )
      .select(["assignment.status", "response.submittedAt"])
      .where("assignment.id", "=", zeroRegionQuestionnaire.assignmentId)
      .executeTakeFirstOrThrow(),
    { status: "assigned", submittedAt: null },
    "Unavailable Event registration must leave the questionnaire retryable",
  );
  assert.equal(
    await database
      .selectFrom("event_registration")
      .select(sql<number>`count(*)::integer`.as("count"))
      .where("eventOccurrenceId", "=", ids.eventOccurrence)
      .where("userId", "=", otherUser.id)
      .executeTakeFirstOrThrow()
      .then((row) => row.count),
    0,
  );

  await database
    .updateTable("survey_version")
    .set({
      content: {
        title: "Registration contact details",
        description: "Confirm your mobile number.",
        sections: [
          {
            id: "registration_contact_section",
            title: "Contact details",
            description: "",
            items: [
              {
                id: "profile_phone",
                kind: "short_text",
                prompt: "Mobile number",
                required: true,
                maximumLength: 40,
                format: "phone",
                profileField: "phone",
              },
            ],
          },
        ],
      },
    })
    .where("id", "=", ids.surveyVersion)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("registration_questionnaire_assignment")
    .set({ status: "assigned", startedAt: null, completedAt: null })
    .where("id", "=", questionnaire.assignmentId)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("registration_questionnaire_response")
    .set({
      answers: JSON.stringify({}),
      visitedItemIds: JSON.stringify([]),
      currentItemId: "profile_phone",
      submittedAt: null,
      profileUpdateAcceptedAt: null,
    })
    .where("assignmentId", "=", questionnaire.assignmentId)
    .executeTakeFirstOrThrow();
  assert.deepEqual(
    await advanceRegistrationQuestionnaire(
      {
        assignmentId: questionnaire.assignmentId,
        itemId: "profile_phone",
        answer: "0412 345 678",
        profileUpdateAccepted: true,
      },
      user,
    ),
    {
      status: "invalid",
      message:
        "Enter a mobile number in international format, for example +61400123456.",
    },
    "Profile consent must reject a local-format phone instead of silently skipping it",
  );
  assert.equal(
    await database
      .selectFrom("user")
      .select("phone")
      .where("id", "=", user.id)
      .executeTakeFirstOrThrow()
      .then((profile) => profile.phone),
    null,
  );

  await database
    .updateTable("survey_version")
    .set({
      content: {
        title: "Registration region details",
        description: "Confirm your current region.",
        sections: [
          {
            id: "registration_region_section",
            title: "Region",
            description: "",
            items: [
              {
                id: "profile_region_group",
                kind: "dropdown",
                prompt: "Region group",
                required: false,
                optionSource: "coordination_region_groups",
                options: [
                  {
                    id: "profile_region_group_option",
                    label: "Verification region group",
                    externalValue: ids.regionGroup,
                  },
                ],
              },
              {
                id: "profile_operational_region",
                kind: "dropdown",
                prompt: "Operational region",
                required: true,
                optionSource: "coordination_operational_regions",
                options: [
                  {
                    id: "profile_operational_region_option",
                    label: "Verification operational region",
                    externalValue: ids.region,
                    parentExternalValue: ids.regionGroup,
                  },
                ],
              },
            ],
          },
        ],
      },
    })
    .where("id", "=", ids.surveyVersion)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("registration_questionnaire_assignment")
    .set({ status: "in_progress", startedAt: now, completedAt: null })
    .where("id", "=", questionnaire.assignmentId)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("registration_questionnaire_response")
    .set({
      answers: JSON.stringify({
        profile_region_group: "profile_region_group_option",
        profile_operational_region: "profile_operational_region_option",
      }),
      visitedItemIds: JSON.stringify([
        "profile_region_group",
        "profile_operational_region",
      ]),
      currentItemId: "profile_region_group",
      submittedAt: null,
      profileUpdateAcceptedAt: null,
    })
    .where("assignmentId", "=", questionnaire.assignmentId)
    .executeTakeFirstOrThrow();
  assert.equal(
    (
      await advanceRegistrationQuestionnaire(
        {
          assignmentId: questionnaire.assignmentId,
          itemId: "profile_region_group",
        },
        user,
      )
    ).status,
    "advanced",
    "Changing a region group must require its dependent region again",
  );
  assert.deepEqual(
    await database
      .selectFrom("registration_questionnaire_response")
      .select(["answers", "visitedItemIds", "currentItemId", "submittedAt"])
      .where("assignmentId", "=", questionnaire.assignmentId)
      .executeTakeFirstOrThrow(),
    {
      answers: {},
      visitedItemIds: ["profile_region_group"],
      currentItemId: "profile_operational_region",
      submittedAt: null,
    },
    "An invalidated operational-region answer must no longer count as visited",
  );

  await database
    .updateTable("survey_version")
    .set({
      content: {
        title: "Branching registration profile",
        description: "Confirm your registration details.",
        sections: [
          {
            id: "branch_profile_section",
            title: "Profile",
            description: "",
            items: [
              {
                id: "branch_profile_name",
                kind: "short_text",
                prompt: "Current name",
                required: true,
                maximumLength: 200,
                format: "plain",
                profileField: "name",
              },
              {
                id: "branch_route",
                kind: "single_choice",
                prompt: "Registration route",
                required: true,
                options: [
                  { id: "long", label: "Detailed" },
                  {
                    id: "short",
                    label: "Short",
                    nextSectionId: "branch_final_section",
                  },
                ],
              },
            ],
          },
          {
            id: "branch_detail_section",
            title: "Details",
            description: "",
            items: [
              {
                id: "branch_discipline",
                kind: "short_text",
                prompt: "Discipline",
                required: false,
                maximumLength: 200,
                format: "plain",
              },
            ],
          },
          {
            id: "branch_final_section",
            title: "Review",
            description: "",
            items: [
              {
                id: "branch_review",
                kind: "instruction",
                title: "Ready to submit",
                body: "Review your profile update choice before submitting.",
              },
            ],
          },
        ],
      },
    })
    .where("id", "=", ids.surveyVersion)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("registration_questionnaire_assignment")
    .set({ status: "in_progress", startedAt: now, completedAt: null })
    .where("id", "=", questionnaire.assignmentId)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("registration_questionnaire_response")
    .set({
      answers: JSON.stringify({
        branch_profile_name: "Branch Profile Name",
        branch_route: "long",
        branch_discipline: "Nursing",
      }),
      visitedItemIds: JSON.stringify([
        "branch_profile_name",
        "branch_route",
        "branch_discipline",
        "branch_review",
      ]),
      currentItemId: "branch_route",
      submittedAt: null,
      profileUpdateAcceptedAt: null,
    })
    .where("assignmentId", "=", questionnaire.assignmentId)
    .executeTakeFirstOrThrow();
  const shortenedBranch = await advanceRegistrationQuestionnaire(
    {
      assignmentId: questionnaire.assignmentId,
      itemId: "branch_route",
      answer: "short",
    },
    user,
  );
  assert.equal(
    shortenedBranch.status,
    "advanced",
    "A shortened profile-aware path must pause for an explicit profile update choice",
  );
  assert.equal(shortenedBranch.progress.currentItemId, "branch_review");
  assert.deepEqual(
    await database
      .selectFrom("registration_questionnaire_assignment as assignment")
      .innerJoin(
        "registration_questionnaire_response as response",
        "response.assignmentId",
        "assignment.id",
      )
      .select(["assignment.status", "response.submittedAt"])
      .where("assignment.id", "=", questionnaire.assignmentId)
      .executeTakeFirstOrThrow(),
    { status: "in_progress", submittedAt: null },
  );
  assert.equal(
    (
      await advanceRegistrationQuestionnaire(
        {
          assignmentId: questionnaire.assignmentId,
          itemId: "branch_review",
          profileUpdateAccepted: false,
        },
        user,
      )
    ).status,
    "submitted",
    "The explicit review step must complete after the profile update choice",
  );

  const updatedEventLearnerName = "Updated Event Learner";
  await database
    .updateTable("survey_version")
    .set({
      content: {
        title: "Event registration profile",
        description: "Confirm your name.",
        sections: [
          {
            id: "event_profile_section",
            title: "Profile",
            description: "",
            items: [
              {
                id: "event_profile_name",
                kind: "short_text",
                prompt: "Current name",
                required: true,
                maximumLength: 200,
                format: "plain",
                profileField: "name",
              },
            ],
          },
        ],
      },
    })
    .where("id", "=", ids.eventSurveyVersion)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("event_occurrence")
    .set({ capacity: 10, confirmedCount: 0 })
    .where("id", "=", ids.eventOccurrence)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("registration_questionnaire_assignment")
    .set({ status: "assigned", startedAt: null, completedAt: null })
    .where("id", "=", zeroRegionQuestionnaire.assignmentId)
    .executeTakeFirstOrThrow();
  await database
    .updateTable("registration_questionnaire_response")
    .set({
      answers: JSON.stringify({}),
      visitedItemIds: JSON.stringify([]),
      currentItemId: "event_profile_name",
      submittedAt: null,
      profileUpdateAcceptedAt: null,
    })
    .where("assignmentId", "=", zeroRegionQuestionnaire.assignmentId)
    .executeTakeFirstOrThrow();
  assert.equal(
    (
      await advanceRegistrationQuestionnaire(
        {
          assignmentId: zeroRegionQuestionnaire.assignmentId,
          itemId: "event_profile_name",
          answer: updatedEventLearnerName,
          profileUpdateAccepted: true,
        },
        otherUser,
      )
    ).status,
    "submitted",
  );
  assert.equal(
    await database
      .selectFrom("user")
      .select("name")
      .where("id", "=", otherUser.id)
      .executeTakeFirstOrThrow()
      .then((profile) => profile.name),
    updatedEventLearnerName,
  );
  const ordinaryRegistration = await database
    .selectFrom("event_registration")
    .select(["id", "nameSnapshot"])
    .where("eventOccurrenceId", "=", ids.eventOccurrence)
    .where("userId", "=", otherUser.id)
    .executeTakeFirstOrThrow();
  assert.equal(
    ordinaryRegistration.nameSnapshot,
    updatedEventLearnerName,
    "Ordinary registration must snapshot a consented profile update",
  );
  assert.equal(
    await database
      .selectFrom("event_participation")
      .select("nameSnapshot")
      .where("registrationId", "=", ordinaryRegistration.id)
      .executeTakeFirstOrThrow()
      .then((participation) => participation.nameSnapshot),
    updatedEventLearnerName,
    "Event participation must snapshot a consented profile update",
  );

  console.log(
    "Verified Course and Event questionnaire pinning, enrolment revalidation, atomic Event registration, optional and required region mapping, pre-existing paid registration, prefill, consent, completion gating, answer visibility and audited waiver",
  );
} finally {
  await cleanup();
  await database.destroy();
}
