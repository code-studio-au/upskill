import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import type { RegistrationQuestionnaireAdminDetail } from "#/features/registration/admin-registration-questionnaire.schema";
import { parseSurveyVersionContent } from "#/features/survey/survey.schema";
import {
  registrationAnswerText,
  registrationQuestions,
} from "#/features/registration/registration-questionnaire-domain";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { storedAnswers } from "#/server/learning/learner-survey.server";
import { logServerEvent } from "#/server/logging/server-logger";

type Target =
  | { kind: "course"; enrollmentId: string }
  | { kind: "event"; eventOccurrenceId: string; userId: string };

interface ConfiguredTarget {
  target: Target;
  userId: string;
  surveyVersionId: string | null;
}

async function findAssignmentDetail(
  configured: ConfiguredTarget,
): Promise<RegistrationQuestionnaireAdminDetail> {
  if (!configured.surveyVersionId)
    return {
      status: "not_required",
      surveyTitle: null,
      surveyVersion: null,
      assignedAt: null,
      completedAt: null,
      waivedAt: null,
      waivedByName: null,
      waiverReason: null,
      profileUpdateAccepted: false,
      answers: [],
    };
  const database = getDatabase();
  const survey = await database
    .selectFrom("survey_version")
    .innerJoin(
      "learning_activity_version",
      "learning_activity_version.id",
      "survey_version.id",
    )
    .innerJoin(
      "learning_activity",
      "learning_activity.id",
      "learning_activity_version.activityId",
    )
    .select([
      "learning_activity.title",
      "learning_activity_version.version",
      "survey_version.content",
    ])
    .where("survey_version.id", "=", configured.surveyVersionId)
    .executeTakeFirstOrThrow();
  let query = database
    .selectFrom("registration_questionnaire_assignment as assignment")
    .leftJoin(
      "registration_questionnaire_response as response",
      "response.assignmentId",
      "assignment.id",
    )
    .leftJoin("user as waived_by", "waived_by.id", "assignment.waivedByUserId")
    .select([
      "assignment.status",
      "assignment.assignedAt",
      "assignment.completedAt",
      "assignment.waivedAt",
      "assignment.waiverReason",
      "waived_by.name as waivedByName",
      "response.answers",
      "response.profileUpdateAcceptedAt",
    ])
    .where("assignment.userId", "=", configured.userId);
  query =
    configured.target.kind === "course"
      ? query.where(
          "assignment.enrollmentId",
          "=",
          configured.target.enrollmentId,
        )
      : query.where(
          "assignment.eventOccurrenceId",
          "=",
          configured.target.eventOccurrenceId,
        );
  const assignment = await query.executeTakeFirst();
  if (!assignment)
    return {
      status: "not_started",
      surveyTitle: survey.title,
      surveyVersion: survey.version,
      assignedAt: null,
      completedAt: null,
      waivedAt: null,
      waivedByName: null,
      waiverReason: null,
      profileUpdateAccepted: false,
      answers: [],
    };
  const content = parseSurveyVersionContent(survey.content);
  const answers = storedAnswers(assignment.answers);
  return {
    status: assignment.status,
    surveyTitle: survey.title,
    surveyVersion: survey.version,
    assignedAt: assignment.assignedAt.toISOString(),
    completedAt: assignment.completedAt?.toISOString() ?? null,
    waivedAt: assignment.waivedAt?.toISOString() ?? null,
    waivedByName: assignment.waivedByName,
    waiverReason: assignment.waiverReason,
    profileUpdateAccepted: assignment.profileUpdateAcceptedAt !== null,
    answers:
      assignment.status === "completed"
        ? registrationQuestions(content).flatMap((question) => {
            const answer = answers[question.id];
            return typeof answer === "undefined"
              ? []
              : [
                  {
                    questionId: question.id,
                    prompt: question.prompt,
                    answer: registrationAnswerText(question, answer),
                  },
                ];
          })
        : [],
  };
}

