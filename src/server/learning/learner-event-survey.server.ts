import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type { Kysely, Transaction } from "kysely";
import {
  parseSurveyVersionContent,
  type LearnerEventSurvey,
  type LearnerEventSurveyStep,
  type LearnerSurveyStepResult,
  type SurveyAnswerValue,
  type SurveyItem,
} from "#/features/survey/survey.schema";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { completeEventParticipationIfReady } from "#/server/learning/event-learning-completion.server";
import {
  calculateEventSectionReleaseAt,
  ensureEventSectionReleased,
} from "#/server/learning/event-section-release.server";
import {
  deriveProgress,
  flattenedItems,
  storedAnswers,
  storedVisited,
  validateAnswer,
  type StoredProgress,
} from "#/server/learning/learner-survey.server";
import { logServerEvent } from "#/server/logging/server-logger";

async function findEventSurveyAccess(
  database: Kysely<Database> | Transaction<Database>,
  input: {
    eventParticipationId?: string;
    eventOccurrenceId?: string;
    eventTemplateVersionItemId: string;
    userId: string;
  },
) {
  let query = database
    .selectFrom("event_participation as participation")
    .innerJoin(
      "event_occurrence as occurrence",
      "occurrence.id",
      "participation.eventOccurrenceId",
    )
    .leftJoin(
      "event_registration as registration",
      "registration.id",
      "participation.registrationId",
    )
    .innerJoin("event_template_version_item as item", (join) =>
      join.onRef(
        "item.eventTemplateVersionId",
        "=",
        "occurrence.eventTemplateVersionId",
      ),
    )
    .innerJoin(
      "event_template_version_section as section",
      "section.id",
      "item.sectionId",
    )
    .innerJoin(
      "survey_version as survey",
      "survey.id",
      "item.learningActivityVersionId",
    )
    .innerJoin(
      "learning_activity_version as activityVersion",
      "activityVersion.id",
      "survey.id",
    )
    .select([
      "participation.id as eventParticipationId",
      "participation.eventOccurrenceId",
      "participation.createdAt as participationCreatedAt",
      "occurrence.title as eventTitle",
      "occurrence.startsAt",
      "occurrence.endsAt",
      "occurrence.status as occurrenceStatus",
      "section.title as sectionTitle",
      "section.id as eventTemplateVersionSectionId",
      "section.releaseAnchor",
      "section.releaseOffsetMinutes",
      "item.id as eventTemplateVersionItemId",
      "survey.id as surveyVersionId",
      "survey.content",
      "activityVersion.publishedAt",
    ])
    .where("participation.userId", "=", input.userId)
    .where((expression) =>
      expression.or([
        expression("participation.mode", "=", "open_entry"),
        expression("registration.status", "=", "selected"),
      ]),
    )
    .where("item.id", "=", input.eventTemplateVersionItemId)
    .where("item.kind", "=", "survey");
  if (input.eventParticipationId)
    query = query.where("participation.id", "=", input.eventParticipationId);
  if (input.eventOccurrenceId)
    query = query.where(
      "participation.eventOccurrenceId",
      "=",
      input.eventOccurrenceId,
    );
  const row = await query.executeTakeFirst();
  if (!row || ["cancelled", "archived"].includes(row.occurrenceStatus))
    return null;
  const finalSession = await database
    .selectFrom("event_session")
    .select("endsAt")
    .where("eventOccurrenceId", "=", row.eventOccurrenceId)
    .orderBy("endsAt", "desc")
    .executeTakeFirst();
  const releaseAt = calculateEventSectionReleaseAt({
    releaseAnchor: row.releaseAnchor,
    releaseOffsetMinutes: row.releaseOffsetMinutes,
    participationCreatedAt: row.participationCreatedAt,
    occurrenceStartsAt: row.startsAt,
    occurrenceEndsAt: row.endsAt,
    finalSessionEndsAt: finalSession?.endsAt ?? row.endsAt,
  });
  const now = new Date();
  return {
    ...row,
    available: await ensureEventSectionReleased(database, {
      eventParticipationId: row.eventParticipationId,
      eventTemplateVersionSectionId: row.eventTemplateVersionSectionId,
      calculatedReleaseAt: releaseAt,
      now,
    }),
  };
}

