import "@tanstack/react-start/server-only";

import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
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
  type ContactVerificationChannel,
} from "./contact-verification-core.server";

const DEVELOPMENT_COOKIE = "upskill_profile_challenge";
const SECURE_COOKIE = "__Host-upskill_profile_challenge";

function cookieName(): string {
  const environment = getServerEnv();
  return environment.APP_ENV === "production" ||
    environment.APP_ENV === "staging"
    ? SECURE_COOKIE
    : DEVELOPMENT_COOKIE;
}

export function profileVerificationChallengeCookie(reference: string): string {
  const environment = getServerEnv();
  const secure =
    environment.APP_ENV === "production" || environment.APP_ENV === "staging";
  return [
    `${cookieName()}=${reference}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${String(CONTACT_CHALLENGE_LIFETIME_MS / 1_000)}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearProfileVerificationChallengeCookie(): string {
  const environment = getServerEnv();
  const secure =
    environment.APP_ENV === "production" || environment.APP_ENV === "staging";
  return [
    `${cookieName()}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function readProfileVerificationChallengeCookie(
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

export async function requestProfileContactVerification(
  channelName: ContactVerificationChannel,
  user: AuthenticatedUser,
): Promise<
  | { status: "sent"; challengeReference: string }
  | { status: "verified" | "unavailable" | "rate-limited" }
> {
  const database = getDatabase();
  const profile = await database
    .selectFrom("user")
    .select([
      "name",
      "email",
      "emailEnabled",
      "emailVerified",
      "phone",
      "smsEnabled",
      "smsVerifiedAt",
      "accountState",
    ])
    .where("id", "=", user.id)
    .executeTakeFirst();
  if (!profile || profile.accountState !== "active")
    return { status: "unavailable" };
  const channel = contactDestination(channelName, profile, {
    requireEnabled: false,
  });
  if (!channel) return { status: "unavailable" };
  if (channel.verified) return { status: "verified" };
  const recent = await database
    .selectFrom("contact_verification_challenge")
    .select((expression) => expression.fn.countAll<string>().as("count"))
    .where("userId", "=", user.id)
    .where("purpose", "=", "profile")
    .where("channel", "=", channelName)
    .where(
      "createdAt",
      ">",
      new Date(Date.now() - CONTACT_RATE_LIMIT_WINDOW_MS),
    )
    .executeTakeFirstOrThrow();
  if (Number(recent.count) >= 3) return { status: "rate-limited" };

  const now = new Date();
  const challengeId = `profile_verification_${randomUUID()}`;
  const challengeReference = randomBytes(24).toString("base64url");
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await database.transaction().execute(async (transaction) => {
    await transaction
      .updateTable("contact_verification_challenge")
      .set({ consumedAt: now })
      .where("userId", "=", user.id)
      .where("purpose", "=", "profile")
      .where("channel", "=", channelName)
      .where("consumedAt", "is", null)
      .execute();
    await transaction
      .insertInto("contact_verification_challenge")
      .values({
        id: challengeId,
        reference: challengeReference,
        assignmentId: null,
        userId: user.id,
        purpose: "profile",
        channel: channelName,
        destinationDigest: contactSecretDigest(
          `${channelName}:${channel.destination}`,
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
    if (channelName === "email") {
      const subject = "Verify your Upskill email";
      await sendContactVerificationEmail(database, {
        challengeId,
        recipientEmail: channel.destination,
        subject,
        textBody: `Your Upskill email verification code is ${code}. It expires in 10 minutes.`,
        htmlBody: `<p>Your Upskill email verification code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`,
      });
    } else
      await sendContactVerificationSms(
        database,
        {
          deliveryId: challengeId,
          recipientUserId: user.id,
          recipientName: profile.name,
          recipientPhone: channel.destination,
          message: `Your Upskill mobile verification code is ${code}. It expires in 10 minutes. If you did not request this code, ignore this message.`,
        },
        "profile_contact_verification",
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
      event: "profile.contact_verification_delivery_failed",
      fields: {
        entityType: "user",
        entityId: user.id,
        actorUserId: user.id,
        channel: channelName,
      },
    });
    if (!ambiguous) return { status: "unavailable" };
  }
  return { status: "sent", challengeReference };
}

export async function verifyProfileContactCode(
  input: { challengeReference: string; code: string },
  user: AuthenticatedUser,
): Promise<{
  status: "verified" | "invalid" | "expired" | "rate-limited";
  channel?: ContactVerificationChannel;
}> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const challenge = await transaction
        .selectFrom("contact_verification_challenge as challenge")
        .innerJoin("user", "user.id", "challenge.userId")
        .select([
          "challenge.id",
          "challenge.channel",
          "challenge.destinationDigest",
          "challenge.codeDigest",
          "challenge.attempts",
          "challenge.expiresAt",
          "challenge.consumedAt",
          "user.email",
          "user.emailEnabled",
          "user.emailVerified",
          "user.phone",
          "user.smsEnabled",
          "user.smsVerifiedAt",
          "user.accountState",
        ])
        .where("challenge.reference", "=", input.challengeReference)
        .where("challenge.userId", "=", user.id)
        .where("challenge.purpose", "=", "profile")
        .where("challenge.assignmentId", "is", null)
        .forUpdate("challenge")
        .executeTakeFirst();
      if (!challenge) return { status: "invalid" };
      const now = new Date();
      const channel = contactDestination(challenge.channel, challenge, {
        requireEnabled: false,
      });
      if (
        challenge.consumedAt ||
        challenge.expiresAt <= now ||
        challenge.accountState !== "active" ||
        !channel ||
        contactSecretDigest(`${challenge.channel}:${channel.destination}`) !==
          challenge.destinationDigest
      )
        return { status: "expired", channel: challenge.channel };
      if (challenge.attempts >= 5)
        return { status: "rate-limited", channel: challenge.channel };
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
          ? { status: "rate-limited", channel: challenge.channel }
          : { status: "invalid", channel: challenge.channel };
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
        return { status: "expired", channel: challenge.channel };
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
      logServerEvent({
        level: "info",
        event: "profile.contact_verified",
        fields: {
          entityType: "user",
          entityId: user.id,
          actorUserId: user.id,
          channel: challenge.channel,
        },
      });
      return { status: "verified", channel: challenge.channel };
    });
}
