import "@tanstack/react-start/server-only";

import type {
  CatalogSearch,
  CourseContent,
  CourseDetail,
  CourseSummary,
} from "#/features/catalog/catalog.schema";
import { courseContentSchema } from "#/features/catalog/catalog.schema";
import { getDatabase } from "#/server/db/database.server";

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
  };
}

function toDetail(course: PublishedCourse): CourseDetail {
  return {
    ...toSummary(course),
    description: course.content.description,
    currency: course.content.currency,
    hasCompletionCertificate: course.content.hasCompletionCertificate,
    prerequisites: course.content.prerequisites,
    accreditations: course.content.accreditations,
    modules: course.content.modules,
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

export async function findCourses(
  search: CatalogSearch,
): Promise<Array<CourseSummary>> {
  const query = search.q.toLocaleLowerCase("en-AU");
  const pageSize = 12;
  const offset = (search.page - 1) * pageSize;
  const courses = await listLatestPublishedCourses();

  return courses
    .filter((course) => {
      const topicMatches =
        search.topic === "all" || course.content.topic === search.topic;
      const textMatches =
        query.length === 0 ||
        `${course.content.title} ${course.content.summary}`
          .toLocaleLowerCase("en-AU")
          .includes(query);
      return topicMatches && textMatches;
    })
    .sort((left, right) =>
      left.content.title.localeCompare(right.content.title, "en-AU"),
    )
    .slice(offset, offset + pageSize)
    .map(toSummary);
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
