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
} from "./admin-event.schema";
import classes from "./AdminEventTemplateEditor.module.css";
import { PageTabs } from "#/features/shared/PageTabs";
import { EligibleStaffPicker } from "./EligibleStaffPicker";
import { ConfirmationDialog } from "#/features/shared/ConfirmationDialog";
import { LoadingSpinner } from "#/features/shared/LoadingSpinner";
import {
  findSectionPublicationIssue,
  sectionPublicationMessage,
} from "#/features/shared/section-publication";

const CertificateAccreditationEditor = lazy(async () => {
  const module =
    await import("#/features/shared/CertificateAccreditationEditor");
  return { default: module.CertificateAccreditationEditor };
});

const OfferingImageEditor = lazy(async () => {
  const module = await import("#/features/shared/OfferingImageEditor");
  return { default: module.OfferingImageEditor };
});

const ScheduleEmailEditor = lazy(async () => {
  const module = await import("#/features/admin-email/ScheduleEmailEditor");
  return { default: module.ScheduleEmailEditor };
});

const AdminEventProgramEditor = lazy(async () => {
  const module = await import("./AdminEventProgramEditor");
  return { default: module.AdminEventProgramEditor };
});

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
    "details" | "email" | "program" | "staffing"
  >("details");
  const [emailSelection, setEmailSelection] = useState<{
    sectionId: string;
    itemId: string;
  } | null>(null);
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
        const sectionIssue = findSectionPublicationIssue(
          parsed.data.sections,
          (item) => item.kind !== "automated_email",
        );
        if (intent.current === "publish" && sectionIssue) {
          setEditorView("program");
          setError(sectionPublicationMessage(sectionIssue, "learning item"));
          return;
        }
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
            "Add at least one section and session, assign an active administrator, and cover every session that requires a presenter before publishing.",
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

  async function createVersion() {
    setPending("version");
    setError(null);
    try {
      const result = await createAdminEventVersion({
        data: {
          eventTemplateId: detail.template.id,
          sourceVersionId: detail.version.id,
        },
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

  const availableDraft = detail.versions.find(
    (version) => !version.publishedAt,
  );

  return (
    <Stack gap="lg">
      <div className={classes.header}>
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
        <Group gap="sm" align="center">
          <Title order={1}>{draft.title}</Title>
          <Badge variant="light">Version {detail.version.version}</Badge>
        </Group>
      </div>

      <Paper withBorder radius="lg" p="sm" className={classes.commandBar}>
        <div className={classes.versionPicker}>
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
        <div className={classes.commandActions}>
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
          ) : availableDraft ? (
            <Button
              variant="light"
              onClick={() => {
                void navigate({ search: { version: availableDraft.id } });
              }}
            >
              Open draft
            </Button>
          ) : (
            <Button
              loading={pending === "version"}
              onClick={() => void createVersion()}
            >
              Create new version from version {detail.version.version}
            </Button>
          )}
        </div>
      </Paper>

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
        className={classes.workspaceTabs}
        label="Event template workspace"
        value={editorView === "email" ? "program" : editorView}
        tabs={[
          { value: "details", label: "Details" },
          {
            value: "program",
            label: `Program (${String(draft.sections.length)})`,
          },
          { value: "staffing", label: "Staffing and regions" },
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
                  kind: "event_template",
                  eventTemplateVersionId: detail.version.id,
                }}
                item={item}
                templates={detail.emailTemplates}
                variableGroups={detail.emailVariableGroups}
                sessions={draft.sections.flatMap((candidate) =>
                  candidate.items.flatMap((candidateItem) =>
                    candidateItem.kind === "session"
                      ? [{ id: candidateItem.id, title: candidateItem.title }]
                      : [],
                  ),
                )}
                offeringTitle={draft.title}
                sectionTitle={section.title}
                editable={detail.version.editable}
                onChange={(next) => {
                  if (!("sessionItemId" in next)) return;
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
              label="Topic"
              value={draft.topic}
              maxLength={80}
              disabled={!detail.version.editable}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setDraft((current) => ({ ...current, topic: value }));
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
            <Suspense fallback={<LoadingSpinner label="Loading image" />}>
              <OfferingImageEditor
                image={draft.coverImage}
                editable={detail.version.editable}
                onChange={(coverImage) => {
                  setDraft((current) => ({ ...current, coverImage }));
                }}
              />
            </Suspense>
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
            {draft.hasCompletionCertificate ? (
              <Suspense
                fallback={<LoadingSpinner label="Loading accreditations" />}
              >
                <CertificateAccreditationEditor
                  accreditations={draft.accreditations}
                  editable={detail.version.editable}
                  onChange={(accreditations) => {
                    setDraft((current) => ({ ...current, accreditations }));
                  }}
                />
              </Suspense>
            ) : null}
          </Stack>
        </Paper>
      ) : null}

      {editorView === "program" ? (
        <Stack gap="lg">
          <Paper withBorder radius="lg" p={{ base: "md", sm: "lg" }}>
            <Stack gap="sm">
              <Title order={2}>Registration requirements</Title>
              <Text c="dimmed">
                Learners complete this form before access. Published versions
                remain pinned to the selected survey version.
              </Text>
              <MantineNativeSelect
                label="Registration form"
                value={draft.registrationSurveyVersionId ?? ""}
                disabled={!detail.version.editable}
                data={[
                  { value: "", label: "No registration form" },
                  ...detail.library.registrationSurveys.map((survey) => ({
                    value: survey.id,
                    label: `${survey.title} · v${String(survey.version)}`,
                  })),
                ]}
                onChange={(event) => {
                  const registrationSurveyVersionId =
                    event.currentTarget.value || null;
                  setDraft((current) => ({
                    ...current,
                    registrationSurveyVersionId,
                  }));
                }}
              />
            </Stack>
          </Paper>
          <Suspense fallback={<LoadingSpinner label="Loading programme" />}>
            <AdminEventProgramEditor
              detail={detail}
              draft={draft}
              setDraft={setDraft}
              onEditEmail={(sectionId, itemId) => {
                setEmailSelection({ sectionId, itemId });
                setEditorView("email");
              }}
            />
          </Suspense>
        </Stack>
      ) : null}
      {editorView === "staffing" ? (
        <Stack gap="md">
          <Group justify="space-between" align="center">
            <Title order={2}>Staffing and regional coverage</Title>
            <Badge variant="light">{draft.regions.length} regions</Badge>
          </Group>
          <div className={classes.staffingGrid}>
            <Paper withBorder radius="lg" p={{ base: "md", sm: "lg" }}>
              <Stack gap="sm">
                <Title order={3} size="h4">
                  Default administrators
                </Title>
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
                <Title order={3} size="h4">
                  Regions and coordinators
                </Title>
                {draft.regions.map((region) => {
                  const option = detail.regions.find(
                    (candidate) => candidate.id === region.regionId,
                  );
                  return (
                    <Stack
                      key={region.regionId}
                      gap="xs"
                      className={classes.regionEntry}
                    >
                      <Group justify="space-between">
                        <div>
                          <Text fw={700}>
                            {option?.name ?? region.regionId}
                          </Text>
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
          </div>
        </Stack>
      ) : null}
    </Stack>
  );
}
