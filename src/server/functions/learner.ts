import { createServerFn } from "@tanstack/react-start";
import {
  accessCodeInputSchema,
  accessCodeRedemptionSchema,
} from "#/features/access/access-code.schema";
import { learnerEventRegistrationSchema } from "#/features/learner/learner.schema";
import { learnerEventWorkspaceInputSchema } from "#/features/learner/learner-event-workspace.schema";
import { learnerWorkspaceInputSchema } from "#/features/learning/learning.schema";
import { eventSurveyPublicReferenceSchema } from "#/features/event-operations/event-operations.schema";
import type { EventRecoveryLandingResult } from "#/features/event-recovery/event-recovery.schema";
import {
  registrationQuestionnaireStepSchema,
  type LearnerRegistrationQuestionnaireStepResult,
} from "#/features/registration/registration-questionnaire.schema";
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

export const advanceLearnerRegistrationQuestionnaire = createServerFn({
  method: "POST",
})
  .validator(registrationQuestionnaireStepSchema)
  .handler(
    async ({ data }): Promise<LearnerRegistrationQuestionnaireStepResult> => {
      const { getRequestUser } = await import("#/server/auth/session.server");
      const user = await getRequestUser();
      if (!user) return { status: "unauthenticated" };
      const { advanceRegistrationQuestionnaire } =
        await import("#/server/registration/learner-registration-questionnaire.server");
      return await advanceRegistrationQuestionnaire(
        {
          assignmentId: data.assignmentId,
          itemId: data.itemId,
          ...(typeof data.answer === "undefined"
            ? {}
            : { answer: data.answer }),
          ...(typeof data.profileUpdateAccepted === "undefined"
            ? {}
            : { profileUpdateAccepted: data.profileUpdateAccepted }),
        },
        user,
      );
    },
  );

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

export const getEventRecoveryLanding = createServerFn({ method: "GET" })
  .validator(eventSurveyPublicReferenceSchema)
  .handler(async ({ data }): Promise<EventRecoveryLandingResult> => {
    const { setResponseHeaders } = await import("@tanstack/react-start/server");
    setResponseHeaders(
      new Headers({
        "Cache-Control": "private, no-store",
        Pragma: "no-cache",
        "Referrer-Policy": "no-referrer",
      }),
    );
    const { getRequestUser } = await import("#/server/auth/session.server");
    const { resolveEventRecoveryLanding } =
      await import("#/server/events/event-prerequisite-recovery.server");
    return await resolveEventRecoveryLanding(
      data.publicReference,
      await getRequestUser(),
    );
  });

export const getLearnerEventSurvey = createServerFn({ method: "GET" })
  .validator(learnerEventSurveyParamsSchema)
  .handler(async ({ data }) => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const authenticatedUser = await getRequestUser();
    const { resolveEventSurveyActor } =
      await import("#/server/events/event-prerequisite-recovery.server");
    const { task, user } = await resolveEventSurveyActor(
      {
        eventOccurrenceId: data.eventOccurrenceId,
        eventTemplateVersionItemId: data.eventTemplateVersionItemId,
      },
      authenticatedUser,
    );
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
    return {
      status: "ready",
      data: {
        ...survey,
        accessMode: task ? ("event_task" as const) : ("authenticated" as const),
        recoveryPublicReference: task?.publicReference ?? null,
      },
    } as const;
  });

export const advanceLearnerEventSurveyStep = createServerFn({ method: "POST" })
  .validator(learnerEventSurveyStepSchema)
  .handler(async ({ data }) => {
    const { getRequestUser } = await import("#/server/auth/session.server");
    const authenticatedUser = await getRequestUser();
    const {
      clearEventTaskSessionCookie,
      completeEventTaskSession,
      resolveEventSurveyActor,
    } = await import("#/server/events/event-prerequisite-recovery.server");
    const { task, user } = await resolveEventSurveyActor(
      {
        eventTemplateVersionItemId: data.eventTemplateVersionItemId,
        eventParticipationId: data.eventParticipationId,
      },
      authenticatedUser,
    );
    if (!user) return { status: "unauthenticated" } as const;
    const { advanceLearnerEventSurvey } =
      await import("#/server/learning/learner-event-survey.server");
    const result = await advanceLearnerEventSurvey(data, user);
    if (task && result.status === "submitted") {
      await completeEventTaskSession(task.taskSessionId);
      const { setResponseHeaders } =
        await import("@tanstack/react-start/server");
      setResponseHeaders(
        new Headers({
          "Cache-Control": "private, no-store",
          "Set-Cookie": clearEventTaskSessionCookie(),
        }),
      );
    }
    return result;
  });
