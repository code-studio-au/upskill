import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import type { EventRegistrationStatus } from "#/features/admin-event/admin-event-operations.schema";
import {
  type LearnerRegistrationQuestionnaire,
  type LearnerRegistrationQuestionnaireStepResult,
} from "#/features/registration/registration-questionnaire.schema";
import {
  parseSurveyVersionContent,
  surveyProfileField,
  type SurveyAnswerValue,
  type SurveyVersionContent,
} from "#/features/survey/survey.schema";
import {
  filterRegistrationEventRegionOptions,
  operationalRegionMatchesSelectedGroup,
  registrationOffersProfileUpdate,
  registrationQuestions,
  withoutRegistrationAnswer,
} from "#/features/registration/registration-questionnaire-domain";
import {
  isOperationalRegionQuestion,
  isRegionGroupQuestion,
} from "#/features/survey/survey.schema";
import { surveyPathItems } from "#/features/survey/survey-branching";
import { normalizeInternationalPhone } from "#/features/profile/phone-number";
import { learnerProfileNameSchema } from "#/features/profile/learner-profile.schema";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import {
  deriveProgress,
  flattenedItems,
  storedAnswers,
  storedVisited,
} from "#/server/learning/learner-survey.server";
import { validateAnswer } from "#/server/learning/survey-answer-validation";
import { invalidateVerifiedPhone } from "#/server/profile/contact-verification-core.server";
import { registerLearnerForEventInTransaction } from "#/server/learner/learner-event.server";
import { logServerEvent } from "#/server/logging/server-logger";

class EventRegistrationFinalizationError extends Error {}

type AssignmentTarget =
  | { kind: "event"; eventOccurrenceId: string }
  | { kind: "course"; enrollmentId: string };

interface AssignmentRow {
  assignmentId: string;
  status: "assigned" | "in_progress" | "completed" | "waived";
  surveyVersionId: string;
  eventOccurrenceId: string | null;
  eventOccurrenceRegionId: string | null;
  enrollmentId: string | null;
  offeringTitle: string;
  answers: unknown;
  visitedItemIds: unknown;
  currentItemId: string | null;
  startedAt: Date;
  submittedAt: Date | null;
}

interface EventRegistrationState {
  id: string;
  status: EventRegistrationStatus;
  eventOccurrenceRegionId: string | null;
  reviewRoundId: string | null;
  coordinatorPriority: number | null;
  coordinatorDecidedAt: Date | null;
  finalDecidedAt: Date | null;
  lockedInAt: Date | null;
  regionMismatchAcknowledgedAt: Date | null;
  regionalReviewWaivedAt: Date | null;
}

async function prefilledAnswers(
  transaction: Transaction<Database>,
  content: SurveyVersionContent,
  userId: string,
): Promise<Record<string, SurveyAnswerValue>> {
  const profile = await transaction
    .selectFrom("user")
    .select(["name", "phone", "emailEnabled", "smsEnabled", "currentRegionId"])
    .where("id", "=", userId)
    .executeTakeFirstOrThrow();
  const currentRegion = profile.currentRegionId
    ? await transaction
        .selectFrom("coordination_region")
        .select(["id", "parentId"])
        .where("id", "=", profile.currentRegionId)
        .executeTakeFirst()
    : null;
  const answers: Record<string, SurveyAnswerValue> = {};
  for (const question of registrationQuestions(content)) {
    const field = surveyProfileField(question);
    if (field === "name") answers[question.id] = profile.name;
    if (field === "phone" && profile.phone)
      answers[question.id] = profile.phone;
    if (field === "emailEnabled") answers[question.id] = profile.emailEnabled;
    if (field === "smsEnabled") answers[question.id] = profile.smsEnabled;
    if (isOperationalRegionQuestion(question) && currentRegion) {
      const option = question.options.find(
        (candidate) => candidate.externalValue === currentRegion.id,
      );
      if (option) answers[question.id] = option.id;
    }
    if (isRegionGroupQuestion(question) && currentRegion?.parentId) {
      const option = question.options.find(
        (candidate) => candidate.externalValue === currentRegion.parentId,
      );
      if (option) answers[question.id] = option.id;
    }
  }
  return answers;
}

