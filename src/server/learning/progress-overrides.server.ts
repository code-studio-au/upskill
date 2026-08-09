import "@tanstack/react-start/server-only";

import type { Kysely, Transaction } from "kysely";
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

export async function findLatestEnrollmentProgressOverride(
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

export async function findEffectiveModuleCompletion(
  database: DatabaseExecutor,
  enrollmentId: string,
  courseVersionId: string,
): Promise<Array<EffectiveModuleCompletion>> {
  const [courseVersion, completedAttempts, overrides] = await Promise.all([
    database
      .selectFrom("course_version")
      .select("content")
      .where("id", "=", courseVersionId)
      .executeTakeFirstOrThrow(),
    database
      .selectFrom("scorm_attempt")
      .select("modulePosition")
      .distinct()
      .where("enrollmentId", "=", enrollmentId)
      .where("status", "=", "completed")
      .execute(),
    database
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
      .where("scope", "=", "module")
      .orderBy("sequence", "desc")
      .execute(),
  ]);
  const completedPositions = new Set(
    completedAttempts.map((attempt) => attempt.modulePosition),
  );
  const latestOverrides = new Map<number, ProgressOverrideRow>();
  for (const override of overrides) {
    if (
      override.modulePosition !== null &&
      !latestOverrides.has(override.modulePosition)
    ) {
      latestOverrides.set(override.modulePosition, override);
    }
  }
  const content = courseContentSchema.parse(courseVersion.content);

  return content.modules.map((_, position) => {
    const override = latestOverrides.get(position) ?? null;
    if (override) {
      return {
        position,
        state: override.state,
        source: "administrator",
        override,
      };
    }
    const completed = completedPositions.has(position);
    return {
      position,
      state: completed ? "completed" : "incomplete",
      source: completed ? "scorm" : "none",
      override: null,
    };
  });
}
