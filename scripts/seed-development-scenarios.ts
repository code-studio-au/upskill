import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { hashPassword } from "better-auth/crypto";
import type { Transaction } from "kysely";
import type { AdminCourseDraft } from "#/features/admin-course/admin-course.schema";
import type { AdminEventTemplateDraft } from "#/features/admin-event/admin-event.schema";
import { INFORMATION_RELEASE_NOTICE_VERSION } from "#/features/access/access-code.schema";
import { ianaTimeZoneSchema } from "#/features/shared/time.schema";
import {
  parseSurveyVersionContent,
  type AdminSurveyDraft,
  type SurveyVersionContent,
} from "#/features/survey/survey.schema";
import {
  createAdminOfferingEmail,
  publishAdminEmailVersion,
  saveAdminEmailDraft,
} from "#/server/admin/admin-email.server";
import {
  createAdminCourse,
  publishAdminCourseVersion,
  saveAdminCourseDraft,
} from "#/server/admin/admin-course.server";
import {
  createAdminEventOccurrence,
  createAdminEventTemplate,
  publishAdminEventOccurrence,
  publishAdminEventTemplateVersion,
  saveAdminEventTemplateDraft,
} from "#/server/admin/admin-event.server";
import {
  createAdminSurvey,
  publishAdminSurveyVersion,
  saveAdminSurveyDraft,
} from "#/server/admin/admin-survey.server";
import { encryptAccessCode } from "#/server/access/access-code-encryption.server";
import { issueAccessCode } from "#/server/access/access-code.server";
import { redeemAccessCode } from "#/server/access/redeem-access-code.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { destroyDatabase, getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { completeEnrollmentIfReady } from "#/server/learning/learning-completion.server";
import { activateOnboardingConfiguration } from "#/server/onboarding/admin-onboarding.server";
import {
  findLearnerOnboarding,
  saveLearnerOnboardingStep,
} from "#/server/onboarding/learner-onboarding.server";
import {
  dateToInstant,
  instantToLocalDateTime,
} from "#/server/time/time.server";
import {
  ingestScormPackageVersion,
  stageScormPackageArchive,
} from "#/server/scorm/scorm-package-ingestion.server";

const database = getDatabase();
const password = process.env.SEED_LEARNER_PASSWORD ?? "";
if (password.length < 12)
  throw new Error("SEED_LEARNER_PASSWORD must contain at least 12 characters");
const archivePaths = process.argv
  .slice(2)
  .filter((argument) => argument !== "--");
const archivePath = archivePaths[0] ?? "";
if (archivePath.length === 0)
  throw new Error(
    "Pass the local SCORM 1.2 ZIP path after -- when running db:seed:development",
  );

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const now = new Date();
now.setSeconds(0, 0);
const developmentTimezone = ianaTimeZoneSchema.parse("Australia/Sydney");
const localDevelopmentTime = (value: Date) =>
  instantToLocalDateTime(dateToInstant(value), developmentTimezone);

const regionGroups = [
  {
    id: "region_group_nsw_health",
    code: "NSW-HEALTH",
    name: "New South Wales Health (NSW Health)",
  },
] as const;
const regions = [
  {
    id: "region_cclhd",
    code: "CCLHD",
    name: "Central Coast Local Health District",
    parentId: "region_group_nsw_health",
  },
  {
    id: "region_fwlhd",
    code: "FWLHD",
    name: "Far West Local Health District",
    parentId: "region_group_nsw_health",
  },
  {
    id: "region_hnelhd",
    code: "HNELHD",
    name: "Hunter New England Local Health District",
    parentId: "region_group_nsw_health",
  },
  {
    id: "region_islhd",
    code: "ISLHD",
    name: "Illawarra Shoalhaven Local Health District",
    parentId: "region_group_nsw_health",
  },
  {
    id: "region_mnclhd",
    code: "MNCLHD",
    name: "Mid North Coast Local Health District",
    parentId: "region_group_nsw_health",
  },
  {
    id: "region_mlhd",
    code: "MLHD",
    name: "Murrumbidgee Local Health District",
    parentId: "region_group_nsw_health",
  },
  {
    id: "region_nbmlhd",
    code: "NBMLHD",
    name: "Nepean Blue Mountains Local Health District",
    parentId: "region_group_nsw_health",
  },
  {
    id: "region_nnswlhd",
    code: "NNSWLHD",
    name: "Northern NSW Local Health District",
    parentId: "region_group_nsw_health",
  },
  {
    id: "region_nslhd",
    code: "NSLHD",
    name: "Northern Sydney Local Health District",
    parentId: "region_group_nsw_health",
  },
  {
    id: "region_seslhd",
    code: "SESLHD",
    name: "South Eastern Sydney Local Health District",
    parentId: "region_group_nsw_health",
  },
  {
    id: "region_swslhd",
    code: "SWSLHD",
    name: "South Western Sydney Local Health District",
    parentId: "region_group_nsw_health",
  },
  {
    id: "region_snslhd",
    code: "SNSWLHD",
    name: "Southern NSW Local Health District",
    parentId: "region_group_nsw_health",
  },
  {
    id: "region_slhd",
    code: "SLHD",
    name: "Sydney Local Health District",
    parentId: "region_group_nsw_health",
  },
  {
    id: "region_wnswlhd",
    code: "WNSWLHD",
    name: "Western NSW Local Health District",
    parentId: "region_group_nsw_health",
  },
  {
    id: "region_wslhd",
    code: "WSLHD",
    name: "Western Sydney Local Health District",
    parentId: "region_group_nsw_health",
  },
] as const;

const learnerRegionIndexes = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0, 2, 6, 9, 12,
] as const;
const scormTitle =
  "Recognizing Eating Disorders: A Guide for High School Health Educators";

interface SeedCredentialUser {
  id: string;
  accountId: string;
  name: string;
  email: string;
}

const administrators = [
  {
    id: "user_local_admin",
    accountId: "account_local_admin",
    name: "Avery Event Administrator",
    email: "admin@example.com",
  },
  {
    id: "user_local_admin_2",
    accountId: "account_local_admin_2",
    name: "Morgan Platform Administrator",
    email: "admin2@example.com",
  },
] satisfies Array<SeedCredentialUser>;

const learnerProfiles = Array.from({ length: 20 }, (_, index) => {
  const number = index + 1;
  return {
    id: `user_local_learner_${String(number)}`,
    accountId: `account_local_learner_${String(number)}`,
    name: `Learner ${String(number)}`,
    email: `learner${String(number)}@example.com`,
  };
}) satisfies Array<SeedCredentialUser>;

const coordinatorProfiles = regions.map((region) => ({
  id: `user_local_coordinator_${region.code.toLocaleLowerCase("en-AU")}`,
  accountId: `account_local_coordinator_${region.code.toLocaleLowerCase("en-AU")}`,
  name: `${region.code} Coordinator`,
  email: `coordinator.${region.code.toLocaleLowerCase("en-AU")}@example.com`,
})) satisfies Array<SeedCredentialUser>;

const presenterProfiles = [
  {
    id: "user_local_presenter_cbte",
    accountId: "account_local_presenter_cbte",
    name: "CBT-E Presenter",
    email: "presenter.cbte@example.com",
  },
  {
    id: "user_local_presenter_imed_adults",
    accountId: "account_local_presenter_imed_adults",
    name: "IMED Adults Presenter",
    email: "presenter.imed_adults@example.com",
  },
  {
    id: "user_local_presenter_sscm",
    accountId: "account_local_presenter_sscm",
    name: "SSCM Presenter",
    email: "presenter.sscm@example.com",
  },
  {
    id: "user_local_presenter_fbt",
    accountId: "account_local_presenter_fbt",
    name: "FBT Presenter",
    email: "presenter.fbt@example.com",
  },
  {
    id: "user_local_presenter_imed_paediatric",
    accountId: "account_local_presenter_imed_paediatric",
    name: "IMED Paediatric Presenter",
    email: "presenter.imed_paediatric@example.com",
  },
] satisfies Array<SeedCredentialUser>;

const accessOwnerProfiles = [
  {
    id: "user_local_access_owner_shared",
    accountId: "account_local_access_owner_shared",
    name: "Shared Code Access Owner",
    email: "owner.shared@example.com",
  },
  {
    id: "user_local_access_owner_unique",
    accountId: "account_local_access_owner_unique",
    name: "Unique Code Access Owner",
    email: "owner.unique@example.com",
  },
] satisfies Array<SeedCredentialUser>;

function relative(milliseconds: number): Date {
  return new Date(now.getTime() + milliseconds);
}

function identifier(value: string): string {
  return value.replaceAll("-", "_");
}

function requiredAt<T>(
  items: ReadonlyArray<T>,
  index: number,
  label: string,
): T {
  const item = items[index];
  if (item === undefined)
    throw new Error(`${label} ${String(index + 1)} is required`);
  return item;
}

async function seedCredentialUser(
  transaction: Transaction<Database>,
  profile: SeedCredentialUser,
  passwordHash: string,
): Promise<void> {
  await transaction
    .insertInto("user")
    .values({
      id: profile.id,
      name: profile.name,
      email: profile.email,
      emailVerified: true,
      image: null,
      stripeCustomerId: null,
      phone: null,
      currentRegionId: null,
      profileData: {},
    })
    .execute();
  await transaction
    .insertInto("account")
    .values({
      id: profile.accountId,
      accountId: profile.id,
      providerId: "credential",
      userId: profile.id,
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scope: null,
      password: passwordHash,
    })
    .execute();
}

async function seedCredentialAccounts(): Promise<void> {
  const passwordHash = await hashPassword(password);
  const profiles = [
    ...administrators,
    ...learnerProfiles,
    ...coordinatorProfiles,
    ...presenterProfiles,
    ...accessOwnerProfiles,
  ];
  await database.transaction().execute(async (transaction) => {
    for (const profile of profiles)
      await seedCredentialUser(transaction, profile, passwordHash);
    await transaction
      .insertInto("platform_admin")
      .values(
        administrators.map((administrator) => ({
          userId: administrator.id,
          grantedByUserId: null,
        })),
      )
      .execute();
    await transaction
      .insertInto("organization")
      .values([
        {
          id: "organization_nsw_health",
          name: "New South Wales Health",
          slug: "nsw-health",
        },
        {
          id: "organization_training_partner",
          name: "Clinical Training Partner",
          slug: "clinical-training-partner",
        },
      ])
      .execute();
    await transaction
      .insertInto("organization_member")
      .values(
        learnerProfiles.map((learner) => ({
          organizationId: "organization_nsw_health",
          userId: learner.id,
          role: "learner" as const,
        })),
      )
      .execute();
  });
}

function coordinatorForLearner(
  coordinators: Array<AuthenticatedUser>,
  learnerIndex: number,
): AuthenticatedUser {
  const regionIndex = learnerRegionIndexes[learnerIndex];
  assert.notEqual(regionIndex, undefined);
  const coordinator = coordinators[regionIndex ?? 0];
  assert.ok(coordinator);
  return coordinator;
}

async function userByEmail(email: string): Promise<AuthenticatedUser> {
  const user = await database
    .selectFrom("user")
    .select(["id", "name", "email", "emailVerified"])
    .where("email", "=", email)
    .executeTakeFirstOrThrow();
  return user;
}

