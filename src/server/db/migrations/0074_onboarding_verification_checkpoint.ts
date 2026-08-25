import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table onboarding_assignment
    add column "verificationDeferredAt" timestamptz`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`alter table onboarding_assignment
    drop column "verificationDeferredAt"`.execute(db);
}
