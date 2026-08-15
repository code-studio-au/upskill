import "@tanstack/react-start/server-only";

import { sql } from "kysely";
import type {
  AvailableCourse,
  LearnerCourse,
  LearnerDashboard,
  LearnerEvent,
  LearnerEventsDashboard,
} from "#/features/learner/learner.schema";
import { courseContentSchema } from "#/features/catalog/catalog.schema";
import { getDatabase } from "#/server/db/database.server";
import type { AuthenticatedUser } from "#/server/auth/session.server";

function emailDomain(email: string): string | null {
  const separator = email.lastIndexOf("@");
  if (separator <= 0 || separator === email.length - 1) return null;
  return email.slice(separator + 1).toLocaleLowerCase("en-AU");
}

export async function findLearnerDashboard(
  user: AuthenticatedUser,
): Promise<LearnerDashboard> {
  const now = new Date();
  const enrollmentRows = await getDatabase()
    .selectFrom("enrollment")
    .innerJoin(
      "course_version",
      "course_version.id",
      "enrollment.courseVersionId",
    )
    .innerJoin("course", "course.id", "course_version.courseId")
    .select([
      "enrollment.id as enrollmentId",
      "enrollment.status",
      "enrollment.enrolledAt",
      "enrollment.completedAt",
      "enrollment.expiresAt",
      "enrollment.removedAt",
      "course.slug",
      "course_version.content",
    ])
    .where("enrollment.userId", "=", user.id)
    .orderBy("enrollment.enrolledAt", "desc")
    .execute();

  const courses: Array<LearnerCourse> = enrollmentRows.map((row) => {
    const content = courseContentSchema.parse(row.content);
    const state = row.removedAt
      ? "cancelled"
      : row.expiresAt && row.expiresAt <= now
        ? "expired"
        : row.status;
    return {
      enrollmentId: row.enrollmentId,
      slug: row.slug,
      title: content.title,
      summary: content.summary,
      durationMinutes: content.durationMinutes,
      state,
      enrolledAt: row.enrolledAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      certificate:
        row.status === "completed" &&
        row.completedAt !== null &&
        content.hasCompletionCertificate
          ? { enrollmentId: row.enrollmentId }
          : null,
    };
  });

  const domain = emailDomain(user.email);
  const availableCourses: Array<AvailableCourse> = [];
  if (user.emailVerified && domain) {
    const availableRows = await getDatabase()
      .selectFrom("access_grant_domain")
      .innerJoin(
        "access_grant",
        "access_grant.id",
        "access_grant_domain.accessGrantId",
      )
      .innerJoin(
        "course_version",
        "course_version.id",
        "access_grant.courseVersionId",
      )
      .innerJoin("course", "course.id", "course_version.courseId")
      .leftJoin("enrollment", (join) =>
        join
          .onRef("enrollment.courseVersionId", "=", "course_version.id")
          .on("enrollment.userId", "=", user.id),
      )
      .select([
        "course.slug",
        "course_version.content",
        "access_grant_domain.domain",
      ])
      .distinctOn("course_version.id")
      .where("access_grant_domain.domain", "=", domain)
      .where("course.status", "=", "published")
      .where("course_version.publishedAt", "is not", null)
      .where("access_grant.encryptedAccessCode", "is not", null)
      .where("access_grant.revokedAt", "is", null)
      .where("enrollment.id", "is", null)
      .whereRef("access_grant.redeemed", "<", "access_grant.quantity")
      .where((expression) =>
        expression.or([
          expression("access_grant.expiresAt", "is", null),
          expression("access_grant.expiresAt", ">", sql<Date>`now()`),
        ]),
      )
      .orderBy("course_version.id")
      .orderBy("course.title")
      .execute();

    for (const row of availableRows) {
      const content = courseContentSchema.parse(row.content);
      availableCourses.push({
        slug: row.slug,
        title: content.title,
        summary: content.summary,
        durationMinutes: content.durationMinutes,
        domain: row.domain,
      });
    }
  }

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
    courses,
    availableCourses,
  };
}

