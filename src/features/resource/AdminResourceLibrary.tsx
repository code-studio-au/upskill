import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { useState, type SyntheticEvent } from "react";
import { ConfirmationDialog } from "#/features/shared/ConfirmationDialog";
import { MantineFilePicker } from "#/features/shared/MantineFilePicker";
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

interface UploadErrors {
  description?: string;
  document?: string;
  title?: string;
}

function clearError(errors: UploadErrors, field: keyof UploadErrors) {
  return Object.fromEntries(
    Object.entries(errors).filter(([key]) => key !== field),
  ) as UploadErrors;
}

function fileSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ResourceUpload({ resources, onChanged }: AdminResourceLibraryProps) {
  const [resourceId, setResourceId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [document, setDocument] = useState<File | null>(null);
  const [errors, setErrors] = useState<UploadErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string>();
  const selected = resources.find((resource) => resource.id === resourceId);

  async function upload(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = adminResourceUploadFormSchema.safeParse({
      title,
      description,
      document,
    });
    if (!parsed.success) {
      const next: UploadErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (
          (field === "title" ||
            field === "description" ||
            field === "document") &&
          !next[field]
        )
          next[field] = issue.message;
      }
      setErrors(next);
      return;
    }
    setSubmitting(true);
    setErrors({});
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
      setDocument(null);
      setDescription("");
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
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Paper withBorder radius="lg" p={{ base: "lg", sm: "xl" }}>
      <form noValidate onSubmit={(event) => void upload(event)}>
        <Stack gap="md">
          <Title order={2} size="h3">
            Upload PDF resource
          </Title>
          <div className={classes.uploadGrid}>
            <MantineNativeSelect
              label="Upload as"
              value={selected?.id ?? ""}
              onChange={(event) => {
                const next = resources.find(
                  (resource) => resource.id === event.currentTarget.value,
                );
                setResourceId(next?.id ?? "");
                setTitle(next?.title ?? "");
                setErrors((current) => clearError(current, "title"));
              }}
              data={[
                { value: "", label: "New resource" },
                ...resources.map((resource) => ({
                  value: resource.id,
                  label: `New version of ${resource.title}`,
                })),
              ]}
            />
            <TextInput
              label="Resource title"
              value={title}
              disabled={Boolean(selected)}
              required
              maxLength={200}
              error={errors.title}
              onChange={(event) => {
                setTitle(event.currentTarget.value);
                setErrors((current) => clearError(current, "title"));
              }}
            />
            <TextInput
              label="Version description"
              description="Optional notes about this document version."
              value={description}
              maxLength={2_000}
              error={errors.description}
              onChange={(event) => {
                setDescription(event.currentTarget.value);
                setErrors((current) => clearError(current, "description"));
              }}
            />
            <MantineFilePicker
              label="PDF document"
              placeholder="Choose a PDF"
              description="Maximum 25 MB. Documents remain private."
              accept=".pdf,application/pdf"
              required
              value={document}
              error={errors.document}
              disabled={submitting}
              onChange={(file) => {
                setDocument(file);
                setErrors((current) => clearError(current, "document"));
              }}
            />
          </div>
          {notice ? (
            <Alert color={notice.includes("could not") ? "red" : "green"}>
              {notice}
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button type="submit" loading={submitting}>
              Upload resource
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}

export function AdminResourceLibrary(props: AdminResourceLibraryProps) {
  const [removingId, setRemovingId] = useState<string>();
  const [target, setTarget] = useState<AdminResourceVersionSummary>();
  const [error, setError] = useState<string>();

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
    <Stack gap="xl">
      <ResourceUpload {...props} />
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
              {props.resources.map((resource) => (
                <Paper
                  component="article"
                  withBorder
                  radius="lg"
                  p="lg"
                  key={resource.id}
                >
                  <Stack gap="md">
                    <Title order={3}>{resource.title}</Title>
                    <ol className={classes.versionList}>
                      {resource.versions.map((version) => (
                        <li className={classes.versionItem} key={version.id}>
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
                            <Text c="dimmed" size="sm" mt={4}>
                              Used by {version.courseUsageCount} course version
                              {version.courseUsageCount === 1 ? "" : "s"}
                            </Text>
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
                        </li>
                      ))}
                    </ol>
                  </Stack>
                </Paper>
              ))}
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
