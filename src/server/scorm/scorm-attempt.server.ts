import "@tanstack/react-start/server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "kysely";
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
  lockExistingScormAttempt,
  lockOrCreateScormAttempt,
  resolveScormLaunchPolicy,
  type ScormLaunchTarget,
} from "#/server/scorm/scorm-launch-policy.server";
import { addElapsedMilliseconds } from "#/server/time/time.server";

const LAUNCH_TOKEN_LIFETIME_MS = 5 * 60 * 1_000;
const ATTEMPT_SESSION_LIFETIME_MS = 8 * 60 * 60 * 1_000;

function opaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

function digestScormToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function courseAccessAvailable(
  enrollment: {
    status: string;
    expiresAt: Date | null;
    removedAt: Date | null;
  },
  now = new Date(),
): boolean {
  return (
    !enrollment.removedAt &&
    enrollment.status !== "cancelled" &&
    enrollment.status !== "expired" &&
    (!enrollment.expiresAt || enrollment.expiresAt > now)
  );
}

function attemptContextAvailable(context: {
  enrollmentId: string | null;
  enrollmentStatus: string | null;
  enrollmentExpiresAt: Date | null;
  removedAt: Date | null;
  eventParticipationId: string | null;
  occurrenceStatus: string | null;
  participationMode: string | null;
  registrationStatus: string | null;
}): boolean {
  if (context.enrollmentId)
    return (
      context.enrollmentStatus !== null &&
      courseAccessAvailable({
        status: context.enrollmentStatus,
        expiresAt: context.enrollmentExpiresAt,
        removedAt: context.removedAt,
      })
    );
  return Boolean(
    context.eventParticipationId &&
    context.occurrenceStatus &&
    !["cancelled", "archived"].includes(context.occurrenceStatus) &&
    (context.participationMode === "open_entry" ||
      context.registrationStatus === "selected"),
  );
}

async function createOnlineScormLaunch(
  target: ScormLaunchTarget,
  user: AuthenticatedUser,
): Promise<Exclude<ScormLaunchResult, { status: "unauthenticated" }>> {
  let launchedAttemptId: string | undefined;
  const result = await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const now = new Date();
      const policy = await resolveScormLaunchPolicy(
        transaction,
        target,
        user.id,
        now,
      );
      if (policy.status === "denied") {
        if (policy.reason !== "not-found") {
          const existingAttempt = await lockExistingScormAttempt(
            transaction,
            target,
          );
          if (existingAttempt?.writerMode === "offline")
            return { status: "offline-writer-active" } as const;
        }
        return {
          status: policy.reason === "not-found" ? "not-found" : "unavailable",
        } as const;
      }
      const attempt = await lockOrCreateScormAttempt(transaction, policy);
      if (attempt.writerMode === "offline")
        return { status: "offline-writer-active" } as const;

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
          credentialGeneration: attempt.credentialGeneration,
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
        ...(target.kind === "course"
          ? { enrollmentId: target.enrollmentId }
          : { eventParticipationId: target.eventParticipationId }),
      },
    });
  return result;
}

export async function createScormLaunch(
  enrollmentId: string,
  modulePosition: number,
  user: AuthenticatedUser,
): Promise<Exclude<ScormLaunchResult, { status: "unauthenticated" }>> {
  return await createOnlineScormLaunch(
    { kind: "course", enrollmentId, modulePosition },
    user,
  );
}

export async function createEventScormLaunch(
  eventParticipationId: string,
  eventTemplateVersionItemId: string,
  user: AuthenticatedUser,
): Promise<Exclude<ScormLaunchResult, { status: "unauthenticated" }>> {
  return await createOnlineScormLaunch(
    {
      kind: "event",
      eventParticipationId,
      eventTemplateVersionItemId,
    },
    user,
  );
}

export interface ScormLaunchExchange {
  attemptId: string;
  sessionToken: string;
  sessionExpiresAt: Date;
}

