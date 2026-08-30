import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type {
  AdminSurveyDetail,
  AdminSurveyDraft,
  AdminSurveySummary,
  SurveyOption,
  SurveyVersionContent,
} from "#/features/survey/survey.schema";
import {
  applyRegionDirectoryOptions,
  adminSurveyDraftSchema,
  isOperationalRegionQuestion,
  isRegionGroupQuestion,
  parseSurveyVersionContent,
  surveyProfileField,
  surveyVersionContentSchema,
} from "#/features/survey/survey.schema";
import { operationalRegionPathsIncludeRegionGroup } from "#/features/survey/survey-branching";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import { logServerEvent } from "#/server/logging/server-logger";
import { findContentCourseVersionUsage } from "#/server/admin/content-usage.server";

function blankSurvey(title: string): SurveyVersionContent {
  return {
    title,
    description: "",
    sections: [
      {
        id: `section_${randomUUID()}`,
        title: "Section 1",
        description: "",
        items: [],
      },
    ],
  };
}

async function findRegionDirectoryOptions(): Promise<{
  regionGroups: Array<SurveyOption>;
  operationalRegions: Array<SurveyOption>;
}> {
  const database = getDatabase();
  const [groups, operationalRegions] = await Promise.all([
    database
      .selectFrom("coordination_region")
      .select(["id", "name", "code"])
      .where("kind", "=", "group")
      .where("status", "=", "active")
      .orderBy("name")
      .execute(),
    database
      .selectFrom("coordination_region as region")
      .innerJoin(
        "coordination_region as parent",
        "parent.id",
        "region.parentId",
      )
      .select(["region.id", "region.name", "region.code", "region.parentId"])
      .where("region.kind", "=", "operational")
      .where("region.status", "=", "active")
      .where("parent.kind", "=", "group")
      .where("parent.status", "=", "active")
      .orderBy("parent.name")
      .orderBy("region.name")
      .execute(),
  ]);
  return {
    regionGroups: groups.map((group) => ({
      id: group.id,
      label: `${group.name} (${group.code})`,
      externalValue: group.id,
    })),
    operationalRegions: operationalRegions.map((region) => ({
      id: region.id,
      label: `${region.name} (${region.code})`,
      externalValue: region.id,
      parentExternalValue: region.parentId ?? undefined,
    })),
  };
}

function regionDirectoryQuestionSummary(content: SurveyVersionContent): {
  groups: number;
  operationalRegions: number;
  groupIndex: number;
  operationalIndex: number;
  profileQuestions: number;
  profileQuestionsValid: boolean;
} {
  let groups = 0;
  let operationalRegions = 0;
  let groupIndex = -1;
  let operationalIndex = -1;
  let profileQuestions = 0;
  let profileQuestionsValid = true;
  const profileFields = new Set<string>();
  let itemIndex = 0;
  for (const section of content.sections)
    for (const item of section.items) {
      if (isRegionGroupQuestion(item)) {
        groups += 1;
        if (groupIndex < 0) groupIndex = itemIndex;
      }
      if (isOperationalRegionQuestion(item)) {
        operationalRegions += 1;
        if (operationalIndex < 0) operationalIndex = itemIndex;
      }
      const profileField = surveyProfileField(item);
      if (profileField) {
        profileQuestions += 1;
        if (profileFields.has(profileField)) profileQuestionsValid = false;
        profileFields.add(profileField);
        if (!(
          (item.kind === "short_text" &&
            item.required &&
            ((profileField === "name" && item.format === "plain") ||
              (profileField === "phone" && item.format === "phone"))) ||
          (item.kind === "checkbox" &&
            !item.required &&
            (profileField === "emailEnabled" || profileField === "smsEnabled"))
        ))
          profileQuestionsValid = false;
      }
      itemIndex += 1;
    }
  return {
    groups,
    operationalRegions,
    groupIndex,
    operationalIndex,
    profileQuestions,
    profileQuestionsValid,
  };
}

export async function findAdminSurveys(): Promise<Array<AdminSurveySummary>> {
  const database = getDatabase();
  const [surveys, versions, courseUsage] = await Promise.all([
    database
      .selectFrom("learning_activity")
      .select(["id", "title", "surveyUsage", "surveyType", "surveyPosition"])
      .where("kind", "=", "survey")
      .orderBy("surveyType")
      .orderBy("surveyPosition")
      .orderBy("id")
      .execute(),
    database
      .selectFrom("learning_activity_version")
      .select(["id", "activityId as surveyId", "version", "publishedAt"])
      .where("kind", "=", "survey")
      .orderBy("version", "desc")
      .execute(),
    findContentCourseVersionUsage(),
  ]);
  return surveys.map((survey) => {
    const surveyVersions = versions.filter(
      (version) => version.surveyId === survey.id,
    );
    return {
      id: survey.id,
      title: survey.title,
      usage: survey.surveyUsage === "onboarding" ? "onboarding" : "learning",
      type: survey.surveyType ?? "elearning",
      position: survey.surveyPosition ?? 0,
      draftVersion:
        surveyVersions.find((version) => version.publishedAt === null)
          ?.version ?? null,
      publishedVersion:
        surveyVersions.find((version) => version.publishedAt !== null)
          ?.version ?? null,
      versions: surveyVersions.map((version) => ({
        id: version.id,
        version: version.version,
        publishedAt: version.publishedAt?.toISOString() ?? null,
        courseUsages: courseUsage.surveys.get(version.id) ?? [],
      })),
    };
  });
}

