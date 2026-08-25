import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import {
  onboardingProfileMappingSchema,
  type LearnerOnboarding,
  type LearnerOnboardingStepResult,
} from "#/features/onboarding/onboarding.schema";
import {
  isOperationalRegionQuestion,
  isRegionGroupQuestion,
  parseSurveyVersionContent,
  type SurveyAnswerValue,
  type SurveyQuestion,
} from "#/features/survey/survey.schema";
import { normalizeInternationalPhone } from "#/features/profile/phone-number";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { invalidateVerifiedPhone } from "#/server/profile/contact-verification-core.server";
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
import {
  completeOnboardingIfVerified,
  findOnboardingContactVerification,
} from "./onboarding-contact-verification.server";

const DEFINITION_ID = "onboarding_definition_default";
type ProfileMapping = z.infer<typeof onboardingProfileMappingSchema>;

function profileMappings(value: unknown): Array<ProfileMapping> {
  const parsed = z.array(onboardingProfileMappingSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

function mappedQuestionId(
  mappings: Array<ProfileMapping>,
  destination: ProfileMapping["destination"],
): string | null {
  return (
    mappings.find((mapping) => mapping.destination === destination)
      ?.questionId ?? null
  );
}

async function findAssignment(userId: string): Promise<
  | {
      assignmentId: string;
      privacyNotice: string;
      privacyNoticeVersion: string;
      profileMappings: unknown;
      contactVerificationRequired: boolean;
      verificationDeferredAt: Date | null;
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
      "onboarding_definition_version.profileMappings",
      "onboarding_definition_version.contactVerificationRequired",
      "onboarding_assignment.verificationDeferredAt",
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
      "onboarding_definition_version.profileMappings",
      "onboarding_definition_version.contactVerificationRequired",
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
    profileMappings: active.profileMappings,
    contactVerificationRequired: active.contactVerificationRequired,
    verificationDeferredAt: null,
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
  const verification = await findOnboardingContactVerification(
    getDatabase(),
    user.id,
  );
  const answers = storedAnswers(assignment.answers);
  const visitedItemIds = storedVisited(assignment.visitedItemIds);
  const mappings = profileMappings(assignment.profileMappings);
  const smsQuestionId = mappedQuestionId(mappings, "smsEnabled");
  const phoneQuestionId = mappedQuestionId(mappings, "phone");
  const checkpoint =
    smsQuestionId &&
    visitedItemIds.includes(smsQuestionId) &&
    answers[smsQuestionId] === true &&
    verification.sms.enabled &&
    !verification.sms.verified &&
    verification.sms.destination &&
    (assignment.contactVerificationRequired ||
      !assignment.verificationDeferredAt)
      ? { channel: "sms" as const, phoneQuestionId }
      : null;
  const progress = deriveProgress(content, {
    answers,
    visitedItemIds,
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
    verification: {
      required: assignment.contactVerificationRequired,
      checkpoint,
      ...verification,
    },
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
        "onboarding_definition_version.contactVerificationRequired",
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
    const mappings = profileMappings(row.profileMappings);
    const storedAnswerValues = storedAnswers(row.answers);
    const items = flattenedItems(content, storedAnswerValues);
    if (row.status === "completed") {
      if (!row.submittedAt) return { status: "unavailable" };
      return {
        status: "submitted",
        progress: deriveProgress(content, {
          answers: storedAnswerValues,
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
    const itemDestination = mappings.find(
      (mapping) => mapping.questionId === item.id,
    )?.destination;
    const existingVisited = storedVisited(row.visitedItemIds);
    const smsQuestionId = mappedQuestionId(mappings, "smsEnabled");
    const phoneQuestionId = mappedQuestionId(mappings, "phone");
    if (
      row.contactVerificationRequired &&
      smsQuestionId &&
      existingVisited.includes(smsQuestionId) &&
      itemId !== smsQuestionId &&
      itemId !== phoneQuestionId
    ) {
      const verification = await findOnboardingContactVerification(
        transaction,
        user.id,
      );
      if (
        verification.sms.enabled &&
        !verification.sms.verified &&
        verification.sms.destination
      )
        return {
          status: "invalid",
          message: "Verify your mobile number before continuing onboarding.",
        };
    }
    const alreadyVisited = existingVisited.includes(itemId);
    if (!alreadyVisited && row.currentItemId !== itemId)
      return {
        status: "invalid",
        message: "Complete the current onboarding item before continuing.",
      };
    let answers = storedAnswerValues;
    if (item.kind !== "instruction") {
      const validation = validateAnswer(item, answer);
      if (!validation.valid)
        return { status: "invalid", message: validation.message };
      let validatedAnswer = validation.answer;
      if (
        item.kind === "checkbox" &&
        typeof validatedAnswer === "undefined" &&
        (itemDestination === "emailEnabled" || itemDestination === "smsEnabled")
      )
        validatedAnswer = false;
      if (
        mappings.some(
          (mapping) =>
            mapping.questionId === item.id && mapping.destination === "phone",
        ) &&
        typeof validatedAnswer === "string"
      ) {
        const phone = normalizeInternationalPhone(validatedAnswer);
        if (!phone)
          return {
            status: "invalid",
            message:
              "Enter a mobile number in international format, for example +61400123456.",
          };
        validatedAnswer = phone;
      }
      if (
        isOperationalRegionQuestion(item) &&
        typeof validatedAnswer === "string"
      ) {
        const groupQuestion = items.find(isRegionGroupQuestion);
        const groupAnswer = groupQuestion
          ? answers[groupQuestion.id]
          : undefined;
        const groupId =
          groupQuestion && typeof groupAnswer === "string"
            ? groupQuestion.options.find((option) => option.id === groupAnswer)
                ?.externalValue
            : undefined;
        const selectedRegion = item.options.find(
          (option) => option.id === validatedAnswer,
        );
        if (!groupId || selectedRegion?.parentExternalValue !== groupId)
          return {
            status: "invalid",
            message:
              "Choose an operational region from the selected region group.",
          };
      }
      if (typeof validatedAnswer === "undefined")
        answers = Object.fromEntries(
          Object.entries(answers).filter(
            ([questionId]) => questionId !== item.id,
          ),
        );
      else answers[item.id] = validatedAnswer;
      if (isRegionGroupQuestion(item)) {
        const operationalQuestion = items.find(isOperationalRegionQuestion);
        const operationalAnswer = operationalQuestion
          ? answers[operationalQuestion.id]
          : undefined;
        const selectedGroup =
          typeof validatedAnswer === "string"
            ? item.options.find((option) => option.id === validatedAnswer)
                ?.externalValue
            : undefined;
        const selectedOperationalRegion =
          operationalQuestion && typeof operationalAnswer === "string"
            ? operationalQuestion.options.find(
                (option) => option.id === operationalAnswer,
              )
            : undefined;
        if (
          operationalQuestion &&
          selectedOperationalRegion?.parentExternalValue !== selectedGroup
        )
          answers = Object.fromEntries(
            Object.entries(answers).filter(
              ([questionId]) => questionId !== operationalQuestion.id,
            ),
          );
      }
    }
    const nextItems = flattenedItems(content, answers);
    const nextItemIds = new Set(nextItems.map((candidate) => candidate.id));
    answers = Object.fromEntries(
      Object.entries(answers).filter(([questionId]) =>
        nextItemIds.has(questionId),
      ),
    );
    const visitedItemIds = [
      ...new Set(
        [...existingVisited, item.id].filter((visitedItemId) =>
          nextItemIds.has(visitedItemId),
        ),
      ),
    ];
    const visited = new Set(visitedItemIds);
    const completed =
      nextItems.length > 0 &&
      nextItems.every((candidate) => visited.has(candidate.id));
    const now = new Date();
    const currentItemId = completed
      ? null
      : (nextItems.find((candidate) => !visited.has(candidate.id))?.id ?? null);
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
        status: "in_progress",
        startedAt: row.status === "assigned" ? now : undefined,
        completedAt: null,
        verificationDeferredAt:
          itemDestination === "phone" ||
          itemDestination === "emailEnabled" ||
          itemDestination === "smsEnabled"
            ? null
            : undefined,
      })
      .where("id", "=", assignmentId)
      .execute();
    await applyProfileMappings(
      transaction,
      user.id,
      content,
      answers,
      row.profileMappings,
      completed,
    );
    const verification = await findOnboardingContactVerification(
      transaction,
      user.id,
    );
    let onboardingCompleted = false;
    if (completed)
      onboardingCompleted = await completeOnboardingIfVerified(
        transaction,
        assignmentId,
        user.id,
        now,
      );
    const verificationChannel =
      itemDestination === "smsEnabled" &&
      answers[item.id] === true &&
      verification.sms.enabled &&
      !verification.sms.verified &&
      verification.sms.destination
        ? ("sms" as const)
        : null;
    const progress = deriveProgress(content, {
      answers,
      visitedItemIds,
      currentItemId,
      completedAt: completed ? now : null,
    });
    if (onboardingCompleted)
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
      ...(verificationChannel ? { verificationChannel } : {}),
    };
  });
}

async function applyProfileMappings(
  transaction: Transaction<Database>,
  userId: string,
  content: ReturnType<typeof parseSurveyVersionContent>,
  answers: Record<string, SurveyAnswerValue>,
  value: unknown,
  finalizing: boolean,
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
    emailEnabled?: boolean;
    smsEnabled?: boolean;
    updatedAt?: Date;
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
    if (mapping.destination === "phone" && typeof answer === "string") {
      const phone = normalizeInternationalPhone(answer);
      if (phone) update.phone = phone;
    }
    if (mapping.destination === "emailEnabled" && typeof answer === "boolean")
      update.emailEnabled = answer;
    if (mapping.destination === "smsEnabled" && typeof answer === "boolean")
      update.smsEnabled = answer;
    if (
      mapping.destination === "currentRegionId" &&
      (typeof answer === "string" || finalizing)
    )
      update.currentRegionId = mappedRegionId ?? null;
  }
  if (update.phone) {
    const existing = await transaction
      .selectFrom("user")
      .select("phone")
      .where("id", "=", userId)
      .executeTakeFirstOrThrow();
    if (normalizeInternationalPhone(existing.phone ?? "") !== update.phone) {
      await invalidateVerifiedPhone(transaction, userId, new Date());
    }
  }
  if (Object.keys(update).length > 0) {
    update.updatedAt = new Date();
    await transaction
      .updateTable("user")
      .set(update)
      .where("id", "=", userId)
      .execute();
  }
}
