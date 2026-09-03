import "@tanstack/react-start/server-only";

import type {
  CatalogSearch,
  CourseContent,
  CourseDetail,
  CourseSummary,
  EventDetail,
  EventSummary,
} from "#/features/catalog/catalog.schema";
import {
  courseContentSchema,
  bulkPricingSchema,
} from "#/features/catalog/catalog.schema";
import { certificateAccreditationsSchema } from "#/features/catalog/accreditation";
import { offeringImageSchema } from "#/features/shared/offering-image";
import { offeringTopicSchema } from "#/features/shared/offering-topic";
import type { AuthenticatedUser } from "#/server/auth/session.server";
import { getDatabase } from "#/server/db/database.server";
import {
  findReservedEventPlaces,
  findReservedEventPlacesByOccurrence,
} from "#/server/checkout/event-commerce-capacity.server";

interface PublishedCourse {
  slug: string;
  version: number;
  content: CourseContent;
}

function toSummary(course: PublishedCourse): CourseSummary {
  return {
    slug: course.slug,
    title: course.content.title,
    summary: course.content.summary,
    topic: course.content.topic,
    durationMinutes: course.content.durationMinutes,
    priceCents: course.content.priceCents,
    salePriceCents: course.content.salePriceCents,
    featured: course.content.featured,
    coverImage: course.content.coverImage,
  };
}

function toDetail(course: PublishedCourse): CourseDetail {
  return {
    ...toSummary(course),
    bulkPricing: course.content.bulkPricing,
    description: course.content.description,
    currency: course.content.currency,
    hasCompletionCertificate: course.content.hasCompletionCertificate,
    prerequisites: course.content.prerequisites,
    accreditations: course.content.accreditations,
    modules: course.content.modules,
    sections:
      course.content.sections ??
      ["pre-learning", "content", "post-learning", "followup"].flatMap(
        (phase) => {
          const items = course.content.modules.filter(
            (module) => module.phase === phase,
          );
          return items.length === 0
            ? []
            : [
                {
                  title:
                    phase === "pre-learning"
                      ? "Pre-learning"
                      : phase === "post-learning"
                        ? "Post-learning"
                        : phase === "followup"
                          ? "Follow-up"
                          : "Course content",
                  description: "",
                  items: items.map((module) => ({
                    title: module.title,
                    kind: "scorm" as const,
                    required: true,
                    durationMinutes: module.durationMinutes,
                  })),
                },
              ];
        },
      ),
    publishedVersion: course.version,
  };
}

function parsePublishedCourse(row: {
  slug: string;
  version: number;
  content: unknown;
}): PublishedCourse {
  return {
    slug: row.slug,
    version: row.version,
    content: courseContentSchema.parse(row.content),
  };
}

async function listLatestPublishedCourses(): Promise<Array<PublishedCourse>> {
  const rows = await getDatabase()
    .selectFrom("course")
    .innerJoin("course_version", "course_version.courseId", "course.id")
    .select(["course.slug", "course_version.version", "course_version.content"])
    .distinctOn("course.id")
    .where("course.status", "=", "published")
    .where("course_version.publishedAt", "is not", null)
    .orderBy("course.id")
    .orderBy("course_version.version", "desc")
    .execute();

  const publishedCourses: Array<PublishedCourse> = [];
  for (const row of rows) {
    const course = parsePublishedCourse(row);
    if (course.content.listInStore) publishedCourses.push(course);
  }
  return publishedCourses;
}

export async function findCourses(search: CatalogSearch): Promise<{
  courses: Array<CourseSummary>;
  page: number;
  pageSize: number;
  total: number;
  topics: Array<string>;
}> {
  const query = search.q.toLocaleLowerCase("en-AU");
  const pageSize = 12;
  const offset = (search.page - 1) * pageSize;
  const courses = await listLatestPublishedCourses();
  const topics = [
    ...new Map(
      courses.map((course) => [
        course.content.topic.toLocaleLowerCase("en-AU"),
        course.content.topic,
      ]),
    ).values(),
  ].sort((left, right) => left.localeCompare(right, "en-AU"));
  const matchingCourses = courses
    .filter((course) => {
      const topicMatches =
        search.topic === "all" ||
        course.content.topic.localeCompare(search.topic, "en-AU", {
          sensitivity: "base",
        }) === 0;
      const textMatches =
        query.length === 0 ||
        `${course.content.title} ${course.content.summary}`
          .toLocaleLowerCase("en-AU")
          .includes(query);
      return topicMatches && textMatches;
    })
    .sort((left, right) =>
      left.content.title.localeCompare(right.content.title, "en-AU"),
    );

  return {
    courses: matchingCourses.slice(offset, offset + pageSize).map(toSummary),
    page: search.page,
    pageSize,
    total: matchingCourses.length,
    topics,
  };
}