async function assertScenarioIsAbsent(): Promise<void> {
  const [course, template, user] = await Promise.all([
    database
      .selectFrom("course")
      .select("id")
      .where("slug", "=", "the-essentials-training-clinicians")
      .executeTakeFirst(),
    database
      .selectFrom("event_template")
      .select("id")
      .where(
        "title",
        "=",
        "Inpatient Management for Eating Disorders (IMED) Adults",
      )
      .executeTakeFirst(),
    database
      .selectFrom("user")
      .select("id")
      .where("email", "=", "admin@example.com")
      .executeTakeFirst(),
  ]);
  if (course || template || user)
    throw new Error(
      "Development scenarios already exist; run pnpm run db:reset:local before reseeding",
    );
}

function surveyContent(
  prefix: string,
  title: string,
  phase: "pre" | "post",
): SurveyVersionContent {
  const promptLead = phase === "pre" ? "Before starting" : "After completing";
  return {
    title,
    description:
      phase === "pre"
        ? "Capture current confidence and learning goals before the activity."
        : "Reflect on learning, confidence and next steps after the activity.",
    sections: [
      {
        id: `${prefix}_introduction`,
        title: "Introduction",
        description: "A short orientation before the questions.",
        items: [
          {
            id: `${prefix}_instructions`,
            kind: "instruction",
            title: phase === "pre" ? "Before you begin" : "Before you finish",
            body:
              phase === "pre"
                ? "Answer based on your current knowledge. There are no right or wrong answers."
                : "Answer based on your experience and how you expect to apply the learning.",
          },
        ],
      },
      {
        id: `${prefix}_questions`,
        title: "Questions",
        description: "Complete each question to submit the survey.",
        items: [
          {
            id: `${prefix}_confidence`,
            kind: "single_choice",
            prompt: `${promptLead}, how confident do you feel?`,
            required: true,
            options: [
              { id: `${prefix}_confidence_low`, label: "Not yet confident" },
              { id: `${prefix}_confidence_some`, label: "Somewhat confident" },
              { id: `${prefix}_confidence_high`, label: "Very confident" },
            ],
          },
          {
            id: `${prefix}_priorities`,
            kind: "multiple_choice",
            prompt: "Which areas are most relevant to you?",
            required: true,
            options: [
              { id: `${prefix}_priority_practice`, label: "Clinical practice" },
              {
                id: `${prefix}_priority_communication`,
                label: "Communication",
              },
              { id: `${prefix}_priority_teamwork`, label: "Teamwork" },
            ],
          },
          {
            id: `${prefix}_reflection`,
            kind: "long_text",
            prompt:
              phase === "pre"
                ? "What would you most like to learn?"
                : "What is one action you will take next?",
            required: true,
            maximumLength: 500,
          },
        ],
      },
    ],
  };
}

async function createSurveyFixture(
  administrator: AuthenticatedUser,
  prefix: string,
  title: string,
  phase: "pre" | "post",
): Promise<string> {
  const created = await createAdminSurvey(title, "learning", administrator);
  const content = surveyContent(prefix, title, phase);
  const draft: AdminSurveyDraft = {
    surveyId: created.surveyId,
    versionId: created.versionId,
    ...content,
  };
  assert.equal(await saveAdminSurveyDraft(draft, administrator), "saved");
  assert.equal(
    await publishAdminSurveyVersion(
      created.surveyId,
      created.versionId,
      administrator,
    ),
    "published",
  );
  return created.versionId;
}

async function createOnboardingFixture(
  administrator: AuthenticatedUser,
): Promise<string> {
  const created = await createAdminSurvey(
    "User Onboarding",
    "onboarding",
    administrator,
  );
  const draft: AdminSurveyDraft = {
    surveyId: created.surveyId,
    versionId: created.versionId,
    title: "User Onboarding",
    description:
      "Welcome to Upskill. Complete these questions to finalise your account setup.",
    sections: [
      {
        id: "onboarding_personal",
        title: "Personal",
        description: "Personal details",
        items: [
          {
            id: "onboarding_full_name",
            kind: "short_text",
            format: "plain",
            prompt: "Full name",
            required: true,
            maximumLength: 240,
          },
          {
            id: "onboarding_age",
            kind: "number",
            prompt: "Age",
            integer: true,
            minimum: 18,
            maximum: 100,
            required: true,
          },
          {
            id: "onboarding_gender",
            kind: "single_choice",
            prompt: "Gender",
            required: true,
            options: [
              {
                id: "onboarding_gender_female",
                label: "Female",
                externalValue: "Female",
              },
              {
                id: "onboarding_gender_male",
                label: "Male",
                externalValue: "Male",
              },
              {
                id: "onboarding_gender_nonbinary",
                label: "Non-binary",
                externalValue: "Non-binary",
              },
              {
                id: "onboarding_gender_self_describe",
                label: "Prefer to self-describe",
                externalValue: "Self-described",
              },
              {
                id: "onboarding_gender_not_say",
                label: "Prefer not to say",
                externalValue: "Not stated",
              },
            ],
          },
        ],
      },
      {
        id: "onboarding_employment",
        title: "Employment",
        description: "Profession and workplace",
        items: [
          {
            id: "onboarding_discipline",
            kind: "dropdown",
            prompt: "What is your current discipline?",
            required: true,
            options: [
              {
                id: "discipline_dietitian",
                label: "Dietitian",
                externalValue: "Dietitian",
              },
              {
                id: "discipline_gp",
                label: "General practitioner",
                externalValue: "General practitioner",
              },
              {
                id: "discipline_nurse",
                label: "Nurse",
                externalValue: "Nurse",
              },
              {
                id: "discipline_psychologist",
                label: "Psychologist",
                externalValue: "Psychologist",
              },
              {
                id: "discipline_social_worker",
                label: "Social worker",
                externalValue: "Social worker",
              },
              {
                id: "discipline_student",
                label: "Student",
                externalValue: "Student",
              },
              {
                id: "discipline_other",
                label: "Other",
                externalValue: "Other",
              },
            ],
          },
          {
            id: "onboarding_primary_employment",
            kind: "dropdown",
            prompt: "Which option best describes your primary employment?",
            required: true,
            options: [
              {
                id: "employment_hospital",
                label: "Hospital setting",
                externalValue: "Hospital setting",
              },
              {
                id: "employment_general_practice",
                label: "General practice",
                externalValue: "General practice",
              },
              {
                id: "employment_private_practice",
                label: "Private practice",
                externalValue: "Private practice",
              },
              {
                id: "employment_headspace",
                label: "Headspace",
                externalValue: "Headspace",
              },
              {
                id: "employment_medicare_mental_health",
                label: "Medicare Mental Health",
                externalValue: "Medicare Mental Health",
              },
              {
                id: "employment_other",
                label: "Other",
                externalValue: "Other",
              },
            ],
          },
          {
            id: "onboarding_health_service",
            kind: "single_choice",
            prompt: "Do you work for a health service?",
            required: true,
            options: [
              {
                id: "onboarding_health_service_yes",
                label: "Yes",
                externalValue: "Yes",
              },
              {
                id: "onboarding_health_service_no",
                label: "No",
                externalValue: "No",
                nextSectionId: "onboarding_experience",
              },
            ],
          },
        ],
      },
      {
        id: "onboarding_health_region",
        title: "Health region",
        description: "Health service and operational region",
        items: [
          {
            id: "onboarding_region_group",
            kind: "dropdown",
            optionSource: "coordination_region_groups",
            prompt: "Select your health service",
            required: true,
            options: [],
          },
          {
            id: "onboarding_operational_region",
            kind: "dropdown",
            optionSource: "coordination_operational_regions",
            prompt: "Select your service region",
            required: true,
            options: [],
          },
        ],
      },
      {
        id: "onboarding_experience",
        title: "Experience",
        description: "Previous digital learning experience",
        items: [
          {
            id: "onboarding_learning_confidence",
            kind: "rating",
            prompt: "Confidence using an online learning system",
            required: true,
            minimum: 1,
            maximum: 5,
            minimumLabel: "Low confidence",
            maximumLabel: "High confidence",
          },
          {
            id: "onboarding_mobile_confidence",
            kind: "rating",
            prompt: "Confidence using mobile applications",
            required: true,
            minimum: 1,
            maximum: 5,
            minimumLabel: "Low confidence",
            maximumLabel: "High confidence",
          },
          {
            id: "onboarding_platform_satisfaction",
            kind: "rating",
            prompt: "Experience using other eLearning systems",
            required: true,
            minimum: 1,
            maximum: 5,
            minimumLabel: "Poor experience",
            maximumLabel: "Great experience",
          },
        ],
      },
    ],
  };
  assert.equal(await saveAdminSurveyDraft(draft, administrator), "saved");
  assert.equal(
    await publishAdminSurveyVersion(
      created.surveyId,
      created.versionId,
      administrator,
    ),
    "published",
  );
  const activation = await activateOnboardingConfiguration(
    {
      surveyVersionId: created.versionId,
      privacyNotice:
        "Upskill Institute understands the importance of keeping personal information private. We collect profile and employment information to provide learning, event coordination and reporting services. We disclose personal information only with consent or where required or permitted by law. Contact admin@upskill.institute with questions about how information is handled.",
      privacyNoticeVersion: "1",
      profileMappings: [
        { questionId: "onboarding_full_name", destination: "name" },
        {
          questionId: "onboarding_operational_region",
          destination: "currentRegionId",
        },
      ],
    },
    administrator,
  );
  assert.equal(activation.status, "activated");
  return created.versionId;
}

async function completeLearnerOnboarding(
  learner: AuthenticatedUser,
  learnerIndex: number,
  regionId: string | null,
): Promise<void> {
  const assignment = await findLearnerOnboarding(learner);
  assert.equal(typeof assignment, "object");
  if (typeof assignment === "string")
    throw new Error("Expected onboarding assignment");
  const steps: Array<[string, string | number | undefined]> = [
    ["onboarding_full_name", learner.name],
    ["onboarding_age", 25 + (learnerIndex % 30)],
    [
      "onboarding_gender",
      learnerIndex % 2 === 0
        ? "onboarding_gender_female"
        : "onboarding_gender_male",
    ],
    [
      "onboarding_discipline",
      ["discipline_nurse", "discipline_psychologist", "discipline_dietitian"][
        learnerIndex % 3
      ] ?? "discipline_nurse",
    ],
    ["onboarding_primary_employment", "employment_hospital"],
    [
      "onboarding_health_service",
      regionId
        ? "onboarding_health_service_yes"
        : "onboarding_health_service_no",
    ],
  ];
  if (regionId)
    steps.push(
      ["onboarding_region_group", regionGroups[0].id],
      ["onboarding_operational_region", regionId],
    );
  steps.push(
    ["onboarding_learning_confidence", 4],
    ["onboarding_mobile_confidence", 4],
    ["onboarding_platform_satisfaction", 3],
  );
  for (const [questionId, answer] of steps) {
    const result = await saveLearnerOnboardingStep(
      assignment.assignmentId,
      questionId,
      answer,
      learner,
    );
    assert.ok(
      result.status === "advanced" || result.status === "submitted",
      `Onboarding step ${questionId} failed for ${learner.email}: ${result.status}`,
    );
  }
}

