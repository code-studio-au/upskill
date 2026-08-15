import { randomBytes } from "node:crypto";
import { Client } from "pg";

const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const quoteIdentifier = (identifier) => `"${identifier.replaceAll('"', '""')}"`;

export async function createDisposablePostgresDatabase({
  baseDatabaseUrl,
  namePrefix,
}) {
  if (!baseDatabaseUrl) throw new Error("DATABASE_URL is required");
  if (process.env.APP_ENV === "staging" || process.env.APP_ENV === "production")
    throw new Error(
      "Disposable test databases cannot target a deployed environment",
    );

  const parsedBaseUrl = new URL(baseDatabaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(parsedBaseUrl.protocol) ||
    !localHosts.has(parsedBaseUrl.hostname)
  )
    throw new Error(
      "Disposable test databases require a PostgreSQL server on localhost",
    );
  if (!/^upskill_[a-z0-9_]+$/u.test(namePrefix))
    throw new Error("Disposable database prefix is invalid");

  const databaseName = `${namePrefix}_${String(process.pid)}_${randomBytes(6).toString("hex")}`;
  const databaseUrl = new URL(parsedBaseUrl);
  databaseUrl.pathname = `/${databaseName}`;
  const controlDatabaseUrl = new URL(parsedBaseUrl);
  controlDatabaseUrl.pathname = "/postgres";

  const withControlDatabase = async (task) => {
    const client = new Client({
      connectionString: controlDatabaseUrl.toString(),
    });
    await client.connect();
    try {
      return await task(client);
    } finally {
      await client.end();
    }
  };

  await withControlDatabase(async (client) => {
    await client.query(`create database ${quoteIdentifier(databaseName)}`);
  });

  let disposed = false;
  return {
    databaseName,
    databaseUrl: databaseUrl.toString(),
    async dispose() {
      if (disposed) return;
      await withControlDatabase(async (client) => {
        await client.query(
          "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
          [databaseName],
        );
        await client.query(`drop database ${quoteIdentifier(databaseName)}`);
      });
      disposed = true;
    },
  };
}
