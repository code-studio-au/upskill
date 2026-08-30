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
import { useForm } from "@tanstack/react-form";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { useState } from "react";
import { ConfirmationDialog } from "#/features/shared/ConfirmationDialog";
import { CourseVersionUsageList } from "#/features/admin-course/CourseVersionUsageList";
import { MantineFilePicker } from "#/features/shared/MantineFilePicker";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { firstFormError } from "#/features/shared/form-errors";
import {
  adminResourceUploadFormSchema,
  type AdminResourceSummary,
  type AdminResourceVersionSummary,
} from "./resource.schema";
import classes from "./admin-resource.module.css";

interface AdminResourceLibraryProps {
  resources: Array<AdminResourceSummary>;
  onChanged: () => Promise<void>;
}

function fileSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AdminResourceUpload({
  resources,
  onChanged,
}: AdminResourceLibraryProps) {
  const [resourceId, setResourceId] = useState("");
  const [notice, setNotice] = useState<string>();
  const selected = resources.find((resource) => resource.id === resourceId);
  const uploadForm = useForm({
    defaultValues: {
      title: "",
      description: "",
      document: null as File | null,
    },
    validators: { onSubmit: adminResourceUploadFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = adminResourceUploadFormSchema.safeParse(value);
      if (!parsed.success) return;
      setNotice(undefined);
      try {
        const query = new URLSearchParams({
          title: parsed.data.title,
          description: parsed.data.description,
          displayName: parsed.data.document.name,
        });
        if (selected) query.set("resourceId", selected.id);
        const response = await fetch(`/api/admin/resources?${query}`, {
          method: "POST",
          headers: { "Content-Type": "application/pdf" },
          body: parsed.data.document,
        });
        if (!response.ok) throw new Error("upload_failed");
        uploadForm.setFieldValue("document", null);
        uploadForm.setFieldValue("description", "");
        const success = selected
          ? "New resource version uploaded."
          : "Resource uploaded.";
        setNotice(success);
        try {
          await onChanged();
        } catch {
          setNotice(`${success} Refresh the library to update this view.`);
        }
      } catch {
        setNotice("The PDF could not be uploaded. Try again.");
      }
    },
  });

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void uploadForm.handleSubmit();
      }}
    >
      <Stack gap="md">
        <div className={classes.uploadGrid}>
          <MantineNativeSelect
            label="Upload as"
            value={selected?.id ?? ""}
            onChange={(event) => {
              const next = resources.find(
                (resource) => resource.id === event.currentTarget.value,
              );
              setResourceId(next?.id ?? "");
              uploadForm.setFieldValue("title", next?.title ?? "");
            }}
            data={[
              { value: "", label: "New resource" },
              ...resources.map((resource) => ({
                value: resource.id,
                label: `New version of ${resource.title}`,
              })),
            ]}
          />
          <uploadForm.Field name="title">
            {(field) => (
              <MantineTextInput
                label="Resource title"
                name={field.name}
                value={field.state.value}
                disabled={Boolean(selected)}
                required
                maxLength={200}
                error={firstFormError(field.state.meta.errors)}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  field.handleChange(event.currentTarget.value);
                }}
              />
            )}
          </uploadForm.Field>
          <uploadForm.Field name="description">
            {(field) => (
              <MantineTextInput
                label="Version description"
                name={field.name}
                value={field.state.value}
                maxLength={2_000}
                error={firstFormError(field.state.meta.errors)}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  field.handleChange(event.currentTarget.value);
                }}
              />
            )}
          </uploadForm.Field>
          <uploadForm.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <uploadForm.Field name="document">
                {(field) => (
                  <MantineFilePicker
                    label="PDF document"
                    placeholder="Choose a PDF"
                    accept=".pdf,application/pdf"
                    required
                    value={field.state.value}
                    error={firstFormError(field.state.meta.errors)}
                    disabled={isSubmitting}
                    onChange={field.handleChange}
                  />
                )}
              </uploadForm.Field>
            )}
          </uploadForm.Subscribe>
        </div>
        {notice ? (
          <Alert color={notice.includes("could not") ? "red" : "green"}>
            {notice}
          </Alert>
        ) : null}
        <Group justify="flex-end">
          <uploadForm.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button
                type="submit"
                loading={isSubmitting}
                disabled={isSubmitting}
              >
                Upload resource
              </Button>
            )}
          </uploadForm.Subscribe>
        </Group>
      </Stack>
    </form>
  );
}

