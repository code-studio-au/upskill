import {
  isOperationalRegionQuestion,
  isRegionGroupQuestion,
  surveyProfileField,
  type SurveyAnswerValue,
  type SurveyQuestion,
  type SurveyVersionContent,
} from "#/features/survey/survey.schema";

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
