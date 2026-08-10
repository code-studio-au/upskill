import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  TextInput,
  Title,
} from "@mantine/core";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { useState, type SyntheticEvent } from "react";
import {
  adminScormUploadFormSchema,
  type AdminScormPackageSummary,
} from "#/features/scorm/scorm-package.schema";
import { MantineFilePicker } from "#/features/shared/MantineFilePicker";
import classes from "./admin-scorm.module.css";

interface AdminScormUploadPanelProps {
  packages: Array<AdminScormPackageSummary>;
  onChanged: () => Promise<void>;
}

interface UploadErrors {
  archive?: string;
  title?: string;
}

function clearUploadError(
  errors: UploadErrors,
  field: keyof UploadErrors,
): UploadErrors {
  if (field === "title")
    return errors.archive ? { archive: errors.archive } : {};
  return errors.title ? { title: errors.title } : {};
}

function uploadErrorMessage(status: number, error: string): string {
  if (status === 413) return "The ZIP exceeds the 250 MB upload limit.";
  if (status === 401) return "Your session has expired. Sign in again.";
  if (status === 403) return "This account cannot upload SCORM modules.";
  if (error === "invalid_content_type") return "Select a SCORM ZIP file.";
  return "The module could not be uploaded. Nothing was added to the library.";
}

export function AdminScormUploadPanel({
  packages,
  onChanged,
}: AdminScormUploadPanelProps) {
  const [packageId, setPackageId] = useState("");
  const [title, setTitle] = useState("");
  const [archive, setArchive] = useState<File | null>(null);
  const [errors, setErrors] = useState<UploadErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<
    { color: "green" | "red"; message: string } | undefined
  >();
  const selectedPackage = packages.find((item) => item.id === packageId);
  const effectivePackageId = selectedPackage?.id ?? "";

  async function upload(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const validation = adminScormUploadFormSchema.safeParse({ title, archive });
    if (!validation.success) {
      const nextErrors: UploadErrors = {};
      for (const issue of validation.error.issues) {
        if (issue.path[0] === "title" && !nextErrors.title)
          nextErrors.title = issue.message;
        if (issue.path[0] === "archive" && !nextErrors.archive)
          nextErrors.archive = issue.message;
      }
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    setNotice(undefined);
    try {
      const search = new URLSearchParams({ title: validation.data.title });
      if (effectivePackageId) search.set("packageId", effectivePackageId);
      const response = await fetch(
        `/api/admin/scorm-packages?${search.toString()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/zip" },
          body: validation.data.archive,
        },
      );
      if (!response.ok) {
        const payload: unknown = await response.json();
        const error =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "upload_failed";
        setNotice({
          color: "red",
          message: uploadErrorMessage(response.status, error),
        });
        return;
      }
      const successMessage =
        "The module was quarantined and queued for validation.";
      setNotice({ color: "green", message: successMessage });
      setArchive(null);
      try {
        await onChanged();
      } catch {
        setNotice({
          color: "green",
          message: `${successMessage} Refresh the library status if it does not appear automatically.`,
        });
      }
    } catch {
      setNotice({
        color: "red",
        message:
          "The upload connection failed. Nothing was added to the library.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Paper withBorder radius="lg" p={{ base: "lg", sm: "xl" }}>
      <form onSubmit={(event) => void upload(event)}>
        <Stack gap="md">
          <Title order={2} size="h3">
            Upload module package
          </Title>
          <div className={classes.uploadGrid}>
            <MantineNativeSelect
              label="Upload as"
              value={effectivePackageId}
              onChange={(event) => {
                const selectedId = event.currentTarget.value;
                setPackageId(selectedId);
                const selected = packages.find(
                  (item) => item.id === selectedId,
                );
                setTitle(selected?.title ?? "");
                setErrors((current) => clearUploadError(current, "title"));
              }}
              data={[
                { value: "", label: "New module" },
                ...packages.map((item) => ({
                  value: item.id,
                  label: `New version of ${item.title}`,
                })),
              ]}
            />
            <TextInput
              label="Module name"
              value={title}
              onChange={(event) => {
                setTitle(event.currentTarget.value);
                setErrors((current) => clearUploadError(current, "title"));
              }}
              maxLength={200}
              withAsterisk
              disabled={Boolean(effectivePackageId)}
              error={errors.title}
            />
            <MantineFilePicker
              label="SCORM ZIP"
              description="Maximum 250 MB. Archives are quarantined before extraction."
              placeholder="Choose a ZIP file"
              value={archive}
              onChange={(value) => {
                setArchive(value);
                setErrors((current) => clearUploadError(current, "archive"));
              }}
              accept=".zip,application/zip"
              required
              error={errors.archive}
            />
          </div>
          {notice ? (
            <Alert color={notice.color} title="Upload status">
              {notice.message}
            </Alert>
          ) : null}
          <Group justify="flex-end">
            <Button type="submit" loading={submitting}>
              Upload and validate
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}
