import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import {
  adminEventTemplateDraftSchema,
  normalizeEventDomains,
  type AdminEventOccurrenceCreateInput,
  type AdminEventTemplateCreateInput,
  type AdminEventTemplateDetail,
  type AdminEventTemplateDraft,
  type AdminEventTemplateItem,
  type AdminEventWorkspace,
} from "#/features/admin-event/admin-event.schema";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { logServerEvent } from "#/server/logging/server-logger";

function optionalDate(value: string): Date | null {
  return value ? new Date(value) : null;
}

function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function hasValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export async function findAdminEventWorkspace(): Promise<AdminEventWorkspace> {
  const database = getDatabase();
  const [
    templates,
    versions,
    occurrences,
    occurrenceDomains,
    platformAdministrators,
  ] = await Promise.all([
    database
      .selectFrom("event_template")
      .select(["id", "title", "status"])
      .orderBy("title")
      .execute(),
    database
      .selectFrom("event_template_version")
      .select(["id", "eventTemplateId", "version", "publishedAt"])
      .orderBy("version", "desc")
      .execute(),
    database
      .selectFrom("event_occurrence")
      .innerJoin(
        "event_template_version",
        "event_template_version.id",
        "event_occurrence.eventTemplateVersionId",
      )
      .innerJoin(
        "event_template",
        "event_template.id",
        "event_template_version.eventTemplateId",
      )
      .select([
        "event_occurrence.id",
        "event_occurrence.eventTemplateVersionId",
        "event_template.id as eventTemplateId",
        "event_template.title as eventTemplateTitle",
        "event_template_version.version as templateVersion",
        "event_occurrence.title",
        "event_occurrence.slug",
        "event_occurrence.status",
        "event_occurrence.deliveryMode",
        "event_occurrence.registrationMode",
        "event_occurrence.approvalMode",
        "event_occurrence.timezone",
        "event_occurrence.startsAt",
        "event_occurrence.endsAt",
        "event_occurrence.registrationOpensAt",
        "event_occurrence.registrationClosesAt",
        "event_occurrence.coordinatorLockAt",
        "event_occurrence.capacity",
        "event_occurrence.confirmedCount",
        "event_occurrence.venueName",
        "event_occurrence.venueAddress",
        "event_occurrence.virtualJoinUrl",
        sql<number>`(
          select count(*)::integer from event_session
          where event_session."eventOccurrenceId" = event_occurrence.id
        )`.as("sessionCount"),
        sql<number>`(
          select count(*)::integer from event_admin_assignment
          where event_admin_assignment."eventOccurrenceId" = event_occurrence.id
            and event_admin_assignment."endedAt" is null
        )`.as("assignedAdminCount"),
      ])
      .orderBy("event_occurrence.startsAt", "desc")
      .execute(),
    database
      .selectFrom("event_occurrence_domain")
      .select(["eventOccurrenceId", "domain"])
      .orderBy("domain")
      .execute(),
    database
      .selectFrom("platform_admin")
      .innerJoin("user", "user.id", "platform_admin.userId")
      .select(["user.id", "user.name", "user.email"])
      .orderBy("user.name")
      .orderBy("user.email")
      .execute(),
  ]);

  const versionsByTemplate = new Map<
    string,
    Array<(typeof versions)[number]>
  >();
  for (const version of versions) {
    const current = versionsByTemplate.get(version.eventTemplateId) ?? [];
    current.push(version);
    versionsByTemplate.set(version.eventTemplateId, current);
  }
  const occurrenceCounts = new Map<string, number>();
  for (const occurrence of occurrences)
    occurrenceCounts.set(
      occurrence.eventTemplateId,
      (occurrenceCounts.get(occurrence.eventTemplateId) ?? 0) + 1,
    );

  return {
    templates: templates.map((template) => {
      const templateVersions = versionsByTemplate.get(template.id) ?? [];
      const draft = templateVersions.find((version) => !version.publishedAt);
      const published = templateVersions.find((version) => version.publishedAt);
      return {
        ...template,
        latestVersion: templateVersions[0]?.version ?? 0,
        draftVersionId: draft?.id ?? null,
        publishedVersionId: published?.id ?? null,
        publishedVersion: published?.version ?? null,
        occurrenceCount: occurrenceCounts.get(template.id) ?? 0,
      };
    }),
    publishedVersions: templates.flatMap((template) => {
      const published = (versionsByTemplate.get(template.id) ?? []).find(
        (version) => version.publishedAt,
      );
      return published
        ? [
            {
              eventTemplateId: template.id,
              eventTemplateVersionId: published.id,
              title: template.title,
              version: published.version,
            },
          ]
        : [];
    }),
    platformAdministrators,
    occurrences: occurrences.map((occurrence) => ({
      ...occurrence,
      startsAt: occurrence.startsAt.toISOString(),
      endsAt: occurrence.endsAt.toISOString(),
      registrationOpensAt: occurrence.registrationOpensAt?.toISOString() ?? "",
      registrationClosesAt:
        occurrence.registrationClosesAt?.toISOString() ?? "",
      coordinatorLockAt: occurrence.coordinatorLockAt?.toISOString() ?? "",
      venueName: occurrence.venueName ?? "",
      venueAddress: occurrence.venueAddress ?? "",
      virtualJoinUrl: occurrence.virtualJoinUrl ?? "",
      domains: occurrenceDomains
        .filter((domain) => domain.eventOccurrenceId === occurrence.id)
        .map((domain) => domain.domain)
        .join(", "),
    })),
  };
}

export async function createAdminEventTemplate(
  input: AdminEventTemplateCreateInput,
  administrator: AuthenticatedUser,
): Promise<
  | {
      status: "created";
      eventTemplateId: string;
      eventTemplateVersionId: string;
    }
  | { status: "conflict" }
> {
  const eventTemplateId = `event_template_${randomUUID()}`;
  const eventTemplateVersionId = `event_template_version_${randomUUID()}`;
  const created = await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const administrators = await transaction
        .selectFrom("platform_admin")
        .select("userId")
        .where("userId", "in", input.defaultAdministratorIds)
        .execute();
      if (
        new Set(administrators.map((row) => row.userId)).size !==
        new Set(input.defaultAdministratorIds).size
      )
        return false;
      await transaction
        .insertInto("event_template")
        .values({
          id: eventTemplateId,
          title: input.title,
          status: "draft",
        })
        .execute();
      await transaction
        .insertInto("event_template_version")
        .values({
          id: eventTemplateVersionId,
          eventTemplateId,
          version: 1,
          summary: "Event summary to be completed.",
          description: "Event description to be completed.",
          hasCompletionCertificate: false,
          publishedAt: null,
        })
        .execute();
      await transaction
        .insertInto("event_template_version_admin_default")
        .values(
          input.defaultAdministratorIds.map((userId) => ({
            eventTemplateVersionId,
            userId,
          })),
        )
        .execute();
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "event_template.created",
        subjectType: "event_template",
        subjectId: eventTemplateId,
        metadata: { eventTemplateVersionId },
      });
      return true;
    });
  if (!created) return { status: "conflict" };
  return { status: "created", eventTemplateId, eventTemplateVersionId };
}

