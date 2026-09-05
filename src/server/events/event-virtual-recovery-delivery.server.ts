import "@tanstack/react-start/server-only";

import { sql, type Transaction } from "kysely";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { logServerEvent } from "#/server/logging/server-logger";
import {
  isAmbiguousEmailDeliveryError,
  sendEventVirtualRecoveryEmail,
} from "#/server/notifications/email-provider.server";
import {
  isAmbiguousSmsDeliveryError,
  sendEventVirtualRecoverySms,
} from "#/server/notifications/sms-provider.server";
import {
  decryptEventVirtualRecoveryCode,
  encryptEventVirtualRecoveryCode,
} from "./event-virtual-recovery-code.server";

interface RecoveryDeliveryOverrides {
  sendEmail?: typeof sendEventVirtualRecoveryEmail;
  sendSms?: typeof sendEventVirtualRecoverySms;
}

interface RecoveryTargetInput {
  eventVirtualJoinAccessId: string;
  eventOccurrenceId: string;
  eventSessionId: string;
  roomGeneration: number;
  eventParticipationId: string;
  userId: string;
  channel: "email" | "sms";
  recipientAddress: string;
  publicReference?: string;
  now: Date;
}

interface RecoveryTarget {
  eventTitle: string;
  sessionTitle: string;
  recipientName: string;
}

function normalizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase("en-AU");
}

export async function lockEligibleRecoveryTarget(
  transaction: Transaction<Database>,
  input: RecoveryTargetInput,
): Promise<RecoveryTarget | null> {
  const occurrence = await transaction
    .selectFrom("event_occurrence as occurrence")
    .innerJoin(
      "event_template_version as version",
      "version.id",
      "occurrence.eventTemplateVersionId",
    )
    .select([
      "occurrence.status",
      "occurrence.publishedAt",
      "occurrence.title",
      "version.registrationSurveyVersionId",
    ])
    .where("occurrence.id", "=", input.eventOccurrenceId)
    .forUpdate("occurrence")
    .executeTakeFirst();
  const session = await transaction
    .selectFrom("event_session")
    .select(["title", "endsAt", "virtualDeliveryProvider"])
    .where("id", "=", input.eventSessionId)
    .where("eventOccurrenceId", "=", input.eventOccurrenceId)
    .forUpdate()
    .executeTakeFirst();
  const room = await transaction
    .selectFrom("event_virtual_room")
    .select("doorState")
    .where("eventSessionId", "=", input.eventSessionId)
    .where("generation", "=", input.roomGeneration)
    .where("replacedAt", "is", null)
    .forUpdate()
    .executeTakeFirst();
  const access = await transaction
    .selectFrom("event_virtual_join_access")
    .select("id")
    .where("id", "=", input.eventVirtualJoinAccessId)
    .where("eventOccurrenceId", "=", input.eventOccurrenceId)
    .where("eventSessionId", "=", input.eventSessionId)
    .where("roomGeneration", "=", input.roomGeneration)
    .$if(Boolean(input.publicReference), (query) =>
      query.where("publicReference", "=", input.publicReference ?? ""),
    )
    .where("revokedAt", "is", null)
    .forUpdate()
    .executeTakeFirst();
  if (
    !occurrence?.publishedAt ||
    occurrence.status !== "published" ||
    !session ||
    session.virtualDeliveryProvider !== "livekit" ||
    !room ||
    room.doorState === "ended" ||
    (room.doorState === "scheduled" && session.endsAt <= input.now) ||
    !access
  )
    return null;
  const participation = await transaction
    .selectFrom("event_participation")
    .select("registrationId")
    .where("id", "=", input.eventParticipationId)
    .where("eventOccurrenceId", "=", input.eventOccurrenceId)
    .where("userId", "=", input.userId)
    .where("mode", "=", "registered")
    .forUpdate()
    .executeTakeFirst();
  if (!participation?.registrationId) return null;
  const registration = await transaction
    .selectFrom("event_registration")
    .select("status")
    .where("id", "=", participation.registrationId)
    .where("eventOccurrenceId", "=", input.eventOccurrenceId)
    .where("userId", "=", input.userId)
    .forUpdate()
    .executeTakeFirst();
  if (registration?.status !== "selected") return null;
  const user = await transaction
    .selectFrom("user")
    .select([
      "name",
      "email",
      "emailEnabled",
      "emailVerified",
      "phone",
      "smsEnabled",
      "smsVerifiedAt",
    ])
    .where("id", "=", input.userId)
    .forUpdate()
    .executeTakeFirst();
  if (!user) return null;
  const contactMatches =
    input.channel === "sms"
      ? user.smsEnabled &&
        Boolean(user.smsVerifiedAt) &&
        user.phone === input.recipientAddress
      : user.emailEnabled &&
        user.emailVerified &&
        normalizeEmail(user.email) === input.recipientAddress;
  if (!contactMatches) return null;
  if (occurrence.registrationSurveyVersionId) {
    const assignment = await transaction
      .selectFrom("registration_questionnaire_assignment")
      .select("status")
      .where("eventOccurrenceId", "=", input.eventOccurrenceId)
      .where("userId", "=", input.userId)
      .where("surveyVersionId", "=", occurrence.registrationSurveyVersionId)
      .forUpdate()
      .executeTakeFirst();
    if (!assignment || !["completed", "waived"].includes(assignment.status))
      return null;
  }
  return {
    eventTitle: occurrence.title,
    sessionTitle: session.title,
    recipientName: user.name,
  };
}