async function createPublishedEmail(
  administrator: AuthenticatedUser,
  input: {
    name: string;
    contextKey: "offering_course" | "offering_event";
    subject: string;
    textBody: string;
  },
): Promise<string> {
  const created = await createAdminOfferingEmail(
    { name: input.name, contextKey: input.contextKey },
    administrator,
  );
  assert.equal(
    await saveAdminEmailDraft({
      emailDesignId: created.emailDesignId,
      versionId: created.versionId,
      subject: input.subject,
      textBody: input.textBody,
    }),
    "saved",
  );
  assert.equal(
    await publishAdminEmailVersion(created, administrator),
    "published",
  );
  return created.versionId;
}

interface EmailFixtureVersions {
  courseWelcome: string;
  courseReminder: string;
  courseCompleted: string;
  eventConfirmation: string;
  eventPreparation: string;
  eventTaskReminder: string;
  eventFinalReminder: string;
  eventSessionDetails: string;
  eventFeedback: string;
  eventCertificate: string;
}

async function createEmailFixtures(
  administrator: AuthenticatedUser,
): Promise<EmailFixtureVersions> {
  const courseContext = "offering_course" as const;
  const eventContext = "offering_event" as const;
  return {
    courseWelcome: await createPublishedEmail(administrator, {
      name: "Course enrolment confirmation",
      contextKey: courseContext,
      subject: "Your course is ready: {{course.title}}",
      textBody:
        "Hello {{user.firstName}},\n\nYou are enrolled in {{course.title}}. Open your course workspace to begin: {{course.dashboardUrl}}",
    }),
    courseReminder: await createPublishedEmail(administrator, {
      name: "Course progress reminder",
      contextKey: courseContext,
      subject: "Continue {{course.title}}",
      textBody:
        "Hello {{user.firstName}},\n\nYou have completed {{enrolment.progressPercent}} of {{course.title}}. Continue here: {{course.dashboardUrl}}",
    }),
    courseCompleted: await createPublishedEmail(administrator, {
      name: "Course completion and certificate",
      contextKey: courseContext,
      subject: "You completed {{course.title}}",
      textBody:
        "Hello {{user.firstName}},\n\nCongratulations on completing {{course.title}}. Your certificate is available from {{course.certificateUrl}}",
    }),
    eventConfirmation: await createPublishedEmail(administrator, {
      name: "Event registration confirmation",
      contextKey: eventContext,
      subject: "Confirmed: {{event.title}}",
      textBody:
        "Hello {{user.firstName}},\n\nYour place at {{event.title}} is confirmed. It begins {{event.startsAt}}. View the event at {{event.dashboardUrl}}",
    }),
    eventPreparation: await createPublishedEmail(administrator, {
      name: "Event preparation guide",
      contextKey: eventContext,
      subject: "Get ready for {{event.title}}",
      textBody:
        "Hello {{user.firstName}},\n\nPlease review your schedule and complete all pre-event activities before {{event.startsAt}}: {{event.dashboardUrl}}",
    }),
    eventTaskReminder: await createPublishedEmail(administrator, {
      name: "Pre-event task reminder",
      contextKey: eventContext,
      subject: "Complete your pre-event activities for {{event.title}}",
      textBody:
        "Hello {{user.firstName}},\n\nYour event is approaching. Complete the activities in {{section.title}} at {{event.dashboardUrl}}",
    }),
    eventFinalReminder: await createPublishedEmail(administrator, {
      name: "Final event reminder",
      contextKey: eventContext,
      subject: "Final reminder: {{event.title}}",
      textBody:
        "Hello {{user.firstName}},\n\n{{event.title}} starts {{event.startsAt}}. Check the latest venue and access details at {{event.dashboardUrl}}",
    }),
    eventSessionDetails: await createPublishedEmail(administrator, {
      name: "Event session details",
      contextKey: eventContext,
      subject: "Your session: {{session.title}}",
      textBody:
        "Hello {{user.firstName}},\n\n{{session.title}} starts {{session.startsAt}} at {{session.locationSummary}}. Your presenter is {{session.presenterNames}}.",
    }),
    eventFeedback: await createPublishedEmail(administrator, {
      name: "Post-event feedback reminder",
      contextKey: eventContext,
      subject: "Share feedback about {{event.title}}",
      textBody:
        "Hello {{user.firstName}},\n\nThank you for attending {{event.title}}. Please complete the post-event activities at {{event.dashboardUrl}}",
    }),
    eventCertificate: await createPublishedEmail(administrator, {
      name: "Event completion and certificate",
      contextKey: eventContext,
      subject: "Your {{event.title}} certificate",
      textBody:
        "Hello {{user.firstName}},\n\nOnce all required activities are complete, download your attendance certificate from {{event.certificateUrl}}",
    }),
  };
}

async function ingestScormFixture(
  administrator: AuthenticatedUser,
): Promise<string> {
  const staged = await stageScormPackageArchive({
    actorUserId: administrator.id,
    archive: await readFile(archivePath),
    title: scormTitle,
  });
  const outcome = await ingestScormPackageVersion(
    staged.packageVersionId,
    staged.quarantineKey,
  );
  assert.equal(outcome.status, "ready");
  await database
    .updateTable("outbox_event")
    .set({ processedAt: new Date() })
    .where("aggregateId", "=", staged.packageVersionId)
    .where("topic", "=", "scorm.package_ingest_requested")
    .execute();
  return staged.packageVersionId;
}

interface CourseFixture {
  courseId: string;
  versionId: string;
  slug: string;
  enrollmentDurationDays: number;
}

async function createCourseFixture(
  administrator: AuthenticatedUser,
  input: {
    slug: string;
    title: string;
    summary: string;
    description: string;
    durationMinutes: number;
    priceCents: number;
    salePriceCents?: number | null;
    enrollmentDurationDays: number;
    accreditations?: AdminCourseDraft["accreditations"];
    preSurveys: Array<{ title: string; versionId: string }>;
    postSurveys: Array<{ title: string; versionId: string }>;
    modules: Array<{
      title: string;
      durationMinutes: number;
      versionId: string;
    }>;
    emails: Pick<
      EmailFixtureVersions,
      "courseWelcome" | "courseReminder" | "courseCompleted"
    >;
  },
): Promise<CourseFixture> {
  const created = await createAdminCourse(
    { title: input.title, slug: input.slug },
    administrator,
  );
  assert.equal(created.status, "created");
  const prefix = identifier(input.slug);
  const draft: AdminCourseDraft = {
    courseId: created.courseId,
    versionId: created.versionId,
    slug: input.slug,
    title: input.title,
    summary: input.summary,
    description: input.description,
    topic: "safety",
    durationMinutes: input.durationMinutes,
    priceCents: input.priceCents,
    salePriceCents: input.salePriceCents ?? null,
    bulkPricing: {
      enabled: true,
      tiers: [
        {
          minimumQuantity: 5,
          unitPriceCents: Math.max(
            1,
            Math.round((input.salePriceCents ?? input.priceCents) * 0.9),
          ),
        },
        {
          minimumQuantity: 20,
          unitPriceCents: Math.max(
            1,
            Math.round((input.salePriceCents ?? input.priceCents) * 0.8),
          ),
        },
        {
          minimumQuantity: 50,
          unitPriceCents: Math.max(
            1,
            Math.round((input.salePriceCents ?? input.priceCents) * 0.7),
          ),
        },
      ],
    },
    featured: true,
    listInStore: true,
    coverImage: null,
    hasCompletionCertificate: true,
    prerequisites: [],
    accreditations: input.accreditations ?? [],
    sections: [
      {
        id: `${prefix}_pre_section`,
        title: "Pre Learning",
        description: "",
        items: [
          {
            id: `${prefix}_welcome_email`,
            kind: "automated_email",
            title: "Course enrolment confirmation",
            emailDesignVersionId: input.emails.courseWelcome,
            audience: "affected_learner",
            trigger: "enrollment_created",
            offsetAmount: 0,
            offsetUnit: "minute",
            subjectOverride: null,
            textBodyOverride: null,
          },
          ...input.preSurveys.map((survey, index) => ({
            id: `${prefix}_pre_survey_${String(index + 1)}`,
            kind: "survey" as const,
            title: survey.title,
            required: true,
            durationMinutes: 5,
            surveyVersionId: survey.versionId,
          })),
          {
            id: `${prefix}_progress_email`,
            kind: "automated_email",
            title: "Course progress reminder",
            emailDesignVersionId: input.emails.courseReminder,
            audience: "active_enrollees",
            trigger: "course_incomplete",
            offsetAmount: 7,
            offsetUnit: "day",
            subjectOverride: null,
            textBodyOverride: null,
          },
        ],
      },
      {
        id: `${prefix}_learning_section`,
        title:
          input.title ===
          "The Essentials: Training Clinicians in Eating Disorders"
            ? "The Essentials"
            : "Course Modules",
        description: "",
        items: input.modules.map((module, index) => ({
          id: `${prefix}_module_${String(index + 1)}`,
          kind: "scorm" as const,
          title: module.title,
          required: true,
          durationMinutes: module.durationMinutes,
          scormPackageVersionId: module.versionId,
        })),
      },
      {
        id: `${prefix}_post_section`,
        title: "Post Learning",
        description: "",
        items: [
          ...input.postSurveys.map((survey, index) => ({
            id: `${prefix}_post_survey_${String(index + 1)}`,
            kind: "survey" as const,
            title: survey.title,
            required: true,
            durationMinutes: 5,
            surveyVersionId: survey.versionId,
          })),
          {
            id: `${prefix}_completion_email`,
            kind: "automated_email",
            title: "Course completion and certificate",
            emailDesignVersionId: input.emails.courseCompleted,
            audience: "affected_learner",
            trigger: "enrollment_completed",
            offsetAmount: 0,
            offsetUnit: "minute",
            subjectOverride: null,
            textBodyOverride: null,
          },
        ],
      },
    ],
  };
  assert.equal(await saveAdminCourseDraft(draft, administrator), "saved");
  assert.equal(
    await publishAdminCourseVersion(
      created.courseId,
      created.versionId,
      administrator,
    ),
    "published",
  );
  return {
    ...created,
    slug: input.slug,
    enrollmentDurationDays: input.enrollmentDurationDays,
  };
}

function answersForSurvey(
  content: SurveyVersionContent,
): Record<string, string | Array<string>> {
  const answers: Record<string, string | Array<string>> = {};
  for (const item of content.sections.flatMap((section) => section.items)) {
    if (item.kind === "instruction") continue;
    if (item.kind === "short_text" || item.kind === "long_text")
      answers[item.id] = "A practical next step for this test learner.";
    else if (item.kind === "single_choice" || item.kind === "dropdown")
      answers[item.id] = item.options[1]?.id ?? item.options[0]?.id ?? "";
    else if (item.kind === "multiple_choice")
      answers[item.id] = item.options.slice(0, 2).map((option) => option.id);
  }
  return answers;
}