export async function startAdminEventTemplate(
  administrator: AuthenticatedUser,
) {
  return await createAdminEventTemplate(
    {
      title: "Untitled event template",
      defaultAdministratorIds: [administrator.id],
    },
    administrator,
  );
}

function eventItemFromRow(row: {
  id: string;
  kind: "session" | "scorm" | "survey" | "resource";
  title: string;
  required: boolean;
  durationMinutes: number | null;
  learningActivityVersionId: string | null;
  sessionDefinitionId: string | null;
  presenterRequired: boolean | null;
  presenterIds: Array<string>;
}): AdminEventTemplateItem {
  if (row.kind === "session")
    return {
      id: row.id,
      kind: "session",
      title: row.title,
      required: row.required,
      durationMinutes: row.durationMinutes ?? 60,
      presenterRequired: row.presenterRequired ?? true,
      presenterIds: row.presenterIds,
    };
  if (!row.learningActivityVersionId)
    throw new Error("Event activity item has no learning activity version");
  if (row.kind === "resource")
    return {
      id: row.id,
      kind: "resource",
      title: row.title,
      required: row.required,
      durationMinutes: null,
      learningActivityVersionId: row.learningActivityVersionId,
    };
  if (row.kind === "scorm")
    return {
      id: row.id,
      kind: "scorm",
      title: row.title,
      required: row.required,
      durationMinutes: row.durationMinutes ?? 1,
      learningActivityVersionId: row.learningActivityVersionId,
    };
  return {
    id: row.id,
    kind: "survey",
    title: row.title,
    required: row.required,
    durationMinutes: row.durationMinutes,
    learningActivityVersionId: row.learningActivityVersionId,
  };
}

async function loadEventTemplateDraft(
  database: Transaction<Database> | ReturnType<typeof getDatabase>,
  template: { id: string; title: string },
  version: {
    id: string;
    summary: string;
    description: string;
    hasCompletionCertificate: boolean;
  },
): Promise<AdminEventTemplateDraft> {
  const [sectionRows, presenterRows, administratorRows, regionRows] =
    await Promise.all([
      database
        .selectFrom("event_template_version_section as sections")
        .leftJoin("event_template_version_item as items", (join) =>
          join
            .onRef("items.sectionId", "=", "sections.id")
            .onRef(
              "items.eventTemplateVersionId",
              "=",
              "sections.eventTemplateVersionId",
            ),
        )
        .leftJoin(
          "event_template_session_definition as sessions",
          "sessions.id",
          "items.sessionDefinitionId",
        )
        .select([
          "sections.id as sectionId",
          "sections.title as sectionTitle",
          "sections.description as sectionDescription",
          "items.id as itemId",
          "items.kind as itemKind",
          "items.title as itemTitle",
          "items.required as itemRequired",
          "items.durationMinutes",
          "items.learningActivityVersionId",
          "items.sessionDefinitionId",
          "sessions.presenterRequired",
        ])
        .where("sections.eventTemplateVersionId", "=", version.id)
        .orderBy("sections.position")
        .orderBy("items.position")
        .execute(),
      database
        .selectFrom("event_template_version_presenter_default")
        .select(["sessionDefinitionId", "userId"])
        .where("eventTemplateVersionId", "=", version.id)
        .execute(),
      database
        .selectFrom("event_template_version_admin_default")
        .select("userId")
        .where("eventTemplateVersionId", "=", version.id)
        .orderBy("userId")
        .execute(),
      database
        .selectFrom("event_template_version_region as regions")
        .leftJoin(
          "event_template_version_coordinator_default as coordinators",
          (join) =>
            join
              .onRef(
                "coordinators.eventTemplateVersionId",
                "=",
                "regions.eventTemplateVersionId",
              )
              .onRef("coordinators.regionId", "=", "regions.regionId"),
        )
        .select(["regions.regionId", "coordinators.userId"])
        .where("regions.eventTemplateVersionId", "=", version.id)
        .orderBy("regions.position")
        .orderBy("coordinators.userId")
        .execute(),
    ]);

  const sections = new Map<
    string,
    AdminEventTemplateDraft["sections"][number]
  >();
  for (const row of sectionRows) {
    let section = sections.get(row.sectionId);
    if (!section) {
      section = {
        id: row.sectionId,
        title: row.sectionTitle,
        description: row.sectionDescription,
        items: [],
      };
      sections.set(row.sectionId, section);
    }
    if (row.itemId && row.itemKind && row.itemTitle)
      section.items.push(
        eventItemFromRow({
          id: row.itemId,
          kind: row.itemKind,
          title: row.itemTitle,
          required: row.itemRequired ?? true,
          durationMinutes: row.durationMinutes,
          learningActivityVersionId: row.learningActivityVersionId,
          sessionDefinitionId: row.sessionDefinitionId,
          presenterRequired: row.presenterRequired,
          presenterIds: presenterRows
            .filter(
              (presenter) =>
                presenter.sessionDefinitionId === row.sessionDefinitionId,
            )
            .map((presenter) => presenter.userId),
        }),
      );
  }
  const regions = new Map<string, Array<string>>();
  for (const row of regionRows) {
    const coordinators = regions.get(row.regionId) ?? [];
    if (row.userId) coordinators.push(row.userId);
    regions.set(row.regionId, coordinators);
  }
  return adminEventTemplateDraftSchema.parse({
    eventTemplateId: template.id,
    eventTemplateVersionId: version.id,
    title: template.title,
    summary: version.summary,
    description: version.description,
    hasCompletionCertificate: version.hasCompletionCertificate,
    defaultAdministratorIds: administratorRows.map((row) => row.userId),
    regions: [...regions].map(([regionId, coordinatorIds]) => ({
      regionId,
      coordinatorIds,
    })),
    sections: [...sections.values()],
  });
}

