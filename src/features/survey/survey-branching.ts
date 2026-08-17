import type {
  SurveyAnswerValue,
  SurveyItem,
  SurveySection,
  SurveyVersionContent,
} from "./survey.schema";
import {
  isOperationalRegionQuestion,
  isRegionGroupQuestion,
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

export function operationalRegionPathsIncludeRegionGroup(
  content: SurveyVersionContent,
): boolean {
  const items = content.sections.flatMap((section) => section.items);
  if (!items.some(isOperationalRegionQuestion)) return true;

  const firstItemIndexes = new Map<string, number>();
  let itemOffset = 0;
  for (const section of content.sections) {
    if (section.items.length > 0) firstItemIndexes.set(section.id, itemOffset);
    itemOffset += section.items.length;
  }

  const pending: Array<{ itemIndex: number; regionGroupSeen: boolean }> = [
    { itemIndex: 0, regionGroupSeen: false },
  ];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const state = pending.pop();
    if (!state) break;
    const item = items[state.itemIndex];
    if (!item) continue;
    const regionGroupSeen =
      state.regionGroupSeen || isRegionGroupQuestion(item);
    const stateKey = `${String(state.itemIndex)}:${String(regionGroupSeen)}`;
    if (visited.has(stateKey)) continue;
    visited.add(stateKey);
    if (isOperationalRegionQuestion(item) && !regionGroupSeen) return false;

    const defaultNextIndex = state.itemIndex + 1;
    const nextIndexes = new Set<number>();
    if (item.kind === "single_choice" || item.kind === "dropdown") {
      if (item.options.length === 0) nextIndexes.add(defaultNextIndex);
      for (const option of item.options) {
        const targetIndex = option.nextSectionId
          ? firstItemIndexes.get(option.nextSectionId)
          : undefined;
        nextIndexes.add(targetIndex ?? defaultNextIndex);
      }
    } else nextIndexes.add(defaultNextIndex);
    for (const nextIndex of nextIndexes)
      if (nextIndex < items.length)
        pending.push({ itemIndex: nextIndex, regionGroupSeen });
  }
  return true;
}
