import { sql, type Kysely } from "kysely";

const previousActions = [
  "certificate.issued",
  "course.archived",
  "course.created",
  "course.deleted",
  "course.published",
  "course.version_created",
  "enrollment.access_code_redeemed",
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
] as const;

const actions = [
  ...previousActions,
  "enrollment.administrator_added",
  "enrollment.administrator_removed",
] as const;

function constraint(values: ReadonlyArray<string>): string {
  return values.map((value) => `'${value}'`).join(", ");
}

async function replaceConstraint(
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
  await replaceConstraint(db, actions);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await replaceConstraint(db, previousActions);
}
