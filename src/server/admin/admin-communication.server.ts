import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import type { AdminEmailPreview } from "#/features/admin-email/admin-email.schema";
import type {
  AdminCommunicationPlanItem,
  AdminCommunicationWorkspace,
  CommunicationScope,
} from "#/features/admin-email/admin-communication.schema";
import { normalizeEventCommunicationAudience } from "#/features/admin-email/communication-options";
import { recordDurableAuditEvent } from "#/server/audit/audit-event.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import type { Database } from "#/server/db/types";
import { getServerEnv } from "#/server/env.server";
import {
  fixtureEmailContext,
  emailVariableGroups,
  getEmailTemplateContract,
  renderEmailTemplate,
  validateEmailTemplate,
} from "#/server/notifications/email-template-contracts";
import { refreshEventCommunicationSchedules } from "#/server/notifications/event-communication-execution.server";

type CourseInput = {
  courseVersionId: string;
  communicationId?: string;
  label: string;
  emailDesignVersionId: string;
  sectionId: string | null;
  sessionDefinitionId: string | null;
  audience: "active_enrollees" | "affected_learner";
  trigger:
    | "course_incomplete"
    | "enrollment_completed"
    | "enrollment_created"
    | "enrollment_expiring";
  offsetAmount: number;
  offsetUnit: "minute" | "hour" | "day" | "week";
  subjectOverride: string | null;
  textBodyOverride: string | null;
};

type EventInput = {
  eventTemplateVersionId: string;
  communicationId?: string;
  label: string;
  emailDesignVersionId: string;
  sectionId: string | null;
  sessionDefinitionId: string | null;
  audience:
    | "administrators"
    | "active_registrants"
    | "affected_learner"
    | "confirmed_participants"
    | "coordinators"
    | "presenters";
  trigger:
    | "event_completed"
    | "event_end"
    | "event_start"
    | "registration_selected"
    | "registration_submitted"
    | "registration_waitlisted"
    | "registration_not_selected"
    | "registration_cancelled"
    | "event_rescheduled"
    | "event_cancelled"
    | "post_event_incomplete"
    | "prework_incomplete"
    | "section_release"
    | "session_start";
  offsetAmount: number;
  offsetUnit: "minute" | "hour" | "day" | "week";
  subjectOverride: string | null;
  textBodyOverride: string | null;
};

async function templateOptions(
  contextKey: "offering_course" | "offering_event",
) {
  return await getDatabase()
    .selectFrom("email_design as design")
    .innerJoin(
      "email_design_version as version",
      "version.id",
      "design.activeVersionId",
    )
    .select([
      "version.id as versionId",
      "design.name as designName",
      "version.version",
      "version.subject",
      "version.textBody",
    ])
    .where("design.catalogue", "=", "offering")
    .where("design.contextKey", "=", contextKey)
    .where("version.publishedAt", "is not", null)
    .orderBy("design.name")
    .execute();
}

export async function findScheduleEmailAuthoringContext(
  contextKey: "offering_course" | "offering_event",
) {
  const contractKey =
    contextKey === "offering_course" ? "offering.course" : "offering.event";
  const templates = await getDatabase()
    .selectFrom("email_design as design")
    .innerJoin(
      "email_design_version as version",
      "version.emailDesignId",
      "design.id",
    )
    .select([
      "version.id as versionId",
      "design.name as designName",
      "version.version",
      "version.subject",
      "version.textBody",
      sql<boolean>`version.id = design."activeVersionId"`.as("selectable"),
    ])
    .where("design.catalogue", "=", "offering")
    .where("design.contextKey", "=", contextKey)
    .where("version.publishedAt", "is not", null)
    .orderBy("design.name")
    .orderBy("version.version", "desc")
    .execute();
  return {
    templates,
    variableGroups: emailVariableGroups(
      getEmailTemplateContract(contractKey).variables,
    ),
  };
}

function effectiveItem(row: {
  id: string;
  emailDesignVersionId: string;
  designName: string;
  designVersion: number;
  sectionId: string | null;
  sessionDefinitionId: string | null;
  position: number;
  label: string;
  audience: string;
  trigger: string;
  offsetAmount: number;
  offsetUnit: "minute" | "hour" | "day" | "week";
  designSubject: string;
  designTextBody: string;
  subjectOverride: string | null;
  textBodyOverride: string | null;
}): AdminCommunicationPlanItem {
  return {
    id: row.id,
    logicalId: row.id,
    revision: null,
    overrideState: "template",
    label: row.label,
    emailDesignVersionId: row.emailDesignVersionId,
    emailDesignName: row.designName,
    emailDesignVersion: row.designVersion,
    sectionId: row.sectionId,
    sessionDefinitionId: row.sessionDefinitionId,
    position: row.position,
    audience: row.audience,
    trigger: row.trigger,
    offsetAmount: row.offsetAmount,
    offsetUnit: row.offsetUnit,
    subject: row.subjectOverride ?? row.designSubject,
    textBody: row.textBodyOverride ?? row.designTextBody,
    subjectOverridden: row.subjectOverride !== null,
    textBodyOverridden: row.textBodyOverride !== null,
  };
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function applicationUrl(): string {
  return new URL(getServerEnv().APP_ORIGIN).origin;
}

function formatDateTime(value: Date | null, timezone: string): string {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: timezone,
  }).format(value);
}

