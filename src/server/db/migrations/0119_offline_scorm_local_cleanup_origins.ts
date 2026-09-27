import { sql, type Kysely } from "kysely";

export async function up<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table offline_scorm_cleanup_inventory
    drop constraint offline_scorm_cleanup_inventory_origin_ck,
    add constraint offline_scorm_cleanup_inventory_origin_ck check (
      char_length("packageSiteOrigin") between 9 and 2048
      and (
        "packageSiteOrigin" ~
          '^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?$'
        or "packageSiteOrigin" ~
          '^http://p-[a-f0-9]{56}[.]localhost(:[0-9]{1,5})?$'
      )
      and "packageSiteOrigin" !~ '[[:cntrl:]]'
    )`.execute(db);
}

export async function down<Database>(db: Kysely<Database>): Promise<void> {
  await sql`alter table offline_scorm_cleanup_inventory
    drop constraint offline_scorm_cleanup_inventory_origin_ck,
    add constraint offline_scorm_cleanup_inventory_origin_ck check (
      char_length("packageSiteOrigin") between 9 and 2048
      and "packageSiteOrigin" ~
        '^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?$'
      and "packageSiteOrigin" !~ '[[:cntrl:]]'
    )`.execute(db);
}
