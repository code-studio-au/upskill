import { createServerFn } from "@tanstack/react-start";
import {
  accessCodeInputSchema,
  accessCodeRedemptionSchema,
} from "#/features/access/access-code.schema";
import { learnerEventRegistrationSchema } from "#/features/learner/learner.schema";
import { learnerEventWorkspaceInputSchema } from "#/features/learner/learner-event-workspace.schema";
import {
  eventSurveyPublicReferenceSchema,
  type LearnerEventSurveyReferenceResult,
} from "#/features/event-operations/event-operations.schema";
import { learnerWorkspaceInputSchema } from "#/features/learning/learning.schema";
import {
  learnerSurveyParamsSchema,
  learnerSurveyStepSchema,
  learnerEventSurveyParamsSchema,
  learnerEventSurveyStepSchema,
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

export const getLearnerEventsDashboard = createServerFn({
  method: "GET",
}).handler(async () => {
  const { getRequestUser } = await import("#/server/auth/session.server");
  const user = await getRequestUser();
  if (!user) return null;

  const { findLearnerEventsDashboard } =
    await import("#/server/learner/learner.server");
  return await findLearnerEventsDashboard(user);
});

export const getLearnerEventWorkspace = createServerFn({ method: "GET" })
  .validator(learnerEventWorkspaceInputSchema)
  .handler(async ({ data }) => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" } as const;
    const { findLearnerEventWorkspace } =
      await import("#/server/learning/learner-event-workspace.server");
    return await findLearnerEventWorkspace(data.eventOccurrenceId, user);
  });

export const resolveLearnerEventSurveyQr = createServerFn({ method: "GET" })
  .validator(eventSurveyPublicReferenceSchema)
  .handler(async ({ data }): Promise<LearnerEventSurveyReferenceResult> => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" };
    const { resolveLearnerEventSurveyReference } =
      await import("#/server/events/event-survey-access.server");
    return await resolveLearnerEventSurveyReference(data.publicReference, user);
  });

export const redeemLearnerAccessCode = createServerFn({ method: "POST" })
  .validator(accessCodeRedemptionSchema)
  .handler(async ({ data }) => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" } as const;

    const { redeemAccessCode } =
      await import("#/server/access/redeem-access-code.server");
    return await redeemAccessCode(data, user);
  });

export const previewLearnerAccessCode = createServerFn({ method: "POST" })
  .validator(accessCodeInputSchema)
  .handler(async ({ data }) => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" } as const;
    const { previewAccessCode } =
      await import("#/server/access/redeem-access-code.server");
    return await previewAccessCode(data.code, user);
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

export const getLearnerEventSurvey = createServerFn({ method: "GET" })
  .validator(learnerEventSurveyParamsSchema)
  .handler(async ({ data }) => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" } as const;
    const { findLearnerEventSurvey } =
      await import("#/server/learning/learner-event-survey.server");
    const survey = await findLearnerEventSurvey(
      data.eventOccurrenceId,
      data.eventTemplateVersionItemId,
      user,
    );
    if (!survey) return { status: "not-found" } as const;
    if (survey === "unavailable") return { status: "unavailable" } as const;
    return { status: "ready", data: survey } as const;
  });

export const advanceLearnerEventSurveyStep = createServerFn({ method: "POST" })
  .validator(learnerEventSurveyStepSchema)
  .handler(async ({ data }) => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const user = await getRequestUser();
    if (!user) return { status: "unauthenticated" } as const;
    const { advanceLearnerEventSurvey } =
      await import("#/server/learning/learner-event-survey.server");
    return await advanceLearnerEventSurvey(data, user);
  });
