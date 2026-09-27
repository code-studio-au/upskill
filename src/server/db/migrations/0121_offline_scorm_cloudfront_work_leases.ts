import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table offline_scorm_cloudfront_allocation
    add column attempts integer not null default 0,
    add column "availableAt" timestamptz not null default statement_timestamp(),
    add column "leasedUntil" timestamptz,
    add column "lastAttemptAt" timestamptz,
    add constraint offline_scorm_cloudfront_allocation_attempts_ck check (
      attempts >= 0
      and (
        (attempts = 0 and "lastAttemptAt" is null)
        or (attempts > 0 and "lastAttemptAt" is not null)
      )
    ),
    add constraint offline_scorm_cloudfront_allocation_work_timeline_ck check (
      isfinite("availableAt")
      and "availableAt" >= "createdAt"
      and (
        "leasedUntil" is null
        or (
          state in ('allocating', 'enabling', 'disabling', 'deletion_pending')
          and
          isfinite("leasedUntil")
          and "lastAttemptAt" is not null
          and "leasedUntil" > "lastAttemptAt"
        )
      )
      and (
        "lastAttemptAt" is null
        or (
          isfinite("lastAttemptAt")
          and "lastAttemptAt" >= "createdAt"
        )
      )
    )`.execute(db);

  await sql`drop index offline_scorm_cloudfront_allocation_work_idx`.execute(
    db,
  );
  await sql`create index offline_scorm_cloudfront_allocation_work_idx
    on offline_scorm_cloudfront_allocation (
      "availableAt", state, "updatedAt", "entitlementId"
    ) where state not in ('active', 'deleted')`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`drop index offline_scorm_cloudfront_allocation_work_idx`.execute(
    db,
  );
  await sql`create index offline_scorm_cloudfront_allocation_work_idx
    on offline_scorm_cloudfront_allocation (
      state, "updatedAt", "entitlementId"
    ) where state not in ('active', 'deleted')`.execute(db);
  await sql`alter table offline_scorm_cloudfront_allocation
    drop constraint offline_scorm_cloudfront_allocation_work_timeline_ck,
    drop constraint offline_scorm_cloudfront_allocation_attempts_ck,
    drop column "lastAttemptAt",
    drop column "leasedUntil",
    drop column "availableAt",
    drop column attempts`.execute(db);
}
