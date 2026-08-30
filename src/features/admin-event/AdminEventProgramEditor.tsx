import { useState, type SetStateAction } from "react";
import { Badge } from "#/features/shared/Badge";
import { MantineCheckbox } from "#/features/shared/MantineCheckbox";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
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
import { formatCommunicationTiming } from "#/features/admin-email/communication-options";
import { EligibleStaffPicker } from "./EligibleStaffPicker";
import type {
  AdminEventTemplateDetail,
  AdminEventTemplateDraft,
  AdminEventTemplateItem,
} from "./admin-event.schema";
import classes from "./AdminEventProgramEditor.module.css";

type ActivityKind = "scorm" | "survey" | "resource";
type AddableKind = ActivityKind | "session" | "automated_email";

function move<T>(values: Array<T>, index: number, direction: -1 | 1): Array<T> {
  const destination = index + direction;
  if (destination < 0 || destination >= values.length) return values;
  const next = [...values];
  [next[index], next[destination]] = [next[destination] as T, next[index] as T];
  return next;
}

export function AdminEventProgramEditor({
  detail,
  draft,
  setDraft,
  onEditEmail,
}: {
  detail: AdminEventTemplateDetail;
  draft: AdminEventTemplateDraft;
  setDraft: (update: SetStateAction<AdminEventTemplateDraft>) => void;
  onEditEmail: (sectionId: string, itemId: string) => void;
}) {
  function updateSection(
    sectionId: string,
    update: (
      section: AdminEventTemplateDraft["sections"][number],
    ) => AdminEventTemplateDraft["sections"][number],
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
    update: (item: AdminEventTemplateItem) => AdminEventTemplateItem,
  ) {
    updateSection(sectionId, (section) => ({
      ...section,
      items: section.items.map((item) =>
        item.id === itemId ? update(item) : item,
      ),
    }));
  }

  function addActivity(
    sectionId: string,
    kind: ActivityKind,
    learningActivityVersionId: string,
  ) {
    const library =
      detail.library[
        kind === "scorm"
          ? "modules"
          : kind === "survey"
            ? "surveys"
            : "resources"
      ];
    const activity = library.find(
      (candidate) => candidate.id === learningActivityVersionId,
    );
    if (!activity) return;
    const item: AdminEventTemplateItem =
      kind === "scorm"
        ? {
            id: `event_item_${crypto.randomUUID()}`,
            kind,
            title: activity.title,
            required: true,
            durationMinutes: 30,
            learningActivityVersionId,
          }
        : kind === "survey"
          ? {
              id: `event_item_${crypto.randomUUID()}`,
              kind,
              title: activity.title,
              required: true,
              durationMinutes: 15,
              learningActivityVersionId,
            }
          : {
              id: `event_item_${crypto.randomUUID()}`,
              kind,
              title: activity.title,
              required: true,
              durationMinutes: null,
              learningActivityVersionId,
            };
    updateSection(sectionId, (section) => ({
      ...section,
      items: [...section.items, item],
    }));
  }

  function addSession(sectionId: string) {
    const item: AdminEventTemplateItem = {
      id: `event_item_${crypto.randomUUID()}`,
      kind: "session",
      title: "Event session",
      required: true,
      durationMinutes: 60,
      presenterRequired: true,
      presenterIds: [],
    };
    updateSection(sectionId, (section) => ({
      ...section,
      items: [...section.items, item],
    }));
  }

  function addEmail(sectionId: string, emailDesignVersionId: string) {
    const template = detail.emailTemplates.find(
      (candidate) => candidate.versionId === emailDesignVersionId,
    );
    if (!template) return;
    const item: AdminEventTemplateItem = {
      id: `event_template_communication_${crypto.randomUUID()}`,
      kind: "automated_email",
      title: template.designName,
      emailDesignVersionId: template.versionId,
      audience: "confirmed_participants",
      trigger: "event_start",
      sessionItemId: null,
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

  function addSection() {
    const sectionId = `event_section_${crypto.randomUUID()}`;
    setDraft((current) => ({
      ...current,
      sections: [
        ...current.sections,
        {
          id: sectionId,
          title: "New section",
          description: "",
          phase: "pre_event",
          releaseAnchor: "participation_created",
          releaseOffsetAmount: 0,
          releaseOffsetUnit: "minute",
          items: [],
        },
      ],
    }));
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <div>
          <Title order={2}>Programme</Title>
          <Text c="dimmed" size="sm">
            {draft.sections.length} sections ·{" "}
            {draft.sections.reduce(
              (count, section) => count + section.items.length,
              0,
            )}{" "}
            items
          </Text>
        </div>
        {detail.version.editable ? (
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
              <div className={classes.sectionNumber} aria-hidden="true">
                {sectionIndex + 1}
              </div>
              <div className={classes.sectionIdentity}>
                <Group gap="xs" align="center">
                  <Title order={3} size="h4">
                    {section.title || "Untitled section"}
                  </Title>
                  <Badge variant="light">
                    {section.phase.replace("_", " ")}
                  </Badge>
                </Group>
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
                    disabled={!detail.version.editable}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      updateSection(section.id, (current) => ({
                        ...current,
                        title: value,
                      }));
                    }}
                  />
                  <MantineTextInput
                    label="Description"
                    value={section.description}
                    disabled={!detail.version.editable}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      updateSection(section.id, (current) => ({
                        ...current,
                        description: value,
                      }));
                    }}
                  />
                  <div className={classes.timingGrid}>
                    <MantineNativeSelect
                      label="Stage"
                      value={section.phase}
                      disabled={!detail.version.editable}
                      data={[
                        { value: "pre_event", label: "Pre-event" },
                        { value: "session", label: "Event sessions" },
                        { value: "post_event", label: "Post-event" },
                        { value: "follow_up", label: "Follow-up" },
                      ]}
                      onChange={(event) => {
                        const phase = event.currentTarget
                          .value as typeof section.phase;
                        updateSection(section.id, (current) => ({
                          ...current,
                          phase,
                        }));
                      }}
                    />
                    <MantineNativeSelect
                      label="Release relative to"
                      value={section.releaseAnchor}
                      disabled={!detail.version.editable}
                      data={[
                        {
                          value: "participation_created",
                          label: "Participation confirmed",
                        },
                        { value: "occurrence_start", label: "Event start" },
                        { value: "occurrence_end", label: "Event end" },
                        {
                          value: "final_session_end",
                          label: "Final session end",
                        },
                      ]}
                      onChange={(event) => {
                        const releaseAnchor = event.currentTarget
                          .value as typeof section.releaseAnchor;
                        updateSection(section.id, (current) => ({
                          ...current,
                          releaseAnchor,
                        }));
                      }}
                    />
                    <MantineTextInput
                      type="number"
                      label="Offset"
                      value={String(section.releaseOffsetAmount)}
                      disabled={!detail.version.editable}
                      onChange={(event) => {
                        const releaseOffsetAmount = Number(
                          event.currentTarget.value,
                        );
                        updateSection(section.id, (current) => ({
                          ...current,
                          releaseOffsetAmount,
                        }));
                      }}
                    />
                    <MantineNativeSelect
                      label="Unit"
                      value={section.releaseOffsetUnit}
                      disabled={!detail.version.editable}
                      data={[
                        { value: "minute", label: "Minutes" },
                        { value: "hour", label: "Hours" },
                        { value: "day", label: "Calendar days" },
                        { value: "week", label: "Calendar weeks" },
                        { value: "month", label: "Calendar months" },
                      ]}
                      onChange={(event) => {
                        const releaseOffsetUnit = event.currentTarget
                          .value as typeof section.releaseOffsetUnit;
                        updateSection(section.id, (current) => ({
                          ...current,
                          releaseOffsetUnit,
                        }));
                      }}
                    />
                  </div>
                  {detail.version.editable ? (
                    <Group gap="xs" justify="flex-end">
                      <Button
                        size="compact-xs"
                        variant="default"
                        disabled={sectionIndex === 0}
                        onClick={() => {
                          setDraft((current) => ({
                            ...current,
                            sections: move(current.sections, sectionIndex, -1),
                          }));
                        }}
                      >
                        Move up
                      </Button>
                      <Button
                        size="compact-xs"
                        variant="default"
                        disabled={sectionIndex === draft.sections.length - 1}
                        onClick={() => {
                          setDraft((current) => ({
                            ...current,
                            sections: move(current.sections, sectionIndex, 1),
                          }));
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
                  <details className={classes.item} key={item.id}>
                    <summary className={classes.itemSummary}>
                      <div className={classes.itemIdentity}>
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
                          href={`/api/admin/scorm-packages/${encodeURIComponent(item.learningActivityVersionId)}/preview`}
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
                          {detail.version.editable ? "Edit" : "Preview"}
                        </Button>
                      ) : null}
                      {detail.version.editable ? (
                        <Group gap="xs" justify="flex-end">
                          <Button
                            size="compact-xs"
                            variant="default"
                            disabled={itemIndex === 0}
                            onClick={() => {
                              updateSection(section.id, (current) => ({
                                ...current,
                                items: move(current.items, itemIndex, -1),
                              }));
                            }}
                          >
                            Move up
                          </Button>
                          <Button
                            size="compact-xs"
                            variant="default"
                            disabled={itemIndex === section.items.length - 1}
                            onClick={() => {
                              updateSection(section.id, (current) => ({
                                ...current,
                                items: move(current.items, itemIndex, 1),
                              }));
                            }}
                          >
                            Move down
                          </Button>
                          <Button
                            size="compact-xs"
                            color="red"
                            variant="subtle"
                            onClick={() => {
                              updateSection(section.id, (current) => ({
                                ...current,
                                items: current.items.filter(
                                  (candidate) => candidate.id !== item.id,
                                ),
                              }));
                            }}
                          >
                            Remove
                          </Button>
                        </Group>
                      ) : null}

                      {item.kind !== "automated_email" ? (
                        <>
                          <MantineTextInput
                            label="Display title"
                            value={item.title}
                            disabled={!detail.version.editable}
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              updateItem(section.id, item.id, (current) => ({
                                ...current,
                                title: value,
                              }));
                            }}
                          />
                          <MantineCheckbox
                            label="Required for section completion"
                            checked={item.required}
                            disabled={!detail.version.editable}
                            onChange={(required) => {
                              updateItem(section.id, item.id, (current) => ({
                                ...current,
                                required,
                              }));
                            }}
                          />
                          {item.kind === "session" ? (
                            <>
                              <MantineTextInput
                                type="number"
                                min={15}
                                label="Duration (minutes)"
                                value={String(item.durationMinutes)}
                                disabled={!detail.version.editable}
                                onChange={(event) => {
                                  const durationMinutes = Number(
                                    event.currentTarget.value,
                                  );
                                  updateItem(section.id, item.id, (current) =>
                                    current.kind === "session"
                                      ? { ...current, durationMinutes }
                                      : current,
                                  );
                                }}
                              />
                              <MantineCheckbox
                                label="Presenter required"
                                checked={item.presenterRequired}
                                disabled={!detail.version.editable}
                                onChange={(presenterRequired) => {
                                  updateItem(section.id, item.id, (current) =>
                                    current.kind === "session"
                                      ? { ...current, presenterRequired }
                                      : current,
                                  );
                                }}
                              />
                              <EligibleStaffPicker
                                label="Presenter"
                                candidates={detail.people.presenters}
                                people={detail.people.users}
                                selectedIds={item.presenterIds}
                                disabled={!detail.version.editable}
                                onChange={(presenterIds) => {
                                  updateItem(section.id, item.id, (current) =>
                                    current.kind === "session"
                                      ? { ...current, presenterIds }
                                      : current,
                                  );
                                }}
                              />
                            </>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </details>
                ))}
              </div>

              {detail.version.editable ? (
                <>
                  <ActivityAdder
                    detail={detail}
                    onAdd={(kind, reference) => {
                      if (kind === "session") addSession(section.id);
                      else if (kind === "automated_email")
                        addEmail(section.id, reference);
                      else addActivity(section.id, kind, reference);
                    }}
                  />
                  <div className={classes.removeSection}>
                    <Button
                      size="compact-sm"
                      color="red"
                      variant="subtle"
                      onClick={() => {
                        setDraft((current) => ({
                          ...current,
                          sections: current.sections.filter(
                            (candidate) => candidate.id !== section.id,
                          ),
                        }));
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

function ActivityAdder({
  detail,
  onAdd,
}: {
  detail: AdminEventTemplateDetail;
  onAdd: (kind: AddableKind, reference: string) => void;
}) {
  const [kind, setKind] = useState<AddableKind>("scorm");
  const [reference, setReference] = useState("");
  const needsReference = kind !== "session";
  const options =
    kind === "automated_email"
      ? detail.emailTemplates
          .filter((template) => template.selectable !== false)
          .map((template) => ({
            value: template.versionId,
            label: template.designName,
          }))
      : kind === "session"
        ? []
        : kind === "survey"
          ? detail.library.surveys.map((survey) => ({
              value: survey.id,
              label: `${survey.title} · v${String(survey.version)}`,
              type: survey.type,
            }))
          : detail.library[kind === "scorm" ? "modules" : "resources"].map(
              (activity) => ({
                value: activity.id,
                label: `${activity.title} · v${String(activity.version)}`,
              }),
            );
  const selectData =
    kind === "survey"
      ? [
          {
            value: "",
            label: options.length ? "Select an item" : "None available",
          },
          {
            group: "Event surveys",
            items: options.filter(
              (option) => "type" in option && option.type === "event",
            ),
          },
          {
            group: "Shared surveys",
            items: options.filter(
              (option) => "type" in option && option.type === "shared",
            ),
          },
        ]
      : [
          {
            value: "",
            label: options.length ? "Select an item" : "None available",
          },
          ...options,
        ];

  return (
    <div className={classes.adder}>
      <Text fw={700} size="sm">
        Add item
      </Text>
      <div className={classes.adderGrid}>
        <MantineNativeSelect
          label="Type"
          value={kind}
          data={[
            { value: "scorm", label: "SCORM module" },
            { value: "survey", label: "Survey" },
            { value: "resource", label: "PDF resource" },
            { value: "session", label: "Event session" },
            { value: "automated_email", label: "Automated email" },
          ]}
          onChange={(event) => {
            setKind(event.currentTarget.value as AddableKind);
            setReference("");
          }}
        />
        {needsReference ? (
          <MantineNativeSelect
            label={kind === "automated_email" ? "Email template" : "Item"}
            value={reference}
            data={selectData}
            onChange={(event) => {
              setReference(event.currentTarget.value);
            }}
          />
        ) : (
          <div />
        )}
        <Button
          variant="light"
          disabled={needsReference && !reference}
          onClick={() => {
            onAdd(kind, reference);
            setReference("");
          }}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
