import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import type {
  AdminEmailDesignDetail,
  AdminEmailDesignSummary,
  AdminEmailPreview,
  EmailDesignContext,
} from "#/features/admin-email/admin-email.schema";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import {
  emailContractKeyForContext,
  emailVariableGroups,
  fixtureEmailContext,
  getEmailTemplateContract,
  renderEmailTemplate,
  validateEmailTemplate,
} from "#/server/notifications/email-template-contracts";

function storedVariableKeys(value: unknown): string {
  return JSON.stringify(value);
}

function renderPreview(input: {
  contractKey: string;
  contractVersion: number;
  subject: string;
  textBody: string;
}): AdminEmailPreview | null {
  try {
    return renderEmailTemplate({
      ...input,
      variables: fixtureEmailContext(input.contractKey, input.contractVersion),
      requireMandatoryVariables: false,
    });
  } catch {
    return null;
  }
}

export async function findAdminEmailDesigns(): Promise<
  Array<AdminEmailDesignSummary>
> {
  const database = getDatabase();
  const [designs, versions] = await Promise.all([
    database
      .selectFrom("email_design")
      .selectAll()
      .orderBy("catalogue", "desc")
      .orderBy("name")
      .execute(),
    database
      .selectFrom("email_design_version")
      .select(["id", "emailDesignId", "version", "publishedAt"])
      .orderBy("version", "desc")
      .execute(),
  ]);
  return designs.map((design) => {
    const designVersions = versions.filter(
      (version) => version.emailDesignId === design.id,
    );
    return {
      id: design.id,
      catalogue: design.catalogue,
      name: design.name,
      contextKey: design.contextKey,
      systemKey: design.systemKey,
      activeVersion:
        designVersions.find((version) => version.id === design.activeVersionId)
          ?.version ?? null,
      draftVersion:
        designVersions.find((version) => version.publishedAt === null)
          ?.version ?? null,
      publishedVersions: designVersions.filter(
        (version) => version.publishedAt !== null,
      ).length,
      updatedAt: design.updatedAt.toISOString(),
    };
  });
}

export async function findAdminEmailDesign(
  emailDesignId: string,
  requestedVersionId?: string,
): Promise<AdminEmailDesignDetail | null> {
  const database = getDatabase();
  const design = await database
    .selectFrom("email_design")
    .selectAll()
    .where("id", "=", emailDesignId)
    .executeTakeFirst();
  if (!design) return null;
  const versions = await database
    .selectFrom("email_design_version")
    .selectAll()
    .where("emailDesignId", "=", design.id)
    .orderBy("version", "desc")
    .execute();
  const selected = requestedVersionId
    ? versions.find((version) => version.id === requestedVersionId)
    : (versions.find((version) => version.publishedAt === null) ??
      versions.find((version) => version.id === design.activeVersionId) ??
      versions[0]);
  if (!selected) return null;
  const contract = getEmailTemplateContract(
    selected.contractKey,
    selected.contractVersion,
  );
  return {
    design: {
      id: design.id,
      catalogue: design.catalogue,
      name: design.name,
      contextKey: design.contextKey,
      systemKey: design.systemKey,
    },
    version: {
      id: selected.id,
      version: selected.version,
      subject: selected.subject,
      textBody: selected.textBody,
      publishedAt: selected.publishedAt?.toISOString() ?? null,
      active: selected.id === design.activeVersionId,
      editable: selected.publishedAt === null,
    },
    versions: versions.map((version) => ({
      id: version.id,
      version: version.version,
      publishedAt: version.publishedAt?.toISOString() ?? null,
      active: version.id === design.activeVersionId,
    })),
    variableGroups: emailVariableGroups(contract.variables),
    preview: renderPreview({
      contractKey: selected.contractKey,
      contractVersion: selected.contractVersion,
      subject: selected.subject,
      textBody: selected.textBody,
    }),
  };
}

