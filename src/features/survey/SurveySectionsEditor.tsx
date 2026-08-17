import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  Title,
} from "#/features/shared/mantine";
import { useState } from "react";
import { SurveyQuestionEditor } from "./SurveyQuestionEditor";
import type {
  SurveyOption,
  SurveyItem,
  SurveyQuestion,
  SurveySection,
} from "./survey.schema";
import { ConfirmationDialog } from "#/features/shared/ConfirmationDialog";
import { MantineTextInput } from "#/features/shared/MantineTextInput";

function move<T>(values: Array<T>, index: number, direction: -1 | 1): Array<T> {
  const target = index + direction;
  if (target < 0 || target >= values.length) return values;
  const next = [...values];
  [next[index], next[target]] = [next[target] as T, next[index] as T];
  return next;
}

function newItem(kind: SurveyItem["kind"]): SurveyItem {
  if (kind === "instruction")
    return {
      id: `instruction_${crypto.randomUUID()}`,
      kind,
      title: "New information",
      body: "Add the information or instructions the learner should read.",
    };
  const base = {
    id: `question_${crypto.randomUUID()}`,
    prompt: "New question",
    required: true,
  };
  if (kind === "short_text")
    return { ...base, kind, maximumLength: 240, format: "plain" };
  if (kind === "long_text") return { ...base, kind, maximumLength: 2_000 };
  if (kind === "checkbox") return { ...base, kind };
  if (kind === "number")
    return { ...base, kind, integer: false, minimum: null, maximum: null };
  if (kind === "date") return { ...base, kind, minimum: null, maximum: null };
  if (kind === "rating")
    return {
      ...base,
      kind,
      minimum: 1,
      maximum: 5,
      minimumLabel: "",
      maximumLabel: "",
    };
  return {
    ...base,
    kind,
    options: [
      { id: `option_${crypto.randomUUID()}`, label: "" },
      { id: `option_${crypto.randomUUID()}`, label: "" },
    ],
  } satisfies SurveyQuestion;
}

function newRegionDirectoryItem(
  optionSource:
    "coordination_region_groups" | "coordination_operational_regions",
  options: Array<SurveyOption>,
): SurveyItem {
  return {
    id: `question_${crypto.randomUUID()}`,
    kind: "dropdown",
    optionSource,
    prompt:
      optionSource === "coordination_region_groups"
        ? "Region group"
        : "Operational region",
    required: true,
    options,
  };
}

function newYesNoItem(): SurveyItem {
  return {
    id: `question_${crypto.randomUUID()}`,
    kind: "single_choice",
    prompt: "New Yes / No question",
    required: true,
    options: [
      { id: `option_${crypto.randomUUID()}`, label: "Yes" },
      { id: `option_${crypto.randomUUID()}`, label: "No" },
    ],
  };
}

function newSection(index: number): SurveySection {
  return {
    id: `section_${crypto.randomUUID()}`,
    title: `Section ${String(index + 1)}`,
    description: "",
    items: [],
  };
}

function forwardBranchesOnly(
  sections: Array<SurveySection>,
): Array<SurveySection> {
  const sectionIndexes = new Map(
    sections.map((section, index) => [section.id, index] as const),
  );
  return sections.map((section, sectionIndex) => ({
    ...section,
    items: section.items.map((item) => {
      if (
        item.kind !== "single_choice" &&
        item.kind !== "multiple_choice" &&
        item.kind !== "dropdown"
      )
        return item;
      return {
        ...item,
        options: item.options.map((option) => {
          if (
            !option.nextSectionId ||
            (sectionIndexes.get(option.nextSectionId) ?? -1) > sectionIndex
          )
            return option;
          const withoutBranch = { ...option };
          delete withoutBranch.nextSectionId;
          return withoutBranch;
        }),
      };
    }),
  }));
}