export async function findLearnerEventsDashboard(
  user: AuthenticatedUser,
): Promise<LearnerEventsDashboard> {
  const now = new Date();
  const domain = emailDomain(user.email);
  const eventRegistrations = await getDatabase()
    .selectFrom("event_registration")
    .select(["eventOccurrenceId", "status"])
    .where("userId", "=", user.id)
    .execute();
  const registeredEventIds = eventRegistrations.map(
    (registration) => registration.eventOccurrenceId,
  );

  let eventQuery = getDatabase()
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
      "event_occurrence.id as eventOccurrenceId",
      "event_occurrence.slug",
      "event_occurrence.title",
      "event_template.title as eventTemplateTitle",
      "event_occurrence.deliveryMode",
      "event_occurrence.registrationMode",
      "event_occurrence.approvalMode",
      "event_occurrence.timezone",
      "event_occurrence.startsAt",
      "event_occurrence.endsAt",
      "event_occurrence.registrationOpensAt",
      "event_occurrence.registrationClosesAt",
      "event_occurrence.capacity",
      "event_occurrence.confirmedCount",
    ])
    .orderBy("event_occurrence.startsAt");
  eventQuery = registeredEventIds.length
    ? eventQuery.where((expression) =>
        expression.or([
          expression("event_occurrence.id", "in", registeredEventIds),
          expression.and([
            expression("event_occurrence.status", "=", "published"),
            expression("event_occurrence.registrationMode", "!=", "open_entry"),
            expression("event_occurrence.endsAt", ">", now),
          ]),
        ]),
      )
    : eventQuery
        .where("event_occurrence.status", "=", "published")
        .where("event_occurrence.registrationMode", "!=", "open_entry")
        .where("event_occurrence.endsAt", ">", now);
  const eventRows = await eventQuery.execute();
  const eventIds = eventRows.map((event) => event.eventOccurrenceId);
  const [eventDomains, eventRegions] = eventIds.length
    ? await Promise.all([
        getDatabase()
          .selectFrom("event_occurrence_domain")
          .select(["eventOccurrenceId", "domain"])
          .where("eventOccurrenceId", "in", eventIds)
          .execute(),
        getDatabase()
          .selectFrom("event_occurrence_region as occurrence_region")
          .innerJoin(
            "coordination_region as region",
            "region.id",
            "occurrence_region.regionId",
          )
          .select([
            "occurrence_region.eventOccurrenceId",
            "occurrence_region.id",
            "region.name",
          ])
          .where("occurrence_region.eventOccurrenceId", "in", eventIds)
          .where("occurrence_region.retiredAt", "is", null)
          .orderBy("occurrence_region.position")
          .execute(),
      ])
    : [[], []];
  const registrationByEvent = new Map(
    eventRegistrations.map((registration) => [
      registration.eventOccurrenceId,
      registration.status,
    ]),
  );
  const events: Array<LearnerEvent> = eventRows.flatMap((event) => {
    const registrationStatus =
      registrationByEvent.get(event.eventOccurrenceId) ?? null;
    const eligible =
      event.registrationMode === "required_unrestricted" ||
      (user.emailVerified &&
        domain !== null &&
        eventDomains.some(
          (candidate) =>
            candidate.eventOccurrenceId === event.eventOccurrenceId &&
            candidate.domain === domain,
        ));
    if (!eligible && !registrationStatus) return [];
    const notOpen =
      event.registrationOpensAt !== null && event.registrationOpensAt > now;
    const closed =
      event.registrationClosesAt === null || event.registrationClosesAt <= now;
    const full =
      event.approvalMode === "automatic" &&
      event.confirmedCount >= event.capacity;
    return [
      {
        eventOccurrenceId: event.eventOccurrenceId,
        slug: event.slug,
        title: event.title,
        eventTemplateTitle: event.eventTemplateTitle,
        deliveryMode: event.deliveryMode,
        timezone: event.timezone,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
        registrationStatus,
        canRegister:
          !registrationStatus && eligible && !notOpen && !closed && !full,
        registrationUnavailableReason: notOpen
          ? "not_open"
          : closed
            ? "closed"
            : full
              ? "full"
              : null,
        regions: eventRegions
          .filter(
            (region) => region.eventOccurrenceId === event.eventOccurrenceId,
          )
          .map((region) => ({ id: region.id, name: region.name })),
      },
    ];
  });

  return {
    events,
  };
}
