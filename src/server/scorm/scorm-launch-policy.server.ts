import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { courseContentSchema } from "#/features/catalog/catalog.schema";
import type { Database } from "#/server/db/types";
import {
  calculateEventSectionReleaseAt,
  ensureEventSectionReleased,
} from "#/server/learning/event-section-release.server";
import {
  courseRegistrationQuestionnaireComplete,
  eventRegistrationQuestionnaireComplete,
} from "#/server/registration/registration-questionnaire-access.server";

export type ScormLaunchTarget =
  | {
      kind: "course";
      enrollmentId: string;
      modulePosition: number;
    }
  | {
      kind: "event";
      eventParticipationId: string;
      eventTemplateVersionItemId: string;
    };

export type ScormLaunchPolicyDenial =
  | "not-found"
  | "access-unavailable"
  | "questionnaire-incomplete"
  | "item-unavailable"
  | "section-unreleased";

export interface AllowedScormLaunchPolicy {
  status: "allowed";
  target: ScormLaunchTarget;
  packageVersionId: string;
  packageSha256: string;
  intendedLaunchExpiresAt: Date | null;
}

export type ScormLaunchPolicyResult =
  | AllowedScormLaunchPolicy
  | { status: "denied"; reason: ScormLaunchPolicyDenial };

export interface LockedScormAttempt {
  id: string;
  status: "not_started" | "in_progress" | "completed" | "abandoned";
  progressRevision: number;
  writerMode: "online" | "offline";
  credentialGeneration: number;
  offlineEntitlementId: string | null;
}

function courseAccessAvailable(
  enrollment: {
    status: string;
    expiresAt: Date | null;
    removedAt: Date | null;
  },
  now: Date,
): boolean {
  return (
    !enrollment.removedAt &&
    enrollment.status !== "cancelled" &&
    enrollment.status !== "expired" &&
    (!enrollment.expiresAt || enrollment.expiresAt > now)
  );
}

async function resolveCoursePolicy(
  transaction: Transaction<Database>,
  target: Extract<ScormLaunchTarget, { kind: "course" }>,
  userId: string,
  now: Date,
): Promise<ScormLaunchPolicyResult> {
  const enrollment = await transaction
    .selectFrom("enrollment")
    .innerJoin(
      "course_version",
      "course_version.id",
      "enrollment.courseVersionId",
    )
    .select([
      "enrollment.id",
      "enrollment.status",
      "enrollment.expiresAt",
      "enrollment.removedAt",
      "enrollment.courseVersionId",
      "course_version.content",
    ])
    .where("enrollment.id", "=", target.enrollmentId)
    .where("enrollment.userId", "=", userId)
    .forUpdate("enrollment")
    .executeTakeFirst();
  if (!enrollment) return { status: "denied", reason: "not-found" };
  if (!courseAccessAvailable(enrollment, now))
    return { status: "denied", reason: "access-unavailable" };
  if (
    !(await courseRegistrationQuestionnaireComplete(
      transaction,
      enrollment.id,
      userId,
    ))
  )
    return { status: "denied", reason: "questionnaire-incomplete" };

  const content = courseContentSchema.parse(enrollment.content);
  if (!content.modules[target.modulePosition])
    return { status: "denied", reason: "not-found" };

  const packageVersion = await transaction
    .selectFrom("course_version_item")
    .innerJoin(
      "scorm_package_version",
      "scorm_package_version.id",
      "course_version_item.learningActivityVersionId",
    )
    .select([
      "scorm_package_version.id",
      "scorm_package_version.status",
      "scorm_package_version.sha256",
    ])
    .where(
      "course_version_item.courseVersionId",
      "=",
      enrollment.courseVersionId,
    )
    .where("course_version_item.kind", "=", "scorm")
    .where("course_version_item.modulePosition", "=", target.modulePosition)
    .executeTakeFirst();
  if (!packageVersion || packageVersion.status !== "ready")
    return { status: "denied", reason: "item-unavailable" };

  return {
    status: "allowed",
    target,
    packageVersionId: packageVersion.id,
    packageSha256: packageVersion.sha256,
    intendedLaunchExpiresAt: enrollment.expiresAt,
  };
}