export async function enqueueEventVirtualRecoveryDelivery(
  transaction: Transaction<Database>,
  input: {
    challengeId: string;
    recipientAddress: string;
    code: string;
    createdAt: Date;
  },
): Promise<void> {
  await transaction
    .insertInto("event_virtual_recovery_delivery")
    .values({
      challengeId: input.challengeId,
      recipientAddress: input.recipientAddress,
      encryptedCode: encryptEventVirtualRecoveryCode(
        input.challengeId,
        input.code,
      ),
      createdAt: input.createdAt,
    })
    .execute();
}

function recoveryEmail(input: {
  code: string;
  eventTitle: string;
  sessionTitle: string;
}) {
  const title = input.eventTitle.replace(/[\r\n]+/gu, " ").trim();
  return {
    subject: `Your Upskill webinar access code for ${title}`.slice(0, 180),
    textBody: [
      `Your Upskill webinar access code is ${input.code}.`,
      "",
      `Use it to enter the waiting room for ${input.sessionTitle}.`,
      "This code expires in 10 minutes and can be used once.",
      "",
      "If you did not request this code, you can ignore this email.",
    ].join("\n"),
    htmlBody: `<p>Your Upskill webinar access code is <strong>${input.code}</strong>.</p><p>Use it to enter the webinar waiting room. It expires in 10 minutes and can be used once.</p><p>If you did not request it, you can ignore this email.</p>`,
  };
}

type EventVirtualRecoveryDeliveryOutcome =
  | { status: "no-work" }
  | {
      status: "failed" | "sent" | "skipped" | "unknown";
      challengeId: string;
    };

export interface EventVirtualRecoveryDeliveryBatch {
  outcomes: Array<
    Exclude<EventVirtualRecoveryDeliveryOutcome, { status: "no-work" }>
  >;
  limitReached: boolean;
}

