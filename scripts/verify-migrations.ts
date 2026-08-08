import { Kysely, PostgresDialect, sql } from "kysely";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const db = new Kysely<unknown>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});
const migrationFolder = path.resolve("src/server/db/migrations");
const migrator = new Migrator({
  db,
  provider: new FileMigrationProvider({ fs, path, migrationFolder }),
});

try {
  const migrations = await migrator.getMigrations();
  const pending = migrations.filter((migration) => !migration.executedAt);
  if (pending.length > 0)
    throw new Error(
      `Pending migrations: ${pending.map((migration) => migration.name).join(", ")}`,
    );

  const expectedTables = [
    "access_grant",
    "audit_event",
    "course",
    "course_version",
    "enrollment",
    "order",
    "organization",
    "outbox_event",
    "user",
  ];
  const result = await sql<{
    table_name: string;
  }>`select table_name from information_schema.tables where table_schema = 'public'`.execute(
    db,
  );
  const actual = new Set(result.rows.map((row) => row.table_name));
  const missing = expectedTables.filter((table) => !actual.has(table));
  if (missing.length > 0)
    throw new Error(`Missing tables: ${missing.join(", ")}`);
  console.log(
    `Verified ${migrations.length} migrations and ${expectedTables.length} foundational tables`,
  );
} finally {
  await db.destroy();
}