async function completeSurveyItem(
  enrollmentId: string,
  item: {
    id: string;
    learningActivityVersionId: string;
  },
  completedAt: Date,
): Promise<void> {
  const survey = await database
    .selectFrom("survey_version")
    .select("content")
    .where("id", "=", item.learningActivityVersionId)
    .executeTakeFirstOrThrow();
  const content = parseSurveyVersionContent(survey.content);
  const visitedItemIds = content.sections.flatMap((section) =>
    section.items.map((surveyItem) => surveyItem.id),
  );
  const answers = answersForSurvey(content);
  await database
    .insertInto("survey_progress")
    .values({
      id: `survey_progress_${enrollmentId}_${item.id}`,
      enrollmentId,
      courseVersionItemId: item.id,
      surveyVersionId: item.learningActivityVersionId,
      answers,
      visitedItemIds: JSON.stringify(visitedItemIds),
      currentItemId: null,
      startedAt: new Date(completedAt.getTime() - 5 * minute),
      updatedAt: completedAt,
      completedAt,
    })
    .execute();
  await database
    .insertInto("survey_response")
    .values({
      id: `survey_response_${enrollmentId}_${item.id}`,
      enrollmentId,
      courseVersionItemId: item.id,
      surveyVersionId: item.learningActivityVersionId,
      answers,
      submittedAt: completedAt,
    })
    .execute();
  await database
    .insertInto("learning_item_progress")
    .values({
      id: `learning_progress_${enrollmentId}_${item.id}`,
      enrollmentId,
      courseVersionItemId: item.id,
      state: "completed",
      completedAt,
      updatedAt: completedAt,
    })
    .execute();
}

async function completeScormItem(
  enrollmentId: string,
  item: {
    id: string;
    learningActivityVersionId: string;
    modulePosition: number | null;
  },
  completedAt: Date,
): Promise<void> {
  assert.notEqual(item.modulePosition, null);
  await database
    .insertInto("scorm_attempt")
    .values({
      id: `scorm_attempt_${enrollmentId}_${String(item.modulePosition)}`,
      enrollmentId,
      modulePosition: item.modulePosition ?? 0,
      scormPackageVersionId: item.learningActivityVersionId,
      attemptNumber: 1,
      status: "completed",
      lessonStatus: "passed",
      location: "completed",
      suspendData: "",
      scoreRaw: 100,
      scoreMin: 0,
      scoreMax: 100,
      totalTimeSeconds: 1_800,
      startedAt: new Date(completedAt.getTime() - 30 * minute),
      lastActivityAt: completedAt,
      completedAt,
      createdAt: new Date(completedAt.getTime() - 30 * minute),
      updatedAt: completedAt,
    })
    .execute();
}

async function seedCourseEnrollment(
  learner: AuthenticatedUser,
  course: CourseFixture,
  state: "not_started" | "partial" | "completed",
): Promise<void> {
  const enrollmentId = `enrollment_${identifier(course.slug)}_${learner.id}`;
  const enrolledAt = relative(-14 * day);
  await database
    .insertInto("enrollment")
    .values({
      id: enrollmentId,
      userId: learner.id,
      courseVersionId: course.versionId,
      accessGrantId: null,
      status: "active",
      enrolledAt,
      completedAt: null,
      expiresAt: relative(365 * day),
      removedAt: null,
    })
    .execute();
  if (state === "not_started") return;

  const items = await database
    .selectFrom("course_version_item")
    .innerJoin(
      "course_version_section",
      "course_version_section.id",
      "course_version_item.sectionId",
    )
    .select([
      "course_version_item.id",
      "course_version_item.kind",
      "course_version_item.learningActivityVersionId",
      "course_version_item.modulePosition",
      "course_version_section.position as sectionPosition",
      "course_version_item.position as itemPosition",
    ])
    .where("course_version_item.courseVersionId", "=", course.versionId)
    .orderBy("course_version_section.position")
    .orderBy("course_version_item.position")
    .execute();
  const completedAt = relative(-2 * day);
  const targets =
    state === "completed"
      ? items
      : items.filter(
          (item) =>
            (item.kind === "survey" && item.sectionPosition === 0) ||
            (item.kind === "scorm" && item.modulePosition === 0),
        );
  for (const item of targets) {
    if (item.kind === "scorm")
      await completeScormItem(enrollmentId, item, completedAt);
    else if (item.kind === "survey")
      await completeSurveyItem(enrollmentId, item, completedAt);
  }
  if (state === "completed") {
    const completed = await database.transaction().execute((transaction) =>
      completeEnrollmentIfReady(
        transaction,
        {
          enrollmentId,
          courseVersionId: course.versionId,
          source: "survey",
        },
        completedAt,
      ),
    );
    assert.equal(completed, true);
  }
}

interface EventOccurrenceFixture {
  id: string;
  slug: string;
  registrationClosesAt: Date;
  coordinatorLockAt: Date;
  regions: Array<{
    occurrenceRegionId: string;
    regionId: string;
    reviewRoundId: string;
  }>;
  sessionIds: Array<string>;
}

async function createEventOccurrenceFixture(
  administrator: AuthenticatedUser,
  eventTemplateVersionId: string,
  input: {
    title: string;
    slug: string;
    deliveryMode: "in_person" | "virtual";
    startsAt: Date;
    endsAt: Date;
    registrationOpensAt: Date;
    registrationClosesAt: Date;
    coordinatorLockAt: Date;
    reviewsLocked: boolean;
    capacity: number;
  },
): Promise<EventOccurrenceFixture> {
  const occurrence = await createAdminEventOccurrence(
    {
      eventTemplateVersionId,
      title: input.title,
      slug: input.slug,
      deliveryMode: input.deliveryMode,
      registrationMode: "required_unrestricted",
      approvalMode: "manual",
      timezone: "Australia/Sydney",
      localStartsAt: localDevelopmentTime(input.startsAt),
      localEndsAt: localDevelopmentTime(input.endsAt),
      localRegistrationOpensAt: localDevelopmentTime(input.registrationOpensAt),
      localRegistrationClosesAt: localDevelopmentTime(
        input.registrationClosesAt,
      ),
      localCoordinatorLockAt: localDevelopmentTime(input.coordinatorLockAt),
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
      registrationOpensAt: input.registrationOpensAt.toISOString(),
      registrationClosesAt: input.registrationClosesAt.toISOString(),
      coordinatorLockAt: input.coordinatorLockAt.toISOString(),
      capacity: input.capacity,
      priceCents: null,
      salePriceCents: null,
      currency: "AUD",
      bulkPricing: { enabled: false, tiers: [] },
      listInStore: false,
      featured: false,
      venueName:
        input.deliveryMode === "in_person" ? "Upskill Test Centre" : "",
      venueAddress:
        input.deliveryMode === "in_person"
          ? "100 Learning Street, Sydney NSW"
          : "",
      virtualJoinUrl:
        input.deliveryMode === "virtual"
          ? `https://meet.example.com/${input.slug}`
          : "",
      domains: "",
    },
    administrator,
  );
  assert.equal(occurrence.status, "created");
  assert.equal(
    await publishAdminEventOccurrence(
      occurrence.eventOccurrenceId,
      administrator,
    ),
    "published",
  );
  const occurrenceRegions = await database
    .selectFrom("event_occurrence_region")
    .select(["id", "regionId", "position"])
    .where("eventOccurrenceId", "=", occurrence.eventOccurrenceId)
    .orderBy("position")
    .execute();
  const sessions = await database
    .selectFrom("event_session")
    .select(["id", "position"])
    .where("eventOccurrenceId", "=", occurrence.eventOccurrenceId)
    .orderBy("position")
    .execute();
  assert.equal(sessions.length, 2);
  for (const [index, session] of sessions.entries()) {
    const startsAt = new Date(input.startsAt.getTime() + index * day);
    const endsAt = new Date(startsAt.getTime() + 8 * hour);
    await database
      .updateTable("event_session")
      .set({
        startsAt,
        endsAt,
        localStartsAt: localDevelopmentTime(startsAt),
        localEndsAt: localDevelopmentTime(endsAt),
      })
      .where("id", "=", session.id)
      .execute();
  }
  const reviewRoundIds: Array<string> = [];
  for (const [regionIndex, occurrenceRegion] of occurrenceRegions.entries()) {
    const reviewRoundId = `review_${identifier(input.slug)}_${String(regionIndex + 1)}`;
    reviewRoundIds.push(reviewRoundId);
    const configuredRegionIndex = regions.findIndex(
      (region) => region.id === occurrenceRegion.regionId,
    );
    assert.notEqual(configuredRegionIndex, -1);
    const coordinator = requiredAt(
      coordinatorProfiles,
      configuredRegionIndex,
      "Coordinator profile",
    );
    await database
      .insertInto("event_region_review_round")
      .values({
        id: reviewRoundId,
        eventOccurrenceRegionId: occurrenceRegion.id,
        round: 1,
        registrationClosesAt: input.registrationClosesAt,
        coordinatorLockAt: input.coordinatorLockAt,
        lockedAt: input.reviewsLocked ? input.coordinatorLockAt : null,
        lockedByUserId: input.reviewsLocked ? coordinator.id : null,
        lockSource: input.reviewsLocked ? "manual" : null,
        eventOccurrenceRescheduleId: null,
      })
      .execute();
  }
  return {
    id: occurrence.eventOccurrenceId,
    slug: input.slug,
    registrationClosesAt: input.registrationClosesAt,
    coordinatorLockAt: input.coordinatorLockAt,
    regions: occurrenceRegions.map((region, index) => ({
      occurrenceRegionId: region.id,
      regionId: region.regionId,
      reviewRoundId: requiredAt(reviewRoundIds, index, "Review round"),
    })),
    sessionIds: sessions.map((session) => session.id),
  };
}

type RegistrationStatus =
  | "submitted"
  | "coordinator_approved"
  | "coordinator_declined"
  | "selected"
  | "waitlisted"
  | "not_selected"
  | "cancelled";

interface SeededRegistration {
  participationId: string | null;
  registrationId: string;
}

