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
  input: { sessionId: string; userId: string; now: Date },
): Promise<boolean> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`${lockNamespace}${input.userId}`}, 0))`.execute(
    transaction,
  );
  const session = await transaction
    .selectFrom("session")
    .select("id")
    .where("id", "=", input.sessionId)
    .where("userId", "=", input.userId)
    .where("expiresAt", ">", input.now)
    .forUpdate()
    .executeTakeFirst();
  return session !== undefined;
}
