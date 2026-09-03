import "@tanstack/react-start/server-only";

import type { Kysely, Transaction } from "kysely";
import type { Database } from "#/server/db/types";

type DatabaseExecutor = Kysely<Database> | Transaction<Database>;

export async function courseRegistrationQuestionnaireComplete(
  database: DatabaseExecutor,
  enrollmentId: string,
  userId?: string,
): Promise<boolean> {
  let query = database
    .selectFrom("enrollment")
    .innerJoin(
      "course_version",
      "course_version.id",
      "enrollment.courseVersionId",
    )
    .leftJoin(
      "registration_questionnaire_assignment as assignment",
      "assignment.enrollmentId",
      "enrollment.id",
    )
    .select([
      "course_version.registrationSurveyVersionId",
      "assignment.status as assignmentStatus",
    ])
    .where("enrollment.id", "=", enrollmentId);
  if (userId) query = query.where("enrollment.userId", "=", userId);
  const row = await query.executeTakeFirst();
  return Boolean(
    row &&
    (row.registrationSurveyVersionId === null ||
      row.assignmentStatus === "completed" ||
      row.assignmentStatus === "waived"),
  );
}

export async function eventRegistrationQuestionnaireComplete(
  database: DatabaseExecutor,
  eventOccurrenceId: string,
  userId: string,
): Promise<boolean> {
  const row = await database
    .selectFrom("event_occurrence as occurrence")
    .innerJoin(
      "event_template_version as version",
      "version.id",
      "occurrence.eventTemplateVersionId",
    )
    .leftJoin("registration_questionnaire_assignment as assignment", (join) =>
      join
        .onRef("assignment.eventOccurrenceId", "=", "occurrence.id")
        .on("assignment.userId", "=", userId),
    )
    .select([
      "version.registrationSurveyVersionId",
      "assignment.status as assignmentStatus",
    ])
    .where("occurrence.id", "=", eventOccurrenceId)
    .executeTakeFirst();
  return Boolean(
    row &&
    (row.registrationSurveyVersionId === null ||
      row.assignmentStatus === "completed" ||
      row.assignmentStatus === "waived"),
  );
}

export async function eventRegistrationQuestionnaireSubmittedAt(
  database: DatabaseExecutor,
  eventOccurrenceId: string,
  userId: string,
): Promise<Date | null> {
  const assignment = await database
    .selectFrom("registration_questionnaire_assignment")
    .select(["status", "completedAt", "waivedAt"])
    .where("eventOccurrenceId", "=", eventOccurrenceId)
    .where("userId", "=", userId)
    .executeTakeFirst();
  if (assignment?.status === "completed") return assignment.completedAt;
  if (assignment?.status === "waived") return assignment.waivedAt;
  return null;
}
