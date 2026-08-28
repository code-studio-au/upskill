import { createServerFn } from "@tanstack/react-start";
import {
  adminEnrollmentParamsSchema,
  adminAccountInviteSchema,
  adminAdministratorRemoveSchema,
  adminLearnerParamsSchema,
  adminLearnerEventParamsSchema,
  adminLearnerSearchSchema,
  adminRequireReOnboardingSchema,
  adminProgressOverrideInputSchema,
  type AdminEnrollmentResult,
  type AdminAccountInviteResult,
  type AdminAdministratorDirectory,
  type AdminAdministratorRemoveResult,
  type AdminProfileResult,
  type AdminProgressOverrideResult,
  type AdminResult,
  type AdminLearnerDirectory,
  type AdminLearnerEventResult,
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

export const getAdminAdministrators = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminResult<AdminAdministratorDirectory>> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { findAdminAdministrators } =
      await import("#/server/admin/admin-account.server");
    return {
      status: "ready",
      data: await findAdminAdministrators(request.user),
    };
  },
);

export const inviteAdminLearner = createServerFn({ method: "POST" })
  .validator(adminAccountInviteSchema)
  .handler(async ({ data }): Promise<AdminAccountInviteResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { inviteAdminLearner: invite } =
      await import("#/server/admin/admin-account.server");
    return { status: "ready", data: await invite(data, request.user) };
  });

export const invitePlatformAdministrator = createServerFn({ method: "POST" })
  .validator(adminAccountInviteSchema)
  .handler(async ({ data }): Promise<AdminAccountInviteResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { invitePlatformAdministrator: invite } =
      await import("#/server/admin/admin-account.server");
    const outcome = await invite(data, request.user);
    if (outcome.status === "already-administrator")
      return { status: "conflict", reason: "already_administrator" };
    return {
      status: "ready",
      data: { outcome: outcome.status, userId: outcome.userId },
    };
  });

export const removePlatformAdministrator = createServerFn({ method: "POST" })
  .validator(adminAdministratorRemoveSchema)
  .handler(async ({ data }): Promise<AdminAdministratorRemoveResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { removePlatformAdministrator: remove } =
      await import("#/server/admin/admin-account.server");
    const outcome = await remove(data.userId, request.user);
    if (outcome.status === "not-found") return { status: "not-found" };
    if (outcome.status === "self")
      return { status: "conflict", reason: "self" };
    if (outcome.status === "last-administrator")
      return { status: "conflict", reason: "last_administrator" };
    if (outcome.status === "event-responsibility")
      return {
        status: "conflict",
        reason: "event_responsibility",
        eventAssignmentCount: outcome.eventAssignmentCount,
        templateDefaultCount: outcome.templateDefaultCount,
      };
    return {
      status: "ready",
      data: {
        outcome:
          outcome.status === "revoked" ? "revoked" : "invitation_cancelled",
      },
    };
  });

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

export const getAdminLearnerEventDetail = createServerFn({ method: "GET" })
  .validator(adminLearnerEventParamsSchema)
  .handler(async ({ data }): Promise<AdminLearnerEventResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { findAdminLearnerEventDetail } =
      await import("#/server/admin/admin-learner-events.server");
    const detail = await findAdminLearnerEventDetail(
      data.userId,
      data.eventOccurrenceId,
    );
    return detail ? { status: "ready", data: detail } : { status: "not-found" };
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