function formatDate(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "long",
    timeZone: timezone,
  }).format(value);
}

function formatTime(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeStyle: "short",
    timeZone: timezone,
  }).format(value);
}

function offeringPrice(cents: number | null): string {
  if (cents === null) return "Not priced";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(cents / 100);
}

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/^./u, (letter) => letter.toUpperCase());
}

export async function findAdminCommunicationWorkspace(
  scope: CommunicationScope,
): Promise<AdminCommunicationWorkspace | null> {
  const database = getDatabase();
  if (scope.kind === "course") {
    const variableGroups = emailVariableGroups(
      getEmailTemplateContract("offering.course").variables,
    );
    const version = await database
      .selectFrom("course_version as version")
      .innerJoin("course", "course.id", "version.courseId")
      .select([
        "version.id",
        "version.version",
        "version.publishedAt",
        "course.title",
      ])
      .where("version.id", "=", scope.courseVersionId)
      .executeTakeFirst();
    if (!version) return null;
    const [sections, templates, rows] = await Promise.all([
      database
        .selectFrom("course_version_section")
        .select(["id", "title"])
        .where("courseVersionId", "=", version.id)
        .orderBy("position")
        .execute(),
      templateOptions("offering_course"),
      database
        .selectFrom("course_version_communication as communication")
        .innerJoin(
          "email_design_version as version",
          "version.id",
          "communication.emailDesignVersionId",
        )
        .innerJoin(
          "email_design as design",
          "design.id",
          "version.emailDesignId",
        )
        .select([
          "communication.id",
          "communication.emailDesignVersionId",
          "communication.sectionId",
          "communication.position",
          "communication.label",
          "communication.audience",
          "communication.trigger",
          "communication.offsetAmount",
          "communication.offsetUnit",
          "communication.subjectOverride",
          "communication.textBodyOverride",
          "version.version as designVersion",
          "version.subject as designSubject",
          "version.textBody as designTextBody",
          "design.name as designName",
        ])
        .where("communication.courseVersionId", "=", version.id)
        .orderBy("communication.position")
        .execute(),
    ]);
    return {
      scope: {
        ...scope,
        title: version.title,
        version: version.version,
        editable: version.publishedAt === null,
      },
      sections,
      sessions: [],
      templates,
      variableGroups,
      items: rows.map((row) =>
        effectiveItem({ ...row, sessionDefinitionId: null }),
      ),
    };
  }

  if (scope.kind === "event_template") {
    const variableGroups = emailVariableGroups(
      getEmailTemplateContract("offering.event").variables,
    );
    const version = await database
      .selectFrom("event_template_version as version")
      .innerJoin(
        "event_template as template",
        "template.id",
        "version.eventTemplateId",
      )
      .select([
        "version.id",
        "version.version",
        "version.publishedAt",
        "template.title",
      ])
      .where("version.id", "=", scope.eventTemplateVersionId)
      .executeTakeFirst();
    if (!version) return null;
    const [sections, sessions, templates, rows] = await Promise.all([
      database
        .selectFrom("event_template_version_section")
        .select(["id", "title"])
        .where("eventTemplateVersionId", "=", version.id)
        .orderBy("position")
        .execute(),
      database
        .selectFrom("event_template_session_definition")
        .select(["id", "title"])
        .where("eventTemplateVersionId", "=", version.id)
        .orderBy("position")
        .execute(),
      templateOptions("offering_event"),
      database
        .selectFrom("event_template_version_communication as communication")
        .innerJoin(
          "email_design_version as version",
          "version.id",
          "communication.emailDesignVersionId",
        )
        .innerJoin(
          "email_design as design",
          "design.id",
          "version.emailDesignId",
        )
        .select([
          "communication.id",
          "communication.emailDesignVersionId",
          "communication.sectionId",
          "communication.sessionDefinitionId",
          "communication.position",
          "communication.label",
          "communication.audience",
          "communication.trigger",
          "communication.offsetAmount",
          "communication.offsetUnit",
          "communication.subjectOverride",
          "communication.textBodyOverride",
          "version.version as designVersion",
          "version.subject as designSubject",
          "version.textBody as designTextBody",
          "design.name as designName",
        ])
        .where("communication.eventTemplateVersionId", "=", version.id)
        .orderBy("communication.position")
        .execute(),
    ]);
    return {
      scope: {
        ...scope,
        title: version.title,
        version: version.version,
        editable: version.publishedAt === null,
      },
      sections,
      sessions,
      templates,
      variableGroups,
      items: rows.map((row) =>
        effectiveItem({
          ...row,
          audience: normalizeEventCommunicationAudience(
            row.trigger,
            row.audience,
          ),
        }),
      ),
    };
  }

  const occurrence = await database
    .selectFrom("event_occurrence as occurrence")
    .innerJoin(
      "event_template_version as version",
      "version.id",
      "occurrence.eventTemplateVersionId",
    )
    .select([
      "occurrence.id",
      "occurrence.title",
      "occurrence.status",
      "version.id as eventTemplateVersionId",
      "version.version",
    ])
    .where("occurrence.id", "=", scope.eventOccurrenceId)
    .executeTakeFirst();
  if (!occurrence) return null;
  const variableGroups = emailVariableGroups(
    getEmailTemplateContract("offering.event").variables,
  );
  const [sections, sessions, rows] = await Promise.all([
    database
      .selectFrom("event_template_version_section")
      .select(["id", "title"])
      .where("eventTemplateVersionId", "=", occurrence.eventTemplateVersionId)
      .orderBy("position")
      .execute(),
    database
      .selectFrom("event_template_session_definition")
      .select(["id", "title"])
      .where("eventTemplateVersionId", "=", occurrence.eventTemplateVersionId)
      .orderBy("position")
      .execute(),
    database
      .selectFrom("event_occurrence_communication_revision as communication")
      .innerJoin(
        "email_design_version as version",
        "version.id",
        "communication.emailDesignVersionId",
      )
      .innerJoin("email_design as design", "design.id", "version.emailDesignId")
      .select([
        "communication.id",
        "communication.logicalId",
        "communication.revision",
        "communication.overrideState",
        "communication.emailDesignVersionId",
        "communication.sectionId",
        "communication.sessionDefinitionId",
        "communication.position",
        "communication.label",
        "communication.audience",
        "communication.trigger",
        "communication.offsetAmount",
        "communication.offsetUnit",
        "communication.subject",
        "communication.textBody",
        "version.version as designVersion",
        "design.name as designName",
      ])
      .where("communication.eventOccurrenceId", "=", occurrence.id)
      .where("communication.active", "=", true)
      .orderBy("communication.position")
      .execute(),
  ]);
  return {
    scope: {
      ...scope,
      title: occurrence.title,
      version: occurrence.version,
      editable: ["draft", "published"].includes(occurrence.status),
    },
    sections,
    sessions,
    templates: [],
    variableGroups,
    items: rows.map((row) => ({
      ...row,
      audience: normalizeEventCommunicationAudience(row.trigger, row.audience),
      emailDesignName: row.designName,
      emailDesignVersion: row.designVersion,
      subjectOverridden: row.overrideState === "overridden",
      textBodyOverridden: row.overrideState === "overridden",
    })),
  };
}

