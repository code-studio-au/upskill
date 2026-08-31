import "@tanstack/react-start/server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { getServerEnv } from "#/server/env.server";
import { accountSetupContinuePathSchema } from "#/features/auth/account-setup.schema";
import { enqueueAccountSetupNotification } from "#/server/notifications/notification.server";
import { z } from "#/validation/zod.server";

const ACCOUNT_SETUP_TTL_MS = 72 * 60 * 60 * 1_000;
const RESET_PASSWORD_IDENTIFIER_PREFIX = "reset-password:";
const ACCOUNT_SETUP_CONTINUATION_IDENTIFIER_PREFIX =
  "account-setup-continuation:";

function createSetupToken(): string {
  return randomBytes(32).toString("base64url");
}

const invitationSetupPayloadSchema = z.object({ setupUrl: z.url() });
const accountSetupTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);

export async function invalidateLateInvitationAccountSetupRequests(
  transaction: Transaction<Database>,
  invitationId: string,
): Promise<number> {
  const notifications = await transaction
    .selectFrom("notification")
    .select("payload")
    .where("templateKey", "=", "account_setup_requested")
    .where(
      sql<boolean>`payload ->> 'eventLateRegistrationInvitationId' = ${invitationId}`,
    )
    .execute();
  const identifiers = [
    ...new Set(
      notifications.flatMap((notification) => {
        const payload = invitationSetupPayloadSchema.safeParse(
          notification.payload,
        );
        if (!payload.success) return [];
        const token = accountSetupTokenSchema.safeParse(
          new URLSearchParams(new URL(payload.data.setupUrl).hash.slice(1)).get(
            "token",
          ),
        );
        return token.success
          ? [`${RESET_PASSWORD_IDENTIFIER_PREFIX}${token.data}`]
          : [];
      }),
    ),
  ];
  if (!identifiers.length) return 0;
  const deleted = await transaction
    .deleteFrom("verification")
    .where("identifier", "in", identifiers)
    .returning("id")
    .execute();
  return deleted.length;
}

export async function createAccountSetupRequest(
  transaction: Transaction<Database>,
  input: {
    userId: string;
    name: string;
    email: string;
    deduplicationKey: string;
    createdAt: Date;
    setupExpiresAt?: Date;
    continuePath?: string;
    purpose?: "late_registration_invitation";
    eventLateRegistrationInvitationId?: string;
  },
): Promise<string> {
  const token = createSetupToken();
  await transaction
    .insertInto("verification")
    .values({
      id: `verification_${randomUUID()}`,
      identifier: `${RESET_PASSWORD_IDENTIFIER_PREFIX}${token}`,
      value: input.userId,
      expiresAt:
        input.setupExpiresAt ??
        new Date(input.createdAt.getTime() + ACCOUNT_SETUP_TTL_MS),
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    })
    .execute();
  const setupUrl = new URL("/account/setup", getServerEnv().APP_ORIGIN);
  const continuePath = input.continuePath
    ? accountSetupContinuePathSchema.parse(input.continuePath)
    : null;
  setupUrl.hash = new URLSearchParams({
    token,
    ...(continuePath ? { continue: continuePath } : {}),
  }).toString();
  return await enqueueAccountSetupNotification(transaction, {
    ...input,
    setupUrl: setupUrl.toString(),
  });
}

export async function refreshAccountSetupRequest(
  transaction: Transaction<Database>,
  input: {
    user: { id: string; name: string; email: string };
    actorUserId: string | null;
    reason: "administrator" | "late_invitation" | "self_purchase";
    minimumIntervalMs?: number;
    continuePath?: string;
    purpose?: "late_registration_invitation";
    eventLateRegistrationInvitationId?: string;
    preserveExistingRequests?: boolean;
    createdAt?: Date;
    setupExpiresAt?: Date;
  },
): Promise<string | null> {
  const createdAt = input.createdAt ?? new Date();
  const account = await transaction
    .selectFrom("user")
    .select(["accountState", "emailVerified", "setupRequestedAt"])
    .where("id", "=", input.user.id)
    .forUpdate()
    .executeTakeFirst();
  if (
    !account ||
    (account.accountState !== "provisional" && account.emailVerified)
  )
    return null;
  if (
    input.minimumIntervalMs &&
    account.setupRequestedAt &&
    createdAt.getTime() - account.setupRequestedAt.getTime() <
      input.minimumIntervalMs
  )
    return null;
  if (!input.preserveExistingRequests) {
    await transaction
      .deleteFrom("verification")
      .where("value", "=", input.user.id)
      .where("identifier", "like", `${RESET_PASSWORD_IDENTIFIER_PREFIX}%`)
      .execute();
    await transaction
      .updateTable("notification")
      .set({
        status: "superseded",
        payload: { version: 1 },
        supersededAt: createdAt,
        lastErrorCode: null,
        updatedAt: createdAt,
      })
      .where("recipientUserId", "=", input.user.id)
      .where("templateKey", "=", "account_setup_requested")
      .where("status", "in", ["pending", "processing", "failed"])
      .execute();
  }
  await transaction
    .updateTable("user")
    .set({ setupRequestedAt: createdAt, updatedAt: createdAt })
    .where("id", "=", input.user.id)
    .execute();
  const notificationId = await createAccountSetupRequest(transaction, {
    userId: input.user.id,
    name: input.user.name,
    email: input.user.email,
    deduplicationKey: `account-setup:${input.reason}:${randomUUID()}:${input.user.id}`,
    createdAt,
    ...(input.setupExpiresAt ? { setupExpiresAt: input.setupExpiresAt } : {}),
    ...(input.continuePath ? { continuePath: input.continuePath } : {}),
    ...(input.purpose ? { purpose: input.purpose } : {}),
    ...(input.eventLateRegistrationInvitationId
      ? {
          eventLateRegistrationInvitationId:
            input.eventLateRegistrationInvitationId,
        }
      : {}),
  });
  await recordDurableAuditEvent(transaction, {
    actorUserId: input.actorUserId,
    action: "user.account_setup_resent",
    subjectType: "user",
    subjectId: input.user.id,
    aggregateId: input.user.id,
    metadata: { notificationId, reason: input.reason },
    createdAt,
  });
  return notificationId;
}

