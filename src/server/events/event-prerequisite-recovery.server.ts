import "@tanstack/react-start/server-only";

import {
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { sql, type Kysely, type Transaction } from "kysely";
import type {
  EventRecoveryLandingResult,
  EventRecoveryRequestResult,
  EventRecoveryVerificationResult,
} from "#/features/event-recovery/event-recovery.schema";
import { normalizeInternationalPhone } from "#/features/profile/phone-number";
import {
  consumeFixedWindowRateLimit,
  forwardedClientAddress,
  type FixedWindowRateLimitEntry,
} from "#/features/event-guest/event-guest-rate-limit";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { getServerEnv } from "#/server/env.server";
import { logServerEvent } from "#/server/logging/server-logger";
import { sendEventPrerequisiteRecoveryEmail } from "#/server/notifications/email-provider.server";
import { sendEventPrerequisiteRecoverySms } from "#/server/notifications/sms-provider.server";
import { resolveLearnerEventSurveyReference } from "./event-survey-access.server";

const CHALLENGE_LIFETIME_MS = 10 * 60_000;
const TASK_SESSION_LIFETIME_MS = 30 * 60_000;
const TASK_SESSION_IDLE_MS = 10 * 60_000;
const RATE_LIMIT_WINDOW_MS = 15 * 60_000;
const RATE_LIMIT_MAXIMUM_ENTRIES = 20_000;
const requestLimits = new Map<string, FixedWindowRateLimitEntry>();
const DEVELOPMENT_COOKIE = "upskill_event_task";
const SECURE_COOKIE = "__Host-upskill_event_task";
const DEVELOPMENT_CHALLENGE_COOKIE = "upskill_event_challenge";
const SECURE_CHALLENGE_COOKIE = "__Host-upskill_event_challenge";

function secretDigest(value: string): string {
  return createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET)
    .update(value)
    .digest("base64url");
}

function opaqueReference(): string {
  return randomBytes(24).toString("base64url");
}

function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase("en-AU");
}

function cookieName(): string {
  const { APP_ENV } = getServerEnv();
  return APP_ENV === "production" || APP_ENV === "staging"
    ? SECURE_COOKIE
    : DEVELOPMENT_COOKIE;
}

function challengeCookieName(): string {
  const { APP_ENV } = getServerEnv();
  return APP_ENV === "production" || APP_ENV === "staging"
    ? SECURE_CHALLENGE_COOKIE
    : DEVELOPMENT_CHALLENGE_COOKIE;
}

function readNamedCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const pair of cookie.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() === name)
      return pair.slice(separator + 1).trim();
  }
  return null;
}

function readCookie(headers: Headers): string | null {
  const cookie = headers.get("cookie");
  if (!cookie) return null;
  for (const pair of cookie.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() === cookieName())
      return pair.slice(separator + 1).trim();
  }
  return null;
}

