import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import {
  surveyVersionContentSchema,
  type LearnerSurvey,
  type LearnerSurveySubmission,
  type LearnerSurveySubmissionResult,
  type SurveyVersionContent,
} from "#/features/survey/survey.schema";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import { completeEnrollmentIfReady } from "#/server/learning/learning-completion.server";
import { logServerEvent } from "#/server/logging/server-logger";

function validateAnswers(
  content: SurveyVersionContent,
  submitted: LearnerSurveySubmission["answers"],
):
  | { valid: true; answers: Record<string, string | Array<string>> }
  | {
      valid: false;
      message: string;
    } {
  const submittedByQuestion = new Map(
    submitted.map((answer) => [answer.questionId, answer.value]),
  );
  const questionIds = new Set(content.questions.map((question) => question.id));
  if (submitted.some((answer) => !questionIds.has(answer.questionId)))
    return {
      valid: false,
      message: "The survey questions have changed. Refresh and try again.",
    };

  const answers: Record<string, string | Array<string>> = {};
  for (const question of content.questions) {
    const value = submittedByQuestion.get(question.id);
    if (typeof value === "undefined") {
      if (question.required)
        return { valid: false, message: `Answer “${question.prompt}”.` };
      continue;
    }
    if (question.kind === "text") {
      if (typeof value !== "string" || value.length > question.maximumLength)
        return { valid: false, message: `Review “${question.prompt}”.` };
      const normalized = value.trim();
      if (question.required && !normalized)
        return { valid: false, message: `Answer “${question.prompt}”.` };
      if (normalized) answers[question.id] = normalized;
      continue;
    }
    const optionIds = new Set(question.options.map((option) => option.id));
    if (question.kind === "single_choice") {
      if (value === "" && !question.required) continue;
      if (typeof value !== "string" || !optionIds.has(value))
        return {
          valid: false,
          message: `Choose an answer for “${question.prompt}”.`,
        };
      answers[question.id] = value;
      continue;
    }
    if (!Array.isArray(value))
      return { valid: false, message: `Review “${question.prompt}”.` };
    const unique = [...new Set(value)];
    if (
      unique.some((optionId) => !optionIds.has(optionId)) ||
      (question.required && unique.length === 0)
    )
      return {
        valid: false,
        message: `Choose an answer for “${question.prompt}”.`,
      };
    if (unique.length > 0) answers[question.id] = unique;
  }
  return { valid: true, answers };
}

export async function findLearnerSurvey(
  enrollmentId: string,
  courseVersionItemId: string,
  user: AuthenticatedUser,
): Promise<LearnerSurvey | null | "unavailable"> {
  const database = getDatabase();
  const now = new Date();
  const row = await database
    .selectFrom("enrollment")
    .innerJoin(
      "course_version",
      "course_version.id",
      "enrollment.courseVersionId",
    )
    .innerJoin("course", "course.id", "course_version.courseId")
    .innerJoin(
      "course_version_item",
      "course_version_item.courseVersionId",
      "enrollment.courseVersionId",
    )
    .innerJoin(
      "course_version_section",
      "course_version_section.id",
      "course_version_item.sectionId",
    )
    .innerJoin(
      "survey_version",
      "survey_version.id",
      "course_version_item.surveyVersionId",
    )
    .leftJoin("survey_response", (join) =>
      join
        .onRef("survey_response.enrollmentId", "=", "enrollment.id")
        .onRef(
          "survey_response.courseVersionItemId",
          "=",
          "course_version_item.id",
        ),
    )
    .select([
      "enrollment.id as enrollmentId",
      "course.title as courseTitle",
      "course_version_item.id as courseVersionItemId",
      "course_version_section.title as sectionTitle",
      "survey_version.id as surveyVersionId",
      "survey_version.content",
      "survey_version.publishedAt",
      "survey_response.submittedAt",
    ])
    .where("enrollment.id", "=", enrollmentId)
    .where("enrollment.userId", "=", user.id)
    .where("enrollment.removedAt", "is", null)
    .where("enrollment.status", "in", ["active", "completed"])
    .where((expression) =>
      expression.or([
        expression("enrollment.expiresAt", "is", null),
        expression("enrollment.expiresAt", ">", now),
      ]),
    )
    .where("course_version_item.id", "=", courseVersionItemId)
    .where("course_version_item.kind", "=", "survey")
    .executeTakeFirst();
  if (!row) return null;
  if (!row.publishedAt) return "unavailable";
  return {
    enrollmentId: row.enrollmentId,
    courseVersionItemId: row.courseVersionItemId,
    courseTitle: row.courseTitle,
    sectionTitle: row.sectionTitle,
    surveyVersionId: row.surveyVersionId,
    content: surveyVersionContentSchema.parse(row.content),
    submittedAt: row.submittedAt?.toISOString() ?? null,
  };
}

