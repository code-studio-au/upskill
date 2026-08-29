import assert from "node:assert/strict";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { AdminCourseDraft } from "#/features/admin-course/admin-course.schema";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import type { Database } from "#/server/db/types";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const ids = {
  user: "verify_authoring_admin",
  module: "verify_authoring_module",
  moduleVersionOne: "verify_authoring_module_version_one",
  moduleVersionTwo: "verify_authoring_module_version_two",
  resource: "verify_authoring_resource",
  resourceVersion: "verify_authoring_resource_version",
  survey: "verify_authoring_survey",
  surveyVersion: "verify_authoring_survey_version",
  enrollment: "verify_authoring_enrollment",
};
const slug = "verify-versioned-course-authoring";
const administrator: AuthenticatedUser = {
  id: ids.user,
  name: "Authoring Verifier",
  email: "authoring-verifier@example.com",
  emailVerified: true,
};
const database = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});

async function cleanup(): Promise<void> {
  await database
    .deleteFrom("enrollment")
    .where("id", "=", ids.enrollment)
    .execute();
  const courses = await database
    .selectFrom("course")
    .select("id")
    .where("slug", "=", slug)
    .execute();
  for (const { id } of courses) {
    const versions = await database
      .selectFrom("course_version")
      .select("id")
      .where("courseId", "=", id)
      .execute();
    const versionIds = versions.map((version) => version.id);
    if (versionIds.length > 0) {
      await database
        .deleteFrom("course_version_item")
        .where("courseVersionId", "in", versionIds)
        .execute();
      await database
        .deleteFrom("course_version_section")
        .where("courseVersionId", "in", versionIds)
        .execute();
      await database
        .deleteFrom("course_version")
        .where("id", "in", versionIds)
        .execute();
    }
    await database.deleteFrom("course").where("id", "=", id).execute();
  }
  await database
    .deleteFrom("learning_activity_version")
    .where("id", "in", [
      ids.moduleVersionOne,
      ids.moduleVersionTwo,
      ids.resourceVersion,
      ids.surveyVersion,
    ])
    .execute();
  await database
    .deleteFrom("learning_activity")
    .where("id", "in", [ids.module, ids.resource, ids.survey])
    .execute();
  await database
    .deleteFrom("outbox_event")
    .where(sql<boolean>`payload ->> 'actorUserId' = ${ids.user}`)
    .execute();
  await database.transaction().execute(async (transaction) => {
    await sql`select set_config('upskill.audit_maintenance', 'on', true)`.execute(
      transaction,
    );
    await sql`delete from audit_event
      where "actorUserId" = ${ids.user}`.execute(transaction);
  });
  await database
    .deleteFrom("platform_admin")
    .where("userId", "=", ids.user)
    .execute();
  await database.deleteFrom("user").where("id", "=", ids.user).execute();
}

