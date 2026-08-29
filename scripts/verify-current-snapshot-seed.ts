import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { seedCurrentSnapshot } from "./seed-current-snapshot";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const existingCatalogueClient = new Client({ connectionString: databaseUrl });
let existingCourseEmailPosition = -1;
try {
  await existingCatalogueClient.connect();
  const inserted = await existingCatalogueClient.query<{ position: number }>(
    `insert into email_design (
       id, catalogue, name, "contextKey", "systemKey", position,
       "activeVersionId", "createdAt", "updatedAt"
     ) select
       'verify_snapshot_existing_course_email', 'offering',
       'Existing course email', 'offering_course', null,
       coalesce(max(position), -1) + 1, null, now(), now()
       from email_design
      where "contextKey" = 'offering_course'
     returning position`,
  );
  existingCourseEmailPosition = inserted.rows[0]?.position ?? -1;
} finally {
  await existingCatalogueClient.end();
}

await seedCurrentSnapshot({ provisionExternalAssets: false });

const fixture = JSON.parse(
  await readFile(
    new URL("./fixtures/current-development-snapshot.json", import.meta.url),
    "utf8",
  ),
) as {
  tables: Record<string, Array<{ id: unknown }>>;
};
const fixtureIds = (table: string) =>
  (fixture.tables[table] ?? []).map((row) => String(row.id));

const client = new Client({ connectionString: databaseUrl });
try {
  await client.connect();
  const versions = await client.query<{ table_name: string; version: number }>(
    `select 'course_version' as table_name, version from course_version where id = any($1::text[])
     union all select 'email_design_version', version from email_design_version where id = any($2::text[])
     union all select 'event_template_version', version from event_template_version where id = any($3::text[])
     union all select 'learning_activity_version', version from learning_activity_version where id = any($4::text[])
     union all select 'onboarding_definition_version', version from onboarding_definition_version where id = any($5::text[])`,
    [
      fixtureIds("course_version"),
      fixtureIds("email_design_version"),
      fixtureIds("event_template_version"),
      fixtureIds("learning_activity_version"),
      fixtureIds("onboarding_definition_version"),
    ],
  );
  assert.equal(
    versions.rows.length,
    [
      "course_version",
      "email_design_version",
      "event_template_version",
      "learning_activity_version",
      "onboarding_definition_version",
    ].reduce((total, table) => total + fixtureIds(table).length, 0),
    "Every versioned snapshot row must be present",
  );
  assert.ok(
    versions.rows.every((row) => row.version === 1),
    `Snapshot base versions must all be 1: ${JSON.stringify(
      versions.rows.filter((row) => row.version !== 1),
    )}`,
  );

  const courseEmailPositions = await client.query<{
    id: string;
    position: number;
  }>(
    `select id, position
       from email_design
      where "contextKey" = 'offering_course'
      order by position`,
  );
  assert.equal(
    courseEmailPositions.rows.find(
      (row) => row.id === "verify_snapshot_existing_course_email",
    )?.position,
    existingCourseEmailPosition,
  );
  assert.ok(
    courseEmailPositions.rows
      .filter((row) => fixtureIds("email_design").includes(row.id))
      .every((row) => row.position > existingCourseEmailPosition),
    "Snapshot email positions must append after an existing catalogue",
  );

  const sample = await client.query<{
    contracts: number;
    course_coverage: number;
    employee_eligibility: number;
    event_coverage: number;
    owners: number;
    owner_accounts: number;
    usable_codes: number;
  }>(
    `select
      (select count(*)::integer from enterprise_contract) as contracts,
      (select count(*)::integer from enterprise_contract_course_coverage) as course_coverage,
      (select count(*)::integer from enterprise_contract_employee_eligibility where "removedAt" is null) as employee_eligibility,
      (select count(*)::integer from enterprise_contract_event_coverage) as event_coverage,
      (select count(*)::integer from enterprise_contract_owner_assignment where "revokedAt" is null) as owners,
      (select count(*)::integer
         from enterprise_contract_owner_assignment owner_assignment
         inner join account on account."userId" = owner_assignment."userId"
         where owner_assignment."revokedAt" is null) as owner_accounts,
      (select count(*)::integer
         from enterprise_contract_code
         where "revokedAt" is null
           and "lookupId" is not null
           and "encryptedAccessCode" is not null) as usable_codes`,
  );
  const counts = sample.rows[0];
  assert.ok(counts);
  assert.ok(counts.contracts >= 1);
  assert.ok(counts.course_coverage >= 1);
  assert.ok(counts.employee_eligibility >= 1);
  assert.ok(counts.event_coverage >= 1);
  assert.ok(counts.owners >= 1);
  assert.equal(counts.owner_accounts, counts.owners);
  assert.equal(counts.usable_codes, counts.contracts);
  console.log(
    "Verified version-1 snapshot bases and enterprise contract sample data",
  );
} finally {
  await client.end();
}