export async function findAdminSurvey(
  surveyId: string,
  requestedVersionId?: string,
): Promise<AdminSurveyDetail | null> {
  const database = getDatabase();
  const survey = await database
    .selectFrom("learning_activity")
    .select(["id", "title", "surveyUsage", "surveyType"])
    .where("id", "=", surveyId)
    .where("kind", "=", "survey")
    .executeTakeFirst();
  if (!survey) return null;
  const versions = await database
    .selectFrom("learning_activity_version")
    .innerJoin(
      "survey_version",
      "survey_version.id",
      "learning_activity_version.id",
    )
    .select([
      "learning_activity_version.id",
      "learning_activity_version.version",
      "survey_version.content",
      "learning_activity_version.publishedAt",
    ])
    .where("learning_activity_version.activityId", "=", surveyId)
    .orderBy("learning_activity_version.version", "desc")
    .execute();
  const version = requestedVersionId
    ? versions.find((candidate) => candidate.id === requestedVersionId)
    : (versions.find((candidate) => candidate.publishedAt === null) ??
      versions[0]);
  if (requestedVersionId && !version) return null;
  if (!version) throw new Error("Survey has no version");
  const parsedContent = parseSurveyVersionContent(version.content);
  const [courseUsage, regionDirectoryOptions] = await Promise.all([
    findContentCourseVersionUsage(),
    findRegionDirectoryOptions(),
  ]);
  const content =
    version.publishedAt === null && survey.surveyUsage === "onboarding"
      ? applyRegionDirectoryOptions(parsedContent, regionDirectoryOptions)
      : parsedContent;
  return {
    survey: {
      id: survey.id,
      title: survey.title,
      usage: survey.surveyUsage === "onboarding" ? "onboarding" : "learning",
      type: survey.surveyType ?? "elearning",
    },
    version: {
      id: version.id,
      version: version.version,
      publishedAt: version.publishedAt?.toISOString() ?? null,
      editable: version.publishedAt === null,
      courseUsages: courseUsage.surveys.get(version.id) ?? [],
    },
    versions: versions.map((candidate) => ({
      id: candidate.id,
      version: candidate.version,
      publishedAt: candidate.publishedAt?.toISOString() ?? null,
    })),
    regionGroupOptions:
      survey.surveyUsage === "onboarding"
        ? regionDirectoryOptions.regionGroups
        : [],
    operationalRegionOptions:
      survey.surveyUsage === "onboarding"
        ? regionDirectoryOptions.operationalRegions
        : [],
    draft: adminSurveyDraftSchema.parse({
      surveyId,
      versionId: version.id,
      ...content,
    }),
  };
}

export async function createAdminSurvey(
  title: string,
  type: "system" | "elearning" | "event" | "shared",
  user: AuthenticatedUser,
): Promise<{ surveyId: string; versionId: string }> {
  const database = getDatabase();
  const surveyId = `survey_${randomUUID()}`;
  const versionId = `survey_version_${randomUUID()}`;
  const now = new Date();
  await database.transaction().execute(async (transaction) => {
    await sql`select pg_advisory_xact_lock(
      hashtext(${`survey_order:${type}`})
    )`.execute(transaction);
    const last = await transaction
      .selectFrom("learning_activity")
      .select(({ fn }) =>
        fn.max<number | null>("surveyPosition").as("position"),
      )
      .where("kind", "=", "survey")
      .where("surveyType", "=", type)
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto("learning_activity")
      .values({
        id: surveyId,
        kind: "survey",
        title,
        surveyUsage: type === "system" ? "onboarding" : "learning",
        surveyType: type,
        surveyPosition: (last.position ?? -1) + 1,
        createdAt: now,
      })
      .execute();
    await transaction
      .insertInto("learning_activity_version")
      .values({
        id: versionId,
        activityId: surveyId,
        kind: "survey",
        version: 1,
        publishedAt: null,
        createdAt: now,
      })
      .execute();
    await transaction
      .insertInto("survey_version")
      .values({ id: versionId, content: blankSurvey(title) })
      .execute();
    await recordDurableAuditEvent(transaction, {
      actorUserId: user.id,
      action: "survey.created",
      subjectType: "survey",
      subjectId: surveyId,
      metadata: { type, versionId },
      createdAt: now,
    });
  });
  return { surveyId, versionId };
}