export async function findAccountSetupRequest(
  token: string,
): Promise<
  | { status: "active" }
  | { status: "ready"; name: string; email: string }
  | { status: "invalid" }
> {
  const request = await getDatabase()
    .selectFrom("verification")
    .innerJoin("user", "user.id", "verification.value")
    .select([
      "user.name",
      "user.email",
      "user.accountState",
      "user.emailVerified",
      "verification.identifier",
    ])
    .where("verification.identifier", "in", [
      `${RESET_PASSWORD_IDENTIFIER_PREFIX}${token}`,
      `${ACCOUNT_SETUP_CONTINUATION_IDENTIFIER_PREFIX}${token}`,
    ])
    .where("verification.expiresAt", ">", new Date())
    .executeTakeFirst();
  if (!request) return { status: "invalid" };
  if (request.accountState === "active" && request.emailVerified)
    return { status: "active" };
  if (
    request.identifier === `${RESET_PASSWORD_IDENTIFIER_PREFIX}${token}` &&
    (request.accountState === "provisional" || !request.emailVerified)
  )
    return { status: "ready", name: request.name, email: request.email };
  return { status: "invalid" };
}

export async function activateAccountAfterPasswordReset(
  userId: string,
): Promise<void> {
  const now = new Date();
  await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const activated = await transaction
        .updateTable("user")
        .set({
          accountState: "active",
          emailVerified: true,
          emailVerifiedAt: now,
          activatedAt: sql<Date>`coalesce("activatedAt", ${now})`,
          updatedAt: now,
        })
        .where("id", "=", userId)
        .where((expression) =>
          expression.or([
            expression("accountState", "=", "provisional"),
            expression.and([
              expression("accountState", "=", "active"),
              expression("emailVerified", "=", false),
            ]),
          ]),
        )
        .returning("id")
        .executeTakeFirst();
      if (!activated) return;
      await transaction
        .updateTable("verification")
        .set({
          identifier: sql<string>`replace("identifier", ${RESET_PASSWORD_IDENTIFIER_PREFIX}, ${ACCOUNT_SETUP_CONTINUATION_IDENTIFIER_PREFIX})`,
          updatedAt: now,
        })
        .where("value", "=", userId)
        .where("identifier", "like", `${RESET_PASSWORD_IDENTIFIER_PREFIX}%`)
        .execute();
      const invitation = await transaction
        .selectFrom("platform_admin_invitation")
        .select(["id", "invitedByUserId"])
        .where("userId", "=", userId)
        .where("acceptedAt", "is", null)
        .where("cancelledAt", "is", null)
        .forUpdate()
        .executeTakeFirst();
      if (invitation) {
        await transaction
          .insertInto("platform_admin")
          .values({
            userId,
            grantedByUserId: invitation.invitedByUserId,
            createdAt: now,
          })
          .onConflict((conflict) => conflict.column("userId").doNothing())
          .execute();
        await transaction
          .updateTable("platform_admin_invitation")
          .set({ acceptedAt: now })
          .where("id", "=", invitation.id)
          .executeTakeFirstOrThrow();
        await recordDurableAuditEvent(transaction, {
          actorUserId: invitation.invitedByUserId,
          action: "authorization.platform_admin.granted",
          subjectType: "user",
          subjectId: userId,
          aggregateId: userId,
          metadata: {
            invitationId: invitation.id,
            activation: "account_setup",
          },
          createdAt: now,
        });
      }
      await transaction
        .updateTable("notification")
        .set({ payload: { version: 1 }, updatedAt: now })
        .where("recipientUserId", "=", userId)
        .where("templateKey", "=", "account_setup_requested")
        .where("status", "not in", ["pending", "processing", "failed"])
        .execute();
      await recordDurableAuditEvent(transaction, {
        actorUserId: userId,
        action: "user.account_activated",
        subjectType: "user",
        subjectId: userId,
        aggregateId: userId,
        createdAt: now,
      });
    });
}

export async function resendAccountSetup(
  userId: string,
  actor: AuthenticatedUser,
): Promise<"resent" | "not-found" | "already-active"> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const user = await transaction
        .selectFrom("user")
        .select(["id", "name", "email", "accountState", "emailVerified"])
        .where("id", "=", userId)
        .forUpdate()
        .executeTakeFirst();
      if (!user) return "not-found" as const;
      if (user.accountState === "active" && user.emailVerified)
        return "already-active" as const;
      await refreshAccountSetupRequest(transaction, {
        user,
        actorUserId: actor.id,
        reason: "administrator",
      });
      return "resent" as const;
    });
}
