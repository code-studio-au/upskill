import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import {
  adminEventTemplateDraftSchema,
  type AdminEventTemplateCreateInput,
  type AdminEventTemplateDetail,
  type AdminEventTemplateDraft,
  type AdminEventTemplateItem,
} from "#/features/admin-event/admin-event.schema";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { logServerEvent } from "#/server/logging/server-logger";
import { findScheduleEmailAuthoringContext } from "#/server/admin/admin-communication.server";
import {
  certificateAccreditationsSchema,
  type CertificateAccreditation,
} from "#/features/catalog/accreditation";
import {
  offeringImageSchema,
  type OfferingImage,
} from "#/features/shared/offering-image";

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
          topic: "General",
          summary: "Event summary to be completed.",
          description: "Event description to be completed.",
          coverImage: null,
          hasCompletionCertificate: false,
          accreditations: JSON.stringify([]),
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
    topic: string;
    summary: string;
    description: string;
    coverImage: OfferingImage;
    hasCompletionCertificate: boolean;
    accreditations: Array<CertificateAccreditation>;
  },
): Promise<AdminEventTemplateDraft> {
  const [
    sectionRows,
    communicationRows,
    presenterRows,
    administratorRows,
    regionRows,
  ] = await Promise.all([
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
        "sections.phase as sectionPhase",
        "sections.releaseAnchor as sectionReleaseAnchor",
        "sections.releaseOffsetAmount as sectionReleaseOffsetAmount",
        "sections.releaseOffsetUnit as sectionReleaseOffsetUnit",
        "items.id as itemId",
        "items.position as itemPosition",
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
      .selectFrom("event_template_version_communication")
      .select([
        "id",
        "sectionId",
        "sessionDefinitionId",
        "position",
        "label",
        "emailDesignVersionId",
        "audience",
        "trigger",
        "offsetAmount",
        "offsetUnit",
        "subjectOverride",
        "textBodyOverride",
      ])
      .where("eventTemplateVersionId", "=", version.id)
      .orderBy("position")
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
  const itemPositions = new Map<string, number>();
  const sessionItemByDefinitionId = new Map<string, string>();
  for (const row of sectionRows) {
    let section = sections.get(row.sectionId);
    if (!section) {
      section = {
        id: row.sectionId,
        title: row.sectionTitle,
        description: row.sectionDescription,
        phase: row.sectionPhase,
        releaseAnchor: row.sectionReleaseAnchor,
        releaseOffsetAmount: row.sectionReleaseOffsetAmount,
        releaseOffsetUnit: row.sectionReleaseOffsetUnit,
        items: [],
      };
      sections.set(row.sectionId, section);
    }
    if (row.itemId && row.itemKind && row.itemTitle) {
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
      itemPositions.set(row.itemId, row.itemPosition ?? 0);
      if (row.sessionDefinitionId)
        sessionItemByDefinitionId.set(row.sessionDefinitionId, row.itemId);
    }
  }
  for (const communication of communicationRows) {
    if (!communication.sectionId) continue;
    const section = sections.get(communication.sectionId);
    if (!section) continue;
    section.items.push({
      id: communication.id,
      kind: "automated_email",
      title: communication.label,
      emailDesignVersionId: communication.emailDesignVersionId,
      audience: communication.audience,
      trigger: communication.trigger,
      offsetAmount: communication.offsetAmount,
      offsetUnit: communication.offsetUnit,
      subjectOverride: communication.subjectOverride,
      textBodyOverride: communication.textBodyOverride,
      sessionItemId: communication.sessionDefinitionId
        ? (sessionItemByDefinitionId.get(communication.sessionDefinitionId) ??
          null)
        : null,
    });
    itemPositions.set(communication.id, communication.position);
  }
  for (const section of sections.values())
    section.items.sort(
      (left, right) =>
        (itemPositions.get(left.id) ?? 0) - (itemPositions.get(right.id) ?? 0),
    );
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
    topic: version.topic,
    summary: version.summary,
    description: version.description,
    coverImage: offeringImageSchema.parse(version.coverImage),
    hasCompletionCertificate: version.hasCompletionCertificate,
    accreditations: certificateAccreditationsSchema.parse(
      version.accreditations,
    ),
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
  eventTemplateVersionId?: string,
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
      "topic",
      "summary",
      "description",
      "coverImage",
      "hasCompletionCertificate",
      "accreditations",
      "publishedAt",
    ])
    .where("eventTemplateId", "=", eventTemplateId)
    .orderBy("version", "desc")
    .execute();
  const version = eventTemplateVersionId
    ? versions.find((candidate) => candidate.id === eventTemplateVersionId)
    : (versions.find((candidate) => !candidate.publishedAt) ?? versions[0]);
  if (!version) return null;
  const draft = await loadEventTemplateDraft(database, template, version);
  const referencedStaffIds = [
    ...new Set([
      ...draft.defaultAdministratorIds,
      ...draft.regions.flatMap((region) => region.coordinatorIds),
      ...draft.sections.flatMap((section) =>
        section.items.flatMap((item) =>
          item.kind === "session" ? item.presenterIds : [],
        ),
      ),
    ]),
  ];
  const [
    platformAdministrators,
    presenters,
    coordinators,
    users,
    regions,
    modules,
    surveys,
    resources,
    emailAuthoring,
  ] = await Promise.all([
    database
      .selectFrom("platform_admin")
      .innerJoin("user", "user.id", "platform_admin.userId")
      .select(["user.id", "user.name", "user.email"])
      .orderBy("user.name")
      .execute(),
    database
      .selectFrom("event_staff_eligibility as eligibility")
      .innerJoin("user", "user.id", "eligibility.userId")
      .select([
        "eligibility.id as eligibilityId",
        "user.id",
        "user.name",
        "user.email",
      ])
      .where("eligibility.responsibility", "=", "presenter")
      .where("eligibility.revokedAt", "is", null)
      .orderBy("user.name")
      .orderBy("user.email")
      .execute(),
    database
      .selectFrom("event_staff_eligibility as eligibility")
      .innerJoin("user", "user.id", "eligibility.userId")
      .innerJoin(
        "coordination_region as region",
        "region.id",
        "eligibility.regionId",
      )
      .select([
        "eligibility.id as eligibilityId",
        "user.id",
        "user.name",
        "user.email",
        "region.id as regionId",
        "region.name as regionName",
      ])
      .where("eligibility.responsibility", "=", "coordinator")
      .where("eligibility.revokedAt", "is", null)
      .where("region.status", "=", "active")
      .orderBy("region.name")
      .orderBy("user.name")
      .orderBy("user.email")
      .execute(),
    referencedStaffIds.length
      ? database
          .selectFrom("user")
          .select(["id", "name", "email"])
          .where("id", "in", referencedStaffIds)
          .orderBy("name")
          .orderBy("email")
          .execute()
      : [],
    database
      .selectFrom("coordination_region as region")
      .leftJoin("coordination_region as parent", "parent.id", "region.parentId")
      .select([
        "region.id",
        "region.name",
        "region.code",
        "region.parentId",
        "parent.name as parentName",
      ])
      .where("region.status", "=", "active")
      .where("region.kind", "=", "operational")
      .orderBy("parent.name")
      .orderBy("region.name")
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
        sql<"event" | "shared">`learning_activity."surveyType"`.as("type"),
        "learning_activity_version.version",
      ])
      .where("learning_activity_version.publishedAt", "is not", null)
      .where("learning_activity.surveyType", "in", ["event", "shared"])
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
    findScheduleEmailAuthoringContext("offering_event"),
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
    emailTemplates: emailAuthoring.templates,
    emailVariableGroups: emailAuthoring.variableGroups,
    people: { platformAdministrators, coordinators, presenters, users },
    regions,
    library: { modules, surveys, resources },
  };
}

