import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import {
  surveyAnswerValueSchema,
  parseSurveyVersionContent,
  type LearnerSurvey,
  type LearnerSurveyProgress,
  type LearnerSurveyStep,
  type LearnerSurveyStepResult,
  type SurveyAnswerValue,
  type SurveyItem,
  type SurveyQuestion,
  type SurveyVersionContent,
} from "#/features/survey/survey.schema";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import { completeEnrollmentIfReady } from "#/server/learning/learning-completion.server";
import { logServerEvent } from "#/server/logging/server-logger";

export interface StoredProgress {
  answers: Record<string, SurveyAnswerValue>;
  visitedItemIds: Array<string>;
  currentItemId: string | null;
  completedAt: Date | null;
}

export function flattenedItems(
  content: SurveyVersionContent,
): Array<SurveyItem> {
  return content.sections.flatMap((section) => section.items);
}

export function storedAnswers(
  value: unknown,
): Record<string, SurveyAnswerValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const answers: Record<string, SurveyAnswerValue> = {};
  for (const [questionId, answer] of Object.entries(value)) {
    const parsed = surveyAnswerValueSchema.safeParse(answer);
    if (parsed.success) answers[questionId] = parsed.data;
  }
  return answers;
}

export function storedVisited(value: unknown): Array<string> {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((itemId): itemId is string => typeof itemId === "string"),
    ),
  ];
}

export function deriveProgress(
  content: SurveyVersionContent,
  stored: StoredProgress | null,
): LearnerSurveyProgress {
  const items = flattenedItems(content);
  const validItemIds = new Set(items.map((item) => item.id));
  const visitedItemIds = (stored?.visitedItemIds ?? []).filter((itemId) =>
    validItemIds.has(itemId),
  );
  const visited = new Set(visitedItemIds);
  const completedItems = visited.size;
  const totalItems = items.length;
  return {
    answers: stored?.answers ?? {},
    visitedItemIds,
    currentItemId:
      stored?.completedAt || totalItems === 0
        ? null
        : stored?.currentItemId && validItemIds.has(stored.currentItemId)
          ? stored.currentItemId
          : (items.find((item) => !visited.has(item.id))?.id ?? null),
    completedAt: stored?.completedAt?.toISOString() ?? null,
    completedItems,
    totalItems,
    percent:
      totalItems === 0 ? 0 : Math.round((completedItems / totalItems) * 100),
    sections: content.sections.map((section) => {
      const sectionCompleted = section.items.filter((item) =>
        visited.has(item.id),
      ).length;
      const sectionTotal = section.items.length;
      return {
        id: section.id,
        completedItems: sectionCompleted,
        totalItems: sectionTotal,
        percent:
          sectionTotal === 0
            ? 0
            : Math.round((sectionCompleted / sectionTotal) * 100),
        completed: sectionTotal > 0 && sectionCompleted === sectionTotal,
      };
    }),
  };
}

