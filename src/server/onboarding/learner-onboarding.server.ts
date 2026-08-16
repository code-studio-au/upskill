import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import {
  onboardingProfileMappingSchema,
  type LearnerOnboarding,
  type LearnerOnboardingStepResult,
} from "#/features/onboarding/onboarding.schema";
import {
  parseSurveyVersionContent,
  type SurveyAnswerValue,
  type SurveyQuestion,
} from "#/features/survey/survey.schema";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import {
  deriveProgress,
  flattenedItems,
  storedAnswers,
  storedVisited,
} from "#/server/learning/learner-survey.server";
import { validateAnswer } from "#/server/learning/survey-answer-validation";
import { logServerEvent } from "#/server/logging/server-logger";
import type { Transaction } from "kysely";
import { z } from "#/validation/zod";

const DEFINITION_ID = "onboarding_definition_default";

async function findAssignment(userId: string): Promise<
  | {
      assignmentId: string;
      privacyNotice: string;
      privacyNoticeVersion: string;
      content: unknown;
      answers: unknown;
      visitedItemIds: unknown;
      currentItemId: string | null;
      startedAt: Date;
      submittedAt: Date | null;
    }
  | "complete"
  | "not-configured"
> {
  const database = getDatabase();
  const existing = await database
    .selectFrom("onboarding_assignment")
    .innerJoin(
      "onboarding_definition_version",
      "onboarding_definition_version.id",
      "onboarding_assignment.definitionVersionId",
    )
    .innerJoin(
      "onboarding_response",
      "onboarding_response.assignmentId",
      "onboarding_assignment.id",
    )
    .innerJoin(
      "survey_version",
      "survey_version.id",
      "onboarding_response.surveyVersionId",
    )
    .select([
      "onboarding_assignment.id as assignmentId",
      "onboarding_definition_version.privacyNotice",
      "onboarding_definition_version.privacyNoticeVersion",
      "survey_version.content",
      "onboarding_response.answers",
      "onboarding_response.visitedItemIds",
      "onboarding_response.currentItemId",
      "onboarding_response.startedAt",
      "onboarding_response.submittedAt",
    ])
    .where("onboarding_assignment.userId", "=", userId)
    .where("onboarding_assignment.status", "in", ["assigned", "in_progress"])
    .executeTakeFirst();
  if (existing) return existing;

  const completed = await database
    .selectFrom("onboarding_assignment")
    .innerJoin(
      "onboarding_definition_version",
      "onboarding_definition_version.id",
      "onboarding_assignment.definitionVersionId",
    )
    .select("onboarding_assignment.id")
    .where("onboarding_assignment.userId", "=", userId)
    .where("onboarding_assignment.status", "=", "completed")
    .where("onboarding_definition_version.definitionId", "=", DEFINITION_ID)
    .executeTakeFirst();
  if (completed) return "complete";

  const active = await database
    .selectFrom("onboarding_definition_version")
    .innerJoin(
      "survey_version",
      "survey_version.id",
      "onboarding_definition_version.surveyVersionId",
    )
    .select([
      "onboarding_definition_version.id",
      "onboarding_definition_version.surveyVersionId",
      "onboarding_definition_version.privacyNotice",
      "onboarding_definition_version.privacyNoticeVersion",
      "survey_version.content",
    ])
    .where("onboarding_definition_version.definitionId", "=", DEFINITION_ID)
    .where("onboarding_definition_version.activatedAt", "is not", null)
    .where("onboarding_definition_version.deactivatedAt", "is", null)
    .executeTakeFirst();
  if (!active) return "not-configured";

  const content = parseSurveyVersionContent(active.content);
  const now = new Date();
  const assignmentId = `onboarding_assignment_${randomUUID()}`;
  const responseId = `onboarding_response_${randomUUID()}`;
  try {
    await database.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("onboarding_assignment")
        .values({
          id: assignmentId,
          userId,
          definitionVersionId: active.id,
          status: "assigned",
          source: "automatic",
          assignedAt: now,
          startedAt: null,
          completedAt: null,
          supersededAt: null,
        })
        .execute();
      await transaction
        .insertInto("onboarding_response")
        .values({
          id: responseId,
          assignmentId,
          surveyVersionId: active.surveyVersionId,
          answers: JSON.stringify({}),
          visitedItemIds: JSON.stringify([]),
          currentItemId: flattenedItems(content)[0]?.id ?? null,
          startedAt: now,
          updatedAt: now,
          submittedAt: null,
          redactedAt: null,
        })
        .execute();
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      return findAssignment(userId);
    throw error;
  }
  return {
    assignmentId,
    privacyNotice: active.privacyNotice,
    privacyNoticeVersion: active.privacyNoticeVersion,
    content: active.content,
    answers: {},
    visitedItemIds: [],
    currentItemId: flattenedItems(content)[0]?.id ?? null,
    startedAt: now,
    submittedAt: null,
  };
}

