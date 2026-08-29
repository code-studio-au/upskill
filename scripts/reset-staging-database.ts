import { Client } from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const STAGING_RESET_CONFIRMATION =
  "I_UNDERSTAND_THIS_DELETES_ALL_STAGING_DATA";

type StagingResetEnvironment = Record<string, string | undefined>;

export type ValidatedStagingResetEnvironment = {
  databaseTarget: string;
  migrationDatabaseUrl: string;
};

function databaseTarget(url: URL): string {
  const port = url.port || "5432";
  return `${url.hostname}:${port}${url.pathname}`;
}

function assertDatabaseUrl(name: string, value: string | undefined): URL {
  if (!value) throw new Error(`${name} is required`);
  const url = new URL(value);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:")
    throw new Error(`${name} must be a PostgreSQL URL`);
  if (!url.pathname || url.pathname === "/")
    throw new Error(`${name} must identify a database`);
  if (
    new Set(["localhost", "127.0.0.1", "::1"]).has(url.hostname) ||
    url.hostname.endsWith(".local")
  )
    throw new Error("Staging reset refuses local database hosts");
  return url;
}

export function validateStagingResetEnvironment(
  environment: StagingResetEnvironment,
): ValidatedStagingResetEnvironment {
  if (environment.APP_ENV !== "staging")
    throw new Error("Staging reset is prohibited unless APP_ENV=staging");
  if (environment.ALLOW_STAGING_RESET !== STAGING_RESET_CONFIRMATION)
    throw new Error(
      "Staging reset requires the exact destructive confirmation",
    );

  const appOrigin = new URL(environment.APP_ORIGIN ?? "");
  if (
    appOrigin.protocol !== "https:" ||
    appOrigin.hostname !== "staging.upskill.institute"
  )
    throw new Error(
      "Staging reset requires a staging HTTPS application origin",
    );

  const migrationUrl = assertDatabaseUrl(
    "MIGRATION_DATABASE_URL",
    environment.MIGRATION_DATABASE_URL,
  );
  const webUrl = assertDatabaseUrl("DATABASE_URL", environment.DATABASE_URL);
  const workerUrl = assertDatabaseUrl(
    "WORKER_DATABASE_URL",
    environment.WORKER_DATABASE_URL,
  );
  const target = databaseTarget(migrationUrl);
  if (databaseTarget(webUrl) !== target || databaseTarget(workerUrl) !== target)
    throw new Error(
      "All database roles must identify the same staging database",
    );
  if (environment.STAGING_RESET_DATABASE_TARGET !== target)
    throw new Error(
      "STAGING_RESET_DATABASE_TARGET must exactly match the migration database host, port and name",
    );

  return {
    databaseTarget: target,
    migrationDatabaseUrl: migrationUrl.toString(),
  };
}

export async function resetStagingDatabase(
  environment: StagingResetEnvironment,
): Promise<void> {
  const validated = validateStagingResetEnvironment(environment);
  const client = new Client({
    application_name: "upskill-staging-reset",
    connectionString: validated.migrationDatabaseUrl,
  });
  try {
    await client.connect();
    const currentDatabase = await client.query<{ name: string }>(
      "select current_database() as name",
    );
    const expectedDatabase = decodeURIComponent(
      new URL(validated.migrationDatabaseUrl).pathname.slice(1),
    );
    if (currentDatabase.rows[0]?.name !== expectedDatabase)
      throw new Error("Connected database does not match the guarded target");
    await client.query("begin");
    await client.query("drop schema public cascade");
    await client.query("create schema public");
    await client.query("commit");
    console.log(
      `Reset guarded staging database schema at ${validated.databaseTarget}`,
    );
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath &&
  path.resolve(invokedPath) === fileURLToPath(import.meta.url)
) {
  if (process.argv.slice(2).some((argument) => argument !== "--validate-only"))
    throw new Error("Only --validate-only is accepted");
  if (process.argv.includes("--validate-only")) {
    const validated = validateStagingResetEnvironment(process.env);
    console.log(
      `Validated guarded staging reset target ${validated.databaseTarget}`,
    );
  } else {
    await resetStagingDatabase(process.env);
  }
}
