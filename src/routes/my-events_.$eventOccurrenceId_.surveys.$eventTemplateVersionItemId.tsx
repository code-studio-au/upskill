import { Button } from "#/features/shared/mantine";
import { LearnerSurveyExperience } from "#/features/survey/LearnerSurveyExperience";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { learnerEventSurveyParamsSchema } from "#/features/survey/survey.schema";
import {
  advanceLearnerEventSurveyStep,
  getLearnerEventSurvey,
} from "#/server/functions/learner";

export const Route = createFileRoute(
  "/my-events_/$eventOccurrenceId_/surveys/$eventTemplateVersionItemId",
)({
  ssr: "data-only",
  loader: async ({ params }) => {
    const parsed = learnerEventSurveyParamsSchema.safeParse(params);
    if (!parsed.success) throw notFound();
    const result = await getLearnerEventSurvey({ data: parsed.data });
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: {
          redirect: `/my-events/${encodeURIComponent(parsed.data.eventOccurrenceId)}/surveys/${encodeURIComponent(parsed.data.eventTemplateVersionItemId)}`,
        },
      });
    if (result.status === "not-found") throw notFound();
    if (result.status === "unavailable")
      throw redirect({
        to: "/my-events/$eventOccurrenceId",
        params: { eventOccurrenceId: parsed.data.eventOccurrenceId },
      });
    return result.data;
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `${loaderData.content.title} — ${loaderData.eventTitle}`
          : "Event survey — Upskill",
      },
    ],
  }),
  component: LearnerEventSurveyPage,
});

function LearnerEventSurveyPage() {
  const survey = Route.useLoaderData();
  const taskAccess = survey.accessMode === "event_task";
  return (
    <LearnerSurveyExperience
      survey={survey}
      completionDescription="Your response was submitted and this event activity is complete."
      returnAction={
        <Button
          component="a"
          href={
            taskAccess
              ? "/"
              : `/my-events/${encodeURIComponent(survey.eventOccurrenceId)}`
          }
          variant="light"
        >
          {taskAccess ? "Finish on this device" : "Return to event"}
        </Button>
      }
      onAdvance={async (itemId, answer) =>
        await advanceLearnerEventSurveyStep({
          data: {
            eventParticipationId: survey.eventParticipationId,
            eventTemplateVersionItemId: survey.eventTemplateVersionItemId,
            itemId,
            ...(typeof answer === "undefined" ? {} : { answer }),
          },
        })
      }
    />
  );
}
