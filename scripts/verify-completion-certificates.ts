import assert from "node:assert/strict";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import {
  getLearnerCompletionCertificate,
  getLearnerEventCompletionCertificate,
} from "#/server/certificate/learner-certificate.server";
import { destroyDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import {
  findLearnerDashboard,
  findLearnerEventsDashboard,
} from "#/server/learner/learner.server";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const ids = {
  learner: "verify_certificate_learner",
  otherUser: "verify_certificate_other",
  course: "verify_certificate_course",
  courseVersion: "verify_certificate_course_version",
  enrollment: "verify_certificate_enrollment",
  eventTemplate: "verify_certificate_event_template",
  eventTemplateVersion: "verify_certificate_event_template_version",
  eventOccurrence: "verify_certificate_event_occurrence",
  eventRegistration: "verify_certificate_event_registration",
  eventParticipation: "verify_certificate_event_participation",
  survey: "verify_certificate_registration_survey",
  surveyVersion: "verify_certificate_registration_survey_version",
  questionnaireAssignment: "verify_certificate_questionnaire_assignment",
  questionnaireResponse: "verify_certificate_questionnaire_response",
  courseQuestionnaireAssignment:
    "verify_certificate_course_questionnaire_assignment",
  courseQuestionnaireResponse:
    "verify_certificate_course_questionnaire_response",
};
const learner: AuthenticatedUser = {
  id: ids.learner,
  name: "Certificate Learner",
  email: "certificate-learner@example.com",
  emailVerified: true,
};
const otherUser: AuthenticatedUser = {
  id: ids.otherUser,
  name: "Other Learner",
  email: "certificate-other@example.com",
  emailVerified: true,
};
const database = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});

async function cleanup(): Promise<void> {
  await database
    .deleteFrom("registration_questionnaire_response")
    .where("id", "in", [
      ids.questionnaireResponse,
      ids.courseQuestionnaireResponse,
    ])
    .execute();
  await database
    .deleteFrom("registration_questionnaire_assignment")
    .where("id", "in", [
      ids.questionnaireAssignment,
      ids.courseQuestionnaireAssignment,
    ])
    .execute();
  await database
    .deleteFrom("event_participation")
    .where("id", "=", ids.eventParticipation)
    .execute();
  await database
    .deleteFrom("event_registration")
    .where("id", "=", ids.eventRegistration)
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
    .deleteFrom("enrollment")
    .where("id", "=", ids.enrollment)
    .execute();
  await database
    .deleteFrom("course_version")
    .where("id", "=", ids.courseVersion)
    .execute();
  await database.deleteFrom("course").where("id", "=", ids.course).execute();
  await database
    .deleteFrom("survey_version")
    .where("id", "=", ids.surveyVersion)
    .execute();
  await database
    .deleteFrom("learning_activity_version")
    .where("id", "=", ids.surveyVersion)
    .execute();
  await database
    .deleteFrom("learning_activity")
    .where("id", "=", ids.survey)
    .execute();
  await database
    .deleteFrom("user")
    .where("id", "in", [ids.learner, ids.otherUser])
    .execute();
}

