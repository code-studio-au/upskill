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
import {
  findSectionPublicationIssue,
  sectionPublicationMessage,
} from "#/features/shared/section-publication";
import classes from "./AdminCourseEditor.module.css";

const CertificateAccreditationEditor = lazy(async () => {
  const module =
    await import("#/features/shared/CertificateAccreditationEditor");
  return { default: module.CertificateAccreditationEditor };
});

const OfferingImageEditor = lazy(async () => {
  const module = await import("#/features/shared/OfferingImageEditor");
  return { default: module.OfferingImageEditor };
});

const AdminCourseProgramEditor = lazy(async () => {
  const module = await import("./AdminCourseProgramEditor");
  return { default: module.AdminCourseProgramEditor };
});

const AdminCourseRoster = lazy(async () => {
  const module = await import("./AdminCourseRoster");
  return { default: module.AdminCourseRoster };
});

const AdminCourseBulkPricingEditor = lazy(async () => {
  const module = await import("./AdminCourseBulkPricingEditor");
  return { default: module.AdminCourseBulkPricingEditor };
});

const ScheduleEmailEditor = lazy(async () => {
  const module = await import("#/features/admin-email/ScheduleEmailEditor");
  return { default: module.ScheduleEmailEditor };
});

type Confirmation =
  | { action: "archive" }
  | { action: "delete-course" }
  | { action: "delete-section"; sectionId: string }
  | { action: "delete-item"; sectionId: string; itemId: string };

