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
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import {
  adminScormUploadAcceptedSchema,
  SCORM_MAX_ARCHIVE_BYTES,
  type AdminScormPackageVersionSummary,
} from "#/features/scorm/scorm-package.schema";
import { getAdminScormPackages } from "#/server/functions/admin-scorm";
import classes from "./admin.module.css";

const monthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const statusDetails: Record<
  AdminScormPackageVersionSummary["status"],
  { color: string; label: string }
> = {
  quarantined: { color: "indigo", label: "Verifying" },
  processing: { color: "indigo", label: "Verifying" },
  ready: { color: "teal", label: "Ready" },
  rejected: { color: "red", label: "Rejected" },
};

function fileSize(bytes: number | null): string {
  if (bytes === null) return "Unknown size";
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes < 0.1 ? megabytes.toFixed(2) : megabytes.toFixed(1)} MB`;
}

function utcDateTime(value: string): string {
  const date = new Date(value);
  const month = monthNames[date.getUTCMonth()];
  if (!month) return "Unknown date";
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${String(date.getUTCDate())} ${month} ${String(date.getUTCFullYear())}, ${hours}:${minutes} UTC`;
}

function uploadErrorMessage(status: number, error: string): string {
  if (status === 413) return "The ZIP exceeds the 250 MB upload limit.";
  if (status === 401) return "Your session has expired. Sign in again.";
  if (status === 403) return "This account cannot upload SCORM modules.";
  if (error === "invalid_content_type") return "Select a SCORM ZIP file.";
  return "The module could not be uploaded. Nothing was added to the library.";
}

function isVerificationPending(
  status: AdminScormPackageVersionSummary["status"],
): boolean {
  return status === "quarantined" || status === "processing";
}

export const Route = createFileRoute("/admin/modules")({
  ssr: false,
  loader: async () => {
    const result = await getAdminScormPackages();
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: { redirect: "/admin/modules" },
      });
    return result;
  },
  component: AdminModulesPage,
});

function AdminModulesPage() {
  const result = Route.useLoaderData();
  const router = useRouter();
  const [packageId, setPackageId] = useState("");
  const [title, setTitle] = useState("");
  const archiveInput = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<
    { color: "green" | "red"; message: string } | undefined
  >();
  const packages = result.status === "ready" ? result.data : [];
  const hasPendingVerification = packages.some((item) =>
    item.versions.some((version) => isVerificationPending(version.status)),
  );

  useEffect(() => {
    if (!hasPendingVerification) return;
    let refreshing = false;
    const timer = window.setInterval(() => {
      if (refreshing) return;
      refreshing = true;
      void router.invalidate().finally(() => {
        refreshing = false;
      });
    }, 1_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [hasPendingVerification, router]);

  if (result.status === "forbidden") return <AdminAccessDenied />;

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
      if (packageId) search.set("packageId", packageId);
      const response = await fetch(
        `/api/admin/scorm-packages?${search.toString()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/zip" },
          body: archive,
        },
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
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
      const accepted = adminScormUploadAcceptedSchema.safeParse(payload);
      if (!accepted.success) throw new Error("Invalid upload response");
      setNotice({
        color: "green",
        message: `Version ${String(accepted.data.version)} was quarantined and queued for validation.`,
      });
      if (archiveInput.current) archiveInput.current.value = "";
      await router.invalidate();
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
    <Stack gap="xl">
      <div className={classes.heading}>
        <Text c="indigo.7" fw={700}>
          Learning content
        </Text>
        <Title order={1}>SCORM modules</Title>
        <Text c="dimmed" mt="xs">
          Upload a Rise 360 SCORM 1.2 ZIP. New versions preserve existing
          learner history and become available for future course versions only.
        </Text>
      </div>

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
                  value={packageId}
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
                disabled={Boolean(packageId)}
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

      <section aria-labelledby="module-library-heading">
        <Stack gap="md">
          <Group justify="space-between" align="end">
            <div>
              <Title order={2} id="module-library-heading">
                Module library
              </Title>
              <Text c="dimmed" size="sm">
                {packages.length} module{packages.length === 1 ? "" : "s"}
              </Text>
            </div>
            <Button variant="light" onClick={() => void router.invalidate()}>
              Refresh status
            </Button>
          </Group>
          {packages.length === 0 ? (
            <Paper withBorder radius="lg" p="xl">
              <Title order={3}>No modules uploaded</Title>
              <Text c="dimmed" mt="xs">
                Upload the first Rise 360 package to create the module library.
              </Text>
            </Paper>
          ) : (
            <div className={classes.moduleLibrary}>
              {packages.map((item) => (
                <Paper
                  component="article"
                  withBorder
                  radius="lg"
                  p="lg"
                  key={item.id}
                >
                  <Stack gap="md">
                    <div>
                      <Title order={3}>{item.title}</Title>
                      <Text c="dimmed" size="xs">
                        Created {utcDateTime(item.createdAt)}
                      </Text>
                    </div>
                    <ol className={classes.versionList}>
                      {item.versions.map((version) => {
                        const status = statusDetails[version.status];
                        const verificationPending = isVerificationPending(
                          version.status,
                        );
                        return (
                          <li key={version.id} className={classes.versionItem}>
                            <div>
                              <Group gap="xs">
                                <Text fw={700}>Version {version.version}</Text>
                                <Badge
                                  color={status.color}
                                  variant="outline"
                                  aria-live="polite"
                                  className={classes.statusBadge}
                                  data-status={version.status}
                                >
                                  {verificationPending ? (
                                    <span
                                      className={classes.verifyingSpinner}
                                      aria-hidden="true"
                                      data-testid="verification-spinner"
                                    />
                                  ) : null}
                                  {status.label}
                                </Badge>
                              </Group>
                              <Text c="dimmed" size="sm" mt={4}>
                                {fileSize(version.sourceBytes)} · Used by{" "}
                                {version.courseUsageCount} course version
                                {version.courseUsageCount === 1 ? "" : "s"}
                              </Text>
                              {version.failureCode ? (
                                <Text c="red.7" size="sm" mt={4}>
                                  Validation code: {version.failureCode}
                                </Text>
                              ) : null}
                            </div>
                            <Text c="dimmed" size="xs">
                              Uploaded {utcDateTime(version.createdAt)}
                            </Text>
                          </li>
                        );
                      })}
                    </ol>
                  </Stack>
                </Paper>
              ))}
            </div>
          )}
        </Stack>
      </section>
    </Stack>
  );
}
