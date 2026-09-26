import "@tanstack/react-start/server-only";

import { sql, type Transaction } from "kysely";
import type { Database } from "#/server/db/types";

const lockNamespace = "upskill:offline-scorm-auth-lifecycle:v1:";

/**
 * Serializes session termination and offline-writer issuance for one learner.
 * The transaction-scoped advisory lock works across application instances.
 */
export async function lockActiveOfflineScormSession(
  transaction: Transaction<Database>,
  input: { sessionId: string; userId: string },
): Promise<Date | undefined> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`${lockNamespace}${input.userId}`}, 0))`.execute(
    transaction,
  );
  const lockAcquiredAt = await sql<{ checkedAt: Date }>`
    select clock_timestamp() as "checkedAt"
  `.execute(transaction);
  const checkedAt = lockAcquiredAt.rows[0]?.checkedAt;
  if (!checkedAt)
    throw new Error("Offline SCORM lifecycle lock time is unavailable");
  const session = await transaction
    .selectFrom("session")
    .select("id")
    .where("id", "=", input.sessionId)
    .where("userId", "=", input.userId)
    .where("expiresAt", ">", checkedAt)
    .forUpdate()
    .executeTakeFirst();
  return session ? checkedAt : undefined;
}