async function seedEventRegistration(
  occurrence: EventOccurrenceFixture,
  learner: AuthenticatedUser,
  learnerIndex: number,
  coordinator: AuthenticatedUser,
  administrator: AuthenticatedUser,
  status: RegistrationStatus,
  priority: number | null,
): Promise<SeededRegistration> {
  const regionIndex = learnerRegionIndexes[learnerIndex] ?? 0;
  const learnerRegion = requiredAt(regions, regionIndex, "Learner region");
  const occurrenceRegion = occurrence.regions.find(
    (region) => region.regionId === learnerRegion.id,
  );
  assert.ok(
    occurrenceRegion,
    `${learner.email} region ${learnerRegion.code} is not configured for ${occurrence.slug}`,
  );
  const occurrenceRegionId = occurrenceRegion.occurrenceRegionId;
  const reviewRoundId = occurrenceRegion.reviewRoundId;
  const registrationId = `registration_${identifier(occurrence.slug)}_${learner.id}`;
  const submittedAt = new Date(
    Math.min(
      relative(-10 * day).getTime(),
      occurrence.registrationClosesAt.getTime() - day,
    ),
  );
  const coordinatorDecided = status !== "submitted";
  const finalDecided = [
    "selected",
    "waitlisted",
    "not_selected",
    "cancelled",
  ].includes(status);
  await database
    .insertInto("event_registration")
    .values({
      id: registrationId,
      eventOccurrenceId: occurrence.id,
      userId: learner.id,
      eventOccurrenceRegionId: occurrenceRegionId,
      reviewRoundId,
      nameSnapshot: learner.name,
      emailSnapshot: learner.email,
      source: "ordinary",
      eligibilitySource: "unrestricted",
      status,
      coordinatorPriority: coordinatorDecided ? priority : null,
      submittedAt,
      coordinatorDecidedAt: coordinatorDecided
        ? new Date(submittedAt.getTime() + hour)
        : null,
      coordinatorDecidedByUserId: coordinatorDecided ? coordinator.id : null,
      finalDecidedAt: finalDecided
        ? new Date(submittedAt.getTime() + 2 * hour)
        : null,
      finalDecidedByUserId: finalDecided ? administrator.id : null,
      lockedInAt:
        status === "selected"
          ? new Date(submittedAt.getTime() + 2 * hour)
          : null,
    })
    .execute();

  const transitions: Array<{
    fromStatus: RegistrationStatus | null;
    toStatus: RegistrationStatus;
    source: "learner" | "coordinator" | "administrator";
    actorUserId: string;
    occurredAt: Date;
  }> = [
    {
      fromStatus: null,
      toStatus: "submitted",
      source: "learner",
      actorUserId: learner.id,
      occurredAt: submittedAt,
    },
  ];
  if (coordinatorDecided) {
    const coordinatorStatus =
      status === "coordinator_declined"
        ? "coordinator_declined"
        : "coordinator_approved";
    transitions.push({
      fromStatus: "submitted",
      toStatus: coordinatorStatus,
      source: "coordinator",
      actorUserId: coordinator.id,
      occurredAt: new Date(submittedAt.getTime() + hour),
    });
    if (finalDecided)
      transitions.push({
        fromStatus: coordinatorStatus,
        toStatus: status,
        source: "administrator",
        actorUserId: administrator.id,
        occurredAt: new Date(submittedAt.getTime() + 2 * hour),
      });
  }
  await database
    .insertInto("event_registration_transition")
    .values(
      transitions.map((transition, index) => ({
        id: `transition_${registrationId}_${String(index + 1)}`,
        eventRegistrationId: registrationId,
        fromStatus: transition.fromStatus,
        toStatus: transition.toStatus,
        source: transition.source,
        actorUserId: transition.actorUserId,
        priority:
          transition.source === "coordinator" &&
          transition.toStatus === "coordinator_approved"
            ? priority
            : null,
        occurredAt: transition.occurredAt,
      })),
    )
    .execute();

  let participationId: string | null = null;
  if (status === "selected") {
    participationId = `participation_${registrationId}`;
    await database
      .insertInto("event_participation")
      .values({
        id: participationId,
        eventOccurrenceId: occurrence.id,
        userId: learner.id,
        registrationId,
        mode: "registered",
        nameSnapshot: learner.name,
        emailSnapshot: learner.email,
        detailsSubmittedAt: submittedAt,
        joinDisclosedAt: relative(-hour),
        checkedInAt: null,
        createdAt: submittedAt,
      })
      .execute();
  }
  return { participationId, registrationId };
}

async function setConfirmedCount(occurrenceId: string): Promise<void> {
  const selected = await database
    .selectFrom("event_registration")
    .select((expression) => expression.fn.count<number>("id").as("count"))
    .where("eventOccurrenceId", "=", occurrenceId)
    .where("status", "=", "selected")
    .executeTakeFirstOrThrow();
  await database
    .updateTable("event_occurrence")
    .set({ confirmedCount: selected.count, updatedAt: new Date() })
    .where("id", "=", occurrenceId)
    .execute();
}

async function seedAttendance(
  occurrence: EventOccurrenceFixture,
  registration: SeededRegistration,
  coordinator: AuthenticatedUser,
  state: "checked_in" | "attended" | "absent",
): Promise<void> {
  assert.ok(registration.participationId);
  const recordedAt = relative(-30 * minute);
  await database
    .insertInto("event_attendance")
    .values(
      occurrence.sessionIds.map((eventSessionId, index) => ({
        eventParticipationId: registration.participationId as string,
        eventSessionId,
        state,
        source: "presenter" as const,
        recordedByUserId: coordinator.id,
        recordedAt: new Date(recordedAt.getTime() + index * day),
        updatedAt: new Date(recordedAt.getTime() + index * day),
      })),
    )
    .execute();
  await database
    .updateTable("event_participation")
    .set({
      checkedInAt:
        state === "checked_in" || state === "attended" ? recordedAt : null,
    })
    .where("id", "=", registration.participationId)
    .execute();
}

interface EventTemplateFixture {
  id: string;
  versionId: string;
  key: string;
  title: string;
  regionIndexes: Array<number>;
}

async function createEventTemplateFixture(
  administrator: AuthenticatedUser,
  input: {
    key: string;
    title: string;
    summary: string;
    description: string;
    presenter: AuthenticatedUser;
    regionIndexes: Array<number>;
    preSurveyVersionIds: Array<string>;
    postSurveyVersionIds: Array<string>;
    prerequisiteScormVersionId: string;
    emails: EmailFixtureVersions;
  },
): Promise<EventTemplateFixture> {
  const created = await createAdminEventTemplate(
    {
      title: input.title,
      defaultAdministratorIds: [administrator.id],
    },
    administrator,
  );
  assert.equal(created.status, "created");
  const prefix = identifier(input.key);
  const dayOneSessionId = `${prefix}_session_day_one`;
  const dayTwoSessionId = `${prefix}_session_day_two`;
  const draft: AdminEventTemplateDraft = {
    eventTemplateId: created.eventTemplateId,
    eventTemplateVersionId: created.eventTemplateVersionId,
    title: input.title,
    topic: "Eating disorder training",
    summary: input.summary,
    description: input.description,
    coverImage: null,
    hasCompletionCertificate: true,
    accreditations: [],
    defaultAdministratorIds: [administrator.id],
    regions: input.regionIndexes.map((regionIndex) => ({
      regionId: requiredAt(regions, regionIndex, "Event region").id,
      coordinatorIds: [
        requiredAt(coordinatorProfiles, regionIndex, "Event coordinator").id,
      ],
    })),
    sections: [
      {
        id: `${prefix}_pre_event`,
        title: "Pre-Event Tasks",
        description: "",
        phase: "pre_event",
        releaseAnchor: "participation_created",
        releaseOffsetAmount: 0,
        releaseOffsetUnit: "minute",
        items: [
          {
            id: `${prefix}_email_confirmation`,
            kind: "automated_email",
            title: "Event confirmation",
            emailDesignVersionId: input.emails.eventConfirmation,
            audience: "affected_learner",
            trigger: "registration_selected",
            offsetAmount: 0,
            offsetUnit: "minute",
            subjectOverride: null,
            textBodyOverride: null,
            sessionItemId: null,
          },
          {
            id: `${prefix}_email_preparation`,
            kind: "automated_email",
            title: "Your event schedule and preparation guide",
            emailDesignVersionId: input.emails.eventPreparation,
            audience: "confirmed_participants",
            trigger: "event_start",
            offsetAmount: -21,
            offsetUnit: "day",
            subjectOverride: null,
            textBodyOverride: null,
            sessionItemId: null,
          },
          {
            id: `${prefix}_consent`,
            kind: "survey",
            title: "Help us evaluate our training events",
            required: true,
            durationMinutes: 5,
            learningActivityVersionId: requiredAt(
              input.preSurveyVersionIds,
              0,
              "Event consent survey",
            ),
          },
          {
            id: `${prefix}_prerequisite`,
            kind: "scorm",
            title:
              "Pre-requisite eLearning: Eating Disorder Inpatient Management",
            required: true,
            durationMinutes: 60,
            learningActivityVersionId: input.prerequisiteScormVersionId,
          },
          ...input.preSurveyVersionIds.slice(1).map((versionId, index) => ({
            id: `${prefix}_pre_survey_${String(index + 1)}`,
            kind: "survey" as const,
            title:
              ["Pre-event survey", "Core skills check", "Learning targets"][
                index
              ] ?? `Pre-event survey ${String(index + 1)}`,
            required: true,
            durationMinutes: 8,
            learningActivityVersionId: versionId,
          })),
          {
            id: `${prefix}_email_task_reminder`,
            kind: "automated_email",
            title: "Complete your pre-event surveys now",
            emailDesignVersionId: input.emails.eventTaskReminder,
            audience: "confirmed_participants",
            trigger: "event_start",
            offsetAmount: -3,
            offsetUnit: "day",
            subjectOverride: null,
            textBodyOverride: null,
            sessionItemId: null,
          },
        ],
      },
      {
        id: `${prefix}_workshop`,
        title: "Workshop Sessions",
        description: "",
        phase: "session",
        releaseAnchor: "occurrence_start",
        releaseOffsetAmount: 0,
        releaseOffsetUnit: "minute",
        items: [
          {
            id: `${prefix}_email_final_reminder`,
            kind: "automated_email",
            title: "Final event reminder",
            emailDesignVersionId: input.emails.eventFinalReminder,
            audience: "confirmed_participants",
            trigger: "event_start",
            offsetAmount: -1,
            offsetUnit: "day",
            subjectOverride: null,
            textBodyOverride: null,
            sessionItemId: null,
          },
          {
            id: `${prefix}_email_day_one`,
            kind: "automated_email",
            title: "Day 1 workshop details",
            emailDesignVersionId: input.emails.eventSessionDetails,
            audience: "confirmed_participants",
            trigger: "session_start",
            offsetAmount: -1,
            offsetUnit: "day",
            subjectOverride: null,
            textBodyOverride: null,
            sessionItemId: dayOneSessionId,
          },
          {
            id: dayOneSessionId,
            kind: "session",
            title: `${input.title} · Day 1`,
            required: true,
            durationMinutes: 480,
            presenterRequired: true,
            presenterIds: [input.presenter.id],
          },
          {
            id: `${prefix}_email_day_two`,
            kind: "automated_email",
            title: "Day 2 workshop details",
            emailDesignVersionId: input.emails.eventSessionDetails,
            audience: "confirmed_participants",
            trigger: "session_start",
            offsetAmount: -1,
            offsetUnit: "day",
            subjectOverride: null,
            textBodyOverride: null,
            sessionItemId: dayTwoSessionId,
          },
          {
            id: dayTwoSessionId,
            kind: "session",
            title: `${input.title} · Day 2`,
            required: true,
            durationMinutes: 480,
            presenterRequired: true,
            presenterIds: [input.presenter.id],
          },
        ],
      },
      {
        id: `${prefix}_post_event`,
        title: "Post-Event Tasks",
        description: "",
        phase: "post_event",
        releaseAnchor: "final_session_end",
        releaseOffsetAmount: -2,
        releaseOffsetUnit: "hour",
        items: [
          {
            id: `${prefix}_email_feedback`,
            kind: "automated_email",
            title: "Complete your feedback",
            emailDesignVersionId: input.emails.eventFeedback,
            audience: "confirmed_participants",
            trigger: "event_end",
            offsetAmount: 0,
            offsetUnit: "minute",
            subjectOverride: null,
            textBodyOverride: null,
            sessionItemId: null,
          },
          ...input.postSurveyVersionIds.map((versionId, index) => ({
            id: `${prefix}_post_survey_${String(index + 1)}`,
            kind: "survey" as const,
            title:
              [
                "Post-event survey",
                "Core skills check",
                "Learning targets",
                "Training evaluation",
              ][index] ?? `Post-event survey ${String(index + 1)}`,
            required: true,
            durationMinutes: 8,
            learningActivityVersionId: versionId,
          })),
          {
            id: `${prefix}_email_certificate`,
            kind: "automated_email",
            title: "Attendance certificate available",
            emailDesignVersionId: input.emails.eventCertificate,
            audience: "confirmed_participants",
            trigger: "event_completed",
            offsetAmount: 1,
            offsetUnit: "day",
            subjectOverride: null,
            textBodyOverride: null,
            sessionItemId: null,
          },
        ],
      },
    ],
  };
  assert.equal(
    await saveAdminEventTemplateDraft(draft, administrator),
    "saved",
  );
  assert.equal(
    await publishAdminEventTemplateVersion(
      created.eventTemplateId,
      created.eventTemplateVersionId,
      administrator,
    ),
    "published",
  );
  return {
    id: created.eventTemplateId,
    versionId: created.eventTemplateVersionId,
    key: input.key,
    title: input.title,
    regionIndexes: input.regionIndexes,
  };
}