export async function findAdminEventTemplate(
  eventTemplateId: string,
): Promise<AdminEventTemplateDetail | null> {
  const database = getDatabase();
  const template = await database
    .selectFrom("event_template")
    .select(["id", "title", "status"])
    .where("id", "=", eventTemplateId)
    .executeTakeFirst();
  if (!template) return null;
  const versions = await database
    .selectFrom("event_template_version")
    .select([
      "id",
      "version",
      "summary",
      "description",
      "hasCompletionCertificate",
      "publishedAt",
    ])
    .where("eventTemplateId", "=", eventTemplateId)
    .orderBy("version", "desc")
    .execute();
  const version =
    versions.find((candidate) => !candidate.publishedAt) ?? versions[0];
  if (!version) throw new Error("Event template has no version");
  const [
    draft,
    platformAdministrators,
    users,
    regions,
    modules,
    surveys,
    resources,
  ] = await Promise.all([
    loadEventTemplateDraft(database, template, version),
    database
      .selectFrom("platform_admin")
      .innerJoin("user", "user.id", "platform_admin.userId")
      .select(["user.id", "user.name", "user.email"])
      .orderBy("user.name")
      .execute(),
    database
      .selectFrom("user")
      .select(["id", "name", "email"])
      .orderBy("name")
      .orderBy("email")
      .execute(),
    database
      .selectFrom("coordination_region")
      .select(["id", "name", "code"])
      .where("status", "=", "active")
      .orderBy("name")
      .execute(),
    database
      .selectFrom("scorm_package_version")
      .innerJoin(
        "learning_activity_version",
        "learning_activity_version.id",
        "scorm_package_version.id",
      )
      .innerJoin(
        "learning_activity",
        "learning_activity.id",
        "learning_activity_version.activityId",
      )
      .select([
        "scorm_package_version.id",
        "learning_activity.title",
        "learning_activity_version.version",
      ])
      .where("scorm_package_version.status", "=", "ready")
      .orderBy("learning_activity.title")
      .orderBy("learning_activity_version.version", "desc")
      .execute(),
    database
      .selectFrom("survey_version")
      .innerJoin(
        "learning_activity_version",
        "learning_activity_version.id",
        "survey_version.id",
      )
      .innerJoin(
        "learning_activity",
        "learning_activity.id",
        "learning_activity_version.activityId",
      )
      .select([
        "survey_version.id",
        "learning_activity.title",
        "learning_activity_version.version",
      ])
      .where("learning_activity_version.publishedAt", "is not", null)
      .orderBy("learning_activity.title")
      .orderBy("learning_activity_version.version", "desc")
      .execute(),
    database
      .selectFrom("learning_resource_version")
      .innerJoin(
        "learning_activity_version",
        "learning_activity_version.id",
        "learning_resource_version.id",
      )
      .innerJoin(
        "learning_activity",
        "learning_activity.id",
        "learning_activity_version.activityId",
      )
      .select([
        "learning_resource_version.id",
        "learning_activity.title",
        "learning_activity_version.version",
      ])
      .orderBy("learning_activity.title")
      .orderBy("learning_activity_version.version", "desc")
      .execute(),
  ]);
  return {
    template,
    version: {
      id: version.id,
      version: version.version,
      publishedAt: version.publishedAt?.toISOString() ?? null,
      editable: !version.publishedAt && template.status !== "archived",
    },
    versions: versions.map((candidate) => ({
      id: candidate.id,
      version: candidate.version,
      publishedAt: candidate.publishedAt?.toISOString() ?? null,
    })),
    draft,
    people: { platformAdministrators, users },
    regions,
    library: { modules, surveys, resources },
  };
}

async function validateEventDraftReferences(
  transaction: Transaction<Database>,
  draft: AdminEventTemplateDraft,
): Promise<boolean> {
  const administratorIds = new Set(draft.defaultAdministratorIds);
  const userIds = new Set([
    ...draft.regions.flatMap((region) => region.coordinatorIds),
    ...draft.sections.flatMap((section) =>
      section.items.flatMap((item) =>
        item.kind === "session" ? item.presenterIds : [],
      ),
    ),
  ]);
  const activityIds = draft.sections.flatMap((section) =>
    section.items.flatMap((item) =>
      item.kind === "session" ? [] : [item.learningActivityVersionId],
    ),
  );
  const regionIds = new Set(draft.regions.map((region) => region.regionId));
  const [administrators, users, activities, regions] = await Promise.all([
    transaction
      .selectFrom("platform_admin")
      .select("userId")
      .where("userId", "in", [...administratorIds])
      .execute(),
    userIds.size
      ? transaction
          .selectFrom("user")
          .select("id")
          .where("id", "in", [...userIds])
          .execute()
      : [],
    activityIds.length
      ? transaction
          .selectFrom("learning_activity_version")
          .select("id")
          .where("id", "in", activityIds)
          .execute()
      : [],
    regionIds.size
      ? transaction
          .selectFrom("coordination_region")
          .select("id")
          .where("id", "in", [...regionIds])
          .where("status", "=", "active")
          .execute()
      : [],
  ]);
  return (
    new Set(administrators.map((row) => row.userId)).size ===
      administratorIds.size &&
    new Set(users.map((row) => row.id)).size === userIds.size &&
    new Set(activities.map((row) => row.id)).size ===
      new Set(activityIds).size &&
    new Set(regions.map((row) => row.id)).size === regionIds.size
  );
}

async function replaceEventDraftStructure(
  transaction: Transaction<Database>,
  draft: AdminEventTemplateDraft,
): Promise<void> {
  await transaction
    .deleteFrom("event_template_version_item")
    .where("eventTemplateVersionId", "=", draft.eventTemplateVersionId)
    .execute();
  await transaction
    .deleteFrom("event_template_version_section")
    .where("eventTemplateVersionId", "=", draft.eventTemplateVersionId)
    .execute();
  await transaction
    .deleteFrom("event_template_version_presenter_default")
    .where("eventTemplateVersionId", "=", draft.eventTemplateVersionId)
    .execute();
  await transaction
    .deleteFrom("event_template_session_definition")
    .where("eventTemplateVersionId", "=", draft.eventTemplateVersionId)
    .execute();
  await transaction
    .deleteFrom("event_template_version_coordinator_default")
    .where("eventTemplateVersionId", "=", draft.eventTemplateVersionId)
    .execute();
  await transaction
    .deleteFrom("event_template_version_region")
    .where("eventTemplateVersionId", "=", draft.eventTemplateVersionId)
    .execute();
  await transaction
    .deleteFrom("event_template_version_admin_default")
    .where("eventTemplateVersionId", "=", draft.eventTemplateVersionId)
    .execute();

  await transaction
    .insertInto("event_template_version_admin_default")
    .values(
      draft.defaultAdministratorIds.map((userId) => ({
        eventTemplateVersionId: draft.eventTemplateVersionId,
        userId,
      })),
    )
    .execute();
  for (const [position, region] of draft.regions.entries()) {
    await transaction
      .insertInto("event_template_version_region")
      .values({
        eventTemplateVersionId: draft.eventTemplateVersionId,
        regionId: region.regionId,
        position,
      })
      .execute();
    await transaction
      .insertInto("event_template_version_coordinator_default")
      .values(
        region.coordinatorIds.map((userId) => ({
          eventTemplateVersionId: draft.eventTemplateVersionId,
          regionId: region.regionId,
          userId,
        })),
      )
      .execute();
  }
  let sessionPosition = 0;
  for (const [sectionPosition, section] of draft.sections.entries()) {
    await transaction
      .insertInto("event_template_version_section")
      .values({
        id: section.id,
        eventTemplateVersionId: draft.eventTemplateVersionId,
        position: sectionPosition,
        title: section.title,
        description: section.description,
      })
      .execute();
    for (const [itemPosition, item] of section.items.entries()) {
      const sessionDefinitionId =
        item.kind === "session"
          ? `event_session_definition_${randomUUID()}`
          : null;
      if (item.kind === "session" && sessionDefinitionId) {
        await transaction
          .insertInto("event_template_session_definition")
          .values({
            id: sessionDefinitionId,
            eventTemplateVersionId: draft.eventTemplateVersionId,
            position: sessionPosition++,
            title: item.title,
            durationMinutes: item.durationMinutes,
            presenterRequired: item.presenterRequired,
          })
          .execute();
        if (item.presenterIds.length)
          await transaction
            .insertInto("event_template_version_presenter_default")
            .values(
              item.presenterIds.map((userId) => ({
                eventTemplateVersionId: draft.eventTemplateVersionId,
                sessionDefinitionId,
                userId,
                scopeKey: sessionDefinitionId,
              })),
            )
            .execute();
      }
      await transaction
        .insertInto("event_template_version_item")
        .values({
          id: item.id,
          eventTemplateVersionId: draft.eventTemplateVersionId,
          sectionId: section.id,
          position: itemPosition,
          kind: item.kind,
          title: item.title,
          required: item.required,
          durationMinutes: item.durationMinutes,
          learningActivityVersionId:
            item.kind === "session" ? null : item.learningActivityVersionId,
          sessionDefinitionId,
        })
        .execute();
    }
  }
}