async function validateEventDraftReferences(
  transaction: Transaction<Database>,
  draft: AdminEventTemplateDraft,
): Promise<boolean> {
  const administratorIds = new Set(draft.defaultAdministratorIds);
  const coordinatorSelections = draft.regions.flatMap((region) =>
    region.coordinatorIds.map((userId) => ({
      regionId: region.regionId,
      userId,
    })),
  );
  const coordinatorIds = new Set(
    coordinatorSelections.map((selection) => selection.userId),
  );
  const presenterIds = new Set(
    draft.sections.flatMap((section) =>
      section.items.flatMap((item) =>
        item.kind === "session" ? item.presenterIds : [],
      ),
    ),
  );
  const activityIds = draft.sections.flatMap((section) =>
    section.items.flatMap((item) =>
      item.kind === "session" || item.kind === "automated_email"
        ? []
        : [item.learningActivityVersionId],
    ),
  );
  const emailVersionIds = draft.sections.flatMap((section) =>
    section.items.flatMap((item) =>
      item.kind === "automated_email" ? [item.emailDesignVersionId] : [],
    ),
  );
  const regionIds = new Set(draft.regions.map((region) => region.regionId));
  const accreditationLogoIds = draft.accreditations.flatMap((accreditation) =>
    accreditation.logoAssetId ? [accreditation.logoAssetId] : [],
  );
  const coverImageIds = draft.coverImage ? [draft.coverImage.assetId] : [];
  const [
    administrators,
    coordinators,
    presenters,
    activities,
    regions,
    emailVersions,
    accreditationLogos,
    coverImages,
  ] = await Promise.all([
    transaction
      .selectFrom("platform_admin")
      .select("userId")
      .where("userId", "in", [...administratorIds])
      .execute(),
    coordinatorIds.size
      ? transaction
          .selectFrom("event_staff_eligibility")
          .select(["userId", "regionId"])
          .where("userId", "in", [...coordinatorIds])
          .where("responsibility", "=", "coordinator")
          .where("revokedAt", "is", null)
          .execute()
      : [],
    presenterIds.size
      ? transaction
          .selectFrom("event_staff_eligibility")
          .select("userId")
          .where("userId", "in", [...presenterIds])
          .where("responsibility", "=", "presenter")
          .where("revokedAt", "is", null)
          .execute()
      : [],
    activityIds.length
      ? transaction
          .selectFrom("learning_activity_version")
          .innerJoin(
            "learning_activity",
            "learning_activity.id",
            "learning_activity_version.activityId",
          )
          .select("learning_activity_version.id")
          .where("learning_activity_version.id", "in", activityIds)
          .where((expression) =>
            expression.or([
              expression("learning_activity_version.kind", "!=", "survey"),
              expression("learning_activity.surveyType", "in", [
                "event",
                "shared",
              ]),
            ]),
          )
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
    emailVersionIds.length
      ? transaction
          .selectFrom("email_design_version as version")
          .innerJoin(
            "email_design as design",
            "design.id",
            "version.emailDesignId",
          )
          .select("version.id")
          .where("version.id", "in", emailVersionIds)
          .where("version.publishedAt", "is not", null)
          .where("design.catalogue", "=", "offering")
          .where("design.contextKey", "=", "offering_event")
          .execute()
      : [],
    accreditationLogoIds.length
      ? transaction
          .selectFrom("accreditation_logo_asset")
          .select("id")
          .where("id", "in", accreditationLogoIds)
          .execute()
      : [],
    coverImageIds.length
      ? transaction
          .selectFrom("offering_image_asset")
          .select("id")
          .where("id", "in", coverImageIds)
          .execute()
      : [],
  ]);
  return (
    new Set(administrators.map((row) => row.userId)).size ===
      administratorIds.size &&
    coordinatorSelections.every((selection) =>
      coordinators.some(
        (coordinator) =>
          coordinator.userId === selection.userId &&
          coordinator.regionId === selection.regionId,
      ),
    ) &&
    new Set(presenters.map((row) => row.userId)).size === presenterIds.size &&
    new Set(activities.map((row) => row.id)).size ===
      new Set(activityIds).size &&
    new Set(regions.map((row) => row.id)).size === regionIds.size &&
    new Set(emailVersions.map((row) => row.id)).size ===
      new Set(emailVersionIds).size &&
    new Set(accreditationLogos.map((row) => row.id)).size ===
      new Set(accreditationLogoIds).size &&
    new Set(coverImages.map((row) => row.id)).size ===
      new Set(coverImageIds).size
  );
}