export async function createAdminOfferingEmail(
  input: { name: string; contextKey: EmailDesignContext },
  user: AuthenticatedUser,
): Promise<{ emailDesignId: string; versionId: string }> {
  const contractKey = emailContractKeyForContext(input.contextKey);
  if (!contractKey) throw new Error("EMAIL_TEMPLATE_CONTRACT_NOT_FOUND");
  const contract = getEmailTemplateContract(contractKey);
  const emailDesignId = `email_design_${randomUUID()}`;
  const versionId = `email_design_version_${randomUUID()}`;
  const now = new Date();
  const firstVariable = contract.variables[0];
  const textBody = firstVariable
    ? `Hello {{${firstVariable.key}}},\n\n${input.name}`
    : input.name;
  const validation = validateEmailTemplate(
    {
      contractKey,
      contractVersion: contract.version,
      subject: input.name,
      textBody,
    },
    { requireMandatoryVariables: false },
  );
  if (!validation.valid) throw new Error("EMAIL_TEMPLATE_INVALID");
  await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      await transaction
        .insertInto("email_design")
        .values({
          id: emailDesignId,
          catalogue: "offering",
          name: input.name.trim(),
          contextKey: input.contextKey,
          systemKey: null,
          activeVersionId: null,
          createdByUserId: user.id,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      await transaction
        .insertInto("email_design_version")
        .values({
          id: versionId,
          emailDesignId,
          version: 1,
          contractKey,
          contractVersion: contract.version,
          subject: input.name.trim(),
          textBody,
          referencedVariables: storedVariableKeys(
            validation.referencedVariables,
          ),
          createdByUserId: user.id,
          publishedByUserId: null,
          publishedAt: null,
          createdAt: now,
        })
        .execute();
      await recordDurableAuditEvent(transaction, {
        actorUserId: user.id,
        action: "email_design.created",
        subjectType: "email_design",
        subjectId: emailDesignId,
        aggregateId: emailDesignId,
        metadata: { catalogue: "offering", contextKey: input.contextKey },
        createdAt: now,
      });
    });
  return { emailDesignId, versionId };
}

export async function createAdminEmailDraft(
  emailDesignId: string,
  user: AuthenticatedUser,
): Promise<
  | { status: "created"; versionId: string }
  | { status: "draft-exists" | "not-found" }
> {
  const database = getDatabase();
  return database.transaction().execute(async (transaction) => {
    const design = await transaction
      .selectFrom("email_design")
      .selectAll()
      .where("id", "=", emailDesignId)
      .forUpdate()
      .executeTakeFirst();
    if (!design?.activeVersionId) return { status: "not-found" };
    const existingDraft = await transaction
      .selectFrom("email_design_version")
      .select("id")
      .where("emailDesignId", "=", design.id)
      .where("publishedAt", "is", null)
      .executeTakeFirst();
    if (existingDraft) return { status: "draft-exists" };
    const active = await transaction
      .selectFrom("email_design_version")
      .selectAll()
      .where("id", "=", design.activeVersionId)
      .executeTakeFirstOrThrow();
    const latest = await transaction
      .selectFrom("email_design_version")
      .select(({ fn }) => fn.max<number | null>("version").as("latest"))
      .where("emailDesignId", "=", design.id)
      .executeTakeFirstOrThrow();
    const versionId = `email_design_version_${randomUUID()}`;
    const now = new Date();
    const nextVersion = (latest.latest ?? 0) + 1;
    await transaction
      .insertInto("email_design_version")
      .values({
        id: versionId,
        emailDesignId: design.id,
        version: nextVersion,
        contractKey: active.contractKey,
        contractVersion: active.contractVersion,
        subject: active.subject,
        textBody: active.textBody,
        referencedVariables: storedVariableKeys(active.referencedVariables),
        createdByUserId: user.id,
        publishedByUserId: null,
        publishedAt: null,
        createdAt: now,
      })
      .execute();
    await transaction
      .updateTable("email_design")
      .set({ updatedAt: now })
      .where("id", "=", design.id)
      .execute();
    await recordDurableAuditEvent(transaction, {
      actorUserId: user.id,
      action: "email_design.draft_created",
      subjectType: "email_design_version",
      subjectId: versionId,
      aggregateId: design.id,
      metadata: { version: nextVersion },
      createdAt: now,
    });
    return { status: "created", versionId };
  });
}

export async function saveAdminEmailDraft(input: {
  emailDesignId: string;
  versionId: string;
  subject: string;
  textBody: string;
}): Promise<"invalid" | "not-found" | "published" | "saved"> {
  const database = getDatabase();
  const version = await database
    .selectFrom("email_design_version")
    .selectAll()
    .where("id", "=", input.versionId)
    .where("emailDesignId", "=", input.emailDesignId)
    .executeTakeFirst();
  if (!version) return "not-found";
  if (version.publishedAt) return "published";
  const validation = validateEmailTemplate(
    {
      contractKey: version.contractKey,
      contractVersion: version.contractVersion,
      subject: input.subject,
      textBody: input.textBody,
    },
    { requireMandatoryVariables: false },
  );
  if (!validation.valid) return "invalid";
  const now = new Date();
  await database.transaction().execute(async (transaction) => {
    await transaction
      .updateTable("email_design_version")
      .set({
        subject: input.subject.trim(),
        textBody: input.textBody.trim(),
        referencedVariables: storedVariableKeys(validation.referencedVariables),
      })
      .where("id", "=", version.id)
      .where("publishedAt", "is", null)
      .executeTakeFirstOrThrow();
    await transaction
      .updateTable("email_design")
      .set({ updatedAt: now })
      .where("id", "=", input.emailDesignId)
      .execute();
  });
  return "saved";
}