export async function saveAdminEventTemplateDraft(
  draft: AdminEventTemplateDraft,
  administrator: AuthenticatedUser,
): Promise<"saved" | "not-found" | "conflict"> {
  const result = await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const version = await transaction
        .selectFrom("event_template_version")
        .innerJoin(
          "event_template",
          "event_template.id",
          "event_template_version.eventTemplateId",
        )
        .select(["event_template_version.publishedAt", "event_template.status"])
        .where("event_template_version.id", "=", draft.eventTemplateVersionId)
        .where("event_template.id", "=", draft.eventTemplateId)
        .forUpdate()
        .executeTakeFirst();
      if (!version) return "not-found" as const;
      if (version.publishedAt || version.status === "archived")
        return "conflict" as const;
      if (!(await validateEventDraftReferences(transaction, draft)))
        return "conflict" as const;
      await transaction
        .updateTable("event_template")
        .set({ title: draft.title, updatedAt: new Date() })
        .where("id", "=", draft.eventTemplateId)
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable("event_template_version")
        .set({
          summary: draft.summary,
          description: draft.description,
          hasCompletionCertificate: draft.hasCompletionCertificate,
        })
        .where("id", "=", draft.eventTemplateVersionId)
        .executeTakeFirstOrThrow();
      await replaceEventDraftStructure(transaction, draft);
      return "saved" as const;
    });
  if (result === "saved")
    logServerEvent({
      level: "info",
      event: "event_template.draft_saved",
      fields: {
        actorUserId: administrator.id,
        entityType: "event_template",
        entityId: draft.eventTemplateId,
      },
    });
  return result;
}

export async function createAdminEventTemplateVersion(
  eventTemplateId: string,
  administrator: AuthenticatedUser,
): Promise<
  | { status: "created"; eventTemplateVersionId: string }
  | { status: "not-found" | "conflict" }
> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const template = await transaction
        .selectFrom("event_template")
        .select(["id", "title", "status"])
        .where("id", "=", eventTemplateId)
        .forUpdate()
        .executeTakeFirst();
      if (!template) return { status: "not-found" } as const;
      if (template.status === "archived")
        return { status: "conflict" } as const;
      const versions = await transaction
        .selectFrom("event_template_version")
        .select([
          "id",
          "version",
          "summary",
          "description",
          "hasCompletionCertificate",
          "publishedAt",
        ])
        .where("eventTemplateId", "=", eventTemplateId)
        .orderBy("version", "desc")
        .execute();
      if (versions.some((version) => !version.publishedAt))
        return { status: "conflict" } as const;
      const source = versions[0];
      if (!source) return { status: "not-found" } as const;
      const eventTemplateVersionId = `event_template_version_${randomUUID()}`;
      await transaction
        .insertInto("event_template_version")
        .values({
          id: eventTemplateVersionId,
          eventTemplateId,
          version: source.version + 1,
          summary: source.summary,
          description: source.description,
          hasCompletionCertificate: source.hasCompletionCertificate,
          publishedAt: null,
        })
        .execute();
      const sourceDraft = await loadEventTemplateDraft(
        transaction,
        template,
        source,
      );
      const draft: AdminEventTemplateDraft = {
        ...sourceDraft,
        eventTemplateVersionId,
        sections: sourceDraft.sections.map((section) => ({
          ...section,
          id: `event_section_${randomUUID()}`,
          items: section.items.map((item) => ({
            ...item,
            id: `event_item_${randomUUID()}`,
          })),
        })),
      };
      await replaceEventDraftStructure(transaction, draft);
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "event_template.version_created",
        subjectType: "event_template_version",
        subjectId: eventTemplateVersionId,
        aggregateId: eventTemplateId,
        metadata: { sourceVersionId: source.id, version: source.version + 1 },
      });
      return { status: "created", eventTemplateVersionId } as const;
    });
}

export async function publishAdminEventTemplateVersion(
  eventTemplateId: string,
  eventTemplateVersionId: string,
  administrator: AuthenticatedUser,
): Promise<"published" | "not-found" | "conflict"> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const version = await transaction
        .selectFrom("event_template_version")
        .innerJoin(
          "event_template",
          "event_template.id",
          "event_template_version.eventTemplateId",
        )
        .select([
          "event_template_version.id",
          "event_template_version.version",
          "event_template_version.publishedAt",
          "event_template.status",
          "event_template.title",
        ])
        .where("event_template_version.id", "=", eventTemplateVersionId)
        .where("event_template.id", "=", eventTemplateId)
        .forUpdate()
        .executeTakeFirst();
      if (!version) return "not-found" as const;
      if (
        version.publishedAt ||
        version.status === "archived" ||
        version.title === "Untitled event template"
      )
        return "conflict" as const;
      const [administratorCoverage, presenterCoverage, structure] =
        await Promise.all([
          transaction
            .selectFrom("event_template_version_admin_default as defaults")
            .leftJoin(
              "platform_admin",
              "platform_admin.userId",
              "defaults.userId",
            )
            .select([
              sql<number>`count(*)::integer`.as("configured"),
              sql<number>`count(platform_admin."userId")::integer`.as("active"),
            ])
            .where(
              "defaults.eventTemplateVersionId",
              "=",
              eventTemplateVersionId,
            )
            .executeTakeFirstOrThrow(),
          transaction
            .selectFrom("event_template_session_definition as sessions")
            .select([
              sql<number>`count(*) filter (where sessions."presenterRequired")::integer`.as(
                "required",
              ),
              sql<number>`count(*) filter (
              where sessions."presenterRequired" and exists (
                select 1 from event_template_version_presenter_default presenters
                where presenters."eventTemplateVersionId" = sessions."eventTemplateVersionId"
                  and presenters."sessionDefinitionId" = sessions.id
              )
            )::integer`.as("covered"),
            ])
            .where(
              "sessions.eventTemplateVersionId",
              "=",
              eventTemplateVersionId,
            )
            .executeTakeFirstOrThrow(),
          transaction
            .selectFrom("event_template_version_section as sections")
            .leftJoin(
              "event_template_version_item as items",
              "items.sectionId",
              "sections.id",
            )
            .select([
              sql<number>`count(distinct sections.id)::integer`.as("sections"),
              sql<number>`count(items.id)::integer`.as("items"),
              sql<number>`count(items.id) filter (where items.kind = 'session')::integer`.as(
                "sessions",
              ),
            ])
            .where(
              "sections.eventTemplateVersionId",
              "=",
              eventTemplateVersionId,
            )
            .executeTakeFirstOrThrow(),
        ]);
      if (
        structure.sections === 0 ||
        structure.items === 0 ||
        structure.sessions === 0 ||
        administratorCoverage.configured === 0 ||
        administratorCoverage.configured !== administratorCoverage.active ||
        presenterCoverage.required !== presenterCoverage.covered
      )
        return "conflict" as const;
      const regionCoverage = await transaction
        .selectFrom("event_template_version_region as regions")
        .select([
          sql<number>`count(*)::integer`.as("configured"),
          sql<number>`count(*) filter (where exists (
            select 1 from event_template_version_coordinator_default coordinators
            where coordinators."eventTemplateVersionId" = regions."eventTemplateVersionId"
              and coordinators."regionId" = regions."regionId"
          ))::integer`.as("covered"),
        ])
        .where("regions.eventTemplateVersionId", "=", eventTemplateVersionId)
        .executeTakeFirstOrThrow();
      if (regionCoverage.configured !== regionCoverage.covered)
        return "conflict" as const;
      const now = new Date();
      await transaction
        .updateTable("event_template_version")
        .set({ publishedAt: now })
        .where("id", "=", eventTemplateVersionId)
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable("event_template")
        .set({ status: "published", updatedAt: now })
        .where("id", "=", eventTemplateId)
        .executeTakeFirstOrThrow();
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "event_template.version_published",
        subjectType: "event_template_version",
        subjectId: eventTemplateVersionId,
        aggregateId: eventTemplateId,
        metadata: { version: version.version },
        createdAt: now,
      });
      return "published" as const;
    });
}

