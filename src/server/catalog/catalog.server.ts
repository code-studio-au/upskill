import "@tanstack/react-start/server-only";

import type {
  CatalogSearch,
  CourseSummary,
} from "#/features/catalog/catalog.schema";

const courses = [
  {
    slug: "leading-through-change",
    title: "Leading through change",
    summary:
      "Practical tools for communicating clearly and sustaining trust through uncertainty.",
    topic: "leadership",
    durationMinutes: 75,
    priceCents: 14900,
    featured: true,
  },
  {
    slug: "psychological-safety-at-work",
    title: "Psychological safety at work",
    summary:
      "Build team habits that make it safe to ask questions, challenge assumptions and learn.",
    topic: "safety",
    durationMinutes: 50,
    priceCents: 9900,
    featured: true,
  },
  {
    slug: "responsible-ai-foundations",
    title: "Responsible AI foundations",
    summary:
      "Use generative AI productively while recognising privacy, security and governance risks.",
    topic: "technology",
    durationMinutes: 90,
    priceCents: 17900,
    featured: true,
  },
] satisfies Array<CourseSummary>;

export function findCourses(search: CatalogSearch): Array<CourseSummary> {
  const query = search.q.toLocaleLowerCase("en-AU");
  return courses.filter((course) => {
    const topicMatches =
      search.topic === "all" || course.topic === search.topic;
    const textMatches =
      query.length === 0 ||
      `${course.title} ${course.summary}`
        .toLocaleLowerCase("en-AU")
        .includes(query);
    return topicMatches && textMatches;
  });
}

export function findFeaturedCourses(): Array<CourseSummary> {
  return courses.filter((course) => course.featured);
}

export function findCourseBySlug(slug: string): CourseSummary | null {
  return courses.find((course) => course.slug === slug) ?? null;
}
