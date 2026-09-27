import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table offline_scorm_cloudfront_allocation
    add column "userId" text,
    add column "installationId" text,
    add column "attemptId" text,
    add column "courseEnrollmentId" text,
    add column "courseModulePosition" integer,
    add column "courseVersionItemId" text,
    add column "scormPackageVersionId" text,
    add column "packageSha256" text,
    add constraint offline_scorm_cloudfront_reservation_shape_ck check (
      (
        "userId" is null
        and "installationId" is null
        and "attemptId" is null
        and "courseEnrollmentId" is null
        and "courseModulePosition" is null
        and "courseVersionItemId" is null
        and "scormPackageVersionId" is null
        and "packageSha256" is null
      )
      or (
        "userId" is not null
        and "installationId" is not null
        and "attemptId" is not null
        and "courseEnrollmentId" is not null
        and "courseModulePosition" is not null
        and "courseModulePosition" >= 0
        and "courseVersionItemId" is not null
        and "scormPackageVersionId" is not null
        and "packageSha256" ~ '^[a-f0-9]{64}$'
      )
    ),
    add constraint offline_scorm_cloudfront_reservation_installation_fk
      foreign key ("installationId", "userId")
      references offline_learning_installation (id, "userId")
      on delete restrict,
    add constraint offline_scorm_cloudfront_reservation_attempt_package_fk
      foreign key ("attemptId", "scormPackageVersionId")
      references scorm_attempt (id, "scormPackageVersionId")
      on delete restrict,
    add constraint offline_scorm_cloudfront_reservation_enrollment_fk
      foreign key ("courseEnrollmentId") references enrollment (id)
      on delete restrict,
    add constraint offline_scorm_cloudfront_reservation_item_fk
      foreign key ("courseVersionItemId") references course_version_item (id)
      on delete restrict`.execute(db);

  await sql`create unique index offline_scorm_cloudfront_reservation_attempt_uq
    on offline_scorm_cloudfront_allocation ("attemptId")
    where "userId" is not null and state <> 'deleted'`.execute(db);

  await sql`create function guard_offline_scorm_cloudfront_reservation()
    returns trigger
    language plpgsql
    as $$
    begin
      if tg_op = 'UPDATE' and row(
        new."userId", new."installationId", new."attemptId",
        new."courseEnrollmentId", new."courseModulePosition",
        new."courseVersionItemId", new."scormPackageVersionId",
        new."packageSha256"
      ) is distinct from row(
        old."userId", old."installationId", old."attemptId",
        old."courseEnrollmentId", old."courseModulePosition",
        old."courseVersionItemId", old."scormPackageVersionId",
        old."packageSha256"
      ) then
        raise exception 'CloudFront reservation authority is immutable'
          using errcode = '23514';
      end if;
      return new;
    end
    $$`.execute(db);
  await sql`create trigger offline_scorm_cloudfront_reservation_guard_trg
    before update on offline_scorm_cloudfront_allocation
    for each row execute function guard_offline_scorm_cloudfront_reservation()`.execute(
    db,
  );
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`drop trigger offline_scorm_cloudfront_reservation_guard_trg
    on offline_scorm_cloudfront_allocation`.execute(db);
  await sql`drop function guard_offline_scorm_cloudfront_reservation()`.execute(
    db,
  );
  await sql`drop index offline_scorm_cloudfront_reservation_attempt_uq`.execute(
    db,
  );
  await sql`alter table offline_scorm_cloudfront_allocation
    drop constraint offline_scorm_cloudfront_reservation_item_fk,
    drop constraint offline_scorm_cloudfront_reservation_enrollment_fk,
    drop constraint offline_scorm_cloudfront_reservation_attempt_package_fk,
    drop constraint offline_scorm_cloudfront_reservation_installation_fk,
    drop constraint offline_scorm_cloudfront_reservation_shape_ck,
    drop column "packageSha256",
    drop column "scormPackageVersionId",
    drop column "courseVersionItemId",
    drop column "courseModulePosition",
    drop column "courseEnrollmentId",
    drop column "attemptId",
    drop column "installationId",
    drop column "userId"`.execute(db);
}
