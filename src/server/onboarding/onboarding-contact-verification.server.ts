import "@tanstack/react-start/server-only";

import {
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import { normalizeInternationalPhone } from "#/features/profile/phone-number";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { getServerEnv } from "#/server/env.server";
import { logServerEvent } from "#/server/logging/server-logger";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import {
  isAmbiguousEmailDeliveryError,
  sendOnboardingVerificationEmail,
} from "#/server/notifications/email-provider.server";
import { enqueuePhoneVerificationTransferredNotification } from "#/server/notifications/notification.server";
import {
  isAmbiguousSmsDeliveryError,
  sendOnboardingVerificationSms,
} from "#/server/notifications/sms-provider.server";

const CHALLENGE_LIFETIME_MS = 10 * 60_000;
const RATE_LIMIT_WINDOW_MS = 15 * 60_000;
const DEVELOPMENT_COOKIE = "upskill_onboarding_challenge";
const SECURE_COOKIE = "__Host-upskill_onboarding_challenge";

type VerificationChannel = "email" | "sms";

async function claimVerifiedPhone(
  transaction: Transaction<Database>,
  input: {
    userId: string;
    challengeId: string;
    phone: string;
    verifiedAt: Date;
  },
): Promise<boolean> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${input.phone}, 0))`.execute(
    transaction,
  );
  const recipients = await transaction
    .selectFrom("user")
    .select(["id", "name", "email", "phone", "smsVerifiedAt"])
    .where("phone", "=", input.phone)
    .orderBy("id")
    .forUpdate()
    .execute();
  const claimant = recipients.find(
    (recipient) => recipient.id === input.userId,
  );
  if (
    !claimant ||
    normalizeInternationalPhone(claimant.phone ?? "") !== input.phone
  )
    return false;
  const displaced = recipients.filter(
    (recipient) =>
      recipient.id !== input.userId && recipient.smsVerifiedAt !== null,
  );
  const activeClaims = await transaction
    .selectFrom("phone_verification_claim")
    .select(["id", "userId"])
    .where("phone", "=", input.phone)
    .where("releasedAt", "is", null)
    .forUpdate()
    .execute();
  for (const claim of activeClaims)
    await transaction
      .updateTable("phone_verification_claim")
      .set({
        releasedAt: input.verifiedAt,
        releaseReason:
          claim.userId === input.userId ? "reverified" : "transferred",
      })
      .where("id", "=", claim.id)
      .execute();
  const displacedIds = displaced.map((recipient) => recipient.id);
  if (displacedIds.length > 0) {
    await transaction
      .updateTable("user")
      .set({ smsVerifiedAt: null, updatedAt: input.verifiedAt })
      .where("id", "in", displacedIds)
      .execute();
    await transaction
      .updateTable("onboarding_contact_verification_challenge")
      .set({ consumedAt: input.verifiedAt })
      .where("userId", "in", displacedIds)
      .where("channel", "=", "sms")
      .where("consumedAt", "is", null)
      .execute();
    const displacedRecoveryChallenges = transaction
      .selectFrom("event_prerequisite_recovery_challenge")
      .select("id")
      .where("userId", "in", displacedIds)
      .where("deliveryChannel", "=", "sms");
    await transaction
      .updateTable("event_prerequisite_task_session")
      .set({ revokedAt: input.verifiedAt })
      .where("challengeId", "in", displacedRecoveryChallenges)
      .where("revokedAt", "is", null)
      .execute();
    await transaction
      .updateTable("event_prerequisite_recovery_challenge")
      .set({ consumedAt: input.verifiedAt })
      .where("userId", "in", displacedIds)
      .where("deliveryChannel", "=", "sms")
      .where("consumedAt", "is", null)
      .execute();
  }
  const claimId = `phone_claim_${randomUUID()}`;
  await transaction
    .insertInto("phone_verification_claim")
    .values({
      id: claimId,
      phone: input.phone,
      userId: input.userId,
      verificationChallengeId: input.challengeId,
      claimedAt: input.verifiedAt,
      releasedAt: null,
      releaseReason: null,
      createdAt: input.verifiedAt,
    })
    .execute();
  await transaction
    .updateTable("user")
    .set({ smsVerifiedAt: input.verifiedAt, updatedAt: input.verifiedAt })
    .where("id", "=", input.userId)
    .execute();
  const environment = getServerEnv();
  for (const recipient of displaced) {
    await enqueuePhoneVerificationTransferredNotification(transaction, {
      userId: recipient.id,
      name: recipient.name,
      email: recipient.email,
      challengeId: input.challengeId,
      phoneLastFour: input.phone.slice(-4),
      profileUrl: new URL("/profile", environment.APP_ORIGIN).toString(),
      supportEmail: environment.SUPPORT_EMAIL,
      createdAt: input.verifiedAt,
    });
    await recordDurableAuditEvent(transaction, {
      actorUserId: input.userId,
      action: "user.phone_verification_transferred",
      subjectType: "user",
      subjectId: recipient.id,
      aggregateId: recipient.id,
      reasonCode: "verified_by_another_account",
      metadata: { phoneLastFour: input.phone.slice(-4), claimId },
      createdAt: input.verifiedAt,
    });
  }
  return true;
}

function secretDigest(value: string): string {
  return createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET)
    .update(value)
    .digest("base64url");
}

function codeMatches(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

function normalizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase("en-AU");
}

function cookieName(): string {
  const { APP_ENV } = getServerEnv();
  return APP_ENV === "production" || APP_ENV === "staging"
    ? SECURE_COOKIE
    : DEVELOPMENT_COOKIE;
}

export function onboardingVerificationChallengeCookie(
  reference: string,
): string {
  const { APP_ENV } = getServerEnv();
  const secure = APP_ENV === "production" || APP_ENV === "staging";
  return [
    `${cookieName()}=${reference}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${String(CHALLENGE_LIFETIME_MS / 1_000)}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearOnboardingVerificationChallengeCookie(): string {
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

export function readOnboardingVerificationChallengeCookie(
  request: Request,
): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const pair of cookie.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() !== cookieName()) continue;
    const reference = pair.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{32}$/u.test(reference) ? reference : null;
  }
  return null;
}

