import "@tanstack/react-start/server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { courseContentSchema } from "#/features/catalog/catalog.schema";
import {
  scormProgressInputSchema,
  type ScormLaunchResult,
  type ScormProgressInput,
} from "#/features/scorm/scorm.schema";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import { getServerEnv } from "#/server/env.server";
import { logServerEvent } from "#/server/logging/server-logger";
import { completeEnrollmentIfReady } from "#/server/learning/learning-completion.server";
import { completeEventParticipationIfReady } from "#/server/learning/event-learning-completion.server";
import {
  calculateEventSectionReleaseAt,
  ensureEventSectionReleased,
} from "#/server/learning/event-section-release.server";
import { addElapsedMilliseconds } from "#/server/time/time.server";

const LAUNCH_TOKEN_LIFETIME_MS = 5 * 60 * 1_000;
const ATTEMPT_SESSION_LIFETIME_MS = 8 * 60 * 60 * 1_000;

function opaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

function digestScormToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function accessAvailable(enrollment: {
  status: string;
  expiresAt: Date | null;
  removedAt: Date | null;
}): boolean {
  return (
    !enrollment.removedAt &&
    enrollment.status !== "cancelled" &&
    enrollment.status !== "expired" &&
    (!enrollment.expiresAt || enrollment.expiresAt > new Date())
  );
}

function attemptContextAvailable(context: {
  enrollmentId: string | null;
  enrollmentStatus: string | null;
  enrollmentExpiresAt: Date | null;
  removedAt: Date | null;
  eventParticipationId: string | null;
  occurrenceStatus: string | null;
}): boolean {
  if (context.enrollmentId)
    return (
      context.enrollmentStatus !== null &&
      accessAvailable({
        status: context.enrollmentStatus,
        expiresAt: context.enrollmentExpiresAt,
        removedAt: context.removedAt,
      })
    );
  return Boolean(
    context.eventParticipationId &&
    context.occurrenceStatus &&
    !["cancelled", "archived"].includes(context.occurrenceStatus),
  );
}