export async function previewAdminEmail(input: {
  emailDesignId: string;
  versionId: string;
  subject: string;
  textBody: string;
}): Promise<AdminEmailPreview | null> {
  const version = await getDatabase()
    .selectFrom("email_design_version")
    .select(["contractKey", "contractVersion"])
    .where("id", "=", input.versionId)
    .where("emailDesignId", "=", input.emailDesignId)
    .executeTakeFirst();
  if (!version) return null;
  return renderPreview({
    contractKey: version.contractKey,
    contractVersion: version.contractVersion,
    subject: input.subject,
    textBody: input.textBody,
  });
}

export async function publishAdminEmailVersion(
  input: { emailDesignId: string; versionId: string },
  user: AuthenticatedUser,
): Promise<"invalid" | "not-found" | "published"> {
  const database = getDatabase();
  return database.transaction().execute(async (transaction) => {
    const version = await transaction
      .selectFrom("email_design_version")
      .selectAll()
      .where("id", "=", input.versionId)
      .where("emailDesignId", "=", input.emailDesignId)
      .forUpdate()
      .executeTakeFirst();
    if (!version || version.publishedAt) return "not-found";
    const validation = validateEmailTemplate({
      contractKey: version.contractKey,
      contractVersion: version.contractVersion,
      subject: version.subject,
      textBody: version.textBody,
    });
    if (!validation.valid) return "invalid";
    const now = new Date();
    await transaction
      .updateTable("email_design_version")
      .set({ publishedAt: now, publishedByUserId: user.id })
      .where("id", "=", version.id)
      .where("publishedAt", "is", null)
      .executeTakeFirstOrThrow();
    await transaction
      .updateTable("email_design")
      .set({ activeVersionId: version.id, updatedAt: now })
      .where("id", "=", input.emailDesignId)
      .executeTakeFirstOrThrow();
    await recordDurableAuditEvent(transaction, {
      actorUserId: user.id,
      action: "email_design.published",
      subjectType: "email_design_version",
      subjectId: version.id,
      aggregateId: input.emailDesignId,
      metadata: { version: version.version },
      createdAt: now,
    });
    return "published";
  });
}

export async function rollbackAdminEmailVersion(
  input: { emailDesignId: string; versionId: string },
  user: AuthenticatedUser,
): Promise<"active" | "not-found" | "rolled-back"> {
  const database = getDatabase();
  return database.transaction().execute(async (transaction) => {
    const design = await transaction
      .selectFrom("email_design")
      .selectAll()
      .where("id", "=", input.emailDesignId)
      .forUpdate()
      .executeTakeFirst();
    const version = await transaction
      .selectFrom("email_design_version")
      .selectAll()
      .where("id", "=", input.versionId)
      .where("emailDesignId", "=", input.emailDesignId)
      .where("publishedAt", "is not", null)
      .executeTakeFirst();
    if (!design || !version) return "not-found";
    if (design.activeVersionId === version.id) return "active";
    const now = new Date();
    await transaction
      .updateTable("email_design")
      .set({ activeVersionId: version.id, updatedAt: now })
      .where("id", "=", design.id)
      .executeTakeFirstOrThrow();
    await recordDurableAuditEvent(transaction, {
      actorUserId: user.id,
      action: "email_design.rolled_back",
      subjectType: "email_design_version",
      subjectId: version.id,
      aggregateId: design.id,
      metadata: { version: version.version },
      createdAt: now,
    });
    return "rolled-back";
  });
}

export async function deleteAdminEmailDraft(
  input: { emailDesignId: string; versionId: string },
  user: AuthenticatedUser,
): Promise<"active" | "deleted" | "not-found"> {
  const database = getDatabase();
  return database.transaction().execute(async (transaction) => {
    const design = await transaction
      .selectFrom("email_design")
      .select(["activeVersionId"])
      .where("id", "=", input.emailDesignId)
      .executeTakeFirst();
    const version = await transaction
      .selectFrom("email_design_version")
      .select(["id", "version", "publishedAt"])
      .where("id", "=", input.versionId)
      .where("emailDesignId", "=", input.emailDesignId)
      .executeTakeFirst();
    if (!design || !version || version.publishedAt) return "not-found";
    if (design.activeVersionId === version.id) return "active";
    const now = new Date();
    await transaction
      .deleteFrom("email_design_version")
      .where("id", "=", version.id)
      .executeTakeFirstOrThrow();
    if (design.activeVersionId)
      await transaction
        .updateTable("email_design")
        .set({ updatedAt: now })
        .where("id", "=", input.emailDesignId)
        .execute();
    else
      await transaction
        .deleteFrom("email_design")
        .where("id", "=", input.emailDesignId)
        .executeTakeFirstOrThrow();
    await recordDurableAuditEvent(transaction, {
      actorUserId: user.id,
      action: "email_design.draft_deleted",
      subjectType: "email_design_version",
      subjectId: version.id,
      aggregateId: input.emailDesignId,
      metadata: { version: version.version },
      createdAt: now,
    });
    return "deleted";
  });
}
