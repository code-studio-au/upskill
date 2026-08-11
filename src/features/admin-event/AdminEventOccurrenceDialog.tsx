import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { AppDialog } from "#/features/shared/AppDialog";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { firstFormError } from "#/features/shared/form-errors";
import {
  adminEventOccurrenceFormSchema,
  type AdminEventOccurrenceFormInput,
  type AdminEventWorkspace,
} from "./admin-event.schema";
import { createAdminEventOccurrence } from "#/server/functions/admin-event";

const defaultTimezone = "Australia/Sydney";

function initialSchedule() {
  const futureInstant = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const localDate = futureInstant.toISOString().slice(0, 10);
  return {
    startsAt: `${localDate}T09:00`,
    endsAt: `${localDate}T10:00`,
  };
}

export function AdminEventOccurrenceDialog({
  publishedVersions,
  onClose,
  onCreated,
}: {
  publishedVersions: AdminEventWorkspace["publishedVersions"];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const schedule = initialSchedule();
  const defaultValues: AdminEventOccurrenceFormInput = {
    eventTemplateVersionId: publishedVersions[0]?.eventTemplateVersionId ?? "",
    title: "",
    deliveryMode: "virtual",
    registrationMode: "open_entry",
    approvalMode: "automatic",
    timezone: defaultTimezone,
    startsAt: schedule.startsAt,
    endsAt: schedule.endsAt,
    registrationOpensAt: "",
    registrationClosesAt: "",
    coordinatorLockAt: "",
    capacity: 30,
    venueName: "",
    venueAddress: "",
    virtualJoinUrl: "",
    domains: "",
  };
  const form = useForm({
    defaultValues,
    validators: { onSubmit: adminEventOccurrenceFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = adminEventOccurrenceFormSchema.safeParse(value);
      if (!parsed.success) return;
      setError(null);
      const result = await createAdminEventOccurrence({ data: parsed.data });
      if (result.status !== "ready") {
        setError(
          result.status === "conflict"
            ? "The occurrence could not be created from this template configuration."
            : "The occurrence could not be created.",
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
          title="Schedule event occurrence"
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
              <Text size="sm" c="dimmed">
                The occurrence will stay draft until its schedule, owners,
                presenters and registration policy pass publication checks.
              </Text>
              <form.Field name="eventTemplateVersionId">
                {(field) => (
                  <MantineNativeSelect
                    label="Published event template"
                    data={publishedVersions.map((version) => ({
                      value: version.eventTemplateVersionId,
                      label: `${version.title} · Version ${String(version.version)}`,
                    }))}
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
              <form.Field name="title">
                {(field) => (
                  <MantineTextInput
                    label="Occurrence title"
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
                <form.Field name="deliveryMode">
                  {(field) => (
                    <MantineNativeSelect
                      label="Delivery"
                      data={[
                        { value: "in_person", label: "In person" },
                        { value: "virtual", label: "Virtual" },
                        { value: "hybrid", label: "Hybrid" },
                      ]}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => {
                        field.handleChange(
                          event.currentTarget.value as typeof field.state.value,
                        );
                      }}
                      error={firstFormError(field.state.meta.errors)}
                      required
                    />
                  )}
                </form.Field>
                <form.Field name="registrationMode">
                  {(field) => (
                    <MantineNativeSelect
                      label="Registration"
                      data={[
                        { value: "open_entry", label: "Open entry" },
                        {
                          value: "required_unrestricted",
                          label: "Required · unrestricted",
                        },
                        {
                          value: "required_restricted",
                          label: "Required · restricted",
                        },
                      ]}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => {
                        field.handleChange(
                          event.currentTarget.value as typeof field.state.value,
                        );
                      }}
                      error={firstFormError(field.state.meta.errors)}
                      required
                    />
                  )}
                </form.Field>
                <form.Field name="approvalMode">
                  {(field) => (
                    <MantineNativeSelect
                      label="Approval"
                      data={[
                        { value: "automatic", label: "Automatic" },
                        { value: "manual", label: "Manual" },
                      ]}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => {
                        field.handleChange(
                          event.currentTarget.value as typeof field.state.value,
                        );
                      }}
                      error={firstFormError(field.state.meta.errors)}
                      required
                    />
                  )}
                </form.Field>
              </Group>
              <Group grow align="start">
                <form.Field name="startsAt">
                  {(field) => (
                    <MantineTextInput
                      type="datetime-local"
                      label="Starts"
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
                <form.Field name="endsAt">
                  {(field) => (
                    <MantineTextInput
                      type="datetime-local"
                      label="Ends"
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
              </Group>
              <Group grow align="start">
                <form.Field name="timezone">
                  {(field) => (
                    <MantineTextInput
                      label="IANA timezone"
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
                <form.Field name="capacity">
                  {(field) => (
                    <MantineTextInput
                      type="number"
                      label="Capacity"
                      min={1}
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
              <form.Field name="venueName">
                {(field) => (
                  <MantineTextInput
                    label="Venue name"
                    description="Required for in-person and hybrid delivery."
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.currentTarget.value);
                    }}
                    error={firstFormError(field.state.meta.errors)}
                  />
                )}
              </form.Field>
              <form.Field name="venueAddress">
                {(field) => (
                  <MantineTextInput
                    component="textarea"
                    label="Venue address"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.currentTarget.value);
                    }}
                    error={firstFormError(field.state.meta.errors)}
                  />
                )}
              </form.Field>
              <form.Field name="virtualJoinUrl">
                {(field) => (
                  <MantineTextInput
                    label="Protected virtual meeting URL"
                    description="Required for virtual and hybrid delivery; never shown publicly."
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.currentTarget.value);
                    }}
                    error={firstFormError(field.state.meta.errors)}
                  />
                )}
              </form.Field>
              <form.Field name="domains">
                {(field) => (
                  <MantineTextInput
                    component="textarea"
                    label="Permitted email domains"
                    description="Only for restricted registration; separate domains with commas or new lines."
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      field.handleChange(event.currentTarget.value);
                    }}
                    error={firstFormError(field.state.meta.errors)}
                  />
                )}
              </form.Field>
              <Text fw={700} size="sm">
                Registration timetable
              </Text>
              <Group grow align="start">
                {(
                  [
                    ["registrationOpensAt", "Opens"],
                    ["registrationClosesAt", "Closes"],
                    ["coordinatorLockAt", "Coordinator lock"],
                  ] as const
                ).map(([name, label]) => (
                  <form.Field name={name} key={name}>
                    {(field) => (
                      <MantineTextInput
                        type="datetime-local"
                        label={label}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => {
                          field.handleChange(event.currentTarget.value);
                        }}
                        error={firstFormError(field.state.meta.errors)}
                      />
                    )}
                  </form.Field>
                ))}
              </Group>
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
                  Create draft occurrence
                </Button>
              </Group>
            </Stack>
          </form>
        </AppDialog>
      )}
    </form.Subscribe>
  );
}