export async function findLearnerEventSurvey(
  eventOccurrenceId: string,
  eventTemplateVersionItemId: string,
  user: AuthenticatedUser,
): Promise<LearnerEventSurvey | null | "unavailable"> {
  const database = getDatabase();
  const row = await findEventSurveyAccess(database, {
    eventOccurrenceId,
    eventTemplateVersionItemId,
    userId: user.id,
  });
  if (!row) return null;
  if (!row.available || !row.publishedAt) return "unavailable";
  const [response, progress] = await Promise.all([
    database
      .selectFrom("survey_response")
      .select(["answers", "submittedAt"])
      .where("eventParticipationId", "=", row.eventParticipationId)
      .where("eventTemplateVersionItemId", "=", row.eventTemplateVersionItemId)
      .executeTakeFirst(),
    database
      .selectFrom("survey_progress")
      .select(["answers", "visitedItemIds", "currentItemId", "completedAt"])
      .where("eventParticipationId", "=", row.eventParticipationId)
      .where("eventTemplateVersionItemId", "=", row.eventTemplateVersionItemId)
      .executeTakeFirst(),
  ]);
  const content = parseSurveyVersionContent(row.content);
  const allItemIds = flattenedItems(content).map((item) => item.id);
  const stored: StoredProgress | null = response
    ? {
        answers: storedAnswers(response.answers),
        visitedItemIds: allItemIds,
        currentItemId: null,
        completedAt: progress?.completedAt ?? response.submittedAt,
      }
    : progress
      ? {
          answers: storedAnswers(progress.answers),
          visitedItemIds: storedVisited(progress.visitedItemIds),
          currentItemId: progress.currentItemId,
          completedAt: progress.completedAt,
        }
      : null;
  return {
    eventOccurrenceId: row.eventOccurrenceId,
    eventParticipationId: row.eventParticipationId,
    eventTemplateVersionItemId: row.eventTemplateVersionItemId,
    eventTitle: row.eventTitle,
    sectionTitle: row.sectionTitle,
    surveyVersionId: row.surveyVersionId,
    content,
    progress: deriveProgress(content, stored),
    submittedAt: response?.submittedAt.toISOString() ?? null,
  };
}

export async function advanceLearnerEventSurvey(
  input: LearnerEventSurveyStep,
  user: AuthenticatedUser,
): Promise<LearnerSurveyStepResult> {
  const now = new Date();
  const outcome = await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const row = await findEventSurveyAccess(transaction, {
        eventParticipationId: input.eventParticipationId,
        eventTemplateVersionItemId: input.eventTemplateVersionItemId,
        userId: user.id,
      });
      if (!row) return { status: "not-found" } as const;
      if (!row.available || !row.publishedAt)
        return { status: "unavailable" } as const;
      const content = parseSurveyVersionContent(row.content);
      const items = flattenedItems(content);
      const submittedResponse = await transaction
        .selectFrom("survey_response")
        .select(["answers", "submittedAt"])
        .where("eventParticipationId", "=", input.eventParticipationId)
        .where(
          "eventTemplateVersionItemId",
          "=",
          input.eventTemplateVersionItemId,
        )
        .executeTakeFirst();
      if (submittedResponse)
        return {
          status: "submitted",
          progress: deriveProgress(content, {
            answers: storedAnswers(submittedResponse.answers),
            visitedItemIds: items.map((item) => item.id),
            currentItemId: null,
            completedAt: submittedResponse.submittedAt,
          }),
          completedCourse: false,
        } as const;
      const persisted = await transaction
        .selectFrom("survey_progress")
        .select(["answers", "visitedItemIds", "currentItemId", "completedAt"])
        .where("eventParticipationId", "=", input.eventParticipationId)
        .where(
          "eventTemplateVersionItemId",
          "=",
          input.eventTemplateVersionItemId,
        )
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
      let answers: Record<string, SurveyAnswerValue> = { ...stored.answers };
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
          enrollmentId: null,
          courseVersionItemId: null,
          eventParticipationId: input.eventParticipationId,
          eventTemplateVersionItemId: input.eventTemplateVersionItemId,
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
            .columns(["eventParticipationId", "eventTemplateVersionItemId"])
            .where("eventParticipationId", "is not", null)
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
        return {
          status: "advanced",
          progress,
          completedCourse: false,
        } as const;
      await transaction
        .insertInto("survey_response")
        .values({
          id: `survey_response_${randomUUID()}`,
          enrollmentId: null,
          courseVersionItemId: null,
          eventParticipationId: input.eventParticipationId,
          eventTemplateVersionItemId: input.eventTemplateVersionItemId,
          surveyVersionId: row.surveyVersionId,
          answers,
          submittedAt: now,
        })
        .execute();
      await transaction
        .insertInto("learning_item_progress")
        .values({
          id: `learning_progress_${randomUUID()}`,
          enrollmentId: null,
          courseVersionItemId: null,
          eventParticipationId: input.eventParticipationId,
          eventTemplateVersionItemId: input.eventTemplateVersionItemId,
          state: "completed",
          completedAt: now,
          updatedAt: now,
        })
        .onConflict((conflict) =>
          conflict
            .columns(["eventParticipationId", "eventTemplateVersionItemId"])
            .where("eventParticipationId", "is not", null)
            .doUpdateSet({ state: "completed", updatedAt: now }),
        )
        .execute();
      await completeEventParticipationIfReady(
        transaction,
        input.eventParticipationId,
        now,
      );
      return { status: "submitted", progress, completedCourse: false } as const;
    });
  if (outcome.status === "submitted")
    logServerEvent({
      level: "info",
      event: "survey.response_submitted",
      fields: {
        actorUserId: user.id,
        entityType: "event_template_version_item",
        entityId: input.eventTemplateVersionItemId,
        eventParticipationId: input.eventParticipationId,
        outcome: "succeeded",
      },
    });
  return outcome;
}
