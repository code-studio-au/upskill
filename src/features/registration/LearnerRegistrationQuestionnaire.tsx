import { Button } from "#/features/shared/mantine";
import { LearnerSurveyExperience } from "#/features/survey/LearnerSurveyExperience";
import { advanceLearnerRegistrationQuestionnaire } from "#/server/functions/learner";
import { Link, useRouter } from "@tanstack/react-router";
import type { LearnerRegistrationQuestionnaire as Questionnaire } from "./registration-questionnaire.schema";

export function LearnerRegistrationQuestionnaire({
  questionnaire,
}: {
  questionnaire: Questionnaire;
}) {
  const router = useRouter();
  const isCourse = questionnaire.target.kind === "course";
  return (
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
            profileUpdateAccepted: options?.profileUpdateAccepted ?? false,
          },
        })
      }
    />
  );
}
