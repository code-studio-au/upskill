import { createServerFn } from "@tanstack/react-start";
import {
  adminCourseCreateSchema,
  adminCourseDraftSchema,
  adminCourseParamsSchema,
  adminCourseVersionParamsSchema,
  type AdminCourseDetailResult,
  type AdminCourseMutationResult,
  type AdminCourseResult,
  type AdminCourseSummary,
} from "#/features/admin-course/admin-course.schema";

export const getAdminCourses = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminCourseResult<Array<AdminCourseSummary>>> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { findAdminCourses } =
      await import("#/server/admin/admin-course.server");
    return { status: "ready", data: await findAdminCourses() };
  },
);

export const getAdminCourse = createServerFn({ method: "GET" })
  .validator(adminCourseParamsSchema)
  .handler(async ({ data }): Promise<AdminCourseDetailResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { findAdminCourse } =
      await import("#/server/admin/admin-course.server");
    const course = await findAdminCourse(data.courseId);
    return course ? { status: "ready", data: course } : { status: "not-found" };
  });

export const createAdminCourse = createServerFn({ method: "POST" })
  .validator(adminCourseCreateSchema)
  .handler(async ({ data }): Promise<AdminCourseMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { createAdminCourse: createCourse } =
      await import("#/server/admin/admin-course.server");
    const outcome = await createCourse(data, request.user);
    return outcome.status === "conflict"
      ? { status: "conflict", reason: outcome.reason }
      : {
          status: "ready",
          data: {
            outcome: "created",
            courseId: outcome.courseId,
            versionId: outcome.versionId,
          },
        };
  });

export const saveAdminCourse = createServerFn({ method: "POST" })
  .validator(adminCourseDraftSchema)
  .handler(async ({ data }): Promise<AdminCourseMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { saveAdminCourseDraft } =
      await import("#/server/admin/admin-course.server");
    const outcome = await saveAdminCourseDraft(data, request.user);
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome !== "saved") return { status: "conflict", reason: outcome };
    return {
      status: "ready",
      data: { outcome: "saved", courseId: data.courseId },
    };
  });

export const createAdminCourseVersion = createServerFn({ method: "POST" })
  .validator(adminCourseParamsSchema)
  .handler(async ({ data }): Promise<AdminCourseMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { createAdminCourseVersion: createVersion } =
      await import("#/server/admin/admin-course.server");
    const outcome = await createVersion(data.courseId, request.user);
    if (outcome.status !== "created") {
      if (outcome.status === "not-found") return { status: "not-found" };
      return { status: "conflict", reason: "draft_exists_or_archived" };
    }
    return {
      status: "ready",
      data: {
        outcome: "created",
        courseId: data.courseId,
        versionId: outcome.versionId,
      },
    };
  });

export const publishAdminCourse = createServerFn({ method: "POST" })
  .validator(adminCourseVersionParamsSchema)
  .handler(async ({ data }): Promise<AdminCourseMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { publishAdminCourseVersion } =
      await import("#/server/admin/admin-course.server");
    const outcome = await publishAdminCourseVersion(
      data.courseId,
      data.versionId,
      request.user,
    );
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "conflict")
      return { status: "conflict", reason: "draft_not_publishable" };
    return {
      status: "ready",
      data: { outcome: "published", courseId: data.courseId },
    };
  });

export const archiveAdminCourse = createServerFn({ method: "POST" })
  .validator(adminCourseParamsSchema)
  .handler(async ({ data }): Promise<AdminCourseMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { archiveAdminCourse: archiveCourse } =
      await import("#/server/admin/admin-course.server");
    const outcome = await archiveCourse(data.courseId, request.user);
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "conflict")
      return { status: "conflict", reason: "already_archived" };
    return {
      status: "ready",
      data: { outcome: "archived", courseId: data.courseId },
    };
  });

export const deleteAdminCourse = createServerFn({ method: "POST" })
  .validator(adminCourseParamsSchema)
  .handler(async ({ data }): Promise<AdminCourseMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { deleteArchivedAdminCourse } =
      await import("#/server/admin/admin-course.server");
    const outcome = await deleteArchivedAdminCourse(
      data.courseId,
      request.user,
    );
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "conflict")
      return {
        status: "conflict",
        reason: "course_has_enrollment_or_commerce_history",
      };
    return {
      status: "ready",
      data: { outcome: "deleted", courseId: data.courseId },
    };
  });