export async function findLearnerOnboarding(
  user: AuthenticatedUser,
): Promise<LearnerOnboarding | "complete" | "not-configured"> {
  const assignment = await findAssignment(user.id);
  if (assignment === "complete" || assignment === "not-configured")
    return assignment;
  const content = parseSurveyVersionContent(assignment.content);
  const progress = deriveProgress(content, {
    answers: storedAnswers(assignment.answers),
    visitedItemIds: storedVisited(assignment.visitedItemIds),
    currentItemId: assignment.currentItemId,
    completedAt: assignment.submittedAt,
  });
  return {
    assignmentId: assignment.assignmentId,
    privacyNotice: assignment.privacyNotice,
    privacyNoticeVersion: assignment.privacyNoticeVersion,
    content,
    progress,
    submittedAt: assignment.submittedAt?.toISOString() ?? null,
  };
}

export async function saveLearnerOnboardingStep(
  assignmentId: string,
  itemId: string,
  answer: SurveyAnswerValue | undefined,
  user: AuthenticatedUser,
): Promise<LearnerOnboardingStepResult> {
  const database = getDatabase();
  return database.transaction().execute(async (transaction) => {
    const row = await transaction
      .selectFrom("onboarding_assignment")
      .innerJoin(
        "onboarding_definition_version",
        "onboarding_definition_version.id",
        "onboarding_assignment.definitionVersionId",
      )
      .innerJoin(
        "onboarding_response",
        "onboarding_response.assignmentId",
        "onboarding_assignment.id",
      )
      .innerJoin(
        "survey_version",
        "survey_version.id",
        "onboarding_response.surveyVersionId",
      )
      .select([
        "onboarding_assignment.status",
        "onboarding_definition_version.profileMappings",
        "onboarding_response.answers",
        "onboarding_response.visitedItemIds",
        "onboarding_response.currentItemId",
        "onboarding_response.startedAt",
        "onboarding_response.submittedAt",
        "survey_version.content",
      ])
      .where("onboarding_assignment.id", "=", assignmentId)
      .where("onboarding_assignment.userId", "=", user.id)
      .forUpdate()
      .executeTakeFirst();
    if (!row) return { status: "not-found" };
    const content = parseSurveyVersionContent(row.content);
    const items = flattenedItems(content);
    if (row.status === "completed") {
      if (!row.submittedAt) return { status: "unavailable" };
      return {
        status: "submitted",
        progress: deriveProgress(content, {
          answers: storedAnswers(row.answers),
          visitedItemIds: items.map((item) => item.id),
          currentItemId: null,
          completedAt: row.submittedAt,
        }),
        completedCourse: false,
      };
    }
    const itemIndex = items.findIndex((candidate) => candidate.id === itemId);
    const item = items[itemIndex];
    if (!item) return { status: "not-found" };
    const existingVisited = storedVisited(row.visitedItemIds);
    const alreadyVisited = existingVisited.includes(itemId);
    if (!alreadyVisited && row.currentItemId !== itemId)
      return {
        status: "invalid",
        message: "Complete the current onboarding item before continuing.",
      };
    let answers = storedAnswers(row.answers);
    if (item.kind !== "instruction") {
      const validation = validateAnswer(item, answer);
      if (!validation.valid)
        return { status: "invalid", message: validation.message };
      if (typeof validation.answer === "undefined")
        answers = Object.fromEntries(
          Object.entries(answers).filter(
            ([questionId]) => questionId !== item.id,
          ),
        );
      else answers[item.id] = validation.answer;
    }
    const visitedItemIds = alreadyVisited
      ? existingVisited
      : [...existingVisited, item.id];
    const visited = new Set(visitedItemIds);
    const completed =
      items.length > 0 && items.every((candidate) => visited.has(candidate.id));
    const now = new Date();
    const currentItemId = completed
      ? null
      : alreadyVisited
        ? row.currentItemId
        : (items[itemIndex + 1]?.id ?? null);
    await transaction
      .updateTable("onboarding_response")
      .set({
        answers: JSON.stringify(answers),
        visitedItemIds: JSON.stringify(visitedItemIds),
        currentItemId,
        updatedAt: now,
        submittedAt: completed ? now : null,
      })
      .where("assignmentId", "=", assignmentId)
      .execute();
    await transaction
      .updateTable("onboarding_assignment")
      .set({
        status: completed ? "completed" : "in_progress",
        startedAt: row.status === "assigned" ? now : undefined,
        completedAt: completed ? now : null,
      })
      .where("id", "=", assignmentId)
      .execute();
    if (completed)
      await applyProfileMappings(
        transaction,
        user.id,
        content,
        answers,
        row.profileMappings,
      );
    const progress = deriveProgress(content, {
      answers,
      visitedItemIds,
      currentItemId,
      completedAt: completed ? now : null,
    });
    if (completed)
      logServerEvent({
        level: "info",
        event: "onboarding.completed",
        fields: {
          entityType: "onboarding_assignment",
          entityId: assignmentId,
          actorUserId: user.id,
        },
      });
    return {
      status: completed ? "submitted" : "advanced",
      progress,
      completedCourse: false,
    };
  });
}