export async function findFeaturedCourses(): Promise<Array<CourseSummary>> {
  return (await listLatestPublishedCourses())
    .filter((course) => course.content.featured)
    .sort((left, right) =>
      left.content.title.localeCompare(right.content.title, "en-AU"),
    )
    .slice(0, 3)
    .map(toSummary);
}

export async function findCourseBySlug(
  slug: string,
): Promise<CourseDetail | null> {
  const row = await getDatabase()
    .selectFrom("course")
    .innerJoin("course_version", "course_version.courseId", "course.id")
    .select(["course.slug", "course_version.version", "course_version.content"])
    .where("course.slug", "=", slug)
    .where("course.status", "=", "published")
    .where("course_version.publishedAt", "is not", null)
    .orderBy("course_version.version", "desc")
    .limit(1)
    .executeTakeFirst();
  if (!row) return null;
  const course = parsePublishedCourse(row);
  return course.content.listInStore ? toDetail(course) : null;
}

type PublishedEventRow = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  topic: string;
  coverImage: unknown;
  hasCompletionCertificate: boolean;
  accreditations: unknown;
  deliveryMode: EventSummary["deliveryMode"];
  registrationMode: EventSummary["registrationMode"];
  approvalMode: "automatic" | "manual";
  startsAt: Date;
  endsAt: Date;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  timezone: string;
  priceCents: number | null;
  salePriceCents: number | null;
  currency: "AUD";
  bulkPricing: unknown;
  featured: boolean;
  capacity: number;
  confirmedCount: number;
  venueName: string | null;
  venueAddress: string | null;
  publicAccessReference: string | null;
  registrationSurveyVersionId: string | null;
};

function toEventSummary(
  event: PublishedEventRow,
  reservedPlaces: number,
): EventSummary {
  return {
    slug: event.slug,
    title: event.title,
    summary: event.summary,
    topic: offeringTopicSchema.parse(event.topic),
    coverImage: offeringImageSchema.parse(event.coverImage),
    deliveryMode: event.deliveryMode,
    registrationMode: event.registrationMode,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    timezone: event.timezone,
    priceCents: event.priceCents,
    salePriceCents: event.salePriceCents,
    currency: event.currency,
    featured: event.featured,
    remainingPlaces: Math.max(
      0,
      event.capacity - event.confirmedCount - reservedPlaces,
    ),
  };
}

function publishedEventQuery() {
  return getDatabase()
    .selectFrom("event_occurrence as occurrence")
    .innerJoin(
      "event_template_version as version",
      "version.id",
      "occurrence.eventTemplateVersionId",
    )
    .leftJoin("event_guest_access as guestAccess", (join) =>
      join
        .onRef("guestAccess.eventOccurrenceId", "=", "occurrence.id")
        .on("guestAccess.revokedAt", "is", null),
    )
    .select([
      "occurrence.id",
      "occurrence.slug",
      "occurrence.title",
      "occurrence.deliveryMode",
      "occurrence.registrationMode",
      "occurrence.approvalMode",
      "occurrence.startsAt",
      "occurrence.endsAt",
      "occurrence.registrationOpensAt",
      "occurrence.registrationClosesAt",
      "occurrence.timezone",
      "occurrence.priceCents",
      "occurrence.salePriceCents",
      "occurrence.currency",
      "occurrence.bulkPricing",
      "occurrence.featured",
      "occurrence.capacity",
      "occurrence.confirmedCount",
      "occurrence.venueName",
      "occurrence.venueAddress",
      "version.topic",
      "version.summary",
      "version.description",
      "version.coverImage",
      "version.hasCompletionCertificate",
      "version.accreditations",
      "version.registrationSurveyVersionId",
      "guestAccess.publicReference as publicAccessReference",
    ])
    .where("occurrence.status", "=", "published")
    .where("occurrence.listInStore", "=", true)
    .where("occurrence.startsAt", ">", new Date())
    .where("version.publishedAt", "is not", null);
}