export async function findOnboardingContactVerification(
  database: Kysely<Database> | Transaction<Database>,
  userId: string,
) {
  const user = await database
    .selectFrom("user")
    .select([
      "email",
      "emailEnabled",
      "emailVerified",
      "phone",
      "smsEnabled",
      "smsVerifiedAt",
    ])
    .where("id", "=", userId)
    .executeTakeFirstOrThrow();
  return {
    email: {
      enabled: user.emailEnabled,
      verified: user.emailVerified,
      destination: normalizeEmail(user.email),
    },
    sms: {
      enabled: user.smsEnabled,
      verified: user.smsVerifiedAt !== null,
      destination: user.phone,
    },
  };
}

export async function onboardingContactVerificationIsRequired(
  database: Kysely<Database> | Transaction<Database>,
  assignmentId: string,
): Promise<boolean> {
  return await database
    .selectFrom("onboarding_assignment as assignment")
    .innerJoin(
      "onboarding_definition_version as definition",
      "definition.id",
      "assignment.definitionVersionId",
    )
    .select("definition.contactVerificationRequired")
    .where("assignment.id", "=", assignmentId)
    .executeTakeFirstOrThrow()
    .then((row) => row.contactVerificationRequired);
}

export async function completeOnboardingIfVerified(
  transaction: Transaction<Database>,
  assignmentId: string,
  userId: string,
  now: Date,
): Promise<boolean> {
  const verification = await findOnboardingContactVerification(
    transaction,
    userId,
  );
  const pending =
    (verification.email.enabled && !verification.email.verified) ||
    (verification.sms.enabled && !verification.sms.verified);
  if (pending) return false;
  const completed = await transaction
    .updateTable("onboarding_assignment")
    .set({ status: "completed", completedAt: now })
    .where("id", "=", assignmentId)
    .where("userId", "=", userId)
    .where("status", "=", "in_progress")
    .returning("id")
    .executeTakeFirst();
  return Boolean(completed);
}

function destinationForChannel(
  channel: VerificationChannel,
  user: {
    email: string;
    emailEnabled: boolean;
    emailVerified: boolean;
    phone: string | null;
    smsEnabled: boolean;
    smsVerifiedAt: Date | null;
  },
): { destination: string; verified: boolean } | null {
  if (channel === "email")
    return user.emailEnabled
      ? {
          destination: normalizeEmail(user.email),
          verified: user.emailVerified,
        }
      : null;
  if (!user.smsEnabled || !user.phone) return null;
  const phone = normalizeInternationalPhone(user.phone);
  return phone
    ? { destination: phone, verified: user.smsVerifiedAt !== null }
    : null;
}

