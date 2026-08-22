import "@tanstack/react-start/server-only";

import type { Transaction } from "kysely";
import type { Database } from "#/server/db/types";
import { getServerEnv } from "#/server/env.server";
import { getEmailTemplateContract } from "./email-template-contracts";

export interface EventNotificationRecipient {
  userId: string;
  name: string;
  email: string;
  registrationId: string | null;
  participationId: string | null;
}

export interface EventCommunicationContentSnapshot {
  id: string;
  sectionId: string | null;
  sessionDefinitionId: string | null;
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

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/^./u, (letter) => letter.toLocaleUpperCase("en-AU"));
}

function durationLabel(milliseconds: number): string {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${String(remainder)} minutes`;
  if (remainder === 0)
    return `${String(hours)} ${hours === 1 ? "hour" : "hours"}`;
  return `${String(hours)} ${hours === 1 ? "hour" : "hours"} ${String(remainder)} minutes`;
}

function list(
  values: ReadonlyArray<string>,
  fallback = "Not assigned",
): string {
  const unique = [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ];
  return unique.length
    ? new Intl.ListFormat("en-AU", {
        style: "long",
        type: "conjunction",
      }).format(unique)
    : fallback;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/u)[0] ?? name;
}

function emptyEventVariables(): Record<string, string> {
  return Object.fromEntries(
    getEmailTemplateContract("offering.event").variables.map((variable) => [
      variable.key,
      "",
    ]),
  );
}

export async function buildEventNotificationVariables(
  transaction: Transaction<Database>,
  input: {
    eventOccurrenceId: string;
    communication: EventCommunicationContentSnapshot;
    recipient: EventNotificationRecipient;
  },
): Promise<Record<string, string>> {
  const event = await transaction
    .selectFrom("event_occurrence as occurrence")
    .innerJoin(
      "event_template_version as version",
      "version.id",
      "occurrence.eventTemplateVersionId",
    )
    .select([
      "occurrence.id",
      "occurrence.eventTemplateVersionId",
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
      "version.summary",
      "version.description",
      "version.hasCompletionCertificate",
    ])
    .where("occurrence.id", "=", input.eventOccurrenceId)
    .executeTakeFirstOrThrow();
  const recipientProfile = await transaction
    .selectFrom("user")
    .leftJoin(
      "coordination_region as region",
      "region.id",
      "user.currentRegionId",
    )
    .leftJoin("coordination_region as parent", "parent.id", "region.parentId")
    .select([
      "user.phone",
      "region.name as regionName",
      "region.code as regionCode",
      "parent.name as regionGroupName",
      "parent.code as regionGroupCode",
    ])
    .where("user.id", "=", input.recipient.userId)
    .executeTakeFirst();
  const [sessions, administrators, presenters, occurrenceRegions] =
    await Promise.all([
      transaction
        .selectFrom("event_session")
        .select([
          "id",
          "sessionDefinitionId",
          "title",
          "startsAt",
          "endsAt",
          "venueName",
          "venueAddress",
          "virtualJoinUrl",
        ])
        .where("eventOccurrenceId", "=", event.id)
        .orderBy("position")
        .execute(),
      transaction
        .selectFrom("event_admin_assignment as assignment")
        .innerJoin("user", "user.id", "assignment.userId")
        .select(["user.name", "user.email"])
        .where("assignment.eventOccurrenceId", "=", event.id)
        .where("assignment.endedAt", "is", null)
        .execute(),
      transaction
        .selectFrom("event_presenter_assignment as assignment")
        .innerJoin("user", "user.id", "assignment.userId")
        .select(["user.name", "user.email"])
        .where("assignment.eventOccurrenceId", "=", event.id)
        .where("assignment.endedAt", "is", null)
        .execute(),
      transaction
        .selectFrom("event_occurrence_region as occurrenceRegion")
        .innerJoin(
          "coordination_region as region",
          "region.id",
          "occurrenceRegion.regionId",
        )
        .leftJoin(
          "coordination_region as parent",
          "parent.id",
          "region.parentId",
        )
        .select(["region.name", "parent.name as parentName"])
        .where("occurrenceRegion.eventOccurrenceId", "=", event.id)
        .where("occurrenceRegion.retiredAt", "is", null)
        .orderBy("occurrenceRegion.position")
        .execute(),
    ]);

  const environment = getServerEnv();
  const baseUrl = new URL(environment.APP_ORIGIN).origin;
  const variables = emptyEventVariables();
  variables["user.fullName"] = input.recipient.name;
  variables["user.firstName"] = firstName(input.recipient.name);
  variables["user.email"] = input.recipient.email;
  variables["user.phoneNumber"] = recipientProfile?.phone ?? "";
  variables["user.operationalRegionName"] = recipientProfile?.regionName ?? "";
  variables["user.operationalRegionCode"] = recipientProfile?.regionCode ?? "";
  variables["user.regionGroupName"] = recipientProfile?.regionGroupName ?? "";
  variables["user.regionGroupCode"] = recipientProfile?.regionGroupCode ?? "";
  variables["user.profileUrl"] = `${baseUrl}/profile`;
  variables["platform.name"] = "Upskill";
  variables["platform.homeUrl"] = baseUrl;
  variables["platform.learningUrl"] = `${baseUrl}/my-learning`;
  variables["platform.eventsUrl"] = `${baseUrl}/my-events`;
  variables["platform.supportEmail"] = environment.SUPPORT_EMAIL;
  variables["event.title"] = event.title;
  variables["event.summary"] = event.summary;
  variables["event.description"] = event.description;
  variables["event.startsAt"] = formatDateTime(event.startsAt, event.timezone);
  variables["event.endsAt"] = formatDateTime(event.endsAt, event.timezone);
  variables["event.date"] = formatDate(event.startsAt, event.timezone);
  variables["event.startTime"] = formatTime(event.startsAt, event.timezone);
  variables["event.endTime"] = formatTime(event.endsAt, event.timezone);
  variables["event.timezone"] = event.timezone;
  variables["event.deliveryMode"] =
    event.deliveryMode === "in_person" ? "In person" : "Virtual";
  variables["event.duration"] = durationLabel(
    event.endsAt.getTime() - event.startsAt.getTime(),
  );
  variables["event.sessionCount"] = String(sessions.length);
  variables["event.locationSummary"] =
    [event.venueName, event.venueAddress].filter(Boolean).join(", ") ||
    "Virtual event";
  variables["event.venueName"] = event.venueName ?? "";
  variables["event.venueAddress"] = event.venueAddress ?? "";
  variables["event.virtualJoinUrl"] = event.virtualJoinUrl ?? "";
  variables["event.capacity"] = String(event.capacity);
  variables["event.availablePlaces"] = String(
    Math.max(0, event.capacity - event.confirmedCount),
  );
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
  variables["event.administratorNames"] = list(
    administrators.map((person) => person.name.trim() || person.email),
  );
  variables["event.presenterNames"] = list(
    presenters.map((person) => person.name.trim() || person.email),
  );
  variables["event.regionNames"] = list(
    occurrenceRegions.map((region) => region.name),
    "No configured regions",
  );
  variables["event.regionGroupNames"] = list(
    occurrenceRegions.flatMap((region) =>
      region.parentName ? [region.parentName] : [],
    ),
    "No configured region groups",
  );
  variables["event.certificateAvailable"] = event.hasCompletionCertificate
    ? "Available after completion"
    : "Not available";
  variables["event.dashboardUrl"] = `${baseUrl}/my-events/${event.id}`;
  variables["event.publicUrl"] = `${baseUrl}/events/${event.slug}`;
  variables["event.certificateUrl"] = input.recipient.participationId
    ? `${baseUrl}/api/learning/event-certificates/${input.recipient.participationId}`
    : "";

  if (input.communication.sectionId) {
    const section = await transaction
      .selectFrom("event_template_version_section")
      .select("title")
      .where("id", "=", input.communication.sectionId)
      .where("eventTemplateVersionId", "=", event.eventTemplateVersionId)
      .executeTakeFirst();
    variables["section.title"] = section?.title ?? "";
  }

  const selectedSession = input.communication.sessionDefinitionId
    ? sessions.find(
        (session) =>
          session.sessionDefinitionId ===
          input.communication.sessionDefinitionId,
      )
    : undefined;
  if (selectedSession) {
    const sessionPresenters = await transaction
      .selectFrom("event_presenter_assignment as assignment")
      .innerJoin("user", "user.id", "assignment.userId")
      .select(["user.name", "user.email"])
      .where("assignment.eventOccurrenceId", "=", event.id)
      .where("assignment.eventSessionId", "=", selectedSession.id)
      .where("assignment.endedAt", "is", null)
      .execute();
    const venueName = selectedSession.venueName ?? event.venueName;
    const venueAddress = selectedSession.venueAddress ?? event.venueAddress;
    variables["session.title"] = selectedSession.title;
    variables["session.startsAt"] = formatDateTime(
      selectedSession.startsAt,
      event.timezone,
    );
    variables["session.endsAt"] = formatDateTime(
      selectedSession.endsAt,
      event.timezone,
    );
    variables["session.date"] = formatDate(
      selectedSession.startsAt,
      event.timezone,
    );
    variables["session.startTime"] = formatTime(
      selectedSession.startsAt,
      event.timezone,
    );
    variables["session.endTime"] = formatTime(
      selectedSession.endsAt,
      event.timezone,
    );
    variables["session.locationSummary"] =
      [venueName, venueAddress].filter(Boolean).join(", ") || "Virtual session";
    variables["session.venueName"] = venueName ?? "";
    variables["session.venueAddress"] = venueAddress ?? "";
    variables["session.virtualJoinUrl"] =
      selectedSession.virtualJoinUrl ?? event.virtualJoinUrl ?? "";
    variables["session.presenterNames"] = list(
      sessionPresenters.map((person) => person.name.trim() || person.email),
      "To be confirmed",
    );
  }

  if (input.recipient.registrationId) {
    const registration = await transaction
      .selectFrom("event_registration as registration")
      .leftJoin(
        "event_occurrence_region as occurrenceRegion",
        "occurrenceRegion.id",
        "registration.eventOccurrenceRegionId",
      )
      .leftJoin(
        "coordination_region as region",
        "region.id",
        "occurrenceRegion.regionId",
      )
      .leftJoin("coordination_region as parent", "parent.id", "region.parentId")
      .select([
        "registration.status",
        "registration.submittedAt",
        "registration.finalDecidedAt",
        "region.name as regionName",
        "region.code as regionCode",
        "parent.name as regionGroupName",
        "parent.code as regionGroupCode",
      ])
      .where("registration.id", "=", input.recipient.registrationId)
      .where("registration.eventOccurrenceId", "=", event.id)
      .executeTakeFirst();
    if (registration) {
      variables["registration.status"] = titleCase(registration.status);
      variables["registration.submittedAt"] = formatDate(
        registration.submittedAt,
        event.timezone,
      );
      variables["registration.confirmedAt"] = registration.finalDecidedAt
        ? formatDate(registration.finalDecidedAt, event.timezone)
        : "";
      variables["registration.regionName"] = registration.regionName ?? "";
      variables["registration.regionCode"] = registration.regionCode ?? "";
      variables["registration.regionGroupName"] =
        registration.regionGroupName ?? "";
      variables["registration.regionGroupCode"] =
        registration.regionGroupCode ?? "";
    }
  }

  if (input.recipient.participationId) {
    const [participation, items, completedItems, attendance] =
      await Promise.all([
        transaction
          .selectFrom("event_participation")
          .select(["checkedInAt", "completedAt"])
          .where("id", "=", input.recipient.participationId)
          .executeTakeFirst(),
        transaction
          .selectFrom("event_template_version_item")
          .select(["id", "kind", "sessionDefinitionId"])
          .where("eventTemplateVersionId", "=", event.eventTemplateVersionId)
          .execute(),
        transaction
          .selectFrom("learning_item_progress")
          .select("eventTemplateVersionItemId")
          .where("eventParticipationId", "=", input.recipient.participationId)
          .where("state", "=", "completed")
          .execute(),
        transaction
          .selectFrom("event_attendance as attendance")
          .innerJoin(
            "event_session as session",
            "session.id",
            "attendance.eventSessionId",
          )
          .select(["attendance.state", "session.sessionDefinitionId"])
          .where(
            "attendance.eventParticipationId",
            "=",
            input.recipient.participationId,
          )
          .execute(),
      ]);
    const learningCompleted = new Set(
      completedItems.flatMap((item) =>
        item.eventTemplateVersionItemId
          ? [item.eventTemplateVersionItemId]
          : [],
      ),
    );
    const attendedDefinitions = new Set(
      attendance
        .filter((entry) => entry.state === "attended")
        .map((entry) => entry.sessionDefinitionId),
    );
    const completedCount = items.filter((item) =>
      item.kind === "session"
        ? Boolean(
            item.sessionDefinitionId &&
            attendedDefinitions.has(item.sessionDefinitionId),
          )
        : learningCompleted.has(item.id),
    ).length;
    const progressPercent = items.length
      ? Math.round((completedCount / items.length) * 100)
      : 0;
    variables["progress.percent"] = `${String(progressPercent)}%`;
    variables["progress.completedItemCount"] = String(completedCount);
    variables["progress.totalItemCount"] = String(items.length);
    variables["progress.remainingItemCount"] = String(
      Math.max(0, items.length - completedCount),
    );
    variables["attendance.status"] = participation?.completedAt
      ? "Completed"
      : attendance.some((entry) => entry.state === "attended")
        ? "Attendance recorded"
        : participation?.checkedInAt
          ? "Checked in"
          : "Not recorded";
    variables["attendance.checkedInAt"] = participation?.checkedInAt
      ? formatDateTime(participation.checkedInAt, event.timezone)
      : "";
    variables["attendance.attendedSessionCount"] = String(
      attendedDefinitions.size,
    );
    variables["attendance.totalSessionCount"] = String(sessions.length);
  }

  return variables;
}
