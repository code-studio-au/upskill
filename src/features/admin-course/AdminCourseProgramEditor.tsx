import type { SetStateAction } from "react";
import { formatCommunicationTiming } from "#/features/admin-email/communication-options";
import { Badge } from "#/features/shared/Badge";
import { MantineCheckbox } from "#/features/shared/MantineCheckbox";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import {
  Alert,
  Button,
  Group,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { sectionHasPublicationContent } from "#/features/shared/section-publication";
import type {
  AdminCourseDetail,
  AdminCourseDraft,
  AdminCourseItem,
} from "./admin-course.schema";
import classes from "./AdminCourseProgramEditor.module.css";

function move<T>(values: Array<T>, index: number, direction: -1 | 1): Array<T> {
  const target = index + direction;
  if (target < 0 || target >= values.length) return values;
  const next = [...values];
  [next[index], next[target]] = [next[target] as T, next[index] as T];
  return next;
}

export function AdminCourseProgramEditor({
  detail,
  draft,
  editable,
  setDraft,
  onAddItem,
  onUploadPdf,
  onEditEmail,
  onRemoveSection,
  onRemoveItem,
}: {
  detail: AdminCourseDetail;
  draft: AdminCourseDraft;
  editable: boolean;
  setDraft: (update: SetStateAction<AdminCourseDraft>) => void;
  onAddItem: (sectionId: string) => void;
  onUploadPdf: (sectionId: string) => void;
  onEditEmail: (sectionId: string, itemId: string) => void;
  onRemoveSection: (sectionId: string) => void;
  onRemoveItem: (sectionId: string, itemId: string) => void;
}) {
  const emailTemplate = detail.emailTemplates.find(
    (template) => template.selectable !== false,
  );

  function updateSection(
    sectionId: string,
    update: (
      section: AdminCourseDraft["sections"][number],
    ) => AdminCourseDraft["sections"][number],
  ) {
    setDraft((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId ? update(section) : section,
      ),
    }));
  }

  function updateItem(
    sectionId: string,
    itemId: string,
    update: (item: AdminCourseItem) => AdminCourseItem,
  ) {
    updateSection(sectionId, (section) => ({
      ...section,
      items: section.items.map((item) =>
        item.id === itemId ? update(item) : item,
      ),
    }));
  }

  function addSection() {
    setDraft((current) => ({
      ...current,
      sections: [
        ...current.sections,
        {
          id: `section_${crypto.randomUUID()}`,
          title: `Section ${String(current.sections.length + 1)}`,
          description: "",
          items: [],
        },
      ],
    }));
  }

  function moveSection(index: number, direction: -1 | 1) {
    setDraft((current) => ({
      ...current,
      sections: move(current.sections, index, direction),
    }));
  }

  function moveItem(sectionId: string, index: number, direction: -1 | 1) {
    updateSection(sectionId, (section) => ({
      ...section,
      items: move(section.items, index, direction),
    }));
  }

  function addEmail(sectionId: string) {
    if (!emailTemplate) return;
    const item: AdminCourseItem = {
      id: `course_communication_${crypto.randomUUID()}`,
      kind: "automated_email",
      title: emailTemplate.designName,
      emailDesignVersionId: emailTemplate.versionId,
      audience: "affected_learner",
      trigger: "course_incomplete",
      offsetAmount: 0,
      offsetUnit: "day",
      subjectOverride: null,
      textBodyOverride: null,
    };
    updateSection(sectionId, (section) => ({
      ...section,
      items: [...section.items, item],
    }));
    onEditEmail(sectionId, item.id);
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <div>
          <Title order={2}>Programme</Title>
          <Text c="dimmed" size="sm">
            {draft.sections.length} sections ·{" "}
            {draft.sections.reduce(
              (total, section) => total + section.items.length,
              0,
            )}{" "}
            items
          </Text>
        </div>
        {editable ? (
          <Button variant="light" onClick={addSection}>
            Add section
          </Button>
        ) : null}
      </Group>

      {draft.sections.length === 0 ? (
        <Alert title="No sections yet">Add the first programme section.</Alert>
      ) : null}

      <div className={classes.sectionList}>
        {draft.sections.map((section, sectionIndex) => (
          <details key={section.id} className={classes.sectionCard}>
            <summary className={classes.sectionSummary}>
              <span className={classes.sectionNumber} aria-hidden="true">
                {sectionIndex + 1}
              </span>
              <div className={classes.identity}>
                <Title order={3} size="h4">
                  {section.title || "Untitled section"}
                </Title>
                <Text c="dimmed" size="sm">
                  {section.items.length} items
                </Text>
              </div>
            </summary>

            <div className={classes.sectionBody}>
              <details className={classes.settingsDisclosure}>
                <summary className={classes.settingsSummary}>
                  Section details
                </summary>
                <div className={classes.sectionSettings}>
                  <MantineTextInput
                    label="Section title"
                    value={section.title}
                    disabled={!editable}
                    onChange={(event) => {
                      const title = event.currentTarget.value;
                      updateSection(section.id, (current) => ({
                        ...current,
                        title,
                      }));
                    }}
                  />
                  <MantineTextInput
                    component="textarea"
                    label="Description"
                    value={section.description}
                    disabled={!editable}
                    onChange={(event) => {
                      const description = event.currentTarget.value;
                      updateSection(section.id, (current) => ({
                        ...current,
                        description,
                      }));
                    }}
                  />
                  {editable ? (
                    <Group gap="xs" justify="flex-end">
                      <Button
                        size="compact-xs"
                        variant="default"
                        disabled={sectionIndex === 0}
                        onClick={() => {
                          moveSection(sectionIndex, -1);
                        }}
                      >
                        Move up
                      </Button>
                      <Button
                        size="compact-xs"
                        variant="default"
                        disabled={sectionIndex === draft.sections.length - 1}
                        onClick={() => {
                          moveSection(sectionIndex, 1);
                        }}
                      >
                        Move down
                      </Button>
                    </Group>
                  ) : null}
                </div>
              </details>

              <div className={classes.itemList}>
                {!sectionHasPublicationContent(
                  section,
                  (item) => item.kind !== "automated_email",
                ) ? (
                  <Alert color="orange" title="Empty learning section">
                    Add a learning item or remove this section before
                    publishing. Automated emails do not create learner-facing
                    section content.
                  </Alert>
                ) : null}
                {section.items.map((item, itemIndex) => (
                  <details key={item.id} className={classes.item}>
                    <summary className={classes.itemSummary}>
                      <div className={classes.identity}>
                        <Group gap="xs" align="center">
                          <Text fw={700}>{item.title}</Text>
                          <Badge
                            variant={
                              item.kind === "automated_email"
                                ? "outline"
                                : "light"
                            }
                          >
                            {item.kind === "scorm"
                              ? "SCORM"
                              : item.kind.replaceAll("_", " ")}
                          </Badge>
                        </Group>
                        {item.kind === "automated_email" ? (
                          <Text c="dimmed" size="xs">
                            {formatCommunicationTiming(
                              item.trigger,
                              item.offsetAmount,
                              item.offsetUnit,
                            )}
                          </Text>
                        ) : null}
                      </div>
                    </summary>

                    <div className={classes.itemEditor}>
                      {item.kind === "scorm" ? (
                        <Button
                          component="a"
                          href={`/api/admin/scorm-packages/${encodeURIComponent(item.scormPackageVersionId)}/preview`}
                          target="_blank"
                          rel="noreferrer"
                          size="compact-xs"
                          variant="light"
                        >
                          Preview SCORM
                        </Button>
                      ) : null}
                      {item.kind === "automated_email" ? (
                        <Button
                          size="compact-xs"
                          variant="light"
                          onClick={() => {
                            onEditEmail(section.id, item.id);
                          }}
                        >
                          {editable ? "Edit email" : "Preview email"}
                        </Button>
                      ) : (
                        <>
                          <MantineTextInput
                            label="Display title"
                            value={item.title}
                            disabled={!editable}
                            onChange={(event) => {
                              const title = event.currentTarget.value;
                              updateItem(section.id, item.id, (current) => ({
                                ...current,
                                title,
                              }));
                            }}
                          />
                          <MantineCheckbox
                            label="Required for section completion"
                            checked={item.required}
                            disabled={!editable}
                            onChange={(required) => {
                              updateItem(section.id, item.id, (current) => ({
                                ...current,
                                required,
                              }));
                            }}
                          />
                          {item.kind !== "resource" ? (
                            <MantineTextInput
                              label="Estimated duration (minutes)"
                              type="number"
                              min={1}
                              value={String(item.durationMinutes ?? 1)}
                              disabled={!editable}
                              onChange={(event) => {
                                const durationMinutes = Math.max(
                                  1,
                                  Number(event.currentTarget.value),
                                );
                                updateItem(section.id, item.id, (current) =>
                                  current.kind === "scorm" ||
                                  current.kind === "survey"
                                    ? { ...current, durationMinutes }
                                    : current,
                                );
                              }}
                            />
                          ) : null}
                        </>
                      )}

                      {editable ? (
                        <Group gap="xs" justify="flex-end">
                          <Button
                            size="compact-xs"
                            variant="default"
                            disabled={itemIndex === 0}
                            onClick={() => {
                              moveItem(section.id, itemIndex, -1);
                            }}
                          >
                            Move up
                          </Button>
                          <Button
                            size="compact-xs"
                            variant="default"
                            disabled={itemIndex === section.items.length - 1}
                            onClick={() => {
                              moveItem(section.id, itemIndex, 1);
                            }}
                          >
                            Move down
                          </Button>
                          <Button
                            size="compact-xs"
                            color="red"
                            variant="subtle"
                            onClick={() => {
                              onRemoveItem(section.id, item.id);
                            }}
                          >
                            Remove
                          </Button>
                        </Group>
                      ) : null}
                    </div>
                  </details>
                ))}
              </div>

              {editable ? (
                <>
                  <div className={classes.adder}>
                    <Text fw={700} size="sm">
                      Add item
                    </Text>
                    <Group gap="xs">
                      <Button
                        size="compact-sm"
                        variant="light"
                        onClick={() => {
                          onAddItem(section.id);
                        }}
                      >
                        Choose content
                      </Button>
                      <Button
                        size="compact-sm"
                        variant="default"
                        onClick={() => {
                          onUploadPdf(section.id);
                        }}
                      >
                        Upload PDF
                      </Button>
                      <Button
                        size="compact-sm"
                        variant="default"
                        disabled={!emailTemplate}
                        onClick={() => {
                          addEmail(section.id);
                        }}
                      >
                        Automated email
                      </Button>
                    </Group>
                  </div>
                  <div className={classes.removeSection}>
                    <Button
                      size="compact-sm"
                      color="red"
                      variant="subtle"
                      onClick={() => {
                        onRemoveSection(section.id);
                      }}
                    >
                      Remove section
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          </details>
        ))}
      </div>
    </Stack>
  );
}