interface AccessGrantFixture {
  id: string;
  label: string;
  fulfillmentMode: "shared_code" | "single_use_codes";
  accessCodes: Array<string>;
}

async function createAccessGrantFixture(
  administrator: AuthenticatedUser,
  input: {
    key: string;
    label: string;
    kind: "bulk_purchase" | "enterprise_contract";
    fulfillmentMode: "shared_code" | "single_use_codes";
    customerExtendable: boolean;
    course: CourseFixture;
    owner: AuthenticatedUser;
    quantity: number;
    claimants: Array<AuthenticatedUser>;
    lookupIds: Array<string>;
  },
): Promise<AccessGrantFixture> {
  const accessGrantId = `access_grant_${identifier(input.key)}`;
  const codePrefix = input.key.toLocaleUpperCase("en-AU").replaceAll("_", "-");
  const createdAt = relative(-45 * day);
  await database
    .insertInto("access_grant")
    .values({
      id: accessGrantId,
      organizationId:
        input.kind === "enterprise_contract"
          ? "organization_nsw_health"
          : "organization_training_partner",
      orderId: null,
      courseVersionId: input.course.versionId,
      label: input.label,
      createdByUserId: administrator.id,
      enrollmentDurationDays: input.course.enrollmentDurationDays,
      quantity: input.quantity,
      redeemed: 0,
      expiresAt: relative(365 * day),
      revokedAt: null,
      revokedByUserId: null,
      createdAt,
      kind: input.kind,
      customerExtendable: input.customerExtendable,
      fulfillmentMode: input.fulfillmentMode,
      codePrefix,
    })
    .execute();

  const codeCount =
    input.fulfillmentMode === "shared_code" ? 1 : input.quantity;
  assert.ok(input.lookupIds.length >= codeCount);
  const accessCodes: Array<string> = [];
  for (let index = 0; index < codeCount; index += 1) {
    const issued = issueAccessCode(
      input.fulfillmentMode === "shared_code"
        ? codePrefix
        : `${codePrefix}-${String(index + 1).padStart(3, "0")}`,
      requiredAt(input.lookupIds, index, "Access-code lookup ID"),
    );
    assert.ok(issued);
    accessCodes.push(issued.accessCode);
    await database
      .insertInto("access_grant_code")
      .values({
        id: `access_grant_code_${identifier(input.key)}_${String(index + 1)}`,
        accessGrantId,
        lookupId: issued.lookupId,
        encryptedAccessCode: encryptAccessCode({
          accessCode: issued.accessCode,
          accessGrantId,
          lookupId: issued.lookupId,
        }),
        ordinal:
          input.fulfillmentMode === "single_use_codes" ? index + 1 : null,
        createdAt,
      })
      .execute();
  }
  await database
    .insertInto("access_grant_owner_assignment")
    .values({
      id: `access_owner_assignment_${identifier(input.key)}`,
      accessGrantId,
      userId: input.owner.id,
      invitedEmail: input.owner.email,
      invitedByUserId: administrator.id,
      invitedAt: createdAt,
      activatedAt: createdAt,
      revokedAt: null,
      revokedByUserId: null,
    })
    .execute();

  for (const [index, claimant] of input.claimants.entries()) {
    const code =
      input.fulfillmentMode === "shared_code"
        ? requiredAt(accessCodes, 0, "Shared access code")
        : requiredAt(accessCodes, index, "Single-use access code");
    const outcome = await redeemAccessCode(
      {
        code,
        informationReleaseAccepted: true,
        noticeVersion: INFORMATION_RELEASE_NOTICE_VERSION,
      },
      claimant,
    );
    assert.equal(outcome.status, "enrolled");
  }
  return {
    id: accessGrantId,
    label: input.label,
    fulfillmentMode: input.fulfillmentMode,
    accessCodes,
  };
}

function fixedInstant(value: string): Date {
  return new Date(value);
}

