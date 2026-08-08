import "@tanstack/react-start/server-only";

import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { getServerEnv } from "#/server/env.server";
import type { Database } from "./types";

let database: Kysely<Database> | undefined;

export function getDatabase(): Kysely<Database> {
  database ??= new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: getServerEnv().DATABASE_URL,
        max: 10,
      }),
    }),
  });
  return database;
}
