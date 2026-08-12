import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { useState } from "react";
import { SurveyQuestionEditor } from "./SurveyQuestionEditor";
import type {
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
  if (kind === "text") return { ...base, kind, maximumLength: 2_000 };
  return {
    ...base,
    kind,
    options: [
      { id: `option_${crypto.randomUUID()}`, label: "Option 1" },
      { id: `option_${crypto.randomUUID()}`, label: "Option 2" },
    ],
  } satisfies SurveyQuestion;
}

function newSection(index: number): SurveySection {
  return {
    id: `section_${crypto.randomUUID()}`,
    title: `Section ${String(index + 1)}`,
    description: "",
    items: [],
  };
}

export function SurveySectionsEditor({
  editable,
  onChange,
  sections,
}: {
  editable: boolean;
  onChange: (sections: Array<SurveySection>) => void;
  sections: Array<SurveySection>;
}) {
  const [removeTarget, setRemoveTarget] = useState<{
    sectionId: string;
    itemId?: string;
  } | null>(null);

  function updateSection(section: SurveySection): void {
    onChange(
      sections.map((candidate) =>
        candidate.id === section.id ? section : candidate,
      ),
    );
  }

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Survey sections</Title>
        <Text c="dimmed">
          Learners complete each item in order. Instruction blocks are marked
          viewed when the learner selects Next.
        </Text>
      </div>
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
                      onChange(move(sections, sectionIndex, -1));
                    }}
                  >
                    Up
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="default"
                    disabled={sectionIndex === sections.length - 1}
                    onClick={() => {
                      onChange(move(sections, sectionIndex, 1));
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
                {(
                  [
                    ["single_choice", "Add single choice"],
                    ["multiple_choice", "Add multiple choice"],
                    ["text", "Add written response"],
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
              </Group>
            ) : null}
          </Stack>
        </Paper>
      ))}
      {editable ? (
        <Button
          variant="outline"
          onClick={() => {
            onChange([...sections, newSection(sections.length)]);
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
            onChange(
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
