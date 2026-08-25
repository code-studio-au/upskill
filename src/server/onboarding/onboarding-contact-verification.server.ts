import "@tanstack/react-start/server-only";

import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { Kysely, Transaction } from "kysely";
import { onboardingProfileMappingSchema } from "#/features/onboarding/onboarding.schema";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { getServerEnv } from "#/server/env.server";
import { logServerEvent } from "#/server/logging/server-logger";
import {
  isAmbiguousEmailDeliveryError,
  sendContactVerificationEmail,
} from "#/server/notifications/email-provider.server";
import {
  isAmbiguousSmsDeliveryError,
  sendContactVerificationSms,
} from "#/server/notifications/sms-provider.server";
import {
  claimVerifiedPhone,
  contactCodeMatches,
  contactDestination,
  CONTACT_CHALLENGE_LIFETIME_MS,
  CONTACT_RATE_LIMIT_WINDOW_MS,
  contactSecretDigest,
  normalizeContactEmail,
  type ContactVerificationChannel,
} from "#/server/profile/contact-verification-core.server";
import { z } from "#/validation/zod";

const DEVELOPMENT_COOKIE = "upskill_onboarding_challenge";
const SECURE_COOKIE = "__Host-upskill_onboarding_challenge";

function hasVisitedProfileMapping(
  mappingsValue: unknown,
  visitedValue: unknown,
  destination: "smsEnabled",
): boolean {
  const mappings = z
    .array(onboardingProfileMappingSchema)
    .safeParse(mappingsValue);
  const visited = new Set(
    Array.isArray(visitedValue)
      ? visitedValue.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  );
  return (
    mappings.success &&
    mappings.data.some(
      (mapping) =>
        mapping.destination === destination && visited.has(mapping.questionId),
    )
  );
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
    `Max-Age=${String(CONTACT_CHALLENGE_LIFETIME_MS / 1_000)}`,
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
      destination: normalizeContactEmail(user.email),
    },
    sms: {
      enabled: user.smsEnabled,
      verified: user.smsVerifiedAt !== null,
      destination: user.phone,
    },
  };
}

