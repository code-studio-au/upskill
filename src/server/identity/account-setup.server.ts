import "@tanstack/react-start/server-only";

import { randomBytes, randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { getServerEnv } from "#/server/env.server";
import { enqueueAccountSetupNotification } from "#/server/notifications/notification.server";

const ACCOUNT_SETUP_TTL_MS = 72 * 60 * 60 * 1_000;

function createSetupToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createAccountSetupRequest(
  transaction: Transaction<Database>,
  input: {
    userId: string;
    name: string;
    email: string;
    deduplicationKey: string;
    createdAt: Date;
  },
): Promise<string> {
  const token = createSetupToken();
  await transaction
    .insertInto("verification")
    .values({
      id: `verification_${randomUUID()}`,
      identifier: `reset-password:${token}`,
      value: input.userId,
      expiresAt: new Date(input.createdAt.getTime() + ACCOUNT_SETUP_TTL_MS),
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    })
    .execute();
  const setupUrl = new URL("/account/setup", getServerEnv().APP_ORIGIN);
  setupUrl.hash = new URLSearchParams({ token }).toString();
  return await enqueueAccountSetupNotification(transaction, {
    ...input,
    setupUrl: setupUrl.toString(),
  });
}

export async function findAccountSetupRequest(
  token: string,
): Promise<
  { status: "ready"; name: string; email: string } | { status: "invalid" }
> {
  const request = await getDatabase()
    .selectFrom("verification")
    .innerJoin("user", "user.id", "verification.value")
    .select(["user.name", "user.email"])
    .where("verification.identifier", "=", `reset-password:${token}`)
    .where("verification.expiresAt", ">", new Date())
    .where("user.accountState", "=", "provisional")
    .executeTakeFirst();
  return request ? { status: "ready", ...request } : { status: "invalid" };
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
          activatedAt: now,
          updatedAt: now,
        })
        .where("id", "=", userId)
        .where("accountState", "=", "provisional")
        .returning("id")
        .executeTakeFirst();
      if (!activated) return;
      await transaction
        .updateTable("notification")
        .set({ payload: { version: 1 }, updatedAt: now })
        .where("recipientUserId", "=", userId)
        .where("templateKey", "=", "account_setup_requested")
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
        .select(["id", "name", "email", "accountState"])
        .where("id", "=", userId)
        .forUpdate()
        .executeTakeFirst();
      if (!user) return "not-found" as const;
      if (user.accountState !== "provisional") return "already-active" as const;
      const now = new Date();
      await transaction
        .deleteFrom("verification")
        .where("value", "=", user.id)
        .where("identifier", "like", "reset-password:%")
        .execute();
      await transaction
        .updateTable("notification")
        .set({
          status: "superseded",
          payload: { version: 1 },
          supersededAt: now,
          lastErrorCode: null,
          updatedAt: now,
        })
        .where("recipientUserId", "=", user.id)
        .where("templateKey", "=", "account_setup_requested")
        .where("status", "in", ["pending", "processing", "failed"])
        .execute();
      await transaction
        .updateTable("user")
        .set({ setupRequestedAt: now, updatedAt: now })
        .where("id", "=", user.id)
        .execute();
      const notificationId = await createAccountSetupRequest(transaction, {
        userId: user.id,
        name: user.name,
        email: user.email,
        deduplicationKey: `account-setup:resend:${randomUUID()}:${user.id}`,
        createdAt: now,
      });
      await recordDurableAuditEvent(transaction, {
        actorUserId: actor.id,
        action: "user.account_setup_resent",
        subjectType: "user",
        subjectId: user.id,
        aggregateId: user.id,
        metadata: { notificationId },
        createdAt: now,
      });
      return "resent" as const;
    });
}