export async function moveAdminSurvey(
  input: { surveyId: string; direction: "down" | "up" },
  user: AuthenticatedUser,
): Promise<"boundary" | "moved" | "not-found"> {
  return getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const candidate = await transaction
        .selectFrom("learning_activity")
        .select(["id", "surveyType"])
        .where("id", "=", input.surveyId)
        .where("kind", "=", "survey")
        .executeTakeFirst();
      if (!candidate?.surveyType) return "not-found";
      await sql`select pg_advisory_xact_lock(
        hashtext(${`survey_order:${candidate.surveyType}`})
      )`.execute(transaction);
      const surveys = await transaction
        .selectFrom("learning_activity")
        .select(["id", "surveyPosition"])
        .where("kind", "=", "survey")
        .where("surveyType", "=", candidate.surveyType)
        .orderBy("surveyPosition")
        .orderBy("id")
        .forUpdate()
        .execute();
      const index = surveys.findIndex((survey) => survey.id === candidate.id);
      const current = surveys[index];
      const target = surveys[index + (input.direction === "up" ? -1 : 1)];
      if (!current?.surveyPosition && current?.surveyPosition !== 0)
        return "not-found";
      if (!target?.surveyPosition && target?.surveyPosition !== 0)
        return "boundary";
      await transaction
        .updateTable("learning_activity")
        .set({ surveyPosition: target.surveyPosition })
        .where("id", "=", current.id)
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable("learning_activity")
        .set({ surveyPosition: current.surveyPosition })
        .where("id", "=", target.id)
        .executeTakeFirstOrThrow();
      await recordDurableAuditEvent(transaction, {
        actorUserId: user.id,
        action: "survey.reordered",
        subjectType: "survey",
        subjectId: current.id,
        aggregateId: current.id,
        metadata: {
          direction: input.direction,
          fromPosition: current.surveyPosition,
          toPosition: target.surveyPosition,
          type: candidate.surveyType,
        },
      });
      return "moved";
    });
}

export async function saveAdminSurveyDraft(
  draft: AdminSurveyDraft,
  user: AuthenticatedUser,
): Promise<"saved" | "not-found" | "published" | "invalid"> {
  const database = getDatabase();
  const parsedContent = surveyVersionContentSchema.parse(draft);
  const regionDirectoryOptions = await findRegionDirectoryOptions();
  const saved = await database.transaction().execute(async (transaction) => {
    const version = await transaction
      .selectFrom("learning_activity_version")
      .innerJoin(
        "learning_activity",
        "learning_activity.id",
        "learning_activity_version.activityId",
      )
      .select([
        "learning_activity_version.id",
        "learning_activity_version.publishedAt",
        "learning_activity.surveyUsage",
      ])
      .where("learning_activity_version.id", "=", draft.versionId)
      .where("learning_activity_version.activityId", "=", draft.surveyId)
      .where("learning_activity_version.kind", "=", "survey")
      .forUpdate()
      .executeTakeFirst();
    if (!version) return "not-found" as const;
    if (version.publishedAt) return "published" as const;
    const regionQuestionCounts = regionDirectoryQuestionSummary(parsedContent);
    if (
      regionQuestionCounts.groups > 1 ||
      regionQuestionCounts.operationalRegions > 1 ||
      !regionQuestionCounts.profileQuestionsValid ||
      ((regionQuestionCounts.groups > 0 ||
        regionQuestionCounts.operationalRegions > 0 ||
        regionQuestionCounts.profileQuestions > 0) &&
        version.surveyUsage !== "onboarding")
    )
      return "invalid" as const;
    const content = surveyVersionContentSchema.parse(
      applyRegionDirectoryOptions(parsedContent, regionDirectoryOptions),
    );
    await transaction
      .updateTable("survey_version")
      .set({ content })
      .where("id", "=", draft.versionId)
      .execute();
    await transaction
      .updateTable("learning_activity")
      .set({ title: content.title })
      .where("id", "=", draft.surveyId)
      .execute();
    return "saved" as const;
  });
  if (saved === "saved")
    logServerEvent({
      level: "info",
      event: "survey.draft_saved",
      fields: {
        actorUserId: user.id,
        entityType: "survey",
        entityId: draft.surveyId,
      },
    });
  return saved;
}

export async function createAdminSurveyVersion(
  surveyId: string,
  sourceVersionId: string,
  user: AuthenticatedUser,
): Promise<
  | { status: "created"; versionId: string }
  | { status: "not-found" | "draft-exists" | "unpublished" }
