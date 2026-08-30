import "@tanstack/react-start/server-only";

import type { Kysely, Transaction } from "kysely";
import type { Database } from "#/server/db/types";
import { findEffectiveModuleCompletionForEnrollments } from "#/server/learning/progress-overrides.server";

type DatabaseExecutor = Kysely<Database> | Transaction<Database>;

interface CourseProgressSectionSummary {
  id: string;
  title: string;
  completedItems: number;
  totalItems: number;
}

export interface CourseProgressSummary {
  completedItems: number;
  totalItems: number;
  completedModules: number;
  totalModules: number;
  sections: Array<CourseProgressSectionSummary>;
}

export async function findCourseProgressSummaries(
  database: DatabaseExecutor,
  enrollments: ReadonlyArray<{
    enrollmentId: string;
    courseVersionId: string;
  }>,
): Promise<Map<string, CourseProgressSummary>> {
  if (enrollments.length === 0) return new Map();
  const enrollmentIds = enrollments.map((row) => row.enrollmentId);
  const courseVersionIds = [
    ...new Set(enrollments.map((row) => row.courseVersionId)),
  ];
  const [moduleCompletionByEnrollment, sectionRows, itemRows, itemProgress] =
    await Promise.all([
      findEffectiveModuleCompletionForEnrollments(database, enrollments),
      database
        .selectFrom("course_version_section")
        .select(["id", "courseVersionId", "title", "position"])
        .where("courseVersionId", "in", courseVersionIds)
        .orderBy("position")
        .execute(),
      database
        .selectFrom("course_version_item")
        .select([
          "id",
          "courseVersionId",
          "sectionId",
          "kind",
          "required",
          "modulePosition",
          "position",
        ])
        .where("courseVersionId", "in", courseVersionIds)
        .orderBy("position")
        .execute(),
      database
        .selectFrom("learning_item_progress")
        .select(["enrollmentId", "courseVersionItemId"])
        .where("enrollmentId", "in", enrollmentIds)
        .where("state", "=", "completed")
        .execute(),
    ]);

  const result = new Map<string, CourseProgressSummary>();
  for (const enrollment of enrollments) {
    const moduleCompletion =
      moduleCompletionByEnrollment.get(enrollment.enrollmentId) ?? [];
    const completedModulePositions = new Set(
      moduleCompletion
        .filter((module) => module.state === "completed")
        .map((module) => module.position),
    );
    const completedItemIds = new Set(
      itemProgress
        .filter((progress) => progress.enrollmentId === enrollment.enrollmentId)
        .map((progress) => progress.courseVersionItemId),
    );
    const structuredSections = sectionRows
      .filter(
        (section) => section.courseVersionId === enrollment.courseVersionId,
      )
      .map((section) => {
        const items = itemRows
          .filter((item) => item.sectionId === section.id)
          .map((item) => ({
            ...item,
            completed:
              (item.kind === "scorm" &&
                item.modulePosition !== null &&
                completedModulePositions.has(item.modulePosition)) ||
              completedItemIds.has(item.id),
          }));
        const requiredItems = items.filter((item) => item.required);
        const targets = requiredItems.length > 0 ? requiredItems : items;
        return {
          id: section.id,
          title: section.title,
          completedItems: targets.filter((item) => item.completed).length,
          totalItems: targets.length,
        };
      });
    const sections =
      structuredSections.length > 0
        ? structuredSections
        : moduleCompletion.length > 0
          ? [
              {
                id: `legacy-modules-${enrollment.courseVersionId}`,
                title: "Modules",
                completedItems: completedModulePositions.size,
                totalItems: moduleCompletion.length,
              },
            ]
          : [];
    result.set(enrollment.enrollmentId, {
      completedItems: sections.reduce(
        (total, section) => total + section.completedItems,
        0,
      ),
      totalItems: sections.reduce(
        (total, section) => total + section.totalItems,
        0,
      ),
      completedModules: completedModulePositions.size,
      totalModules: moduleCompletion.length,
      sections,
    });
  }
  return result;
}