async function applyProfileMappings(
  transaction: Transaction<Database>,
  userId: string,
  content: ReturnType<typeof parseSurveyVersionContent>,
  answers: Record<string, SurveyAnswerValue>,
  value: unknown,
): Promise<void> {
  const parsed = z.array(onboardingProfileMappingSchema).safeParse(value);
  if (!parsed.success || parsed.data.length === 0) return;
  const questions = new Map<string, SurveyQuestion>(
    content.sections.flatMap((section) =>
      section.items.flatMap((item) =>
        item.kind === "instruction" ? [] : [[item.id, item] as const],
      ),
    ),
  );
  const update: {
    name?: string;
    phone?: string | null;
    currentRegionId?: string | null;
  } = {};
  const regionMapping = parsed.data.find(
    (mapping) => mapping.destination === "currentRegionId",
  );
  let mappedRegionId: string | undefined;
  if (regionMapping) {
    const answer = answers[regionMapping.questionId];
    const question = questions.get(regionMapping.questionId);
    if (
      typeof answer === "string" &&
      question &&
      (question.kind === "single_choice" || question.kind === "dropdown")
    ) {
      const candidateRegionId = question.options.find(
        (option) => option.id === answer,
      )?.externalValue;
      if (candidateRegionId) {
        const region = await transaction
          .selectFrom("coordination_region")
          .select("id")
          .where("id", "=", candidateRegionId)
          .where("status", "=", "active")
          .executeTakeFirst();
        mappedRegionId = region?.id;
      }
    }
  }
  for (const mapping of parsed.data) {
    const answer = answers[mapping.questionId];
    const question = questions.get(mapping.questionId);
    if (!question) continue;
    if (mapping.destination === "name" && typeof answer === "string")
      update.name = answer;
    if (mapping.destination === "phone" && typeof answer === "string")
      update.phone = answer;
    if (mapping.destination === "currentRegionId" && mappedRegionId)
      update.currentRegionId = mappedRegionId;
  }
  if (Object.keys(update).length > 0)
    await transaction
      .updateTable("user")
      .set(update)
      .where("id", "=", userId)
      .execute();
}
