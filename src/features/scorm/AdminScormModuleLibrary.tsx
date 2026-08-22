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
import { useState } from "react";
import { ConfirmationDialog } from "#/features/shared/ConfirmationDialog";
import {
  isScormVerificationPending,
  type AdminScormPackageSummary,
  type AdminScormPackageVersionSummary,
} from "#/features/scorm/scorm-package.schema";
import classes from "./admin-scorm.module.css";
import { CourseVersionUsageList } from "#/features/admin-course/CourseVersionUsageList";

interface AdminScormModuleLibraryProps {
  packages: Array<AdminScormPackageSummary>;
  onChanged: () => Promise<void>;
}

interface ScormVersionItemProps {
  removing: boolean;
  showStatus: boolean;
  version: AdminScormPackageVersionSummary;
  onRemove: () => void;
}

const statusDetails: Record<
  AdminScormPackageVersionSummary["status"],
  { color: string; label: string }
> = {
  quarantined: { color: "indigo", label: "Verifying" },
  processing: { color: "indigo", label: "Verifying" },
  ready: { color: "teal", label: "Published" },
  rejected: { color: "red", label: "Rejected" },
};

function fileSize(bytes: number | null): string {
  return bytes === null
    ? "Unknown size"
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ScormVersionStatus({
  removing,
  version,
}: Pick<ScormVersionItemProps, "removing" | "version">) {
  const status = statusDetails[version.status];
  const verificationPending = isScormVerificationPending(version.status);
  return (
    <Badge color={removing ? "indigo" : status.color} aria-live="polite">
      {verificationPending || removing ? (
        <span
          className={classes.verifyingSpinner}
          aria-hidden="true"
          data-testid={removing ? "removal-spinner" : "verification-spinner"}
        />
      ) : null}
      {removing ? "Removing" : status.label} v{version.version}
    </Badge>
  );
}

function ScormVersionItem({
  removing,
  showStatus,
  version,
  onRemove,
}: ScormVersionItemProps) {
  const verificationPending = isScormVerificationPending(version.status);
  const removable =
    !verificationPending &&
    version.courseUsageCount === 0 &&
    version.attemptCount === 0;
  return (
    <li className={classes.versionItem}>
      <div>
        <Text c="dimmed" size="sm" mt={4}>
          {fileSize(version.sourceBytes)} · {version.attemptCount} learner
          attempt
          {version.attemptCount === 1 ? "" : "s"}
        </Text>
        <CourseVersionUsageList usages={version.courseUsages} />
        {version.failureCode ? (
          <Text c="red.7" size="sm" mt={4}>
            Validation code: {version.failureCode}
          </Text>
        ) : null}
      </div>
      {showStatus || (removable && !removing) ? (
        <Stack gap="xs" className={classes.versionActions}>
          {showStatus ? (
            <ScormVersionStatus removing={removing} version={version} />
          ) : null}
          {removable && !removing ? (
            <Button
              color="red"
              variant="subtle"
              size="xs"
              loading={removing}
              onClick={onRemove}
            >
              Remove version
            </Button>
          ) : null}
        </Stack>
      ) : null}
    </li>
  );
}

export function AdminScormModuleLibrary({
  packages,
  onChanged,
}: AdminScormModuleLibraryProps) {
  const [removingVersionId, setRemovingVersionId] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [removalTarget, setRemovalTarget] =
    useState<AdminScormPackageVersionSummary>();
  const [removalError, setRemovalError] = useState<string>();

  async function refreshLibrary(): Promise<void> {
    setRefreshing(true);
    try {
      await onChanged();
    } finally {
      setRefreshing(false);
    }
  }

  async function removeVersion(
    version: AdminScormPackageVersionSummary,
  ): Promise<void> {
    setRemovingVersionId(version.id);
    setRemovalError(undefined);
    try {
      const search = new URLSearchParams({ packageVersionId: version.id });
      const response = await fetch(`/api/admin/scorm-packages?${search}`, {
        method: "DELETE",
      });
      if (response.status === 401) {
        window.location.assign(
          `/login?redirect=${encodeURIComponent(window.location.pathname)}`,
        );
        return;
      }
      if (!response.ok) {
        setRemovalError(
          response.status === 409
            ? "This version is now in use or is still being verified."
            : response.status === 404
              ? "This module version has already been removed."
              : "The module version could not be removed.",
        );
        if (response.status === 404) await onChanged();
        return;
      }
      try {
        await onChanged();
      } catch {
        setRemovalError("Refresh the library to finish updating this view.");
      }
    } catch {
      setRemovalError(
        "The module version could not be removed. Please try again.",
      );
    } finally {
      setRemovingVersionId(undefined);
    }
  }

  return (
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
          <Button
            variant="light"
            loading={refreshing}
            onClick={() => void refreshLibrary()}
          >
            Refresh status
          </Button>
        </Group>
        {removalError ? (
          <Alert color="red" title="Module library status">
            {removalError}
          </Alert>
        ) : null}
        {packages.length === 0 ? (
          <Paper withBorder radius="lg" p="xl">
            <Title order={3}>No modules uploaded</Title>
          </Paper>
        ) : (
          <div className={classes.moduleLibrary}>
            {packages.map((item) => {
              const latestVersion = item.versions[0];
              return (
                <Paper
                  component="article"
                  withBorder
                  radius="lg"
                  p="md"
                  key={item.id}
                >
                  <Stack gap="sm">
                    <Group
                      className={classes.moduleHeader}
                      justify="space-between"
                      align="start"
                      wrap="nowrap"
                    >
                      <Title order={3} className={classes.moduleTitle}>
                        {item.title}
                      </Title>
                      {latestVersion ? (
                        <ScormVersionStatus
                          version={latestVersion}
                          removing={removingVersionId === latestVersion.id}
                        />
                      ) : null}
                    </Group>
                    <ol className={classes.versionList}>
                      {item.versions.map((version, index) => (
                        <ScormVersionItem
                          key={version.id}
                          version={version}
                          showStatus={index > 0}
                          removing={removingVersionId === version.id}
                          onRemove={() => {
                            setRemovalTarget(version);
                          }}
                        />
                      ))}
                    </ol>
                  </Stack>
                </Paper>
              );
            })}
          </div>
        )}
        {removalTarget ? (
          <ConfirmationDialog
            title="Remove SCORM version?"
            description={`Version ${String(removalTarget.version)} and its stored files will be permanently removed. This cannot be undone.`}
            confirmLabel="Remove version"
            onCancel={() => {
              setRemovalTarget(undefined);
            }}
            onConfirm={() => {
              const version = removalTarget;
              setRemovalTarget(undefined);
              void removeVersion(version);
            }}
          />
        ) : null}
      </Stack>
    </section>
  );
}