async function insertAssignment(
  transaction: Transaction<Database>,
  input: {
    userId: string;
    surveyVersionId: string;
    content: SurveyVersionContent;
    target: AssignmentTarget;
  },
): Promise<string> {
  const assignmentId = `registration_questionnaire_assignment_${randomUUID()}`;
  const now = new Date();
  const answers = await prefilledAnswers(
    transaction,
    input.content,
    input.userId,
  );
  await transaction
    .insertInto("registration_questionnaire_assignment")
    .values({
      id: assignmentId,
      userId: input.userId,
      surveyVersionId: input.surveyVersionId,
      eventOccurrenceId:
        input.target.kind === "event" ? input.target.eventOccurrenceId : null,
      eventOccurrenceRegionId: null,
      enrollmentId:
        input.target.kind === "course" ? input.target.enrollmentId : null,
      status: "assigned",
      assignedAt: now,
      startedAt: null,
      completedAt: null,
      waivedAt: null,
      waivedByUserId: null,
      waiverReason: null,
    })
    .execute();
  await transaction
    .insertInto("registration_questionnaire_response")
    .values({
      id: `registration_questionnaire_response_${randomUUID()}`,
      assignmentId,
      surveyVersionId: input.surveyVersionId,
      answers,
      visitedItemIds: JSON.stringify([]),
      currentItemId: flattenedItems(input.content, answers)[0]?.id ?? null,
      startedAt: now,
      updatedAt: now,
      submittedAt: null,
      profileUpdateAcceptedAt: null,
      redactedAt: null,
    })
    .execute();
  return assignmentId;
}

async function needsOrdinaryEventRegistration(
  transaction: Transaction<Database>,
  eventOccurrenceId: string,
  userId: string,
): Promise<boolean> {
  const [registration, participation] = await Promise.all([
    transaction
      .selectFrom("event_registration")
      .select("id")
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .where("userId", "=", userId)
      .executeTakeFirst(),
    transaction
      .selectFrom("event_participation")
      .select("id")
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .where("userId", "=", userId)
      .executeTakeFirst(),
  ]);
  return !registration && !participation;
}

function toLearnerQuestionnaire(
  row: AssignmentRow,
  content: SurveyVersionContent,
): LearnerRegistrationQuestionnaire {
  const answers = storedAnswers(row.answers);
  const submittedItems = row.submittedAt
    ? flattenedItems(content, answers).map((item) => item.id)
    : storedVisited(row.visitedItemIds);
  return {
    assignmentId: row.assignmentId,
    target: row.eventOccurrenceId
      ? { kind: "event", eventOccurrenceId: row.eventOccurrenceId }
      : { kind: "course", enrollmentId: row.enrollmentId as string },
    offeringTitle: row.offeringTitle,
    sectionTitle: "Registration details",
    surveyVersionId: row.surveyVersionId,
    content,
    progress: deriveProgress(content, {
      answers,
      visitedItemIds: submittedItems,
      currentItemId: row.currentItemId,
      completedAt: row.submittedAt,
    }),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    profileUpdateOffered: registrationOffersProfileUpdate(content),
  };
}

async function findCourseAssignment(
  enrollmentId: string,
  user: AuthenticatedUser,
): Promise<
  LearnerRegistrationQuestionnaire | "complete" | "not-configured" | null
> {
  const database = getDatabase();
  return await database.transaction().execute(async (transaction) => {
    const enrollment = await transaction
      .selectFrom("enrollment")
      .innerJoin(
        "course_version",
        "course_version.id",
        "enrollment.courseVersionId",
      )
      .innerJoin("course", "course.id", "course_version.courseId")
      .leftJoin(
        "survey_version",
        "survey_version.id",
        "course_version.registrationSurveyVersionId",
      )
      .leftJoin(
        "learning_activity_version",
        "learning_activity_version.id",
        "survey_version.id",
      )
      .select([
        "enrollment.id",
        "enrollment.status",
        "enrollment.expiresAt",
        "enrollment.removedAt",
        "course.title",
        "course_version.registrationSurveyVersionId",
        "survey_version.content",
        "learning_activity_version.publishedAt",
      ])
      .where("enrollment.id", "=", enrollmentId)
      .where("enrollment.userId", "=", user.id)
      .forUpdate("enrollment")
      .executeTakeFirst();
    if (
      !enrollment ||
      enrollment.removedAt ||
      enrollment.status === "cancelled"
    )
      return null;
    if (
      enrollment.status === "expired" ||
      (enrollment.expiresAt && enrollment.expiresAt <= new Date())
    )
      return null;
    if (!enrollment.registrationSurveyVersionId)
      return "not-configured" as const;
    if (!enrollment.publishedAt || !enrollment.content) return null;
    const content = parseSurveyVersionContent(enrollment.content);
    let assignment = await transaction
      .selectFrom("registration_questionnaire_assignment as assignment")
      .innerJoin(
        "registration_questionnaire_response as response",
        "response.assignmentId",
        "assignment.id",
      )
      .select([
        "assignment.id as assignmentId",
        "assignment.status",
        "assignment.surveyVersionId",
        "assignment.eventOccurrenceId",
        "assignment.eventOccurrenceRegionId",
        "assignment.enrollmentId",
        "response.answers",
        "response.visitedItemIds",
        "response.currentItemId",
        "response.startedAt",
        "response.submittedAt",
      ])
      .where("assignment.enrollmentId", "=", enrollment.id)
      .where("assignment.userId", "=", user.id)
      .executeTakeFirst();
    if (!assignment) {
      await insertAssignment(transaction, {
        userId: user.id,
        surveyVersionId: enrollment.registrationSurveyVersionId,
        content,
        target: { kind: "course", enrollmentId: enrollment.id },
      });
      assignment = await transaction
        .selectFrom("registration_questionnaire_assignment as assignment")
        .innerJoin(
          "registration_questionnaire_response as response",
          "response.assignmentId",
          "assignment.id",
        )
        .select([
          "assignment.id as assignmentId",
          "assignment.status",
          "assignment.surveyVersionId",
          "assignment.eventOccurrenceId",
          "assignment.eventOccurrenceRegionId",
          "assignment.enrollmentId",
          "response.answers",
          "response.visitedItemIds",
          "response.currentItemId",
          "response.startedAt",
          "response.submittedAt",
        ])
        .where("assignment.enrollmentId", "=", enrollment.id)
        .executeTakeFirstOrThrow();
    }
    if (assignment.status === "waived") return "complete" as const;
    return toLearnerQuestionnaire(
      { ...assignment, offeringTitle: enrollment.title },
      content,
    );
  });
}