> {
  const database = getDatabase();
  return await database.transaction().execute(async (transaction) => {
    const survey = await transaction
      .selectFrom("learning_activity")
      .select("id")
      .where("id", "=", surveyId)
      .where("kind", "=", "survey")
      .forUpdate()
      .executeTakeFirst();
    if (!survey) return { status: "not-found" } as const;
    const versions = await transaction
      .selectFrom("learning_activity_version")
      .innerJoin(
        "survey_version",
        "survey_version.id",
        "learning_activity_version.id",
      )
      .select([
        "learning_activity_version.id",
        "learning_activity_version.version",
        "survey_version.content",
        "learning_activity_version.publishedAt",
      ])
      .where("learning_activity_version.activityId", "=", surveyId)
      .orderBy("learning_activity_version.version", "desc")
      .execute();
    if (versions.some((version) => version.publishedAt === null))
      return { status: "draft-exists" } as const;
    const source = versions.find(
      (version) => version.id === sourceVersionId && version.publishedAt,
    );
    if (!source) return { status: "unpublished" } as const;
    const nextVersion = Math.max(...versions.map(({ version }) => version)) + 1;
    const versionId = `survey_version_${randomUUID()}`;
    const now = new Date();
    await transaction
      .insertInto("learning_activity_version")
      .values({
        id: versionId,
        activityId: surveyId,
        kind: "survey",
        version: nextVersion,
        publishedAt: null,
        createdAt: now,
      })
      .execute();
    await transaction
      .insertInto("survey_version")
      .values({
        id: versionId,
        content: parseSurveyVersionContent(source.content),
      })
      .execute();
    await recordDurableAuditEvent(transaction, {
      actorUserId: user.id,
      action: "survey.version_created",
      subjectType: "survey",
      subjectId: surveyId,
      metadata: {
        versionId,
        version: nextVersion,
        sourceVersionId: source.id,
      },
      createdAt: now,
    });
    return { status: "created", versionId } as const;
  });
}

export async function publishAdminSurveyVersion(
  surveyId: string,
  versionId: string,
  user: AuthenticatedUser,
): Promise<"published" | "not-found" | "invalid"> {
  const database = getDatabase();
  const regionDirectoryOptions = await findRegionDirectoryOptions();
  return await database.transaction().execute(async (transaction) => {
    const version = await transaction
      .selectFrom("learning_activity_version")
      .innerJoin(
        "survey_version",
        "survey_version.id",
        "learning_activity_version.id",
      )
      .innerJoin(
        "learning_activity",
        "learning_activity.id",
        "learning_activity_version.activityId",
      )
      .select([
        "learning_activity_version.version",
        "survey_version.content",
        "learning_activity_version.publishedAt",
        "learning_activity.surveyUsage",
      ])
      .where("learning_activity_version.id", "=", versionId)
      .where("learning_activity_version.activityId", "=", surveyId)
      .forUpdate()
      .executeTakeFirst();
    if (!version) return "not-found" as const;
    if (version.publishedAt) return "invalid" as const;
    const parsedContent = parseSurveyVersionContent(version.content);
    const regionQuestionCounts = regionDirectoryQuestionSummary(parsedContent);
    if (
      regionQuestionCounts.groups > 1 ||
      regionQuestionCounts.operationalRegions > 1 ||
      !regionQuestionCounts.profileQuestionsValid ||
      ((regionQuestionCounts.groups > 0 ||
        regionQuestionCounts.operationalRegions > 0 ||
        regionQuestionCounts.profileQuestions > 0) &&
        version.surveyUsage !== "onboarding") ||
      (regionQuestionCounts.groups > 0 &&
        regionDirectoryOptions.regionGroups.length === 0) ||
      (regionQuestionCounts.operationalRegions > 0 &&
        (regionDirectoryOptions.operationalRegions.length === 0 ||
          regionQuestionCounts.groupIndex < 0 ||
          regionQuestionCounts.operationalIndex <
            regionQuestionCounts.groupIndex ||
          !operationalRegionPathsIncludeRegionGroup(parsedContent)))
    )
      return "invalid" as const;
    const content = applyRegionDirectoryOptions(
      parsedContent,
      regionDirectoryOptions,
    );
    if (
      content.sections.length === 0 ||
      content.sections.some((section) => section.items.length === 0)
    )
      return "invalid" as const;
    const now = new Date();
    await transaction
      .updateTable("survey_version")
      .set({ content })
      .where("id", "=", versionId)
      .execute();
    await transaction
      .updateTable("learning_activity_version")
      .set({ publishedAt: now })
      .where("id", "=", versionId)
      .execute();
    await recordDurableAuditEvent(transaction, {
      actorUserId: user.id,
      action: "survey.published",
      subjectType: "survey",
      subjectId: surveyId,
      metadata: { versionId, version: version.version },
      createdAt: now,
    });
    return "published" as const;
  });
}
