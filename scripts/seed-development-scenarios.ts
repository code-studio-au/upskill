import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { AdminCourseDraft } from "#/features/admin-course/admin-course.schema";
import type { AdminEventTemplateDraft } from "#/features/admin-event/admin-event.schema";
import { ianaTimeZoneSchema } from "#/features/shared/time.schema";
import {
  parseSurveyVersionContent,
  type AdminSurveyDraft,
  type SurveyVersionContent,
} from "#/features/survey/survey.schema";
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
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { destroyDatabase, getDatabase } from "#/server/db/database.server";
import { completeEnrollmentIfReady } from "#/server/learning/learning-completion.server";
import {
  dateToInstant,
  instantToLocalDateTime,
} from "#/server/time/time.server";
import {
  ingestScormPackageVersion,
  stageScormPackageArchive,
} from "#/server/scorm/scorm-package-ingestion.server";

const database = getDatabase();
const archivePaths = process.argv
  .slice(2)
  .filter((argument) => argument !== "--");
if (archivePaths.length < 3)
  throw new Error(
    "Pass the three local SCORM 1.2 ZIP paths after -- when running db:seed:development",
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
    name: "NSW Health",
  },
] as const;
const regions = [
  {
    id: "region_test_north",
    code: "TEST-NORTH",
    name: "Test North",
    parentId: "region_group_nsw_health",
  },
  {
    id: "region_test_central",
    code: "TEST-CENTRAL",
    name: "Test Central",
    parentId: "region_group_nsw_health",
  },
  {
    id: "region_test_south",
    code: "TEST-SOUTH",
    name: "Test South",
    parentId: "region_group_nsw_health",
  },
] as const;

const learnerRegionIndexes = [0, 0, 0, 0, 1, 1, 1, 2, 2, 2] as const;
const scormTitles = [
  "Prevention and Health Promotion",
  "Early Identification, Intervention and Screening",
  "Assessment, Diagnosis and Support",
] as const;

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
  assert.ok(item, `${label} ${String(index + 1)} is required`);
  return item;
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
  const [course, template] = await Promise.all([
    database
      .selectFrom("course")
      .select("id")
      .where("slug", "in", [
        "prevention-and-early-intervention",
        "assessment-diagnosis-and-support",
      ])
      .executeTakeFirst(),
    database
      .selectFrom("event_template")
      .select("id")
      .where("title", "=", "Regional clinical learning workshop")
      .executeTakeFirst(),
  ]);
  if (course || template)
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
            kind: "text",
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
  const created = await createAdminSurvey(title, administrator);
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

async function ingestScormFixtures(
  administrator: AuthenticatedUser,
): Promise<Array<string>> {
  const versionIds: Array<string> = [];
  for (const [index, archivePath] of archivePaths.slice(0, 3).entries()) {
    const title = scormTitles[index];
    assert.ok(title);
    const staged = await stageScormPackageArchive({
      actorUserId: administrator.id,
      archive: await readFile(archivePath),
      title,
    });
    const outcome = await ingestScormPackageVersion(
      staged.packageVersionId,
      staged.quarantineKey,
    );
    assert.equal(outcome.status, "ready");
    versionIds.push(staged.packageVersionId);
    await database
      .updateTable("outbox_event")
      .set({ processedAt: new Date() })
      .where("aggregateId", "=", staged.packageVersionId)
      .where("topic", "=", "scorm.package_ingest_requested")
      .execute();
  }
  return versionIds;
}

interface CourseFixture {
  courseId: string;
  versionId: string;
  slug: string;
}

