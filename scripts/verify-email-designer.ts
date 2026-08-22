import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createAdminEmailDraft,
  createAdminOfferingEmail,
  findAdminEmailDesign,
  previewAdminEmail,
  publishAdminEmailVersion,
  rollbackAdminEmailVersion,
  saveAdminEmailDraft,
} from "#/server/admin/admin-email.server";
import { destroyDatabase, getDatabase } from "#/server/db/database.server";

const database = getDatabase();
const suffix = randomUUID();
const actorId = `verify_email_actor_${suffix}`;
const actor = {
  id: actorId,
  name: "Email design verifier",
  email: `email-design-${suffix}@example.com`,
  emailVerified: true,
};

try {
  const now = new Date();
  await database
    .insertInto("user")
    .values({
      id: actor.id,
      name: actor.name,
      email: actor.email,
      emailVerified: true,
      image: null,
      stripeCustomerId: null,
      createdAt: now,
      updatedAt: now,
    })
    .execute();

  const systemDesign = await database
    .selectFrom("email_design")
    .selectAll()
    .where("systemKey", "=", "account_setup_requested")
    .executeTakeFirstOrThrow();
  assert.equal(systemDesign.catalogue, "system");
  assert.ok(systemDesign.activeVersionId);
  const systemDetail = await findAdminEmailDesign(systemDesign.id);
  assert.ok(systemDetail);
  assert.equal(systemDetail.version.active, true);
  assert.equal(systemDetail.version.version, 1);
  assert.ok(systemDetail.preview);
  assert.equal(systemDetail.preview.subject, systemDetail.version.subject);
  assert.deepEqual(
    systemDetail.variableGroups
      .flatMap((group) => group.items)
      .filter((variable) => variable.label.endsWith(" *"))
      .map((variable) => variable.value)
      .sort(),
    ["account.setupUrl", "user.fullName"],
  );

  const created = await createAdminOfferingEmail(
    { name: "Event confirmation", contextKey: "offering_event" },
    actor,
  );
  assert.equal(
    await saveAdminEmailDraft({
      ...created,
      subject: "Unknown {{event.unknown}}",
      textBody: "Event update",
    }),
    "invalid",
  );
  assert.equal(
    await saveAdminEmailDraft({
      ...created,
      subject: "Confirmed: {{event.title}}",
      textBody:
        "Hello {{user.fullName}},\n\nYour event starts {{event.startsAt}}.\n\n{{event.dashboardUrl}}",
    }),
    "saved",
  );
  const preview = await previewAdminEmail({
    ...created,
    subject: "Confirmed: {{event.title}}",
    textBody:
      "Hello {{user.fullName}},\n\nYour event starts {{event.startsAt}}.\n\n{{event.dashboardUrl}}",
  });
  assert.ok(preview);
  assert.match(preview.subject, /Regional learning workshop/u);
  assert.match(preview.htmlBody, /Alex Learner/u);
  assert.equal(await publishAdminEmailVersion(created, actor), "published");
  const firstPublished = await findAdminEmailDesign(
    created.emailDesignId,
    created.versionId,
  );
  assert.ok(firstPublished);
  assert.equal(firstPublished.version.active, true);
  assert.equal(firstPublished.version.editable, false);
  assert.ok(firstPublished.preview);
  assert.match(firstPublished.preview.subject, /Regional learning workshop/u);
  await assert.rejects(
    database
      .updateTable("email_design_version")
      .set({ subject: "Mutated published subject" })
      .where("id", "=", created.versionId)
      .execute(),
    /immutable/iu,
  );

  const second = await createAdminEmailDraft(created.emailDesignId, actor);
  assert.equal(second.status, "created");
  assert.equal(
    await saveAdminEmailDraft({
      emailDesignId: created.emailDesignId,
      versionId: second.versionId,
      subject: "Updated event: {{event.title}}",
      textBody: "Hello {{user.fullName}},\n\n{{event.dashboardUrl}}",
    }),
    "saved",
  );
  assert.equal(
    await publishAdminEmailVersion(
      { emailDesignId: created.emailDesignId, versionId: second.versionId },
      actor,
    ),
    "published",
  );
  assert.equal(await rollbackAdminEmailVersion(created, actor), "rolled-back");
  const rolledBack = await findAdminEmailDesign(created.emailDesignId);
  assert.ok(rolledBack);
  assert.equal(rolledBack.version.id, created.versionId);
  assert.equal(rolledBack.versions.length, 2);

  const auditActions = await database
    .selectFrom("audit_event")
    .select("action")
    .where("subjectId", "in", [
      created.emailDesignId,
      created.versionId,
      second.versionId,
    ])
    .execute();
  assert.deepEqual(
    new Set(auditActions.map((event) => event.action)),
    new Set([
      "email_design.created",
      "email_design.published",
      "email_design.draft_created",
      "email_design.rolled_back",
    ]),
  );

  console.log(
    "Verified governed Email Designer catalogues, typed variables, immutable publication, versioning, preview and rollback",
  );
} finally {
  await destroyDatabase();
}
