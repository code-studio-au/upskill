import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (process.env.APP_ENV !== "development")
  throw new Error("Local database reset requires APP_ENV=development");

const url = new URL(databaseUrl);
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
if (!localHosts.has(url.hostname) || url.pathname !== "/upskill")
  throw new Error(
    "Refusing to reset a database other than local development /upskill",
  );

const client = new Client({ connectionString: databaseUrl });
try {
  await client.connect();
  await client.query("drop schema public cascade");
  await client.query("create schema public");
  console.log("Reset local Upskill database schema");
} finally {
  await client.end();
}