function emailDomain(email: string): string | null {
  const separator = email.lastIndexOf("@");
  if (separator <= 0 || separator === email.length - 1) return null;
  return email.slice(separator + 1).toLocaleLowerCase("en-AU");
}

async function findEventAssignment(
  eventOccurrenceId: string,
  user: AuthenticatedUser,
): Promise<
  | LearnerRegistrationQuestionnaire
  | "complete"
  | "cancelled"
  | "not-configured"
  | "unavailable"
  | null
> {
  const database = getDatabase();
  return await database.transaction().execute(async (transaction) => {
    const occurrence = await transaction
      .selectFrom("event_occurrence as occurrence")
      .innerJoin(
        "event_template_version as version",
        "version.id",
        "occurrence.eventTemplateVersionId",
      )
      .leftJoin(
        "survey_version",
        "survey_version.id",
        "version.registrationSurveyVersionId",
      )
      .leftJoin(
        "learning_activity_version",
        "learning_activity_version.id",
        "survey_version.id",
      )
      .select([
        "occurrence.id",
        "occurrence.title",
        "occurrence.status",
        "occurrence.registrationMode",
        "occurrence.approvalMode",
        "occurrence.registrationOpensAt",
        "occurrence.registrationClosesAt",
        "occurrence.capacity",
        "occurrence.confirmedCount",
        "version.registrationSurveyVersionId",
        "survey_version.content",
        "learning_activity_version.publishedAt",
      ])
      .where("occurrence.id", "=", eventOccurrenceId)
      .forUpdate("occurrence")
      .executeTakeFirst();
    if (!occurrence) return null;
    if (!occurrence.registrationSurveyVersionId)
      return "not-configured" as const;
    if (!occurrence.publishedAt || !occurrence.content)
      return "unavailable" as const;
    const [registration, participation, regions] = await Promise.all([
      transaction
        .selectFrom("event_registration")
        .select(["id", "status", "eventOccurrenceRegionId"])
        .where("eventOccurrenceId", "=", occurrence.id)
        .where("userId", "=", user.id)
        .executeTakeFirst(),
      transaction
        .selectFrom("event_participation")
        .select("id")
        .where("eventOccurrenceId", "=", occurrence.id)
        .where("userId", "=", user.id)
        .executeTakeFirst(),
      transaction
        .selectFrom("event_occurrence_region")
        .select(["id", "regionId", "retiredAt"])
        .where("eventOccurrenceId", "=", occurrence.id)
        .execute(),
    ]);
    if (occurrence.status === "cancelled")
      return registration || participation
        ? ("cancelled" as const)
        : ("unavailable" as const);
    if (occurrence.status !== "published") return "unavailable" as const;
    if (!registration && !participation) {
      const now = new Date();
      if (
        occurrence.registrationMode === "open_entry" ||
        occurrence.registrationMode === "paid_entry" ||
        !occurrence.registrationOpensAt ||
        !occurrence.registrationClosesAt ||
        occurrence.registrationOpensAt > now ||
        occurrence.registrationClosesAt <= now ||
        (occurrence.approvalMode === "automatic" &&
          occurrence.confirmedCount >= occurrence.capacity)
      )
        return "unavailable" as const;
      if (occurrence.registrationMode === "required_restricted") {
        const domain = user.emailVerified ? emailDomain(user.email) : null;
        const permitted = domain
          ? await transaction
              .selectFrom("event_occurrence_domain")
              .select("domain")
              .where("eventOccurrenceId", "=", occurrence.id)
              .where("domain", "=", domain)
              .executeTakeFirst()
          : null;
        if (!permitted) return "unavailable" as const;
      }
    }
    if (
      registration &&
      [
        "withdrawn",
        "cancelled",
        "not_selected",
        "coordinator_declined",
      ].includes(registration.status)
    )
      return "unavailable" as const;
    const unfilteredContent = parseSurveyVersionContent(occurrence.content);
    const availableRegions = regions.filter(
      (region) =>
        !region.retiredAt ||
        region.id === registration?.eventOccurrenceRegionId,
    );
    const content = availableRegions.length
      ? filterRegistrationEventRegionOptions(
          unfilteredContent,
          new Set(availableRegions.map((region) => region.regionId)),
        )
      : unfilteredContent;
    if (
      availableRegions.length > 0 &&
      !registrationQuestions(content).some(isOperationalRegionQuestion)
    )
      return "unavailable" as const;
    let assignment = await transaction
      .selectFrom("registration_questionnaire_assignment as assignment")
      .innerJoin(
        "registration_questionnaire_response as response",
        "response.assignmentId",
        "assignment.id",
      )
      .select([
        "assignment.id as assignmentId",
        "assignment.status",
        "assignment.surveyVersionId",
        "assignment.eventOccurrenceId",
        "assignment.eventOccurrenceRegionId",
        "assignment.enrollmentId",
        "response.answers",
        "response.visitedItemIds",
        "response.currentItemId",
        "response.startedAt",
        "response.submittedAt",
      ])
      .where("assignment.eventOccurrenceId", "=", occurrence.id)
      .where("assignment.userId", "=", user.id)
      .executeTakeFirst();
    if (!assignment) {
      await insertAssignment(transaction, {
        userId: user.id,
        surveyVersionId: occurrence.registrationSurveyVersionId,
        content,
        target: { kind: "event", eventOccurrenceId: occurrence.id },
      });
      assignment = await transaction
        .selectFrom("registration_questionnaire_assignment as assignment")
        .innerJoin(
          "registration_questionnaire_response as response",
          "response.assignmentId",
          "assignment.id",
        )
        .select([
          "assignment.id as assignmentId",
          "assignment.status",
          "assignment.surveyVersionId",
          "assignment.eventOccurrenceId",
          "assignment.eventOccurrenceRegionId",
          "assignment.enrollmentId",
          "response.answers",
          "response.visitedItemIds",
          "response.currentItemId",
          "response.startedAt",
          "response.submittedAt",
        ])
        .where("assignment.eventOccurrenceId", "=", occurrence.id)
        .where("assignment.userId", "=", user.id)
        .executeTakeFirstOrThrow();
    }
    if (
      registration?.eventOccurrenceRegionId &&
      !assignment.eventOccurrenceRegionId
    )
      await transaction
        .updateTable("registration_questionnaire_assignment")
        .set({
          eventOccurrenceRegionId: registration.eventOccurrenceRegionId,
        })
        .where("id", "=", assignment.assignmentId)
        .execute();
    if (assignment.status === "waived") return "complete" as const;
    return toLearnerQuestionnaire(
      { ...assignment, offeringTitle: occurrence.title },
      content,
    );
  });
}

