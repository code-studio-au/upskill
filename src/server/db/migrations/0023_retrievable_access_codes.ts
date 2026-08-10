import { sql, type Kysely } from "kysely";

const previousActions = [
  "certificate.issued",
  "course.archived",
  "course.created",
  "course.deleted",
  "course.published",
  "course.version_created",
  "enrollment.access_code_redeemed",
  "enrollment.administrator_added",
  "enrollment.administrator_removed",
  "enrollment.learning_completed",
  "enrollment.purchased",
  "enrollment.scorm_completed",
  "learning.progress_overridden",
  "order.checkout_failed",
  "order.checkout_paid",
  "order.paid_existing_enrollment",
  "resource.uploaded",
  "resource.version_removed",
  "scorm.attempt_launch_issued",
  "scorm.package_ready",
  "scorm.package_rejected",
  "scorm.package_uploaded",
  "scorm.package_version_removed",
  "survey.created",
  "survey.published",
  "survey.version_created",
  "access_grant.administrator_created",
  "access_grant.administrator_revoked",
] as const;

const actions = [
  ...previousActions,
  "access_grant.administrator_capacity_updated",
  "access_grant.administrator_code_revealed",
] as const;

function constraint(values: ReadonlyArray<string>): string {
  return values.map((value) => `'${value}'`).join(", ");
}

async function replaceAuditConstraint(
  db: Kysely<unknown>,
  values: ReadonlyArray<string>,
): Promise<void> {
  await sql`alter table audit_event
    drop constraint audit_event_action_known_ck`.execute(db);
  await sql
    .raw(
      `alter table audit_event add constraint audit_event_action_known_ck
       check (action in (${constraint(values)}))`,
    )
    .execute(db);
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("access_grant")
    .addColumn("accessCode", "text")
    .execute();
  await db.schema
    .alterTable("access_grant")
    .addCheckConstraint(
      "access_grant_plaintext_code_length_ck",
      sql`"accessCode" is null or (
        char_length("accessCode") between 8 and 80
        and "accessCode" ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'
        and char_length(replace("accessCode", '-', '')) between 8 and 64
      )`,
    )
    .execute();
  await replaceAuditConstraint(db, actions);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await replaceAuditConstraint(db, previousActions);
  await db.schema
    .alterTable("access_grant")
    .dropConstraint("access_grant_plaintext_code_length_ck")
    .execute();
  await db.schema.alterTable("access_grant").dropColumn("accessCode").execute();
}