async function replaceEventDraftStructure(
  transaction: Transaction<Database>,
  draft: AdminEventTemplateDraft,
  actorUserId: string,
): Promise<void> {
  const previousCommunications = await transaction
    .selectFrom("event_template_version_communication")
    .select("id")
    .where("eventTemplateVersionId", "=", draft.eventTemplateVersionId)
    .execute();
  await transaction
    .deleteFrom("event_template_version_communication")
    .where("eventTemplateVersionId", "=", draft.eventTemplateVersionId)
    .execute();
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
    if (region.coordinatorIds.length)
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
  for (const [sectionPosition, section] of draft.sections.entries()) {
    await transaction
      .insertInto("event_template_version_section")
      .values({
        id: section.id,
        eventTemplateVersionId: draft.eventTemplateVersionId,
        position: sectionPosition,
        title: section.title,
        description: section.description,
        phase: section.phase,
        releaseAnchor: section.releaseAnchor,
        releaseOffsetAmount: section.releaseOffsetAmount,
        releaseOffsetUnit: section.releaseOffsetUnit,
      })
      .execute();
  }
  let sessionPosition = 0;
  const sessionDefinitionIdByItemId = new Map<string, string>();
  for (const section of draft.sections)
    for (const item of section.items) {
      if (item.kind !== "session") continue;
      const sessionDefinitionId = `event_session_definition_${randomUUID()}`;
      sessionDefinitionIdByItemId.set(item.id, sessionDefinitionId);
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
  for (const section of draft.sections)
    for (const [itemPosition, item] of section.items.entries()) {
      if (item.kind === "automated_email") {
        await transaction
          .insertInto("event_template_version_communication")
          .values({
            id: item.id,
            eventTemplateVersionId: draft.eventTemplateVersionId,
            sectionId: section.id,
            sessionDefinitionId: item.sessionItemId
              ? (sessionDefinitionIdByItemId.get(item.sessionItemId) ?? null)
              : null,
            position: itemPosition,
            label: item.title,
            emailDesignVersionId: item.emailDesignVersionId,
            audience: item.audience,
            trigger: item.trigger,
            offsetAmount: item.offsetAmount,
            offsetUnit: item.offsetUnit,
            subjectOverride: item.subjectOverride,
            textBodyOverride: item.textBodyOverride,
            createdByUserId: actorUserId,
            updatedAt: new Date(),
          })
          .execute();
        continue;
      }
      const sessionDefinitionId =
        item.kind === "session"
          ? (sessionDefinitionIdByItemId.get(item.id) ?? null)
          : null;
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
  const previousIds = new Set(previousCommunications.map(({ id }) => id));
  const nextEmailItems = draft.sections.flatMap((section) =>
    section.items.filter((item) => item.kind === "automated_email"),
  );
  const nextIds = new Set(nextEmailItems.map(({ id }) => id));
  for (const item of nextEmailItems)
    await recordDurableAuditEvent(transaction, {
      actorUserId,
      action: previousIds.has(item.id)
        ? "communication_plan.updated"
        : "communication_plan.created",
      subjectType: "event_template_version_communication",
      subjectId: item.id,
      aggregateId: draft.eventTemplateVersionId,
      metadata: { placement: "section_schedule" },
    });
  for (const { id } of previousCommunications)
    if (!nextIds.has(id))
      await recordDurableAuditEvent(transaction, {
        actorUserId,
        action: "communication_plan.deleted",
        subjectType: "event_template_version_communication",
        subjectId: id,
        aggregateId: draft.eventTemplateVersionId,
        metadata: { placement: "section_schedule" },
      });
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
          topic: draft.topic,
          summary: draft.summary,
          description: draft.description,
          coverImage:
            draft.coverImage === null ? null : JSON.stringify(draft.coverImage),
          hasCompletionCertificate: draft.hasCompletionCertificate,
          accreditations: JSON.stringify(draft.accreditations),
        })
        .where("id", "=", draft.eventTemplateVersionId)
        .executeTakeFirstOrThrow();
      await replaceEventDraftStructure(transaction, draft, administrator.id);
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
  sourceVersionId: string,
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
          "topic",
          "summary",
          "description",
          "coverImage",
          "hasCompletionCertificate",
          "accreditations",
          "publishedAt",
        ])
        .where("eventTemplateId", "=", eventTemplateId)
        .orderBy("version", "desc")
        .execute();
      if (versions.some((version) => !version.publishedAt))
        return { status: "conflict" } as const;
      const source = versions.find(
        (version) => version.id === sourceVersionId && version.publishedAt,
      );
      if (!source) return { status: "not-found" } as const;
      const nextVersion =
        Math.max(...versions.map(({ version }) => version)) + 1;
      const eventTemplateVersionId = `event_template_version_${randomUUID()}`;
      await transaction
        .insertInto("event_template_version")
        .values({
          id: eventTemplateVersionId,
          eventTemplateId,
          version: nextVersion,
          topic: source.topic,
          summary: source.summary,
          description: source.description,
          coverImage:
            source.coverImage === null
              ? null
              : JSON.stringify(source.coverImage),
          hasCompletionCertificate: source.hasCompletionCertificate,
          accreditations: JSON.stringify(source.accreditations),
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
        sections: sourceDraft.sections.map((section) => {
          const copiedIds = new Map(
            section.items.map((item) => [
              item.id,
              item.kind === "automated_email"
                ? `event_template_communication_${randomUUID()}`
                : `event_item_${randomUUID()}`,
            ]),
          );
          return {
            ...section,
            id: `event_section_${randomUUID()}`,
            items: section.items.map((item) => ({
              ...item,
              id: copiedIds.get(item.id) as string,
              ...(item.kind === "automated_email"
                ? {
                    sessionItemId: item.sessionItemId
                      ? (copiedIds.get(item.sessionItemId) ?? null)
                      : null,
                  }
                : {}),
            })),
          };
        }),
      };
      await replaceEventDraftStructure(transaction, draft, administrator.id);
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "event_template.version_created",
        subjectType: "event_template_version",
        subjectId: eventTemplateVersionId,
        aggregateId: eventTemplateId,
        metadata: { sourceVersionId: source.id, version: nextVersion },
      });
      return { status: "created", eventTemplateVersionId } as const;
    });
}

