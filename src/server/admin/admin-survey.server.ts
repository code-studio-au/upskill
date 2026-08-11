import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type {
  AdminSurveyDetail,
  AdminSurveyDraft,
  AdminSurveySummary,
  SurveyVersionContent,
} from "#/features/survey/survey.schema";
import {
  adminSurveyDraftSchema,
  parseSurveyVersionContent,
  surveyVersionContentSchema,
} from "#/features/survey/survey.schema";
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

export async function findAdminSurveys(): Promise<Array<AdminSurveySummary>> {
  const database = getDatabase();
  const [surveys, versions, courseUsage] = await Promise.all([
    database
      .selectFrom("learning_activity")
      .select(["id", "title"])
      .where("kind", "=", "survey")
      .orderBy("title")
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
      latestVersion: surveyVersions[0]?.version ?? 0,
      draftVersion:
        surveyVersions.find((version) => version.publishedAt === null)
          ?.version ?? null,
      publishedVersions: surveyVersions.filter(
        (version) => version.publishedAt !== null,
      ).length,
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
): Promise<AdminSurveyDetail | null> {
  const database = getDatabase();
  const survey = await database
    .selectFrom("learning_activity")
    .select(["id", "title"])
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
  const version =
    versions.find((candidate) => candidate.publishedAt === null) ?? versions[0];
  if (!version) throw new Error("Survey has no version");
  const content = parseSurveyVersionContent(version.content);
  return {
    survey,
    version: {
      id: version.id,
      version: version.version,
      publishedAt: version.publishedAt?.toISOString() ?? null,
      editable: version.publishedAt === null,
    },
    versions: versions.map((candidate) => ({
      id: candidate.id,
      version: candidate.version,
      publishedAt: candidate.publishedAt?.toISOString() ?? null,
    })),
    draft: adminSurveyDraftSchema.parse({
      surveyId,
      versionId: version.id,
      ...content,
    }),
  };
}

export async function createAdminSurvey(
  title: string,
  user: AuthenticatedUser,
): Promise<{ surveyId: string; versionId: string }> {
  const database = getDatabase();
  const surveyId = `survey_${randomUUID()}`;
  const versionId = `survey_version_${randomUUID()}`;
  const now = new Date();
  await database.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("learning_activity")
      .values({ id: surveyId, kind: "survey", title, createdAt: now })
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
      metadata: { versionId },
      createdAt: now,
    });
  });
  return { surveyId, versionId };
}

export async function saveAdminSurveyDraft(
  draft: AdminSurveyDraft,
  user: AuthenticatedUser,
): Promise<"saved" | "not-found" | "published"> {
  const database = getDatabase();
  const content = surveyVersionContentSchema.parse(draft);
  const saved = await database.transaction().execute(async (transaction) => {
    const version = await transaction
      .selectFrom("learning_activity_version")
      .select(["id", "publishedAt"])
      .where("id", "=", draft.versionId)
      .where("activityId", "=", draft.surveyId)
      .where("kind", "=", "survey")
      .forUpdate()
      .executeTakeFirst();
    if (!version) return "not-found" as const;
    if (version.publishedAt) return "published" as const;
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
        "learning_activity_version.version",
        "survey_version.content",
        "learning_activity_version.publishedAt",
      ])
      .where("learning_activity_version.activityId", "=", surveyId)
      .orderBy("learning_activity_version.version", "desc")
      .execute();
    if (versions.some((version) => version.publishedAt === null))
      return { status: "draft-exists" } as const;
    const latest = versions[0];
    if (!latest?.publishedAt) return { status: "unpublished" } as const;
    const versionId = `survey_version_${randomUUID()}`;
    const now = new Date();
    await transaction
      .insertInto("learning_activity_version")
      .values({
        id: versionId,
        activityId: surveyId,
        kind: "survey",
        version: latest.version + 1,
        publishedAt: null,
        createdAt: now,
      })
      .execute();
    await transaction
      .insertInto("survey_version")
      .values({
        id: versionId,
        content: parseSurveyVersionContent(latest.content),
      })
      .execute();
    await recordDurableAuditEvent(transaction, {
      actorUserId: user.id,
      action: "survey.version_created",
      subjectType: "survey",
      subjectId: surveyId,
      metadata: { versionId, version: latest.version + 1 },
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
  return await database.transaction().execute(async (transaction) => {
    const version = await transaction
      .selectFrom("learning_activity_version")
      .innerJoin(
        "survey_version",
        "survey_version.id",
        "learning_activity_version.id",
      )
      .select([
        "learning_activity_version.version",
        "survey_version.content",
        "learning_activity_version.publishedAt",
      ])
      .where("learning_activity_version.id", "=", versionId)
      .where("learning_activity_version.activityId", "=", surveyId)
      .forUpdate()
      .executeTakeFirst();
    if (!version) return "not-found" as const;
    if (version.publishedAt) return "invalid" as const;
    const content = parseSurveyVersionContent(version.content);
    if (
      content.sections.length === 0 ||
      content.sections.some((section) => section.items.length === 0)
    )
      return "invalid" as const;
    const now = new Date();
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