export async function previewOfferingCommunication(
  scope: CommunicationScope,
  input: {
    communicationId?: string | undefined;
    emailDesignVersionId?: string | undefined;
    subject?: string | undefined;
    textBody?: string | undefined;
    offeringTitle?: string | undefined;
    sectionTitle?: string | undefined;
    sessionTitle?: string | undefined;
  },
): Promise<AdminEmailPreview | null> {
  const workspace = await findAdminCommunicationWorkspace(scope);
  const item = input.communicationId
    ? workspace?.items.find(
        (candidate) => candidate.id === input.communicationId,
      )
    : null;
  const emailDesignVersionId =
    input.emailDesignVersionId ?? item?.emailDesignVersionId;
  const subject = input.subject ?? item?.subject;
  const textBody = input.textBody ?? item?.textBody;
  if (!workspace || !emailDesignVersionId || !subject || !textBody) return null;
  const database = getDatabase();
  const emailVersion = await database
    .selectFrom("email_design_version")
    .select(["contractKey", "contractVersion"])
    .where("id", "=", emailDesignVersionId)
    .executeTakeFirst();
  if (!emailVersion) return null;
  const variables: Record<string, string> = {
    ...fixtureEmailContext(
      emailVersion.contractKey,
      emailVersion.contractVersion,
    ),
  };
  const baseUrl = applicationUrl();
  variables["platform.homeUrl"] = baseUrl;
  variables["platform.learningUrl"] = `${baseUrl}/my-learning`;
  variables["platform.eventsUrl"] = `${baseUrl}/my-events`;

  if (scope.kind === "course") {
    const course = await database
      .selectFrom("course_version as version")
      .innerJoin("course", "course.id", "version.courseId")
      .select([
        "version.version",
        "version.content",
        "course.slug",
        "course.title",
      ])
      .where("version.id", "=", scope.courseVersionId)
      .executeTakeFirst();
    if (!course) return null;
    const content = recordValue(course.content);
    const priceCents = numberValue(content.priceCents);
    const salePriceCents = numberValue(content.salePriceCents);
    variables["course.title"] = course.title;
    variables["course.summary"] = textValue(content.summary);
    variables["course.description"] = textValue(content.description);
    variables["course.topic"] = textValue(content.topic);
    variables["course.version"] = String(course.version);
    variables["course.duration"] =
      `${String(numberValue(content.durationMinutes) ?? 0)} minutes`;
    variables["course.standardPrice"] = offeringPrice(priceCents);
    variables["course.currentPrice"] = offeringPrice(
      salePriceCents ?? priceCents,
    );
    variables["course.catalogueUrl"] = `${baseUrl}/courses/${course.slug}`;
    variables["course.dashboardUrl"] = `${baseUrl}/my-learning`;
  } else if (scope.kind === "event_template") {
    const event = await database
      .selectFrom("event_template_version as version")
      .innerJoin(
        "event_template",
        "event_template.id",
        "version.eventTemplateId",
      )
      .select([
        "event_template.title",
        "version.summary",
        "version.description",
      ])
      .where("version.id", "=", scope.eventTemplateVersionId)
      .executeTakeFirst();
    if (!event) return null;
    variables["event.title"] = event.title;
    variables["event.summary"] = event.summary;
    variables["event.description"] = event.description;
  } else {
    const event = await database
      .selectFrom("event_occurrence as occurrence")
      .innerJoin(
        "event_template_version as version",
        "version.id",
        "occurrence.eventTemplateVersionId",
      )
      .select([
        "occurrence.id",
        "occurrence.title",
        "occurrence.slug",
        "occurrence.timezone",
        "occurrence.startsAt",
        "occurrence.endsAt",
        "occurrence.deliveryMode",
        "occurrence.registrationMode",
        "occurrence.registrationOpensAt",
        "occurrence.registrationClosesAt",
        "occurrence.coordinatorLockAt",
        "occurrence.capacity",
        "occurrence.confirmedCount",
        "occurrence.venueName",
        "occurrence.venueAddress",
        "occurrence.virtualJoinUrl",
        "version.id as eventTemplateVersionId",
        "version.summary",
        "version.description",
      ])
      .where("occurrence.id", "=", scope.eventOccurrenceId)
      .executeTakeFirst();
    if (!event) return null;
    variables["event.title"] = event.title;
    variables["event.summary"] = event.summary;
    variables["event.description"] = event.description;
    variables["event.startsAt"] = formatDateTime(
      event.startsAt,
      event.timezone,
    );
    variables["event.endsAt"] = formatDateTime(event.endsAt, event.timezone);
    variables["event.timezone"] = event.timezone;
    variables["event.deliveryMode"] =
      event.deliveryMode === "in_person" ? "In person" : "Virtual";
    variables["event.registrationMode"] = titleCase(event.registrationMode);
    variables["event.registrationOpensAt"] = formatDateTime(
      event.registrationOpensAt,
      event.timezone,
    );
    variables["event.registrationClosesAt"] = formatDateTime(
      event.registrationClosesAt,
      event.timezone,
    );
    variables["event.coordinatorLockAt"] = formatDateTime(
      event.coordinatorLockAt,
      event.timezone,
    );
    variables["event.capacity"] = String(event.capacity);
    variables["event.availablePlaces"] = String(
      Math.max(0, event.capacity - event.confirmedCount),
    );
    variables["event.venueName"] = event.venueName ?? "Not applicable";
    variables["event.venueAddress"] = event.venueAddress ?? "Not applicable";
    variables["event.locationSummary"] =
      [event.venueName, event.venueAddress].filter(Boolean).join(", ") ||
      "Virtual event";
    variables["event.virtualJoinUrl"] =
      event.virtualJoinUrl ?? `${baseUrl}/my-events/${event.id}`;
    variables["event.dashboardUrl"] = `${baseUrl}/my-events/${event.id}`;
    variables["event.publicUrl"] = `${baseUrl}/events/${event.slug}`;

    if (item?.sectionId) {
      const section = await database
        .selectFrom("event_template_version_section")
        .select("title")
        .where("id", "=", item.sectionId)
        .where("eventTemplateVersionId", "=", event.eventTemplateVersionId)
        .executeTakeFirst();
      if (section) variables["section.title"] = section.title;
    }

    if (item?.sessionDefinitionId) {
      const session = await database
        .selectFrom("event_session as session")
        .leftJoin("event_virtual_join_access as joinAccess", (join) =>
          join
            .onRef("joinAccess.eventSessionId", "=", "session.id")
            .on("joinAccess.revokedAt", "is", null),
        )
        .select([
          "session.id",
          "session.title",
          "session.startsAt",
          "session.endsAt",
          "session.venueName",
          "session.venueAddress",
          "session.virtualJoinUrl",
          "session.virtualDeliveryProvider",
          "joinAccess.publicReference as virtualJoinReference",
        ])
        .where("session.eventOccurrenceId", "=", event.id)
        .where("session.sessionDefinitionId", "=", item.sessionDefinitionId)
        .executeTakeFirst();
      if (session) {
        const presenters = await database
          .selectFrom("event_presenter_assignment as assignment")
          .innerJoin("user", "user.id", "assignment.userId")
          .select(["user.name", "user.email"])
          .where("assignment.eventOccurrenceId", "=", event.id)
          .where("assignment.eventSessionId", "=", session.id)
          .where("assignment.endedAt", "is", null)
          .orderBy("user.name")
          .orderBy("user.email")
          .execute();
        const presenterNames = presenters.map(
          (presenter) => presenter.name.trim() || presenter.email,
        );
        const venueName = session.venueName ?? event.venueName;
        const venueAddress = session.venueAddress ?? event.venueAddress;
        variables["session.title"] = session.title;
        variables["session.startsAt"] = formatDateTime(
          session.startsAt,
          event.timezone,
        );
        variables["session.endsAt"] = formatDateTime(
          session.endsAt,
          event.timezone,
        );
        variables["session.date"] = formatDate(
          session.startsAt,
          event.timezone,
        );
        variables["session.startTime"] = formatTime(
          session.startsAt,
          event.timezone,
        );
        variables["session.endTime"] = formatTime(
          session.endsAt,
          event.timezone,
        );
        variables["session.locationSummary"] =
          [venueName, venueAddress].filter(Boolean).join(", ") ||
          "Virtual session";
        variables["session.venueName"] = venueName ?? "Not applicable";
        variables["session.venueAddress"] = venueAddress ?? "Not applicable";
        variables["session.virtualJoinUrl"] =
          session.virtualDeliveryProvider === "livekit" &&
          session.virtualJoinReference
            ? `${baseUrl}/webinars/${session.virtualJoinReference}`
            : (session.virtualJoinUrl ??
              event.virtualJoinUrl ??
              `${baseUrl}/my-events/${event.id}`);
        variables["session.presenterNames"] =
          presenterNames.length > 0
            ? new Intl.ListFormat("en-AU", {
                style: "long",
                type: "conjunction",
              }).format(presenterNames)
            : "To be confirmed";
      }
    }
  }
  if (input.offeringTitle)
    variables[scope.kind === "course" ? "course.title" : "event.title"] =
      input.offeringTitle;
  if (input.sectionTitle) variables["section.title"] = input.sectionTitle;
  if (input.sessionTitle) variables["session.title"] = input.sessionTitle;
  try {
    return renderEmailTemplate({
      contractKey: emailVersion.contractKey,
      contractVersion: emailVersion.contractVersion,
      subject,
      textBody,
      variables,
      requireMandatoryVariables: false,
    });
  } catch {
    return null;
  }
}

