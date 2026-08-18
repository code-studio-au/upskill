import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import {
  adminCourseDraftSchema,
  type AdminCourseCreateInput,
  type AdminCourseDetail,
  type AdminCourseDraft,
  type AdminCourseItem,
  type AdminCourseSummary,
} from "#/features/admin-course/admin-course.schema";
import {
  courseContentSchema,
  type CourseContent,
} from "#/features/catalog/catalog.schema";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { logServerEvent } from "#/server/logging/server-logger";

const ADMIN_COURSE_ROSTER_LIMIT = 100;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
function blankCourseContent(title: string): CourseContent {
  return {
    title,
    summary: "Course summary to be completed.",
    description: "Course description to be completed.",
    topic: "leadership",
    durationMinutes: 60,
    priceCents: 0,
    salePriceCents: null,
    bulkPricing: { enabled: false, tiers: [] },
    currency: "AUD",
    featured: false,
    listInStore: false,
    hasCompletionCertificate: false,
    prerequisites: [],
    accreditations: [],
    modules: [],
    sections: [],
  };
}

function contentFromDraft(draft: AdminCourseDraft): CourseContent {
  const modules = draft.sections.flatMap((section) =>
    section.items.flatMap((item) =>
      item.kind === "scorm"
        ? [
            {
              title: item.title,
              phase: "content" as const,
              durationMinutes: item.durationMinutes,
            },
          ]
        : [],
    ),
  );
  return courseContentSchema.parse({
    title: draft.title,
    summary: draft.summary,
    description: draft.description,
    topic: draft.topic,
    durationMinutes: draft.durationMinutes,
    priceCents: draft.priceCents,
    salePriceCents: draft.salePriceCents,
    bulkPricing: draft.bulkPricing,
    currency: "AUD",
    featured: draft.featured,
    listInStore: draft.listInStore,
    hasCompletionCertificate: draft.hasCompletionCertificate,
    prerequisites: draft.prerequisites,
    accreditations: draft.accreditations,
    modules,
    sections: draft.sections.map((section) => ({
      title: section.title,
      description: section.description,
      items: section.items.map((item) => ({
        title: item.title,
        kind: item.kind,
        required: item.required,
        durationMinutes: item.durationMinutes,
      })),
    })),
  });
}

function itemFromRow(row: {
  id: string;
  kind: "scorm" | "survey" | "resource";
  title: string;
  required: boolean;
  durationMinutes: number | null;
  learningActivityVersionId: string;
}): AdminCourseItem {
  if (row.kind === "scorm")
    return {
      id: row.id,
      kind: "scorm",
      title: row.title,
      required: row.required,
      durationMinutes: row.durationMinutes ?? 1,
      scormPackageVersionId: row.learningActivityVersionId,
    };
  if (row.kind === "survey")
    return {
      id: row.id,
      kind: "survey",
      title: row.title,
      required: row.required,
      durationMinutes: row.durationMinutes,
      surveyVersionId: row.learningActivityVersionId,
    };
  return {
    id: row.id,
    kind: "resource",
    title: row.title,
    required: row.required,
    durationMinutes: null,
    resourceVersionId: row.learningActivityVersionId,
  };
}

