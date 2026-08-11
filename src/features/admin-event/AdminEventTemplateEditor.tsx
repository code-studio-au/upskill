import { Badge } from "#/features/shared/Badge";
import { MantineCheckbox } from "#/features/shared/MantineCheckbox";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import {
  Alert,
  Button,
  Divider,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useForm, useStore } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import { useRef, useState, type SetStateAction } from "react";
import {
  createAdminEventVersion,
  publishAdminEventTemplate,
  saveAdminEventTemplate,
} from "#/server/functions/admin-event";
import {
  adminEventTemplateDraftSchema,
  type AdminEventTemplateDetail,
  type AdminEventTemplateDraft,
  type AdminEventTemplateItem,
} from "./admin-event.schema";
import classes from "./AdminEventTemplateEditor.module.css";
import { createFriendlySlug } from "#/features/shared/friendly-slug";

function move<T>(values: Array<T>, index: number, direction: -1 | 1): Array<T> {
  const destination = index + direction;
  if (destination < 0 || destination >= values.length) return values;
  const next = [...values];
  [next[index], next[destination]] = [next[destination] as T, next[index] as T];
  return next;
}

function toggle(values: Array<string>, id: string, checked: boolean) {
  return checked
    ? [...new Set([...values, id])]
    : values.filter((value) => value !== id);
}

