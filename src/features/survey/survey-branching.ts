import type {
  SurveyAnswerValue,
  SurveyItem,
  SurveySection,
  SurveyVersionContent,
} from "./survey.schema";

export interface SurveyPathStep {
  item: SurveyItem;
  section: SurveySection;
  sectionIndex: number;
}

export function surveyPathSteps(
  content: SurveyVersionContent,
  answers: Readonly<Record<string, SurveyAnswerValue>>,
): Array<SurveyPathStep> {
  const sectionIndexes = new Map(
    content.sections.map((section, index) => [section.id, index] as const),
  );
  const steps: Array<SurveyPathStep> = [];
  let sectionIndex = 0;
  let itemIndex = 0;

  while (sectionIndex < content.sections.length) {
    const section = content.sections[sectionIndex];
    if (!section) break;
    const item = section.items[itemIndex];
    if (!item) {
      sectionIndex += 1;
      itemIndex = 0;
      continue;
    }
    steps.push({ item, section, sectionIndex });
    if (
      (item.kind === "single_choice" || item.kind === "dropdown") &&
      typeof answers[item.id] === "string"
    ) {
      const selected = item.options.find(
        (option) => option.id === answers[item.id],
      );
      const targetIndex = selected?.nextSectionId
        ? sectionIndexes.get(selected.nextSectionId)
        : undefined;
      if (targetIndex !== undefined && targetIndex > sectionIndex) {
        sectionIndex = targetIndex;
        itemIndex = 0;
        continue;
      }
    }
    itemIndex += 1;
  }
  return steps;
}

export function surveyPathItems(
  content: SurveyVersionContent,
  answers: Readonly<Record<string, SurveyAnswerValue>>,
): Array<SurveyItem> {
  return surveyPathSteps(content, answers).map((step) => step.item);
}