async function loadDraftStructure(
  transaction: Transaction<Database> | ReturnType<typeof getDatabase>,
  courseId: string,
  versionId: string,
  slug: string,
  content: CourseContent,
): Promise<AdminCourseDraft> {
  const rows = await transaction
    .selectFrom("course_version_section")
    .leftJoin(
      "course_version_item",
      "course_version_item.sectionId",
      "course_version_section.id",
    )
    .select([
      "course_version_section.id as sectionId",
      "course_version_section.title as sectionTitle",
      "course_version_section.description as sectionDescription",
      "course_version_section.position as sectionPosition",
      "course_version_item.id as itemId",
      "course_version_item.kind as itemKind",
      "course_version_item.title as itemTitle",
      "course_version_item.required as itemRequired",
      "course_version_item.durationMinutes",
      "course_version_item.position as itemPosition",
      "course_version_item.learningActivityVersionId",
    ])
    .where("course_version_section.courseVersionId", "=", versionId)
    .orderBy("course_version_section.position")
    .orderBy("course_version_item.position")
    .execute();

  const sections = new Map<string, AdminCourseDraft["sections"][number]>();
  for (const row of rows) {
    let section = sections.get(row.sectionId);
    if (!section) {
      section = {
        id: row.sectionId,
        title: row.sectionTitle,
        description: row.sectionDescription,
        items: [],
      };
      sections.set(row.sectionId, section);
    }
    if (
      row.itemId &&
      row.itemKind &&
      row.itemTitle &&
      row.learningActivityVersionId
    )
      section.items.push(
        itemFromRow({
          id: row.itemId,
          kind: row.itemKind,
          title: row.itemTitle,
          required: row.itemRequired ?? true,
          durationMinutes: row.durationMinutes,
          learningActivityVersionId: row.learningActivityVersionId,
        }),
      );
  }

  return adminCourseDraftSchema.parse({
    courseId,
    versionId,
    slug,
    title: content.title,
    summary: content.summary,
    description: content.description,
    topic: content.topic,
    durationMinutes: content.durationMinutes,
    priceCents: content.priceCents,
    salePriceCents: content.salePriceCents,
    bulkPricing: content.bulkPricing,
    featured: content.featured,
    listInStore: content.listInStore,
    hasCompletionCertificate: content.hasCompletionCertificate,
    prerequisites: content.prerequisites,
    accreditations: content.accreditations,
    sections: [...sections.values()],
  });
}

async function referenceCounts(
  transaction: Transaction<Database> | ReturnType<typeof getDatabase>,
  courseId: string,
): Promise<{ enrollments: number; commerce: number }> {
  const result = await sql<{ commerce: number; enrollments: number }>`select
    (select count(*)::integer
       from enrollment
       join course_version on course_version.id = enrollment."courseVersionId"
      where course_version."courseId" = ${courseId}) as enrollments,
    ((select count(*) from order_item
       join course_version on course_version.id = order_item."courseVersionId"
      where course_version."courseId" = ${courseId}) +
     (select count(*) from access_grant
       join course_version on course_version.id = access_grant."courseVersionId"
      where course_version."courseId" = ${courseId}))::integer as commerce`.execute(
    transaction,
  );
  const counts = result.rows[0];
  if (!counts) throw new Error("Course reference counts are unavailable");
  return counts;
}

export async function findAdminCourses(): Promise<Array<AdminCourseSummary>> {
  const database = getDatabase();
  const courses = await database
    .selectFrom("course")
    .leftJoin("course_version", "course_version.courseId", "course.id")
    .select([
      "course.id",
      "course.slug",
      "course.title",
      "course.status",
      sql<number>`coalesce(max(course_version.version), 0)::integer`.as(
        "latestVersion",
      ),
      sql<
        number | null
      >`max(course_version.version) filter (where course_version."publishedAt" is null)::integer`.as(
        "draftVersion",
      ),
    ])
    .groupBy(["course.id", "course.slug", "course.title", "course.status"])
    .orderBy("course.title")
    .execute();

  return await Promise.all(
    courses.map(async (course) => {
      const counts = await referenceCounts(database, course.id);
      return {
        ...course,
        enrollmentCount: counts.enrollments,
        commerceReferenceCount: counts.commerce,
        canDelete:
          course.status === "archived" &&
          counts.enrollments === 0 &&
          counts.commerce === 0,
      };
    }),
  );
}