export async function exchangeScormLaunchToken(
  token: string,
): Promise<ScormLaunchExchange | "offline-writer-active" | null> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const now = new Date();
      const tokenDigest = digestScormToken(token);
      const tokenIdentity = await transaction
        .selectFrom("scorm_launch_token")
        .select("attemptId")
        .where("digest", "=", tokenDigest)
        .executeTakeFirst();
      if (!tokenIdentity) return null;

      const attempt = await transaction
        .selectFrom("scorm_attempt")
        .select(["writerMode", "credentialGeneration"])
        .where("id", "=", tokenIdentity.attemptId)
        .forUpdate()
        .executeTakeFirst();
      if (!attempt) return null;
      const launch = await transaction
        .selectFrom("scorm_launch_token")
        .innerJoin(
          "scorm_attempt_context as context",
          "context.attemptId",
          "scorm_launch_token.attemptId",
        )
        .select([
          "scorm_launch_token.attemptId",
          "scorm_launch_token.credentialGeneration",
          "scorm_launch_token.expiresAt as launchExpiresAt",
          "scorm_launch_token.consumedAt",
          "context.enrollmentId",
          "context.enrollmentStatus",
          "context.enrollmentExpiresAt",
          "context.removedAt",
          "context.eventParticipationId",
          "context.occurrenceStatus",
          "context.participationMode",
          "context.registrationStatus",
        ])
        .where("scorm_launch_token.digest", "=", tokenDigest)
        .where("scorm_launch_token.attemptId", "=", tokenIdentity.attemptId)
        .forUpdate("scorm_launch_token")
        .executeTakeFirst();
      if (!launch || launch.consumedAt || launch.launchExpiresAt <= now) {
        return null;
      }
      if (attempt.writerMode === "offline") return "offline-writer-active";
      if (launch.credentialGeneration !== attempt.credentialGeneration)
        return null;
      if (!attemptContextAvailable(launch)) return null;

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
        .where("digest", "=", tokenDigest)
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto("scorm_attempt_session")
        .values({
          digest: digestScormToken(sessionToken),
          attemptId: launch.attemptId,
          credentialGeneration: attempt.credentialGeneration,
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
          progressRevision: sql<number>`"progressRevision" + 1`,
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
  participationMode: string | null;
  registrationStatus: string | null;
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
): Promise<AuthorizedScormPlayer | "offline-writer-active" | null> {
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
      "scorm_attempt_session.credentialGeneration as sessionCredentialGeneration",
      "context.enrollmentId",
      "context.enrollmentStatus",
      "context.enrollmentExpiresAt",
      "context.removedAt",
      "context.eventParticipationId",
      "context.occurrenceStatus",
      "context.participationMode",
      "context.registrationStatus",
      "scorm_attempt.id as attemptId",
      "scorm_attempt.writerMode",
      "scorm_attempt.credentialGeneration as attemptCredentialGeneration",
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
  if (!row || row.expiresAt <= new Date() || row.packageStatus !== "ready")
    return null;
  if (row.writerMode === "offline") return "offline-writer-active";
  if (row.sessionCredentialGeneration !== row.attemptCredentialGeneration)
    return null;
  if (!attemptContextAvailable(row)) return null;
  if (!sessionIsAvailable(row)) return null;
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
): Promise<"authorized" | "offline-writer-active" | "unauthorized"> {
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
      "scorm_attempt_session.credentialGeneration as sessionCredentialGeneration",
      "scorm_attempt.writerMode",
      "scorm_attempt.credentialGeneration as attemptCredentialGeneration",
      "context.enrollmentId",
      "context.enrollmentStatus",
      "context.enrollmentExpiresAt",
      "context.removedAt",
      "context.eventParticipationId",
      "context.occurrenceStatus",
      "context.participationMode",
      "context.registrationStatus",
    ])
    .where("scorm_attempt_session.digest", "=", digestScormToken(sessionToken))
    .where("scorm_attempt_session.attemptId", "=", attemptId)
    .executeTakeFirst();
  if (!session || session.expiresAt <= new Date()) return "unauthorized";
  if (session.writerMode === "offline") return "offline-writer-active";
  if (
    session.sessionCredentialGeneration !== session.attemptCredentialGeneration
  )
    return "unauthorized";
  if (!attemptContextAvailable(session)) return "unauthorized";
  return sessionIsAvailable(session) ? "authorized" : "unauthorized";
}

