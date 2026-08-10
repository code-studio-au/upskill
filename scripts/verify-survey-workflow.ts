import assert from "node:assert/strict";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { AdminSurveyDraft } from "#/features/survey/survey.schema";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import type { Database } from "#/server/db/types";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const ids = {
  user: "verify_survey_user",
  course: "verify_survey_course",
  courseVersion: "verify_survey_course_version",
  section: "verify_survey_section",
  item: "verify_survey_item",
  enrollment: "verify_survey_enrollment",
};
const user: AuthenticatedUser = {
  id: ids.user,
  name: "Survey Verifier",
  email: "survey-verifier@example.com",
  emailVerified: true,
};
const database = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});
let surveyId: string | undefined;

async function cleanup(): Promise<void> {
  const existingSurvey = await database
    .selectFrom("survey")
    .select("id")
    .where("title", "=", "Verified learner survey")
    .executeTakeFirst();
  const targetSurveyId = surveyId ?? existingSurvey?.id;
  await database
    .deleteFrom("survey_progress")
    .where("enrollmentId", "=", ids.enrollment)
    .execute();
  await database
    .deleteFrom("survey_response")
    .where("enrollmentId", "=", ids.enrollment)
    .execute();
  await database
    .deleteFrom("learning_item_progress")
    .where("enrollmentId", "=", ids.enrollment)
    .execute();
  await database
    .deleteFrom("enrollment")
    .where("id", "=", ids.enrollment)
    .execute();
  await database
    .deleteFrom("course_version_item")
    .where("courseVersionId", "=", ids.courseVersion)
    .execute();
  await database
    .deleteFrom("course_version_section")
    .where("courseVersionId", "=", ids.courseVersion)
    .execute();
  await database
    .deleteFrom("course_version")
    .where("id", "=", ids.courseVersion)
    .execute();
  await database.deleteFrom("course").where("id", "=", ids.course).execute();
  if (targetSurveyId) {
    await database
      .deleteFrom("survey_version")
      .where("surveyId", "=", targetSurveyId)
      .execute();
    await database
      .deleteFrom("survey")
      .where("id", "=", targetSurveyId)
      .execute();
  }
  await database
    .deleteFrom("outbox_event")
    .where("aggregateId", "in", [ids.enrollment, targetSurveyId ?? "missing"])
    .execute();
  await database.transaction().execute(async (transaction) => {
    await sql`select set_config('upskill.audit_maintenance', 'on', true)`.execute(
      transaction,
    );
    await sql`delete from audit_event where "subjectId" in (
      ${ids.enrollment}, ${targetSurveyId ?? "missing"}
    )`.execute(transaction);
  });
  await database.deleteFrom("user").where("id", "=", ids.user).execute();
}

