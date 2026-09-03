import {
  isOperationalRegionQuestion,
  isRegionGroupQuestion,
  surveyProfileField,
  type SurveyAnswerValue,
  type SurveyQuestion,
  type SurveyVersionContent,
} from "#/features/survey/survey.schema";
import { allSurveyPathsIncludeOperationalRegion } from "#/features/survey/survey-branching";
import { formatLocalDate } from "#/features/shared/local-date";

type EventRegistrationStatus =
  | "submitted"
  | "coordinator_approved"
  | "coordinator_declined"
  | "selected"
  | "waitlisted"
  | "not_selected"
  | "withdrawn"
  | "cancelled";

const terminalEventRegistrationStatuses = new Set<EventRegistrationStatus>([
  "coordinator_declined",
  "not_selected",
  "withdrawn",
  "cancelled",
]);

export function eventRegistrationQuestionnaireRequired(input: {
  registrationSurveyVersionId: string | null;
  questionnaireStatus:
    "assigned" | "in_progress" | "completed" | "waived" | null;
  registrationStatus: EventRegistrationStatus | null;
}): boolean {
  return (
    input.registrationSurveyVersionId !== null &&
    (input.registrationStatus === null ||
      !terminalEventRegistrationStatuses.has(input.registrationStatus)) &&
    input.questionnaireStatus !== "completed" &&
    input.questionnaireStatus !== "waived"
  );
}

export function registrationQuestions(
  content: SurveyVersionContent,
): Array<SurveyQuestion> {
  return content.sections.flatMap((section) =>
    section.items.flatMap((item) =>
      item.kind === "instruction" ? [] : [item],
    ),
  );
}

export function registrationOffersProfileUpdate(
  content: SurveyVersionContent,
): boolean {
  return registrationQuestions(content).some(
    (question) =>
      surveyProfileField(question) !== null ||
      isOperationalRegionQuestion(question),
  );
}

export function filterRegistrationEventRegionOptions(
  content: SurveyVersionContent,
  operationalRegionIds: ReadonlySet<string>,
): SurveyVersionContent {
  const allowedParentIds = new Set<string>();
  for (const question of registrationQuestions(content))
    if (isOperationalRegionQuestion(question))
      for (const option of question.options)
        if (
          option.externalValue &&
          operationalRegionIds.has(option.externalValue) &&
          option.parentExternalValue
        )
          allowedParentIds.add(option.parentExternalValue);
  return {
    ...content,
    sections: content.sections.map((section) => ({
      ...section,
      items: section.items.map((item) =>
        isOperationalRegionQuestion(item)
          ? {
              ...item,
              options: item.options.filter(
                (option) =>
                  option.externalValue &&
                  operationalRegionIds.has(option.externalValue),
              ),
            }
          : isRegionGroupQuestion(item)
            ? {
                ...item,
                options: item.options.filter(
                  (option) =>
                    option.externalValue &&
                    allowedParentIds.has(option.externalValue),
                ),
              }
            : item,
      ),
    })),
  };
}

export function registrationSurveySupportsEventRegions(
  content: SurveyVersionContent,
  operationalRegionIds: ReadonlySet<string>,
): boolean {
  if (operationalRegionIds.size === 0) return true;
  const filtered = filterRegistrationEventRegionOptions(
    content,
    operationalRegionIds,
  );
  const operationalRegionQuestion = registrationQuestions(filtered).find(
    isOperationalRegionQuestion,
  );
  if (
    !operationalRegionQuestion ||
    !allSurveyPathsIncludeOperationalRegion(filtered)
  )
    return false;
  const surveyRegionIds = new Set(
    operationalRegionQuestion.options.flatMap((option) =>
      option.externalValue ? [option.externalValue] : [],
    ),
  );
  return [...operationalRegionIds].every((regionId) =>
    surveyRegionIds.has(regionId),
  );
}

export function withoutRegistrationAnswer(
  answers: Record<string, SurveyAnswerValue>,
  questionId: string,
): Record<string, SurveyAnswerValue> {
  return Object.fromEntries(
    Object.entries(answers).filter(
      ([candidateId]) => candidateId !== questionId,
    ),
  );
}

export function registrationAnswerText(
  question: SurveyQuestion,
  answer: SurveyAnswerValue,
): string {
  if (typeof answer === "boolean") return answer ? "Yes" : "No";
  if (typeof answer === "number") return String(answer);
  if (question.kind === "date" && typeof answer === "string")
    return formatLocalDate(answer);
  if (Array.isArray(answer))
    return answer
      .map(
        (value) =>
          ("options" in question
            ? question.options.find((option) => option.id === value)?.label
            : null) ?? value,
      )
      .join(", ");
  if ("options" in question)
    return (
      question.options.find((option) => option.id === answer)?.label ?? answer
    );
  return answer;
}
