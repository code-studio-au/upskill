import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table notification
    add column "accountSetupVerificationId" text
      references verification(id) on delete set null`.execute(db);
  await sql`create index notification_account_setup_verification_idx
    on notification ("accountSetupVerificationId")
    where "accountSetupVerificationId" is not null`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index notification_account_setup_verification_idx`.execute(db);
  await sql`alter table notification
    drop column "accountSetupVerificationId"`.execute(db);
}
