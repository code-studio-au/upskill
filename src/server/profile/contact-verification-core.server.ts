import "@tanstack/react-start/server-only";

import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { normalizeInternationalPhone } from "#/features/profile/phone-number";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { Database } from "#/server/db/types";
import { getServerEnv } from "#/server/env.server";
import { enqueuePhoneVerificationTransferredNotification } from "#/server/notifications/notification.server";

export const CONTACT_CHALLENGE_LIFETIME_MS = 10 * 60_000;
export const CONTACT_RATE_LIMIT_WINDOW_MS = 15 * 60_000;

export type ContactVerificationChannel = "email" | "sms";

interface ContactIdentity {
  email: string;
  emailEnabled: boolean;
  emailVerified: boolean;
  phone: string | null;
  smsEnabled: boolean;
  smsVerifiedAt: Date | null;
}

export function normalizeContactEmail(value: string): string {
  return value.trim().toLocaleLowerCase("en-AU");
}

export function contactDestination(
  channel: ContactVerificationChannel,
  user: ContactIdentity,
  options: { requireEnabled: boolean },
): { destination: string; verified: boolean } | null {
  if (channel === "email")
    return !options.requireEnabled || user.emailEnabled
      ? {
          destination: normalizeContactEmail(user.email),
          verified: user.emailVerified,
        }
      : null;
  if ((options.requireEnabled && !user.smsEnabled) || !user.phone) return null;
  const phone = normalizeInternationalPhone(user.phone);
  return phone
    ? { destination: phone, verified: user.smsVerifiedAt !== null }
    : null;
}

export function contactSecretDigest(value: string): string {
  return createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET)
    .update(value)
    .digest("base64url");
}

export function contactCodeMatches(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

async function revokeSmsRecoveryAccess(
  transaction: Transaction<Database>,
  userIds: ReadonlyArray<string>,
  revokedAt: Date,
): Promise<void> {
  if (userIds.length === 0) return;
  await transaction
    .updateTable("contact_verification_challenge")
    .set({ consumedAt: revokedAt })
    .where("userId", "in", userIds)
    .where("channel", "=", "sms")
    .where("consumedAt", "is", null)
    .execute();
  const recoveryChallenges = transaction
    .selectFrom("event_prerequisite_recovery_challenge")
    .select("id")
    .where("userId", "in", userIds)
    .where("deliveryChannel", "=", "sms");
  await transaction
    .updateTable("event_prerequisite_task_session")
    .set({ revokedAt })
    .where("challengeId", "in", recoveryChallenges)
    .where("revokedAt", "is", null)
    .execute();
  await transaction
    .updateTable("event_prerequisite_recovery_challenge")
    .set({ consumedAt: revokedAt })
    .where("userId", "in", userIds)
    .where("deliveryChannel", "=", "sms")
    .where("consumedAt", "is", null)
    .execute();
}

export async function invalidateVerifiedPhone(
  transaction: Transaction<Database>,
  userId: string,
  changedAt: Date,
): Promise<void> {
  await transaction
    .updateTable("phone_verification_claim")
    .set({ releasedAt: changedAt, releaseReason: "phone_changed" })
    .where("userId", "=", userId)
    .where("releasedAt", "is", null)
    .execute();
  await transaction
    .updateTable("user")
    .set({ smsVerifiedAt: null, updatedAt: changedAt })
    .where("id", "=", userId)
    .execute();
  await revokeSmsRecoveryAccess(transaction, [userId], changedAt);
}

export async function claimVerifiedPhone(
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
    await revokeSmsRecoveryAccess(transaction, displacedIds, input.verifiedAt);
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