try {
  await assertScenarioIsAbsent();
  await seedCredentialAccounts();
  const [administrator, unassignedAdministrator] = await Promise.all(
    administrators.map((profile) => userByEmail(profile.email)),
  );
  assert.ok(administrator);
  assert.ok(unassignedAdministrator);
  const learners = await Promise.all(
    learnerProfiles.map((profile) => userByEmail(profile.email)),
  );
  const coordinators = await Promise.all(
    coordinatorProfiles.map((profile) => userByEmail(profile.email)),
  );
  const presenters = await Promise.all(
    presenterProfiles.map((profile) => userByEmail(profile.email)),
  );
  const accessOwners = await Promise.all(
    accessOwnerProfiles.map((profile) => userByEmail(profile.email)),
  );

  await database
    .insertInto("coordination_region")
    .values(
      regionGroups.map((region) => ({
        ...region,
        parentId: null,
        kind: "group" as const,
        status: "active" as const,
      })),
    )
    .execute();
  await database
    .insertInto("coordination_region")
    .values(
      regions.map((region) => ({
        ...region,
        kind: "operational" as const,
        status: "active" as const,
      })),
    )
    .execute();
  await database
    .insertInto("event_staff_eligibility")
    .values([
      ...coordinators.map((coordinator, index) => ({
        id: `staff_eligibility_coordinator_${String(index + 1)}`,
        userId: coordinator.id,
        responsibility: "coordinator" as const,
        regionId: requiredAt(regions, index, "Coordinator region").id,
        grantedByUserId: administrator.id,
        revokedByUserId: null,
        revokedAt: null,
      })),
      ...presenters.map((presenter, index) => ({
        id: `staff_eligibility_presenter_${String(index + 1)}`,
        userId: presenter.id,
        responsibility: "presenter" as const,
        regionId: null,
        grantedByUserId: administrator.id,
        revokedByUserId: null,
        revokedAt: null,
      })),
    ])
    .execute();

  await createOnboardingFixture(administrator);
  for (let index = 0; index < 16; index += 1)
    await completeLearnerOnboarding(
      requiredAt(learners, index, "Learner"),
      index,
      requiredAt(
        regions,
        requiredAt(learnerRegionIndexes, index, "Learner region index"),
        "Learner region",
      ).id,
    );
  await completeLearnerOnboarding(
    requiredAt(learners, 16, "Learner"),
    16,
    null,
  );
  await completeLearnerOnboarding(
    requiredAt(learners, 18, "Learner"),
    18,
    requiredAt(regions, 9, "Learner region").id,
  );

  const surveyVersions = {
    learningConsent: await createSurveyFixture(
      administrator,
      "learning_consent",
      "Help us evaluate our eLearning programs",
      "pre",
    ),
    learningGeneralPre: await createSurveyFixture(
      administrator,
      "learning_general_pre",
      "eLearning Pre Survey",
      "pre",
    ),
    coreSkillsPre: await createSurveyFixture(
      administrator,
      "core_skills_pre",
      "Core Skills Check Pre",
      "pre",
    ),
    essentialsSkillsPre: await createSurveyFixture(
      administrator,
      "essentials_skills_pre",
      "Essentials Skills Check Pre",
      "pre",
    ),
    coreSkillsPost: await createSurveyFixture(
      administrator,
      "core_skills_post",
      "Core Skills Check Post",
      "post",
    ),
    essentialsSkillsPost: await createSurveyFixture(
      administrator,
      "essentials_skills_post",
      "Essentials Skills Check Post",
      "post",
    ),
    learningGeneralPost: await createSurveyFixture(
      administrator,
      "learning_general_post",
      "eLearning Post Survey",
      "post",
    ),
    eventConsent: await createSurveyFixture(
      administrator,
      "event_consent",
      "Help us evaluate our training events",
      "pre",
    ),
    eventGeneralPre: await createSurveyFixture(
      administrator,
      "event_general_pre",
      "Face to Face - General - Pre",
      "pre",
    ),
    eventImedPre: await createSurveyFixture(
      administrator,
      "event_imed_pre",
      "Face to Face - IMED - Pre",
      "pre",
    ),
    eventTargetsPre: await createSurveyFixture(
      administrator,
      "event_targets_pre",
      "Face to Face - IMED - Targets",
      "pre",
    ),
    eventImedPost: await createSurveyFixture(
      administrator,
      "event_imed_post",
      "Face to Face - IMED - Post",
      "post",
    ),
    eventTargetsPost: await createSurveyFixture(
      administrator,
      "event_targets_post",
      "Face to Face - IMED - Targets Post",
      "post",
    ),
    eventGeneralPost: await createSurveyFixture(
      administrator,
      "event_general_post",
      "Face to Face - General - Post",
      "post",
    ),
  };
  const emails = await createEmailFixtures(administrator);
  const scormVersionId = await ingestScormFixture(administrator);
  const standardPreSurveys = [
    {
      title: "Help us evaluate our eLearning programs",
      versionId: surveyVersions.learningConsent,
    },
    {
      title: "eLearning Pre Survey",
      versionId: surveyVersions.learningGeneralPre,
    },
  ];
  const standardPostSurveys = [
    {
      title: "eLearning Post Survey",
      versionId: surveyVersions.learningGeneralPost,
    },
  ];
  const courseEmails = {
    courseWelcome: emails.courseWelcome,
    courseReminder: emails.courseReminder,
    courseCompleted: emails.courseCompleted,
  };
  const courses = [
    await createCourseFixture(administrator, {
      slug: "the-essentials-training-clinicians-in-eating-disorders",
      title: "The Essentials: Training Clinicians in Eating Disorders",
      summary:
        "Comprehensive training on the nature, identification, assessment and treatment of eating disorders.",
      description:
        "A comprehensive clinician pathway spanning understanding eating disorders, assessment, preparation for treatment, treatment approaches and management.",
      durationMinutes: 1_050,
      priceCents: 28_000,
      salePriceCents: 24_000,
      enrollmentDurationDays: 92,
      accreditations: [
        {
          name: "Australian Counselling Association",
          cpdPoints: null,
          logoAssetId: null,
          logoName: "",
          blurb: "Accredited Training.",
        },
        {
          name: "National Eating Disorders Collaboration",
          cpdPoints: null,
          logoAssetId: null,
          logoName: "",
          blurb:
            "This training has been approved by NEDC as meeting the requirement of Introduction to Eating Disorders training as required for the ANZAED Eating Disorder Credential.",
        },
        {
          name: "Australian College of Mental Health Nurses",
          cpdPoints: null,
          logoAssetId: null,
          logoName: "",
          blurb:
            "Successful completion of The Essentials: Training Clinicians in Eating Disorders earns 19 CPE points (Level 2).",
        },
        {
          name: "Australian College of Rural and Remote Medicine",
          cpdPoints: null,
          logoAssetId: null,
          logoName: "",
          blurb:
            "PDP Total Contact Hours: 19. 13 Educational activity, 4 Outcome measurement and 2 Performance review.",
        },
        {
          name: "The Royal Australian College of General Practitioners",
          cpdPoints: null,
          logoAssetId: null,
          logoName: "",
          blurb:
            "General practitioners may be able to self-record completion of this course as CPD with their CPD Home if it is relevant to their scope of practice or professional development.",
        },
      ],
      preSurveys: [
        ...standardPreSurveys,
        {
          title: "Core Skills Check Pre",
          versionId: surveyVersions.coreSkillsPre,
        },
        {
          title: "Essentials Skills Check Pre",
          versionId: surveyVersions.essentialsSkillsPre,
        },
      ],
      modules: [
        {
          title: "Introduction to Eating Disorders",
          durationMinutes: 120,
          versionId: scormVersionId,
        },
        {
          title: "Identification",
          durationMinutes: 150,
          versionId: scormVersionId,
        },
        {
          title: "Assessment",
          durationMinutes: 180,
          versionId: scormVersionId,
        },
        {
          title: "Preparation for Treatment",
          durationMinutes: 180,
          versionId: scormVersionId,
        },
        {
          title: "Treatment Approaches",
          durationMinutes: 240,
          versionId: scormVersionId,
        },
        {
          title: "Management",
          durationMinutes: 180,
          versionId: scormVersionId,
        },
      ],
      postSurveys: [
        {
          title: "Core Skills Check Post",
          versionId: surveyVersions.coreSkillsPost,
        },
        {
          title: "Essentials Skills Check Post",
          versionId: surveyVersions.essentialsSkillsPost,
        },
        ...standardPostSurveys,
      ],
      emails: courseEmails,
    }),
    await createCourseFixture(administrator, {
      slug: "foundations-of-eating-disorders",
      title: "The Foundations of Eating Disorders",
      summary:
        "An introduction to eating disorders, common presentations and the foundations of informed care.",
      description:
        "A concise introductory course for people beginning their eating-disorder learning journey.",
      durationMinutes: 60,
      priceCents: 100,
      enrollmentDurationDays: 14,
      preSurveys: standardPreSurveys,
      modules: [
        {
          title: "Introduction to Eating Disorders",
          durationMinutes: 60,
          versionId: scormVersionId,
        },
      ],
      postSurveys: standardPostSurveys,
      emails: courseEmails,
    }),
    await createCourseFixture(administrator, {
      slug: "meal-support-in-the-hospital-setting",
      title: "Meal Support in the Hospital Setting",
      summary:
        "Practical guidance for supporting people with eating disorders before, during and after meals in hospital.",
      description:
        "Build a therapeutic approach to setting up, delivering and reviewing meal support in inpatient care.",
      durationMinutes: 240,
      priceCents: 6_900,
      enrollmentDurationDays: 28,
      preSurveys: standardPreSurveys,
      modules: [
        {
          title: "Introduction",
          durationMinutes: 45,
          versionId: scormVersionId,
        },
        {
          title: "Therapeutic Approach",
          durationMinutes: 60,
          versionId: scormVersionId,
        },
        {
          title: "Setting up Meal Support",
          durationMinutes: 60,
          versionId: scormVersionId,
        },
        {
          title: "Before and After Mealtime",
          durationMinutes: 75,
          versionId: scormVersionId,
        },
      ],
      postSurveys: standardPostSurveys,
      emails: courseEmails,
    }),
    await createCourseFixture(administrator, {
      slug: "eating-disorder-inpatient-management-adults",
      title: "Eating Disorder Inpatient Management: Adults",
      summary:
        "Clinical foundations for multidisciplinary inpatient management of adults with eating disorders.",
      description:
        "Plan admission, refeeding, behavioural support, meal supervision and transition from inpatient care.",
      durationMinutes: 300,
      priceCents: 12_000,
      enrollmentDurationDays: 92,
      preSurveys: standardPreSurveys,
      modules: [
        {
          title: "Introduction to Inpatient Management",
          durationMinutes: 45,
          versionId: scormVersionId,
        },
        {
          title: "Setting up an Admission",
          durationMinutes: 60,
          versionId: scormVersionId,
        },
        {
          title: "Refeeding and Multidisciplinary Care",
          durationMinutes: 75,
          versionId: scormVersionId,
        },
        {
          title: "Eating Disorder Behaviours and Meal Supervision",
          durationMinutes: 75,
          versionId: scormVersionId,
        },
        {
          title: "Transition and Discharge",
          durationMinutes: 45,
          versionId: scormVersionId,
        },
      ],
      postSurveys: standardPostSurveys,
      emails: courseEmails,
    }),
    await createCourseFixture(administrator, {
      slug: "cognitive-behavioural-therapy-practice-based-introduction",
      title:
        "Cognitive Behavioural Therapy (CBT) for Eating Disorders: A Practice Based Introduction",
      summary:
        "A practice-based introduction to cognitive behavioural therapy for eating disorders.",
      description:
        "Learn the foundations of CBT for eating disorders and apply them through practical clinical examples.",
      durationMinutes: 120,
      priceCents: 6_900,
      enrollmentDurationDays: 28,
      preSurveys: standardPreSurveys,
      modules: [
        {
          title: "Introduction to CBT",
          durationMinutes: 45,
          versionId: scormVersionId,
        },
        {
          title: "CBT in Practice",
          durationMinutes: 75,
          versionId: scormVersionId,
        },
      ],
      postSurveys: standardPostSurveys,
      emails: courseEmails,
    }),
  ];

  for (const [learnerIndex, courseIndex, state] of [
    [0, 0, "partial"],
    [1, 0, "completed"],
    [2, 2, "not_started"],
    [3, 2, "completed"],
    [4, 3, "partial"],
    [5, 4, "completed"],
  ] as const)
    await seedCourseEnrollment(
      requiredAt(learners, learnerIndex, "Learner"),
      requiredAt(courses, courseIndex, "Course"),
      state,
    );

  const grantFixtures = [
    await createAccessGrantFixture(administrator, {
      key: "bulk_shared",
      label: "Clinical Training Partner shared bulk access",
      kind: "bulk_purchase",
      fulfillmentMode: "shared_code",
      customerExtendable: true,
      course: requiredAt(courses, 1, "Course"),
      owner: requiredAt(accessOwners, 0, "Access owner"),
      quantity: 10,
      claimants: [
        requiredAt(learners, 6, "Learner"),
        requiredAt(learners, 7, "Learner"),
      ],
      lookupIds: ["AB23456789"],
    }),
    await createAccessGrantFixture(administrator, {
      key: "bulk_unique",
      label: "Clinical Training Partner single-use resale codes",
      kind: "bulk_purchase",
      fulfillmentMode: "single_use_codes",
      customerExtendable: true,
      course: requiredAt(courses, 2, "Course"),
      owner: requiredAt(accessOwners, 1, "Access owner"),
      quantity: 8,
      claimants: [
        requiredAt(learners, 8, "Learner"),
        requiredAt(learners, 9, "Learner"),
      ],
      lookupIds: [
        "BC23456789",
        "CD23456789",
        "DE23456789",
        "EF23456789",
        "FG23456789",
        "GH23456789",
        "HJ23456789",
        "JK23456789",
      ],
    }),
    await createAccessGrantFixture(administrator, {
      key: "enterprise_shared",
      label: "NSW Health enterprise shared access",
      kind: "enterprise_contract",
      fulfillmentMode: "shared_code",
      customerExtendable: false,
      course: requiredAt(courses, 0, "Course"),
      owner: requiredAt(accessOwners, 0, "Access owner"),
      quantity: 100,
      claimants: [
        requiredAt(learners, 10, "Learner"),
        requiredAt(learners, 11, "Learner"),
      ],
      lookupIds: ["KM23456789"],
    }),
    await createAccessGrantFixture(administrator, {
      key: "enterprise_unique",
      label: "NSW Health single-use contracted access",
      kind: "enterprise_contract",
      fulfillmentMode: "single_use_codes",
      customerExtendable: false,
      course: requiredAt(courses, 4, "Course"),
      owner: requiredAt(accessOwners, 1, "Access owner"),
      quantity: 6,
      claimants: [
        requiredAt(learners, 12, "Learner"),
        requiredAt(learners, 13, "Learner"),
      ],
      lookupIds: [
        "MN23456789",
        "NP23456789",
        "PQ23456789",
        "QR23456789",
        "RS23456789",
        "ST23456789",
      ],
    }),
  ];

  const eventPreSurveys = [
    surveyVersions.eventConsent,
    surveyVersions.eventGeneralPre,
    surveyVersions.coreSkillsPre,
    surveyVersions.eventImedPre,
    surveyVersions.eventTargetsPre,
  ];
  const eventPostSurveys = [
    surveyVersions.eventImedPost,
    surveyVersions.coreSkillsPost,
    surveyVersions.eventTargetsPost,
    surveyVersions.eventGeneralPost,
  ];
  const eventTemplates = [
    await createEventTemplateFixture(administrator, {
      key: "cbte",
      title: "Cognitive Behavioural Therapy for Eating Disorders (CBT-E)",
      summary:
        "Two-day practice-based CBT-E training for eating-disorder clinicians.",
      description:
        "Preparation, two facilitated workshop days and post-event evaluation.",
      presenter: requiredAt(presenters, 0, "Presenter"),
      regionIndexes: [0, 2, 3, 4, 6, 8, 9, 11, 14],
      preSurveyVersionIds: eventPreSurveys,
      postSurveyVersionIds: eventPostSurveys,
      prerequisiteScormVersionId: scormVersionId,
      emails,
    }),
    await createEventTemplateFixture(administrator, {
      key: "imed_adults",
      title: "Inpatient Management for Eating Disorders (IMED) Adults",
      summary:
        "Multidisciplinary management of adults with eating disorders in inpatient settings.",
      description:
        "Clinical preparation, two full workshop days and structured post-event reflection.",
      presenter: requiredAt(presenters, 1, "Presenter"),
      regionIndexes: [1, 6, 12],
      preSurveyVersionIds: eventPreSurveys,
      postSurveyVersionIds: eventPostSurveys,
      prerequisiteScormVersionId: scormVersionId,
      emails,
    }),
    await createEventTemplateFixture(administrator, {
      key: "sscm",
      title: "Specialist Supportive Clinical Management (SSCM)",
      summary:
        "Two-day clinician training in specialist supportive clinical management.",
      description:
        "Pre-event preparation, applied workshop sessions and follow-up evaluation.",
      presenter: requiredAt(presenters, 2, "Presenter"),
      regionIndexes: [0, 3, 6, 8, 9, 10, 12, 14],
      preSurveyVersionIds: eventPreSurveys,
      postSurveyVersionIds: eventPostSurveys,
      prerequisiteScormVersionId: scormVersionId,
      emails,
    }),
    await createEventTemplateFixture(administrator, {
      key: "fbt",
      title: "Family-Based Treatment (FBT)",
      summary:
        "Two-day family-based treatment training for eating-disorder clinicians.",
      description:
        "Structured preparation, two workshop days and post-event learning activities.",
      presenter: requiredAt(presenters, 3, "Presenter"),
      regionIndexes: [2, 3],
      preSurveyVersionIds: eventPreSurveys,
      postSurveyVersionIds: eventPostSurveys,
      prerequisiteScormVersionId: scormVersionId,
      emails,
    }),
    await createEventTemplateFixture(administrator, {
      key: "imed_paediatric",
      title: "Inpatient Management for Eating Disorders (IMED) Paediatric",
      summary:
        "Multidisciplinary inpatient management training for paediatric eating disorders.",
      description:
        "Preparation, two full workshop days and post-event evaluation for paediatric care.",
      presenter: requiredAt(presenters, 4, "Presenter"),
      regionIndexes: [0, 2],
      preSurveyVersionIds: eventPreSurveys,
      postSurveyVersionIds: eventPostSurveys,
      prerequisiteScormVersionId: scormVersionId,
      emails,
    }),
  ];

  const occurrenceDefinitions = [
    {
      template: 0,
      title: "CBT-E · 10–11 August 2026",
      slug: "cbte-10-august-2026",
      startsAt: "2026-08-09T23:00:00.000Z",
      endsAt: "2026-08-11T07:00:00.000Z",
      opensAt: "2026-05-01T00:00:00.000Z",
      closesAt: "2026-07-20T07:00:00.000Z",
      locksAt: "2026-07-23T07:00:00.000Z",
      capacity: 17,
      reviewsLocked: true,
      deliveryMode: "in_person" as const,
    },
    {
      template: 0,
      title: "CBT-E · 24–25 August 2026",
      slug: "cbte-24-august-2026",
      startsAt: "2026-08-23T23:00:00.000Z",
      endsAt: "2026-08-25T07:00:00.000Z",
      opensAt: "2026-05-15T00:00:00.000Z",
      closesAt: "2026-08-02T07:00:00.000Z",
      locksAt: "2026-08-05T07:00:00.000Z",
      capacity: 36,
      reviewsLocked: true,
      deliveryMode: "virtual" as const,
    },
    {
      template: 1,
      title: "IMED Adults · 3–4 September 2026",
      slug: "imed-adults-3-september-2026",
      startsAt: "2026-09-02T23:00:00.000Z",
      endsAt: "2026-09-04T07:00:00.000Z",
      opensAt: "2026-05-15T00:00:00.000Z",
      closesAt: "2026-08-10T07:00:00.000Z",
      locksAt: "2026-08-14T07:00:00.000Z",
      capacity: 12,
      reviewsLocked: true,
      deliveryMode: "in_person" as const,
    },
    {
      template: 2,
      title: "SSCM · 9–10 September 2026",
      slug: "sscm-9-september-2026",
      startsAt: "2026-09-08T23:00:00.000Z",
      endsAt: "2026-09-10T07:00:00.000Z",
      opensAt: "2026-05-15T00:00:00.000Z",
      closesAt: "2026-08-18T07:00:00.000Z",
      locksAt: "2026-08-24T07:00:00.000Z",
      capacity: 40,
      reviewsLocked: false,
      deliveryMode: "in_person" as const,
    },
    {
      template: 3,
      title: "FBT · 16–17 September 2026",
      slug: "fbt-16-september-2026",
      startsAt: "2026-09-15T23:00:00.000Z",
      endsAt: "2026-09-17T07:00:00.000Z",
      opensAt: "2026-08-01T00:00:00.000Z",
      closesAt: "2026-09-01T07:00:00.000Z",
      locksAt: "2026-09-04T07:00:00.000Z",
      capacity: 30,
      reviewsLocked: false,
      deliveryMode: "virtual" as const,
    },
    {
      template: 0,
      title: "CBT-E · 23–24 September 2026",
      slug: "cbte-23-september-2026",
      startsAt: "2026-09-22T23:00:00.000Z",
      endsAt: "2026-09-24T07:00:00.000Z",
      opensAt: "2026-08-01T00:00:00.000Z",
      closesAt: "2026-09-08T07:00:00.000Z",
      locksAt: "2026-09-11T07:00:00.000Z",
      capacity: 35,
      reviewsLocked: false,
      deliveryMode: "in_person" as const,
    },
    {
      template: 4,
      title: "IMED Paediatric · 10–11 November 2026",
      slug: "imed-paediatric-10-november-2026",
      startsAt: "2026-11-09T22:00:00.000Z",
      endsAt: "2026-11-11T06:00:00.000Z",
      opensAt: "2026-08-01T00:00:00.000Z",
      closesAt: "2026-10-19T06:00:00.000Z",
      locksAt: "2026-10-22T06:00:00.000Z",
      capacity: 25,
      reviewsLocked: false,
      deliveryMode: "virtual" as const,
    },
  ];
  const occurrences: Array<EventOccurrenceFixture> = [];
  for (const definition of occurrenceDefinitions)
    occurrences.push(
      await createEventOccurrenceFixture(
        administrator,
        requiredAt(eventTemplates, definition.template, "Event Template")
          .versionId,
        {
          title: definition.title,
          slug: definition.slug,
          deliveryMode: definition.deliveryMode,
          startsAt: fixedInstant(definition.startsAt),
          endsAt: fixedInstant(definition.endsAt),
          registrationOpensAt: fixedInstant(definition.opensAt),
          registrationClosesAt: fixedInstant(definition.closesAt),
          coordinatorLockAt: fixedInstant(definition.locksAt),
          reviewsLocked: definition.reviewsLocked,
          capacity: definition.capacity,
        },
      ),
    );

  const registrationPlans = [
    {
      occurrence: 0,
      entries: [
        [0, "selected", 1],
        [4, "selected", 2],
        [14, "waitlisted", 3],
        [15, "selected", 4],
      ],
    },
    {
      occurrence: 1,
      entries: [
        [2, "selected", 1],
        [3, "selected", 1],
        [8, "selected", 2],
        [14, "selected", 2],
      ],
    },
    {
      occurrence: 2,
      entries: [
        [1, "coordinator_approved", 1],
        [6, "coordinator_approved", 1],
        [12, "coordinator_declined", null],
      ],
    },
    {
      occurrence: 3,
      entries: [
        [0, "submitted", null],
        [3, "submitted", null],
        [6, "submitted", null],
        [8, "submitted", null],
        [9, "submitted", null],
        [14, "submitted", null],
      ],
    },
    {
      occurrence: 4,
      entries: [
        [2, "submitted", null],
        [3, "submitted", null],
      ],
    },
    {
      occurrence: 5,
      entries: [
        [0, "submitted", null],
        [6, "submitted", null],
        [8, "submitted", null],
        [9, "submitted", null],
        [11, "submitted", null],
        [14, "submitted", null],
      ],
    },
    {
      occurrence: 6,
      entries: [
        [0, "submitted", null],
        [2, "submitted", null],
      ],
    },
  ] as const;
  for (const plan of registrationPlans) {
    const occurrence = requiredAt(
      occurrences,
      plan.occurrence,
      "Event occurrence",
    );
    for (const [learnerIndex, status, priority] of plan.entries) {
      const registration = await seedEventRegistration(
        occurrence,
        requiredAt(learners, learnerIndex, "Learner"),
        learnerIndex,
        coordinatorForLearner(coordinators, learnerIndex),
        administrator,
        status,
        priority,
      );
      if (plan.occurrence === 0 && registration.participationId)
        await seedAttendance(
          occurrence,
          registration,
          coordinatorForLearner(coordinators, learnerIndex),
          learnerIndex === 4 ? "absent" : "attended",
        );
    }
  }
  for (const occurrence of occurrences) await setConfirmedCount(occurrence.id);

  const [
    learnerCount,
    coordinatorCount,
    presenterCount,
    courseCount,
    templateCount,
    occurrenceCount,
    grantCount,
    entitlementCount,
    secondAdminTemplateAssignments,
    secondAdminOccurrenceAssignments,
  ] = await Promise.all([
    database
      .selectFrom("user")
      .select((expression) => expression.fn.count<number>("id").as("count"))
      .where(
        "email",
        "in",
        learners.map((learner) => learner.email),
      )
      .executeTakeFirstOrThrow(),
    database
      .selectFrom("event_staff_eligibility")
      .select((expression) => expression.fn.count<number>("id").as("count"))
      .where("responsibility", "=", "coordinator")
      .where("revokedAt", "is", null)
      .executeTakeFirstOrThrow(),
    database
      .selectFrom("event_staff_eligibility")
      .select((expression) => expression.fn.count<number>("id").as("count"))
      .where("responsibility", "=", "presenter")
      .where("revokedAt", "is", null)
      .executeTakeFirstOrThrow(),
    database
      .selectFrom("course")
      .select((expression) => expression.fn.count<number>("id").as("count"))
      .executeTakeFirstOrThrow(),
    database
      .selectFrom("event_template")
      .select((expression) => expression.fn.count<number>("id").as("count"))
      .executeTakeFirstOrThrow(),
    database
      .selectFrom("event_occurrence")
      .select((expression) => expression.fn.count<number>("id").as("count"))
      .executeTakeFirstOrThrow(),
    database
      .selectFrom("access_grant")
      .select((expression) => expression.fn.count<number>("id").as("count"))
      .executeTakeFirstOrThrow(),
    database
      .selectFrom("entitlement")
      .select((expression) => expression.fn.count<number>("id").as("count"))
      .executeTakeFirstOrThrow(),
    database
      .selectFrom("event_template_version_admin_default")
      .select((expression) => expression.fn.count<number>("userId").as("count"))
      .where("userId", "=", unassignedAdministrator.id)
      .executeTakeFirstOrThrow(),
    database
      .selectFrom("event_admin_assignment")
      .select((expression) => expression.fn.count<number>("userId").as("count"))
      .where("userId", "=", unassignedAdministrator.id)
      .executeTakeFirstOrThrow(),
  ]);
  assert.equal(String(learnerCount.count), "20");
  assert.equal(String(coordinatorCount.count), "15");
  assert.equal(String(presenterCount.count), "5");
  assert.equal(String(courseCount.count), "5");
  assert.equal(String(templateCount.count), "5");
  assert.equal(String(occurrenceCount.count), "7");
  assert.equal(String(grantCount.count), "4");
  assert.equal(String(entitlementCount.count), "8");
  assert.equal(String(secondAdminTemplateAssignments.count), "0");
  assert.equal(String(secondAdminOccurrenceAssignments.count), "0");
  assert.equal(grantFixtures.length, 4);

  console.log(
    "Seeded 20 learners, 2 platform administrators (1 event-assigned), 15 LHD coordinators, 5 presenters, 5 courses, 5 Event Templates, 7 staged Event Instances and 4 claimed access-grant variants.",
  );
  console.log("All seeded credential accounts use SEED_LEARNER_PASSWORD.");
} finally {
  await destroyDatabase();
}
