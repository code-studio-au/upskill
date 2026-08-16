import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type {
  AdminOnboardingData,
  OnboardingConfiguration,
} from "#/features/onboarding/onboarding.schema";
import {
  activateOnboardingSchema,
  onboardingProfileMappingSchema,
} from "#/features/onboarding/onboarding.schema";
import { parseSurveyVersionContent } from "#/features/survey/survey.schema";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import { logServerEvent } from "#/server/logging/server-logger";
import { z } from "#/validation/zod";

const DEFINITION_ID = "onboarding_definition_default";
type ProfileMapping = z.infer<typeof onboardingProfileMappingSchema>;

function parseMappings(value: unknown): Array<ProfileMapping> {
  const parsed = z.array(onboardingProfileMappingSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

export async function findAdminOnboarding(): Promise<AdminOnboardingData> {
  const database = getDatabase();
  const [surveyRows, configurationRows] = await Promise.all([
    database
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
        "survey_version.id",
        "survey_version.content",
        "learning_activity.id as surveyId",
        "learning_activity.title",
        "learning_activity_version.version",
      ])
      .where("learning_activity.surveyUsage", "=", "onboarding")
      .where("learning_activity_version.publishedAt", "is not", null)
      .orderBy("learning_activity.title")
      .orderBy("learning_activity_version.version", "desc")
      .execute(),
    database
      .selectFrom("onboarding_definition_version")
      .innerJoin(
        "learning_activity_version",
        "learning_activity_version.id",
        "onboarding_definition_version.surveyVersionId",
      )
      .innerJoin(
        "learning_activity",
        "learning_activity.id",
        "learning_activity_version.activityId",
      )
      .select([
        "onboarding_definition_version.id",
        "onboarding_definition_version.version",
        "onboarding_definition_version.surveyVersionId",
        "onboarding_definition_version.privacyNotice",
        "onboarding_definition_version.privacyNoticeVersion",
        "onboarding_definition_version.profileMappings",
        "onboarding_definition_version.activatedAt",
        "onboarding_definition_version.deactivatedAt",
        "learning_activity.title as surveyTitle",
        "learning_activity_version.version as surveyVersion",
      ])
      .where("onboarding_definition_version.definitionId", "=", DEFINITION_ID)
      .orderBy("onboarding_definition_version.version", "desc")
      .execute(),
  ]);
  const history: Array<OnboardingConfiguration> = configurationRows.map(
    (row) => ({
      id: row.id,
      version: row.version,
      surveyVersionId: row.surveyVersionId,
      surveyTitle: row.surveyTitle,
      surveyVersion: row.surveyVersion,
      privacyNotice: row.privacyNotice,
      privacyNoticeVersion: row.privacyNoticeVersion,
      profileMappings: parseMappings(row.profileMappings),
      activatedAt: row.activatedAt?.toISOString() ?? "",
      deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
    }),
  );
  return {
    active:
      history.find(
        (configuration) =>
          configuration.activatedAt && !configuration.deactivatedAt,
      ) ?? null,
    history,
    surveyVersions: surveyRows.map((row) => ({
      id: row.id,
      surveyId: row.surveyId,
      title: row.title,
      version: row.version,
      content: parseSurveyVersionContent(row.content),
    })),
  };
}

export async function activateOnboardingConfiguration(
  input: z.infer<typeof activateOnboardingSchema>,
  user: AuthenticatedUser,
): Promise<
  | { status: "activated"; configurationId: string }
  | { status: "invalid"; message: string }
> {
  const parsed = activateOnboardingSchema.parse(input);
  const database = getDatabase();
  return database.transaction().execute(async (transaction) => {
    const survey = await transaction
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
      .select(["survey_version.content"])
      .where("survey_version.id", "=", parsed.surveyVersionId)
      .where("learning_activity.surveyUsage", "=", "onboarding")
      .where("learning_activity_version.publishedAt", "is not", null)
      .executeTakeFirst();
    if (!survey)
      return {
        status: "invalid",
        message: "Choose a published onboarding survey.",
      };
    const content = parseSurveyVersionContent(survey.content);
    if (content.sections.every((section) => section.items.length === 0))
      return {
        status: "invalid",
        message: "The onboarding survey must contain at least one item.",
      };
    const questions = new Map(
      content.sections.flatMap((section) =>
        section.items.flatMap((item) =>
          item.kind === "instruction" ? [] : [[item.id, item] as const],
        ),
      ),
    );
    for (const mapping of parsed.profileMappings) {
      const question = questions.get(mapping.questionId);
      if (!question)
        return {
          status: "invalid",
          message: "A profile mapping question is no longer available.",
        };
      if (
        (mapping.destination === "name" &&
          question.kind !== "short_text" &&
          question.kind !== "long_text") ||
        (mapping.destination === "phone" && question.kind !== "short_text") ||
        (mapping.destination === "currentRegionId" &&
          question.kind !== "single_choice" &&
          question.kind !== "dropdown")
      )
        return {
          status: "invalid",
          message: "A profile mapping does not match its question type.",
        };
      if (
        mapping.destination === "currentRegionId" &&
        (question.kind === "single_choice" || question.kind === "dropdown")
      ) {
        const regionIds = question.options.flatMap((option) =>
          option.externalValue ? [option.externalValue] : [],
        );
        if (regionIds.length !== question.options.length)
          return {
            status: "invalid",
            message:
              "Every mapped region option needs an external value containing its region ID.",
          };
        const regions = await transaction
          .selectFrom("coordination_region")
          .select("id")
          .where("id", "in", regionIds)
          .where("status", "=", "active")
          .execute();
        if (
          new Set(regions.map((region) => region.id)).size !==
          new Set(regionIds).size
        )
          return {
            status: "invalid",
            message:
              "Every mapped region option must reference an active region.",
          };
      }
    }
    const now = new Date();
    await transaction
      .insertInto("onboarding_definition")
      .values({
        id: DEFINITION_ID,
        name: "Default user onboarding",
        createdAt: now,
      })
      .onConflict((conflict) => conflict.column("id").doNothing())
      .execute();
    const current = await transaction
      .selectFrom("onboarding_definition_version")
      .select((expression) => expression.fn.max("version").as("version"))
      .where("definitionId", "=", DEFINITION_ID)
      .executeTakeFirst();
    await transaction
      .updateTable("onboarding_definition_version")
      .set({ deactivatedAt: now })
      .where("definitionId", "=", DEFINITION_ID)
      .where("activatedAt", "is not", null)
      .where("deactivatedAt", "is", null)
      .execute();
    const configurationId = `onboarding_definition_version_${randomUUID()}`;
    await transaction
      .insertInto("onboarding_definition_version")
      .values({
        id: configurationId,
        definitionId: DEFINITION_ID,
        version: (current?.version ?? 0) + 1,
        surveyVersionId: parsed.surveyVersionId,
        privacyNotice: parsed.privacyNotice,
        privacyNoticeVersion: parsed.privacyNoticeVersion,
        profileMappings: JSON.stringify(parsed.profileMappings),
        publishedAt: now,
        activatedAt: now,
        deactivatedAt: null,
        createdAt: now,
      })
      .execute();
    logServerEvent({
      level: "info",
      event: "onboarding.configuration_activated",
      fields: {
        actorUserId: user.id,
        entityType: "onboarding_configuration",
        entityId: configurationId,
      },
    });
    return { status: "activated", configurationId };
  });
}
