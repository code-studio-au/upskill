import { Client } from "pg";

const migrationDatabaseUrl =
  process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
const webDatabaseUrl = process.env.DATABASE_URL;
const workerDatabaseUrl = process.env.WORKER_DATABASE_URL;

if (!migrationDatabaseUrl || !webDatabaseUrl || !workerDatabaseUrl)
  throw new Error(
    "MIGRATION_DATABASE_URL, DATABASE_URL and WORKER_DATABASE_URL are required",
  );

function passwordFromUrl(value: string): string {
  const password = decodeURIComponent(new URL(value).password);
  if (!password)
    throw new Error("Runtime database URL must include a password");
  return password;
}

const client = new Client({ connectionString: migrationDatabaseUrl });
await client.connect();
try {
  await client.query("begin");
  for (const role of ["upskill_web", "upskill_worker"] as const) {
    await client.query(
      `do $$
       begin
         if not exists (select 1 from pg_roles where rolname = '${role}') then
           create role ${role} login noinherit nosuperuser nocreatedb nocreaterole noreplication;
         end if;
       end
       $$`,
    );
    const password =
      role === "upskill_web"
        ? passwordFromUrl(webDatabaseUrl)
        : passwordFromUrl(workerDatabaseUrl);
    const passwordStatement = await client.query<{ statement: string }>(
      `select format('alter role ${role} password %L', $1) as statement`,
      [password],
    );
    const statement = passwordStatement.rows[0]?.statement;
    if (!statement) throw new Error(`Unable to prepare password for ${role}`);
    await client.query(statement);
    await client.query(
      `grant usage on schema public to ${role};
       revoke create on schema public from ${role};
       grant select, insert, update, delete on all tables in schema public to ${role};
       grant usage, select, update on all sequences in schema public to ${role};
       alter default privileges in schema public grant select, insert, update, delete on tables to ${role};
       alter default privileges in schema public grant usage, select, update on sequences to ${role};
       revoke update, delete on table audit_event from ${role};
       grant select, insert on table audit_event to ${role};
       revoke all on table kysely_migration, kysely_migration_lock from ${role};`,
    );
  }
  await client.query("revoke create on schema public from public");
  await client.query("commit");
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