export async function findAdminCourse(
  courseId: string,
): Promise<AdminCourseDetail | null> {
  const database = getDatabase();
  const course = await database
    .selectFrom("course")
    .select(["id", "slug", "title", "status"])
    .where("id", "=", courseId)
    .executeTakeFirst();
  if (!course) return null;
  const versions = await database
    .selectFrom("course_version")
    .select(["id", "version", "publishedAt", "content"])
    .where("courseId", "=", courseId)
    .orderBy("version", "desc")
    .execute();
  const version =
    versions.find((candidate) => candidate.publishedAt === null) ?? versions[0];
  if (!version) throw new Error("Course has no version");
  const content = courseContentSchema.parse(version.content);
  const [draft, counts, rosterRows, modules, resources, surveys] =
    await Promise.all([
      loadDraftStructure(database, course.id, version.id, course.slug, content),
      referenceCounts(database, course.id),
      database
        .selectFrom("enrollment")
        .innerJoin(
          "course_version",
          "course_version.id",
          "enrollment.courseVersionId",
        )
        .innerJoin("user", "user.id", "enrollment.userId")
        .select([
          "enrollment.id as enrollmentId",
          "enrollment.status",
          "enrollment.enrolledAt",
          "enrollment.completedAt",
          "enrollment.expiresAt",
          "enrollment.removedAt",
          "course_version.version as courseVersion",
          "user.id as learnerId",
          "user.name as learnerName",
          "user.email as learnerEmail",
        ])
        .where("course_version.courseId", "=", course.id)
        .orderBy("enrollment.enrolledAt", "desc")
        .orderBy("enrollment.id")
        .limit(ADMIN_COURSE_ROSTER_LIMIT)
        .execute(),
      database
        .selectFrom("scorm_package_version")
        .innerJoin(
          "learning_activity_version",
          "learning_activity_version.id",
          "scorm_package_version.id",
        )
        .innerJoin(
          "learning_activity",
          "learning_activity.id",
          "learning_activity_version.activityId",
        )
        .select([
          "scorm_package_version.id",
          "learning_activity.id as packageId",
          "learning_activity.title",
          "learning_activity_version.version",
        ])
        .where("scorm_package_version.status", "=", "ready")
        .orderBy("learning_activity.title")
        .orderBy("learning_activity_version.version", "desc")
        .execute(),
      database
        .selectFrom("learning_resource_version")
        .innerJoin(
          "learning_activity_version",
          "learning_activity_version.id",
          "learning_resource_version.id",
        )
        .innerJoin(
          "learning_activity",
          "learning_activity.id",
          "learning_activity_version.activityId",
        )
        .select([
          "learning_resource_version.id",
          "learning_activity.id as resourceId",
          "learning_activity.title",
          "learning_resource_version.displayName",
          "learning_resource_version.description",
          "learning_activity_version.version",
          "learning_resource_version.sourceBytes",
        ])
        .orderBy("learning_activity.title")
        .orderBy("learning_activity_version.version", "desc")
        .execute(),
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
          "learning_activity.id as surveyId",
          "learning_activity.title",
          "learning_activity_version.version",
        ])
        .where("learning_activity_version.publishedAt", "is not", null)
        .where("learning_activity.surveyUsage", "=", "learning")
        .orderBy("learning_activity.title")
        .orderBy("learning_activity_version.version", "desc")
        .execute(),
    ]);

  const now = new Date();

  return {
    course: {
      ...course,
      enrollmentCount: counts.enrollments,
      commerceReferenceCount: counts.commerce,
      canDelete:
        course.status === "archived" &&
        counts.enrollments === 0 &&
        counts.commerce === 0,
    },
    version: {
      id: version.id,
      version: version.version,
      publishedAt: version.publishedAt?.toISOString() ?? null,
      editable: version.publishedAt === null && course.status !== "archived",
    },
    versions: versions.map((candidate) => ({
      id: candidate.id,
      version: candidate.version,
      publishedAt: candidate.publishedAt?.toISOString() ?? null,
    })),
    roster: {
      total: counts.enrollments,
      limit: ADMIN_COURSE_ROSTER_LIMIT,
      enrollments: rosterRows.map((enrollment) => {
        const state =
          enrollment.removedAt || enrollment.status === "cancelled"
            ? "removed"
            : enrollment.status === "expired" ||
                (enrollment.expiresAt !== null && enrollment.expiresAt <= now)
              ? "expired"
              : enrollment.status === "completed"
                ? "completed"
                : "active";
        return {
          enrollmentId: enrollment.enrollmentId,
          learnerId: enrollment.learnerId,
          learnerName: enrollment.learnerName,
          learnerEmail: enrollment.learnerEmail,
          courseVersion: enrollment.courseVersion,
          state,
          enrolledAt: enrollment.enrolledAt.toISOString(),
          completedAt: enrollment.completedAt?.toISOString() ?? null,
          expiresAt: enrollment.expiresAt?.toISOString() ?? null,
          removedAt: enrollment.removedAt?.toISOString() ?? null,
        };
      }),
    },
    draft,
    library: { modules, resources, surveys },
  };
}