export async function createScormLaunch(
  enrollmentId: string,
  modulePosition: number,
  user: AuthenticatedUser,
): Promise<Exclude<ScormLaunchResult, { status: "unauthenticated" }>> {
  let launchedAttemptId: string | undefined;
  const result = await getDatabase()
    .transaction()
    .execute(async (transaction) => {
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
        .where("enrollment.id", "=", enrollmentId)
        .where("enrollment.userId", "=", user.id)
        .forUpdate("enrollment")
        .executeTakeFirst();
      if (!enrollment) return { status: "not-found" } as const;
      if (!accessAvailable(enrollment))
        return { status: "unavailable" } as const;

      const content = courseContentSchema.parse(enrollment.content);
      if (!content.modules[modulePosition])
        return { status: "not-found" } as const;

      const packageVersion = await transaction
        .selectFrom("course_version_item")
        .innerJoin(
          "scorm_package_version",
          "scorm_package_version.id",
          "course_version_item.learningActivityVersionId",
        )
        .select(["scorm_package_version.id", "scorm_package_version.status"])
        .where(
          "course_version_item.courseVersionId",
          "=",
          enrollment.courseVersionId,
        )
        .where("course_version_item.kind", "=", "scorm")
        .where("course_version_item.modulePosition", "=", modulePosition)
        .executeTakeFirst();
      if (!packageVersion || packageVersion.status !== "ready")
        return { status: "unavailable" } as const;

      let attempt = await transaction
        .selectFrom("scorm_attempt")
        .select(["id", "status"])
        .where("enrollmentId", "=", enrollment.id)
        .where("modulePosition", "=", modulePosition)
        .where("status", "=", "completed")
        .orderBy("attemptNumber", "desc")
        .limit(1)
        .executeTakeFirst();
      attempt ??= await transaction
        .selectFrom("scorm_attempt")
        .select(["id", "status"])
        .where("enrollmentId", "=", enrollment.id)
        .where("modulePosition", "=", modulePosition)
        .where("status", "in", ["not_started", "in_progress"])
        .orderBy("attemptNumber", "desc")
        .limit(1)
        .executeTakeFirst();
      if (!attempt) {
        const numberRow = await transaction
          .selectFrom("scorm_attempt")
          .select(
            sql<number>`coalesce(max("attemptNumber"), 0)::integer`.as(
              "lastAttemptNumber",
            ),
          )
          .where("enrollmentId", "=", enrollment.id)
          .where("modulePosition", "=", modulePosition)
          .executeTakeFirstOrThrow();
        attempt = {
          id: randomUUID(),
          status: "not_started",
        };
        await transaction
          .insertInto("scorm_attempt")
          .values({
            id: attempt.id,
            enrollmentId: enrollment.id,
            modulePosition,
            eventParticipationId: null,
            eventTemplateVersionItemId: null,
            scormPackageVersionId: packageVersion.id,
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
          .execute();
      }

      const now = new Date();
      const token = opaqueToken();
      await transaction
        .updateTable("scorm_launch_token")
        .set({ expiresAt: now })
        .where("attemptId", "=", attempt.id)
        .where("consumedAt", "is", null)
        .where("expiresAt", ">", now)
        .execute();
      await transaction
        .insertInto("scorm_launch_token")
        .values({
          digest: digestScormToken(token),
          attemptId: attempt.id,
          expiresAt: addElapsedMilliseconds(now, LAUNCH_TOKEN_LIFETIME_MS),
          consumedAt: null,
          createdAt: now,
        })
        .execute();
      launchedAttemptId = attempt.id;

      const launchUrl = new URL(
        "/api/scorm/launch",
        getServerEnv().LEARNING_ORIGIN,
      );
      launchUrl.searchParams.set("token", token);
      return { status: "ready", launchUrl: launchUrl.toString() } as const;
    });
  if (result.status === "ready" && launchedAttemptId)
    logServerEvent({
      level: "info",
      event: "scorm.attempt_launch_issued",
      fields: {
        actorUserId: user.id,
        entityType: "scorm_attempt",
        entityId: launchedAttemptId,
        enrollmentId,
      },
    });
  return result;
}

export async function createEventScormLaunch(
  eventParticipationId: string,
  eventTemplateVersionItemId: string,
  user: AuthenticatedUser,
): Promise<Exclude<ScormLaunchResult, { status: "unauthenticated" }>> {
  let launchedAttemptId: string | undefined;
  const result = await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const item = await transaction
        .selectFrom("event_participation as participation")
        .innerJoin(
          "event_occurrence as occurrence",
          "occurrence.id",
          "participation.eventOccurrenceId",
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
        ])
        .where("participation.id", "=", eventParticipationId)
        .where("participation.userId", "=", user.id)
        .where("item.id", "=", eventTemplateVersionItemId)
        .where("item.kind", "=", "scorm")
        .forUpdate("participation")
        .executeTakeFirst();
      if (!item) return { status: "not-found" } as const;
      if (
        item.packageStatus !== "ready" ||
        ["cancelled", "archived"].includes(item.occurrenceStatus)
      )
        return { status: "unavailable" } as const;
      const finalSession = await transaction
        .selectFrom("event_session")
        .select(sql<Date>`coalesce(max("endsAt"), ${item.endsAt})`.as("endsAt"))
        .where("eventOccurrenceId", "=", item.eventOccurrenceId)
        .executeTakeFirstOrThrow();
      const now = new Date();
      if (
        !(await ensureEventSectionReleased(transaction, {
          eventParticipationId,
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
        return { status: "unavailable" } as const;

      let attempt = await transaction
        .selectFrom("scorm_attempt")
        .select(["id", "status"])
        .where("eventParticipationId", "=", eventParticipationId)
        .where("eventTemplateVersionItemId", "=", eventTemplateVersionItemId)
        .where("status", "=", "completed")
        .orderBy("attemptNumber", "desc")
        .limit(1)
        .executeTakeFirst();
      attempt ??= await transaction
        .selectFrom("scorm_attempt")
        .select(["id", "status"])
        .where("eventParticipationId", "=", eventParticipationId)
        .where("eventTemplateVersionItemId", "=", eventTemplateVersionItemId)
        .where("status", "in", ["not_started", "in_progress"])
        .orderBy("attemptNumber", "desc")
        .limit(1)
        .executeTakeFirst();
      if (!attempt) {
        const numberRow = await transaction
          .selectFrom("scorm_attempt")
          .select(
            sql<number>`coalesce(max("attemptNumber"), 0)::integer`.as(
              "lastAttemptNumber",
            ),
          )
          .where("eventParticipationId", "=", eventParticipationId)
          .where("eventTemplateVersionItemId", "=", eventTemplateVersionItemId)
          .executeTakeFirstOrThrow();
        attempt = { id: randomUUID(), status: "not_started" };
        await transaction
          .insertInto("scorm_attempt")
          .values({
            id: attempt.id,
            enrollmentId: null,
            modulePosition: null,
            eventParticipationId,
            eventTemplateVersionItemId,
            scormPackageVersionId: item.packageVersionId,
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
          .execute();
      }
      const token = opaqueToken();
      await transaction
        .updateTable("scorm_launch_token")
        .set({ expiresAt: now })
        .where("attemptId", "=", attempt.id)
        .where("consumedAt", "is", null)
        .where("expiresAt", ">", now)
        .execute();
      await transaction
        .insertInto("scorm_launch_token")
        .values({
          digest: digestScormToken(token),
          attemptId: attempt.id,
          expiresAt: addElapsedMilliseconds(now, LAUNCH_TOKEN_LIFETIME_MS),
          consumedAt: null,
          createdAt: now,
        })
        .execute();
      launchedAttemptId = attempt.id;
      const launchUrl = new URL(
        "/api/scorm/launch",
        getServerEnv().LEARNING_ORIGIN,
      );
      launchUrl.searchParams.set("token", token);
      return { status: "ready", launchUrl: launchUrl.toString() } as const;
    });
  if (result.status === "ready" && launchedAttemptId)
    logServerEvent({
      level: "info",
      event: "scorm.attempt_launch_issued",
      fields: {
        actorUserId: user.id,
        entityType: "scorm_attempt",
        entityId: launchedAttemptId,
        eventParticipationId,
      },
    });
  return result;
}

export interface ScormLaunchExchange {
  attemptId: string;
  sessionToken: string;
  sessionExpiresAt: Date;
}

export async function exchangeScormLaunchToken(
  token: string,
): Promise<ScormLaunchExchange | null> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const now = new Date();
      const launch = await transaction
        .selectFrom("scorm_launch_token")
        .innerJoin(
          "scorm_attempt",
          "scorm_attempt.id",
          "scorm_launch_token.attemptId",
        )
        .innerJoin(
          "scorm_attempt_context as context",
          "context.attemptId",
          "scorm_attempt.id",
        )
        .select([
          "scorm_launch_token.attemptId",
          "scorm_launch_token.expiresAt as launchExpiresAt",
          "scorm_launch_token.consumedAt",
          "context.enrollmentId",
          "context.enrollmentStatus",
          "context.enrollmentExpiresAt",
          "context.removedAt",
          "context.eventParticipationId",
          "context.occurrenceStatus",
        ])
        .where("scorm_launch_token.digest", "=", digestScormToken(token))
        .forUpdate("scorm_launch_token")
        .executeTakeFirst();
      if (
        !launch ||
        launch.consumedAt ||
        launch.launchExpiresAt <= now ||
        !attemptContextAvailable(launch)
      ) {
        return null;
      }

      const sessionToken = opaqueToken();
      const maximumSessionExpiry = addElapsedMilliseconds(
        now,
        ATTEMPT_SESSION_LIFETIME_MS,
      );
      const sessionExpiresAt =
        launch.enrollmentExpiresAt &&
        launch.enrollmentExpiresAt < maximumSessionExpiry
          ? launch.enrollmentExpiresAt
          : maximumSessionExpiry;
      await transaction
        .updateTable("scorm_launch_token")
        .set({ consumedAt: now })
        .where("digest", "=", digestScormToken(token))
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto("scorm_attempt_session")
        .values({
          digest: digestScormToken(sessionToken),
          attemptId: launch.attemptId,
          expiresAt: sessionExpiresAt,
          revokedAt: null,
          createdAt: now,
        })
        .execute();
      await transaction
        .updateTable("scorm_attempt")
        .set({
          status: "in_progress",
          lessonStatus: "incomplete",
          startedAt: sql<Date>`coalesce("startedAt", ${now})`,
          lastActivityAt: now,
          updatedAt: now,
        })
        .where("id", "=", launch.attemptId)
        .where("status", "=", "not_started")
        .execute();
      return {
        attemptId: launch.attemptId,
        sessionToken,
        sessionExpiresAt,
      };
    });
}

function sessionIsAvailable(session: {
  expiresAt: Date;
  revokedAt: Date | null;
  enrollmentId: string | null;
  enrollmentStatus: string | null;
  enrollmentExpiresAt: Date | null;
  removedAt: Date | null;
  eventParticipationId: string | null;
  occurrenceStatus: string | null;
}): boolean {
  return (
    !session.revokedAt &&
    session.expiresAt > new Date() &&
    attemptContextAvailable(session)
  );
}

export interface AuthorizedScormPlayer {
  contentPrefix: string;
  launchPath: string;
  state: {
    attemptId: string;
    entry: "ab-initio" | "resume";
    learnerId: string;
    learnerName: string;
    lessonStatus: ScormProgressInput["lessonStatus"];
    location: string;
    scoreMax: number | null;
    scoreMin: number | null;
    scoreRaw: number | null;
    suspendData: string;
    totalTimeSeconds: number;
  };
}

export async function findAuthorizedScormPlayer(
  attemptId: string,
  sessionToken: string,
): Promise<AuthorizedScormPlayer | null> {
  const row = await getDatabase()
    .selectFrom("scorm_attempt_session")
    .innerJoin(
      "scorm_attempt",
      "scorm_attempt.id",
      "scorm_attempt_session.attemptId",
    )
    .innerJoin(
      "scorm_attempt_context as context",
      "context.attemptId",
      "scorm_attempt.id",
    )
    .innerJoin("user", "user.id", "context.userId")
    .innerJoin(
      "scorm_package_version",
      "scorm_package_version.id",
      "scorm_attempt.scormPackageVersionId",
    )
    .select([
      "scorm_attempt_session.expiresAt",
      "scorm_attempt_session.revokedAt",
      "context.enrollmentId",
      "context.enrollmentStatus",
      "context.enrollmentExpiresAt",
      "context.removedAt",
      "context.eventParticipationId",
      "context.occurrenceStatus",
      "scorm_attempt.id as attemptId",
      "scorm_attempt.lessonStatus",
      "scorm_attempt.location",
      "scorm_attempt.suspendData",
      "scorm_attempt.scoreRaw",
      "scorm_attempt.scoreMin",
      "scorm_attempt.scoreMax",
      "scorm_attempt.totalTimeSeconds",
      "user.id as learnerId",
      "user.name as learnerName",
      "scorm_package_version.status as packageStatus",
      "scorm_package_version.contentPrefix",
      "scorm_package_version.launchPath",
    ])
    .where("scorm_attempt_session.digest", "=", digestScormToken(sessionToken))
    .where("scorm_attempt_session.attemptId", "=", attemptId)
    .executeTakeFirst();
  if (!row || !sessionIsAvailable(row) || row.packageStatus !== "ready")
    return null;
  return {
    contentPrefix: row.contentPrefix,
    launchPath: row.launchPath,
    state: {
      attemptId: row.attemptId,
      entry:
        row.location || row.suspendData || row.totalTimeSeconds > 0
          ? "resume"
          : "ab-initio",
      learnerId: row.learnerId,
      learnerName: row.learnerName,
      lessonStatus: row.lessonStatus,
      location: row.location,
      scoreMax: row.scoreMax,
      scoreMin: row.scoreMin,
      scoreRaw: row.scoreRaw,
      suspendData: row.suspendData,
      totalTimeSeconds: row.totalTimeSeconds,
    },
  };
}

export async function authorizeScormAttemptSession(
  attemptId: string,
  sessionToken: string,
): Promise<boolean> {
  const session = await getDatabase()
    .selectFrom("scorm_attempt_session")
    .innerJoin(
      "scorm_attempt",
      "scorm_attempt.id",
      "scorm_attempt_session.attemptId",
    )
    .innerJoin(
      "scorm_attempt_context as context",
      "context.attemptId",
      "scorm_attempt.id",
    )
    .select([
      "scorm_attempt_session.expiresAt",
      "scorm_attempt_session.revokedAt",
      "context.enrollmentId",
      "context.enrollmentStatus",
      "context.enrollmentExpiresAt",
      "context.removedAt",
      "context.eventParticipationId",
      "context.occurrenceStatus",
    ])
    .where("scorm_attempt_session.digest", "=", digestScormToken(sessionToken))
    .where("scorm_attempt_session.attemptId", "=", attemptId)
    .executeTakeFirst();
  return Boolean(session && sessionIsAvailable(session));
}

export async function recordScormProgress(
  attemptId: string,
  sessionToken: string,
  input: ScormProgressInput,
): Promise<"updated" | "completed" | "unauthorized"> {
  const progress = scormProgressInputSchema.parse(input);
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const session = await transaction
        .selectFrom("scorm_attempt_session")
        .innerJoin(
          "scorm_attempt",
          "scorm_attempt.id",
          "scorm_attempt_session.attemptId",
        )
        .innerJoin(
          "scorm_attempt_context as context",
          "context.attemptId",
          "scorm_attempt.id",
        )
        .select([
          "scorm_attempt_session.expiresAt",
          "scorm_attempt_session.revokedAt",
          "context.enrollmentId",
          "context.eventParticipationId",
          "scorm_attempt.eventTemplateVersionItemId",
          "scorm_attempt.status as attemptStatus",
          "context.enrollmentStatus",
          "context.enrollmentExpiresAt",
          "context.removedAt",
          "context.occurrenceStatus",
        ])
        .where(
          "scorm_attempt_session.digest",
          "=",
          digestScormToken(sessionToken),
        )
        .where("scorm_attempt_session.attemptId", "=", attemptId)
        .forUpdate("scorm_attempt_session")
        .executeTakeFirst();
      if (!session || !sessionIsAvailable(session)) return "unauthorized";
      const completed =
        progress.lessonStatus === "completed" ||
        progress.lessonStatus === "passed";
      if (session.attemptStatus === "completed" && !completed)
        return "completed";

      const now = new Date();
      await transaction
        .updateTable("scorm_attempt")
        .set({
          status: completed ? "completed" : "in_progress",
          lessonStatus: progress.lessonStatus,
          location: progress.location,
          suspendData: progress.suspendData,
          scoreRaw: progress.scoreRaw,
          scoreMin: progress.scoreMin,
          scoreMax: progress.scoreMax,
          totalTimeSeconds: progress.totalTimeSeconds,
          lastActivityAt: now,
          completedAt: completed
            ? sql<Date>`coalesce("completedAt", ${now})`
            : null,
          updatedAt: now,
        })
        .where("id", "=", attemptId)
        .executeTakeFirstOrThrow();
      if (completed) {
        if (session.enrollmentId) {
          const enrollment = await transaction
            .selectFrom("enrollment")
            .select("courseVersionId")
            .where("id", "=", session.enrollmentId)
            .executeTakeFirstOrThrow();
          await completeEnrollmentIfReady(
            transaction,
            {
              enrollmentId: session.enrollmentId,
              courseVersionId: enrollment.courseVersionId,
              source: "scorm",
            },
            now,
          );
        } else if (
          session.eventParticipationId &&
          session.eventTemplateVersionItemId
        ) {
          await transaction
            .insertInto("learning_item_progress")
            .values({
              id: `learning_progress_${randomUUID()}`,
              enrollmentId: null,
              courseVersionItemId: null,
              eventParticipationId: session.eventParticipationId,
              eventTemplateVersionItemId: session.eventTemplateVersionItemId,
              state: "completed",
              completedAt: now,
              updatedAt: now,
            })
            .onConflict((conflict) =>
              conflict
                .columns(["eventParticipationId", "eventTemplateVersionItemId"])
                .where("eventParticipationId", "is not", null)
                .doUpdateSet({ state: "completed", updatedAt: now }),
            )
            .execute();
          await completeEventParticipationIfReady(
            transaction,
            session.eventParticipationId,
            now,
          );
        }
      }
      return completed ? "completed" : "updated";
    });
}