type ItemKind = AdminCourseItem["kind"];

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
    "details" | "email" | "program" | "learners" | "settings"
  >("details");
  const [emailSelection, setEmailSelection] = useState<{
    sectionId: string;
    itemId: string;
  } | null>(null);
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
      const sectionIssue = findSectionPublicationIssue(
        parsed.data.sections,
        (item) => item.kind !== "automated_email",
      );
      if (submitIntent.current === "publish" && sectionIssue) {
        setEditorView("program");
        setError(sectionPublicationMessage(sectionIssue, "learning item"));
        return;
      }
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
  const saleDiscountPercent =
    draft.salePriceCents === null || draft.priceCents === 0
      ? 10
      : Math.round((1 - draft.salePriceCents / draft.priceCents) * 10_000) /
        100;
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
      type: survey.type,
    }));
  }, [detail.library.modules, detail.library.surveys, itemKind, resources]);

  const referenceSelectData = useMemo(() => {
    const emptyOption = {
      value: "",
      label:
        referenceOptions.length === 0
          ? "No published content available"
          : "Choose content",
    };
    if (itemKind !== "survey") return [emptyOption, ...referenceOptions];
    return [
      emptyOption,
      {
        group: "eLearning surveys",
        items: referenceOptions.filter(
          (option) => "type" in option && option.type === "elearning",
        ),
      },
      {
        group: "Shared surveys",
        items: referenceOptions.filter(
          (option) => "type" in option && option.type === "shared",
        ),
      },
    ];
  }, [itemKind, referenceOptions]);

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

  async function createVersion(): Promise<void> {
    setPending("new-version");
    setError(null);
    try {
      const result = await createAdminCourseVersion({
        data: {
          courseId: detail.course.id,
          sourceVersionId: detail.version.id,
        },
      });
      if (result.status !== "ready" || !result.data.versionId) {
        setError("A draft version already exists.");
        return;
      }
      await router.navigate({
        to: "/admin/courses/$courseId",
        params: { courseId: detail.course.id },
        search: { version: result.data.versionId },
      });
    } finally {
      setPending(null);
    }
  }

  const editable = detail.version.editable;
  const availableDraft = detail.versions.find(
    (version) => version.publishedAt === null,
  );
  return (
    <Stack gap="xl">
      <div className={classes.header}>
        <Button component={Link} to="/admin/courses" variant="subtle" px={0}>
          Back to courses
        </Button>
        <Group gap="sm" align="center">
          <Title order={1}>{draft.title}</Title>
          <Badge variant="light">Version {detail.version.version}</Badge>
        </Group>
      </div>

      <Paper withBorder radius="lg" p="sm" className={classes.commandBar}>
        <div className={classes.versionPicker}>
          <MantineNativeSelect
            label="Course version"
            value={detail.version.id}
            data={detail.versions.map((version) => ({
              value: version.id,
              label: `Version ${String(version.version)} · ${version.publishedAt ? "Published" : "Draft"}`,
            }))}
            onChange={(event) => {
              void router.navigate({
                to: "/admin/courses/$courseId",
                params: { courseId: detail.course.id },
                search: { version: event.currentTarget.value },
              });
            }}
          />
        </div>
        <div className={classes.commandActions}>
          {editable &&
          (editorView === "details" || editorView === "program") ? (
            <courseForm.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Group>
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
                    Save and publish
                  </Button>
                </Group>
              )}
            </courseForm.Subscribe>
          ) : !editable &&
            detail.course.status !== "archived" &&
            availableDraft ? (
            <Button
              variant="light"
              onClick={() => {
                void router.navigate({
                  to: "/admin/courses/$courseId",
                  params: { courseId: detail.course.id },
                  search: { version: availableDraft.id },
                });
              }}
            >
              Open draft
            </Button>
          ) : !editable && detail.course.status !== "archived" ? (
            <Button
              loading={pending === "new-version"}
              onClick={() => void createVersion()}
            >
              Create new version from version {detail.version.version}
            </Button>
          ) : null}
        </div>
      </Paper>

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
        value={editorView === "email" ? "program" : editorView}
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

      {editorView === "email" && emailSelection ? (
        <Suspense fallback={<LoadingSpinner label="Loading email editor" />}>
          {(() => {
            const section = draft.sections.find(
              (candidate) => candidate.id === emailSelection.sectionId,
            );
            const item = section?.items.find(
              (candidate) => candidate.id === emailSelection.itemId,
            );
            return section && item?.kind === "automated_email" ? (
              <ScheduleEmailEditor
                scope={{
                  kind: "course",
                  courseVersionId: detail.version.id,
                }}
                item={item}
                templates={detail.emailTemplates}
                variableGroups={detail.emailVariableGroups}
                sessions={[]}
                offeringTitle={draft.title}
                sectionTitle={section.title}
                editable={editable}
                onChange={(next) => {
                  if ("sessionItemId" in next) return;
                  updateSection(section.id, (current) => ({
                    ...current,
                    items: current.items.map((candidate) =>
                      candidate.id === next.id ? next : candidate,
                    ),
                  }));
                }}
                onClose={() => {
                  setEmailSelection(null);
                  setEditorView("program");
                }}
              />
            ) : (
              <Alert color="red">The automated email is unavailable.</Alert>
            );
          })()}
        </Suspense>
      ) : null}

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
              <MantineTextInput
                label="Topic"
                value={draft.topic}
                disabled={!editable}
                maxLength={80}
                onChange={(event) => {
                  const value = event.currentTarget.value;
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
              <Suspense fallback={<LoadingSpinner label="Loading image" />}>
                <OfferingImageEditor
                  image={draft.coverImage}
                  editable={editable}
                  onChange={(coverImage) => {
                    setDraft((current) => ({ ...current, coverImage }));
                  }}
                />
              </Suspense>
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
              <MantineCheckbox
                label="On sale"
                checked={draft.salePriceCents !== null}
                disabled={!editable || draft.priceCents === 0}
                onChange={(checked) => {
                  setDraft((current) => ({
                    ...current,
                    salePriceCents: checked
                      ? Math.round(current.priceCents * 0.9)
                      : null,
                  }));
                }}
              />
            </Group>
            {draft.hasCompletionCertificate ? (
              <Suspense
                fallback={<LoadingSpinner label="Loading accreditations" />}
              >
                <CertificateAccreditationEditor
                  accreditations={draft.accreditations}
                  editable={editable}
                  onChange={(accreditations) => {
                    setDraft((current) => ({ ...current, accreditations }));
                  }}
                />
              </Suspense>
            ) : null}
            <Paper withBorder radius="md" p="md">
              <Stack gap="md">
                <Title order={3} size="h4">
                  Individual pricing
                </Title>
                <div className={classes.pricingColumns}>
                  <MantineTextInput
                    label="Original price (AUD)"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={String(draft.priceCents / 100)}
                    disabled={!editable}
                    onChange={(event) => {
                      const priceCents = Math.round(
                        numericValue(event.currentTarget.value) * 100,
                      );
                      setDraft((current) => ({
                        ...current,
                        priceCents,
                        salePriceCents:
                          current.salePriceCents === null || priceCents === 0
                            ? null
                            : Math.round(
                                priceCents * (1 - saleDiscountPercent / 100),
                              ),
                      }));
                    }}
                  />
                  <MantineTextInput
                    label="Sale discount (%)"
                    type="number"
                    inputMode="decimal"
                    min={0.01}
                    max={100}
                    step="0.01"
                    value={
                      draft.salePriceCents === null
                        ? ""
                        : String(saleDiscountPercent)
                    }
                    placeholder="Enable On sale"
                    disabled={!editable || draft.salePriceCents === null}
                    onChange={(event) => {
                      const discount = Math.min(
                        100,
                        Math.max(0, numericValue(event.currentTarget.value)),
                      );
                      setDraft((current) => ({
                        ...current,
                        salePriceCents: Math.round(
                          current.priceCents * (1 - discount / 100),
                        ),
                      }));
                    }}
                  />
                  <MantineTextInput
                    label="Sale price (AUD)"
                    value={
                      draft.salePriceCents === null
                        ? "Not on sale"
                        : (draft.salePriceCents / 100).toFixed(2)
                    }
                    readOnly
                  />
                </div>
              </Stack>
            </Paper>
            <Suspense fallback={<LoadingSpinner />}>
              <AdminCourseBulkPricingEditor
                bulkPricing={draft.bulkPricing}
                editable={editable}
                individualPriceCents={draft.salePriceCents ?? draft.priceCents}
                onChange={(bulkPricing) => {
                  setDraft((current) => ({ ...current, bulkPricing }));
                }}
              />
            </Suspense>
          </Stack>
        </Paper>
      ) : null}

      {editorView === "program" ? (
        <Suspense fallback={<LoadingSpinner label="Loading programme" />}>
          <AdminCourseProgramEditor
            detail={detail}
            draft={draft}
            editable={editable}
            setDraft={setDraft}
            onAddItem={(sectionId) => {
              setItemSectionId(sectionId);
              setItemKind("scorm");
              setItemReference(null);
            }}
            onUploadPdf={(sectionId) => {
              setResourceSectionId(sectionId);
              resourceForm.reset();
            }}
            onEditEmail={(sectionId, itemId) => {
              setEmailSelection({ sectionId, itemId });
              setEditorView("email");
            }}
            onRemoveSection={(sectionId) => {
              setConfirmation({ action: "delete-section", sectionId });
            }}
            onRemoveItem={(sectionId, itemId) => {
              setConfirmation({ action: "delete-item", sectionId, itemId });
            }}
          />
        </Suspense>
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
              data={referenceSelectData}
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