export function SurveySectionsEditor({
  editable,
  onChange,
  operationalRegionOptions,
  regionGroupOptions,
  sections,
  usage,
}: {
  editable: boolean;
  onChange: (sections: Array<SurveySection>) => void;
  operationalRegionOptions: Array<SurveyOption>;
  regionGroupOptions: Array<SurveyOption>;
  sections: Array<SurveySection>;
  usage: "learning" | "onboarding";
}) {
  const [removeTarget, setRemoveTarget] = useState<{
    sectionId: string;
    itemId?: string;
  } | null>(null);
  const hasRegionGroupQuestion = sections.some((section) =>
    section.items.some(
      (item) =>
        item.kind === "dropdown" &&
        item.optionSource === "coordination_region_groups",
    ),
  );
  const hasOperationalRegionQuestion = sections.some((section) =>
    section.items.some(
      (item) =>
        item.kind === "dropdown" &&
        item.optionSource === "coordination_operational_regions",
    ),
  );
  const regionGroupSectionIndex = sections.findIndex((section) =>
    section.items.some(
      (item) =>
        item.kind === "dropdown" &&
        item.optionSource === "coordination_region_groups",
    ),
  );

  function commit(next: Array<SurveySection>): void {
    onChange(forwardBranchesOnly(next));
  }

  function updateSection(section: SurveySection): void {
    commit(
      sections.map((candidate) =>
        candidate.id === section.id ? section : candidate,
      ),
    );
  }

  return (
    <Stack gap="lg">
      <Title order={2}>Survey sections</Title>
      {sections.length === 0 ? (
        <Alert title="No sections">Add a section before publishing.</Alert>
      ) : null}
      {sections.map((section, sectionIndex) => (
        <Paper
          key={section.id}
          withBorder
          radius="lg"
          p={{ base: "md", sm: "lg" }}
          data-survey-section
        >
          <Stack gap="lg">
            <Group justify="space-between" align="start" wrap="wrap">
              <Title order={3}>Section {String(sectionIndex + 1)}</Title>
              {editable ? (
                <Group gap="xs">
                  <Button
                    size="compact-xs"
                    variant="default"
                    disabled={sectionIndex === 0}
                    onClick={() => {
                      commit(move(sections, sectionIndex, -1));
                    }}
                  >
                    Up
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="default"
                    disabled={sectionIndex === sections.length - 1}
                    onClick={() => {
                      commit(move(sections, sectionIndex, 1));
                    }}
                  >
                    Down
                  </Button>
                  <Button
                    size="compact-xs"
                    color="red"
                    variant="subtle"
                    onClick={() => {
                      setRemoveTarget({ sectionId: section.id });
                    }}
                  >
                    Remove section
                  </Button>
                </Group>
              ) : null}
            </Group>
            <MantineTextInput
              label={`Section ${String(sectionIndex + 1)} title`}
              value={section.title}
              disabled={!editable}
              onChange={(event) => {
                const title = event.currentTarget.value;
                updateSection({ ...section, title });
              }}
              required
            />
            <MantineTextInput
              component="textarea"
              label="Section introduction"
              value={section.description}
              disabled={!editable}
              onChange={(event) => {
                const description = event.currentTarget.value;
                updateSection({ ...section, description });
              }}
            />
            {section.items.length === 0 ? (
              <Alert title="Empty section">
                Add a question or instruction block.
              </Alert>
            ) : null}
            {section.items.map((item, itemIndex) => (
              <SurveyQuestionEditor
                key={item.id}
                item={item}
                index={itemIndex}
                total={section.items.length}
                branchSections={sections
                  .slice(sectionIndex + 1)
                  .map(({ id, title }) => ({ id, title }))}
                disabled={!editable}
                onChange={(updated) => {
                  updateSection({
                    ...section,
                    items: section.items.map((candidate) =>
                      candidate.id === updated.id ? updated : candidate,
                    ),
                  });
                }}
                onMove={(direction) => {
                  updateSection({
                    ...section,
                    items: move(section.items, itemIndex, direction),
                  });
                }}
                onRemove={() => {
                  setRemoveTarget({ sectionId: section.id, itemId: item.id });
                }}
              />
            ))}
            {editable ? (
              <Group>
                {usage === "onboarding" ? (
                  <>
                    <Button
                      variant="light"
                      disabled={
                        hasRegionGroupQuestion ||
                        regionGroupOptions.length === 0
                      }
                      onClick={() => {
                        updateSection({
                          ...section,
                          items: [
                            ...section.items,
                            newRegionDirectoryItem(
                              "coordination_region_groups",
                              regionGroupOptions,
                            ),
                          ],
                        });
                      }}
                    >
                      Add region group
                    </Button>
                    <Button
                      variant="light"
                      disabled={
                        hasOperationalRegionQuestion ||
                        operationalRegionOptions.length === 0 ||
                        regionGroupSectionIndex < 0 ||
                        regionGroupSectionIndex > sectionIndex
                      }
                      onClick={() => {
                        updateSection({
                          ...section,
                          items: [
                            ...section.items,
                            newRegionDirectoryItem(
                              "coordination_operational_regions",
                              operationalRegionOptions,
                            ),
                          ],
                        });
                      }}
                    >
                      Add operational region
                    </Button>
                  </>
                ) : null}
                {(
                  [
                    ["single_choice", "Add single choice"],
                    ["multiple_choice", "Add multiple choice"],
                    ["dropdown", "Add dropdown"],
                    ["short_text", "Add short text"],
                    ["long_text", "Add long text"],
                    ["checkbox", "Add checkbox"],
                    ["number", "Add number"],
                    ["date", "Add date"],
                    ["rating", "Add rating"],
                    ["instruction", "Add instruction block"],
                  ] as const
                ).map(([kind, label]) => (
                  <Button
                    key={kind}
                    variant="light"
                    onClick={() => {
                      updateSection({
                        ...section,
                        items: [...section.items, newItem(kind)],
                      });
                    }}
                  >
                    {label}
                  </Button>
                ))}
                <Button
                  variant="light"
                  onClick={() => {
                    updateSection({
                      ...section,
                      items: [...section.items, newYesNoItem()],
                    });
                  }}
                >
                  Add Yes / No
                </Button>
              </Group>
            ) : null}
          </Stack>
        </Paper>
      ))}
      {editable ? (
        <Button
          variant="outline"
          onClick={() => {
            commit([...sections, newSection(sections.length)]);
          }}
        >
          Add section
        </Button>
      ) : null}
      {removeTarget ? (
        <ConfirmationDialog
          title={
            removeTarget.itemId ? "Remove survey item?" : "Remove section?"
          }
          description={
            removeTarget.itemId
              ? "This removes the item from the draft survey."
              : "This removes the section and every item it contains from the draft survey."
          }
          confirmLabel={removeTarget.itemId ? "Remove item" : "Remove section"}
          onCancel={() => {
            setRemoveTarget(null);
          }}
          onConfirm={() => {
            commit(
              removeTarget.itemId
                ? sections.map((section) =>
                    section.id === removeTarget.sectionId
                      ? {
                          ...section,
                          items: section.items.filter(
                            (item) => item.id !== removeTarget.itemId,
                          ),
                        }
                      : section,
                  )
                : sections.filter(
                    (section) => section.id !== removeTarget.sectionId,
                  ),
            );
            setRemoveTarget(null);
          }}
        />
      ) : null}
    </Stack>
  );
}
