import { sql, type Kysely, type Transaction } from "kysely";
import type { Database } from "#/server/db/types";

/** Enables audit deletion only on the transaction used by verification cleanup. */
export async function withAuditMaintenance<T>(
  database: Kysely<Database>,
  task: (transaction: Transaction<Database>) => Promise<T>,
): Promise<T> {
  return database.transaction().execute(async (transaction) => {
    await sql`select set_config('upskill.audit_maintenance', 'on', true)`.execute(
      transaction,
    );
    return task(transaction);
  });
}
