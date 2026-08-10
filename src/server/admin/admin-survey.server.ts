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
      .selectFrom("survey")
      .select(["id", "title"])
      .orderBy("title")
      .execute(),
    database
      .selectFrom("survey_version")
      .select(["id", "surveyId", "version", "publishedAt"])
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
    .selectFrom("survey")
    .select(["id", "title"])
    .where("id", "=", surveyId)
    .executeTakeFirst();
  if (!survey) return null;
  const versions = await database
    .selectFrom("survey_version")
    .select(["id", "version", "content", "publishedAt"])
    .where("surveyId", "=", surveyId)
    .orderBy("version", "desc")
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
      .insertInto("survey")
      .values({ id: surveyId, title, createdAt: now })
      .execute();
    await transaction
      .insertInto("survey_version")
      .values({
        id: versionId,
        surveyId,
        version: 1,
        content: blankSurvey(title),
        publishedAt: null,
        createdAt: now,
      })
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
      .selectFrom("survey_version")
      .select(["id", "publishedAt"])
      .where("id", "=", draft.versionId)
      .where("surveyId", "=", draft.surveyId)
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
      .updateTable("survey")
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
      .selectFrom("survey")
      .select("id")
      .where("id", "=", surveyId)
      .forUpdate()
      .executeTakeFirst();
    if (!survey) return { status: "not-found" } as const;
    const versions = await transaction
      .selectFrom("survey_version")
      .select(["version", "content", "publishedAt"])
      .where("surveyId", "=", surveyId)
      .orderBy("version", "desc")
      .execute();
    if (versions.some((version) => version.publishedAt === null))
      return { status: "draft-exists" } as const;
    const latest = versions[0];
    if (!latest?.publishedAt) return { status: "unpublished" } as const;
    const versionId = `survey_version_${randomUUID()}`;
    const now = new Date();
    await transaction
      .insertInto("survey_version")
      .values({
        id: versionId,
        surveyId,
        version: latest.version + 1,
        content: parseSurveyVersionContent(latest.content),
        publishedAt: null,
        createdAt: now,
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
      .selectFrom("survey_version")
      .select(["version", "content", "publishedAt"])
      .where("id", "=", versionId)
      .where("surveyId", "=", surveyId)
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
      .updateTable("survey_version")
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