async function validateDraftReferences(
  transaction: Transaction<Database>,
  draft: AdminCourseDraft,
): Promise<boolean> {
  const moduleIds = draft.sections.flatMap((section) =>
    section.items.flatMap((item) =>
      item.kind === "scorm" ? [item.scormPackageVersionId] : [],
    ),
  );
  const resourceIds = draft.sections.flatMap((section) =>
    section.items.flatMap((item) =>
      item.kind === "resource" ? [item.resourceVersionId] : [],
    ),
  );
  const surveyIds = draft.sections.flatMap((section) =>
    section.items.flatMap((item) =>
      item.kind === "survey" ? [item.surveyVersionId] : [],
    ),
  );
  const [modules, resources, surveys] = await Promise.all([
    moduleIds.length === 0
      ? []
      : transaction
          .selectFrom("scorm_package_version")
          .innerJoin(
            "learning_activity_version",
            "learning_activity_version.id",
            "scorm_package_version.id",
          )
          .select("scorm_package_version.id as id")
          .where("scorm_package_version.id", "in", moduleIds)
          .where("scorm_package_version.status", "=", "ready")
          .execute(),
    resourceIds.length === 0
      ? []
      : transaction
          .selectFrom("learning_resource_version")
          .select("id")
          .where("id", "in", resourceIds)
          .execute(),
    surveyIds.length === 0
      ? []
      : transaction
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
          .select("survey_version.id as id")
          .where("survey_version.id", "in", surveyIds)
          .where("learning_activity_version.publishedAt", "is not", null)
          .where("learning_activity.surveyUsage", "=", "learning")
          .execute(),
  ]);
  return (
    new Set(modules.map(({ id }) => id)).size === new Set(moduleIds).size &&
    new Set(resources.map(({ id }) => id)).size === new Set(resourceIds).size &&
    new Set(surveys.map(({ id }) => id)).size === new Set(surveyIds).size
  );
}

async function replaceDraftStructure(
  transaction: Transaction<Database>,
  draft: AdminCourseDraft,
): Promise<void> {
  await transaction
    .deleteFrom("course_version_item")
    .where("courseVersionId", "=", draft.versionId)
    .execute();
  await transaction
    .deleteFrom("course_version_section")
    .where("courseVersionId", "=", draft.versionId)
    .execute();

  let modulePosition = 0;
  for (const [sectionPosition, section] of draft.sections.entries()) {
    await transaction
      .insertInto("course_version_section")
      .values({
        id: section.id,
        courseVersionId: draft.versionId,
        position: sectionPosition,
        title: section.title,
        description: section.description,
      })
      .execute();
    for (const [itemPosition, item] of section.items.entries()) {
      const currentModulePosition =
        item.kind === "scorm" ? modulePosition++ : null;
      await transaction
        .insertInto("course_version_item")
        .values({
          id: item.id,
          courseVersionId: draft.versionId,
          sectionId: section.id,
          position: itemPosition,
          kind: item.kind,
          title: item.title,
          required: item.required,
          durationMinutes: item.durationMinutes,
          modulePosition: currentModulePosition,
          learningActivityVersionId:
            item.kind === "scorm"
              ? item.scormPackageVersionId
              : item.kind === "survey"
                ? item.surveyVersionId
                : item.resourceVersionId,
        })
        .execute();
    }
  }
}

export async function createAdminCourse(
  input: AdminCourseCreateInput,
  administrator: AuthenticatedUser,
): Promise<
  | { status: "created"; courseId: string; versionId: string }
  | { status: "conflict"; reason: string }
> {
  const database = getDatabase();
  const existing = await database
    .selectFrom("course")
    .select("id")
    .where("slug", "=", input.slug)
    .executeTakeFirst();
  if (existing) return { status: "conflict", reason: "slug_in_use" };
  const courseId = `course_${randomUUID()}`;
  const versionId = `course_version_${randomUUID()}`;
  await database.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("course")
      .values({
        id: courseId,
        slug: input.slug,
        title: input.title,
        status: "draft",
      })
      .execute();
    await transaction
      .insertInto("course_version")
      .values({
        id: versionId,
        courseId,
        version: 1,
        content: blankCourseContent(input.title),
        publishedAt: null,
      })
      .execute();
    await recordDurableAuditEvent(transaction, {
      actorUserId: administrator.id,
      action: "course.created",
      subjectType: "course",
      subjectId: courseId,
      metadata: { versionId },
    });
  });
  return { status: "created", courseId, versionId };
}