export async function findCourseRegistrationQuestionnaire(
  enrollmentId: string,
  user: AuthenticatedUser,
) {
  return await findCourseAssignment(enrollmentId, user);
}

export async function findEventRegistrationQuestionnaire(
  eventOccurrenceId: string,
  user: AuthenticatedUser,
) {
  return await findEventAssignment(eventOccurrenceId, user);
}

async function applyProfileUpdates(
  transaction: Transaction<Database>,
  userId: string,
  content: SurveyVersionContent,
  answers: Record<string, SurveyAnswerValue>,
  now: Date,
): Promise<void> {
  const update: {
    name?: string;
    phone?: string;
    emailEnabled?: boolean;
    smsEnabled?: boolean;
    currentRegionId?: string;
    updatedAt?: Date;
  } = {};
  for (const question of registrationQuestions(content)) {
    const answer = answers[question.id];
    const field = surveyProfileField(question);
    if (field === "name" && typeof answer === "string") update.name = answer;
    if (field === "phone" && typeof answer === "string") {
      const phone = normalizeInternationalPhone(answer);
      if (!phone) throw new Error("Profile phone answer was not validated");
      update.phone = phone;
    }
    if (field === "emailEnabled" && typeof answer === "boolean")
      update.emailEnabled = answer;
    if (field === "smsEnabled" && typeof answer === "boolean")
      update.smsEnabled = answer;
    if (isOperationalRegionQuestion(question) && typeof answer === "string") {
      const regionId = question.options.find(
        (option) => option.id === answer,
      )?.externalValue;
      if (!regionId) throw new Error("Profile region answer was not validated");
      update.currentRegionId = regionId;
    }
  }
  if (update.phone) {
    const existing = await transaction
      .selectFrom("user")
      .select("phone")
      .where("id", "=", userId)
      .executeTakeFirstOrThrow();
    if (normalizeInternationalPhone(existing.phone ?? "") !== update.phone)
      await invalidateVerifiedPhone(transaction, userId, now);
  }
  if (Object.keys(update).length) {
    update.updatedAt = now;
    await transaction
      .updateTable("user")
      .set(update)
      .where("id", "=", userId)
      .execute();
  }
}

