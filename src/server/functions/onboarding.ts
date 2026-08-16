import { createServerFn } from "@tanstack/react-start";
import {
  activateOnboardingSchema,
  onboardingStepSchema,
  type AdminOnboardingMutationResult,
  type AdminOnboardingResult,
  type LearnerOnboardingResult,
  type LearnerOnboardingStepResult,
} from "#/features/onboarding/onboarding.schema";

export const getAdminOnboarding = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminOnboardingResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { findAdminOnboarding } =
      await import("#/server/onboarding/admin-onboarding.server");
    return { status: "ready", data: await findAdminOnboarding() };
  },
);

export const activateAdminOnboarding = createServerFn({ method: "POST" })
  .validator(activateOnboardingSchema)
  .handler(async ({ data }): Promise<AdminOnboardingMutationResult> => {
    const { getAdministratorRequest } =
      await import("#/server/admin/admin-access.server");
    const request = await getAdministratorRequest();
    if (request.status !== "ready") return request;
    const { activateOnboardingConfiguration } =
      await import("#/server/onboarding/admin-onboarding.server");
    const result = await activateOnboardingConfiguration(data, request.user);
    return result.status === "activated"
      ? { status: "ready", data: { configurationId: result.configurationId } }
      : result;
  });

export const getLearnerOnboarding = createServerFn({ method: "GET" }).handler(
  async (): Promise<LearnerOnboardingResult> => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" };
    const { findLearnerOnboarding } =
      await import("#/server/onboarding/learner-onboarding.server");
    const result = await findLearnerOnboarding(user);
    return typeof result === "string"
      ? { status: result }
      : { status: "ready", data: result };
  },
);

export const saveOnboardingStep = createServerFn({ method: "POST" })
  .validator(onboardingStepSchema)
  .handler(async ({ data }): Promise<LearnerOnboardingStepResult> => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" };
    const { saveLearnerOnboardingStep } =
      await import("#/server/onboarding/learner-onboarding.server");
    return saveLearnerOnboardingStep(
      data.assignmentId,
      data.itemId,
      data.answer,
      user,
    );
  });