export async function startAdminCourse(administrator: AuthenticatedUser) {
  return await createAdminCourse(
    {
      title: "Untitled course",
      slug: `draft-course-${randomUUID()}`,
    },
    administrator,
  );
}

export async function saveAdminCourseDraft(
  draft: AdminCourseDraft,
  administrator: AuthenticatedUser,
): Promise<
  "saved" | "not-found" | "not-editable" | "invalid-reference" | "slug-in-use"
> {
  let outcome:
    | "saved"
    | "not-found"
    | "not-editable"
    | "invalid-reference"
    | "slug-in-use";
  try {
    outcome = await getDatabase()
      .transaction()
      .execute(async (transaction) => {
        const version = await transaction
          .selectFrom("course_version")
          .innerJoin("course", "course.id", "course_version.courseId")
          .select([
            "course_version.id",
            "course_version.publishedAt",
            "course.status",
            "course.slug",
            "course.title",
          ])
          .where("course_version.id", "=", draft.versionId)
          .where("course.id", "=", draft.courseId)
          .forUpdate()
          .executeTakeFirst();
        if (!version) return "not-found" as const;
        if (version.publishedAt || version.status === "archived")
          return "not-editable" as const;
        if (!(await validateDraftReferences(transaction, draft)))
          return "invalid-reference" as const;
        const slugOwner = await transaction
          .selectFrom("course")
          .select("id")
          .where("slug", "=", draft.slug)
          .where("id", "!=", draft.courseId)
          .executeTakeFirst();
        if (slugOwner) return "slug-in-use" as const;
        await transaction
          .updateTable("course")
          .set({
            slug: draft.slug,
            title: draft.title,
            updatedAt: new Date(),
          })
          .where("id", "=", draft.courseId)
          .executeTakeFirstOrThrow();
        await transaction
          .updateTable("course_version")
          .set({ content: contentFromDraft(draft) })
          .where("id", "=", draft.versionId)
          .executeTakeFirstOrThrow();
        await replaceDraftStructure(transaction, draft);
        return "saved" as const;
      });
  } catch (error) {
    if (isUniqueViolation(error)) outcome = "slug-in-use";
    else throw error;
  }
  if (outcome === "saved")
    logServerEvent({
      level: "info",
      event: "course.draft_saved",
      fields: {
        actorUserId: administrator.id,
        entityType: "course",
        entityId: draft.courseId,
      },
    });
  return outcome;
}

export async function createAdminCourseVersion(
  courseId: string,
  administrator: AuthenticatedUser,
): Promise<
  | { status: "created"; versionId: string }
  | { status: "not-found" | "conflict" }
> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const course = await transaction
        .selectFrom("course")
        .select(["id", "slug", "status"])
        .where("id", "=", courseId)
        .forUpdate()
        .executeTakeFirst();
      if (!course) return { status: "not-found" } as const;
      if (course.status === "archived") return { status: "conflict" } as const;
      const versions = await transaction
        .selectFrom("course_version")
        .select(["id", "version", "publishedAt", "content"])
        .where("courseId", "=", courseId)
        .orderBy("version", "desc")
        .execute();
      if (versions.some((version) => version.publishedAt === null))
        return { status: "conflict" } as const;
      const source = versions[0];
      if (!source) return { status: "not-found" } as const;
      const versionId = `course_version_${randomUUID()}`;
      await transaction
        .insertInto("course_version")
        .values({
          id: versionId,
          courseId,
          version: source.version + 1,
          content: source.content,
          publishedAt: null,
        })
        .execute();
      const sourceDraft = await loadDraftStructure(
        transaction,
        courseId,
        source.id,
        course.slug,
        courseContentSchema.parse(source.content),
      );
      const draft: AdminCourseDraft = {
        ...sourceDraft,
        versionId,
        sections: sourceDraft.sections.map((section) => ({
          ...section,
          id: `section_${randomUUID()}`,
          items: section.items.map((item) => ({
            ...item,
            id: `item_${randomUUID()}`,
          })),
        })),
      };
      await replaceDraftStructure(transaction, draft);
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "course.version_created",
        subjectType: "course_version",
        subjectId: versionId,
        metadata: { courseId, sourceVersionId: source.id },
      });
      return { status: "created", versionId } as const;
    });
}

