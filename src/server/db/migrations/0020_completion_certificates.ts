import { sql, type Kysely } from "kysely";

const actions = [
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

function constraint(values: ReadonlyArray<string>): string {
  return values.map((value) => `'${value}'`).join(", ");
}

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("completion_certificate")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("enrollmentId", "text", (column) =>
      column.notNull().references("enrollment.id").onDelete("restrict"),
    )
    .addColumn("courseVersionId", "text", (column) =>
      column.notNull().references("course_version.id").onDelete("restrict"),
    )
    .addColumn("learnerName", "text", (column) => column.notNull())
    .addColumn("courseTitle", "text", (column) => column.notNull())
    .addColumn("completedAt", "timestamptz", (column) => column.notNull())
    .addColumn("objectKey", "text", (column) => column.notNull().unique())
    .addColumn("status", "text", (column) =>
      column.notNull().defaultTo("pending"),
    )
    .addColumn("issuedAt", "timestamptz")
    .addColumn("createdAt", "timestamptz", (column) => column.notNull())
    .addColumn("updatedAt", "timestamptz", (column) => column.notNull())
    .addUniqueConstraint("completion_certificate_completion_uq", [
      "enrollmentId",
      "completedAt",
    ])
    .addCheckConstraint(
      "completion_certificate_status_ck",
      sql`status in ('pending', 'ready')`,
    )
    .execute();

  await db.schema
    .createIndex("completion_certificate_enrollment_idx")
    .on("completion_certificate")
    .columns(["enrollmentId", "completedAt"])
    .execute();

  await sql`alter table audit_event
    drop constraint audit_event_action_known_ck`.execute(db);
  await sql
    .raw(
      `alter table audit_event add constraint audit_event_action_known_ck
       check (action in (${constraint(actions)}))`,
    )
    .execute(db);

  await sql`with eligible as (
      select
        'certificate_' || md5(enrollment.id || ':' || enrollment."completedAt"::text) as id,
        enrollment.id as "enrollmentId",
        enrollment."courseVersionId",
        "user".name as "learnerName",
        course_version.content ->> 'title' as "courseTitle",
        enrollment."completedAt"
      from enrollment
      inner join "user" on "user".id = enrollment."userId"
      inner join course_version on course_version.id = enrollment."courseVersionId"
      where enrollment."completedAt" is not null
        and coalesce((course_version.content ->> 'hasCompletionCertificate')::boolean, false)
    ), inserted as (
      insert into completion_certificate (
        id, "enrollmentId", "courseVersionId", "learnerName", "courseTitle",
        "completedAt", "objectKey", status, "issuedAt", "createdAt", "updatedAt"
      )
      select
        id, "enrollmentId", "courseVersionId", "learnerName", "courseTitle",
        "completedAt", 'certificates/' || id || '.pdf', 'pending', null,
        now(), now()
      from eligible
      on conflict ("enrollmentId", "completedAt") do nothing
      returning id, "objectKey"
    )
    insert into outbox_event (
      id, topic, "aggregateId", payload, "availableAt", "processedAt", "createdAt"
    )
    select
      'outbox_' || md5(id || ':generate'),
      'certificate.generate_requested',
      id,
      jsonb_build_object('certificateId', id, 'objectKey', "objectKey"),
      now(), null, now()
    from inserted`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`delete from outbox_event
    where topic = 'certificate.generate_requested'`.execute(db);
  await sql`alter table audit_event
    drop constraint audit_event_action_known_ck`.execute(db);
  await sql
    .raw(
      `alter table audit_event add constraint audit_event_action_known_ck
       check (action in (${constraint(
         actions.filter((action) => action !== "certificate.issued"),
       )}))`,
    )
    .execute(db);
  await db.schema
    .dropIndex("completion_certificate_enrollment_idx")
    .ifExists()
    .execute();
  await db.schema.dropTable("completion_certificate").ifExists().execute();
}