async function createCourseFixture(
  administrator: AuthenticatedUser,
  input: {
    slug: string;
    title: string;
    summary: string;
    description: string;
    durationMinutes: number;
    preSurveyVersionId: string;
    postSurveyVersionId: string;
    modules: Array<{
      title: string;
      durationMinutes: number;
      versionId: string;
    }>;
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
    priceCents: 0,
    salePriceCents: null,
    featured: true,
    listInStore: true,
    hasCompletionCertificate: true,
    prerequisites: [],
    accreditations: [
      { name: "Continuing Professional Development", cpdPoints: 2 },
    ],
    sections: [
      {
        id: `${prefix}_pre_section`,
        title: "Pre-eLearning survey",
        description: "Capture your starting point before the modules.",
        items: [
          {
            id: `${prefix}_pre_survey`,
            kind: "survey",
            title: "Pre-eLearning survey",
            required: true,
            durationMinutes: 5,
            surveyVersionId: input.preSurveyVersionId,
          },
        ],
      },
      {
        id: `${prefix}_learning_section`,
        title: "eLearning modules",
        description: "Complete each SCORM module in order.",
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
        title: "Post-eLearning survey",
        description: "Reflect on the completed eLearning.",
        items: [
          {
            id: `${prefix}_post_survey`,
            kind: "survey",
            title: "Post-eLearning survey",
            required: true,
            durationMinutes: 5,
            surveyVersionId: input.postSurveyVersionId,
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
  return { ...created, slug: input.slug };
}

function answersForSurvey(
  content: SurveyVersionContent,
): Record<string, string | Array<string>> {
  const answers: Record<string, string | Array<string>> = {};
  for (const item of content.sections.flatMap((section) => section.items)) {
    if (item.kind === "instruction") continue;
    if (item.kind === "text")
      answers[item.id] = "A practical next step for this test learner.";
    else if (item.kind === "single_choice")
      answers[item.id] = item.options[1]?.id ?? item.options[0]?.id ?? "";
    else answers[item.id] = item.options.slice(0, 2).map((option) => option.id);
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
  regionIds: Array<string>;
  sessionId: string;
  reviewRoundIds: Array<string>;
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
      capacity: 20,
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
    .select(["id", "position"])
    .where("eventOccurrenceId", "=", occurrence.eventOccurrenceId)
    .orderBy("position")
    .execute();
  const session = await database
    .selectFrom("event_session")
    .select("id")
    .where("eventOccurrenceId", "=", occurrence.eventOccurrenceId)
    .executeTakeFirstOrThrow();
  const reviewRoundIds: Array<string> = [];
  for (const [regionIndex, occurrenceRegion] of occurrenceRegions.entries()) {
    const reviewRoundId = `review_${identifier(input.slug)}_${String(regionIndex + 1)}`;
    reviewRoundIds.push(reviewRoundId);
    await database
      .insertInto("event_region_review_round")
      .values({
        id: reviewRoundId,
        eventOccurrenceRegionId: occurrenceRegion.id,
        round: 1,
        registrationClosesAt: input.registrationClosesAt,
        coordinatorLockAt: input.coordinatorLockAt,
        lockedAt: input.reviewsLocked ? input.coordinatorLockAt : null,
        lockedByUserId: input.reviewsLocked
          ? `user_local_coordinator_${String(regionIndex + 1)}`
          : null,
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
    regionIds: occurrenceRegions.map((region) => region.id),
    sessionId: session.id,
    reviewRoundIds,
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
  const occurrenceRegionId = occurrence.regionIds[regionIndex];
  const reviewRoundId = occurrence.reviewRoundIds[regionIndex];
  assert.ok(occurrenceRegionId);
  assert.ok(reviewRoundId);
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

async function assertMultiRegionCoordinatorReviewFixture(
  occurrenceId: string,
): Promise<void> {
  const assignments = await database
    .selectFrom("event_occurrence_region as occurrence_region")
    .innerJoin(
      "coordination_region as region",
      "region.id",
      "occurrence_region.regionId",
    )
    .innerJoin(
      "event_coordinator_assignment as assignment",
      "assignment.eventOccurrenceRegionId",
      "occurrence_region.id",
    )
    .innerJoin("user as coordinator", "coordinator.id", "assignment.userId")
    .innerJoin(
      "event_registration as registration",
      "registration.eventOccurrenceRegionId",
      "occurrence_region.id",
    )
    .innerJoin("user as learner", "learner.id", "registration.userId")
    .select([
      "region.code as regionCode",
      "coordinator.email as coordinatorEmail",
      "learner.email as learnerEmail",
      "registration.status",
    ])
    .where("occurrence_region.eventOccurrenceId", "=", occurrenceId)
    .where("occurrence_region.retiredAt", "is", null)
    .where("assignment.endedAt", "is", null)
    .orderBy("region.code")
    .orderBy("learner.email")
    .execute();

  assert.deepEqual(assignments, [
    {
      regionCode: "TEST-CENTRAL",
      coordinatorEmail: "coordinator2@example.com",
      learnerEmail: "learner5@example.com",
      status: "submitted",
    },
    {
      regionCode: "TEST-CENTRAL",
      coordinatorEmail: "coordinator2@example.com",
      learnerEmail: "learner6@example.com",
      status: "submitted",
    },
    {
      regionCode: "TEST-NORTH",
      coordinatorEmail: "coordinator1@example.com",
      learnerEmail: "learner1@example.com",
      status: "submitted",
    },
    {
      regionCode: "TEST-NORTH",
      coordinatorEmail: "coordinator1@example.com",
      learnerEmail: "learner3@example.com",
      status: "submitted",
    },
    {
      regionCode: "TEST-SOUTH",
      coordinatorEmail: "coordinator3@example.com",
      learnerEmail: "learner8@example.com",
      status: "submitted",
    },
    {
      regionCode: "TEST-SOUTH",
      coordinatorEmail: "coordinator3@example.com",
      learnerEmail: "learner9@example.com",
      status: "submitted",
    },
  ]);
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
    .values({
      eventParticipationId: registration.participationId,
      eventSessionId: occurrence.sessionId,
      state,
      source: "presenter",
      recordedByUserId: coordinator.id,
      recordedAt,
      updatedAt: recordedAt,
    })
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

try {
  await assertScenarioIsAbsent();
  const administrator = await userByEmail("admin@example.com");
  const learners = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      userByEmail(`learner${String(index + 1)}@example.com`),
    ),
  );
  const coordinators = await Promise.all(
    Array.from({ length: 3 }, (_, index) =>
      userByEmail(`coordinator${String(index + 1)}@example.com`),
    ),
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
    .values(
      coordinators.flatMap((coordinator, index) => {
        const region = requiredAt(regions, index, "Region");
        return [
          {
            id: `staff_eligibility_presenter_${String(index + 1)}`,
            userId: coordinator.id,
            responsibility: "presenter" as const,
            regionId: null,
            grantedByUserId: administrator.id,
            revokedByUserId: null,
            revokedAt: null,
          },
          {
            id: `staff_eligibility_coordinator_${String(index + 1)}`,
            userId: coordinator.id,
            responsibility: "coordinator" as const,
            regionId: region.id,
            grantedByUserId: administrator.id,
            revokedByUserId: null,
            revokedAt: null,
          },
        ];
      }),
    )
    .execute();

  const surveyVersions = {
    eventPre: await createSurveyFixture(
      administrator,
      "event_pre",
      "Workshop pre-event survey",
      "pre",
    ),
    eventPost: await createSurveyFixture(
      administrator,
      "event_post",
      "Workshop post-event survey",
      "post",
    ),
    courseOnePre: await createSurveyFixture(
      administrator,
      "course_one_pre",
      "Prevention course pre-eLearning survey",
      "pre",
    ),
    courseOnePost: await createSurveyFixture(
      administrator,
      "course_one_post",
      "Prevention course post-eLearning survey",
      "post",
    ),
    courseTwoPre: await createSurveyFixture(
      administrator,
      "course_two_pre",
      "Assessment course pre-eLearning survey",
      "pre",
    ),
    courseTwoPost: await createSurveyFixture(
      administrator,
      "course_two_post",
      "Assessment course post-eLearning survey",
      "post",
    ),
  };

  const scormVersionIds = await ingestScormFixtures(administrator);
  const [firstScorm, secondScorm, thirdScorm] = scormVersionIds;
  assert.ok(firstScorm);
  assert.ok(secondScorm);
  assert.ok(thirdScorm);
  const courseOne = await createCourseFixture(administrator, {
    slug: "prevention-and-early-intervention",
    title: "Prevention and Early Intervention",
    summary:
      "Prevention, health promotion and early-intervention foundations with practical screening guidance.",
    description:
      "A two-module learning pathway covering prevention, health promotion, early identification, intervention and screening.",
    durationMinutes: 150,
    preSurveyVersionId: surveyVersions.courseOnePre,
    postSurveyVersionId: surveyVersions.courseOnePost,
    modules: [
      { title: scormTitles[0], durationMinutes: 60, versionId: firstScorm },
      { title: scormTitles[1], durationMinutes: 80, versionId: secondScorm },
    ],
  });
  const courseTwo = await createCourseFixture(administrator, {
    slug: "assessment-diagnosis-and-support",
    title: "Assessment, Diagnosis and Support",
    summary:
      "Develop a structured approach to assessment, diagnosis and ongoing support.",
    description:
      "A focused learning pathway covering assessment, diagnostic formulation and support planning.",
    durationMinutes: 100,
    preSurveyVersionId: surveyVersions.courseTwoPre,
    postSurveyVersionId: surveyVersions.courseTwoPost,
    modules: [
      { title: scormTitles[2], durationMinutes: 90, versionId: thirdScorm },
    ],
  });

  await seedCourseEnrollment(
    requiredAt(learners, 0, "Learner"),
    courseOne,
    "partial",
  );
  await seedCourseEnrollment(
    requiredAt(learners, 1, "Learner"),
    courseOne,
    "completed",
  );
  await seedCourseEnrollment(
    requiredAt(learners, 2, "Learner"),
    courseTwo,
    "not_started",
  );
  await seedCourseEnrollment(
    requiredAt(learners, 3, "Learner"),
    courseTwo,
    "completed",
  );

  const eventTemplate = await createAdminEventTemplate(
    {
      title: "Regional clinical learning workshop",
      defaultAdministratorIds: [administrator.id],
    },
    administrator,
  );
  assert.equal(eventTemplate.status, "created");
  const eventDraft: AdminEventTemplateDraft = {
    eventTemplateId: eventTemplate.eventTemplateId,
    eventTemplateVersionId: eventTemplate.eventTemplateVersionId,
    title: "Regional clinical learning workshop",
    summary:
      "A reusable regional workshop with pre-event preparation and post-event reflection.",
    description:
      "A complete test Event Template spanning preparation, a facilitated workshop and post-event learning.",
    hasCompletionCertificate: true,
    defaultAdministratorIds: [administrator.id],
    regions: regions.map((region, index) => ({
      regionId: region.id,
      coordinatorIds: [requiredAt(coordinators, index, "Coordinator").id],
    })),
    sections: [
      {
        id: "event_template_pre_section",
        title: "Pre-event tasks",
        description: "Complete the preparation before attending the workshop.",
        phase: "pre_event",
        releaseAnchor: "participation_created",
        releaseOffsetAmount: 0,
        releaseOffsetUnit: "minute",
        items: [
          {
            id: "event_template_pre_survey",
            kind: "survey",
            title: "Pre-event survey",
            required: true,
            durationMinutes: 10,
            learningActivityVersionId: surveyVersions.eventPre,
          },
        ],
      },
      {
        id: "event_template_session_section",
        title: "Event workshop",
        description: "Attend the facilitated workshop session.",
        phase: "session",
        releaseAnchor: "occurrence_start",
        releaseOffsetAmount: 0,
        releaseOffsetUnit: "minute",
        items: [
          {
            id: "event_template_workshop_session",
            kind: "session",
            title: "Regional clinical workshop",
            required: true,
            durationMinutes: 120,
            presenterRequired: true,
            presenterIds: coordinators.map((coordinator) => coordinator.id),
          },
        ],
      },
      {
        id: "event_template_post_section",
        title: "Post-event tasks",
        description:
          "Reflect on the workshop and identify practical next steps.",
        phase: "post_event",
        releaseAnchor: "final_session_end",
        releaseOffsetAmount: -2,
        releaseOffsetUnit: "hour",
        items: [
          {
            id: "event_template_post_survey",
            kind: "survey",
            title: "Post-event survey",
            required: true,
            durationMinutes: 10,
            learningActivityVersionId: surveyVersions.eventPost,
          },
        ],
      },
    ],
  };
  assert.equal(
    await saveAdminEventTemplateDraft(eventDraft, administrator),
    "saved",
  );
  assert.equal(
    await publishAdminEventTemplateVersion(
      eventTemplate.eventTemplateId,
      eventTemplate.eventTemplateVersionId,
      administrator,
    ),
    "published",
  );

  const occurrences = [
    await createEventOccurrenceFixture(
      administrator,
      eventTemplate.eventTemplateVersionId,
      {
        title: "Registration open · Regional clinical workshop",
        slug: "test-workshop-registration-open",
        deliveryMode: "virtual",
        startsAt: relative(30 * day),
        endsAt: relative(30 * day + 4 * hour),
        registrationOpensAt: relative(-7 * day),
        registrationClosesAt: relative(20 * day),
        coordinatorLockAt: relative(22 * day),
        reviewsLocked: false,
      },
    ),
    await createEventOccurrenceFixture(
      administrator,
      eventTemplate.eventTemplateVersionId,
      {
        title: "Multi-region review · Awaiting coordinator prioritisation",
        slug: "test-workshop-multi-region-review",
        deliveryMode: "in_person",
        startsAt: relative(14 * day),
        endsAt: relative(14 * day + 4 * hour),
        registrationOpensAt: relative(-30 * day),
        registrationClosesAt: relative(-day),
        coordinatorLockAt: relative(2 * day),
        reviewsLocked: false,
      },
    ),
    await createEventOccurrenceFixture(
      administrator,
      eventTemplate.eventTemplateVersionId,
      {
        title: "Regional lists locked · Awaiting administrator approval",
        slug: "test-workshop-admin-selection",
        deliveryMode: "virtual",
        startsAt: relative(7 * day),
        endsAt: relative(7 * day + 4 * hour),
        registrationOpensAt: relative(-30 * day),
        registrationClosesAt: relative(-4 * day),
        coordinatorLockAt: relative(-2 * day),
        reviewsLocked: true,
      },
    ),
    await createEventOccurrenceFixture(
      administrator,
      eventTemplate.eventTemplateVersionId,
      {
        title: "Workshop in progress · Presenter attendance",
        slug: "test-workshop-live-session",
        deliveryMode: "in_person",
        startsAt: relative(-30 * minute),
        endsAt: relative(3 * hour),
        registrationOpensAt: relative(-30 * day),
        registrationClosesAt: relative(-10 * day),
        coordinatorLockAt: relative(-8 * day),
        reviewsLocked: true,
      },
    ),
    await createEventOccurrenceFixture(
      administrator,
      eventTemplate.eventTemplateVersionId,
      {
        title: "Workshop delivered · Post-event follow-up",
        slug: "test-workshop-post-event",
        deliveryMode: "virtual",
        startsAt: relative(-2 * day),
        endsAt: relative(28 * day),
        registrationOpensAt: relative(-60 * day),
        registrationClosesAt: relative(-20 * day),
        coordinatorLockAt: relative(-18 * day),
        reviewsLocked: true,
      },
    ),
  ];

  const registrationOpenOccurrence = requiredAt(
    occurrences,
    0,
    "Event occurrence",
  );
  const coordinatorReviewOccurrence = requiredAt(
    occurrences,
    1,
    "Event occurrence",
  );
  const administratorReviewOccurrence = requiredAt(
    occurrences,
    2,
    "Event occurrence",
  );
  const liveOccurrence = requiredAt(occurrences, 3, "Event occurrence");
  const postEventOccurrence = requiredAt(occurrences, 4, "Event occurrence");

  for (const learnerIndex of [0, 4, 7])
    await seedEventRegistration(
      registrationOpenOccurrence,
      requiredAt(learners, learnerIndex, "Learner"),
      learnerIndex,
      coordinatorForLearner(coordinators, learnerIndex),
      administrator,
      "submitted",
      null,
    );
  for (const learnerIndex of [0, 2, 4, 5, 7, 8])
    await seedEventRegistration(
      coordinatorReviewOccurrence,
      requiredAt(learners, learnerIndex, "Learner"),
      learnerIndex,
      coordinatorForLearner(coordinators, learnerIndex),
      administrator,
      "submitted",
      null,
    );
  await assertMultiRegionCoordinatorReviewFixture(
    coordinatorReviewOccurrence.id,
  );
  for (const [learnerIndex, status, priority] of [
    [1, "coordinator_approved", 1],
    [3, "coordinator_approved", 2],
    [4, "coordinator_approved", 1],
    [6, "coordinator_declined", null],
    [7, "coordinator_approved", 2],
    [9, "coordinator_approved", 1],
  ] as const)
    await seedEventRegistration(
      administratorReviewOccurrence,
      requiredAt(learners, learnerIndex, "Learner"),
      learnerIndex,
      coordinatorForLearner(coordinators, learnerIndex),
      administrator,
      status,
      priority,
    );

  const liveRegistrations: Array<{
    learnerIndex: number;
    registration: SeededRegistration;
  }> = [];
  for (const [learnerIndex, status] of [
    [0, "selected"],
    [1, "selected"],
    [4, "selected"],
    [5, "selected"],
    [7, "selected"],
    [8, "waitlisted"],
  ] as const) {
    const registration = await seedEventRegistration(
      liveOccurrence,
      requiredAt(learners, learnerIndex, "Learner"),
      learnerIndex,
      coordinatorForLearner(coordinators, learnerIndex),
      administrator,
      status,
      learnerIndex + 1,
    );
    liveRegistrations.push({ learnerIndex, registration });
  }
  for (const [index, live] of liveRegistrations.entries()) {
    if (!live.registration.participationId) continue;
    const attendanceState = ["attended", "checked_in", "attended", "absent"][
      index
    ] as "attended" | "checked_in" | "absent" | undefined;
    if (attendanceState)
      await seedAttendance(
        liveOccurrence,
        live.registration,
        coordinatorForLearner(coordinators, live.learnerIndex),
        attendanceState,
      );
  }

  const postEventLearners = [2, 3, 6, 8, 9];
  for (const learnerIndex of postEventLearners) {
    const registration = await seedEventRegistration(
      postEventOccurrence,
      requiredAt(learners, learnerIndex, "Learner"),
      learnerIndex,
      coordinatorForLearner(coordinators, learnerIndex),
      administrator,
      "selected",
      learnerIndex + 1,
    );
    await seedAttendance(
      postEventOccurrence,
      registration,
      coordinatorForLearner(coordinators, learnerIndex),
      learnerIndex === 6 ? "absent" : "attended",
    );
  }
  for (const occurrence of occurrences) await setConfirmedCount(occurrence.id);

  const [learnerCount, coordinatorCount, occurrenceCount, enrollmentCount] =
    await Promise.all([
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
        .selectFrom("user")
        .select((expression) => expression.fn.count<number>("id").as("count"))
        .where(
          "email",
          "in",
          coordinators.map((coordinator) => coordinator.email),
        )
        .executeTakeFirstOrThrow(),
      database
        .selectFrom("event_occurrence")
        .select((expression) => expression.fn.count<number>("id").as("count"))
        .where(
          "eventTemplateVersionId",
          "=",
          eventTemplate.eventTemplateVersionId,
        )
        .executeTakeFirstOrThrow(),
      database
        .selectFrom("enrollment")
        .select((expression) => expression.fn.count<number>("id").as("count"))
        .where("courseVersionId", "in", [
          courseOne.versionId,
          courseTwo.versionId,
        ])
        .executeTakeFirstOrThrow(),
    ]);
  assert.equal(String(learnerCount.count), "10");
  assert.equal(String(coordinatorCount.count), "3");
  assert.equal(String(occurrenceCount.count), "5");
  assert.equal(String(enrollmentCount.count), "4");

  console.log(
    "Seeded 10 numbered learners across 3 test regions, a verified multi-region coordinator review, 3 scoped coordinators, 5 staged Event Instances, 6 surveys, 3 real SCORM packages, 2 published eLearning courses and 4 varied enrollments",
  );
  console.log("All seeded credential accounts use SEED_LEARNER_PASSWORD");
} finally {
  await destroyDatabase();
}
