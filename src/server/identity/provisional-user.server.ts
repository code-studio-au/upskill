import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { Database } from "#/server/db/types";
import { createAccountSetupRequest } from "./account-setup.server";

export type ProvisionalUserSource =
  "administrator" | "open_entry" | "late_invitation" | "access_owner";

export function normalizeUserEmail(email: string): string {
  return email.trim().toLocaleLowerCase("en-AU");
}

export async function provisionUser(
  transaction: Transaction<Database>,
  input: {
    name: string;
    email: string;
    source: ProvisionalUserSource;
    actorUserId: string | null;
    sourceEventId: string;
    createdAt?: Date;
  },
): Promise<{
  user: { id: string; name: string; email: string; emailVerified: boolean };
  created: boolean;
  notificationId: string | null;
}> {
  const createdAt = input.createdAt ?? new Date();
  const email = normalizeUserEmail(input.email);
  const inserted = await transaction
    .insertInto("user")
    .values({
      id: `user_${randomUUID()}`,
      name: input.name.trim(),
      email,
      emailVerified: false,
      image: null,
      stripeCustomerId: null,
      accountState: "provisional",
      provisioningSource: input.source,
      provisionedByUserId: input.actorUserId,
      setupRequestedAt: createdAt,
      activatedAt: null,
      createdAt,
      updatedAt: createdAt,
    })
    .onConflict((conflict) =>
      conflict.expression(sql`lower(email)`).doNothing(),
    )
    .returning(["id", "name", "email", "emailVerified"])
    .executeTakeFirst();
  const user =
    inserted ??
    (await transaction
      .selectFrom("user")
      .select(["id", "name", "email", "emailVerified"])
      .where(sql<boolean>`lower(email) = ${email}`)
      .executeTakeFirstOrThrow());
  if (!inserted) return { user, created: false, notificationId: null };

  await recordDurableAuditEvent(transaction, {
    actorUserId: input.actorUserId,
    action: "user.provisional_created",
    subjectType: "user",
    subjectId: user.id,
    aggregateId: user.id,
    metadata: { source: input.source },
    createdAt,
  });
  const notificationId = await createAccountSetupRequest(transaction, {
    userId: user.id,
    name: user.name,
    email: user.email,
    deduplicationKey: `account-setup:${input.sourceEventId}:${user.id}`,
    createdAt,
  });
  return { user, created: true, notificationId };
}