export async function publishAdminCourseVersion(
  courseId: string,
  versionId: string,
  administrator: AuthenticatedUser,
): Promise<"published" | "not-found" | "conflict"> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const version = await transaction
        .selectFrom("course_version")
        .innerJoin("course", "course.id", "course_version.courseId")
        .select([
          "course_version.id",
          "course_version.version",
          "course_version.publishedAt",
          "course.status",
          "course.slug",
          "course.title",
        ])
        .where("course_version.id", "=", versionId)
        .where("course.id", "=", courseId)
        .forUpdate()
        .executeTakeFirst();
      if (!version) return "not-found" as const;
      if (
        version.publishedAt ||
        version.status === "archived" ||
        version.title === "Untitled course" ||
        version.slug.startsWith("draft-course-")
      )
        return "conflict" as const;
      const structure = await transaction
        .selectFrom("course_version_section")
        .leftJoin(
          "course_version_item",
          "course_version_item.sectionId",
          "course_version_section.id",
        )
        .select([
          sql<number>`count(distinct course_version_section.id)::integer`.as(
            "sections",
          ),
          sql<number>`count(course_version_item.id)::integer`.as("items"),
        ])
        .where("course_version_section.courseVersionId", "=", versionId)
        .executeTakeFirstOrThrow();
      if (structure.sections === 0 || structure.items === 0)
        return "conflict" as const;
      const now = new Date();
      await transaction
        .updateTable("course_version")
        .set({ publishedAt: now })
        .where("id", "=", versionId)
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable("course")
        .set({ status: "published", updatedAt: now })
        .where("id", "=", courseId)
        .executeTakeFirstOrThrow();
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "course.published",
        subjectType: "course_version",
        subjectId: versionId,
        metadata: { courseId, version: version.version },
        createdAt: now,
      });
      return "published" as const;
    });
}

export async function archiveAdminCourse(
  courseId: string,
  administrator: AuthenticatedUser,
): Promise<"archived" | "not-found" | "conflict"> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const course = await transaction
        .selectFrom("course")
        .select(["id", "status"])
        .where("id", "=", courseId)
        .forUpdate()
        .executeTakeFirst();
      if (!course) return "not-found" as const;
      if (course.status === "archived") return "conflict" as const;
      const now = new Date();
      await transaction
        .updateTable("course")
        .set({ status: "archived", updatedAt: now })
        .where("id", "=", courseId)
        .executeTakeFirstOrThrow();
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "course.archived",
        subjectType: "course",
        subjectId: courseId,
        metadata: {},
        createdAt: now,
      });
      return "archived" as const;
    });
}

export async function deleteArchivedAdminCourse(
  courseId: string,
  administrator: AuthenticatedUser,
): Promise<"deleted" | "not-found" | "conflict"> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const course = await transaction
        .selectFrom("course")
        .select(["id", "status"])
        .where("id", "=", courseId)
        .forUpdate()
        .executeTakeFirst();
      if (!course) return "not-found" as const;
      if (course.status !== "archived") return "conflict" as const;
      const counts = await referenceCounts(transaction, courseId);
      if (counts.enrollments > 0 || counts.commerce > 0)
        return "conflict" as const;
      const versionIds = await transaction
        .selectFrom("course_version")
        .select("id")
        .where("courseId", "=", courseId)
        .execute();
      const ids = versionIds.map(({ id }) => id);
      if (ids.length > 0) {
        await transaction
          .deleteFrom("course_version_item")
          .where("courseVersionId", "in", ids)
          .execute();
        await transaction
          .deleteFrom("course_version_section")
          .where("courseVersionId", "in", ids)
          .execute();
        await transaction
          .deleteFrom("course_version")
          .where("id", "in", ids)
          .execute();
      }
      await transaction
        .deleteFrom("course")
        .where("id", "=", courseId)
        .executeTakeFirstOrThrow();
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "course.deleted",
        subjectType: "course",
        subjectId: courseId,
        metadata: { versionCount: ids.length },
      });
      return "deleted" as const;
    });
}