async function validatedTemplate(
  transaction: Transaction<Database>,
  versionId: string,
  contextKey: "offering_course" | "offering_event",
  subjectOverride: string | null,
  textBodyOverride: string | null,
) {
  const version = await transaction
    .selectFrom("email_design_version as version")
    .innerJoin("email_design as design", "design.id", "version.emailDesignId")
    .select([
      "version.id",
      "version.contractKey",
      "version.contractVersion",
      "version.subject",
      "version.textBody",
    ])
    .where("version.id", "=", versionId)
    .where("version.publishedAt", "is not", null)
    .where("design.catalogue", "=", "offering")
    .where("design.contextKey", "=", contextKey)
    .executeTakeFirst();
  if (!version) return null;
  const valid = validateEmailTemplate(
    {
      contractKey: version.contractKey,
      contractVersion: version.contractVersion,
      subject: subjectOverride ?? version.subject,
      textBody: textBodyOverride ?? version.textBody,
    },
    { requireMandatoryVariables: false },
  );
  return valid.valid ? version : null;
}

export async function saveCourseCommunicationPlan(
  input: CourseInput,
  user: AuthenticatedUser,
): Promise<"saved" | "not-found" | "conflict"> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const version = await transaction
        .selectFrom("course_version")
        .select(["id", "publishedAt"])
        .where("id", "=", input.courseVersionId)
        .executeTakeFirst();
      if (!version) return "not-found";
      if (version.publishedAt) return "conflict";
      if (
        input.sectionId &&
        !(await transaction
          .selectFrom("course_version_section")
          .select("id")
          .where("id", "=", input.sectionId)
          .where("courseVersionId", "=", version.id)
          .executeTakeFirst())
      )
        return "conflict";
      if (
        !(await validatedTemplate(
          transaction,
          input.emailDesignVersionId,
          "offering_course",
          input.subjectOverride,
          input.textBodyOverride,
        ))
      )
        return "conflict";
      const now = new Date();
      const existing = input.communicationId
        ? await transaction
            .selectFrom("course_version_communication")
            .select("id")
            .where("id", "=", input.communicationId)
            .where("courseVersionId", "=", version.id)
            .executeTakeFirst()
        : null;
      if (input.communicationId && !existing) return "not-found";
      if (existing)
        await transaction
          .updateTable("course_version_communication")
          .set({
            label: input.label,
            emailDesignVersionId: input.emailDesignVersionId,
            sectionId: input.sectionId,
            audience: input.audience,
            trigger: input.trigger,
            offsetAmount: input.offsetAmount,
            offsetUnit: input.offsetUnit,
            subjectOverride: input.subjectOverride,
            textBodyOverride: input.textBodyOverride,
            updatedAt: now,
          })
          .where("id", "=", existing.id)
          .executeTakeFirstOrThrow();
      else {
        const latest = await transaction
          .selectFrom("course_version_communication")
          .select(({ fn }) => fn.max<number | null>("position").as("position"))
          .where("courseVersionId", "=", version.id)
          .executeTakeFirstOrThrow();
        input.communicationId = `course_communication_${randomUUID()}`;
        await transaction
          .insertInto("course_version_communication")
          .values({
            id: input.communicationId,
            courseVersionId: version.id,
            sectionId: input.sectionId,
            position: (latest.position ?? -1) + 1,
            label: input.label,
            emailDesignVersionId: input.emailDesignVersionId,
            audience: input.audience,
            trigger: input.trigger,
            offsetAmount: input.offsetAmount,
            offsetUnit: input.offsetUnit,
            subjectOverride: input.subjectOverride,
            textBodyOverride: input.textBodyOverride,
            createdByUserId: user.id,
            createdAt: now,
            updatedAt: now,
          })
          .execute();
      }
      const communicationId = input.communicationId;
      if (!communicationId) return "conflict";
      await recordDurableAuditEvent(transaction, {
        actorUserId: user.id,
        action: existing
          ? "communication_plan.updated"
          : "communication_plan.created",
        subjectType: "course_version_communication",
        subjectId: communicationId,
        aggregateId: version.id,
        createdAt: now,
      });
      return "saved";
    });
}