export async function createAdminEventOccurrence(
  input: AdminEventOccurrenceCreateInput,
  administrator: AuthenticatedUser,
): Promise<
  | { status: "created"; eventOccurrenceId: string }
  | { status: "not-found" }
  | { status: "conflict" }
  | { status: "slug-in-use" }
> {
  if (!hasValidTimezone(input.timezone)) return { status: "conflict" };
  const domains = normalizeEventDomains(input.domains);
  if (!domains) return { status: "conflict" };
  const eventOccurrenceId = `event_occurrence_${randomUUID()}`;
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(hashtext(${input.slug}))`.execute(
        transaction,
      );
      const slugOwner = await transaction
        .selectFrom("event_occurrence")
        .select("id")
        .where("slug", "=", input.slug)
        .executeTakeFirst();
      if (slugOwner) return { status: "slug-in-use" } as const;
      const version = await transaction
        .selectFrom("event_template_version")
        .innerJoin(
          "event_template",
          "event_template.id",
          "event_template_version.eventTemplateId",
        )
        .select([
          "event_template_version.id",
          "event_template_version.publishedAt",
          "event_template.status",
        ])
        .where("event_template_version.id", "=", input.eventTemplateVersionId)
        .executeTakeFirst();
      if (!version) return { status: "not-found" } as const;
      if (!version.publishedAt || version.status === "archived")
        return { status: "conflict" } as const;
      const [
        configuredAdminDefaults,
        activeAdminDefaults,
        sessionDefinitions,
        presenterDefaults,
        regions,
      ] = await Promise.all([
        transaction
          .selectFrom("event_template_version_admin_default")
          .select("userId")
          .where("eventTemplateVersionId", "=", version.id)
          .execute(),
        transaction
          .selectFrom("event_template_version_admin_default as defaults")
          .innerJoin(
            "platform_admin",
            "platform_admin.userId",
            "defaults.userId",
          )
          .select("defaults.userId")
          .where("defaults.eventTemplateVersionId", "=", version.id)
          .execute(),
        transaction
          .selectFrom("event_template_session_definition")
          .selectAll()
          .where("eventTemplateVersionId", "=", version.id)
          .orderBy("position")
          .execute(),
        transaction
          .selectFrom("event_template_version_presenter_default")
          .select(["sessionDefinitionId", "userId", "scopeKey"])
          .where("eventTemplateVersionId", "=", version.id)
          .execute(),
        transaction
          .selectFrom("event_template_version_region as template_region")
          .select(["template_region.regionId", "template_region.position"])
          .where("template_region.eventTemplateVersionId", "=", version.id)
          .orderBy("template_region.position")
          .execute(),
      ]);
      if (
        configuredAdminDefaults.length === 0 ||
        activeAdminDefaults.length !== configuredAdminDefaults.length ||
        sessionDefinitions.length === 0
      )
        return { status: "conflict" } as const;
      if (
        sessionDefinitions.some(
          (session) =>
            session.presenterRequired &&
            !presenterDefaults.some(
              (presenter) => presenter.sessionDefinitionId === session.id,
            ),
        )
      )
        return { status: "conflict" } as const;
      const coordinatorDefaults = await transaction
        .selectFrom("event_template_version_coordinator_default")
        .select(["regionId", "userId"])
        .where("eventTemplateVersionId", "=", version.id)
        .execute();
      if (
        regions.some(
          (region) =>
            !coordinatorDefaults.some(
              (coordinator) => coordinator.regionId === region.regionId,
            ),
        )
      )
        return { status: "conflict" } as const;

      const startsAt = new Date(input.startsAt);
      const endsAt = new Date(input.endsAt);
      const totalSessionMinutes = sessionDefinitions.reduce(
        (total, session) => total + session.durationMinutes,
        0,
      );
      if (endsAt.getTime() - startsAt.getTime() < totalSessionMinutes * 60_000)
        return { status: "conflict" } as const;
      const now = new Date();
      await transaction
        .insertInto("event_occurrence")
        .values({
          id: eventOccurrenceId,
          eventTemplateVersionId: version.id,
          title: input.title,
          slug: input.slug,
          status: "draft",
          deliveryMode: input.deliveryMode,
          registrationMode: input.registrationMode,
          approvalMode: input.approvalMode,
          timezone: input.timezone,
          startsAt,
          endsAt,
          registrationOpensAt: optionalDate(input.registrationOpensAt),
          registrationClosesAt: optionalDate(input.registrationClosesAt),
          coordinatorLockAt: optionalDate(input.coordinatorLockAt),
          capacity: input.capacity,
          venueName: optionalText(input.venueName),
          venueAddress: optionalText(input.venueAddress),
          virtualJoinUrl: optionalText(input.virtualJoinUrl),
          publishedAt: null,
          createdByUserId: administrator.id,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      if (domains.length)
        await transaction
          .insertInto("event_occurrence_domain")
          .values(
            domains.map((domain) => ({
              eventOccurrenceId,
              domain,
              createdAt: now,
            })),
          )
          .execute();
      for (const adminDefault of activeAdminDefaults)
        await transaction
          .insertInto("event_admin_assignment")
          .values({
            id: `event_admin_assignment_${randomUUID()}`,
            eventOccurrenceId,
            userId: adminDefault.userId,
            source: "template_default",
            assignedByUserId: administrator.id,
            assignedAt: now,
            endedAt: null,
            endReason: null,
          })
          .execute();
      let sessionStartsAt = startsAt;
      for (const sessionDefinition of sessionDefinitions) {
        const sessionId = `event_session_${randomUUID()}`;
        const sessionEndsAt = new Date(
          sessionStartsAt.getTime() +
            sessionDefinition.durationMinutes * 60_000,
        );
        await transaction
          .insertInto("event_session")
          .values({
            id: sessionId,
            eventOccurrenceId,
            sessionDefinitionId: sessionDefinition.id,
            position: sessionDefinition.position,
            title: sessionDefinition.title,
            startsAt: sessionStartsAt,
            endsAt: sessionEndsAt,
            presenterRequired: sessionDefinition.presenterRequired,
            venueName: optionalText(input.venueName),
            venueAddress: optionalText(input.venueAddress),
            virtualJoinUrl: optionalText(input.virtualJoinUrl),
          })
          .execute();
        for (const presenter of presenterDefaults.filter(
          (candidate) => candidate.sessionDefinitionId === sessionDefinition.id,
        ))
          await transaction
            .insertInto("event_presenter_assignment")
            .values({
              id: `event_presenter_assignment_${randomUUID()}`,
              eventOccurrenceId,
              eventSessionId: sessionId,
              userId: presenter.userId,
              scopeKey: sessionId,
              source: "template_default",
              assignedByUserId: administrator.id,
              assignedAt: now,
              endedAt: null,
              endReason: null,
            })
            .execute();
        sessionStartsAt = sessionEndsAt;
      }
      for (const region of regions) {
        const eventOccurrenceRegionId = `event_occurrence_region_${randomUUID()}`;
        await transaction
          .insertInto("event_occurrence_region")
          .values({
            id: eventOccurrenceRegionId,
            eventOccurrenceId,
            regionId: region.regionId,
            position: region.position,
            retiredAt: null,
          })
          .execute();
        for (const coordinator of coordinatorDefaults.filter(
          (candidate) => candidate.regionId === region.regionId,
        ))
          await transaction
            .insertInto("event_coordinator_assignment")
            .values({
              id: `event_coordinator_assignment_${randomUUID()}`,
              eventOccurrenceRegionId,
              userId: coordinator.userId,
              source: "template_default",
              assignedByUserId: administrator.id,
              assignedAt: now,
              endedAt: null,
              endReason: null,
            })
            .execute();
      }
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "event_occurrence.created",
        subjectType: "event_occurrence",
        subjectId: eventOccurrenceId,
        metadata: { eventTemplateVersionId: version.id },
        createdAt: now,
      });
      return { status: "created", eventOccurrenceId } as const;
    });
}

export async function updateAdminEventOccurrence(
  eventOccurrenceId: string,
  input: AdminEventOccurrenceCreateInput,
  administrator: AuthenticatedUser,
): Promise<"updated" | "not-found" | "conflict" | "slug-in-use"> {
  if (!hasValidTimezone(input.timezone)) return "conflict";
  const domains = normalizeEventDomains(input.domains);
  if (!domains) return "conflict";

  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(hashtext(${input.slug}))`.execute(
        transaction,
      );
      const slugOwner = await transaction
        .selectFrom("event_occurrence")
        .select("id")
        .where("slug", "=", input.slug)
        .where("id", "!=", eventOccurrenceId)
        .executeTakeFirst();
      if (slugOwner) return "slug-in-use" as const;
      const occurrence = await transaction
        .selectFrom("event_occurrence")
        .select([
          "eventTemplateVersionId",
          "startsAt",
          "confirmedCount",
          "status",
        ])
        .where("id", "=", eventOccurrenceId)
        .executeTakeFirst();
      if (!occurrence) return "not-found" as const;
      if (
        occurrence.eventTemplateVersionId !== input.eventTemplateVersionId ||
        occurrence.status !== "draft" ||
        input.capacity < occurrence.confirmedCount
      )
        return "conflict" as const;

      const sessions = await transaction
        .selectFrom("event_session")
        .select(["id", "startsAt", "endsAt"])
        .where("eventOccurrenceId", "=", eventOccurrenceId)
        .execute();
      const startsAt = new Date(input.startsAt);
      const endsAt = new Date(input.endsAt);
      const sessionMinutes = sessions.reduce(
        (total, session) =>
          total +
          (session.endsAt.getTime() - session.startsAt.getTime()) / 60_000,
        0,
      );
      if (endsAt.getTime() - startsAt.getTime() < sessionMinutes * 60_000)
        return "conflict" as const;

      const now = new Date();
      await transaction
        .updateTable("event_occurrence")
        .set({
          title: input.title,
          slug: input.slug,
          deliveryMode: input.deliveryMode,
          registrationMode: input.registrationMode,
          approvalMode: input.approvalMode,
          timezone: input.timezone,
          startsAt,
          endsAt,
          registrationOpensAt: optionalDate(input.registrationOpensAt),
          registrationClosesAt: optionalDate(input.registrationClosesAt),
          coordinatorLockAt: optionalDate(input.coordinatorLockAt),
          capacity: input.capacity,
          venueName: optionalText(input.venueName),
          venueAddress: optionalText(input.venueAddress),
          virtualJoinUrl: optionalText(input.virtualJoinUrl),
          updatedAt: now,
        })
        .where("id", "=", eventOccurrenceId)
        .execute();

      const startDelta = startsAt.getTime() - occurrence.startsAt.getTime();
      for (const session of sessions)
        await transaction
          .updateTable("event_session")
          .set({
            startsAt: new Date(session.startsAt.getTime() + startDelta),
            endsAt: new Date(session.endsAt.getTime() + startDelta),
            venueName: optionalText(input.venueName),
            venueAddress: optionalText(input.venueAddress),
            virtualJoinUrl: optionalText(input.virtualJoinUrl),
          })
          .where("id", "=", session.id)
          .execute();

      await transaction
        .deleteFrom("event_occurrence_domain")
        .where("eventOccurrenceId", "=", eventOccurrenceId)
        .execute();
      if (domains.length)
        await transaction
          .insertInto("event_occurrence_domain")
          .values(
            domains.map((domain) => ({
              eventOccurrenceId,
              domain,
              createdAt: now,
            })),
          )
          .execute();

      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "event_occurrence.updated",
        subjectType: "event_occurrence",
        subjectId: eventOccurrenceId,
        metadata: { eventTemplateVersionId: input.eventTemplateVersionId },
        createdAt: now,
      });
      return "updated" as const;
    });
}