export async function requestOnboardingContactVerification(
  input: { assignmentId: string; channel: VerificationChannel },
  user: AuthenticatedUser,
): Promise<
  | { status: "sent"; challengeReference: string }
  | { status: "verified" | "unavailable" | "rate-limited" }
> {
  const database = getDatabase();
  const row = await database
    .selectFrom("onboarding_assignment as assignment")
    .innerJoin(
      "onboarding_response as response",
      "response.assignmentId",
      "assignment.id",
    )
    .innerJoin("user", "user.id", "assignment.userId")
    .select([
      "user.name",
      "user.email",
      "user.emailEnabled",
      "user.emailVerified",
      "user.phone",
      "user.smsEnabled",
      "user.smsVerifiedAt",
      "assignment.status",
      "response.submittedAt",
    ])
    .where("assignment.id", "=", input.assignmentId)
    .where("assignment.userId", "=", user.id)
    .executeTakeFirst();
  if (!row || row.status !== "in_progress" || !row.submittedAt)
    return { status: "unavailable" };
  const channel = destinationForChannel(input.channel, row);
  if (!channel) return { status: "unavailable" };
  if (channel.verified) return { status: "verified" };
  const recent = await database
    .selectFrom("onboarding_contact_verification_challenge")
    .select((expression) => expression.fn.countAll<string>().as("count"))
    .where("assignmentId", "=", input.assignmentId)
    .where("channel", "=", input.channel)
    .where("createdAt", ">", new Date(Date.now() - RATE_LIMIT_WINDOW_MS))
    .executeTakeFirstOrThrow();
  if (Number(recent.count) >= 3) return { status: "rate-limited" };

  const now = new Date();
  const challengeId = `onboarding_verification_${randomUUID()}`;
  const challengeReference = randomBytes(24).toString("base64url");
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await database.transaction().execute(async (transaction) => {
    await transaction
      .updateTable("onboarding_contact_verification_challenge")
      .set({ consumedAt: now })
      .where("assignmentId", "=", input.assignmentId)
      .where("channel", "=", input.channel)
      .where("consumedAt", "is", null)
      .execute();
    await transaction
      .insertInto("onboarding_contact_verification_challenge")
      .values({
        id: challengeId,
        reference: challengeReference,
        assignmentId: input.assignmentId,
        userId: user.id,
        channel: input.channel,
        destinationDigest: secretDigest(
          `${input.channel}:${channel.destination}`,
        ),
        codeDigest: secretDigest(`code:${challengeId}:${code}`),
        attempts: 0,
        expiresAt: new Date(now.getTime() + CHALLENGE_LIFETIME_MS),
        consumedAt: null,
        createdAt: now,
      })
      .execute();
  });
  try {
    if (input.channel === "email") {
      const subject = "Verify your Upskill email";
      const textBody = `Your Upskill email verification code is ${code}. It expires in 10 minutes.`;
      await sendOnboardingVerificationEmail(database, {
        challengeId,
        recipientEmail: channel.destination,
        subject,
        textBody,
        htmlBody: `<p>Your Upskill email verification code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`,
      });
    } else
      await sendOnboardingVerificationSms(database, {
        deliveryId: challengeId,
        recipientUserId: user.id,
        recipientName: row.name,
        recipientPhone: channel.destination,
        message: `Your Upskill mobile verification code is ${code}. It expires in 10 minutes. If you did not request this code, ignore this message.`,
      });
  } catch (error) {
    const ambiguous =
      isAmbiguousEmailDeliveryError(error) ||
      isAmbiguousSmsDeliveryError(error);
    if (!ambiguous)
      await database
        .deleteFrom("onboarding_contact_verification_challenge")
        .where("id", "=", challengeId)
        .execute();
    logServerEvent({
      level: "error",
      event: "onboarding.contact_verification_delivery_failed",
      fields: {
        entityType: "onboarding_assignment",
        entityId: input.assignmentId,
        actorUserId: user.id,
        channel: input.channel,
      },
    });
    if (!ambiguous) return { status: "unavailable" };
  }
  return { status: "sent", challengeReference };
}