export function validateAnswer(
  question: SurveyQuestion,
  value: SurveyAnswerValue | undefined,
):
  | { valid: true; answer?: SurveyAnswerValue }
  | { valid: false; message: string } {
  if (question.kind === "short_text" || question.kind === "long_text") {
    if (typeof value === "undefined" || value === "") {
      if (question.required)
        return { valid: false, message: `Answer “${question.prompt}”.` };
      return { valid: true };
    }
    if (typeof value !== "string" || value.length > question.maximumLength)
      return { valid: false, message: `Review “${question.prompt}”.` };
    const normalized = value.trim();
    if (question.required && !normalized)
      return { valid: false, message: `Answer “${question.prompt}”.` };
    if (question.kind === "short_text" && normalized) {
      if (
        question.format === "email" &&
        !zEmailAddress.safeParse(normalized).success
      )
        return {
          valid: false,
          message: `Enter a valid email address for “${question.prompt}”.`,
        };
      if (question.format === "url" && !URL.canParse(normalized))
        return {
          valid: false,
          message: `Enter a valid URL for “${question.prompt}”.`,
        };
      if (
        question.format === "phone" &&
        !/^[+()\d][+()\d .-]{5,30}$/u.test(normalized)
      )
        return {
          valid: false,
          message: `Enter a valid phone number for “${question.prompt}”.`,
        };
    }
    return normalized ? { valid: true, answer: normalized } : { valid: true };
  }

  if (question.kind === "checkbox") {
    if (value === true) return { valid: true, answer: true };
    if (question.required)
      return { valid: false, message: `Confirm “${question.prompt}”.` };
    return value === false ? { valid: true, answer: false } : { valid: true };
  }

  if (question.kind === "number" || question.kind === "rating") {
    if (typeof value === "undefined" || value === "") {
      if (question.required)
        return { valid: false, message: `Answer “${question.prompt}”.` };
      return { valid: true };
    }
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (question.kind === "number" &&
        question.integer &&
        !Number.isInteger(value)) ||
      (question.minimum !== null && value < question.minimum) ||
      (question.maximum !== null && value > question.maximum)
    )
      return { valid: false, message: `Review “${question.prompt}”.` };
    return { valid: true, answer: value };
  }

  if (question.kind === "date") {
    if (typeof value === "undefined" || value === "") {
      if (question.required)
        return { valid: false, message: `Answer “${question.prompt}”.` };
      return { valid: true };
    }
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
      (question.minimum !== null && value < question.minimum) ||
      (question.maximum !== null && value > question.maximum)
    )
      return { valid: false, message: `Review “${question.prompt}”.` };
    return { valid: true, answer: value };
  }

  const optionIds = new Set(question.options.map((option) => option.id));
  if (question.kind === "single_choice" || question.kind === "dropdown") {
    if (typeof value === "undefined" || value === "") {
      if (question.required)
        return {
          valid: false,
          message: `Choose an answer for “${question.prompt}”.`,
        };
      return { valid: true };
    }
    if (typeof value !== "string" || !optionIds.has(value))
      return {
        valid: false,
        message: `Choose an answer for “${question.prompt}”.`,
      };
    return { valid: true, answer: value };
  }

  if (typeof value === "undefined") {
    if (question.required)
      return {
        valid: false,
        message: `Choose an answer for “${question.prompt}”.`,
      };
    return { valid: true };
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
  return unique.length > 0 ? { valid: true, answer: unique } : { valid: true };
}

