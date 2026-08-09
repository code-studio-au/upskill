import { sql, type Kysely, type Transaction } from "kysely";
import type { Client } from "pg";
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

/** Enables audit deletion only on the PostgreSQL client transaction used by E2E cleanup. */
export async function withPgAuditMaintenance<T>(
  database: Client,
  task: (transaction: Client) => Promise<T>,
): Promise<T> {
  await database.query("begin");
  try {
    await database.query(
      "select set_config('upskill.audit_maintenance', 'on', true)",
    );
    const result = await task(database);
    await database.query("commit");
    return result;
  } catch (error) {
    await database.query("rollback");
    throw error;
  }
}