try {
  await cleanup();
  await database
    .insertInto("user")
    .values([
      { ...learner, image: null, stripeCustomerId: null },
      { ...otherUser, image: null, stripeCustomerId: null },
    ])
    .execute();
  await database
    .insertInto("course")
    .values({
      id: ids.course,
      slug: "verify-completion-certificate",
      title: "Certificate verifier course",
      status: "published",
    })
    .execute();
  await database
    .insertInto("course_version")
    .values({
      id: ids.courseVersion,
      courseId: ids.course,
      version: 1,
      content: {
        title: "Certificate verifier course",
        summary: "Verifies on-demand certificate rendering.",
        description: "Certificate workflow verification fixture.",
        topic: "technology",
        durationMinutes: 15,
        priceCents: 0,
        salePriceCents: null,
        currency: "AUD",
        featured: false,
        listInStore: false,
        hasCompletionCertificate: true,
        prerequisites: [],
        accreditations: [],
        modules: [],
      },
      publishedAt: new Date(),
    })
    .execute();
  const firstCompletedAt = new Date("2026-08-10T01:00:00.000Z");
  await database
    .insertInto("enrollment")
    .values({
      id: ids.enrollment,
      userId: ids.learner,
      courseVersionId: ids.courseVersion,
      accessGrantId: null,
      status: "completed",
      enrolledAt: new Date("2026-08-09T01:00:00.000Z"),
      completedAt: firstCompletedAt,
      expiresAt: null,
      removedAt: null,
    })
    .execute();
  await database
    .insertInto("event_template")
    .values({
      id: ids.eventTemplate,
      title: "Certificate verifier event",
      status: "published",
    })
    .execute();
  await database
    .insertInto("learning_activity")
    .values({
      id: ids.survey,
      kind: "survey",
      title: "Certificate registration details",
      surveyUsage: "registration",
      surveyType: "registration",
      surveyPosition: 0,
      createdAt: firstCompletedAt,
    })
    .execute();
  await database
    .insertInto("learning_activity_version")
    .values({
      id: ids.surveyVersion,
      activityId: ids.survey,
      kind: "survey",
      version: 1,
      publishedAt: firstCompletedAt,
      createdAt: firstCompletedAt,
    })
    .execute();
  await database
    .insertInto("survey_version")
    .values({
      id: ids.surveyVersion,
      content: {
        title: "Certificate registration details",
        description: "Required before Event completion evidence is released.",
        sections: [
          {
            id: "certificate_registration_section",
            title: "Registration details",
            description: "",
            items: [
              {
                id: "certificate_registration_answer",
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
    .updateTable("course_version")
    .set({ registrationSurveyVersionId: ids.surveyVersion })
    .where("id", "=", ids.courseVersion)
    .executeTakeFirstOrThrow();
  await database
    .insertInto("event_template_version")
    .values({
      id: ids.eventTemplateVersion,
      eventTemplateId: ids.eventTemplate,
      version: 1,
      topic: "technology",
      summary: "Verifies event certificate rendering.",
      description: "Event certificate workflow verification fixture.",
      coverImage: null,
      hasCompletionCertificate: true,
      accreditations: JSON.stringify([]),
      registrationSurveyVersionId: ids.surveyVersion,
      publishedAt: firstCompletedAt,
    })
    .execute();
  await database
    .insertInto("event_occurrence")
    .values({
      id: ids.eventOccurrence,
      eventTemplateVersionId: ids.eventTemplateVersion,
      title: "Certificate verifier event",
      slug: "verify-event-completion-certificate",
      status: "published",
      deliveryMode: "virtual",
      registrationMode: "required_unrestricted",
      approvalMode: "automatic",
      timezone: "Australia/Sydney",
      localStartsAt: "2026-08-10T09:00:00",
      localEndsAt: "2026-08-10T10:00:00",
      localRegistrationOpensAt: null,
      localRegistrationClosesAt: null,
      localCoordinatorLockAt: null,
      startsAt: new Date("2026-08-09T23:00:00.000Z"),
      endsAt: firstCompletedAt,
      registrationOpensAt: null,
      registrationClosesAt: null,
      coordinatorLockAt: null,
      capacity: 20,
      priceCents: null,
      salePriceCents: null,
      currency: "AUD",
      bulkPricing: JSON.stringify({ enabled: false, tiers: [] }),
      listInStore: false,
      featured: false,
      venueName: null,
      venueAddress: null,
      virtualJoinUrl: "https://meet.example.test/certificate-verifier",
      publishedAt: new Date("2026-08-01T00:00:00.000Z"),
      createdByUserId: ids.learner,
    })
    .execute();
  await database
    .insertInto("event_registration")
    .values({
      id: ids.eventRegistration,
      eventOccurrenceId: ids.eventOccurrence,
      userId: ids.learner,
      eventOccurrenceRegionId: null,
      reviewRoundId: null,
      nameSnapshot: learner.name,
      emailSnapshot: learner.email,
      source: "paid_checkout",
      eligibilitySource: "paid",
      status: "selected",
      coordinatorPriority: null,
      submittedAt: firstCompletedAt,
      coordinatorDecidedAt: null,
      coordinatorDecidedByUserId: null,
      finalDecidedAt: firstCompletedAt,
      finalDecidedByUserId: ids.learner,
      lockedInAt: firstCompletedAt,
    })
    .execute();
  await database
    .insertInto("event_participation")
    .values({
      id: ids.eventParticipation,
      eventOccurrenceId: ids.eventOccurrence,
      userId: ids.learner,
      registrationId: ids.eventRegistration,
      mode: "registered",
      nameSnapshot: learner.name,
      emailSnapshot: learner.email,
      detailsSubmittedAt: firstCompletedAt,
      joinDisclosedAt: firstCompletedAt,
      checkedInAt: firstCompletedAt,
      completedAt: firstCompletedAt,
      createdAt: new Date("2026-08-09T23:00:00.000Z"),
    })
    .execute();
  await database
    .insertInto("registration_questionnaire_assignment")
    .values({
      id: ids.questionnaireAssignment,
      userId: ids.learner,
      surveyVersionId: ids.surveyVersion,
      eventOccurrenceId: ids.eventOccurrence,
      eventOccurrenceRegionId: null,
      enrollmentId: null,
      status: "assigned",
      assignedAt: firstCompletedAt,
      startedAt: null,
      completedAt: null,
      waivedAt: null,
      waivedByUserId: null,
      waiverReason: null,
    })
    .execute();
  await database
    .insertInto("registration_questionnaire_response")
    .values({
      id: ids.questionnaireResponse,
      assignmentId: ids.questionnaireAssignment,
      surveyVersionId: ids.surveyVersion,
      answers: JSON.stringify({}),
      visitedItemIds: JSON.stringify([]),
      currentItemId: "certificate_registration_answer",
      startedAt: firstCompletedAt,
      updatedAt: firstCompletedAt,
      submittedAt: null,
      profileUpdateAcceptedAt: null,
      redactedAt: null,
    })
    .execute();
  await database
    .insertInto("registration_questionnaire_assignment")
    .values({
      id: ids.courseQuestionnaireAssignment,
      userId: ids.learner,
      surveyVersionId: ids.surveyVersion,
      eventOccurrenceId: null,
      eventOccurrenceRegionId: null,
      enrollmentId: ids.enrollment,
      status: "assigned",
      assignedAt: firstCompletedAt,
      startedAt: null,
      completedAt: null,
      waivedAt: null,
      waivedByUserId: null,
      waiverReason: null,
    })
    .execute();
  await database
    .insertInto("registration_questionnaire_response")
    .values({
      id: ids.courseQuestionnaireResponse,
      assignmentId: ids.courseQuestionnaireAssignment,
      surveyVersionId: ids.surveyVersion,
      answers: JSON.stringify({}),
      visitedItemIds: JSON.stringify([]),
      currentItemId: "certificate_registration_answer",
      startedAt: firstCompletedAt,
      updatedAt: firstCompletedAt,
      submittedAt: null,
      profileUpdateAcceptedAt: null,
      redactedAt: null,
    })
    .execute();

  let dashboard = await findLearnerDashboard(learner);
  assert.equal(dashboard.courses[0]?.registrationRequired, true);
  assert.equal(dashboard.courses[0].certificate, null);
  assert.deepEqual(
    await getLearnerCompletionCertificate(ids.enrollment, learner),
    { status: "not-found" },
    "A required registration questionnaire must gate Course certificate access",
  );
  await database
    .updateTable("registration_questionnaire_assignment")
    .set({
      status: "waived",
      waivedAt: firstCompletedAt,
      waivedByUserId: ids.learner,
      waiverReason: "Course certificate verification waiver",
    })
    .where("id", "=", ids.courseQuestionnaireAssignment)
    .executeTakeFirstOrThrow();
  dashboard = await findLearnerDashboard(learner);
  assert.equal(dashboard.courses[0]?.registrationRequired, false);
  assert.deepEqual(dashboard.courses[0].certificate, {
    enrollmentId: ids.enrollment,
  });

  const generated = await getLearnerCompletionCertificate(
    ids.enrollment,
    learner,
  );
  assert.equal(generated.status, "generated");
  assert.equal(new TextDecoder().decode(generated.bytes.slice(0, 5)), "%PDF-");
  assert.equal(
    generated.displayName,
    "Certificate-verifier-course-completion-certificate.pdf",
  );
  assert.deepEqual(
    await getLearnerCompletionCertificate(ids.enrollment, otherUser),
    { status: "not-found" },
  );
  let eventDashboard = await findLearnerEventsDashboard(learner);
  assert.equal(eventDashboard.events[0]?.registrationRequired, true);
  assert.equal(eventDashboard.events[0].certificate, null);
  assert.deepEqual(
    await getLearnerEventCompletionCertificate(ids.eventParticipation, learner),
    { status: "not-found" },
    "A required registration questionnaire must gate Event certificate access",
  );
  await database
    .updateTable("registration_questionnaire_assignment")
    .set({
      status: "waived",
      waivedAt: firstCompletedAt,
      waivedByUserId: ids.learner,
      waiverReason: "Certificate verification waiver",
    })
    .where("id", "=", ids.questionnaireAssignment)
    .executeTakeFirstOrThrow();
  eventDashboard = await findLearnerEventsDashboard(learner);
  assert.equal(eventDashboard.events[0]?.registrationRequired, false);
  assert.deepEqual(eventDashboard.events[0].certificate, {
    eventParticipationId: ids.eventParticipation,
  });
  const generatedEvent = await getLearnerEventCompletionCertificate(
    ids.eventParticipation,
    learner,
  );
  assert.equal(generatedEvent.status, "generated");
  assert.equal(
    new TextDecoder().decode(generatedEvent.bytes.slice(0, 5)),
    "%PDF-",
  );
  assert.equal(
    generatedEvent.displayName,
    "Certificate-verifier-event-completion-certificate.pdf",
  );
  assert.deepEqual(
    await getLearnerEventCompletionCertificate(
      ids.eventParticipation,
      otherUser,
    ),
    { status: "not-found" },
  );

  await database
    .updateTable("enrollment")
    .set({ status: "active", completedAt: null })
    .where("id", "=", ids.enrollment)
    .executeTakeFirstOrThrow();
  dashboard = await findLearnerDashboard(learner);
  assert.equal(dashboard.courses[0]?.certificate, null);
  assert.deepEqual(
    await getLearnerCompletionCertificate(ids.enrollment, learner),
    { status: "not-found" },
  );
  await database
    .updateTable("event_participation")
    .set({ completedAt: null })
    .where("id", "=", ids.eventParticipation)
    .executeTakeFirstOrThrow();
  eventDashboard = await findLearnerEventsDashboard(learner);
  assert.equal(eventDashboard.events[0]?.certificate, null);
  assert.deepEqual(
    await getLearnerEventCompletionCertificate(ids.eventParticipation, learner),
    { status: "not-found" },
  );

  await database
    .updateTable("enrollment")
    .set({
      status: "completed",
      completedAt: new Date("2026-08-10T02:00:00.000Z"),
    })
    .where("id", "=", ids.enrollment)
    .executeTakeFirstOrThrow();
  assert.equal(
    (await getLearnerCompletionCertificate(ids.enrollment, learner)).status,
    "generated",
  );
  await database
    .updateTable("event_participation")
    .set({ completedAt: new Date("2026-08-10T02:00:00.000Z") })
    .where("id", "=", ids.eventParticipation)
    .executeTakeFirstOrThrow();
  assert.equal(
    (
      await getLearnerEventCompletionCertificate(
        ids.eventParticipation,
        learner,
      )
    ).status,
    "generated",
  );

  const certificateTables = await sql<{ table_name: string }>`select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'completion_certificate'`.execute(database);
  assert.equal(certificateTables.rows.length, 0);

  console.log(
    "Verified authorization-scoped course and event certificate rendering, learner dashboard eligibility, and immediate completion revocation/recompletion behavior",
  );
} finally {
  await cleanup();
  await destroyDatabase();
  await database.destroy();
}