async function currentRegistrationUser(
  transaction: Transaction<Database>,
  user: AuthenticatedUser,
): Promise<AuthenticatedUser> {
  const profile = await transaction
    .selectFrom("user")
    .select(["name", "email", "emailVerified"])
    .where("id", "=", user.id)
    .executeTakeFirstOrThrow();
  return { id: user.id, ...profile };
}

async function validateProfileUpdates(
  transaction: Transaction<Database>,
  userId: string,
  content: SurveyVersionContent,
  answers: Record<string, SurveyAnswerValue>,
): Promise<string | null> {
  let answeredPhone: string | null = null;
  let smsEnabled = false;
  for (const question of registrationQuestions(content)) {
    const answer = answers[question.id];
    const profileField = surveyProfileField(question);
    if (
      profileField === "name" &&
      typeof answer === "string" &&
      !learnerProfileNameSchema.safeParse(answer).success
    )
      return "Enter a name of 160 characters or fewer.";
    if (profileField === "phone" && typeof answer === "string") {
      answeredPhone = normalizeInternationalPhone(answer);
      if (!answeredPhone)
        return "Enter a mobile number in international format, for example +61400123456.";
    }
    if (profileField === "smsEnabled" && answer === true) smsEnabled = true;
    if (isOperationalRegionQuestion(question) && typeof answer === "string") {
      const regionId = question.options.find(
        (option) => option.id === answer,
      )?.externalValue;
      const activeRegion = regionId
        ? await transaction
            .selectFrom("coordination_region as region")
            .innerJoin(
              "coordination_region as parent",
              "parent.id",
              "region.parentId",
            )
            .select("region.id")
            .where("region.id", "=", regionId)
            .where("region.kind", "=", "operational")
            .where("region.status", "=", "active")
            .where("parent.kind", "=", "group")
            .where("parent.status", "=", "active")
            .forShare()
            .executeTakeFirst()
        : null;
      if (!activeRegion)
        return "Choose an active operational region before updating your profile.";
    }
  }
  if (smsEnabled && !answeredPhone) {
    const profile = await transaction
      .selectFrom("user")
      .select("phone")
      .where("id", "=", userId)
      .forUpdate()
      .executeTakeFirst();
    if (!normalizeInternationalPhone(profile?.phone ?? ""))
      return "Enter a valid mobile number before enabling SMS updates.";
  }
  return null;
}

