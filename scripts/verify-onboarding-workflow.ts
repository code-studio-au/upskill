import assert from "node:assert/strict";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { AdminSurveyDraft } from "#/features/survey/survey.schema";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import type { Database } from "#/server/db/types";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const user: AuthenticatedUser = {
  id: "verify_onboarding_user",
  name: "Onboarding Verifier",
  email: "onboarding-verifier@example.com",
  emailVerified: true,
};
const regionId = "verify_onboarding_region";
const otherRegionId = "verify_onboarding_region_other";
const database = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});
let surveyId: string | undefined;

async function cleanup(): Promise<void> {
  const assignments = await database
    .selectFrom("onboarding_assignment")
    .select("id")
    .where("userId", "=", user.id)
    .execute();
  if (assignments.length > 0)
    await database
      .deleteFrom("onboarding_response")
      .where(
        "assignmentId",
        "in",
        assignments.map((assignment) => assignment.id),
      )
      .execute();
  await database
    .deleteFrom("onboarding_assignment")
    .where("userId", "=", user.id)
    .execute();
  await database
    .deleteFrom("onboarding_definition")
    .where("id", "=", "onboarding_definition_default")
    .execute();
  if (surveyId) {
    await database
      .deleteFrom("learning_activity_version")
      .where("activityId", "=", surveyId)
      .execute();
    await database
      .deleteFrom("learning_activity")
      .where("id", "=", surveyId)
      .execute();
  }
  await database.transaction().execute(async (transaction) => {
    await sql`select set_config('upskill.audit_maintenance', 'on', true)`.execute(
      transaction,
    );
    await sql`delete from audit_event where "actorUserId" = ${user.id}`.execute(
      transaction,
    );
  });
  await database.deleteFrom("user").where("id", "=", user.id).execute();
  await database
    .deleteFrom("coordination_region")
    .where("id", "in", [regionId, otherRegionId])
    .execute();
}

try {
  const existingDefinition = await database
    .selectFrom("onboarding_definition")
    .select("id")
    .where("id", "=", "onboarding_definition_default")
    .executeTakeFirst();
  if (existingDefinition)
    throw new Error(
      "Onboarding verification requires a disposable database without an existing configuration.",
    );
  await cleanup();
  await database
    .insertInto("coordination_region")
    .values([
      {
        id: regionId,
        name: "Verification region",
        code: "VERIFY-ONBOARDING",
        kind: "operational",
        parentId: null,
        status: "active",
        createdAt: new Date(),
      },
      {
        id: otherRegionId,
        name: "Other verification region",
        code: "VERIFY-ONBOARDING-OTHER",
        kind: "operational",
        parentId: null,
        status: "active",
        createdAt: new Date(),
      },
    ])
    .execute();
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
  const { createAdminSurvey, publishAdminSurveyVersion, saveAdminSurveyDraft } =
    await import("#/server/admin/admin-survey.server");
  const created = await createAdminSurvey(
    "Verified onboarding",
    "onboarding",
    user,
  );
  surveyId = created.surveyId;
  const draft: AdminSurveyDraft = {
    surveyId,
    versionId: created.versionId,
    title: "Verified onboarding",
    description: "",
    sections: [
      {
        id: "onboarding_profile",
        title: "Your profile",
        description: "",
        items: [
          {
            id: "onboarding_name",
            kind: "short_text",
            prompt: "Full name",
            required: true,
            maximumLength: 160,
            format: "plain",
          },
          {
            id: "onboarding_phone",
            kind: "short_text",
            prompt: "Phone number",
            required: true,
            maximumLength: 40,
            format: "phone",
          },
          {
            id: "onboarding_region",
            kind: "dropdown",
            prompt: "Current region",
            required: true,
            options: [
              {
                id: "region_verified",
                label: "Verification region",
                externalValue: regionId,
              },
              {
                id: "region_other",
                label: "Other",
                externalValue: otherRegionId,
              },
            ],
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
  const { activateOnboardingConfiguration } =
    await import("#/server/onboarding/admin-onboarding.server");
  const activation = await activateOnboardingConfiguration(
    {
      surveyVersionId: created.versionId,
      privacyNotice: "Verification privacy notice",
      privacyNoticeVersion: "1",
      profileMappings: [
        { questionId: "onboarding_name", destination: "name" },
        { questionId: "onboarding_phone", destination: "phone" },
        { questionId: "onboarding_region", destination: "currentRegionId" },
      ],
    },
    user,
  );
  assert.equal(activation.status, "activated");
  const { findLearnerOnboarding, saveLearnerOnboardingStep } =
    await import("#/server/onboarding/learner-onboarding.server");
  const onboarding = await findLearnerOnboarding(user);
  assert.equal(typeof onboarding, "object");
  if (typeof onboarding === "string") throw new Error("Expected assignment");
  const outOfSequence = await saveLearnerOnboardingStep(
    onboarding.assignmentId,
    "onboarding_phone",
    "+61 400 000 000",
    user,
  );
  assert.equal(outOfSequence.status, "invalid");
  assert.equal(
    (
      await saveLearnerOnboardingStep(
        onboarding.assignmentId,
        "onboarding_name",
        "Updated Learner",
        user,
      )
    ).status,
    "advanced",
  );
  const secondActivation = await activateOnboardingConfiguration(
    {
      surveyVersionId: created.versionId,
      privacyNotice: "Updated verification privacy notice",
      privacyNoticeVersion: "2",
      profileMappings: [],
    },
    user,
  );
  assert.equal(secondActivation.status, "activated");
  assert.equal(
    (
      await database
        .selectFrom("onboarding_assignment")
        .select("definitionVersionId")
        .where("id", "=", onboarding.assignmentId)
        .executeTakeFirstOrThrow()
    ).definitionVersionId,
    activation.configurationId,
  );
  assert.equal(
    (
      await saveLearnerOnboardingStep(
        onboarding.assignmentId,
        "onboarding_phone",
        "+61 400 000 000",
        user,
      )
    ).status,
    "advanced",
  );
  const completed = await saveLearnerOnboardingStep(
    onboarding.assignmentId,
    "onboarding_region",
    "region_verified",
    user,
  );
  assert.equal(completed.status, "submitted");
  const updated = await database
    .selectFrom("user")
    .select(["name", "phone", "currentRegionId"])
    .where("id", "=", user.id)
    .executeTakeFirstOrThrow();
  assert.deepEqual(updated, {
    name: "Updated Learner",
    phone: "+61 400 000 000",
    currentRegionId: regionId,
  });
  assert.equal(await findLearnerOnboarding(user), "complete");
  console.log(
    "Verified version-pinned onboarding assignment, ordered resume, profile projection and completion gate",
  );
} finally {
  await cleanup();
  await database.destroy();
}
