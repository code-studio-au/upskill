import { Button } from "#/features/shared/mantine";
import { advanceLearnerRegistrationQuestionnaire } from "#/server/functions/learner";
import { Link, useRouter } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import type { LearnerRegistrationQuestionnaire as Questionnaire } from "./registration-questionnaire.schema";

const LearnerSurveyExperience = lazy(async () => {
  const module = await import("#/features/survey/LearnerSurveyExperience");
  return { default: module.LearnerSurveyExperience };
});

export function LearnerRegistrationQuestionnaire({
  questionnaire,
}: {
  questionnaire: Questionnaire;
}) {
  const router = useRouter();
  const isCourse = questionnaire.target.kind === "course";
  return (
    <Suspense fallback={null}>
      <LearnerSurveyExperience
        survey={questionnaire}
        completionTitle="Registration details completed"
        completionDescription={
          isCourse
            ? "Your registration details have been submitted. You can now open the course."
            : "Your details have been submitted and your event registration has been updated."
        }
        {...(questionnaire.profileUpdateOffered
          ? {
              profileUpdateOffer:
                "Also update my current profile with the applicable answers",
            }
          : {})}
        returnAction={
          isCourse ? (
            <Button
              onClick={() => {
                void router.invalidate();
              }}
            >
              Open course
            </Button>
          ) : (
            <Button component={Link} to="/my-events">
              Return to my events
            </Button>
          )
        }
        onAdvance={async (itemId, answer, options) =>
          await advanceLearnerRegistrationQuestionnaire({
            data: {
              assignmentId: questionnaire.assignmentId,
              itemId,
              ...(typeof answer === "undefined" ? {} : { answer }),
              ...(options
                ? { profileUpdateAccepted: options.profileUpdateAccepted }
                : {}),
            },
          })
        }
      />
    </Suspense>
  );
}
