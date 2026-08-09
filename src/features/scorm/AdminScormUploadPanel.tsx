import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useRef, useState, type SyntheticEvent } from "react";
import {
  SCORM_MAX_ARCHIVE_BYTES,
  type AdminScormPackageSummary,
} from "#/features/scorm/scorm-package.schema";
import classes from "./admin-scorm.module.css";

interface AdminScormUploadPanelProps {
  packages: Array<AdminScormPackageSummary>;
  onChanged: () => Promise<void>;
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
  const archiveInput = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<
    { color: "green" | "red"; message: string } | undefined
  >();
  const selectedPackage = packages.find((item) => item.id === packageId);
  const effectivePackageId = selectedPackage?.id ?? "";

  async function upload(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const archive = archiveInput.current?.files?.[0];
    if (!archive) {
      setNotice({ color: "red", message: "Choose a SCORM ZIP to upload." });
      return;
    }
    if (archive.size < 1 || archive.size > SCORM_MAX_ARCHIVE_BYTES) {
      setNotice({
        color: "red",
        message: "The ZIP must contain data and be no larger than 250 MB.",
      });
      return;
    }
    if (!archive.name.toLowerCase().endsWith(".zip")) {
      setNotice({ color: "red", message: "Choose a file ending in .zip." });
      return;
    }
    setSubmitting(true);
    setNotice(undefined);
    try {
      const search = new URLSearchParams({ title: title.trim() });
      if (effectivePackageId) search.set("packageId", effectivePackageId);
      const response = await fetch(
        `/api/admin/scorm-packages?${search.toString()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/zip" },
          body: archive,
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
      if (archiveInput.current) archiveInput.current.value = "";
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
            <div>
              <label className={classes.fieldLabel} htmlFor="package-version">
                Upload as
              </label>
              <select
                className={classes.nativeField}
                id="package-version"
                value={effectivePackageId}
                onChange={(event) => {
                  const selectedId = event.currentTarget.value;
                  setPackageId(selectedId);
                  const selected = packages.find(
                    (item) => item.id === selectedId,
                  );
                  setTitle(selected?.title ?? "");
                }}
              >
                <option value="">New module</option>
                {packages.map((item) => (
                  <option key={item.id} value={item.id}>
                    New version of {item.title}
                  </option>
                ))}
              </select>
            </div>
            <TextInput
              label="Module name"
              value={title}
              onChange={(event) => {
                setTitle(event.currentTarget.value);
              }}
              maxLength={200}
              required
              disabled={Boolean(effectivePackageId)}
            />
            <div>
              <label className={classes.fieldLabel} htmlFor="scorm-archive">
                SCORM ZIP
              </label>
              <input
                className={classes.nativeField}
                id="scorm-archive"
                ref={archiveInput}
                type="file"
                accept=".zip,application/zip"
                required
              />
              <Text c="dimmed" size="xs" mt={4}>
                Maximum 250 MB. Archives are quarantined before extraction.
              </Text>
            </div>
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
