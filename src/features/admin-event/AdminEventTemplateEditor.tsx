import { Badge } from "#/features/shared/Badge";
import { MantineCheckbox } from "#/features/shared/MantineCheckbox";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { useForm, useStore } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useRef, useState, type SetStateAction } from "react";
import {
  createAdminEventVersion,
  deleteAdminEventVersion,
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
import { PageTabs } from "#/features/shared/PageTabs";
import { EligibleStaffPicker } from "./EligibleStaffPicker";
import { ConfirmationDialog } from "#/features/shared/ConfirmationDialog";
import { LoadingSpinner } from "#/features/shared/LoadingSpinner";

const AdminCommunicationPlanEditor = lazy(async () => {
  const module =
    await import("#/features/admin-email/AdminCommunicationPlanEditor");
  return { default: module.AdminCommunicationPlanEditor };
});

function move<T>(values: Array<T>, index: number, direction: -1 | 1): Array<T> {
  const destination = index + direction;
  if (destination < 0 || destination >= values.length) return values;
  const next = [...values];
  [next[index], next[destination]] = [next[destination] as T, next[index] as T];
  return next;
}

export function AdminEventTemplateEditor({
  detail,
  onChanged,
}: {
  detail: AdminEventTemplateDetail;
  onChanged: () => Promise<void>;
}) {
  const navigate = useNavigate({ from: "/admin/events/$eventTemplateId" });
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editorView, setEditorView] = useState<
    "communications" | "details" | "program" | "staffing"
  >("details");
  const intent = useRef<"save" | "publish">("save");
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
            "The template could not be saved. Check all selected people and activities.",
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
      if (result.data.eventTemplateVersionId)
        await navigate({
          search: { version: result.data.eventTemplateVersionId },
        });
    } finally {
      setPending(null);
    }
  }

  async function deleteDraftVersion() {
    setPending("delete");
    setError(null);
    try {
      const result = await deleteAdminEventVersion({
        data: {
          eventTemplateId: detail.template.id,
          eventTemplateVersionId: detail.version.id,
        },
      });
      if (result.status !== "ready") {
        setError(
          "This draft cannot be deleted because it is published or already used by an event instance.",
        );
        return;
      }
      setDeleteOpen(false);
      if (result.data.outcome === "template-deleted") {
        await navigate({
          to: "/admin/events/templates",
        });
        return;
      }
      const fallback = detail.versions.find(
        (version) => version.id !== detail.version.id,
      );
      await navigate({
        search: { version: fallback?.id },
        replace: true,
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="end" wrap="wrap">
        <div>
          <Button
            variant="subtle"
            px={0}
            onClick={() => {
              void navigate({
                to: "/admin/events/templates",
              });
            }}
          >
            Back to event templates
          </Button>
          <Group gap="sm">
            <Title order={1}>{detail.template.title}</Title>
            <Badge variant="light">Version {detail.version.version}</Badge>
          </Group>
          <MantineNativeSelect
            label="Template version"
            value={detail.version.id}
            data={detail.versions.map((version) => ({
              value: version.id,
              label: `Version ${String(version.version)} · ${version.publishedAt ? "Published" : "Draft"}`,
            }))}
            onChange={(event) => {
              void navigate({
                search: { version: event.currentTarget.value },
              });
            }}
          />
        </div>
        {detail.version.editable ? (
          <Group>
            <Button
              color="red"
              variant="subtle"
              disabled={pending !== null}
              onClick={() => {
                setDeleteOpen(true);
              }}
            >
              Delete draft
            </Button>
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
        ) : detail.versions.some((version) => !version.publishedAt) ? null : (
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

      {deleteOpen ? (
        <ConfirmationDialog
          title="Delete draft version?"
          description={
            detail.versions.length === 1
              ? "This is the template's only version, so the unused template will also be deleted. This cannot be undone."
              : `Version ${String(detail.version.version)} and its draft content will be permanently deleted. Published versions are unchanged.`
          }
          confirmLabel="Delete draft"
          pending={pending === "delete"}
          onCancel={() => {
            setDeleteOpen(false);
          }}
          onConfirm={() => void deleteDraftVersion()}
        />
      ) : null}

      <PageTabs
        label="Event template workspace"
        value={editorView}
        tabs={[
          { value: "details", label: "Details" },
          {
            value: "program",
            label: `Program (${String(draft.sections.length)})`,
          },
          { value: "staffing", label: "Staffing and regions" },
          { value: "communications", label: "Communications" },
        ]}
        onChange={setEditorView}
      />

      {editorView === "details" ? (
        <Paper withBorder radius="lg" p={{ base: "md", sm: "lg" }}>
          <Stack gap="md">
            <Title order={2}>Template details</Title>
            <MantineTextInput
              label="Title"
              value={draft.title}
              disabled={!detail.version.editable}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setDraft((current) => ({ ...current, title: value }));
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
      ) : null}

      {editorView === "program" ? (
        <Stack gap="lg">
          <Group justify="space-between">
            <Title order={2}>Sections and activities</Title>
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
                        phase: "pre_event",
                        releaseAnchor: "participation_created",
                        releaseOffsetAmount: 0,
                        releaseOffsetUnit: "minute",
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
            <Paper
              key={section.id}
              withBorder
              radius="lg"
              p={{ base: "md", sm: "lg" }}
            >
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
                    <Group grow align="start">
                      <MantineNativeSelect
                        label="Stage"
                        value={section.phase}
                        disabled={!detail.version.editable}
                        data={[
                          { value: "pre_event", label: "Pre-event" },
                          { value: "session", label: "Event session" },
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
                        label="Offset amount"
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
                        label="Offset unit"
                        value={section.releaseOffsetUnit}
                        disabled={!detail.version.editable}
                        data={[
                          { value: "minute", label: "Minutes (elapsed)" },
                          { value: "hour", label: "Hours (elapsed)" },
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
                    </Group>
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
                {detail.communications.some(
                  (communication) => communication.sectionId === section.id,
                ) ? (
                  <Stack gap="xs">
                    <Text fw={600} size="sm">
                      Automated emails
                    </Text>
                    {detail.communications
                      .filter(
                        (communication) =>
                          communication.sectionId === section.id,
                      )
                      .map((communication) => (
                        <Group key={communication.id} gap="xs">
                          <Text size="sm">{communication.label}</Text>
                          <Badge variant="outline">
                            {communication.trigger.replaceAll("_", " ")}
                          </Badge>
                        </Group>
                      ))}
                  </Stack>
                ) : null}
                <Group>
                  <Button
                    size="xs"
                    variant="subtle"
                    onClick={() => {
                      setEditorView("communications");
                    }}
                  >
                    Manage automated emails
                  </Button>
                </Group>
              </Stack>
            </Paper>
          ))}
        </Stack>
      ) : null}

      {editorView === "staffing" ? (
        <Stack gap="lg">
          <Paper withBorder radius="lg" p={{ base: "md", sm: "lg" }}>
            <Stack gap="sm">
              <Title order={2}>Default administrators</Title>
              <EligibleStaffPicker
                label="Administrator"
                candidates={detail.people.platformAdministrators}
                people={detail.people.users}
                selectedIds={draft.defaultAdministratorIds}
                minimumSelected={1}
                disabled={!detail.version.editable}
                onChange={(defaultAdministratorIds) => {
                  setDraft((current) => ({
                    ...current,
                    defaultAdministratorIds,
                  }));
                }}
              />
            </Stack>
          </Paper>

          <Paper withBorder radius="lg" p={{ base: "md", sm: "lg" }}>
            <Stack gap="md">
              <Title order={2}>Regions and coordinators</Title>
              {draft.regions.map((region) => {
                const option = detail.regions.find(
                  (candidate) => candidate.id === region.regionId,
                );
                return (
                  <Stack key={region.regionId} gap="xs">
                    <Group justify="space-between">
                      <div>
                        <Text fw={700}>{option?.name ?? region.regionId}</Text>
                        {option?.parentName ? (
                          <Text c="dimmed" size="xs">
                            {option.parentName}
                          </Text>
                        ) : null}
                      </div>
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
                    <EligibleStaffPicker
                      label="Coordinator"
                      candidates={detail.people.coordinators.filter(
                        (coordinator) =>
                          coordinator.regionId === region.regionId,
                      )}
                      people={detail.people.users}
                      selectedIds={region.coordinatorIds}
                      minimumSelected={1}
                      disabled={!detail.version.editable}
                      onChange={(coordinatorIds) => {
                        setDraft((current) => ({
                          ...current,
                          regions: current.regions.map((candidate) =>
                            candidate.regionId === region.regionId
                              ? { ...candidate, coordinatorIds }
                              : candidate,
                          ),
                        }));
                      }}
                    />
                    <hr className={classes.divider} />
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
                        label: `${region.parentName ? `${region.parentName} — ` : ""}${region.name} · ${region.code}`,
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
      ) : null}

      {editorView === "communications" ? (
        <Suspense fallback={<LoadingSpinner label="Loading communications" />}>
          <AdminCommunicationPlanEditor
            scope={{
              kind: "event_template",
              eventTemplateVersionId: detail.version.id,
            }}
            onChanged={onChanged}
          />
        </Suspense>
      ) : null}
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
      <hr className={classes.divider} />
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
