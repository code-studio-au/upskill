import { Kysely, PostgresDialect } from "kysely";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const migrationFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations",
);
const db = new Kysely<unknown>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});
const migrator = new Migrator({
  db,
  provider: new FileMigrationProvider({ fs, path, migrationFolder }),
});

try {
  for (;;) {
    const { error, results } = await migrator.migrateUp();
    if (error)
      throw error instanceof Error
        ? error
        : new Error("Migration failed", { cause: error });
    const result = results?.[0];
    if (!result) break;
    console.log(`${result.status}: ${result.migrationName}`);
    if (result.status !== "Success")
      throw new Error(`Migration ${result.migrationName} did not succeed`);
  }
} finally {
  await db.destroy();
}