export async function advanceRegistrationQuestionnaire(
  input: {
    assignmentId: string;
    itemId: string;
    answer?: SurveyAnswerValue;
    profileUpdateAccepted?: boolean;
  },
  user: AuthenticatedUser,
): Promise<LearnerRegistrationQuestionnaireStepResult> {
  const database = getDatabase();
  const transactionBuilder = database.transaction();
  const transactionOutcome = transactionBuilder.execute(async (transaction) => {
    const assignmentTarget = await transaction
      .selectFrom("registration_questionnaire_assignment")
      .select(["eventOccurrenceId", "enrollmentId"])
      .where(
        "registration_questionnaire_assignment.id",
        "=",
        input.assignmentId,
      )
      .where("registration_questionnaire_assignment.userId", "=", user.id)
      .executeTakeFirst();
    if (!assignmentTarget) return { result: { status: "not-found" } as const };
    if (assignmentTarget.enrollmentId) {
      const enrollment = await transaction
        .selectFrom("enrollment")
        .select(["status", "expiresAt", "removedAt"])
        .where("id", "=", assignmentTarget.enrollmentId)
        .where("userId", "=", user.id)
        .forUpdate()
        .executeTakeFirst();
      const now = new Date();
      if (
        !enrollment ||
        enrollment.removedAt ||
        enrollment.status === "cancelled" ||
        enrollment.status === "expired" ||
        (enrollment.expiresAt && enrollment.expiresAt <= now)
      )
        return { result: { status: "unavailable" } as const };
    }
    let eventRegistration: EventRegistrationState | null = null;
    if (assignmentTarget.eventOccurrenceId) {
      const occurrence = await transaction
        .selectFrom("event_occurrence")
        .select([
          "status",
          "registrationMode",
          "approvalMode",
          "registrationOpensAt",
          "registrationClosesAt",
          "capacity",
          "confirmedCount",
        ])
        .where("id", "=", assignmentTarget.eventOccurrenceId)
        .forUpdate()
        .executeTakeFirst();
      if (!occurrence || occurrence.status !== "published")
        return { result: { status: "unavailable" } as const };
      const [registration, participation] = await Promise.all([
        transaction
          .selectFrom("event_registration")
          .select([
            "id",
            "status",
            "eventOccurrenceRegionId",
            "reviewRoundId",
            "coordinatorPriority",
            "coordinatorDecidedAt",
            "finalDecidedAt",
            "lockedInAt",
            "regionMismatchAcknowledgedAt",
            "regionalReviewWaivedAt",
          ])
          .where("eventOccurrenceId", "=", assignmentTarget.eventOccurrenceId)
          .where("userId", "=", user.id)
          .forUpdate()
          .executeTakeFirst(),
        transaction
          .selectFrom("event_participation")
          .select("id")
          .where("eventOccurrenceId", "=", assignmentTarget.eventOccurrenceId)
          .where("userId", "=", user.id)
          .executeTakeFirst(),
      ]);
      eventRegistration = registration ?? null;
      if (
        registration &&
        [
          "withdrawn",
          "cancelled",
          "not_selected",
          "coordinator_declined",
        ].includes(registration.status)
      )
        return { result: { status: "unavailable" } as const };
      if (!registration && !participation) {
        const now = new Date();
        if (
          occurrence.registrationMode === "open_entry" ||
          occurrence.registrationMode === "paid_entry" ||
          !occurrence.registrationOpensAt ||
          !occurrence.registrationClosesAt ||
          occurrence.registrationOpensAt > now ||
          occurrence.registrationClosesAt <= now ||
          (occurrence.approvalMode === "automatic" &&
            occurrence.confirmedCount >= occurrence.capacity)
        )
          return { result: { status: "unavailable" } as const };
        if (occurrence.registrationMode === "required_restricted") {
          const domain = user.emailVerified ? emailDomain(user.email) : null;
          const permitted = domain
            ? await transaction
                .selectFrom("event_occurrence_domain")
                .select("domain")
                .where(
                  "eventOccurrenceId",
                  "=",
                  assignmentTarget.eventOccurrenceId,
                )
                .where("domain", "=", domain)
                .executeTakeFirst()
            : null;
          if (!permitted) return { result: { status: "unavailable" } as const };
        }
      }
    }
    const row = await transaction
      .selectFrom("registration_questionnaire_assignment as assignment")
      .innerJoin(
        "registration_questionnaire_response as response",
        "response.assignmentId",
        "assignment.id",
      )
      .innerJoin(
        "survey_version",
        "survey_version.id",
        "assignment.surveyVersionId",
      )
      .select([
        "assignment.status",
        "assignment.eventOccurrenceId",
        "assignment.eventOccurrenceRegionId",
        "assignment.enrollmentId",
        "response.answers",
        "response.visitedItemIds",
        "response.currentItemId",
        "response.submittedAt",
        "survey_version.content",
      ])
      .where("assignment.id", "=", input.assignmentId)
      .where("assignment.userId", "=", user.id)
      .forUpdate("assignment")
      .executeTakeFirst();
    if (!row) return { result: { status: "not-found" } as const };
    if (row.status === "waived")
      return { result: { status: "unavailable" } as const };
    let content = parseSurveyVersionContent(row.content);
    let eventRegions: Array<{ id: string; regionId: string }> = [];
    if (row.eventOccurrenceId) {
      const occurrenceRegions = await transaction
        .selectFrom("event_occurrence_region")
        .select(["id", "regionId", "retiredAt"])
        .where("eventOccurrenceId", "=", row.eventOccurrenceId)
        .execute();
      eventRegions = occurrenceRegions.filter(
        (region) =>
          !region.retiredAt ||
          region.id === eventRegistration?.eventOccurrenceRegionId,
      );
      if (eventRegions.length)
        content = filterRegistrationEventRegionOptions(
          content,
          new Set(eventRegions.map((region) => region.regionId)),
        );
    }
    const storedAnswerValues = storedAnswers(row.answers);
    const items = surveyPathItems(content, storedAnswerValues);
    if (row.status === "completed" && row.submittedAt) {
      if (
        row.eventOccurrenceId &&
        (await needsOrdinaryEventRegistration(
          transaction,
          row.eventOccurrenceId,
          user.id,
        ))
      ) {
        const registrationUser = await currentRegistrationUser(
          transaction,
          user,
        );
        const registration = await registerLearnerForEventInTransaction(
          transaction,
          row.eventOccurrenceId,
          row.eventOccurrenceRegionId,
          registrationUser,
        );
        if (
          registration.status !== "registered" &&
          registration.status !== "already-registered"
        )
          throw new EventRegistrationFinalizationError();
      }
      return {
        result: {
          status: "submitted",
          progress: deriveProgress(content, {
            answers: storedAnswerValues,
            visitedItemIds: items.map((item) => item.id),
            currentItemId: null,
            completedAt: row.submittedAt,
          }),
          completedCourse: false,
        } as const,
      };
    }
    const item = items.find((candidate) => candidate.id === input.itemId);
    if (!item)
      return {
        result: {
          status: "invalid",
          message: "The registration form has changed. Refresh and try again.",
        } as const,
      };
    const existingVisited = storedVisited(row.visitedItemIds);
    if (!existingVisited.includes(item.id) && row.currentItemId !== item.id)
      return {
        result: {
          status: "invalid",
          message: "Complete the current registration item before continuing.",
        } as const,
      };
    let answers = { ...storedAnswerValues };
    let selectedOccurrenceRegionId = eventRegions.some(
      (region) => region.id === row.eventOccurrenceRegionId,
    )
      ? row.eventOccurrenceRegionId
      : eventRegions.some(
            (region) =>
              region.id === eventRegistration?.eventOccurrenceRegionId,
          )
        ? (eventRegistration?.eventOccurrenceRegionId ?? null)
        : null;
    let invalidatedQuestionId: string | null = null;
    if (item.kind === "instruction") {
      if (typeof input.answer !== "undefined")
        return {
          result: {
            status: "invalid",
            message: "This information block does not require an answer.",
          } as const,
        };
    } else {
      const validation = validateAnswer(item, input.answer);
      if (!validation.valid)
        return {
          result: {
            status: "invalid",
            message: validation.message,
          } as const,
        };
      if (typeof validation.answer === "undefined")
        answers = withoutRegistrationAnswer(answers, item.id);
      else answers[item.id] = validation.answer;
      if (
        isOperationalRegionQuestion(item) &&
        typeof validation.answer === "undefined"
      )
        selectedOccurrenceRegionId = null;
      if (
        isOperationalRegionQuestion(item) &&
        typeof validation.answer === "string" &&
        row.eventOccurrenceId &&
        eventRegions.length > 0
      ) {
        if (
          !operationalRegionMatchesSelectedGroup(
            content,
            answers,
            item,
            validation.answer,
          )
        )
          return {
            result: {
              status: "invalid",
              message:
                "Choose an operational region in the selected region group.",
            } as const,
          };
        const coordinationRegionId = item.options.find(
          (option) => option.id === validation.answer,
        )?.externalValue;
        const occurrenceRegion = eventRegions.find(
          (region) => region.regionId === coordinationRegionId,
        );
        if (!occurrenceRegion)
          return {
            result: {
              status: "invalid",
              message: "Choose a region offered for this event.",
            } as const,
          };
        selectedOccurrenceRegionId = occurrenceRegion.id;
      }
      if (isRegionGroupQuestion(item)) {
        const operationalQuestion = registrationQuestions(content).find(
          isOperationalRegionQuestion,
        );
        const operationalAnswer = operationalQuestion
          ? answers[operationalQuestion.id]
          : undefined;
        const selectedGroup =
          typeof validation.answer === "string"
            ? item.options.find((option) => option.id === validation.answer)
                ?.externalValue
            : undefined;
        const selectedOperational =
          operationalQuestion && typeof operationalAnswer === "string"
            ? operationalQuestion.options.find(
                (option) => option.id === operationalAnswer,
              )
            : undefined;
        if (selectedOperational?.parentExternalValue !== selectedGroup) {
          if (operationalQuestion)
            answers = withoutRegistrationAnswer(
              answers,
              operationalQuestion.id,
            );
          invalidatedQuestionId = operationalQuestion?.id ?? null;
          selectedOccurrenceRegionId = null;
        }
      }
    }
    const nextItems = surveyPathItems(content, answers);
    const availableIds = new Set(nextItems.map((candidate) => candidate.id));
    answers = Object.fromEntries(
      Object.entries(answers).filter(([questionId]) =>
        availableIds.has(questionId),
      ),
    );
    const visitedItemIds = [
      ...new Set(
        [...existingVisited, item.id].filter(
          (visitedId) =>
            availableIds.has(visitedId) && visitedId !== invalidatedQuestionId,
        ),
      ),
    ];
    const visited = new Set(visitedItemIds);
    const pathCompleted =
      nextItems.length > 0 &&
      nextItems.every((candidate) => visited.has(candidate.id));
    if (pathCompleted && eventRegions.length > 0 && !selectedOccurrenceRegionId)
      return {
        result: {
          status: "invalid",
          message: "Choose an operational region before registering.",
        } as const,
      };
    const awaitingProfileUpdateChoice =
      pathCompleted &&
      registrationOffersProfileUpdate(content) &&
      typeof input.profileUpdateAccepted === "undefined";
    const completed = pathCompleted && !awaitingProfileUpdateChoice;
    const now = new Date();
    const currentItemId = completed
      ? null
      : awaitingProfileUpdateChoice
        ? (nextItems.at(-1)?.id ?? null)
        : (nextItems.find((candidate) => !visited.has(candidate.id))?.id ??
          null);
    if (completed && input.profileUpdateAccepted) {
      const profileUpdateError = await validateProfileUpdates(
        transaction,
        user.id,
        content,
        answers,
      );
      if (profileUpdateError)
        return {
          result: { status: "invalid", message: profileUpdateError } as const,
        };
    }
    const eventRegionChanged = Boolean(
      completed &&
      eventRegistration &&
      eventRegistration.eventOccurrenceRegionId !== selectedOccurrenceRegionId,
    );
    if (
      eventRegionChanged &&
      eventRegistration?.eventOccurrenceRegionId &&
      (eventRegistration.reviewRoundId ||
        eventRegistration.coordinatorDecidedAt ||
        eventRegistration.finalDecidedAt ||
        eventRegistration.lockedInAt ||
        eventRegistration.regionMismatchAcknowledgedAt ||
        eventRegistration.regionalReviewWaivedAt)
    )
      return {
        result: {
          status: "invalid",
          message:
            "Your registration region can no longer be changed here. Ask an administrator to reassign it.",
        } as const,
      };
    await transaction
      .updateTable("registration_questionnaire_response")
      .set({
        answers,
        visitedItemIds: JSON.stringify(visitedItemIds),
        currentItemId,
        updatedAt: now,
        submittedAt: completed ? now : null,
        profileUpdateAcceptedAt:
          completed && input.profileUpdateAccepted ? now : null,
      })
      .where("assignmentId", "=", input.assignmentId)
      .execute();
    await transaction
      .updateTable("registration_questionnaire_assignment")
      .set({
        status: completed ? "completed" : "in_progress",
        startedAt: row.status === "assigned" ? now : undefined,
        completedAt: completed ? now : null,
        eventOccurrenceRegionId: selectedOccurrenceRegionId,
      })
      .where("id", "=", input.assignmentId)
      .execute();
    if (completed && input.profileUpdateAccepted)
      await applyProfileUpdates(transaction, user.id, content, answers, now);
    if (completed && row.eventOccurrenceId) {
      await transaction
        .updateTable("event_registration")
        .set({ eventOccurrenceRegionId: selectedOccurrenceRegionId })
        .where("eventOccurrenceId", "=", row.eventOccurrenceId)
        .where("userId", "=", user.id)
        .execute();
      if (eventRegionChanged && eventRegistration) {
        await transaction
          .insertInto("event_registration_transition")
          .values({
            id: `event_registration_transition_${randomUUID()}`,
            eventRegistrationId: eventRegistration.id,
            fromStatus: eventRegistration.status,
            toStatus: eventRegistration.status,
            fromEventOccurrenceRegionId:
              eventRegistration.eventOccurrenceRegionId,
            toEventOccurrenceRegionId: selectedOccurrenceRegionId,
            source: "learner",
            actorUserId: user.id,
            priority: eventRegistration.coordinatorPriority,
            occurredAt: now,
          })
          .execute();
        await recordDurableAuditEvent(transaction, {
          actorUserId: user.id,
          action: "event_registration.region_reassigned",
          subjectType: "event_registration",
          subjectId: eventRegistration.id,
          aggregateId: row.eventOccurrenceId,
          metadata: {
            source: "registration_questionnaire",
            fromEventOccurrenceRegionId:
              eventRegistration.eventOccurrenceRegionId,
            toEventOccurrenceRegionId: selectedOccurrenceRegionId,
          },
          createdAt: now,
        });
      }
      await transaction
        .updateTable("event_participation")
        .set({ detailsSubmittedAt: now })
        .where("eventOccurrenceId", "=", row.eventOccurrenceId)
        .where("userId", "=", user.id)
        .execute();
    }
    const progress = deriveProgress(content, {
      answers,
      visitedItemIds,
      currentItemId,
      completedAt: completed ? now : null,
    });
    if (
      completed &&
      row.eventOccurrenceId &&
      (await needsOrdinaryEventRegistration(
        transaction,
        row.eventOccurrenceId,
        user.id,
      ))
    ) {
      const registrationUser = await currentRegistrationUser(transaction, user);
      const registration = await registerLearnerForEventInTransaction(
        transaction,
        row.eventOccurrenceId,
        selectedOccurrenceRegionId,
        registrationUser,
      );
      if (
        registration.status !== "registered" &&
        registration.status !== "already-registered"
      )
        throw new EventRegistrationFinalizationError();
    }
    return {
      result: {
        status: completed ? "submitted" : "advanced",
        progress,
        completedCourse: false,
      } as const,
    };
  });
  let outcome: LearnerRegistrationQuestionnaireStepResult;
  try {
    outcome = (await transactionOutcome).result;
  } catch (error) {
    if (error instanceof EventRegistrationFinalizationError)
      return {
        status: "invalid",
        message: "Registration is no longer available.",
      };
    throw error;
  }
  if (outcome.status === "submitted")
    logServerEvent({
      level: "info",
      event: "registration_questionnaire.completed",
      fields: {
        actorUserId: user.id,
        entityType: "registration_questionnaire_assignment",
        entityId: input.assignmentId,
      },
    });
  return outcome;
}
