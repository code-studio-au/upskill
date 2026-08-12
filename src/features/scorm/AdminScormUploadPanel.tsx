import { Alert, Button, Group, Stack } from "#/features/shared/mantine";
import { useForm } from "@tanstack/react-form";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { useState } from "react";
import {
  adminScormUploadFormSchema,
  type AdminScormPackageSummary,
} from "#/features/scorm/scorm-package.schema";
import { MantineFilePicker } from "#/features/shared/MantineFilePicker";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { firstFormError } from "#/features/shared/form-errors";
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
  const [notice, setNotice] = useState<
    { color: "green" | "red"; message: string } | undefined
  >();
  const selectedPackage = packages.find((item) => item.id === packageId);
  const effectivePackageId = selectedPackage?.id ?? "";
  const uploadForm = useForm({
    defaultValues: { title: "", archive: null as File | null },
    validators: { onSubmit: adminScormUploadFormSchema },
    onSubmit: async ({ value }) => {
      const validation = adminScormUploadFormSchema.safeParse(value);
      if (!validation.success) return;
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
        uploadForm.setFieldValue("archive", null);
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
            value={effectivePackageId}
            onChange={(event) => {
              const selectedId = event.currentTarget.value;
              setPackageId(selectedId);
              const selected = packages.find((item) => item.id === selectedId);
              uploadForm.setFieldValue("title", selected?.title ?? "");
            }}
            data={[
              { value: "", label: "New module" },
              ...packages.map((item) => ({
                value: item.id,
                label: `New version of ${item.title}`,
              })),
            ]}
          />
          <uploadForm.Field name="title">
            {(field) => (
              <MantineTextInput
                label="Module name"
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  field.handleChange(event.currentTarget.value);
                }}
                maxLength={200}
                withAsterisk
                disabled={Boolean(effectivePackageId)}
                error={firstFormError(field.state.meta.errors)}
              />
            )}
          </uploadForm.Field>
          <uploadForm.Field name="archive">
            {(field) => (
              <MantineFilePicker
                label="SCORM ZIP"
                description="Maximum 250 MB. Archives are quarantined before extraction."
                placeholder="Choose a ZIP file"
                value={field.state.value}
                onChange={field.handleChange}
                accept=".zip,application/zip"
                required
                error={firstFormError(field.state.meta.errors)}
              />
            )}
          </uploadForm.Field>
        </div>
        {notice ? (
          <Alert color={notice.color} title="Upload status">
            {notice.message}
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
                Upload and validate
              </Button>
            )}
          </uploadForm.Subscribe>
        </Group>
      </Stack>
    </form>
  );
}
