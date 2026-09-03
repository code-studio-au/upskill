import "@tanstack/react-start/server-only";

import { courseContentSchema } from "#/features/catalog/catalog.schema";
import type { LearnerWorkspaceResult } from "#/features/learning/learning.schema";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import { findEffectiveModuleCompletion } from "#/server/learning/progress-overrides.server";
import { findCourseRegistrationQuestionnaire } from "#/server/registration/learner-registration-questionnaire.server";

const legacySectionDetails = {
  "pre-learning": {
    title: "Before you begin",
    description: "Prepare for the core learning experience.",
  },
  content: {
    title: "Learning modules",
    description: "Work through the main course content in order.",
  },
  "post-learning": {
    title: "Put it into practice",
    description: "Consolidate and apply what you have learned.",
  },
  followup: {
    title: "Follow-up",
    description: "Return to reinforce and extend your learning.",
  },
} as const;

const legacyPhaseOrder = [
  "pre-learning",
  "content",
  "post-learning",
  "followup",
] as const;

export async function findLearnerWorkspace(
  enrollmentId: string,
  user: AuthenticatedUser,
): Promise<Exclude<LearnerWorkspaceResult, { status: "unauthenticated" }>> {
  const database = getDatabase();
  const row = await database
    .selectFrom("enrollment")
    .innerJoin(
      "course_version",
      "course_version.id",
      "enrollment.courseVersionId",
    )
    .innerJoin("course", "course.id", "course_version.courseId")
    .select([
      "enrollment.id as enrollmentId",
      "enrollment.courseVersionId",
      "enrollment.status",
      "enrollment.enrolledAt",
      "enrollment.expiresAt",
      "enrollment.removedAt",
      "course.slug as courseSlug",
      "course_version.content",
    ])
    .where("enrollment.id", "=", enrollmentId)
    .where("enrollment.userId", "=", user.id)
    .executeTakeFirst();
  if (!row) return { status: "not-found" };
  if (row.removedAt || row.status === "cancelled")
    return { status: "removed", courseSlug: row.courseSlug };
  if (
    row.status === "expired" ||
    (row.expiresAt !== null && row.expiresAt <= new Date())
  ) {
    return { status: "expired", courseSlug: row.courseSlug };
  }
  const questionnaire = await findCourseRegistrationQuestionnaire(
    row.enrollmentId,
    user,
  );
  if (
    questionnaire &&
    typeof questionnaire === "object" &&
    !questionnaire.submittedAt
  )
    return { status: "registration-required", questionnaire };
  if (questionnaire === null) return { status: "not-found" };

  const content = courseContentSchema.parse(row.content);
  const moduleCompletion = await findEffectiveModuleCompletion(
    database,
    row.enrollmentId,
    row.courseVersionId,
  );
  const completionByPosition = new Map(
    moduleCompletion.map((module) => [module.position, module.state]),
  );
  const [sectionRows, itemRows, itemProgress] = await Promise.all([
    database
      .selectFrom("course_version_section")
      .select(["id", "position", "title", "description"])
      .where("courseVersionId", "=", row.courseVersionId)
      .orderBy("position", "asc")
      .execute(),
    database
      .selectFrom("course_version_item")
      .select([
        "id",
        "sectionId",
        "position",
        "kind",
        "title",
        "required",
        "durationMinutes",
        "modulePosition",
        "learningActivityVersionId",
      ])
      .where("courseVersionId", "=", row.courseVersionId)
      .orderBy("position", "asc")
      .execute(),
    database
      .selectFrom("learning_item_progress")
      .select("courseVersionItemId")
      .where("enrollmentId", "=", row.enrollmentId)
      .where("state", "=", "completed")
      .execute(),
  ]);
  const completedItemIds = new Set(
    itemProgress.map((progress) => progress.courseVersionItemId),
  );
  const sections = sectionRows.map((section) => {
    const items = itemRows
      .filter((item) => item.sectionId === section.id)
      .map((item) => ({
        id: item.id,
        position: item.position,
        kind: item.kind,
        title: item.title,
        required: item.required,
        durationMinutes: item.durationMinutes,
        completionState:
          (item.kind === "scorm" &&
            item.modulePosition !== null &&
            completionByPosition.get(item.modulePosition) === "completed") ||
          completedItemIds.has(item.id)
            ? ("completed" as const)
            : ("incomplete" as const),
        modulePosition: item.modulePosition,
        resourceVersionId:
          item.kind === "resource" ? item.learningActivityVersionId : null,
      }));
    const requiredItems = items.filter((item) => item.required);
    const completionTargets = requiredItems.length > 0 ? requiredItems : items;
    return {
      ...section,
      completedItems: items.filter(
        (item) => item.completionState === "completed",
      ).length,
      totalItems: items.length,
      completedRequiredItems: requiredItems.filter(
        (item) => item.completionState === "completed",
      ).length,
      requiredItems: requiredItems.length,
      completionState:
        completionTargets.length > 0 &&
        completionTargets.every((item) => item.completionState === "completed")
          ? ("completed" as const)
          : ("incomplete" as const),
      items,
    };
  });
  const legacySections = legacyPhaseOrder.flatMap((phase, sectionPosition) => {
    const items = content.modules.flatMap((module, modulePosition) =>
      module.phase === phase
        ? [
            {
              id: `legacy-module-${String(modulePosition)}`,
              position: modulePosition,
              kind: "scorm" as const,
              title: module.title,
              required: true,
              durationMinutes: module.durationMinutes,
              completionState:
                completionByPosition.get(modulePosition) === "completed"
                  ? ("completed" as const)
                  : ("incomplete" as const),
              modulePosition,
              resourceVersionId: null,
            },
          ]
        : [],
    );
    if (items.length === 0) return [];
    const completedItems = items.filter(
      (item) => item.completionState === "completed",
    ).length;
    return [
      {
        id: `legacy-section-${phase}`,
        position: sectionPosition,
        ...legacySectionDetails[phase],
        completedItems,
        totalItems: items.length,
        completedRequiredItems: completedItems,
        requiredItems: items.length,
        completionState:
          completedItems === items.length
            ? ("completed" as const)
            : ("incomplete" as const),
        items,
      },
    ];
  });
  return {
    status: "available",
    workspace: {
      enrollmentId: row.enrollmentId,
      courseSlug: row.courseSlug,
      courseTitle: content.title,
      courseSummary: content.summary,
      completionStatus: row.status === "completed" ? "completed" : "incomplete",
      enrolledAt: row.enrolledAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      modules: content.modules.map((module, position) => ({
        position,
        title: module.title,
        phase: module.phase,
        durationMinutes: module.durationMinutes,
        completionState:
          completionByPosition.get(position) === "completed"
            ? "completed"
            : "incomplete",
      })),
      sections: sections.length > 0 ? sections : legacySections,
    },
  };
}