export async function verifyOnboardingContactCode(
  input: {
    assignmentId: string;
    challengeReference: string;
    code: string;
  },
  user: AuthenticatedUser,
): Promise<{
  status: "verified" | "invalid" | "expired" | "rate-limited";
  complete?: boolean;
}> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const challenge = await transaction
        .selectFrom("onboarding_contact_verification_challenge as challenge")
        .innerJoin(
          "onboarding_assignment as assignment",
          "assignment.id",
          "challenge.assignmentId",
        )
        .innerJoin(
          "onboarding_response as response",
          "response.assignmentId",
          "assignment.id",
        )
        .innerJoin("user", "user.id", "challenge.userId")
        .select([
          "challenge.id",
          "challenge.channel",
          "challenge.destinationDigest",
          "challenge.codeDigest",
          "challenge.attempts",
          "challenge.expiresAt",
          "challenge.consumedAt",
          "assignment.status",
          "response.submittedAt",
          "user.email",
          "user.emailEnabled",
          "user.emailVerified",
          "user.phone",
          "user.smsEnabled",
          "user.smsVerifiedAt",
        ])
        .where("challenge.reference", "=", input.challengeReference)
        .where("challenge.assignmentId", "=", input.assignmentId)
        .where("challenge.userId", "=", user.id)
        .forUpdate(["challenge", "assignment"])
        .executeTakeFirst();
      if (!challenge) return { status: "invalid" };
      const now = new Date();
      const channel = destinationForChannel(challenge.channel, challenge);
      if (
        challenge.consumedAt ||
        challenge.expiresAt <= now ||
        challenge.status !== "in_progress" ||
        !challenge.submittedAt ||
        !channel ||
        secretDigest(`${challenge.channel}:${channel.destination}`) !==
          challenge.destinationDigest
      )
        return { status: "expired" };
      if (challenge.attempts >= 5) return { status: "rate-limited" };
      const attempts = challenge.attempts + 1;
      if (
        !codeMatches(
          challenge.codeDigest,
          secretDigest(`code:${challenge.id}:${input.code}`),
        )
      ) {
        await transaction
          .updateTable("onboarding_contact_verification_challenge")
          .set({ attempts })
          .where("id", "=", challenge.id)
          .execute();
        return attempts >= 5
          ? { status: "rate-limited" }
          : { status: "invalid" };
      }
      if (
        challenge.channel === "sms" &&
        !(await claimVerifiedPhone(transaction, {
          userId: user.id,
          challengeId: challenge.id,
          phone: channel.destination,
          verifiedAt: now,
        }))
      )
        return { status: "expired" };
      await transaction
        .updateTable("onboarding_contact_verification_challenge")
        .set({ attempts, consumedAt: now })
        .where("id", "=", challenge.id)
        .execute();
      if (challenge.channel === "email")
        await transaction
          .updateTable("user")
          .set({ emailVerified: true, emailVerifiedAt: now, updatedAt: now })
          .where("id", "=", user.id)
          .execute();
      const complete = await completeOnboardingIfVerified(
        transaction,
        input.assignmentId,
        user.id,
        now,
      );
      logServerEvent({
        level: "info",
        event: "onboarding.contact_verified",
        fields: {
          entityType: "onboarding_assignment",
          entityId: input.assignmentId,
          actorUserId: user.id,
          channel: challenge.channel,
        },
      });
      return { status: "verified", complete };
    });
}

export async function skipOnboardingContactVerification(
  assignmentId: string,
  user: AuthenticatedUser,
): Promise<"skipped" | "unavailable"> {
  const now = new Date();
  const database = getDatabase();
  const assignment = await database
    .selectFrom("onboarding_assignment as assignment")
    .innerJoin(
      "onboarding_definition_version as definition",
      "definition.id",
      "assignment.definitionVersionId",
    )
    .innerJoin(
      "onboarding_response as response",
      "response.assignmentId",
      "assignment.id",
    )
    .select("assignment.id")
    .where("assignment.id", "=", assignmentId)
    .where("assignment.userId", "=", user.id)
    .where("assignment.status", "=", "in_progress")
    .where("response.submittedAt", "is not", null)
    .where("definition.contactVerificationRequired", "=", false)
    .executeTakeFirst();
  if (!assignment) return "unavailable";
  const completed = await database
    .updateTable("onboarding_assignment")
    .set({
      status: "completed",
      completedAt: now,
      verificationSkippedAt: now,
    })
    .where("id", "=", assignmentId)
    .where("userId", "=", user.id)
    .where("status", "=", "in_progress")
    .returning("id")
    .executeTakeFirst();
  if (!completed) return "unavailable";
  logServerEvent({
    level: "info",
    event: "onboarding.contact_verification_skipped",
    fields: {
      entityType: "onboarding_assignment",
      entityId: assignmentId,
      actorUserId: user.id,
    },
  });
  return "skipped";
}
