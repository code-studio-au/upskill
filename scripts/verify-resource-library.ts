import assert from "node:assert/strict";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { Database } from "#/server/db/types";
import {
  parseContentWorkMessage,
  RESOURCE_DELETION_TOPIC,
} from "#/server/queue/work-message";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const ids = {
  user: "verify_resource_admin",
  resource: "verify_resource_library",
  versionOne: "verify_resource_version_one",
  versionTwo: "verify_resource_version_two",
  course: "verify_resource_course",
  courseVersion: "verify_resource_course_version",
  section: "verify_resource_section",
  item: "verify_resource_item",
};
const database = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: databaseUrl }),
  }),
});

async function cleanup(): Promise<void> {
  await database
    .deleteFrom("outbox_event")
    .where("aggregateId", "in", [ids.versionOne, ids.versionTwo])
    .execute();
  await database.transaction().execute(async (transaction) => {
    await sql`select set_config('upskill.audit_maintenance', 'on', true)`.execute(
      transaction,
    );
    await sql`delete from audit_event
      where "actorUserId" = ${ids.user}`.execute(transaction);
  });
  await database
    .deleteFrom("course_version_item")
    .where("courseVersionId", "=", ids.courseVersion)
    .execute();
  await database
    .deleteFrom("course_version_section")
    .where("courseVersionId", "=", ids.courseVersion)
    .execute();
  await database
    .deleteFrom("course_version")
    .where("id", "=", ids.courseVersion)
    .execute();
  await database.deleteFrom("course").where("id", "=", ids.course).execute();
  await database
    .deleteFrom("learning_resource_version")
    .where("id", "in", [ids.versionOne, ids.versionTwo])
    .execute();
  await database
    .deleteFrom("learning_resource")
    .where("id", "=", ids.resource)
    .execute();
  await database.deleteFrom("user").where("id", "=", ids.user).execute();
}

try {
  await cleanup();
  await database
    .insertInto("user")
    .values({
      id: ids.user,
      name: "Resource verifier",
      email: "resource-verifier@example.com",
      emailVerified: true,
      image: null,
      stripeCustomerId: null,
    })
    .execute();
  await database
    .insertInto("learning_resource")
    .values({ id: ids.resource, title: "Verified policies" })
    .execute();
  await database
    .insertInto("learning_resource_version")
    .values([
      {
        id: ids.versionOne,
        resourceId: ids.resource,
        version: 1,
        displayName: "policies-v1.pdf",
        description: "Referenced version",
        objectKey: `resources/${ids.versionOne}/${"1".repeat(64)}.pdf`,
        sha256: "1".repeat(64),
        sourceBytes: 100,
        mediaType: "application/pdf",
      },
      {
        id: ids.versionTwo,
        resourceId: ids.resource,
        version: 2,
        displayName: "policies-v2.pdf",
        description: "Unreferenced version",
        objectKey: `resources/${ids.versionTwo}/${"2".repeat(64)}.pdf`,
        sha256: "2".repeat(64),
        sourceBytes: 120,
        mediaType: "application/pdf",
      },
    ])
    .execute();
  await database
    .insertInto("course")
    .values({
      id: ids.course,
      slug: "verify-resource-library",
      title: "Resource verifier course",
      status: "draft",
    })
    .execute();
  await database
    .insertInto("course_version")
    .values({
      id: ids.courseVersion,
      courseId: ids.course,
      version: 1,
      content: {},
      publishedAt: null,
    })
    .execute();
  await database
    .insertInto("course_version_section")
    .values({
      id: ids.section,
      courseVersionId: ids.courseVersion,
      position: 0,
      title: "Documents",
      description: "",
    })
    .execute();
  await database
    .insertInto("course_version_item")
    .values({
      id: ids.item,
      courseVersionId: ids.courseVersion,
      sectionId: ids.section,
      position: 0,
      kind: "resource",
      title: "Verified policies",
      required: true,
      durationMinutes: null,
      modulePosition: null,
      scormPackageVersionId: null,
      surveyVersionId: null,
      resourceVersionId: ids.versionOne,
    })
    .execute();

  const { findAdminResources, removeAdminResourceVersion } =
    await import("#/server/admin/admin-resource.server");
  const library = await findAdminResources();
  assert.equal(library.length, 1);
  assert.deepEqual(
    library[0]?.versions.map((version) => version.courseUsageCount),
    [0, 1],
  );
  assert.deepEqual(await removeAdminResourceVersion(ids.versionOne, ids.user), {
    status: "in-use",
    data: { courseUsageCount: 1 },
  });
  assert.deepEqual(await removeAdminResourceVersion(ids.versionTwo, ids.user), {
    status: "removed",
    data: { resourceId: ids.resource, resourceRemoved: false, version: 2 },
  });
  await database
    .deleteFrom("course_version_item")
    .where("id", "=", ids.item)
    .executeTakeFirstOrThrow();
  assert.deepEqual(await removeAdminResourceVersion(ids.versionOne, ids.user), {
    status: "removed",
    data: { resourceId: ids.resource, resourceRemoved: true, version: 1 },
  });

  const cleanupEvents = await database
    .selectFrom("outbox_event")
    .select(["id", "topic", "aggregateId", "payload"])
    .where("topic", "=", RESOURCE_DELETION_TOPIC)
    .where("aggregateId", "in", [ids.versionOne, ids.versionTwo])
    .orderBy("aggregateId")
    .execute();
  assert.equal(cleanupEvents.length, 2);
  for (const event of cleanupEvents)
    assert.equal(
      parseContentWorkMessage(
        JSON.stringify({
          version: 1,
          eventId: event.id,
          topic: event.topic,
          aggregateId: event.aggregateId,
          payload: event.payload,
        }),
      ).aggregateId,
      event.aggregateId,
    );
  assert.equal(
    await database
      .selectFrom("audit_event")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("actorUserId", "=", ids.user)
      .where("action", "=", "resource.version_removed")
      .executeTakeFirstOrThrow()
      .then((row) => String(row.count)),
    "2",
  );
  console.log(
    "Verified resource grouping, exact-version usage guards, durable removal audit and bounded object cleanup work",
  );
} finally {
  await cleanup();
  await database.destroy();
}