try {
  await cleanup();
  await database
    .insertInto("user")
    .values({
      id: administrator.id,
      name: administrator.name,
      email: administrator.email,
      emailVerified: true,
      image: null,
      stripeCustomerId: null,
    })
    .execute();
  await database
    .insertInto("platform_admin")
    .values({ userId: ids.user, grantedByUserId: ids.user })
    .execute();
  await database
    .insertInto("learning_activity")
    .values([
      { id: ids.module, kind: "scorm", title: "Verified module" },
      { id: ids.resource, kind: "resource", title: "Verified PDF" },
      {
        id: ids.survey,
        kind: "survey",
        title: "Verified survey",
        surveyUsage: "learning",
        surveyType: "elearning",
        surveyPosition: sql<number>`coalesce((
          select max("surveyPosition")
            from learning_activity
           where "surveyType" = 'elearning'
        ), -1) + 1`,
      },
    ])
    .execute();
  await database
    .insertInto("learning_activity_version")
    .values([
      {
        id: ids.moduleVersionOne,
        activityId: ids.module,
        kind: "scorm",
        version: 1,
        publishedAt: new Date(),
      },
      {
        id: ids.moduleVersionTwo,
        activityId: ids.module,
        kind: "scorm",
        version: 2,
        publishedAt: new Date(),
      },
      {
        id: ids.resourceVersion,
        activityId: ids.resource,
        kind: "resource",
        version: 1,
        publishedAt: new Date(),
      },
      {
        id: ids.surveyVersion,
        activityId: ids.survey,
        kind: "survey",
        version: 1,
        publishedAt: new Date(),
      },
    ])
    .execute();
  await database
    .insertInto("scorm_package_version")
    .values([
      {
        id: ids.moduleVersionOne,
        status: "ready",
        standard: "scorm-1.2",
        contentPrefix: "verify/authoring/module-one",
        launchPath: "index.html",
        sha256: "1".repeat(64),
        manifest: {},
        sourceBytes: 1,
        failureCode: null,
        processedAt: new Date(),
      },
      {
        id: ids.moduleVersionTwo,
        status: "ready",
        standard: "scorm-1.2",
        contentPrefix: "verify/authoring/module-two",
        launchPath: "index.html",
        sha256: "2".repeat(64),
        manifest: {},
        sourceBytes: 1,
        failureCode: null,
        processedAt: new Date(),
      },
    ])
    .execute();
  await database
    .insertInto("learning_resource_version")
    .values({
      id: ids.resourceVersion,
      displayName: "verified.pdf",
      description: "Verified immutable resource",
      objectKey: `resources/${ids.resourceVersion}/${"3".repeat(64)}.pdf`,
      sha256: "3".repeat(64),
      sourceBytes: 5,
      mediaType: "application/pdf",
    })
    .execute();
  await database
    .insertInto("survey_version")
    .values({
      id: ids.surveyVersion,
      content: { sections: [] },
    })
    .execute();

  const authoring = await import("#/server/admin/admin-course.server");
  const created = await authoring.createAdminCourse(
    { title: "Versioned authoring verification", slug },
    administrator,
  );
  assert.equal(created.status, "created");
  const first = await authoring.findAdminCourse(created.courseId);
  assert.ok(first);
  const firstDraft: AdminCourseDraft = {
    ...first.draft,
    summary: "A complete versioned authoring verification course.",
    description: "Verifies sections, exact references and immutable versions.",
    sections: [
      {
        id: "section_verify_one",
        title: "Preparation",
        description: "Prepare for the course.",
        items: [
          {
            id: "item_verify_module_one",
            kind: "scorm",
            title: "Verified module one",
            required: true,
            durationMinutes: 10,
            scormPackageVersionId: ids.moduleVersionOne,
          },
          {
            id: "item_verify_resource",
            kind: "resource",
            title: "Verified PDF",
            required: false,
            durationMinutes: null,
            resourceVersionId: ids.resourceVersion,
          },
        ],
      },
      {
        id: "section_verify_two",
        title: "Learning",
        description: "Complete the learning.",
        items: [
          {
            id: "item_verify_survey",
            kind: "survey",
            title: "Verified survey",
            required: true,
            durationMinutes: 5,
            surveyVersionId: ids.surveyVersion,
          },
          {
            id: "item_verify_module_two",
            kind: "scorm",
            title: "Verified module two",
            required: true,
            durationMinutes: 20,
            scormPackageVersionId: ids.moduleVersionTwo,
          },
        ],
      },
    ],
  };
  assert.equal(
    await authoring.saveAdminCourseDraft(firstDraft, administrator),
    "saved",
  );
  assert.equal(
    await authoring.publishAdminCourseVersion(
      created.courseId,
      created.versionId,
      administrator,
    ),
    "published",
  );
  assert.deepEqual(
    await database
      .selectFrom("course_version_item")
      .select([
        "modulePosition as position",
        "learningActivityVersionId as scormPackageVersionId",
      ])
      .where("courseVersionId", "=", created.versionId)
      .where("kind", "=", "scorm")
      .orderBy("modulePosition")
      .execute(),
    [
      { position: 0, scormPackageVersionId: ids.moduleVersionOne },
      { position: 1, scormPackageVersionId: ids.moduleVersionTwo },
    ],
  );

  const versioned = await authoring.createAdminCourseVersion(
    created.courseId,
    created.versionId,
    administrator,
  );
  assert.equal(versioned.status, "created");
  const publishedSelection = await authoring.findAdminCourse(
    created.courseId,
    created.versionId,
  );
  assert.equal(publishedSelection?.version.id, created.versionId);
  assert.equal(
    await authoring.findAdminCourse(created.courseId, "missing_version"),
    null,
  );
  const second = await authoring.findAdminCourse(created.courseId);
  assert.ok(second);
  assert.deepEqual(
    second.versions.map((version) => version.id),
    [versioned.versionId, created.versionId],
  );
  const [preparationSection, learningSection] = second.draft.sections;
  assert.ok(preparationSection);
  assert.ok(learningSection);
  const [, resourceItem] = preparationSection.items;
  const [surveyItem, moduleTwoItem] = learningSection.items;
  assert.ok(resourceItem);
  assert.ok(surveyItem);
  assert.ok(moduleTwoItem);
  const secondDraft: AdminCourseDraft = {
    ...second.draft,
    sections: [
      {
        ...learningSection,
        items: [moduleTwoItem, surveyItem],
      },
      {
        ...preparationSection,
        items: [resourceItem],
      },
    ],
  };
  assert.equal(
    await authoring.saveAdminCourseDraft(secondDraft, administrator),
    "saved",
  );
  assert.deepEqual(
    await database
      .selectFrom("course_version_item")
      .select([
        "modulePosition as position",
        "learningActivityVersionId as scormPackageVersionId",
      ])
      .where("courseVersionId", "=", versioned.versionId)
      .where("kind", "=", "scorm")
      .execute(),
    [{ position: 0, scormPackageVersionId: ids.moduleVersionTwo }],
  );
  assert.equal(
    await database
      .selectFrom("course_version_item")
      .select("learningActivityVersionId")
      .where("courseVersionId", "=", created.versionId)
      .where("kind", "=", "scorm")
      .execute()
      .then((rows) => rows.length),
    2,
  );

  const [{ findAdminScormPackages }, { findAdminResources }, surveyAdmin] =
    await Promise.all([
      import("#/server/admin/admin-scorm.server"),
      import("#/server/admin/admin-resource.server"),
      import("#/server/admin/admin-survey.server"),
    ]);
  const moduleLibrary = await findAdminScormPackages();
  const verifiedModule = moduleLibrary.find(
    (candidate) => candidate.id === ids.module,
  );
  assert.ok(verifiedModule);
  assert.deepEqual(
    verifiedModule.versions
      .find((version) => version.id === ids.moduleVersionTwo)
      ?.courseUsages.map((usage) => ({
        courseVersionId: usage.courseVersionId,
        version: usage.version,
        versionState: usage.versionState,
      })),
    [
      {
        courseVersionId: versioned.versionId,
        version: 2,
        versionState: "draft",
      },
      {
        courseVersionId: created.versionId,
        version: 1,
        versionState: "published",
      },
    ],
  );
  const resourceLibrary = await findAdminResources();
  assert.deepEqual(
    resourceLibrary
      .find((resource) => resource.id === ids.resource)
      ?.versions[0]?.courseUsages.map((usage) => usage.courseVersionId),
    [versioned.versionId, created.versionId],
  );
  const surveyLibrary = await surveyAdmin.findAdminSurveys();
  assert.deepEqual(
    surveyLibrary
      .find((survey) => survey.id === ids.survey)
      ?.versions[0]?.courseUsages.map((usage) => usage.courseVersionId),
    [versioned.versionId, created.versionId],
  );

  assert.equal(
    await authoring.archiveAdminCourse(created.courseId, administrator),
    "archived",
  );
  assert.deepEqual(
    (await findAdminScormPackages())
      .find((candidate) => candidate.id === ids.module)
      ?.versions.find((version) => version.id === ids.moduleVersionOne)
      ?.courseUsages.map((usage) => usage.courseStatus),
    ["archived"],
  );
  await database
    .insertInto("enrollment")
    .values({
      id: ids.enrollment,
      userId: ids.user,
      courseVersionId: created.versionId,
      accessGrantId: null,
      status: "active",
      enrolledAt: new Date("2026-08-05T02:00:00.000Z"),
      completedAt: null,
      expiresAt: new Date("2027-08-05T02:00:00.000Z"),
      removedAt: null,
    })
    .execute();
  const courseWithRoster = await authoring.findAdminCourseRoster({
    courseId: created.courseId,
    q: "",
    page: 1,
  });
  assert.ok(courseWithRoster);
  assert.equal(courseWithRoster.pagination.total, 1);
  assert.deepEqual(courseWithRoster.enrollments, [
    {
      enrollmentId: ids.enrollment,
      learnerId: ids.user,
      learnerName: administrator.name,
      learnerEmail: administrator.email,
      courseVersion: 1,
      state: "active",
      enrolledAt: "2026-08-05T02:00:00.000Z",
      completedAt: null,
      expiresAt: "2027-08-05T02:00:00.000Z",
      removedAt: null,
    },
  ]);
  assert.equal(
    await authoring.deleteArchivedAdminCourse(created.courseId, administrator),
    "conflict",
  );
  await database
    .deleteFrom("enrollment")
    .where("id", "=", ids.enrollment)
    .execute();
  assert.equal(
    await authoring.deleteArchivedAdminCourse(created.courseId, administrator),
    "deleted",
  );
  assert.equal(await authoring.findAdminCourse(created.courseId), null);

  console.log(
    "Verified course archive/delete safety, paginated learner roster, immutable version creation, section ordering and linked exact-version module, survey and PDF usage",
  );
} finally {
  await cleanup();
  await database.destroy();
  const { destroyDatabase } = await import("#/server/db/database.server");
  await destroyDatabase();
}