async function resolveEventPolicy(
  transaction: Transaction<Database>,
  target: Extract<ScormLaunchTarget, { kind: "event" }>,
  userId: string,
  now: Date,
): Promise<ScormLaunchPolicyResult> {
  const item = await transaction
    .selectFrom("event_participation as participation")
    .innerJoin(
      "event_occurrence as occurrence",
      "occurrence.id",
      "participation.eventOccurrenceId",
    )
    .leftJoin(
      "event_registration as registration",
      "registration.id",
      "participation.registrationId",
    )
    .innerJoin("event_template_version_item as item", (join) =>
      join.onRef(
        "item.eventTemplateVersionId",
        "=",
        "occurrence.eventTemplateVersionId",
      ),
    )
    .innerJoin(
      "event_template_version_section as section",
      "section.id",
      "item.sectionId",
    )
    .innerJoin(
      "scorm_package_version as package",
      "package.id",
      "item.learningActivityVersionId",
    )
    .select([
      "participation.id as eventParticipationId",
      "participation.createdAt as participationCreatedAt",
      "occurrence.id as eventOccurrenceId",
      "occurrence.status as occurrenceStatus",
      "occurrence.startsAt",
      "occurrence.endsAt",
      "occurrence.timezone",
      "item.id as eventTemplateVersionItemId",
      "section.id as eventTemplateVersionSectionId",
      "section.releaseAnchor",
      "section.releaseOffsetAmount",
      "section.releaseOffsetUnit",
      "package.id as packageVersionId",
      "package.status as packageStatus",
      "package.sha256 as packageSha256",
    ])
    .where("participation.id", "=", target.eventParticipationId)
    .where("participation.userId", "=", userId)
    .where((expression) =>
      expression.or([
        expression("participation.mode", "=", "open_entry"),
        expression("registration.status", "=", "selected"),
      ]),
    )
    .where("item.id", "=", target.eventTemplateVersionItemId)
    .where("item.kind", "=", "scorm")
    .forUpdate("participation")
    .executeTakeFirst();
  if (!item) return { status: "denied", reason: "not-found" };
  if (["cancelled", "archived"].includes(item.occurrenceStatus))
    return { status: "denied", reason: "access-unavailable" };
  if (
    !(await eventRegistrationQuestionnaireComplete(
      transaction,
      item.eventOccurrenceId,
      userId,
    ))
  )
    return { status: "denied", reason: "questionnaire-incomplete" };
  if (item.packageStatus !== "ready")
    return { status: "denied", reason: "item-unavailable" };

  const finalSession = await transaction
    .selectFrom("event_session")
    .select(sql<Date>`coalesce(max("endsAt"), ${item.endsAt})`.as("endsAt"))
    .where("eventOccurrenceId", "=", item.eventOccurrenceId)
    .executeTakeFirstOrThrow();
  if (
    !(await ensureEventSectionReleased(transaction, {
      eventParticipationId: target.eventParticipationId,
      eventTemplateVersionSectionId: item.eventTemplateVersionSectionId,
      calculatedReleaseAt: calculateEventSectionReleaseAt({
        releaseAnchor: item.releaseAnchor,
        releaseOffsetAmount: item.releaseOffsetAmount,
        releaseOffsetUnit: item.releaseOffsetUnit,
        timezone: item.timezone,
        participationCreatedAt: item.participationCreatedAt,
        occurrenceStartsAt: item.startsAt,
        occurrenceEndsAt: item.endsAt,
        finalSessionEndsAt: finalSession.endsAt,
      }),
      now,
    }))
  )
    return { status: "denied", reason: "section-unreleased" };

  return {
    status: "allowed",
    target,
    packageVersionId: item.packageVersionId,
    packageSha256: item.packageSha256,
    // Event learning deliberately supports post-event work. The current domain
    // has no immutable close instant, so offline delegation remains denied
    // until that finite product boundary is introduced explicitly.
    intendedLaunchExpiresAt: null,
  };
}