export async function submitLearnerSurvey(
  input: LearnerSurveySubmission,
  user: AuthenticatedUser,
): Promise<LearnerSurveySubmissionResult> {
  const database = getDatabase();
  const now = new Date();
  const outcome = await database.transaction().execute(async (transaction) => {
    const row = await transaction
      .selectFrom("enrollment")
      .innerJoin(
        "course_version_item",
        "course_version_item.courseVersionId",
        "enrollment.courseVersionId",
      )
      .innerJoin(
        "survey_version",
        "survey_version.id",
        "course_version_item.surveyVersionId",
      )
      .select([
        "enrollment.id as enrollmentId",
        "enrollment.courseVersionId",
        "course_version_item.id as itemId",
        "survey_version.id as surveyVersionId",
        "survey_version.content",
        "survey_version.publishedAt",
      ])
      .where("enrollment.id", "=", input.enrollmentId)
      .where("enrollment.userId", "=", user.id)
      .where("enrollment.removedAt", "is", null)
      .where("enrollment.status", "in", ["active", "completed"])
      .where((expression) =>
        expression.or([
          expression("enrollment.expiresAt", "is", null),
          expression("enrollment.expiresAt", ">", now),
        ]),
      )
      .where("course_version_item.id", "=", input.courseVersionItemId)
      .where("course_version_item.kind", "=", "survey")
      .forUpdate("enrollment")
      .executeTakeFirst();
    if (!row) return { status: "not-found" } as const;
    if (!row.publishedAt) return { status: "unavailable" } as const;
    const existing = await transaction
      .selectFrom("survey_response")
      .select("id")
      .where("enrollmentId", "=", input.enrollmentId)
      .where("courseVersionItemId", "=", input.courseVersionItemId)
      .executeTakeFirst();
    if (existing)
      return { status: "submitted", completedCourse: false } as const;

    const content = surveyVersionContentSchema.parse(row.content);
    const validation = validateAnswers(content, input.answers);
    if (!validation.valid)
      return { status: "invalid", message: validation.message } as const;
    await transaction
      .insertInto("survey_response")
      .values({
        id: `survey_response_${randomUUID()}`,
        enrollmentId: input.enrollmentId,
        courseVersionItemId: input.courseVersionItemId,
        surveyVersionId: row.surveyVersionId,
        answers: validation.answers,
        submittedAt: now,
      })
      .execute();
    await transaction
      .insertInto("learning_item_progress")
      .values({
        enrollmentId: input.enrollmentId,
        courseVersionItemId: input.courseVersionItemId,
        state: "completed",
        completedAt: now,
        updatedAt: now,
      })
      .onConflict((conflict) =>
        conflict
          .columns(["enrollmentId", "courseVersionItemId"])
          .doUpdateSet({ state: "completed", updatedAt: now }),
      )
      .execute();
    const completedCourse = await completeEnrollmentIfReady(
      transaction,
      {
        enrollmentId: input.enrollmentId,
        courseVersionId: row.courseVersionId,
        source: "survey",
      },
      now,
    );
    return { status: "submitted", completedCourse } as const;
  });
  if (outcome.status === "submitted")
    logServerEvent({
      level: "info",
      event: "survey.response_submitted",
      fields: {
        actorUserId: user.id,
        entityType: "course_version_item",
        entityId: input.courseVersionItemId,
        enrollmentId: input.enrollmentId,
        outcome: "succeeded",
      },
    });
  return outcome;
}