export async function recordScormProgress(
  attemptId: string,
  sessionToken: string,
  input: ScormProgressInput,
): Promise<"updated" | "completed" | "offline-writer-active" | "unauthorized"> {
  const progress = scormProgressInputSchema.parse(input);
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const attempt = await transaction
        .selectFrom("scorm_attempt")
        .select([
          "status",
          "lessonStatus",
          "location",
          "suspendData",
          "scoreRaw",
          "scoreMin",
          "scoreMax",
          "totalTimeSeconds",
          "writerMode",
          "credentialGeneration",
          "eventTemplateVersionItemId",
        ])
        .where("id", "=", attemptId)
        .forUpdate()
        .executeTakeFirst();
      if (!attempt) return "unauthorized";
      const session = await transaction
        .selectFrom("scorm_attempt_session")
        .innerJoin(
          "scorm_attempt_context as context",
          "context.attemptId",
          "scorm_attempt_session.attemptId",
        )
        .select([
          "scorm_attempt_session.expiresAt",
          "scorm_attempt_session.revokedAt",
          "scorm_attempt_session.credentialGeneration as sessionCredentialGeneration",
          "context.enrollmentId",
          "context.eventParticipationId",
          "context.enrollmentStatus",
          "context.enrollmentExpiresAt",
          "context.removedAt",
          "context.occurrenceStatus",
          "context.participationMode",
          "context.registrationStatus",
        ])
        .where(
          "scorm_attempt_session.digest",
          "=",
          digestScormToken(sessionToken),
        )
        .where("scorm_attempt_session.attemptId", "=", attemptId)
        .forUpdate("scorm_attempt_session")
        .executeTakeFirst();
      if (!session || session.expiresAt <= new Date()) return "unauthorized";
      if (attempt.writerMode === "offline") return "offline-writer-active";
      if (session.sessionCredentialGeneration !== attempt.credentialGeneration)
        return "unauthorized";
      if (!attemptContextAvailable(session)) return "unauthorized";
      if (!sessionIsAvailable(session)) return "unauthorized";
      const completed =
        progress.lessonStatus === "completed" ||
        progress.lessonStatus === "passed";
      if (attempt.status === "completed" && !completed) return "completed";

      const now = new Date();
      const nextStatus = completed ? "completed" : "in_progress";
      const materiallyChanged =
        attempt.status !== nextStatus ||
        attempt.lessonStatus !== progress.lessonStatus ||
        attempt.location !== progress.location ||
        attempt.suspendData !== progress.suspendData ||
        attempt.scoreRaw !== progress.scoreRaw ||
        attempt.scoreMin !== progress.scoreMin ||
        attempt.scoreMax !== progress.scoreMax ||
        attempt.totalTimeSeconds !== progress.totalTimeSeconds;
      await transaction
        .updateTable("scorm_attempt")
        .set({
          status: nextStatus,
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
          progressRevision: materiallyChanged
            ? sql<number>`"progressRevision" + 1`
            : sql<number>`"progressRevision"`,
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
          attempt.eventTemplateVersionItemId
        ) {
          await transaction
            .insertInto("learning_item_progress")
            .values({
              id: `learning_progress_${randomUUID()}`,
              enrollmentId: null,
              courseVersionItemId: null,
              eventParticipationId: session.eventParticipationId,
              eventTemplateVersionItemId: attempt.eventTemplateVersionItemId,
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
            {
              eventParticipationId: session.eventParticipationId,
              source: "scorm",
            },
            now,
          );
        }
      }
      return completed ? "completed" : "updated";
    });
}