export async function saveEventTemplateCommunicationPlan(
  input: EventInput,
  user: AuthenticatedUser,
): Promise<"saved" | "not-found" | "conflict"> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const version = await transaction
        .selectFrom("event_template_version")
        .select(["id", "publishedAt"])
        .where("id", "=", input.eventTemplateVersionId)
        .executeTakeFirst();
      if (!version) return "not-found";
      if (version.publishedAt) return "conflict";
      if (input.trigger === "section_release" && !input.sectionId)
        return "conflict";
      if (input.trigger === "session_start" && !input.sessionDefinitionId)
        return "conflict";
      if (
        input.sectionId &&
        !(await transaction
          .selectFrom("event_template_version_section")
          .select("id")
          .where("id", "=", input.sectionId)
          .where("eventTemplateVersionId", "=", version.id)
          .executeTakeFirst())
      )
        return "conflict";
      if (
        input.sessionDefinitionId &&
        !(await transaction
          .selectFrom("event_template_session_definition")
          .select("id")
          .where("id", "=", input.sessionDefinitionId)
          .where("eventTemplateVersionId", "=", version.id)
          .executeTakeFirst())
      )
        return "conflict";
      if (
        !(await validatedTemplate(
          transaction,
          input.emailDesignVersionId,
          "offering_event",
          input.subjectOverride,
          input.textBodyOverride,
        ))
      )
        return "conflict";
      const now = new Date();
      const existing = input.communicationId
        ? await transaction
            .selectFrom("event_template_version_communication")
            .select("id")
            .where("id", "=", input.communicationId)
            .where("eventTemplateVersionId", "=", version.id)
            .executeTakeFirst()
        : null;
      if (input.communicationId && !existing) return "not-found";
      if (existing)
        await transaction
          .updateTable("event_template_version_communication")
          .set({
            label: input.label,
            emailDesignVersionId: input.emailDesignVersionId,
            sectionId: input.sectionId,
            sessionDefinitionId: input.sessionDefinitionId,
            audience: input.audience,
            trigger: input.trigger,
            offsetAmount: input.offsetAmount,
            offsetUnit: input.offsetUnit,
            subjectOverride: input.subjectOverride,
            textBodyOverride: input.textBodyOverride,
            updatedAt: now,
          })
          .where("id", "=", existing.id)
          .executeTakeFirstOrThrow();
      else {
        const latest = await transaction
          .selectFrom("event_template_version_communication")
          .select(({ fn }) => fn.max<number | null>("position").as("position"))
          .where("eventTemplateVersionId", "=", version.id)
          .executeTakeFirstOrThrow();
        input.communicationId = `event_template_communication_${randomUUID()}`;
        await transaction
          .insertInto("event_template_version_communication")
          .values({
            id: input.communicationId,
            eventTemplateVersionId: version.id,
            sectionId: input.sectionId,
            sessionDefinitionId: input.sessionDefinitionId,
            position: (latest.position ?? -1) + 1,
            label: input.label,
            emailDesignVersionId: input.emailDesignVersionId,
            audience: input.audience,
            trigger: input.trigger,
            offsetAmount: input.offsetAmount,
            offsetUnit: input.offsetUnit,
            subjectOverride: input.subjectOverride,
            textBodyOverride: input.textBodyOverride,
            createdByUserId: user.id,
            createdAt: now,
            updatedAt: now,
          })
          .execute();
      }
      const communicationId = input.communicationId;
      if (!communicationId) return "conflict";
      await recordDurableAuditEvent(transaction, {
        actorUserId: user.id,
        action: existing
          ? "communication_plan.updated"
          : "communication_plan.created",
        subjectType: "event_template_version_communication",
        subjectId: communicationId,
        aggregateId: version.id,
        createdAt: now,
      });
      return "saved";
    });
}

