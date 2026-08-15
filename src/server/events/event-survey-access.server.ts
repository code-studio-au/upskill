import "@tanstack/react-start/server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import type {
  EventSurveyQrCatalogueItem,
  EventSurveyQrPresentation,
  LearnerEventSurveyReferenceResult,
} from "#/features/event-operations/event-operations.schema";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { findLearnerEventSurvey } from "#/server/learning/learner-event-survey.server";
import {
  canAdministerEvent,
  type EventOperationsAccess,
} from "./event-operations-access.server";

function issuePublicReference(): string {
  return randomBytes(24).toString("base64url");
}

export async function ensureEventSurveyAccessRecords(
  transaction: Transaction<Database>,
  eventOccurrenceId: string,
  eventTemplateVersionId: string,
  createdAt: Date,
): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtext(${`${eventOccurrenceId}:survey-access`}))`.execute(
    transaction,
  );
  const [surveyItems, existing] = await Promise.all([
    transaction
      .selectFrom("event_template_version_item")
      .select("id")
      .where("eventTemplateVersionId", "=", eventTemplateVersionId)
      .where("kind", "=", "survey")
      .execute(),
    transaction
      .selectFrom("event_survey_access")
      .select(["eventTemplateVersionItemId", "generation", "revokedAt"])
      .where("eventOccurrenceId", "=", eventOccurrenceId)
      .execute(),
  ]);
  const activeItemIds = new Set(
    existing
      .filter((record) => record.revokedAt === null)
      .map((record) => record.eventTemplateVersionItemId),
  );
  const maximumGenerationByItem = new Map<string, number>();
  for (const record of existing)
    maximumGenerationByItem.set(
      record.eventTemplateVersionItemId,
      Math.max(
        maximumGenerationByItem.get(record.eventTemplateVersionItemId) ?? 0,
        record.generation,
      ),
    );
  const missing = surveyItems.filter((item) => !activeItemIds.has(item.id));
  if (!missing.length) return;
  await transaction
    .insertInto("event_survey_access")
    .values(
      missing.map((item) => ({
        id: `event_survey_access_${randomUUID()}`,
        eventOccurrenceId,
        eventTemplateVersionItemId: item.id,
        publicReference: issuePublicReference(),
        generation: (maximumGenerationByItem.get(item.id) ?? 0) + 1,
        accessPolicy: "authenticated_participant" as const,
        createdAt,
        revokedAt: null,
      })),
    )
    .execute();
}

function catalogueStatus(
  occurrenceStatus:
    "draft" | "published" | "cancelled" | "completed" | "archived",
): EventSurveyQrCatalogueItem["status"] {
  if (occurrenceStatus === "draft") return "preview";
  if (occurrenceStatus === "published" || occurrenceStatus === "completed")
    return "active";
  return "disabled";
}

function canViewCatalogue(access: EventOperationsAccess): boolean {
  return (
    canAdministerEvent(access) ||
    access.coordinatorRegionIds.length > 0 ||
    access.presentsWholeOccurrence ||
    access.presenterSessionIds.length > 0
  );
}

export async function findEventSurveyQrCatalogue(
  eventOccurrenceId: string,
  access: EventOperationsAccess,
): Promise<Array<EventSurveyQrCatalogueItem>> {
  if (!canViewCatalogue(access)) return [];
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const occurrence = await transaction
        .selectFrom("event_occurrence")
        .select(["eventTemplateVersionId", "status"])
        .where("id", "=", eventOccurrenceId)
        .executeTakeFirst();
      if (!occurrence) return [];
      await ensureEventSurveyAccessRecords(
        transaction,
        eventOccurrenceId,
        occurrence.eventTemplateVersionId,
        new Date(),
      );
      const records = await transaction
        .selectFrom("event_survey_access as access")
        .innerJoin(
          "event_template_version_item as item",
          "item.id",
          "access.eventTemplateVersionItemId",
        )
        .innerJoin(
          "event_template_version_section as section",
          "section.id",
          "item.sectionId",
        )
        .select([
          "access.id",
          "access.publicReference",
          "item.title",
          "section.title as sectionTitle",
          "section.phase",
          "section.releaseAnchor",
          "section.releaseOffsetAmount",
          "section.releaseOffsetUnit",
        ])
        .where("access.eventOccurrenceId", "=", eventOccurrenceId)
        .where("access.revokedAt", "is", null)
        .where("item.kind", "=", "survey")
        .orderBy("section.position")
        .orderBy("item.position")
        .execute();
      return records.map((record) => ({
        ...record,
        status: catalogueStatus(occurrence.status),
      }));
    });
}

export async function findEventSurveyQrPresentation(
  eventOccurrenceId: string,
  eventSurveyAccessId: string,
  access: EventOperationsAccess,
): Promise<EventSurveyQrPresentation | null> {
  if (!canViewCatalogue(access)) return null;
  const [occurrence, catalogue] = await Promise.all([
    getDatabase()
      .selectFrom("event_occurrence")
      .select(["title", "timezone"])
      .where("id", "=", eventOccurrenceId)
      .executeTakeFirst(),
    findEventSurveyQrCatalogue(eventOccurrenceId, access),
  ]);
  const surveyAccess = catalogue.find(
    (entry) => entry.id === eventSurveyAccessId,
  );
  return occurrence && surveyAccess
    ? {
        occurrenceId: eventOccurrenceId,
        occurrenceTitle: occurrence.title,
        timezone: occurrence.timezone,
        access: surveyAccess,
      }
    : null;
}

export async function resolveLearnerEventSurveyReference(
  publicReference: string,
  user: AuthenticatedUser,
): Promise<LearnerEventSurveyReferenceResult> {
  const record = await getDatabase()
    .selectFrom("event_survey_access as access")
    .innerJoin(
      "event_occurrence as occurrence",
      "occurrence.id",
      "access.eventOccurrenceId",
    )
    .innerJoin(
      "event_participation as participation",
      "participation.eventOccurrenceId",
      "occurrence.id",
    )
    .leftJoin(
      "event_registration as registration",
      "registration.id",
      "participation.registrationId",
    )
    .select(["access.eventOccurrenceId", "access.eventTemplateVersionItemId"])
    .where("access.publicReference", "=", publicReference)
    .where("access.revokedAt", "is", null)
    .where("occurrence.status", "in", ["published", "completed"])
    .where("participation.userId", "=", user.id)
    .where((expression) =>
      expression.or([
        expression("participation.mode", "=", "open_entry"),
        expression("registration.status", "=", "selected"),
      ]),
    )
    .executeTakeFirst();
  if (!record) return { status: "not-found" };
  const survey = await findLearnerEventSurvey(
    record.eventOccurrenceId,
    record.eventTemplateVersionItemId,
    user,
  );
  if (!survey) return { status: "not-found" };
  if (survey === "unavailable") return { status: "unavailable" };
  return {
    status: "ready",
    eventOccurrenceId: record.eventOccurrenceId,
    eventTemplateVersionItemId: record.eventTemplateVersionItemId,
  };
}

export async function isEventSurveyPublicReferenceRenderable(
  publicReference: string,
): Promise<boolean> {
  const record = await getDatabase()
    .selectFrom("event_survey_access as access")
    .innerJoin(
      "event_occurrence as occurrence",
      "occurrence.id",
      "access.eventOccurrenceId",
    )
    .select("access.id")
    .where("access.publicReference", "=", publicReference)
    .where("access.revokedAt", "is", null)
    .where("occurrence.status", "not in", ["cancelled", "archived"])
    .executeTakeFirst();
  return Boolean(record);
}