async function processNextEventVirtualRecoveryDelivery(
  options: {
    clock?: () => Date;
    delivery?: RecoveryDeliveryOverrides;
  } = {},
): Promise<EventVirtualRecoveryDeliveryOutcome> {
  const database = getDatabase();
  const candidate = await database
    .selectFrom("event_virtual_recovery_challenge as challenge")
    .innerJoin(
      "event_virtual_recovery_delivery as delivery",
      "delivery.challengeId",
      "challenge.id",
    )
    .select([
      "challenge.id",
      "challenge.eventVirtualJoinAccessId",
      "challenge.eventOccurrenceId",
      "challenge.eventSessionId",
      "challenge.roomGeneration",
      "challenge.eventParticipationId",
      "challenge.userId",
      "challenge.channel",
      "delivery.recipientAddress",
    ])
    .where("challenge.deliveryStatus", "=", "pending")
    .orderBy("challenge.createdAt")
    .orderBy("challenge.id")
    .executeTakeFirst();
  if (!candidate) return { status: "no-work" };
  const now = options.clock?.() ?? new Date();
  const claimed = await database.transaction().execute(async (transaction) => {
    const target = await lockEligibleRecoveryTarget(transaction, {
      eventVirtualJoinAccessId: candidate.eventVirtualJoinAccessId,
      eventOccurrenceId: candidate.eventOccurrenceId,
      eventSessionId: candidate.eventSessionId,
      roomGeneration: candidate.roomGeneration,
      eventParticipationId: candidate.eventParticipationId,
      userId: candidate.userId,
      channel: candidate.channel,
      recipientAddress: candidate.recipientAddress,
      now,
    });
    const challenge = await transaction
      .selectFrom("event_virtual_recovery_challenge as challenge")
      .innerJoin(
        "event_virtual_recovery_delivery as delivery",
        "delivery.challengeId",
        "challenge.id",
      )
      .select([
        "challenge.id",
        "challenge.deliveryStatus",
        "challenge.expiresAt",
        "challenge.consumedAt",
        "delivery.encryptedCode",
      ])
      .where("challenge.id", "=", candidate.id)
      .forUpdate(["challenge", "delivery"])
      .executeTakeFirst();
    if (!challenge || challenge.deliveryStatus !== "pending") return null;
    if (!target || challenge.consumedAt || challenge.expiresAt <= now) {
      await transaction
        .updateTable("event_virtual_recovery_challenge")
        .set({
          deliveryStatus: "failed",
          consumedAt: challenge.consumedAt ?? now,
        })
        .where("id", "=", challenge.id)
        .where("deliveryStatus", "=", "pending")
        .execute();
      await transaction
        .deleteFrom("event_virtual_recovery_delivery")
        .where("challengeId", "=", challenge.id)
        .execute();
      return { status: "skipped" as const };
    }
    let code: string;
    try {
      code = decryptEventVirtualRecoveryCode(
        challenge.id,
        challenge.encryptedCode,
      );
    } catch {
      await transaction
        .updateTable("event_virtual_recovery_challenge")
        .set({ deliveryStatus: "failed", consumedAt: now })
        .where("id", "=", challenge.id)
        .where("deliveryStatus", "=", "pending")
        .execute();
      await transaction
        .deleteFrom("event_virtual_recovery_delivery")
        .where("challengeId", "=", challenge.id)
        .execute();
      return { status: "skipped" as const };
    }
    await transaction
      .updateTable("event_virtual_recovery_challenge")
      .set({ deliveryStatus: "unknown" })
      .where("id", "=", challenge.id)
      .where("deliveryStatus", "=", "pending")
      .executeTakeFirstOrThrow();
    await transaction
      .deleteFrom("event_virtual_recovery_delivery")
      .where("challengeId", "=", challenge.id)
      .execute();
    return { status: "claimed" as const, code, target };
  });
  if (!claimed) return { status: "no-work" };
  if (claimed.status === "skipped")
    return { status: "skipped", challengeId: candidate.id };
  try {
    if (candidate.channel === "sms")
      await (options.delivery?.sendSms ?? sendEventVirtualRecoverySms)(
        database,
        {
          deliveryId: candidate.id,
          recipientUserId: candidate.userId,
          recipientName: claimed.target.recipientName,
          recipientPhone: candidate.recipientAddress,
          message: `Your Upskill webinar access code is ${claimed.code}. It expires in 10 minutes. If you did not request it, ignore this message.`,
        },
      );
    else
      await (options.delivery?.sendEmail ?? sendEventVirtualRecoveryEmail)(
        database,
        {
          challengeId: candidate.id,
          recipientEmail: candidate.recipientAddress,
          ...recoveryEmail({
            code: claimed.code,
            eventTitle: claimed.target.eventTitle,
            sessionTitle: claimed.target.sessionTitle,
          }),
        },
      );
    await database
      .updateTable("event_virtual_recovery_challenge")
      .set({ deliveryStatus: "sent" })
      .where("id", "=", candidate.id)
      .where("deliveryStatus", "=", "unknown")
      .execute();
    return { status: "sent", challengeId: candidate.id };
  } catch (error) {
    const ambiguous =
      isAmbiguousEmailDeliveryError(error) ||
      isAmbiguousSmsDeliveryError(error);
    if (!ambiguous)
      await database
        .updateTable("event_virtual_recovery_challenge")
        .set({
          deliveryStatus: "failed",
          consumedAt: sql`coalesce("consumedAt", ${new Date()})`,
        })
        .where("id", "=", candidate.id)
        .where("deliveryStatus", "=", "unknown")
        .execute();
    logServerEvent({
      level: "error",
      event: "event_virtual_lobby.recovery_delivery_failed",
      fields: {
        entityType: "event_virtual_join_access",
        entityId: candidate.eventVirtualJoinAccessId,
        outcome: "failed",
      },
    });
    return {
      status: ambiguous ? "unknown" : "failed",
      challengeId: candidate.id,
    };
  }
}

export async function processAvailableEventVirtualRecoveryDeliveries(
  limit = 10,
  options: {
    clock?: () => Date;
    delivery?: RecoveryDeliveryOverrides;
  } = {},
): Promise<EventVirtualRecoveryDeliveryBatch> {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new RangeError(
      "Event virtual recovery delivery limit must be a positive integer",
    );
  const outcomes: EventVirtualRecoveryDeliveryBatch["outcomes"] = [];
  for (let index = 0; index < limit; index += 1) {
    const outcome = await processNextEventVirtualRecoveryDelivery(options);
    if (outcome.status === "no-work") return { outcomes, limitReached: false };
    outcomes.push(outcome);
  }
  return { outcomes, limitReached: true };
}