export async function materializeEventOccurrenceCommunications(
  transaction: Transaction<Database>,
  eventOccurrenceId: string,
  eventTemplateVersionId: string,
  userId: string,
  createdAt: Date,
): Promise<void> {
  const plans = await transaction
    .selectFrom("event_template_version_communication as communication")
    .innerJoin(
      "email_design_version as version",
      "version.id",
      "communication.emailDesignVersionId",
    )
    .select([
      "communication.id",
      "communication.sectionId",
      "communication.sessionDefinitionId",
      "communication.position",
      "communication.label",
      "communication.emailDesignVersionId",
      "communication.audience",
      "communication.trigger",
      "communication.offsetAmount",
      "communication.offsetUnit",
      "communication.subjectOverride",
      "communication.textBodyOverride",
      "version.subject",
      "version.textBody",
    ])
    .where("communication.eventTemplateVersionId", "=", eventTemplateVersionId)
    .orderBy("communication.position")
    .execute();
  if (!plans.length) return;
  await transaction
    .insertInto("event_occurrence_communication_revision")
    .values(
      plans.map((plan) => ({
        id: `event_occurrence_communication_revision_${randomUUID()}`,
        logicalId: `event_occurrence_communication_${randomUUID()}`,
        eventOccurrenceId,
        sourceTemplateCommunicationId: plan.id,
        revision: 1,
        active: true,
        overrideState: "inherited" as const,
        emailDesignVersionId: plan.emailDesignVersionId,
        sectionId: plan.sectionId,
        sessionDefinitionId: plan.sessionDefinitionId,
        position: plan.position,
        label: plan.label,
        audience: normalizeEventCommunicationAudience(
          plan.trigger,
          plan.audience,
        ),
        trigger: plan.trigger,
        offsetAmount: plan.offsetAmount,
        offsetUnit: plan.offsetUnit,
        subject: plan.subjectOverride ?? plan.subject,
        textBody: plan.textBodyOverride ?? plan.textBody,
        createdByUserId: userId,
        createdAt,
      })),
    )
    .execute();
}