export async function resolveScormLaunchPolicy(
  transaction: Transaction<Database>,
  target: ScormLaunchTarget,
  userId: string,
  now: Date,
): Promise<ScormLaunchPolicyResult> {
  return target.kind === "course"
    ? await resolveCoursePolicy(transaction, target, userId, now)
    : await resolveEventPolicy(transaction, target, userId, now);
}

export async function lockExistingScormAttempt(
  transaction: Transaction<Database>,
  target: ScormLaunchTarget,
): Promise<LockedScormAttempt | undefined> {
  let query = transaction
    .selectFrom("scorm_attempt")
    .select([
      "id",
      "status",
      "progressRevision",
      "writerMode",
      "credentialGeneration",
      "offlineEntitlementId",
    ]);
  query =
    target.kind === "course"
      ? query
          .where("enrollmentId", "=", target.enrollmentId)
          .where("modulePosition", "=", target.modulePosition)
      : query
          .where("eventParticipationId", "=", target.eventParticipationId)
          .where(
            "eventTemplateVersionItemId",
            "=",
            target.eventTemplateVersionItemId,
          );
  return await query
    .where("status", "in", ["not_started", "in_progress", "completed"])
    .orderBy(
      sql<number>`case when status = 'completed' then 0 else 1 end`,
      "asc",
    )
    .orderBy("attemptNumber", "desc")
    .forUpdate()
    .executeTakeFirst();
}

export async function lockOrCreateScormAttempt(
  transaction: Transaction<Database>,
  policy: AllowedScormLaunchPolicy,
): Promise<LockedScormAttempt> {
  const existing = await lockExistingScormAttempt(transaction, policy.target);
  if (existing) return existing;

  let numberQuery = transaction
    .selectFrom("scorm_attempt")
    .select(
      sql<number>`coalesce(max("attemptNumber"), 0)::integer`.as(
        "lastAttemptNumber",
      ),
    );
  numberQuery =
    policy.target.kind === "course"
      ? numberQuery
          .where("enrollmentId", "=", policy.target.enrollmentId)
          .where("modulePosition", "=", policy.target.modulePosition)
      : numberQuery
          .where(
            "eventParticipationId",
            "=",
            policy.target.eventParticipationId,
          )
          .where(
            "eventTemplateVersionItemId",
            "=",
            policy.target.eventTemplateVersionItemId,
          );
  const numberRow = await numberQuery.executeTakeFirstOrThrow();
  const attempt = await transaction
    .insertInto("scorm_attempt")
    .values({
      id: randomUUID(),
      enrollmentId:
        policy.target.kind === "course" ? policy.target.enrollmentId : null,
      modulePosition:
        policy.target.kind === "course" ? policy.target.modulePosition : null,
      eventParticipationId:
        policy.target.kind === "event"
          ? policy.target.eventParticipationId
          : null,
      eventTemplateVersionItemId:
        policy.target.kind === "event"
          ? policy.target.eventTemplateVersionItemId
          : null,
      scormPackageVersionId: policy.packageVersionId,
      attemptNumber: numberRow.lastAttemptNumber + 1,
      status: "not_started",
      lessonStatus: "not_attempted",
      location: "",
      suspendData: "",
      scoreRaw: null,
      scoreMin: null,
      scoreMax: null,
      totalTimeSeconds: 0,
      startedAt: null,
      lastActivityAt: null,
      completedAt: null,
    })
    .returning([
      "id",
      "status",
      "progressRevision",
      "writerMode",
      "credentialGeneration",
      "offlineEntitlementId",
    ])
    .executeTakeFirstOrThrow();
  return attempt;
}