export function AdminResourceLibrary(props: AdminResourceLibraryProps) {
  const [removingId, setRemovingId] = useState<string>();
  const [target, setTarget] = useState<AdminResourceVersionSummary>();
  const [error, setError] = useState<string>();
  const [selectedVersions, setSelectedVersions] = useState<
    Record<string, string>
  >({});

  async function remove(version: AdminResourceVersionSummary) {
    setRemovingId(version.id);
    setError(undefined);
    try {
      const search = new URLSearchParams({ resourceVersionId: version.id });
      const response = await fetch(`/api/admin/resources?${search}`, {
        method: "DELETE",
      });
      if (response.status === 401) {
        window.location.assign(
          `/login?redirect=${encodeURIComponent(window.location.pathname)}`,
        );
        return;
      }
      if (!response.ok) {
        setError(
          response.status === 409
            ? "This version is now referenced by a course version."
            : response.status === 404
              ? "This resource version has already been removed."
              : "The resource version could not be removed.",
        );
        if (response.status === 404) await props.onChanged();
        return;
      }
      try {
        await props.onChanged();
      } catch {
        setError("Refresh the library to finish updating this view.");
      }
    } catch {
      setError("The resource version could not be removed. Try again.");
    } finally {
      setRemovingId(undefined);
    }
  }

  return (
    <Stack gap="lg">
      <section aria-labelledby="resource-library-heading">
        <Stack gap="md">
          <div>
            <Title order={2} id="resource-library-heading">
              Resource library
            </Title>
            <Text c="dimmed" size="sm">
              {props.resources.length} resource
              {props.resources.length === 1 ? "" : "s"}
            </Text>
          </div>
          {error ? <Alert color="red">{error}</Alert> : null}
          {props.resources.length === 0 ? (
            <Paper withBorder radius="lg" p="xl">
              <Title order={3}>No resources uploaded</Title>
            </Paper>
          ) : (
            <div className={classes.library}>
              {props.resources.map((resource) => {
                const version =
                  resource.versions.find(
                    (candidate) =>
                      candidate.id === selectedVersions[resource.id],
                  ) ?? resource.versions[0];
                return (
                  <Paper
                    component="article"
                    withBorder
                    radius="lg"
                    p="md"
                    key={resource.id}
                  >
                    <Stack gap="sm">
                      <Title order={3}>{resource.title}</Title>
                      {version ? (
                        <>
                          <MantineNativeSelect
                            label="Resource version"
                            value={version.id}
                            data={resource.versions.map((candidate) => ({
                              value: candidate.id,
                              label: `Version ${String(candidate.version)}`,
                            }))}
                            onChange={(event) => {
                              const nextVersionId = event.currentTarget.value;
                              setSelectedVersions((current) => ({
                                ...current,
                                [resource.id]: nextVersionId,
                              }));
                            }}
                          />
                          <div className={classes.versionItem} key={version.id}>
                            <div>
                              <Group gap="xs">
                                <Text fw={700}>Version {version.version}</Text>
                                <Badge variant="outline">
                                  {fileSize(version.sourceBytes)}
                                </Badge>
                              </Group>
                              <Text size="sm" mt={4}>
                                {version.displayName}
                              </Text>
                              {version.description ? (
                                <Text c="dimmed" size="sm" mt={4}>
                                  {version.description}
                                </Text>
                              ) : null}
                              <CourseVersionUsageList
                                usages={version.courseUsages}
                              />
                            </div>
                            {version.courseUsageCount === 0 ? (
                              <Button
                                color="red"
                                variant="subtle"
                                size="xs"
                                loading={removingId === version.id}
                                onClick={() => {
                                  setTarget(version);
                                }}
                              >
                                Remove version
                              </Button>
                            ) : null}
                          </div>
                        </>
                      ) : null}
                    </Stack>
                  </Paper>
                );
              })}
            </div>
          )}
        </Stack>
      </section>
      {target ? (
        <ConfirmationDialog
          title="Remove resource version?"
          description={`Version ${String(target.version)} and its stored PDF will be permanently removed. This cannot be undone.`}
          confirmLabel="Remove version"
          onCancel={() => {
            setTarget(undefined);
          }}
          onConfirm={() => {
            const version = target;
            setTarget(undefined);
            void remove(version);
          }}
        />
      ) : null}
    </Stack>
  );
}