export async function rescheduleAdminEventOccurrence(
  eventOccurrenceId: string,
  input: {
    occurrence: AdminEventOccurrenceCreateInput;
    registrationWindowPolicy: "keep" | "replace_future" | "reopen";
    regionsConfirmed: true;
  },
  administrator: AuthenticatedUser,
): Promise<
  | "rescheduled"
  | "not-found"
  | "conflict"
  | "slug-in-use"
  | "invalid-window-policy"
  | "regions-not-confirmed"
> {
  const next = input.occurrence;
  if (!hasValidTimezone(next.timezone)) return "conflict";
  const domains = normalizeEventDomains(next.domains);
  if (!domains) return "conflict";

  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(hashtext(${eventOccurrenceId}))`.execute(
        transaction,
      );
      const occurrence = await transaction
        .selectFrom("event_occurrence")
        .selectAll()
        .where("id", "=", eventOccurrenceId)
        .forUpdate()
        .executeTakeFirst();
      if (!occurrence) return "not-found" as const;
      if (
        occurrence.status !== "published" ||
        occurrence.eventTemplateVersionId !== next.eventTemplateVersionId ||
        occurrence.registrationMode !== next.registrationMode ||
        occurrence.approvalMode !== next.approvalMode ||
        next.capacity < occurrence.confirmedCount
      )
        return "conflict" as const;

      await sql`select pg_advisory_xact_lock(hashtext(${next.slug}))`.execute(
        transaction,
      );
      const slugOwner = await transaction
        .selectFrom("event_occurrence")
        .select("id")
        .where("slug", "=", next.slug)
        .where("id", "!=", eventOccurrenceId)
        .executeTakeFirst();
      if (slugOwner) return "slug-in-use" as const;

      const [sessions, activeRegions, coordinatorRows, finalDecision] =
        await Promise.all([
          transaction
            .selectFrom("event_session")
            .select(["id", "startsAt", "endsAt"])
            .where("eventOccurrenceId", "=", eventOccurrenceId)
            .execute(),
          transaction
            .selectFrom("event_occurrence_region")
            .select("id")
            .where("eventOccurrenceId", "=", eventOccurrenceId)
            .where("retiredAt", "is", null)
            .execute(),
          transaction
            .selectFrom("event_coordinator_assignment as assignment")
            .innerJoin(
              "event_occurrence_region as region",
              "region.id",
              "assignment.eventOccurrenceRegionId",
            )
            .select(["assignment.eventOccurrenceRegionId", "assignment.userId"])
            .where("region.eventOccurrenceId", "=", eventOccurrenceId)
            .where("region.retiredAt", "is", null)
            .where("assignment.endedAt", "is", null)
            .execute(),
          transaction
            .selectFrom("event_registration")
            .select("id")
            .where("eventOccurrenceId", "=", eventOccurrenceId)
            .where("finalDecidedAt", "is not", null)
            .executeTakeFirst(),
        ]);
      if (
        activeRegions.some(
          (region) =>
            !coordinatorRows.some(
              (coordinator) =>
                coordinator.eventOccurrenceRegionId === region.id,
            ),
        )
      )
        return "regions-not-confirmed" as const;

      const nextStartsAt = new Date(next.startsAt);
      const nextEndsAt = new Date(next.endsAt);
      const sessionMinutes = sessions.reduce(
        (total, session) =>
          total +
          (session.endsAt.getTime() - session.startsAt.getTime()) / 60_000,
        0,
      );
      if (
        nextEndsAt <= nextStartsAt ||
        nextEndsAt.getTime() - nextStartsAt.getTime() < sessionMinutes * 60_000
      )
        return "conflict" as const;

      const submittedOpensAt = optionalDate(next.registrationOpensAt);
      const submittedClosesAt = optionalDate(next.registrationClosesAt);
      const submittedLockAt = optionalDate(next.coordinatorLockAt);
      const now = new Date();
      let nextOpensAt = occurrence.registrationOpensAt;
      let nextClosesAt = occurrence.registrationClosesAt;
      let nextLockAt = occurrence.coordinatorLockAt;

      if (input.registrationWindowPolicy === "replace_future") {
        const futureWindows = [
          [occurrence.registrationOpensAt, submittedOpensAt],
          [occurrence.registrationClosesAt, submittedClosesAt],
          [occurrence.coordinatorLockAt, submittedLockAt],
        ] as const;
        const futureWindowCount = futureWindows.filter(
          ([current]) => current && current > now,
        ).length;
        if (
          futureWindowCount === 0 ||
          futureWindows.some(
            ([current, proposed]) => current && current > now && !proposed,
          )
        )
          return "invalid-window-policy" as const;
        const replace = (current: Date | null, proposed: Date | null) =>
          current && current > now ? proposed : current;
        nextOpensAt = replace(occurrence.registrationOpensAt, submittedOpensAt);
        nextClosesAt = replace(
          occurrence.registrationClosesAt,
          submittedClosesAt,
        );
        nextLockAt = replace(occurrence.coordinatorLockAt, submittedLockAt);
      } else if (input.registrationWindowPolicy === "reopen") {
        if (
          occurrence.registrationMode === "open_entry" ||
          !submittedOpensAt ||
          !submittedClosesAt ||
          submittedClosesAt <= now ||
          submittedClosesAt <= submittedOpensAt ||
          (activeRegions.length > 0 &&
            (!submittedLockAt || submittedLockAt < submittedClosesAt))
        )
          return "invalid-window-policy" as const;
        nextOpensAt = submittedOpensAt;
        nextClosesAt = submittedClosesAt;
        nextLockAt = submittedLockAt;
      }

      if (nextOpensAt && nextClosesAt && nextClosesAt <= nextOpensAt)
        return "invalid-window-policy" as const;
      if (nextClosesAt && nextLockAt && nextLockAt < nextClosesAt)
        return "invalid-window-policy" as const;

      const rescheduleId = `event_occurrence_reschedule_${randomUUID()}`;
      await transaction
        .insertInto("event_occurrence_reschedule")
        .values({
          id: rescheduleId,
          eventOccurrenceId,
          registrationWindowPolicy: input.registrationWindowPolicy,
          previousStartsAt: occurrence.startsAt,
          previousEndsAt: occurrence.endsAt,
          previousRegistrationOpensAt: occurrence.registrationOpensAt,
          previousRegistrationClosesAt: occurrence.registrationClosesAt,
          previousCoordinatorLockAt: occurrence.coordinatorLockAt,
          nextStartsAt,
          nextEndsAt,
          nextRegistrationOpensAt: nextOpensAt,
          nextRegistrationClosesAt: nextClosesAt,
          nextCoordinatorLockAt: nextLockAt,
          actorUserId: administrator.id,
          createdAt: now,
        })
        .execute();
      if (activeRegions.length) {
        await transaction
          .insertInto("event_occurrence_reschedule_region")
          .values(
            activeRegions.map((region) => ({
              eventOccurrenceRescheduleId: rescheduleId,
              eventOccurrenceRegionId: region.id,
            })),
          )
          .execute();
        await transaction
          .insertInto("event_occurrence_reschedule_region_coordinator")
          .values(
            coordinatorRows.map((coordinator) => ({
              eventOccurrenceRescheduleId: rescheduleId,
              eventOccurrenceRegionId: coordinator.eventOccurrenceRegionId,
              userId: coordinator.userId,
            })),
          )
          .execute();
      }

      if (
        activeRegions.length > 0 &&
        input.registrationWindowPolicy === "replace_future" &&
        nextClosesAt &&
        nextLockAt
      )
        await transaction
          .updateTable("event_region_review_round")
          .set({
            registrationClosesAt: nextClosesAt,
            coordinatorLockAt: nextLockAt,
            eventOccurrenceRescheduleId: rescheduleId,
          })
          .where(
            "eventOccurrenceRegionId",
            "in",
            activeRegions.map((row) => row.id),
          )
          .where("lockedAt", "is", null)
          .execute();

      if (
        input.registrationWindowPolicy === "reopen" &&
        nextClosesAt &&
        nextLockAt
      ) {
        const latestRounds = activeRegions.length
          ? await transaction
              .selectFrom("event_region_review_round")
              .select([
                "eventOccurrenceRegionId",
                "round",
                "lockedAt",
                "coordinatorLockAt",
              ])
              .where(
                "eventOccurrenceRegionId",
                "in",
                activeRegions.map((row) => row.id),
              )
              .orderBy("round", "desc")
              .execute()
          : [];
        const latestByRegion = new Map<string, (typeof latestRounds)[number]>();
        for (const round of latestRounds)
          if (!latestByRegion.has(round.eventOccurrenceRegionId))
            latestByRegion.set(round.eventOccurrenceRegionId, round);
        const boundaryReached =
          Boolean(finalDecision) ||
          [...latestByRegion.values()].some(
            (round) =>
              Boolean(round.lockedAt) || round.coordinatorLockAt <= now,
          );
        for (const region of activeRegions) {
          const latest = latestByRegion.get(region.id);
          if (latest && !boundaryReached && !latest.lockedAt)
            await transaction
              .updateTable("event_region_review_round")
              .set({
                registrationClosesAt: nextClosesAt,
                coordinatorLockAt: nextLockAt,
                eventOccurrenceRescheduleId: rescheduleId,
              })
              .where("eventOccurrenceRegionId", "=", region.id)
              .where("round", "=", latest.round)
              .execute();
          else
            await transaction
              .insertInto("event_region_review_round")
              .values({
                id: `event_region_review_round_${randomUUID()}`,
                eventOccurrenceRegionId: region.id,
                round: (latest?.round ?? 0) + 1,
                registrationClosesAt: nextClosesAt,
                coordinatorLockAt: nextLockAt,
                lockedAt: null,
                lockedByUserId: null,
                lockSource: null,
                eventOccurrenceRescheduleId: rescheduleId,
              })
              .execute();
        }
      }

      await transaction
        .updateTable("event_occurrence")
        .set({
          title: next.title,
          slug: next.slug,
          deliveryMode: next.deliveryMode,
          registrationMode: next.registrationMode,
          approvalMode: next.approvalMode,
          timezone: next.timezone,
          startsAt: nextStartsAt,
          endsAt: nextEndsAt,
          registrationOpensAt: nextOpensAt,
          registrationClosesAt: nextClosesAt,
          coordinatorLockAt: nextLockAt,
          capacity: next.capacity,
          venueName: optionalText(next.venueName),
          venueAddress: optionalText(next.venueAddress),
          virtualJoinUrl: optionalText(next.virtualJoinUrl),
          updatedAt: now,
        })
        .where("id", "=", eventOccurrenceId)
        .execute();

      const startDelta = nextStartsAt.getTime() - occurrence.startsAt.getTime();
      for (const session of sessions)
        await transaction
          .updateTable("event_session")
          .set({
            startsAt: new Date(session.startsAt.getTime() + startDelta),
            endsAt: new Date(session.endsAt.getTime() + startDelta),
            venueName: optionalText(next.venueName),
            venueAddress: optionalText(next.venueAddress),
            virtualJoinUrl: optionalText(next.virtualJoinUrl),
          })
          .where("id", "=", session.id)
          .execute();

      await transaction
        .deleteFrom("event_occurrence_domain")
        .where("eventOccurrenceId", "=", eventOccurrenceId)
        .execute();
      if (domains.length)
        await transaction
          .insertInto("event_occurrence_domain")
          .values(
            domains.map((domain) => ({
              eventOccurrenceId,
              domain,
              createdAt: now,
            })),
          )
          .execute();

      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "event_occurrence.rescheduled",
        subjectType: "event_occurrence_reschedule",
        subjectId: rescheduleId,
        aggregateId: eventOccurrenceId,
        metadata: {
          registrationWindowPolicy: input.registrationWindowPolicy,
          activeRegionCount: activeRegions.length,
        },
        createdAt: now,
      });
      return "rescheduled" as const;
    });
}

export async function publishAdminEventOccurrence(
  eventOccurrenceId: string,
  administrator: AuthenticatedUser,
): Promise<"published" | "not-found" | "conflict"> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const occurrence = await transaction
        .selectFrom("event_occurrence")
        .select([
          "id",
          "status",
          "registrationMode",
          "deliveryMode",
          "venueName",
          "virtualJoinUrl",
        ])
        .where("id", "=", eventOccurrenceId)
        .forUpdate()
        .executeTakeFirst();
      if (!occurrence) return "not-found" as const;
      if (occurrence.status !== "draft") return "conflict" as const;
      const coverage = await transaction
        .selectFrom("event_occurrence")
        .select([
          sql<number>`(select count(*)::integer
            from event_admin_assignment assignments
            inner join platform_admin active_admin
              on active_admin."userId" = assignments."userId"
            where assignments."eventOccurrenceId" = ${eventOccurrenceId}
              and assignments."endedAt" is null)`.as("admins"),
          sql<number>`(select count(*)::integer from event_session
            where "eventOccurrenceId" = ${eventOccurrenceId})`.as("sessions"),
          sql<number>`(select count(*)::integer from event_session sessions
            where sessions."eventOccurrenceId" = ${eventOccurrenceId}
              and sessions."presenterRequired"
              and not exists (
                select 1 from event_presenter_assignment presenters
                where presenters."eventOccurrenceId" = ${eventOccurrenceId}
                  and presenters."eventSessionId" = sessions.id
                  and presenters."endedAt" is null
              ))`.as("uncoveredPresenterSessions"),
          sql<number>`(select count(*)::integer from event_occurrence_region regions
            where regions."eventOccurrenceId" = ${eventOccurrenceId}
              and regions."retiredAt" is null
              and not exists (
                select 1 from event_coordinator_assignment coordinators
                where coordinators."eventOccurrenceRegionId" = regions.id
                  and coordinators."endedAt" is null
              ))`.as("uncoveredRegions"),
          sql<number>`(select count(*)::integer from event_occurrence_domain
            where "eventOccurrenceId" = ${eventOccurrenceId})`.as("domains"),
        ])
        .where("event_occurrence.id", "=", eventOccurrenceId)
        .executeTakeFirstOrThrow();
      const locationInvalid =
        (occurrence.deliveryMode === "in_person" && !occurrence.venueName) ||
        (occurrence.deliveryMode === "virtual" && !occurrence.virtualJoinUrl);
      if (
        coverage.admins === 0 ||
        coverage.sessions === 0 ||
        coverage.uncoveredPresenterSessions > 0 ||
        coverage.uncoveredRegions > 0 ||
        (occurrence.registrationMode === "required_restricted" &&
          coverage.domains === 0) ||
        locationInvalid
      )
        return "conflict" as const;
      const now = new Date();
      await transaction
        .updateTable("event_occurrence")
        .set({ status: "published", publishedAt: now, updatedAt: now })
        .where("id", "=", eventOccurrenceId)
        .executeTakeFirstOrThrow();
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "event_occurrence.published",
        subjectType: "event_occurrence",
        subjectId: eventOccurrenceId,
        createdAt: now,
      });
      return "published" as const;
    });
}
