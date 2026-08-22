import { createServerFn } from "@tanstack/react-start";
import {
  catalogSearchSchema,
  courseSlugSchema,
} from "#/features/catalog/catalog.schema";

export const getFeaturedCourses = createServerFn({ method: "GET" }).handler(
  async () => {
    const { findFeaturedCourses } =
      await import("#/server/catalog/catalog.server");
    return await findFeaturedCourses();
  },
);

export const searchCourses = createServerFn({ method: "GET" })
  .validator(catalogSearchSchema)
  .handler(async ({ data }) => {
    const { findCourses } = await import("#/server/catalog/catalog.server");
    return await findCourses(data);
  });

export const searchEvents = createServerFn({ method: "GET" })
  .validator(catalogSearchSchema)
  .handler(async ({ data }) => {
    const { findEvents } = await import("#/server/catalog/catalog.server");
    return await findEvents(data);
  });

export const getCourse = createServerFn({ method: "GET" })
  .validator(courseSlugSchema)
  .handler(async ({ data }) => {
    const { findCourseBySlug } =
      await import("#/server/catalog/catalog.server");
    return await findCourseBySlug(data.slug);
  });

export const getEvent = createServerFn({ method: "GET" })
  .validator(courseSlugSchema)
  .handler(async ({ data }) => {
    const { findEventBySlug } = await import("#/server/catalog/catalog.server");
    return await findEventBySlug(data.slug);
  });