export async function findEvents(search: CatalogSearch): Promise<{
  events: Array<EventSummary>;
  page: number;
  pageSize: number;
  total: number;
  topics: Array<string>;
}> {
  const rows = (await publishedEventQuery()
    .orderBy("occurrence.startsAt")
    .execute()) as Array<PublishedEventRow>;
  const now = new Date();
  const reservedPlaces = await findReservedEventPlacesByOccurrence(
    getDatabase(),
    rows.map((event) => event.id),
    now,
  );
  const query = search.q.toLocaleLowerCase("en-AU");
  const topics = [
    ...new Map(
      rows.map((event) => [
        event.topic.toLocaleLowerCase("en-AU"),
        event.topic,
      ]),
    ).values(),
  ].sort((left, right) => left.localeCompare(right, "en-AU"));
  const matches = rows.filter((event) => {
    const topicMatches =
      search.topic === "all" ||
      event.topic.localeCompare(search.topic, "en-AU", {
        sensitivity: "base",
      }) === 0;
    const textMatches =
      query.length === 0 ||
      `${event.title} ${event.summary}`
        .toLocaleLowerCase("en-AU")
        .includes(query);
    return topicMatches && textMatches;
  });
  const pageSize = 12;
  const offset = (search.page - 1) * pageSize;
  return {
    events: matches
      .slice(offset, offset + pageSize)
      .map((event) => toEventSummary(event, reservedPlaces.get(event.id) ?? 0)),
    page: search.page,
    pageSize,
    total: matches.length,
    topics,
  };
}

export async function findEventBySlug(
  slug: string,
  user: AuthenticatedUser | null = null,
): Promise<EventDetail | null> {
  const row = (await publishedEventQuery()
    .where("occurrence.slug", "=", slug)
    .executeTakeFirst()) as PublishedEventRow | undefined;
  if (!row) return null;
  const database = getDatabase();
  const now = new Date();
  const [sessions, regions, reservedPlaces] = await Promise.all([
    database
      .selectFrom("event_session")
      .select(["title", "startsAt", "endsAt", "venueName"])
      .where("eventOccurrenceId", "=", row.id)
      .orderBy("position")
      .execute(),
    database
      .selectFrom("event_occurrence_region as occurrenceRegion")
      .innerJoin(
        "coordination_region as region",
        "region.id",
        "occurrenceRegion.regionId",
      )
      .leftJoin("coordination_region as parent", "parent.id", "region.parentId")
      .select(["region.code", "region.name", "parent.name as groupName"])
      .where("occurrenceRegion.eventOccurrenceId", "=", row.id)
      .where("occurrenceRegion.retiredAt", "is", null)
      .orderBy("occurrenceRegion.position")
      .execute(),
    findReservedEventPlaces(database, row.id, now),
  ]);
  let eligible = row.registrationMode !== "required_restricted";
  if (row.registrationMode === "required_restricted" && user?.emailVerified) {
    const separator = user.email.lastIndexOf("@");
    const domain =
      separator > 0 && separator < user.email.length - 1
        ? user.email.slice(separator + 1).toLocaleLowerCase("en-AU")
        : null;
    eligible = Boolean(
      domain &&
      (await database
        .selectFrom("event_occurrence_domain")
        .select("domain")
        .where("eventOccurrenceId", "=", row.id)
        .where("domain", "=", domain)
        .executeTakeFirst()),
    );
  }
  const registrationAvailability =
    row.registrationOpensAt !== null && row.registrationOpensAt > now
      ? "not_open"
      : row.registrationClosesAt === null || row.registrationClosesAt <= now
        ? "closed"
        : row.approvalMode === "automatic" && row.confirmedCount >= row.capacity
          ? "full"
          : row.registrationMode === "required_restricted" && !user
            ? "authentication_required"
            : eligible
              ? "available"
              : "ineligible";
  return {
    ...toEventSummary(row, reservedPlaces),
    eventOccurrenceId: row.id,
    description: row.description,
    venueName: row.venueName,
    venueAddress: row.venueAddress,
    hasCompletionCertificate: row.hasCompletionCertificate,
    accreditations: certificateAccreditationsSchema.parse(row.accreditations),
    bulkPricing: bulkPricingSchema.parse(row.bulkPricing),
    publicAccessReference: row.publicAccessReference,
    hasRegistrationQuestionnaire: Boolean(row.registrationSurveyVersionId),
    registrationAvailability,
    regions,
    sessions: sessions.map((session) => ({
      ...session,
      startsAt: session.startsAt.toISOString(),
      endsAt: session.endsAt.toISOString(),
    })),
  };
}
