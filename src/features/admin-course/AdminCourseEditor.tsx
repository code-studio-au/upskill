import { Badge } from "#/features/shared/Badge";
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
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { Link, useRouter } from "@tanstack/react-router";
import {
  lazy,
  Suspense,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import {
  adminCourseDraftSchema,
  type AdminCourseDetail,
  type AdminCourseDraft,
  type AdminCourseItem,
} from "./admin-course.schema";
import {
  adminResourceUploadFormSchema,
  type AdminCourseResourceOption,
} from "#/features/resource/resource.schema";
import {
  archiveAdminCourse,
  createAdminCourseVersion,
  deleteAdminCourse,
  publishAdminCourse,
  saveAdminCourse,
} from "#/server/functions/admin-course";
import { AppDialog } from "#/features/shared/AppDialog";
import { ConfirmationDialog } from "#/features/shared/ConfirmationDialog";
import { MantineFilePicker } from "#/features/shared/MantineFilePicker";
import { MantineCheckbox } from "#/features/shared/MantineCheckbox";
import { firstFormError } from "#/features/shared/form-errors";
import { createFriendlySlug } from "#/features/shared/friendly-slug";
import { PageTabs } from "#/features/shared/PageTabs";
import { LoadingSpinner } from "#/features/shared/LoadingSpinner";
import classes from "./AdminCourseEditor.module.css";

const AdminCourseRoster = lazy(async () => {
  const module = await import("./AdminCourseRoster");
  return { default: module.AdminCourseRoster };
});

type Confirmation =
  | { action: "archive" }
  | { action: "delete-course" }
  | { action: "delete-section"; sectionId: string }
  | { action: "delete-item"; sectionId: string; itemId: string };

type ItemKind = AdminCourseItem["kind"];

function move<T>(values: Array<T>, index: number, direction: -1 | 1): Array<T> {
  const target = index + direction;
  if (target < 0 || target >= values.length) return values;
  const next = [...values];
  [next[index], next[target]] = [next[target] as T, next[index] as T];
  return next;
}

function numericValue(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function AdminCourseEditor({
  detail,
  onChanged,
}: {
  detail: AdminCourseDetail;
  onChanged: () => Promise<void>;
}) {
  const router = useRouter();
  const [resources, setResources] = useState(() => detail.library.resources);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorView, setEditorView] = useState<
    "details" | "program" | "learners" | "settings"
  >("details");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [itemSectionId, setItemSectionId] = useState<string | null>(null);
  const [itemKind, setItemKind] = useState<ItemKind>("scorm");
  const [itemReference, setItemReference] = useState<string | null>(null);
  const [itemDuration, setItemDuration] = useState<number>(30);
  const [itemRequired, setItemRequired] = useState(true);
  const [resourceSectionId, setResourceSectionId] = useState<string | null>(
    null,
  );
  const submitIntent = useRef<"save" | "publish">("save");
  const autoSlug = useRef(detail.draft.slug.startsWith("draft-course-"));
  const courseForm = useForm({
    defaultValues: { draft: detail.draft },
    validators: {
      onSubmit: ({ value }) => {
        const parsed = adminCourseDraftSchema.safeParse(value.draft);
        return parsed.success
          ? undefined
          : (parsed.error.issues[0]?.message ?? "Review the course fields.");
      },
    },
    onSubmit: async ({ value }) => {
      const parsed = adminCourseDraftSchema.safeParse(value.draft);
      if (!parsed.success) {
        setError(
          parsed.error.issues[0]?.message ?? "Review the course fields.",
        );
        return;
      }
      setError(null);
      setMessage(null);
      const saved = await saveAdminCourse({ data: parsed.data });
      if (saved.status !== "ready") {
        setError(
          saved.status === "conflict" && saved.reason === "slug_in_use"
            ? "That URL slug is already used by another course. Choose a unique slug."
            : "The course draft could not be saved. Refresh and try again.",
        );
        return;
      }
      if (submitIntent.current === "save") {
        setMessage("Draft saved.");
        return;
      }
      const published = await publishAdminCourse({
        data: {
          courseId: detail.course.id,
          versionId: detail.version.id,
        },
      });
      if (published.status !== "ready") {
        setError("Add at least one section and item before publishing.");
        return;
      }
      await onChanged();
      setMessage(`Version ${String(detail.version.version)} published.`);
    },
  });
  const draft = useStore(courseForm.store, (state) => state.values.draft);
  const resourceForm = useForm({
    defaultValues: {
      title: "",
      description: "",
      document: null as File | null,
    },
    validators: { onSubmit: adminResourceUploadFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = adminResourceUploadFormSchema.safeParse(value);
      const sectionId = resourceSectionId;
      if (!parsed.success || !sectionId) return;
      setError(null);
      try {
        const query = new URLSearchParams({
          title: parsed.data.title,
          description: parsed.data.description,
          displayName: parsed.data.document.name,
        });
        const response = await fetch(`/api/admin/resources?${query}`, {
          method: "POST",
          headers: { "Content-Type": "application/pdf" },
          body: parsed.data.document,
        });
        if (!response.ok) throw new Error("upload_failed");
        const result = (await response.json()) as {
          resource?: AdminCourseResourceOption;
        };
        const resource = result.resource;
        if (!resource) throw new Error("upload_failed");
        setResources((current) => [...current, resource]);
        updateSection(sectionId, (section) => ({
          ...section,
          items: [
            ...section.items,
            {
              id: `item_${crypto.randomUUID()}`,
              kind: "resource",
              title: resource.title,
              required: true,
              durationMinutes: null,
              resourceVersionId: resource.id,
            },
          ],
        }));
        setResourceSectionId(null);
        setMessage(
          "PDF uploaded and added to the section. Save the draft to apply it.",
        );
      } catch {
        setError("The PDF could not be uploaded. Try again.");
      }
    },
  });

  function setDraft(update: SetStateAction<AdminCourseDraft>): void {
    const current = courseForm.state.values.draft;
    courseForm.setFieldValue(
      "draft",
      typeof update === "function" ? update(current) : update,
    );
  }

  const referenceOptions = useMemo(() => {
    if (itemKind === "scorm")
      return detail.library.modules.map((module) => ({
        value: module.id,
        label: `${module.title} · v${String(module.version)}`,
      }));
    if (itemKind === "resource")
      return resources.map((resource) => ({
        value: resource.id,
        label: `${resource.title} · v${String(resource.version)}`,
      }));
    return detail.library.surveys.map((survey) => ({
      value: survey.id,
      label: `${survey.title} · v${String(survey.version)}`,
    }));
  }, [detail.library.modules, detail.library.surveys, itemKind, resources]);

  function updateSection(
    sectionId: string,
    update: (
      section: AdminCourseDraft["sections"][number],
    ) => AdminCourseDraft["sections"][number],
  ): void {
    setDraft((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId ? update(section) : section,
      ),
    }));
  }

  async function runConfirmedAction(): Promise<void> {
    if (!confirmation) return;
    if (confirmation.action === "delete-section") {
      setDraft((current) => ({
        ...current,
        sections: current.sections.filter(
          (section) => section.id !== confirmation.sectionId,
        ),
      }));
      setConfirmation(null);
      setMessage("Section removed from this draft. Save to apply the change.");
      return;
    }
    if (confirmation.action === "delete-item") {
      updateSection(confirmation.sectionId, (section) => ({
        ...section,
        items: section.items.filter((item) => item.id !== confirmation.itemId),
      }));
      setConfirmation(null);
      setMessage("Item removed from this draft. Save to apply the change.");
      return;
    }
    setPending(confirmation.action);
    setError(null);
    try {
      const result =
        confirmation.action === "archive"
          ? await archiveAdminCourse({ data: { courseId: detail.course.id } })
          : await deleteAdminCourse({ data: { courseId: detail.course.id } });
      if (result.status !== "ready") {
        setError(
          confirmation.action === "delete-course"
            ? "This course has enrolment or commerce history and cannot be deleted."
            : "The course could not be archived.",
        );
        return;
      }
      setConfirmation(null);
      if (confirmation.action === "delete-course") {
        await router.navigate({ to: "/admin/courses" });
        return;
      }
      await onChanged();
      setMessage("Course archived and removed from the public catalogue.");
    } finally {
      setPending(null);
    }
  }

  const editable = detail.version.editable;
  return (
    <Stack gap="xl">
      <Group justify="space-between" align="end" wrap="wrap">
        <div>
          <Button component={Link} to="/admin/courses" variant="subtle" px={0}>
            Back to courses
          </Button>
          <Group gap="sm" mt="xs">
            <Title order={1}>{detail.course.title}</Title>
            <Badge variant="light">Version {detail.version.version}</Badge>
            <Badge
              color={detail.course.status === "archived" ? "gray" : "indigo"}
              variant="light"
            >
              {detail.course.status}
            </Badge>
          </Group>
        </div>
        <Group>
          {editable &&
          (editorView === "details" || editorView === "program") ? (
            <courseForm.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <>
                  <Button
                    variant="default"
                    loading={isSubmitting && submitIntent.current === "save"}
                    disabled={isSubmitting}
                    onClick={() => {
                      submitIntent.current = "save";
                      void courseForm.handleSubmit();
                    }}
                  >
                    Save draft
                  </Button>
                  <Button
                    loading={isSubmitting && submitIntent.current === "publish"}
                    disabled={isSubmitting}
                    onClick={() => {
                      submitIntent.current = "publish";
                      void courseForm.handleSubmit();
                    }}
                  >
                    Publish version
                  </Button>
                </>
              )}
            </courseForm.Subscribe>
          ) : !editable && detail.course.status !== "archived" ? (
            <Button
              loading={pending === "new-version"}
              onClick={() => {
                setPending("new-version");
                setError(null);
                void createAdminCourseVersion({
                  data: { courseId: detail.course.id },
                })
                  .then(async (result) => {
                    if (result.status !== "ready") {
                      setError("A draft version already exists.");
                      return;
                    }
                    await onChanged();
                    setMessage(
                      "A new draft version was created. Published enrolments remain unchanged.",
                    );
                  })
                  .finally(() => {
                    setPending(null);
                  });
              }}
            >
              Create version {detail.version.version + 1}
            </Button>
          ) : null}
        </Group>
      </Group>

      {!editable && detail.course.status !== "archived" ? (
        <Alert color="indigo" title="Published versions are immutable">
          Create a new version before reordering or removing course content.
          Existing enrolments stay pinned to this version.
        </Alert>
      ) : null}
      {message ? <Alert color="green">{message}</Alert> : null}
      {error ? <Alert color="red">{error}</Alert> : null}
      <courseForm.Subscribe selector={(state) => state.errors}>
        {(errors) => {
          const validationError = firstFormError(errors);
          return validationError ? (
            <Alert color="red">{validationError}</Alert>
          ) : null;
        }}
      </courseForm.Subscribe>

      <PageTabs
        label="Course workspace"
        value={editorView}
        tabs={[
          { value: "details", label: "Details" },
          {
            value: "program",
            label: `Program (${String(draft.sections.length)})`,
          },
          {
            value: "learners",
            label: `Learners (${String(detail.course.enrollmentCount)})`,
          },
          { value: "settings", label: "Settings" },
        ]}
        onChange={setEditorView}
      />

      {editorView === "details" ? (
        <Paper withBorder radius="lg" p={{ base: "md", sm: "lg" }}>
          <Stack gap="md">
            <Title order={2}>Course details</Title>
            <MantineTextInput
              label="Title"
              value={draft.title}
              disabled={!editable}
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
              required
            />
            <MantineTextInput
              label="Friendly URL"
              description="Used in the public course URL. It must be unique."
              value={draft.slug}
              disabled={!editable}
              onChange={(event) => {
                autoSlug.current = false;
                const value = event.currentTarget.value;
                setDraft((current) => ({ ...current, slug: value }));
              }}
              required
            />
            <MantineTextInput
              component="textarea"
              label="Summary"
              value={draft.summary}
              disabled={!editable}
              classNames={{ input: classes.textArea }}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setDraft((current) => ({
                  ...current,
                  summary: value,
                }));
              }}
              required
            />
            <MantineTextInput
              component="textarea"
              label="Description"
              value={draft.description}
              disabled={!editable}
              classNames={{ input: classes.textAreaTall }}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setDraft((current) => ({
                  ...current,
                  description: value,
                }));
              }}
              required
            />
            <div className={classes.threeColumns}>
              <MantineNativeSelect
                label="Topic"
                value={draft.topic}
                disabled={!editable}
                data={[
                  { value: "leadership", label: "Leadership" },
                  { value: "safety", label: "Safety" },
                  { value: "technology", label: "Technology" },
                ]}
                onChange={(event) => {
                  const value = event.currentTarget
                    .value as AdminCourseDraft["topic"];
                  setDraft((current) => ({
                    ...current,
                    topic: value,
                  }));
                }}
              />
              <MantineTextInput
                label="Duration (minutes)"
                type="number"
                inputMode="numeric"
                min={1}
                value={String(draft.durationMinutes)}
                disabled={!editable}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setDraft((current) => ({
                    ...current,
                    durationMinutes: numericValue(value),
                  }));
                }}
              />
              <MantineTextInput
                label="Price (AUD)"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={String(draft.priceCents / 100)}
                disabled={!editable}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setDraft((current) => ({
                    ...current,
                    priceCents: Math.round(numericValue(value) * 100),
                  }));
                }}
              />
            </div>
            <Group>
              <MantineCheckbox
                label="List in public catalogue"
                checked={draft.listInStore}
                disabled={!editable}
                onChange={(checked) => {
                  setDraft((current) => ({
                    ...current,
                    listInStore: checked,
                  }));
                }}
              />
              <MantineCheckbox
                label="Featured"
                checked={draft.featured}
                disabled={!editable}
                onChange={(checked) => {
                  setDraft((current) => ({
                    ...current,
                    featured: checked,
                  }));
                }}
              />
              <MantineCheckbox
                label="Completion certificate"
                checked={draft.hasCompletionCertificate}
                disabled={!editable}
                onChange={(checked) => {
                  setDraft((current) => ({
                    ...current,
                    hasCompletionCertificate: checked,
                  }));
                }}
              />
            </Group>
          </Stack>
        </Paper>
      ) : null}

      {editorView === "program" ? (
        <Stack gap="md">
          <Group justify="space-between">
            <div>
              <Title order={2}>Sections and items</Title>
              <Text c="dimmed">
                Section progress is derived from completion of its required
                items.
              </Text>
            </div>
            {editable ? (
              <Button
                variant="light"
                onClick={() => {
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
                }}
              >
                Add section
              </Button>
            ) : null}
          </Group>

          {draft.sections.length === 0 ? (
            <Alert title="No sections">
              Add a section to organise the course.
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
                <Group justify="space-between" align="start" wrap="wrap">
                  <div className={classes.sectionFields}>
                    <MantineTextInput
                      label={`Section ${String(sectionIndex + 1)} title`}
                      value={section.title}
                      disabled={!editable}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        updateSection(section.id, (current) => ({
                          ...current,
                          title: value,
                        }));
                      }}
                    />
                    <MantineTextInput
                      component="textarea"
                      label="Description"
                      value={section.description}
                      disabled={!editable}
                      classNames={{ input: classes.textArea }}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        updateSection(section.id, (current) => ({
                          ...current,
                          description: value,
                        }));
                      }}
                    />
                  </div>
                  {editable ? (
                    <Group gap="xs">
                      <Button
                        size="xs"
                        variant="default"
                        disabled={sectionIndex === 0}
                        onClick={() => {
                          setDraft((current) => ({
                            ...current,
                            sections: move(current.sections, sectionIndex, -1),
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
                      <Button
                        size="xs"
                        color="red"
                        variant="subtle"
                        onClick={() => {
                          setConfirmation({
                            action: "delete-section",
                            sectionId: section.id,
                          });
                        }}
                      >
                        Remove
                      </Button>
                    </Group>
                  ) : null}
                </Group>

                <Stack gap="xs">
                  {section.items.map((item, itemIndex) => (
                    <Paper
                      key={item.id}
                      withBorder
                      radius="md"
                      p="sm"
                      className={classes.item}
                    >
                      <div>
                        <Text fw={600}>{item.title}</Text>
                        <Text size="xs" c="dimmed" tt="capitalize">
                          {item.kind} ·{" "}
                          {item.required ? "Required" : "Optional"}
                          {item.durationMinutes
                            ? ` · ${String(item.durationMinutes)} min`
                            : ""}
                        </Text>
                      </div>
                      {editable ? (
                        <Group gap="xs">
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
                            Up
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
                            Down
                          </Button>
                          <Button
                            size="compact-xs"
                            color="red"
                            variant="subtle"
                            onClick={() => {
                              setConfirmation({
                                action: "delete-item",
                                sectionId: section.id,
                                itemId: item.id,
                              });
                            }}
                          >
                            Remove
                          </Button>
                        </Group>
                      ) : null}
                    </Paper>
                  ))}
                  {editable ? (
                    <Group>
                      <Button
                        size="xs"
                        variant="light"
                        onClick={() => {
                          setItemSectionId(section.id);
                          setItemKind("scorm");
                          setItemReference(null);
                        }}
                      >
                        Add item
                      </Button>
                      <Button
                        size="xs"
                        variant="default"
                        onClick={() => {
                          setResourceSectionId(section.id);
                          resourceForm.reset();
                        }}
                      >
                        Upload PDF
                      </Button>
                    </Group>
                  ) : null}
                </Stack>
              </Stack>
            </Paper>
          ))}
        </Stack>
      ) : null}

      {editorView === "learners" ? (
        <Suspense
          fallback={
            <Paper withBorder radius="lg" p={{ base: "md", sm: "lg" }}>
              <Group gap="sm">
                <LoadingSpinner />
                <Text>Loading learner roster...</Text>
              </Group>
            </Paper>
          }
        >
          <AdminCourseRoster detail={detail} onChanged={onChanged} />
        </Suspense>
      ) : null}

      {editorView === "settings" ? (
        <Paper withBorder radius="lg" p={{ base: "md", sm: "lg" }}>
          <Stack gap="md">
            <Title order={2}>Course lifecycle</Title>
            <Text c="dimmed">
              {detail.course.enrollmentCount} enrolments and{" "}
              {detail.course.commerceReferenceCount} commerce references retain
              immutable version history.
            </Text>
            <Group>
              {detail.course.status !== "archived" ? (
                <Button
                  color="red"
                  variant="light"
                  onClick={() => {
                    setConfirmation({ action: "archive" });
                  }}
                >
                  Archive course
                </Button>
              ) : (
                <Button
                  color="red"
                  disabled={!detail.course.canDelete}
                  onClick={() => {
                    setConfirmation({ action: "delete-course" });
                  }}
                >
                  Permanently delete
                </Button>
              )}
            </Group>
            {detail.course.status === "archived" && !detail.course.canDelete ? (
              <Text size="sm" c="dimmed">
                Archived courses with enrolment or commerce history are retained
                and cannot be permanently deleted.
              </Text>
            ) : null}
          </Stack>
        </Paper>
      ) : null}

      {itemSectionId !== null ? (
        <AppDialog
          onClose={() => {
            setItemSectionId(null);
          }}
          title="Add course item"
        >
          <Stack gap="md">
            <MantineNativeSelect
              label="Item type"
              value={itemKind}
              data={[
                { value: "scorm", label: "SCORM module" },
                { value: "resource", label: "PDF resource" },
                { value: "survey", label: "Survey" },
              ]}
              onChange={(event) => {
                setItemKind(event.currentTarget.value as ItemKind);
                setItemReference(null);
              }}
            />
            <MantineNativeSelect
              label="Content"
              data={[
                {
                  value: "",
                  label:
                    referenceOptions.length === 0
                      ? "No published content available"
                      : "Choose content",
                },
                ...referenceOptions,
              ]}
              value={itemReference ?? ""}
              onChange={(event) => {
                setItemReference(event.currentTarget.value || null);
              }}
              disabled={referenceOptions.length === 0}
            />
            {itemKind !== "resource" ? (
              <MantineTextInput
                label="Estimated duration (minutes)"
                type="number"
                inputMode="numeric"
                min={1}
                value={String(itemDuration)}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setItemDuration(numericValue(value));
                }}
              />
            ) : null}
            <MantineCheckbox
              label="Required for section completion"
              checked={itemRequired}
              onChange={(checked) => {
                setItemRequired(checked);
              }}
            />
            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={() => {
                  setItemSectionId(null);
                }}
              >
                Cancel
              </Button>
              <Button
                disabled={!itemReference}
                onClick={() => {
                  if (!itemSectionId || !itemReference) return;
                  const selected = referenceOptions.find(
                    (option) => option.value === itemReference,
                  );
                  if (!selected) return;
                  const base = {
                    id: `item_${crypto.randomUUID()}`,
                    title: selected.label.replace(/ · v\d+$/, ""),
                    required: itemRequired,
                  };
                  const item: AdminCourseItem =
                    itemKind === "scorm"
                      ? {
                          ...base,
                          kind: "scorm",
                          durationMinutes: Math.max(1, itemDuration),
                          scormPackageVersionId: itemReference,
                        }
                      : itemKind === "survey"
                        ? {
                            ...base,
                            kind: "survey",
                            durationMinutes: Math.max(1, itemDuration),
                            surveyVersionId: itemReference,
                          }
                        : {
                            ...base,
                            kind: "resource",
                            durationMinutes: null,
                            resourceVersionId: itemReference,
                          };
                  updateSection(itemSectionId, (section) => ({
                    ...section,
                    items: [...section.items, item],
                  }));
                  setItemSectionId(null);
                }}
              >
                Add item
              </Button>
            </Group>
          </Stack>
        </AppDialog>
      ) : null}

      {resourceSectionId !== null ? (
        <resourceForm.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <AppDialog
              onClose={() => {
                if (!isSubmitting) setResourceSectionId(null);
              }}
              closeDisabled={isSubmitting}
              title="Upload PDF resource"
            >
              <form
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void resourceForm.handleSubmit();
                }}
              >
                <Stack gap="md">
                  <resourceForm.Field name="title">
                    {(field) => (
                      <MantineTextInput
                        label="Resource title"
                        name={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => {
                          field.handleChange(event.currentTarget.value);
                        }}
                        error={firstFormError(field.state.meta.errors)}
                        required
                      />
                    )}
                  </resourceForm.Field>
                  <resourceForm.Field name="description">
                    {(field) => (
                      <MantineTextInput
                        component="textarea"
                        label="Description"
                        name={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => {
                          field.handleChange(event.currentTarget.value);
                        }}
                        error={firstFormError(field.state.meta.errors)}
                        classNames={{ input: classes.textArea }}
                      />
                    )}
                  </resourceForm.Field>
                  <resourceForm.Field name="document">
                    {(field) => (
                      <MantineFilePicker
                        label="PDF document"
                        accept="application/pdf,.pdf"
                        value={field.state.value}
                        onChange={field.handleChange}
                        placeholder="Choose a PDF"
                        required
                        error={firstFormError(field.state.meta.errors)}
                        disabled={isSubmitting}
                      />
                    )}
                  </resourceForm.Field>
                  <Group justify="flex-end">
                    <Button
                      type="button"
                      variant="default"
                      disabled={isSubmitting}
                      onClick={() => {
                        setResourceSectionId(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" loading={isSubmitting}>
                      Upload and add
                    </Button>
                  </Group>
                </Stack>
              </form>
            </AppDialog>
          )}
        </resourceForm.Subscribe>
      ) : null}

      {confirmation ? (
        <ConfirmationDialog
          title={
            confirmation.action === "archive"
              ? "Archive course?"
              : confirmation.action === "delete-course"
                ? "Permanently delete course?"
                : confirmation.action === "delete-section"
                  ? "Remove section?"
                  : "Remove item?"
          }
          description={
            confirmation.action === "archive"
              ? "The course will disappear from the public catalogue. Existing version and enrolment history is retained."
              : confirmation.action === "delete-course"
                ? "This removes the archived course and every version. This cannot be undone."
                : confirmation.action === "delete-section"
                  ? "The section and its items will be removed from this draft."
                  : "The item will be removed from this draft. Published course versions are not changed."
          }
          confirmLabel="Confirm"
          pending={pending !== null}
          onCancel={() => {
            setConfirmation(null);
          }}
          onConfirm={() => void runConfirmedAction()}
        />
      ) : null}
    </Stack>
  );
}