const zEmailAddress = {
  safeParse(value: string): { success: boolean } {
    return {
      success: /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value),
    };
  },
};

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
      "course_version_item.learningActivityVersionId",
    )
    .innerJoin(
      "learning_activity_version",
      "learning_activity_version.id",
      "survey_version.id",
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
    .leftJoin("survey_progress", (join) =>
      join
        .onRef("survey_progress.enrollmentId", "=", "enrollment.id")
        .onRef(
          "survey_progress.courseVersionItemId",
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
      "learning_activity_version.publishedAt",
      "survey_response.answers as responseAnswers",
      "survey_response.submittedAt",
      "survey_progress.answers as progressAnswers",
      "survey_progress.visitedItemIds",
      "survey_progress.currentItemId",
      "survey_progress.completedAt as progressCompletedAt",
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
  const content = parseSurveyVersionContent(row.content);
  const completedItems = flattenedItems(content).map((item) => item.id);
  const stored: StoredProgress | null = row.submittedAt
    ? {
        answers: storedAnswers(row.responseAnswers),
        visitedItemIds: completedItems,
        currentItemId: null,
        completedAt: row.progressCompletedAt ?? row.submittedAt,
      }
    : row.progressAnswers
      ? {
          answers: storedAnswers(row.progressAnswers),
          visitedItemIds: storedVisited(row.visitedItemIds),
          currentItemId: row.currentItemId,
          completedAt: row.progressCompletedAt,
        }
      : null;
  return {
    enrollmentId: row.enrollmentId,
    courseVersionItemId: row.courseVersionItemId,
    courseTitle: row.courseTitle,
    sectionTitle: row.sectionTitle,
    surveyVersionId: row.surveyVersionId,
    content,
    progress: deriveProgress(content, stored),
    submittedAt: row.submittedAt?.toISOString() ?? null,
  };
}

export async function advanceLearnerSurvey(
  input: LearnerSurveyStep,
  user: AuthenticatedUser,
): Promise<LearnerSurveyStepResult> {
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
        "course_version_item.learningActivityVersionId",
      )
      .innerJoin(
        "learning_activity_version",
        "learning_activity_version.id",
        "survey_version.id",
      )
      .select([
        "enrollment.id as enrollmentId",
        "enrollment.courseVersionId",
        "course_version_item.id as itemId",
        "survey_version.id as surveyVersionId",
        "survey_version.content",
        "learning_activity_version.publishedAt",
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

    const content = parseSurveyVersionContent(row.content);
    const items = flattenedItems(content);
    const submittedResponse = await transaction
      .selectFrom("survey_response")
      .select(["answers", "submittedAt"])
      .where("enrollmentId", "=", input.enrollmentId)
      .where("courseVersionItemId", "=", input.courseVersionItemId)
      .executeTakeFirst();
    if (submittedResponse) {
      const progress = deriveProgress(content, {
        answers: storedAnswers(submittedResponse.answers),
        visitedItemIds: items.map((item) => item.id),
        currentItemId: null,
        completedAt: submittedResponse.submittedAt,
      });
      return {
        status: "submitted",
        progress,
        completedCourse: false,
      } as const;
    }

    const persisted = await transaction
      .selectFrom("survey_progress")
      .select(["answers", "visitedItemIds", "currentItemId", "completedAt"])
      .where("enrollmentId", "=", input.enrollmentId)
      .where("courseVersionItemId", "=", input.courseVersionItemId)
      .forUpdate()
      .executeTakeFirst();
    const stored: StoredProgress = persisted
      ? {
          answers: storedAnswers(persisted.answers),
          visitedItemIds: storedVisited(persisted.visitedItemIds),
          currentItemId: persisted.currentItemId,
          completedAt: persisted.completedAt,
        }
      : {
          answers: {},
          visitedItemIds: [],
          currentItemId: items[0]?.id ?? null,
          completedAt: null,
        };
    const itemIndex = items.findIndex((item) => item.id === input.itemId);
    if (itemIndex < 0)
      return {
        status: "invalid",
        message: "The survey has changed. Refresh and try again.",
      } as const;
    const alreadyVisited = stored.visitedItemIds.includes(input.itemId);
    if (!alreadyVisited && input.itemId !== stored.currentItemId)
      return {
        status: "invalid",
        message: "Complete the current survey item before continuing.",
      } as const;

    const item = items[itemIndex] as SurveyItem;
    let answers = { ...stored.answers };
    if (item.kind === "instruction") {
      if (typeof input.answer !== "undefined")
        return {
          status: "invalid",
          message: "This information block does not require an answer.",
        } as const;
    } else {
      const validation = validateAnswer(item, input.answer);
      if (!validation.valid)
        return { status: "invalid", message: validation.message } as const;
      if (typeof validation.answer === "undefined")
        answers = Object.fromEntries(
          Object.entries(answers).filter(
            ([questionId]) => questionId !== item.id,
          ),
        );
      else answers[item.id] = validation.answer;
    }

    const visitedItemIds = alreadyVisited
      ? stored.visitedItemIds
      : [...stored.visitedItemIds, item.id];
    const currentItemId = alreadyVisited
      ? stored.currentItemId
      : (items[itemIndex + 1]?.id ?? null);
    const completed = visitedItemIds.length === items.length;
    const completedAt = completed ? now : null;

    await transaction
      .insertInto("survey_progress")
      .values({
        id: `survey_progress_${randomUUID()}`,
        enrollmentId: input.enrollmentId,
        courseVersionItemId: input.courseVersionItemId,
        eventParticipationId: null,
        eventTemplateVersionItemId: null,
        surveyVersionId: row.surveyVersionId,
        answers,
        visitedItemIds: JSON.stringify(visitedItemIds),
        currentItemId,
        startedAt: now,
        updatedAt: now,
        completedAt,
      })
      .onConflict((conflict) =>
        conflict
          .columns(["enrollmentId", "courseVersionItemId"])
          .where("enrollmentId", "is not", null)
          .doUpdateSet({
            answers,
            visitedItemIds: JSON.stringify(visitedItemIds),
            currentItemId,
            updatedAt: now,
            completedAt,
          }),
      )
      .execute();

    const progress = deriveProgress(content, {
      answers,
      visitedItemIds,
      currentItemId,
      completedAt,
    });
    if (!completed)
      return { status: "advanced", progress, completedCourse: false } as const;

    await transaction
      .insertInto("survey_response")
      .values({
        id: `survey_response_${randomUUID()}`,
        enrollmentId: input.enrollmentId,
        courseVersionItemId: input.courseVersionItemId,
        eventParticipationId: null,
        eventTemplateVersionItemId: null,
        surveyVersionId: row.surveyVersionId,
        answers,
        submittedAt: now,
      })
      .execute();
    await transaction
      .insertInto("learning_item_progress")
      .values({
        id: `learning_progress_${randomUUID()}`,
        enrollmentId: input.enrollmentId,
        courseVersionItemId: input.courseVersionItemId,
        eventParticipationId: null,
        eventTemplateVersionItemId: null,
        state: "completed",
        completedAt: now,
        updatedAt: now,
      })
      .onConflict((conflict) =>
        conflict
          .columns(["enrollmentId", "courseVersionItemId"])
          .where("enrollmentId", "is not", null)
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
    return { status: "submitted", progress, completedCourse } as const;
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
