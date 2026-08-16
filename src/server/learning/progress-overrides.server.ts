import "@tanstack/react-start/server-only";

import { sql, type Kysely, type Transaction } from "kysely";
import { courseContentSchema } from "#/features/catalog/catalog.schema";
import type { Database } from "#/server/db/types";

type DatabaseExecutor = Kysely<Database> | Transaction<Database>;

export interface ProgressOverrideRow {
  id: string;
  modulePosition: number | null;
  state: "completed" | "incomplete";
  actorUserId: string;
  reason: string | null;
  createdAt: Date;
}

export interface EffectiveModuleCompletion {
  position: number;
  state: "completed" | "incomplete";
  source: "scorm" | "administrator" | "none";
  override: ProgressOverrideRow | null;
}

interface EnrollmentCourseVersion {
  enrollmentId: string;
  courseVersionId: string;
}

function effectiveModuleCompletion(
  contentValue: unknown,
  completedAttempts: ReadonlyArray<{
    modulePosition: number;
    lastActivityAt: Date | null;
  }>,
  overrides: ReadonlyArray<ProgressOverrideRow>,
): Array<EffectiveModuleCompletion> {
  const completedActivity = new Map(
    completedAttempts.map((attempt) => [
      attempt.modulePosition,
      attempt.lastActivityAt,
    ]),
  );
  const latestOverrides = new Map<number, ProgressOverrideRow>();
  for (const override of overrides) {
    if (
      override.modulePosition !== null &&
      !latestOverrides.has(override.modulePosition)
    )
      latestOverrides.set(override.modulePosition, override);
  }
  const content = courseContentSchema.parse(contentValue);
  return content.modules.map((_, position) => {
    const override = latestOverrides.get(position) ?? null;
    const latestCompletion = completedActivity.get(position) ?? null;
    if (
      override &&
      (!latestCompletion || override.createdAt > latestCompletion)
    )
      return {
        position,
        state: override.state,
        source: "administrator",
        override,
      };
    const completed = latestCompletion !== null;
    return {
      position,
      state: completed ? "completed" : "incomplete",
      source: completed ? "scorm" : "none",
      override: null,
    };
  });
}

async function findLatestEnrollmentProgressOverride(
  database: DatabaseExecutor,
  enrollmentId: string,
): Promise<ProgressOverrideRow | null> {
  return (
    (await database
      .selectFrom("learning_progress_override")
      .select([
        "id",
        "modulePosition",
        "state",
        "actorUserId",
        "reason",
        "createdAt",
      ])
      .where("enrollmentId", "=", enrollmentId)
      .where("scope", "=", "enrollment")
      .orderBy("sequence", "desc")
      .limit(1)
      .executeTakeFirst()) ?? null
  );
}

export async function findEffectiveEnrollmentProgressOverride(
  database: DatabaseExecutor,
  enrollmentId: string,
  completedAt: Date | null,
): Promise<ProgressOverrideRow | null> {
  const override = await findLatestEnrollmentProgressOverride(
    database,
    enrollmentId,
  );
  if (
    override &&
    (!completedAt || override.createdAt.getTime() >= completedAt.getTime())
  )
    return override;
  return null;
}

export async function findEffectiveModuleCompletion(
  database: DatabaseExecutor,
  enrollmentId: string,
  courseVersionId: string,
): Promise<Array<EffectiveModuleCompletion>> {
  const results = await findEffectiveModuleCompletionForEnrollments(database, [
    { enrollmentId, courseVersionId },
  ]);
  return results.get(enrollmentId) ?? [];
}

export async function findEffectiveModuleCompletionForEnrollments(
  database: DatabaseExecutor,
  enrollments: ReadonlyArray<EnrollmentCourseVersion>,
): Promise<Map<string, Array<EffectiveModuleCompletion>>> {
  if (!enrollments.length) return new Map();
  const enrollmentIds = enrollments.map((entry) => entry.enrollmentId);
  const courseVersionIds = [
    ...new Set(enrollments.map((entry) => entry.courseVersionId)),
  ];
  const [courseVersions, completedAttempts, overrides] = await Promise.all([
    database
      .selectFrom("course_version")
      .select(["id", "content"])
      .where("id", "in", courseVersionIds)
      .execute(),
    database
      .selectFrom("scorm_attempt")
      .select([
        "enrollmentId",
        "modulePosition",
        sql<Date | null>`max("lastActivityAt")`.as("lastActivityAt"),
      ])
      .where("enrollmentId", "in", enrollmentIds)
      .where("status", "=", "completed")
      .groupBy(["enrollmentId", "modulePosition"])
      .execute(),
    database
      .selectFrom("learning_progress_override")
      .select([
        "enrollmentId",
        "id",
        "modulePosition",
        "state",
        "actorUserId",
        "reason",
        "createdAt",
      ])
      .where("enrollmentId", "in", enrollmentIds)
      .where("scope", "=", "module")
      .orderBy("sequence", "desc")
      .execute(),
  ]);
  const contentByVersion = new Map(
    courseVersions.map((version) => [version.id, version.content]),
  );
  const attemptsByEnrollment = new Map<
    string,
    Array<{ modulePosition: number; lastActivityAt: Date | null }>
  >();
  for (const attempt of completedAttempts) {
    if (attempt.enrollmentId === null || attempt.modulePosition === null)
      continue;
    const rows = attemptsByEnrollment.get(attempt.enrollmentId) ?? [];
    rows.push({
      modulePosition: attempt.modulePosition,
      lastActivityAt: attempt.lastActivityAt,
    });
    attemptsByEnrollment.set(attempt.enrollmentId, rows);
  }
  const overridesByEnrollment = new Map<string, Array<ProgressOverrideRow>>();
  for (const override of overrides) {
    const rows = overridesByEnrollment.get(override.enrollmentId) ?? [];
    rows.push(override);
    overridesByEnrollment.set(override.enrollmentId, rows);
  }
  return new Map(
    enrollments.flatMap((entry) => {
      const content = contentByVersion.get(entry.courseVersionId);
      if (!content) return [];
      return [
        [
          entry.enrollmentId,
          effectiveModuleCompletion(
            content,
            attemptsByEnrollment.get(entry.enrollmentId) ?? [],
            overridesByEnrollment.get(entry.enrollmentId) ?? [],
          ),
        ] as const,
      ];
    }),
  );
}