export async function findCourseRegistrationQuestionnaireAdminDetail(
  courseId: string,
  enrollmentId: string,
): Promise<RegistrationQuestionnaireAdminDetail | null> {
  const configured = await getDatabase()
    .selectFrom("enrollment")
    .innerJoin(
      "course_version",
      "course_version.id",
      "enrollment.courseVersionId",
    )
    .select(["enrollment.userId", "course_version.registrationSurveyVersionId"])
    .where("enrollment.id", "=", enrollmentId)
    .where("course_version.courseId", "=", courseId)
    .executeTakeFirst();
  return configured
    ? await findAssignmentDetail({
        target: { kind: "course", enrollmentId },
        userId: configured.userId,
        surveyVersionId: configured.registrationSurveyVersionId,
      })
    : null;
}

export async function findEventRegistrationQuestionnaireAdminDetail(
  eventOccurrenceId: string,
  registrationId: string,
): Promise<RegistrationQuestionnaireAdminDetail | null> {
  const configured = await getDatabase()
    .selectFrom("event_registration as registration")
    .innerJoin(
      "event_occurrence as occurrence",
      "occurrence.id",
      "registration.eventOccurrenceId",
    )
    .innerJoin(
      "event_template_version as version",
      "version.id",
      "occurrence.eventTemplateVersionId",
    )
    .select(["registration.userId", "version.registrationSurveyVersionId"])
    .where("registration.id", "=", registrationId)
    .where("registration.eventOccurrenceId", "=", eventOccurrenceId)
    .executeTakeFirst();
  return configured
    ? await findAssignmentDetail({
        target: { kind: "event", eventOccurrenceId, userId: configured.userId },
        userId: configured.userId,
        surveyVersionId: configured.registrationSurveyVersionId,
      })
    : null;
}

async function createWaivedAssignment(
  transaction: Transaction<Database>,
  configured: ConfiguredTarget & { surveyVersionId: string },
  reason: string,
  actor: AuthenticatedUser,
): Promise<"waived" | "conflict"> {
  const now = new Date();
  let assignment = await transaction
    .selectFrom("registration_questionnaire_assignment")
    .select(["id", "status"])
    .where("userId", "=", configured.userId)
    .$if(configured.target.kind === "course", (query) =>
      query.where(
        "enrollmentId",
        "=",
        configured.target.kind === "course"
          ? configured.target.enrollmentId
          : "",
      ),
    )
    .$if(configured.target.kind === "event", (query) =>
      query.where(
        "eventOccurrenceId",
        "=",
        configured.target.kind === "event"
          ? configured.target.eventOccurrenceId
          : "",
      ),
    )
    .forUpdate()
    .executeTakeFirst();
  if (assignment?.status === "completed" || assignment?.status === "waived")
    return "conflict";
  if (!assignment) {
    const assignmentId = `registration_questionnaire_assignment_${randomUUID()}`;
    await transaction
      .insertInto("registration_questionnaire_assignment")
      .values({
        id: assignmentId,
        userId: configured.userId,
        surveyVersionId: configured.surveyVersionId,
        eventOccurrenceId:
          configured.target.kind === "event"
            ? configured.target.eventOccurrenceId
            : null,
        eventOccurrenceRegionId: null,
        enrollmentId:
          configured.target.kind === "course"
            ? configured.target.enrollmentId
            : null,
        status: "waived",
        assignedAt: now,
        startedAt: null,
        completedAt: null,
        waivedAt: now,
        waivedByUserId: actor.id,
        waiverReason: reason,
      })
      .execute();
    await transaction
      .insertInto("registration_questionnaire_response")
      .values({
        id: `registration_questionnaire_response_${randomUUID()}`,
        assignmentId,
        surveyVersionId: configured.surveyVersionId,
        answers: JSON.stringify({}),
        visitedItemIds: JSON.stringify([]),
        currentItemId: null,
        startedAt: now,
        updatedAt: now,
        submittedAt: null,
        profileUpdateAcceptedAt: null,
        redactedAt: null,
      })
      .execute();
    assignment = { id: assignmentId, status: "waived" };
  } else
    await transaction
      .updateTable("registration_questionnaire_assignment")
      .set({
        status: "waived",
        completedAt: null,
        waivedAt: now,
        waivedByUserId: actor.id,
        waiverReason: reason,
      })
      .where("id", "=", assignment.id)
      .executeTakeFirstOrThrow();
  if (configured.target.kind === "event")
    await transaction
      .updateTable("event_participation")
      .set({ detailsSubmittedAt: now })
      .where("eventOccurrenceId", "=", configured.target.eventOccurrenceId)
      .where("userId", "=", configured.userId)
      .execute();
  await recordDurableAuditEvent(transaction, {
    actorUserId: actor.id,
    action: "registration_questionnaire.waived",
    subjectType: "registration_questionnaire_assignment",
    subjectId: assignment.id,
    metadata: {
      reason,
      targetKind: configured.target.kind,
      enrollmentId:
        configured.target.kind === "course"
          ? configured.target.enrollmentId
          : null,
      eventOccurrenceId:
        configured.target.kind === "event"
          ? configured.target.eventOccurrenceId
          : null,
      learnerUserId: configured.userId,
    },
    createdAt: now,
  });
  return "waived";
}