export function AdminEventTemplateEditor({
  detail,
  onChanged,
}: {
  detail: AdminEventTemplateDetail;
  onChanged: () => Promise<void>;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intent = useRef<"save" | "publish">("save");
  const autoSlug = useRef(
    detail.draft.slug.startsWith("draft-event-template-"),
  );
  const form = useForm({
    defaultValues: { draft: detail.draft },
    onSubmit: async ({ value }) => {
      const parsed = adminEventTemplateDraftSchema.safeParse(value.draft);
      if (!parsed.success) {
        setError(
          parsed.error.issues[0]?.message ?? "Review the template fields.",
        );
        return;
      }
      setPending(intent.current);
      setError(null);
      setMessage(null);
      try {
        const saved = await saveAdminEventTemplate({ data: parsed.data });
        if (saved.status !== "ready") {
          setError(
            saved.status === "conflict" && saved.reason === "slug_in_use"
              ? "That friendly URL is already used by another event template. Choose a unique value."
              : "The template could not be saved. Check all selected people and activities.",
          );
          return;
        }
        if (intent.current === "save") {
          setMessage("Draft saved.");
          return;
        }
        const published = await publishAdminEventTemplate({
          data: {
            eventTemplateId: detail.template.id,
            eventTemplateVersionId: detail.version.id,
          },
        });
        if (published.status !== "ready") {
          setError(
            "Add at least one section and session, and cover every required administrator, presenter and region coordinator before publishing.",
          );
          return;
        }
        await onChanged();
      } finally {
        setPending(null);
      }
    },
  });
  const draft = useStore(form.store, (state) => state.values.draft);

  function setDraft(update: SetStateAction<AdminEventTemplateDraft>) {
    const current = form.state.values.draft;
    form.setFieldValue(
      "draft",
      typeof update === "function" ? update(current) : update,
    );
  }

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
    kind: "scorm" | "survey" | "resource",
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

  async function createVersion() {
    setPending("version");
    setError(null);
    try {
      const result = await createAdminEventVersion({
        data: { eventTemplateId: detail.template.id },
      });
      if (result.status !== "ready") {
        setError("A successor version could not be created.");
        return;
      }
      await onChanged();
    } finally {
      setPending(null);
    }
  }

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="end" wrap="wrap">
        <div>
          <Button component={Link} to="/admin/events" variant="subtle" px={0}>
            Back to events
          </Button>
          <Group gap="sm">
            <Title order={1}>{detail.template.title}</Title>
            <Badge variant="light">Version {detail.version.version}</Badge>
          </Group>
          <Text c="dimmed">
            {detail.version.editable
              ? "Complete the title, then design the reusable sections, activities and staffing defaults for this version."
              : "This published version is immutable and remains pinned to its occurrences."}
          </Text>
        </div>
        {detail.version.editable ? (
          <Group>
            <Button
              variant="default"
              loading={pending === "save"}
              onClick={() => {
                intent.current = "save";
                void form.handleSubmit();
              }}
            >
              Save draft
            </Button>
            <Button
              loading={pending === "publish"}
              onClick={() => {
                intent.current = "publish";
                void form.handleSubmit();
              }}
            >
              Save and publish
            </Button>
          </Group>
        ) : (
          <Button
            loading={pending === "version"}
            onClick={() => void createVersion()}
          >
            Create new version
          </Button>
        )}
      </Group>

      {error ? <Alert color="red">{error}</Alert> : null}
      {message ? <Alert color="green">{message}</Alert> : null}

      <div className={classes.grid}>
        <Stack gap="lg">
          <Paper withBorder radius="lg" p="lg">
            <Stack gap="md">
              <Title order={2}>Template details</Title>
              <MantineTextInput
                label="Title"
                value={draft.title}
                disabled={!detail.version.editable}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setDraft((current) => ({
                    ...current,
                    title: value,
                    slug: autoSlug.current
                      ? createFriendlySlug(value)
                      : current.slug,
                  }));
                }}
              />
              <MantineTextInput
                label="Friendly URL"
                description="Reserved for public event promotion URLs. It must be unique."
                value={draft.slug}
                disabled={!detail.version.editable}
                onChange={(event) => {
                  autoSlug.current = false;
                  const value = event.currentTarget.value;
                  setDraft((current) => ({ ...current, slug: value }));
                }}
              />
              <MantineTextInput
                label="Summary"
                value={draft.summary}
                disabled={!detail.version.editable}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setDraft((current) => ({ ...current, summary: value }));
                }}
              />
              <MantineTextInput
                component="textarea"
                label="Description"
                value={draft.description}
                disabled={!detail.version.editable}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setDraft((current) => ({ ...current, description: value }));
                }}
              />
              <MantineCheckbox
                label="Offer a completion certificate"
                checked={draft.hasCompletionCertificate}
                disabled={!detail.version.editable}
                onChange={(checked) => {
                  setDraft((current) => ({
                    ...current,
                    hasCompletionCertificate: checked,
                  }));
                }}
              />
            </Stack>
          </Paper>

          <Group justify="space-between">
            <div>
              <Title order={2}>Sections and activities</Title>
              <Text size="sm" c="dimmed">
                Sessions and learning activities run in this exact order.
              </Text>
            </div>
            {detail.version.editable ? (
              <Button
                variant="light"
                onClick={() => {
                  setDraft((current) => ({
                    ...current,
                    sections: [
                      ...current.sections,
                      {
                        id: `event_section_${crypto.randomUUID()}`,
                        title: "New section",
                        description: "",
                        items: [],
                      },
                    ],
                  }));
                }}
              >
                Add section
              </Button>
            ) : null}
          </Group>

          {draft.sections.length === 0 ? (
            <Alert title="No sections yet">
              Add titled sections such as Pre-event tasks, Event sessions and
              Post-event tasks.
            </Alert>
          ) : null}
          {draft.sections.map((section, sectionIndex) => (
            <Paper key={section.id} withBorder radius="lg" p="lg">
              <Stack gap="md">
                <Group justify="space-between" align="start">
                  <Stack gap="xs" className={classes.grow}>
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
                      label="Section description"
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
                  </Stack>
                  {detail.version.editable ? (
                    <Stack gap="xs">
                      <Group gap="xs">
                        <Button
                          size="xs"
                          variant="default"
                          disabled={sectionIndex === 0}
                          onClick={() => {
                            setDraft((current) => ({
                              ...current,
                              sections: move(
                                current.sections,
                                sectionIndex,
                                -1,
                              ),
                            }));
                          }}
                        >
                          Up
                        </Button>
                        <Button
                          size="xs"
                          variant="default"
                          disabled={sectionIndex === draft.sections.length - 1}
                          onClick={() => {
                            setDraft((current) => ({
                              ...current,
                              sections: move(current.sections, sectionIndex, 1),
                            }));
                          }}
                        >
                          Down
                        </Button>
                      </Group>
                      <Button
                        size="xs"
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
                    </Stack>
                  ) : null}
                </Group>

                {section.items.map((item, itemIndex) => (
                  <Paper
                    key={item.id}
                    withBorder
                    p="md"
                    className={classes.item}
                  >
                    <Stack gap="sm">
                      <Group justify="space-between" align="start">
                        <div>
                          <Text fw={700}>{item.title}</Text>
                          <Text size="xs" c="dimmed">
                            {item.kind === "session"
                              ? "Event session"
                              : item.kind}
                          </Text>
                        </div>
                        {detail.version.editable ? (
                          <Group gap="xs">
                            <Button
                              size="xs"
                              variant="default"
                              disabled={itemIndex === 0}
                              onClick={() => {
                                updateSection(section.id, (current) => ({
                                  ...current,
                                  items: move(current.items, itemIndex, -1),
                                }));
                              }}
                            >
                              Up
                            </Button>
                            <Button
                              size="xs"
                              variant="default"
                              disabled={itemIndex === section.items.length - 1}
                              onClick={() => {
                                updateSection(section.id, (current) => ({
                                  ...current,
                                  items: move(current.items, itemIndex, 1),
                                }));
                              }}
                            >
                              Down
                            </Button>
                            <Button
                              size="xs"
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
                      </Group>
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
                        onChange={(checked) => {
                          updateItem(section.id, item.id, (current) => ({
                            ...current,
                            required: checked,
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
                          <Text fw={600} size="sm">
                            Default presenters
                          </Text>
                          {detail.people.users.map((person) => (
                            <MantineCheckbox
                              key={person.id}
                              label={`${person.name} · ${person.email}`}
                              checked={item.presenterIds.includes(person.id)}
                              disabled={!detail.version.editable}
                              onChange={(checked) => {
                                updateItem(section.id, item.id, (current) =>
                                  current.kind === "session"
                                    ? {
                                        ...current,
                                        presenterIds: toggle(
                                          current.presenterIds,
                                          person.id,
                                          checked,
                                        ),
                                      }
                                    : current,
                                );
                              }}
                            />
                          ))}
                        </>
                      ) : null}
                    </Stack>
                  </Paper>
                ))}

                {detail.version.editable ? (
                  <ActivityAdder
                    detail={detail}
                    onAddSession={() => {
                      updateSection(section.id, (current) => ({
                        ...current,
                        items: [
                          ...current.items,
                          {
                            id: `event_item_${crypto.randomUUID()}`,
                            kind: "session",
                            title: "Event session",
                            required: true,
                            durationMinutes: 60,
                            presenterRequired: true,
                            presenterIds: [],
                          },
                        ],
                      }));
                    }}
                    onAdd={(kind, id) => {
                      addActivity(section.id, kind, id);
                    }}
                  />
                ) : null}
              </Stack>
            </Paper>
          ))}
        </Stack>

        <Stack gap="lg">
          <Paper withBorder radius="lg" p="lg">
            <Stack gap="sm">
              <Title order={2}>Default administrators</Title>
              <Text size="sm" c="dimmed">
                These active platform administrators are copied to each
                occurrence.
              </Text>
              {detail.people.platformAdministrators.map((person) => (
                <MantineCheckbox
                  key={person.id}
                  label={`${person.name} · ${person.email}`}
                  checked={draft.defaultAdministratorIds.includes(person.id)}
                  disabled={!detail.version.editable}
                  onChange={(checked) => {
                    setDraft((current) => ({
                      ...current,
                      defaultAdministratorIds: toggle(
                        current.defaultAdministratorIds,
                        person.id,
                        checked,
                      ),
                    }));
                  }}
                />
              ))}
            </Stack>
          </Paper>

          <Paper withBorder radius="lg" p="lg">
            <Stack gap="md">
              <Title order={2}>Regions and coordinators</Title>
              <Text size="sm" c="dimmed">
                Add only regions that require their own registration review.
              </Text>
              {draft.regions.map((region) => {
                const option = detail.regions.find(
                  (candidate) => candidate.id === region.regionId,
                );
                return (
                  <Stack key={region.regionId} gap="xs">
                    <Group justify="space-between">
                      <Text fw={700}>{option?.name ?? region.regionId}</Text>
                      {detail.version.editable ? (
                        <Button
                          size="xs"
                          color="red"
                          variant="subtle"
                          onClick={() => {
                            setDraft((current) => ({
                              ...current,
                              regions: current.regions.filter(
                                (candidate) =>
                                  candidate.regionId !== region.regionId,
                              ),
                            }));
                          }}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </Group>
                    {detail.people.users.map((person) => (
                      <MantineCheckbox
                        key={person.id}
                        label={`${person.name} · ${person.email}`}
                        checked={region.coordinatorIds.includes(person.id)}
                        disabled={!detail.version.editable}
                        onChange={(checked) => {
                          setDraft((current) => ({
                            ...current,
                            regions: current.regions.map((candidate) =>
                              candidate.regionId === region.regionId
                                ? {
                                    ...candidate,
                                    coordinatorIds: toggle(
                                      candidate.coordinatorIds,
                                      person.id,
                                      checked,
                                    ),
                                  }
                                : candidate,
                            ),
                          }));
                        }}
                      />
                    ))}
                    <Divider />
                  </Stack>
                );
              })}
              {detail.version.editable ? (
                <MantineNativeSelect
                  label="Add region"
                  value=""
                  data={[
                    { value: "", label: "Select a region" },
                    ...detail.regions
                      .filter(
                        (region) =>
                          !draft.regions.some(
                            (candidate) => candidate.regionId === region.id,
                          ),
                      )
                      .map((region) => ({
                        value: region.id,
                        label: `${region.name} · ${region.code}`,
                      })),
                  ]}
                  onChange={(event) => {
                    const regionId = event.currentTarget.value;
                    if (!regionId) return;
                    setDraft((current) => ({
                      ...current,
                      regions: [
                        ...current.regions,
                        { regionId, coordinatorIds: [] },
                      ],
                    }));
                  }}
                />
              ) : null}
            </Stack>
          </Paper>
        </Stack>
      </div>
    </Stack>
  );
}

function ActivityAdder({
  detail,
  onAdd,
  onAddSession,
}: {
  detail: AdminEventTemplateDetail;
  onAdd: (kind: "scorm" | "survey" | "resource", id: string) => void;
  onAddSession: () => void;
}) {
  const [kind, setKind] = useState<"scorm" | "survey" | "resource">("scorm");
  const library =
    detail.library[
      kind === "scorm" ? "modules" : kind === "survey" ? "surveys" : "resources"
    ];
  const [reference, setReference] = useState("");
  return (
    <Stack gap="xs">
      <Divider />
      <Group align="end" grow>
        <MantineNativeSelect
          label="Activity type"
          value={kind}
          data={[
            { value: "scorm", label: "SCORM module" },
            { value: "survey", label: "Survey" },
            { value: "resource", label: "PDF resource" },
          ]}
          onChange={(event) => {
            setKind(event.currentTarget.value as typeof kind);
            setReference("");
          }}
        />
        <MantineNativeSelect
          label="Published activity"
          value={reference}
          data={[
            {
              value: "",
              label: library.length ? "Select activity" : "None available",
            },
            ...library.map((activity) => ({
              value: activity.id,
              label: `${activity.title} · v${String(activity.version)}`,
            })),
          ]}
          onChange={(event) => {
            setReference(event.currentTarget.value);
          }}
        />
        <Button
          variant="light"
          disabled={!reference}
          onClick={() => {
            if (!reference) return;
            onAdd(kind, reference);
            setReference("");
          }}
        >
          Add activity
        </Button>
      </Group>
      <Button variant="default" onClick={onAddSession}>
        Add event session
      </Button>
    </Stack>
  );
}
