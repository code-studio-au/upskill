import "@tanstack/react-start/server-only";

import type { Transaction } from "kysely";
import type { Database } from "#/server/db/types";
import {
  buildCourseNotificationVariables,
  type CourseNotificationRecipient,
} from "./offering-course-context.server";
import { enqueueOfferingCourseNotification } from "./notification.server";

type CourseTrigger =
  | "course_incomplete"
  | "enrollment_completed"
  | "enrollment_created"
  | "enrollment_expiring";

function offsetMilliseconds(
  amount: number,
  unit: "minute" | "hour" | "day" | "week",
): number {
  const minutes =
    unit === "minute"
      ? amount
      : unit === "hour"
        ? amount * 60
        : unit === "day"
          ? amount * 24 * 60
          : amount * 7 * 24 * 60;
  return minutes * 60_000;
}

export async function enqueueCourseEnrollmentCommunications(
  transaction: Transaction<Database>,
  input: {
    enrollmentId: string;
    triggerEventId: string;
    triggers: ReadonlyArray<CourseTrigger>;
    createdAt: Date;
  },
): Promise<number> {
  const enrollment = await transaction
    .selectFrom("enrollment")
    .innerJoin("user", "user.id", "enrollment.userId")
    .select([
      "enrollment.id as enrollmentId",
      "enrollment.courseVersionId",
      "enrollment.enrolledAt",
      "enrollment.completedAt",
      "enrollment.expiresAt",
      "enrollment.status",
      "enrollment.removedAt",
      "user.id as userId",
      "user.name",
      "user.email",
    ])
    .where("enrollment.id", "=", input.enrollmentId)
    .executeTakeFirstOrThrow();
  const affectedRecipient: CourseNotificationRecipient = enrollment;
  const communications = await transaction
    .selectFrom("course_version_communication as communication")
    .innerJoin(
      "email_design_version as version",
      "version.id",
      "communication.emailDesignVersionId",
    )
    .select([
      "communication.id",
      "communication.sectionId",
      "communication.audience",
      "communication.trigger",
      "communication.offsetAmount",
      "communication.offsetUnit",
      "communication.emailDesignVersionId",
      "communication.subjectOverride",
      "communication.textBodyOverride",
      "version.subject",
      "version.textBody",
      "version.contractKey",
      "version.contractVersion",
      "version.publishedAt",
    ])
    .where("communication.courseVersionId", "=", enrollment.courseVersionId)
    .where("communication.trigger", "in", [...input.triggers])
    .execute();
  let created = 0;
  for (const communication of communications) {
    if (
      communication.contractKey !== "offering.course" ||
      communication.contractVersion !== 1 ||
      !communication.publishedAt
    )
      continue;
    const anchorAt =
      communication.trigger === "enrollment_expiring"
        ? enrollment.expiresAt
        : communication.trigger === "enrollment_completed"
          ? (enrollment.completedAt ?? input.createdAt)
          : communication.trigger === "course_incomplete"
            ? enrollment.enrolledAt
            : input.createdAt;
    if (!anchorAt) continue;
    const active =
      enrollment.status === "active" &&
      !enrollment.removedAt &&
      (!enrollment.expiresAt || enrollment.expiresAt > input.createdAt);
    const recipients =
      communication.audience === "active_enrollees" && !active
        ? []
        : [affectedRecipient];
    for (const recipient of recipients) {
      const variables = await buildCourseNotificationVariables(transaction, {
        courseVersionId: enrollment.courseVersionId,
        sectionId: communication.sectionId,
        recipient,
      });
      await enqueueOfferingCourseNotification(transaction, {
        recipient,
        emailDesignVersionId: communication.emailDesignVersionId,
        subjectTemplateSnapshot:
          communication.subjectOverride ?? communication.subject,
        textBodyTemplateSnapshot:
          communication.textBodyOverride ?? communication.textBody,
        deduplicationKey: `${communication.id}:${input.triggerEventId}:${recipient.userId}`,
        courseVersionId: enrollment.courseVersionId,
        courseVersionCommunicationId: communication.id,
        enrollmentId: recipient.enrollmentId,
        trigger: communication.trigger,
        anchorAt,
        variables,
        createdAt: input.createdAt,
        availableAt: new Date(
          Math.max(
            input.createdAt.getTime(),
            anchorAt.getTime() +
              offsetMilliseconds(
                communication.offsetAmount,
                communication.offsetUnit,
              ),
          ),
        ),
      });
      created += 1;
    }
  }
  return created;
}