export async function waiveCourseRegistrationQuestionnaire(
  courseId: string,
  enrollmentId: string,
  reason: string,
  actor: AuthenticatedUser,
): Promise<"waived" | "not-found" | "conflict"> {
  const outcome = await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const configured = await transaction
        .selectFrom("enrollment")
        .innerJoin(
          "course_version",
          "course_version.id",
          "enrollment.courseVersionId",
        )
        .select([
          "enrollment.userId",
          "course_version.registrationSurveyVersionId",
        ])
        .where("enrollment.id", "=", enrollmentId)
        .where("course_version.courseId", "=", courseId)
        .executeTakeFirst();
      if (!configured?.registrationSurveyVersionId) return "not-found" as const;
      return await createWaivedAssignment(
        transaction,
        {
          target: { kind: "course", enrollmentId },
          userId: configured.userId,
          surveyVersionId: configured.registrationSurveyVersionId,
        },
        reason,
        actor,
      );
    });
  if (outcome === "waived")
    logServerEvent({
      level: "info",
      event: "registration_questionnaire.waived",
      fields: {
        actorUserId: actor.id,
        entityType: "enrollment",
        entityId: enrollmentId,
      },
    });
  return outcome;
}

export async function waiveEventRegistrationQuestionnaire(
  eventOccurrenceId: string,
  registrationId: string,
  reason: string,
  actor: AuthenticatedUser,
): Promise<"waived" | "not-found" | "conflict"> {
  const outcome = await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const configured = await transaction
        .selectFrom("event_registration as registration")
        .innerJoin(
          "event_occurrence as occurrence",
          "occurrence.id",
          "registration.eventOccurrenceId",
        )
        .innerJoin(
          "event_template_version as version",
          "version.id",
          "occurrence.eventTemplateVersionId",
        )
        .select(["registration.userId", "version.registrationSurveyVersionId"])
        .where("registration.id", "=", registrationId)
        .where("registration.eventOccurrenceId", "=", eventOccurrenceId)
        .executeTakeFirst();
      if (!configured?.registrationSurveyVersionId) return "not-found" as const;
      return await createWaivedAssignment(
        transaction,
        {
          target: {
            kind: "event",
            eventOccurrenceId,
            userId: configured.userId,
          },
          userId: configured.userId,
          surveyVersionId: configured.registrationSurveyVersionId,
        },
        reason,
        actor,
      );
    });
  if (outcome === "waived")
    logServerEvent({
      level: "info",
      event: "registration_questionnaire.waived",
      fields: {
        actorUserId: actor.id,
        entityType: "event_registration",
        entityId: registrationId,
      },
    });
  return outcome;
}
