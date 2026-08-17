import { createServerFn } from "@tanstack/react-start";
import {
  adminEnrollmentParamsSchema,
  adminLearnerParamsSchema,
  adminLearnerSearchSchema,
  adminRequireReOnboardingSchema,
  adminProgressOverrideInputSchema,
  type AdminEnrollmentResult,
  type AdminProfileResult,
  type AdminProgressOverrideResult,
  type AdminResult,
  type AdminLearnerDirectory,
  type AdminOverview,
  type AdminRequireReOnboardingResult,
} from "#/features/admin/admin.schema";

export const getAdminOverview = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminResult<AdminOverview>> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { findAdminOverview } =
      await import("#/server/admin/admin-learner.server");
    return { status: "ready", data: await findAdminOverview(request.user) };
  },
);

export const getAdminLearners = createServerFn({ method: "GET" })
  .validator(adminLearnerSearchSchema)
  .handler(async ({ data }): Promise<AdminResult<AdminLearnerDirectory>> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { findAdminLearners } =
      await import("#/server/admin/admin-learner.server");
    return { status: "ready", data: await findAdminLearners(data) };
  });

export const getAdminLearnerProfile = createServerFn({ method: "GET" })
  .validator(adminLearnerParamsSchema)
  .handler(async ({ data }): Promise<AdminProfileResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { findAdminLearnerProfile } =
      await import("#/server/admin/admin-learner.server");
    const profile = await findAdminLearnerProfile(data.userId);
    return profile
      ? { status: "ready", data: profile }
      : { status: "not-found" };
  });

export const getAdminEnrollmentDetail = createServerFn({ method: "GET" })
  .validator(adminEnrollmentParamsSchema)
  .handler(async ({ data }): Promise<AdminEnrollmentResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { findAdminEnrollmentDetail } =
      await import("#/server/admin/admin-learner.server");
    const enrollment = await findAdminEnrollmentDetail(
      data.userId,
      data.enrollmentId,
    );
    return enrollment
      ? { status: "ready", data: enrollment }
      : { status: "not-found" };
  });

export const overrideAdminProgress = createServerFn({ method: "POST" })
  .validator(adminProgressOverrideInputSchema)
  .handler(async ({ data }): Promise<AdminProgressOverrideResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { applyAdminProgressOverride } =
      await import("#/server/admin/admin-learner.server");
    const outcome = await applyAdminProgressOverride(data, request.user);
    return outcome === "not-found"
      ? { status: "not-found" }
      : { status: "ready", data: { outcome } };
  });

export const requireAdminReOnboarding = createServerFn({ method: "POST" })
  .validator(adminRequireReOnboardingSchema)
  .handler(async ({ data }): Promise<AdminRequireReOnboardingResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { requireAdminReOnboarding: requireOnboarding } =
      await import("#/server/admin/admin-learner.server");
    const outcome = await requireOnboarding(data.userId, request.user);
    if (outcome === "not-found") return { status: "not-found" };
    if (outcome === "no-active-onboarding")
      return { status: "conflict", reason: "no_active_onboarding" };
    if (outcome === "onboarding-already-required")
      return { status: "conflict", reason: "onboarding_already_required" };
    return { status: "ready", data: { outcome } };
  });
