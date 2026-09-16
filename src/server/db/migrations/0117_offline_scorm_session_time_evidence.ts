import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table offline_scorm_reconciliation_receipt
    add column "launchSessionId" text,
    add column "sessionElapsedSeconds" integer,
    add column "sessionTimeDeltaSeconds" integer,
    add constraint offline_scorm_receipt_session_time_ck check (
      (
        "launchSessionId" is null
        and "sessionElapsedSeconds" is null
        and "sessionTimeDeltaSeconds" is null
      )
      or (
        char_length("launchSessionId") between 1 and 200
        and "launchSessionId" !~ '[[:cntrl:]]'
        and "sessionElapsedSeconds" between 0 and 31536000
        and "sessionTimeDeltaSeconds" between 0 and "sessionElapsedSeconds"
      )
    )`.execute(db);
  await sql`alter table offline_scorm_reconciliation_receipt
    add constraint offline_scorm_receipt_accepted_session_time_ck check (
      outcome <> 'accepted'
      or (
        "launchSessionId" is not null
        and "sessionElapsedSeconds" is not null
        and "sessionTimeDeltaSeconds" is not null
      )
    )`.execute(db);
  await sql`create index offline_scorm_receipt_session_elapsed_idx
    on offline_scorm_reconciliation_receipt (
      "entitlementId", "launchSessionId", "sessionElapsedSeconds" desc
    ) where outcome = 'accepted'`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`drop index offline_scorm_receipt_session_elapsed_idx`.execute(db);
  await sql`alter table offline_scorm_reconciliation_receipt
    drop constraint offline_scorm_receipt_accepted_session_time_ck,
    drop constraint offline_scorm_receipt_session_time_ck,
    drop column "sessionTimeDeltaSeconds",
    drop column "sessionElapsedSeconds",
    drop column "launchSessionId"`.execute(db);
}
