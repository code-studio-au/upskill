import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("coordination_region")
    .addColumn("kind", "text", (column) =>
      column.notNull().defaultTo("operational"),
    )
    .execute();
  await sql`alter table coordination_region
    add constraint coordination_region_kind_ck
    check (kind in ('group', 'operational'))`.execute(db);

  await db.schema
    .createTable("event_staff_eligibility")
    .addColumn("id", "text", (column) => column.primaryKey())
    .addColumn("userId", "text", (column) =>
      column.notNull().references("user.id").onDelete("restrict"),
    )
    .addColumn("responsibility", "text", (column) => column.notNull())
    .addColumn("regionId", "text", (column) =>
      column.references("coordination_region.id").onDelete("restrict"),
    )
    .addColumn("grantedByUserId", "text", (column) =>
      column.references("user.id").onDelete("restrict"),
    )
    .addColumn("grantedAt", "timestamptz", (column) =>
      column.notNull().defaultTo(sql`now()`),
    )
    .addColumn("revokedByUserId", "text", (column) =>
      column.references("user.id").onDelete("restrict"),
    )
    .addColumn("revokedAt", "timestamptz")
    .addCheckConstraint(
      "event_staff_eligibility_responsibility_ck",
      sql`(responsibility = 'presenter' and "regionId" is null)
        or (responsibility = 'coordinator' and "regionId" is not null)`,
    )
    .addCheckConstraint(
      "event_staff_eligibility_revocation_ck",
      sql`("revokedAt" is null and "revokedByUserId" is null)
        or ("revokedAt" is not null and "revokedByUserId" is not null)`,
    )
    .execute();

  await sql`create unique index event_presenter_eligibility_active_uq
    on event_staff_eligibility ("userId")
    where responsibility = 'presenter' and "revokedAt" is null`.execute(db);

  await sql`create unique index event_coordinator_eligibility_active_uq
    on event_staff_eligibility ("userId", "regionId")
    where responsibility = 'coordinator' and "revokedAt" is null`.execute(db);

  await sql`insert into event_staff_eligibility (
      id,
      "userId",
      responsibility,
      "regionId",
      "grantedByUserId",
      "grantedAt"
    )
    select
      'staff_eligibility_migrated_' || md5(staff.responsibility || ':' || staff."userId" || ':' || coalesce(staff."regionId", 'global')),
      staff."userId",
      staff.responsibility,
      staff."regionId",
      null,
      now()
    from (
      select "userId", 'presenter' as responsibility, null::text as "regionId"
      from event_template_version_presenter_default
      union
      select "userId", 'presenter' as responsibility, null::text as "regionId"
      from event_presenter_assignment
      union
      select "userId", 'coordinator' as responsibility, "regionId"
      from event_template_version_coordinator_default
      union
      select assignments."userId", 'coordinator' as responsibility, occurrence_regions."regionId"
      from event_coordinator_assignment assignments
      inner join event_occurrence_region occurrence_regions
        on occurrence_regions.id = assignments."eventOccurrenceRegionId"
    ) staff`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("event_staff_eligibility").ifExists().execute();
  await sql`alter table coordination_region
    drop constraint if exists coordination_region_kind_ck`.execute(db);
  await db.schema
    .alterTable("coordination_region")
    .dropColumn("kind")
    .execute();
}
