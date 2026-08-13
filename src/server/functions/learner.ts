import { createServerFn } from "@tanstack/react-start";
import { accessCodeInputSchema } from "#/features/access/access-code.schema";
import { learnerEventRegistrationSchema } from "#/features/learner/learner.schema";
import { learnerWorkspaceInputSchema } from "#/features/learning/learning.schema";
import {
  learnerSurveyParamsSchema,
  learnerSurveyStepSchema,
  type LearnerSurveyResult,
  type LearnerSurveyStepResult,
} from "#/features/survey/survey.schema";

export const getLearnerDashboard = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return null;

    const { findLearnerDashboard } =
      await import("#/server/learner/learner.server");
    return await findLearnerDashboard(user);
  },
);

export const redeemLearnerAccessCode = createServerFn({ method: "POST" })
  .validator(accessCodeInputSchema)
  .handler(async ({ data }) => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" } as const;

    const { redeemAccessCode } =
      await import("#/server/access/redeem-access-code.server");
    return await redeemAccessCode(data.code, user);
  });

export const registerLearnerEvent = createServerFn({ method: "POST" })
  .validator(learnerEventRegistrationSchema)
  .handler(async ({ data }) => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" } as const;
    const { registerLearnerForEvent } =
      await import("#/server/learner/learner-event.server");
    return await registerLearnerForEvent(
      data.eventOccurrenceId,
      data.eventOccurrenceRegionId ?? null,
      user,
    );
  });

export const withdrawLearnerEvent = createServerFn({ method: "POST" })
  .validator(learnerEventRegistrationSchema)
  .handler(async ({ data }) => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" } as const;
    const { withdrawLearnerEventRegistration } =
      await import("#/server/learner/learner-event.server");
    return {
      status: await withdrawLearnerEventRegistration(
        data.eventOccurrenceId,
        user,
      ),
    } as const;
  });

export const getLearnerWorkspace = createServerFn({ method: "GET" })
  .validator(learnerWorkspaceInputSchema)
  .handler(async ({ data }) => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" } as const;

    const { findLearnerWorkspace } =
      await import("#/server/learning/learner-workspace.server");
    return await findLearnerWorkspace(data.enrollmentId, user);
  });

export const getLearnerSurvey = createServerFn({ method: "GET" })
  .validator(learnerSurveyParamsSchema)
  .handler(async ({ data }): Promise<LearnerSurveyResult> => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" };
    const { findLearnerSurvey } =
      await import("#/server/learning/learner-survey.server");
    const survey = await findLearnerSurvey(
      data.enrollmentId,
      data.courseVersionItemId,
      user,
    );
    if (!survey) return { status: "not-found" };
    if (survey === "unavailable") return { status: "unavailable" };
    return { status: "ready", data: survey };
  });

export const advanceLearnerSurveyStep = createServerFn({ method: "POST" })
  .validator(learnerSurveyStepSchema)
  .handler(async ({ data }): Promise<LearnerSurveyStepResult> => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" };
    const { advanceLearnerSurvey } =
      await import("#/server/learning/learner-survey.server");
    return await advanceLearnerSurvey(data, user);
  });