export function eventTaskSessionCookie(token: string): string {
  const { APP_ENV } = getServerEnv();
  const secure = APP_ENV === "production" || APP_ENV === "staging";
  return [
    `${cookieName()}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${String(TASK_SESSION_LIFETIME_MS / 1_000)}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearEventTaskSessionCookie(): string {
  const { APP_ENV } = getServerEnv();
  const secure = APP_ENV === "production" || APP_ENV === "staging";
  return [
    `${cookieName()}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function eventRecoveryChallengeCookie(reference: string): string {
  const { APP_ENV } = getServerEnv();
  const secure = APP_ENV === "production" || APP_ENV === "staging";
  return [
    `${challengeCookieName()}=${reference}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${String(CHALLENGE_LIFETIME_MS / 1_000)}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearEventRecoveryChallengeCookie(): string {
  const { APP_ENV } = getServerEnv();
  const secure = APP_ENV === "production" || APP_ENV === "staging";
  return [
    `${challengeCookieName()}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function readEventRecoveryChallengeCookie(
  request: Request,
): string | null {
  const reference = readNamedCookie(request, challengeCookieName());
  return reference && /^[A-Za-z0-9_-]{32}$/u.test(reference) ? reference : null;
}

function requestFingerprint(publicReference: string): string {
  return secretDigest(
    `${publicReference}:${forwardedClientAddress(getRequestHeaders())}`,
  );
}

function consumeRequestLimit(
  publicReference: string,
  identifierDigest: string,
  fingerprint: string,
): boolean {
  const now = Date.now();
  const identifierAllowed = consumeFixedWindowRateLimit(
    requestLimits,
    `identifier:${publicReference}:${identifierDigest}`,
    now,
    {
      maximumEntries: RATE_LIMIT_MAXIMUM_ENTRIES,
      maximumRequests: 3,
      windowMs: RATE_LIMIT_WINDOW_MS,
    },
  );
  const connectionAllowed = consumeFixedWindowRateLimit(
    requestLimits,
    `connection:${fingerprint}`,
    now,
    {
      maximumEntries: RATE_LIMIT_MAXIMUM_ENTRIES,
      maximumRequests: 10,
      windowMs: RATE_LIMIT_WINDOW_MS,
    },
  );
  return identifierAllowed && connectionAllowed;
}

async function findPublicDestination(
  database: Kysely<Database> | Transaction<Database>,
  publicReference: string,
) {
  return await database
    .selectFrom("event_survey_access as access")
    .innerJoin(
      "event_occurrence as occurrence",
      "occurrence.id",
      "access.eventOccurrenceId",
    )
    .innerJoin(
      "event_template_version_item as item",
      "item.id",
      "access.eventTemplateVersionItemId",
    )
    .innerJoin(
      "event_template_version_section as section",
      "section.id",
      "item.sectionId",
    )
    .innerJoin(
      "learning_activity_version as activityVersion",
      "activityVersion.id",
      "item.learningActivityVersionId",
    )
    .select([
      "access.id as eventSurveyAccessId",
      "access.eventOccurrenceId",
      "access.eventTemplateVersionItemId",
      "occurrence.title as eventTitle",
      "occurrence.status as occurrenceStatus",
      "occurrence.publishedAt as occurrencePublishedAt",
      "section.title as sectionTitle",
      "item.title as surveyTitle",
      "activityVersion.publishedAt as activityPublishedAt",
    ])
    .where("access.publicReference", "=", publicReference)
    .where("access.revokedAt", "is", null)
    .where("item.kind", "=", "survey")
    .executeTakeFirst();
}

function destinationAvailable(
  destination: Awaited<ReturnType<typeof findPublicDestination>>,
): destination is NonNullable<typeof destination> {
  return Boolean(
    destination &&
    destination.occurrencePublishedAt &&
    destination.activityPublishedAt &&
    ["published", "completed"].includes(destination.occurrenceStatus),
  );
}

export interface EventTaskActor {
  accessMode: "event_task";
  eventSurveyAccessId: string;
  eventOccurrenceId: string;
  eventTemplateVersionItemId: string;
  eventParticipationId: string;
  publicReference: string;
  taskSessionId: string;
  user: AuthenticatedUser;
}

export async function findEventTaskActor(input: {
  publicReference?: string;
  eventOccurrenceId?: string;
  eventTemplateVersionItemId?: string;
  eventParticipationId?: string;
}): Promise<EventTaskActor | null> {
  const token = readCookie(getRequestHeaders());
  if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
  const now = new Date();
  const idleAfter = new Date(now.getTime() - TASK_SESSION_IDLE_MS);
  let query = getDatabase()
    .selectFrom("event_prerequisite_task_session as task")
    .innerJoin(
      "event_survey_access as access",
      "access.id",
      "task.eventSurveyAccessId",
    )
    .innerJoin("user", "user.id", "task.userId")
    .select([
      "task.id as taskSessionId",
      "task.eventSurveyAccessId",
      "task.eventParticipationId",
      "task.userId",
      "access.eventOccurrenceId",
      "access.eventTemplateVersionItemId",
      "access.publicReference",
      "user.name",
      "user.email",
      "user.emailVerified",
    ])
    .where("task.tokenDigest", "=", secretDigest(`task:${token}`))
    .where("task.expiresAt", ">", now)
    .where("task.lastUsedAt", ">", idleAfter)
    .where("task.completedAt", "is", null)
    .where("task.revokedAt", "is", null)
    .where("access.revokedAt", "is", null);
  if (input.publicReference)
    query = query.where("access.publicReference", "=", input.publicReference);
  if (input.eventOccurrenceId)
    query = query.where(
      "access.eventOccurrenceId",
      "=",
      input.eventOccurrenceId,
    );
  if (input.eventTemplateVersionItemId)
    query = query.where(
      "access.eventTemplateVersionItemId",
      "=",
      input.eventTemplateVersionItemId,
    );
  if (input.eventParticipationId)
    query = query.where(
      "task.eventParticipationId",
      "=",
      input.eventParticipationId,
    );
  const row = await query.executeTakeFirst();
  if (!row) return null;
  await getDatabase()
    .updateTable("event_prerequisite_task_session")
    .set({ lastUsedAt: now })
    .where("id", "=", row.taskSessionId)
    .where("completedAt", "is", null)
    .where("revokedAt", "is", null)
    .execute();
  return {
    accessMode: "event_task",
    eventSurveyAccessId: row.eventSurveyAccessId,
    eventOccurrenceId: row.eventOccurrenceId,
    eventTemplateVersionItemId: row.eventTemplateVersionItemId,
    eventParticipationId: row.eventParticipationId,
    publicReference: row.publicReference,
    taskSessionId: row.taskSessionId,
    user: {
      id: row.userId,
      name: row.name,
      email: normalizeEmail(row.email),
      emailVerified: row.emailVerified,
    },
  };
}

export async function resolveEventRecoveryLanding(
  publicReference: string,
  user: AuthenticatedUser | null,
): Promise<EventRecoveryLandingResult> {
  const destination = await findPublicDestination(
    getDatabase(),
    publicReference,
  );
  if (!destination) return { status: "not-found" };
  if (!destinationAvailable(destination)) return { status: "unavailable" };
  if (user) {
    const survey = await resolveLearnerEventSurveyReference(
      publicReference,
      user,
    );
    if (survey.status === "ready")
      return {
        status: "ready",
        data: {
          eventOccurrenceId: survey.eventOccurrenceId,
          eventTemplateVersionItemId: survey.eventTemplateVersionItemId,
        },
      };
    if (survey.status === "unavailable") return { status: "unavailable" };
  }
  const task = await findEventTaskActor({ publicReference });
  if (task)
    return {
      status: "ready",
      data: {
        eventOccurrenceId: task.eventOccurrenceId,
        eventTemplateVersionItemId: task.eventTemplateVersionItemId,
      },
    };
  return {
    status: "recovery-required",
    data: {
      eventTitle: destination.eventTitle,
      sectionTitle: destination.sectionTitle,
      surveyTitle: destination.surveyTitle,
    },
  };
}

function recoveryEmail(input: {
  code: string;
  eventTitle: string;
  surveyTitle: string;
}) {
  const safeEventTitle = input.eventTitle.replace(/[\r\n]+/gu, " ").trim();
  const subject = `Your Upskill access code for ${safeEventTitle}`.slice(
    0,
    180,
  );
  const textBody = [
    `Your Upskill access code is ${input.code}.`,
    "",
    `Use it to open ${input.surveyTitle} for ${input.eventTitle}.`,
    "This code expires in 10 minutes and can be used once.",
    "",
    "If you did not request this code, you can ignore this email.",
  ].join("\n");
  const htmlBody = `<p>Your Upskill access code is <strong>${input.code}</strong>.</p><p>Use it to open the requested event Survey. This code expires in 10 minutes and can be used once.</p><p>If you did not request this code, you can ignore this email.</p>`;
  return { subject, textBody, htmlBody };
}

function recoverySms(code: string): string {
  return `Your Upskill access code is ${code}. It expires in 10 minutes. If you did not request it, ignore this message.`;
}

export async function requestEventRecoveryCode(
  input: {
    publicReference: string;
    identifier: string;
  },
  requestFingerprintOverride?: string,
): Promise<EventRecoveryRequestResult> {
  const database = getDatabase();
  const normalizedPhone = normalizeInternationalPhone(input.identifier);
  const deliveryChannel = normalizedPhone
    ? ("sms" as const)
    : ("email" as const);
  const normalizedIdentifier =
    normalizedPhone ?? normalizeEmail(input.identifier);
  const identifierDigest = secretDigest(
    `${deliveryChannel}:${normalizedIdentifier}`,
  );
  const fingerprint =
    requestFingerprintOverride ?? requestFingerprint(input.publicReference);
  if (
    !consumeRequestLimit(input.publicReference, identifierDigest, fingerprint)
  )
    return { status: "rate-limited" };
  const destination = await findPublicDestination(
    database,
    input.publicReference,
  );
  if (!destinationAvailable(destination)) return { status: "unavailable" };

  const fallbackReference = opaqueReference();
  const participant = await database
    .selectFrom("event_participation as participation")
    .innerJoin("user", "user.id", "participation.userId")
    .leftJoin(
      "event_registration as registration",
      "registration.id",
      "participation.registrationId",
    )
    .select([
      "participation.id as eventParticipationId",
      "participation.userId",
      "user.name",
      "user.email",
    ])
    .where(
      "participation.eventOccurrenceId",
      "=",
      destination.eventOccurrenceId,
    )
    .where(
      deliveryChannel === "sms"
        ? sql<boolean>`
            "user"."smsEnabled" = true
            and "user"."smsVerifiedAt" is not null
            and "user".phone = ${normalizedIdentifier}
          `
        : sql<boolean>`
            "user"."emailEnabled" = true
            and "user"."emailVerified" = true
            and lower("user".email) = ${normalizedIdentifier}
          `,
    )
    .where((expression) =>
      expression.or([
        expression("participation.mode", "=", "open_entry"),
        expression("registration.status", "=", "selected"),
      ]),
    )
    .executeTakeFirst();
  if (!participant)
    return { status: "accepted", challengeReference: fallbackReference };

  const recentCount = await database
    .selectFrom("event_prerequisite_recovery_challenge")
    .select((expression) => expression.fn.countAll<string>().as("count"))
    .where("eventSurveyAccessId", "=", destination.eventSurveyAccessId)
    .where("identifierDigest", "=", identifierDigest)
    .where("createdAt", ">", new Date(Date.now() - RATE_LIMIT_WINDOW_MS))
    .executeTakeFirstOrThrow();
  if (Number(recentCount.count) >= 3) return { status: "rate-limited" };

  const now = new Date();
  const challengeId = `event_recovery_${randomUUID()}`;
  const challengeReference = opaqueReference();
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await database.transaction().execute(async (transaction) => {
    await transaction
      .updateTable("event_prerequisite_recovery_challenge")
      .set({ consumedAt: now })
      .where("eventSurveyAccessId", "=", destination.eventSurveyAccessId)
      .where("userId", "=", participant.userId)
      .where("consumedAt", "is", null)
      .execute();
    await transaction
      .insertInto("event_prerequisite_recovery_challenge")
      .values({
        id: challengeId,
        reference: challengeReference,
        eventSurveyAccessId: destination.eventSurveyAccessId,
        eventParticipationId: participant.eventParticipationId,
        userId: participant.userId,
        identifierDigest,
        deliveryChannel,
        requestFingerprint: fingerprint,
        codeDigest: secretDigest(`code:${challengeId}:${code}`),
        attempts: 0,
        expiresAt: new Date(now.getTime() + CHALLENGE_LIFETIME_MS),
        consumedAt: null,
        createdAt: now,
      })
      .execute();
  });
  try {
    if (deliveryChannel === "sms")
      await sendEventPrerequisiteRecoverySms(database, {
        deliveryId: challengeId,
        recipientUserId: participant.userId,
        recipientName: participant.name,
        recipientPhone: normalizedIdentifier,
        message: recoverySms(code),
      });
    else
      await sendEventPrerequisiteRecoveryEmail(database, {
        challengeId,
        recipientEmail: normalizeEmail(participant.email),
        ...recoveryEmail({
          code,
          eventTitle: destination.eventTitle,
          surveyTitle: destination.surveyTitle,
        }),
      });
  } catch {
    await database
      .deleteFrom("event_prerequisite_recovery_challenge")
      .where("id", "=", challengeId)
      .execute();
    logServerEvent({
      level: "error",
      event: "event_prerequisite.recovery_delivery_failed",
      fields: {
        entityType: "event_survey_access",
        entityId: destination.eventSurveyAccessId,
        outcome: "failed",
      },
    });
  }
  return { status: "accepted", challengeReference };
}

function codeMatches(storedDigest: string, candidateDigest: string): boolean {
  const stored = Buffer.from(storedDigest);
  const candidate = Buffer.from(candidateDigest);
  return (
    stored.length === candidate.length && timingSafeEqual(stored, candidate)
  );
}

export async function verifyEventRecoveryCode(input: {
  publicReference: string;
  challengeReference: string;
  code: string;
}): Promise<EventRecoveryVerificationResult & { taskSessionToken?: string }> {
  const database = getDatabase();
  return await database.transaction().execute(async (transaction) => {
    const challenge = await transaction
      .selectFrom("event_prerequisite_recovery_challenge as challenge")
      .innerJoin(
        "event_survey_access as access",
        "access.id",
        "challenge.eventSurveyAccessId",
      )
      .innerJoin(
        "event_occurrence as occurrence",
        "occurrence.id",
        "access.eventOccurrenceId",
      )
      .select([
        "challenge.id",
        "challenge.eventSurveyAccessId",
        "challenge.eventParticipationId",
        "challenge.userId",
        "challenge.codeDigest",
        "challenge.deliveryChannel",
        "challenge.attempts",
        "challenge.expiresAt",
        "challenge.consumedAt",
        "access.eventOccurrenceId",
        "access.eventTemplateVersionItemId",
        "access.revokedAt as accessRevokedAt",
        "occurrence.status as occurrenceStatus",
      ])
      .where("challenge.reference", "=", input.challengeReference)
      .where("access.publicReference", "=", input.publicReference)
      .forUpdate("challenge")
      .executeTakeFirst();
    if (!challenge) return { status: "invalid" };
    const now = new Date();
    if (
      challenge.consumedAt ||
      challenge.expiresAt <= now ||
      challenge.accessRevokedAt ||
      !["published", "completed"].includes(challenge.occurrenceStatus)
    )
      return { status: "expired" };
    if (challenge.attempts >= 5) return { status: "rate-limited" };
    const attempts = challenge.attempts + 1;
    const valid = codeMatches(
      challenge.codeDigest,
      secretDigest(`code:${challenge.id}:${input.code}`),
    );
    if (!valid) {
      await transaction
        .updateTable("event_prerequisite_recovery_challenge")
        .set({ attempts })
        .where("id", "=", challenge.id)
        .execute();
      return attempts >= 5 ? { status: "rate-limited" } : { status: "invalid" };
    }

    const token = randomBytes(32).toString("base64url");
    const taskSessionId = `event_task_${randomUUID()}`;
    await transaction
      .updateTable("event_prerequisite_recovery_challenge")
      .set({ attempts, consumedAt: now })
      .where("id", "=", challenge.id)
      .execute();
    await transaction
      .insertInto("event_prerequisite_task_session")
      .values({
        id: taskSessionId,
        challengeId: challenge.id,
        tokenDigest: secretDigest(`task:${token}`),
        eventSurveyAccessId: challenge.eventSurveyAccessId,
        eventParticipationId: challenge.eventParticipationId,
        userId: challenge.userId,
        expiresAt: new Date(now.getTime() + TASK_SESSION_LIFETIME_MS),
        lastUsedAt: now,
        completedAt: null,
        revokedAt: null,
        createdAt: now,
      })
      .execute();
    await recordDurableAuditEvent(transaction, {
      actorUserId: challenge.userId,
      action: "event_prerequisite.recovery_verified",
      subjectType: "event_prerequisite_task_session",
      subjectId: taskSessionId,
      aggregateId: challenge.eventOccurrenceId,
      metadata: {
        accessMethod: `${challenge.deliveryChannel}_otp`,
        eventSurveyAccessId: challenge.eventSurveyAccessId,
        eventTemplateVersionItemId: challenge.eventTemplateVersionItemId,
      },
      createdAt: now,
    });
    return {
      status: "ready",
      taskSessionToken: token,
      data: {
        eventOccurrenceId: challenge.eventOccurrenceId,
        eventTemplateVersionItemId: challenge.eventTemplateVersionItemId,
      },
    };
  });
}

export async function completeEventTaskSession(
  taskSessionId: string,
): Promise<void> {
  await getDatabase()
    .updateTable("event_prerequisite_task_session")
    .set({ completedAt: new Date() })
    .where("id", "=", taskSessionId)
    .where("completedAt", "is", null)
    .where("revokedAt", "is", null)
    .execute();
}
