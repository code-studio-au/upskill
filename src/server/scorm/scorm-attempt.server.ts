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
        .forUpdate()
        .executeTakeFirst();
      if (!enrollment) return { status: "not-found" } as const;
      if (!accessAvailable(enrollment))
        return { status: "unavailable" } as const;

      const content = courseContentSchema.parse(enrollment.content);
      if (!content.modules[modulePosition])
        return { status: "not-found" } as const;

      const packageVersion = await transaction
        .selectFrom("course_version_module")
        .innerJoin(
          "scorm_package_version",
          "scorm_package_version.id",
          "course_version_module.scormPackageVersionId",
        )
        .select(["scorm_package_version.id", "scorm_package_version.status"])
        .where(
          "course_version_module.courseVersionId",
          "=",
          enrollment.courseVersionId,
        )
        .where("course_version_module.position", "=", modulePosition)
        .executeTakeFirst();
      if (!packageVersion || packageVersion.status !== "ready")
        return { status: "unavailable" } as const;

      let attempt = await transaction
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
          expiresAt: new Date(now.getTime() + LAUNCH_TOKEN_LIFETIME_MS),
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
        .innerJoin("enrollment", "enrollment.id", "scorm_attempt.enrollmentId")
        .select([
          "scorm_launch_token.attemptId",
          "scorm_launch_token.expiresAt as launchExpiresAt",
          "scorm_launch_token.consumedAt",
          "enrollment.status as enrollmentStatus",
          "enrollment.expiresAt as enrollmentExpiresAt",
          "enrollment.removedAt",
        ])
        .where("scorm_launch_token.digest", "=", digestScormToken(token))
        .forUpdate()
        .executeTakeFirst();
      if (
        !launch ||
        launch.consumedAt ||
        launch.launchExpiresAt <= now ||
        !accessAvailable({
          status: launch.enrollmentStatus,
          expiresAt: launch.enrollmentExpiresAt,
          removedAt: launch.removedAt,
        })
      ) {
        return null;
      }

      const sessionToken = opaqueToken();
      const maximumSessionExpiry = new Date(
        now.getTime() + ATTEMPT_SESSION_LIFETIME_MS,
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
  enrollmentStatus: string;
  enrollmentExpiresAt: Date | null;
  removedAt: Date | null;
}): boolean {
  return (
    !session.revokedAt &&
    session.expiresAt > new Date() &&
    accessAvailable({
      status: session.enrollmentStatus,
      expiresAt: session.enrollmentExpiresAt,
      removedAt: session.removedAt,
    })
  );
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
    .innerJoin("enrollment", "enrollment.id", "scorm_attempt.enrollmentId")
    .select([
      "scorm_attempt_session.expiresAt",
      "scorm_attempt_session.revokedAt",
      "enrollment.status as enrollmentStatus",
      "enrollment.expiresAt as enrollmentExpiresAt",
      "enrollment.removedAt",
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
        .innerJoin("enrollment", "enrollment.id", "scorm_attempt.enrollmentId")
        .select([
          "scorm_attempt_session.expiresAt",
          "scorm_attempt_session.revokedAt",
          "scorm_attempt.enrollmentId",
          "scorm_attempt.status as attemptStatus",
          "enrollment.courseVersionId",
          "enrollment.status as enrollmentStatus",
          "enrollment.expiresAt as enrollmentExpiresAt",
          "enrollment.removedAt",
        ])
        .where(
          "scorm_attempt_session.digest",
          "=",
          digestScormToken(sessionToken),
        )
        .where("scorm_attempt_session.attemptId", "=", attemptId)
        .forUpdate()
        .executeTakeFirst();
      if (!session || !sessionIsAvailable(session)) return "unauthorized";
      if (session.attemptStatus === "completed") return "completed";

      const now = new Date();
      const completed =
        progress.lessonStatus === "completed" ||
        progress.lessonStatus === "passed";
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
          completedAt: completed ? now : null,
          updatedAt: now,
        })
        .where("id", "=", attemptId)
        .executeTakeFirstOrThrow();
      if (completed) {
        await completeEnrollmentIfReady(
          transaction,
          {
            enrollmentId: session.enrollmentId,
            courseVersionId: session.courseVersionId,
            source: "scorm",
          },
          now,
        );
      }
      return completed ? "completed" : "updated";
    });
}