async function reviseOccurrenceCommunication(
  input: {
    eventOccurrenceId: string;
    logicalId: string;
    subject?: string;
    textBody?: string;
    offsetAmount?: number;
    offsetUnit?: "minute" | "hour" | "day" | "week";
  },
  user: AuthenticatedUser,
  reset: boolean,
): Promise<"saved" | "not-found" | "conflict"> {
  return await getDatabase()
    .transaction()
    .execute(async (transaction) => {
      const current = await transaction
        .selectFrom("event_occurrence_communication_revision as communication")
        .innerJoin(
          "event_occurrence as occurrence",
          "occurrence.id",
          "communication.eventOccurrenceId",
        )
        .selectAll("communication")
        .select("occurrence.status")
        .where("communication.logicalId", "=", input.logicalId)
        .where("communication.eventOccurrenceId", "=", input.eventOccurrenceId)
        .where("communication.active", "=", true)
        .forUpdate()
        .executeTakeFirst();
      if (!current) return "not-found";
      if (!["draft", "published"].includes(current.status)) return "conflict";
      let next: {
        subject: string;
        textBody: string;
        offsetAmount: number;
        offsetUnit: "minute" | "hour" | "day" | "week";
        overrideState: "inherited" | "overridden";
      } = {
        subject: input.subject ?? current.subject,
        textBody: input.textBody ?? current.textBody,
        offsetAmount: input.offsetAmount ?? current.offsetAmount,
        offsetUnit: input.offsetUnit ?? current.offsetUnit,
        overrideState: "overridden" as const,
      };
      if (reset) {
        const inherited = await transaction
          .selectFrom("event_template_version_communication as communication")
          .innerJoin(
            "email_design_version as version",
            "version.id",
            "communication.emailDesignVersionId",
          )
          .select([
            "communication.offsetAmount",
            "communication.offsetUnit",
            "communication.subjectOverride",
            "communication.textBodyOverride",
            "version.subject",
            "version.textBody",
          ])
          .where("communication.id", "=", current.sourceTemplateCommunicationId)
          .executeTakeFirstOrThrow();
        next = {
          subject: inherited.subjectOverride ?? inherited.subject,
          textBody: inherited.textBodyOverride ?? inherited.textBody,
          offsetAmount: inherited.offsetAmount,
          offsetUnit: inherited.offsetUnit,
          overrideState: "inherited",
        };
      }
      const version = await transaction
        .selectFrom("email_design_version")
        .select(["contractKey", "contractVersion"])
        .where("id", "=", current.emailDesignVersionId)
        .executeTakeFirstOrThrow();
      if (
        !validateEmailTemplate(
          {
            contractKey: version.contractKey,
            contractVersion: version.contractVersion,
            subject: next.subject,
            textBody: next.textBody,
          },
          { requireMandatoryVariables: false },
        ).valid
      )
        return "conflict";
      const createdAt = new Date();
      await transaction
        .updateTable("event_occurrence_communication_revision")
        .set({ active: false })
        .where("id", "=", current.id)
        .executeTakeFirstOrThrow();
      const id = `event_occurrence_communication_revision_${randomUUID()}`;
      await transaction
        .insertInto("event_occurrence_communication_revision")
        .values({
          id,
          logicalId: current.logicalId,
          eventOccurrenceId: current.eventOccurrenceId,
          sourceTemplateCommunicationId: current.sourceTemplateCommunicationId,
          revision: current.revision + 1,
          active: true,
          overrideState: next.overrideState,
          emailDesignVersionId: current.emailDesignVersionId,
          sectionId: current.sectionId,
          sessionDefinitionId: current.sessionDefinitionId,
          position: current.position,
          label: current.label,
          audience: normalizeEventCommunicationAudience(
            current.trigger,
            current.audience,
          ),
          trigger: current.trigger,
          offsetAmount: next.offsetAmount,
          offsetUnit: next.offsetUnit,
          subject: next.subject,
          textBody: next.textBody,
          createdByUserId: user.id,
          createdAt,
        })
        .execute();
      await recordDurableAuditEvent(transaction, {
        actorUserId: user.id,
        action: reset
          ? "communication_plan.reset"
          : "communication_plan.overridden",
        subjectType: "event_occurrence_communication_revision",
        subjectId: id,
        aggregateId: current.logicalId,
        metadata: { revision: current.revision + 1 },
        createdAt,
      });
      await refreshEventCommunicationSchedules(
        transaction,
        current.eventOccurrenceId,
        createdAt,
      );
      return "saved";
    });
}

export async function overrideOccurrenceCommunication(
  input: {
    eventOccurrenceId: string;
    logicalId: string;
    subject: string;
    textBody: string;
    offsetAmount: number;
    offsetUnit: "minute" | "hour" | "day" | "week";
  },
  user: AuthenticatedUser,
) {
  return await reviseOccurrenceCommunication(input, user, false);
}

export async function resetOccurrenceCommunication(
  input: { eventOccurrenceId: string; logicalId: string },
  user: AuthenticatedUser,
) {
  return await reviseOccurrenceCommunication(input, user, true);
}
