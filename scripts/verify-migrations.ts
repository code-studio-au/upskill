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
    "access_grant_domain",
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

  const expectedIndexes = [
    "access_grant_code_digest_uq",
    "access_grant_domain_lookup_idx",
    "course_status_idx",
    "course_version_published_lookup_idx",
    "enrollment_user_status_idx",
  ];
  const indexResult = await sql<{
    indexname: string;
  }>`select indexname from pg_indexes where schemaname = 'public'`.execute(db);
  const actualIndexes = new Set(indexResult.rows.map((row) => row.indexname));
  const missingIndexes = expectedIndexes.filter(
    (index) => !actualIndexes.has(index),
  );
  if (missingIndexes.length > 0)
    throw new Error(`Missing indexes: ${missingIndexes.join(", ")}`);
  console.log(
    `Verified ${String(migrations.length)} migrations, ${String(expectedTables.length)} foundational tables and ${String(expectedIndexes.length)} required indexes`,
  );
} finally {
  await db.destroy();
}
