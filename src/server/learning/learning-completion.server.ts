import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import { requestCompletionCertificate } from "#/server/certificate/completion-certificate.server";
import type { Database } from "#/server/db/types";
import {
  findLatestEnrollmentProgressOverride,
  findEffectiveModuleCompletion,
} from "#/server/learning/progress-overrides.server";

export type LearningCompletionSource = "scorm" | "resource" | "survey";

export async function isLearningComplete(
  transaction: Transaction<Database>,
  enrollmentId: string,
  courseVersionId: string,
): Promise<boolean> {
  const [sections, items, itemProgress, moduleCompletion] = await Promise.all([
    transaction
      .selectFrom("course_version_section")
      .select("id")
      .where("courseVersionId", "=", courseVersionId)
      .execute(),
    transaction
      .selectFrom("course_version_item")
      .select(["id", "sectionId", "kind", "required", "modulePosition"])
      .where("courseVersionId", "=", courseVersionId)
      .execute(),
    transaction
      .selectFrom("learning_item_progress")
      .select("courseVersionItemId")
      .where("enrollmentId", "=", enrollmentId)
      .where("state", "=", "completed")
      .execute(),
    findEffectiveModuleCompletion(transaction, enrollmentId, courseVersionId),
  ]);
  const completedModules = new Set(
    moduleCompletion
      .filter((module) => module.state === "completed")
      .map((module) => module.position),
  );

  if (sections.length === 0)
    return (
      moduleCompletion.length > 0 &&
      moduleCompletion.every((module) => module.state === "completed")
    );

  const completedItemIds = new Set(
    itemProgress.map((progress) => progress.courseVersionItemId),
  );
  return sections.every((section) => {
    const sectionItems = items.filter((item) => item.sectionId === section.id);
    const requiredItems = sectionItems.filter((item) => item.required);
    const targets = requiredItems.length > 0 ? requiredItems : sectionItems;
    return (
      targets.length > 0 &&
      targets.every((item) =>
        item.kind === "scorm"
          ? item.modulePosition !== null &&
            completedModules.has(item.modulePosition)
          : completedItemIds.has(item.id),
      )
    );
  });
}

export async function completeEnrollmentIfReady(
  transaction: Transaction<Database>,
  input: {
    enrollmentId: string;
    courseVersionId: string;
    source: LearningCompletionSource;
  },
  now: Date,
): Promise<boolean> {
  if (
    (await findLatestEnrollmentProgressOverride(
      transaction,
      input.enrollmentId,
    )) ||
    !(await isLearningComplete(
      transaction,
      input.enrollmentId,
      input.courseVersionId,
    ))
  )
    return false;

  const result = await transaction
    .updateTable("enrollment")
    .set({ status: "completed", completedAt: now })
    .where("id", "=", input.enrollmentId)
    .where("status", "=", "active")
    .returning("id")
    .executeTakeFirst();
  if (!result) return false;
  await recordDurableAuditEvent(transaction, {
    actorUserId: null,
    action: "enrollment.learning_completed",
    subjectType: "enrollment",
    subjectId: input.enrollmentId,
    metadata: {
      courseVersionId: input.courseVersionId,
      source: input.source,
    },
    createdAt: now,
  });
  await transaction
    .insertInto("outbox_event")
    .values({
      id: randomUUID(),
      topic: "enrollment.completed",
      aggregateId: input.enrollmentId,
      payload: {
        enrollmentId: input.enrollmentId,
        courseVersionId: input.courseVersionId,
        source: input.source,
      },
      availableAt: now,
      processedAt: null,
      createdAt: now,
    })
    .execute();
  await requestCompletionCertificate(transaction, input, now);
  return true;
}