export async function completeOnboardingIfVerified(
  transaction: Transaction<Database>,
  assignmentId: string,
  userId: string,
  now: Date,
): Promise<boolean> {
  const [verification, assignment] = await Promise.all([
    findOnboardingContactVerification(transaction, userId),
    transaction
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
      .select([
        "assignment.verificationDeferredAt",
        "assignment.verificationSkippedAt",
        "definition.contactVerificationRequired",
        "response.submittedAt",
      ])
      .where("assignment.id", "=", assignmentId)
      .where("assignment.userId", "=", userId)
      .executeTakeFirst(),
  ]);
  if (!assignment?.submittedAt) return false;
  const pending =
    (verification.email.enabled && !verification.email.verified) ||
    (verification.sms.enabled && !verification.sms.verified);
  if (
    pending &&
    (assignment.contactVerificationRequired ||
      (!assignment.verificationDeferredAt && !assignment.verificationSkippedAt))
  )
    return false;
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

export async function requestOnboardingContactVerification(
  input: { assignmentId: string; channel: ContactVerificationChannel },
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
    .innerJoin(
      "onboarding_definition_version as definition",
      "definition.id",
      "assignment.definitionVersionId",
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
      "definition.profileMappings",
      "response.visitedItemIds",
      "response.submittedAt",
    ])
    .where("assignment.id", "=", input.assignmentId)
    .where("assignment.userId", "=", user.id)
    .executeTakeFirst();
  const earlySmsCheckpoint =
    row &&
    !row.submittedAt &&
    input.channel === "sms" &&
    hasVisitedProfileMapping(
      row.profileMappings,
      row.visitedItemIds,
      "smsEnabled",
    );
  if (
    !row ||
    row.status !== "in_progress" ||
    (!row.submittedAt && !earlySmsCheckpoint)
  )
    return { status: "unavailable" };
  const channel = contactDestination(input.channel, row, {
    requireEnabled: true,
  });
  if (!channel) return { status: "unavailable" };
  if (channel.verified) return { status: "verified" };
  const recent = await database
    .selectFrom("contact_verification_challenge")
    .select((expression) => expression.fn.countAll<string>().as("count"))
    .where("assignmentId", "=", input.assignmentId)
    .where("channel", "=", input.channel)
    .where(
      "createdAt",
      ">",
      new Date(Date.now() - CONTACT_RATE_LIMIT_WINDOW_MS),
    )
    .executeTakeFirstOrThrow();
  if (Number(recent.count) >= 3) return { status: "rate-limited" };

  const now = new Date();
  const challengeId = `onboarding_verification_${randomUUID()}`;
  const challengeReference = randomBytes(24).toString("base64url");
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await database.transaction().execute(async (transaction) => {
    await transaction
      .updateTable("contact_verification_challenge")
      .set({ consumedAt: now })
      .where("assignmentId", "=", input.assignmentId)
      .where("channel", "=", input.channel)
      .where("consumedAt", "is", null)
      .execute();
    await transaction
      .insertInto("contact_verification_challenge")
      .values({
        id: challengeId,
        reference: challengeReference,
        assignmentId: input.assignmentId,
        userId: user.id,
        purpose: "onboarding",
        channel: input.channel,
        destinationDigest: contactSecretDigest(
          `${input.channel}:${channel.destination}`,
        ),
        codeDigest: contactSecretDigest(`code:${challengeId}:${code}`),
        attempts: 0,
        expiresAt: new Date(now.getTime() + CONTACT_CHALLENGE_LIFETIME_MS),
        consumedAt: null,
        createdAt: now,
      })
      .execute();
  });
  try {
    if (input.channel === "email") {
      const subject = "Verify your Upskill email";
      const textBody = `Your Upskill email verification code is ${code}. It expires in 10 minutes.`;
      await sendContactVerificationEmail(database, {
        challengeId,
        recipientEmail: channel.destination,
        subject,
        textBody,
        htmlBody: `<p>Your Upskill email verification code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`,
      });
    } else
      await sendContactVerificationSms(
        database,
        {
          deliveryId: challengeId,
          recipientUserId: user.id,
          recipientName: row.name,
          recipientPhone: channel.destination,
          message: `Your Upskill mobile verification code is ${code}. It expires in 10 minutes. If you did not request this code, ignore this message.`,
        },
        "onboarding_contact_verification",
      );
  } catch (error) {
    const ambiguous =
      isAmbiguousEmailDeliveryError(error) ||
      isAmbiguousSmsDeliveryError(error);
    if (!ambiguous)
      await database
        .deleteFrom("contact_verification_challenge")
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
        .selectFrom("contact_verification_challenge as challenge")
        .innerJoin(
          "onboarding_assignment as assignment",
          "assignment.id",
          "challenge.assignmentId",
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
          "user.email",
          "user.emailEnabled",
          "user.emailVerified",
          "user.phone",
          "user.smsEnabled",
          "user.smsVerifiedAt",
        ])
        .where("challenge.reference", "=", input.challengeReference)
        .where("challenge.purpose", "=", "onboarding")
        .where("challenge.assignmentId", "=", input.assignmentId)
        .where("challenge.userId", "=", user.id)
        .forUpdate(["challenge", "assignment"])
        .executeTakeFirst();
      if (!challenge) return { status: "invalid" };
      const now = new Date();
      const channel = contactDestination(challenge.channel, challenge, {
        requireEnabled: true,
      });
      if (
        challenge.consumedAt ||
        challenge.expiresAt <= now ||
        challenge.status !== "in_progress" ||
        !channel ||
        contactSecretDigest(`${challenge.channel}:${channel.destination}`) !==
          challenge.destinationDigest
      )
        return { status: "expired" };
      if (challenge.attempts >= 5) return { status: "rate-limited" };
      const attempts = challenge.attempts + 1;
      if (
        !contactCodeMatches(
          challenge.codeDigest,
          contactSecretDigest(`code:${challenge.id}:${input.code}`),
        )
      ) {
        await transaction
          .updateTable("contact_verification_challenge")
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
        .updateTable("contact_verification_challenge")
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
): Promise<
  { status: "skipped"; complete: boolean } | { status: "unavailable" }
> {
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
    .innerJoin("user", "user.id", "assignment.userId")
    .select([
      "assignment.id",
      "definition.profileMappings",
      "response.visitedItemIds",
      "response.submittedAt",
      "user.phone",
      "user.smsEnabled",
      "user.smsVerifiedAt",
    ])
    .where("assignment.id", "=", assignmentId)
    .where("assignment.userId", "=", user.id)
    .where("assignment.status", "=", "in_progress")
    .where("definition.contactVerificationRequired", "=", false)
    .executeTakeFirst();
  const earlySmsCheckpoint =
    assignment &&
    !assignment.submittedAt &&
    assignment.smsEnabled &&
    !assignment.smsVerifiedAt &&
    Boolean(assignment.phone) &&
    hasVisitedProfileMapping(
      assignment.profileMappings,
      assignment.visitedItemIds,
      "smsEnabled",
    );
  if (!assignment || (!assignment.submittedAt && !earlySmsCheckpoint))
    return { status: "unavailable" };
  const complete = Boolean(assignment.submittedAt);
  const updated = await database
    .updateTable("onboarding_assignment")
    .set({
      status: complete ? "completed" : "in_progress",
      completedAt: complete ? now : null,
      verificationDeferredAt: complete ? null : now,
      verificationSkippedAt: complete ? now : null,
    })
    .where("id", "=", assignmentId)
    .where("userId", "=", user.id)
    .where("status", "=", "in_progress")
    .returning("id")
    .executeTakeFirst();
  if (!updated) return { status: "unavailable" };
  logServerEvent({
    level: "info",
    event: "onboarding.contact_verification_skipped",
    fields: {
      entityType: "onboarding_assignment",
      entityId: assignmentId,
      actorUserId: user.id,
    },
  });
  return { status: "skipped", complete };
}