try {
  await cleanup();
  await database
    .insertInto("user")
    .values({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: true,
      image: null,
      stripeCustomerId: null,
    })
    .execute();

  const {
    createAdminSurvey,
    createAdminSurveyVersion,
    findAdminSurvey,
    publishAdminSurveyVersion,
    saveAdminSurveyDraft,
  } = await import("#/server/admin/admin-survey.server");
  const created = await createAdminSurvey("Verified learner survey", user);
  surveyId = created.surveyId;
  const draft: AdminSurveyDraft = {
    surveyId,
    versionId: created.versionId,
    title: "Verified learner survey",
    description: "A version-pinned verification survey.",
    sections: [
      {
        id: "survey_section_intro",
        title: "Introduction",
        description: "Read this first.",
        items: [
          {
            id: "instruction_privacy",
            kind: "instruction",
            title: "Privacy",
            body: "Do not include personal information.",
          },
        ],
      },
      {
        id: "survey_section_questions",
        title: "Questions",
        description: "Share your feedback.",
        items: [
          {
            id: "question_required",
            kind: "single_choice",
            prompt: "Choose one",
            required: true,
            options: [
              { id: "answer_one", label: "One" },
              { id: "answer_two", label: "Two" },
            ],
          },
          {
            id: "question_optional",
            kind: "text",
            prompt: "Optional feedback",
            required: false,
            maximumLength: 200,
          },
        ],
      },
    ],
  };
  assert.equal(await saveAdminSurveyDraft(draft, user), "saved");
  assert.equal(
    await publishAdminSurveyVersion(surveyId, created.versionId, user),
    "published",
  );
  assert.equal(await saveAdminSurveyDraft(draft, user), "published");
  const nextVersion = await createAdminSurveyVersion(surveyId, user);
  assert.equal(nextVersion.status, "created");
  const detail = await findAdminSurvey(surveyId);
  assert.ok(detail);
  assert.equal(detail.version.version, 2);
  assert.equal(detail.draft.sections.length, 2);
  assert.equal(detail.draft.sections[0]?.items.length, 1);

  await database
    .insertInto("course")
    .values({
      id: ids.course,
      slug: "verify-survey-workflow",
      title: "Verified survey course",
      status: "published",
    })
    .execute();
  await database
    .insertInto("course_version")
    .values({
      id: ids.courseVersion,
      courseId: ids.course,
      version: 1,
      content: {
        title: "Verified survey course",
        summary: "Summary",
        description: "Description",
        topic: "leadership",
        durationMinutes: 10,
        priceCents: 0,
        salePriceCents: null,
        currency: "AUD",
        featured: false,
        listInStore: false,
        hasCompletionCertificate: false,
        prerequisites: [],
        accreditations: [],
        modules: [],
        sections: [],
      },
      publishedAt: new Date(),
    })
    .execute();
  await database
    .insertInto("course_version_section")
    .values({
      id: ids.section,
      courseVersionId: ids.courseVersion,
      position: 0,
      title: "Survey section",
      description: "",
    })
    .execute();
  await database
    .insertInto("course_version_item")
    .values({
      id: ids.item,
      courseVersionId: ids.courseVersion,
      sectionId: ids.section,
      position: 0,
      kind: "survey",
      title: "Verified learner survey",
      required: true,
      durationMinutes: 5,
      modulePosition: null,
      scormPackageVersionId: null,
      surveyVersionId: created.versionId,
      resourceVersionId: null,
    })
    .execute();
  await database
    .insertInto("enrollment")
    .values({
      id: ids.enrollment,
      userId: ids.user,
      courseVersionId: ids.courseVersion,
      accessGrantId: null,
      status: "active",
      enrolledAt: new Date(),
      completedAt: null,
      expiresAt: null,
      removedAt: null,
    })
    .execute();

  const { advanceLearnerSurvey, findLearnerSurvey } =
    await import("#/server/learning/learner-survey.server");
  const learnerSurvey = await findLearnerSurvey(ids.enrollment, ids.item, user);
  assert.notEqual(learnerSurvey, null);
  assert.notEqual(learnerSurvey, "unavailable");
  if (!learnerSurvey || learnerSurvey === "unavailable")
    throw new Error("Expected learner survey");
  assert.equal(learnerSurvey.surveyVersionId, created.versionId);
  assert.equal(learnerSurvey.progress.completedItems, 0);
  assert.equal(learnerSurvey.progress.currentItemId, "instruction_privacy");
  const outOfSequence = await advanceLearnerSurvey(
    {
      enrollmentId: ids.enrollment,
      courseVersionItemId: ids.item,
      itemId: "question_required",
    },
    user,
  );
  assert.equal(outOfSequence.status, "invalid");
  const viewed = await advanceLearnerSurvey(
    {
      enrollmentId: ids.enrollment,
      courseVersionItemId: ids.item,
      itemId: "instruction_privacy",
    },
    user,
  );
  assert.equal(viewed.status, "advanced");
  assert.equal(viewed.progress.completedItems, 1);
  assert.equal(viewed.progress.sections[0]?.completed, true);
  const requiredMissing = await advanceLearnerSurvey(
    {
      enrollmentId: ids.enrollment,
      courseVersionItemId: ids.item,
      itemId: "question_required",
    },
    user,
  );
  assert.equal(requiredMissing.status, "invalid");
  const answered = await advanceLearnerSurvey(
    {
      enrollmentId: ids.enrollment,
      courseVersionItemId: ids.item,
      itemId: "question_required",
      answer: "answer_two",
    },
    user,
  );
  assert.equal(answered.status, "advanced");
  const submitted = await advanceLearnerSurvey(
    {
      enrollmentId: ids.enrollment,
      courseVersionItemId: ids.item,
      itemId: "question_optional",
    },
    user,
  );
  assert.equal(submitted.status, "submitted");
  assert.equal(submitted.completedCourse, true);
  assert.equal(submitted.progress.completedItems, 3);
  assert.equal(submitted.progress.percent, 100);
  assert.equal(
    await database
      .selectFrom("survey_response")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("enrollmentId", "=", ids.enrollment)
      .executeTakeFirstOrThrow()
      .then((row) => String(row.count)),
    "1",
  );
  const storedProgress = await database
    .selectFrom("survey_progress")
    .select(["visitedItemIds", "completedAt"])
    .where("enrollmentId", "=", ids.enrollment)
    .where("courseVersionItemId", "=", ids.item)
    .executeTakeFirstOrThrow();
  assert.deepEqual(storedProgress.visitedItemIds, [
    "instruction_privacy",
    "question_required",
    "question_optional",
  ]);
  assert.ok(storedProgress.completedAt);
  assert.equal(
    (
      await database
        .selectFrom("enrollment")
        .select("status")
        .where("id", "=", ids.enrollment)
        .executeTakeFirstOrThrow()
    ).status,
    "completed",
  );
  console.log(
    "Verified immutable survey sections, ordered view and answer progress, response evidence and course completion",
  );
} finally {
  await cleanup();
  await database.destroy();
}