export async function deleteAdminEventTemplateVersion(
  eventTemplateId: string,
  eventTemplateVersionId: string,
  administrator: AuthenticatedUser,
): Promise<
  | { status: "deleted"; templateDeleted: boolean }
  | { status: "not-found" | "conflict" }
> {
  const outcome = await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const version = await transaction
        .selectFrom("event_template_version")
        .select(["id", "eventTemplateId", "publishedAt"])
        .where("id", "=", eventTemplateVersionId)
        .where("eventTemplateId", "=", eventTemplateId)
        .forUpdate()
        .executeTakeFirst();
      if (!version) return { status: "not-found" } as const;
      if (version.publishedAt) return { status: "conflict" } as const;
      const occurrence = await transaction
        .selectFrom("event_occurrence")
        .select("id")
        .where("eventTemplateVersionId", "=", eventTemplateVersionId)
        .executeTakeFirst();
      if (occurrence) return { status: "conflict" } as const;
      await transaction
        .deleteFrom("event_template_version")
        .where("id", "=", eventTemplateVersionId)
        .executeTakeFirstOrThrow();
      const remaining = await transaction
        .selectFrom("event_template_version")
        .select("id")
        .where("eventTemplateId", "=", eventTemplateId)
        .executeTakeFirst();
      if (!remaining)
        await transaction
          .deleteFrom("event_template")
          .where("id", "=", eventTemplateId)
          .executeTakeFirstOrThrow();
      await recordDurableAuditEvent(transaction, {
        actorUserId: administrator.id,
        action: "event_template.draft_deleted",
        subjectType: remaining ? "event_template_version" : "event_template",
        subjectId: remaining ? eventTemplateVersionId : eventTemplateId,
        aggregateId: eventTemplateId,
        metadata: {
          eventTemplateVersionId,
          templateDeleted: !remaining,
        },
      });
      return { status: "deleted", templateDeleted: !remaining } as const;
    });
  if (outcome.status === "deleted")
    logServerEvent({
      level: "info",
      event: "event_template.draft_deleted",
      fields: {
        actorUserId: administrator.id,
        entityType: outcome.templateDeleted
          ? "event_template"
          : "event_template_version",
        entityId: outcome.templateDeleted
          ? eventTemplateId
          : eventTemplateVersionId,
        aggregateId: eventTemplateId,
      },
    });
  return outcome;
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
                inner join event_staff_eligibility eligibility
                  on eligibility."userId" = presenters."userId"
                  and eligibility.responsibility = 'presenter'
                  and eligibility."revokedAt" is null
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
              sql<number>`count(distinct sections.id) filter (where items.id is null)::integer`.as(
                "emptySections",
              ),
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
        structure.emptySections > 0 ||
        structure.sessions === 0 ||
        administratorCoverage.configured === 0 ||
        administratorCoverage.configured !== administratorCoverage.active ||
        presenterCoverage.required !== presenterCoverage.covered
      )
        return "conflict" as const;
      const regionCoverage = await transaction
        .selectFrom("event_template_version_region as regions")
        .innerJoin(
          "coordination_region as region",
          "region.id",
          "regions.regionId",
        )
        .select([
          sql<number>`count(*)::integer`.as("configured"),
          sql<number>`count(*) filter (
            where region.status = 'active' and region.kind = 'operational'
          )::integer`.as("active"),
          sql<number>`(select count(*)::integer
            from event_template_version_coordinator_default defaults
            where defaults."eventTemplateVersionId" = ${eventTemplateVersionId})`.as(
            "configuredCoordinators",
          ),
          sql<number>`(select count(*)::integer
            from event_template_version_coordinator_default defaults
            inner join event_staff_eligibility eligibility
              on eligibility."userId" = defaults."userId"
              and eligibility."regionId" = defaults."regionId"
              and eligibility.responsibility = 'coordinator'
              and eligibility."revokedAt" is null
            where defaults."eventTemplateVersionId" = ${eventTemplateVersionId})`.as(
            "activeCoordinators",
          ),
        ])
        .where("regions.eventTemplateVersionId", "=", eventTemplateVersionId)
        .executeTakeFirstOrThrow();
      if (
        regionCoverage.configured !== regionCoverage.active ||
        regionCoverage.configuredCoordinators !==
          regionCoverage.activeCoordinators
      )
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
