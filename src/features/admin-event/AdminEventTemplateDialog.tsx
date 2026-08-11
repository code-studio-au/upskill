import { Alert, Button, Group, Stack } from "@mantine/core";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { AppDialog } from "#/features/shared/AppDialog";
import { MantineCheckbox } from "#/features/shared/MantineCheckbox";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { firstFormError } from "#/features/shared/form-errors";
import { adminEventTemplateCreateSchema } from "./admin-event.schema";
import { createAdminEventTemplate } from "#/server/functions/admin-event";

export function AdminEventTemplateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: {
      title: "",
      slug: "",
      summary: "",
      description: "",
      sessionTitle: "Main session",
      sessionDurationMinutes: 60,
      hasCompletionCertificate: false,
    },
    validators: { onSubmit: adminEventTemplateCreateSchema },
    onSubmit: async ({ value }) => {
      const parsed = adminEventTemplateCreateSchema.safeParse(value);
      if (!parsed.success) return;
      setError(null);
      const result = await createAdminEventTemplate({ data: parsed.data });
      if (result.status !== "ready") {
        setError(
          result.status === "conflict"
            ? "That event URL slug is already in use."
            : "The event template could not be created.",
        );
        return;
      }
      await onCreated();
    },
  });

  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <AppDialog
          title="Create event template"
          closeDisabled={isSubmitting}
          onClose={onClose}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <Stack gap="md">
              {error ? <Alert color="red">{error}</Alert> : null}
              <form.Field name="title">
                {(field) => (
                  <MantineTextInput
                    label="Template title"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      field.handleChange(value);
                      form.setFieldValue(
                        "slug",
                        value
                          .toLocaleLowerCase("en-AU")
                          .replace(/[^a-z0-9]+/g, "-")
                          .replace(/^-|-$/g, ""),
                      );
                    }}
                    error={firstFormError(field.state.meta.errors)}
                    required
                  />
                )}
              </form.Field>
              <form.Field name="slug">
                {(field) => (
                  <MantineTextInput
                    label="URL slug"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.currentTarget.value);
                    }}
                    error={firstFormError(field.state.meta.errors)}
                    required
                  />
                )}
              </form.Field>
              <form.Field name="summary">
                {(field) => (
                  <MantineTextInput
                    label="Summary"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.currentTarget.value);
                    }}
                    error={firstFormError(field.state.meta.errors)}
                    required
                  />
                )}
              </form.Field>
              <form.Field name="description">
                {(field) => (
                  <MantineTextInput
                    component="textarea"
                    label="Description"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.currentTarget.value);
                    }}
                    error={firstFormError(field.state.meta.errors)}
                    required
                  />
                )}
              </form.Field>
              <Group grow align="start">
                <form.Field name="sessionTitle">
                  {(field) => (
                    <MantineTextInput
                      label="Default session title"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => {
                        field.handleChange(event.currentTarget.value);
                      }}
                      error={firstFormError(field.state.meta.errors)}
                      required
                    />
                  )}
                </form.Field>
                <form.Field name="sessionDurationMinutes">
                  {(field) => (
                    <MantineTextInput
                      type="number"
                      label="Duration (minutes)"
                      min={15}
                      value={String(field.state.value)}
                      onBlur={field.handleBlur}
                      onChange={(event) => {
                        field.handleChange(Number(event.currentTarget.value));
                      }}
                      error={firstFormError(field.state.meta.errors)}
                      required
                    />
                  )}
                </form.Field>
              </Group>
              <form.Field name="hasCompletionCertificate">
                {(field) => (
                  <MantineCheckbox
                    checked={field.state.value}
                    label="Offer a completion certificate"
                    onChange={field.handleChange}
                  />
                )}
              </form.Field>
              <Group justify="end">
                <Button
                  type="button"
                  variant="default"
                  disabled={isSubmitting}
                  onClick={onClose}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={isSubmitting}>
                  Create template
                </Button>
              </Group>
            </Stack>
          </form>
        </AppDialog>
      )}
    </form.Subscribe>
  );
}
