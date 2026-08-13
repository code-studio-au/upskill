import { Alert, Button, Group, Stack, Text } from "#/features/shared/mantine";
import { useForm } from "@tanstack/react-form";
import { useRef, useState } from "react";
import { AppDialog } from "#/features/shared/AppDialog";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { MantineCheckbox } from "#/features/shared/MantineCheckbox";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { firstFormError } from "#/features/shared/form-errors";
import { formatDateTimeLocalInput } from "#/features/shared/local-date";
import { createFriendlySlug } from "#/features/shared/friendly-slug";
import {
  adminEventOccurrenceFormSchema,
  type AdminEventOccurrenceFormInput,
  type AdminEventWorkspace,
} from "./admin-event.schema";
import {
  createAdminEventOccurrence,
  rescheduleAdminEventOccurrence,
  updateAdminEventOccurrence,
} from "#/server/functions/admin-event";
import classes from "./AdminEventOccurrenceDialog.module.css";

const defaultTimezone =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "Australia/Sydney";

function initialSchedule() {
  const futureInstant = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const part = (value: number) => String(value).padStart(2, "0");
  const localDate = `${String(futureInstant.getFullYear())}-${part(futureInstant.getMonth() + 1)}-${part(futureInstant.getDate())}`;
  return {
    startsAt: `${localDate}T09:00`,
    endsAt: `${localDate}T10:00`,
  };
}

export function AdminEventOccurrenceDialog({
  publishedVersions,
  occurrence,
  onClose,
  onSaved,
}: {
  publishedVersions: AdminEventWorkspace["publishedVersions"];
  occurrence?: AdminEventWorkspace["occurrences"][number];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [registrationWindowPolicy, setRegistrationWindowPolicy] = useState<
    "keep" | "replace_future" | "reopen"
  >("keep");
  const [regionsConfirmed, setRegionsConfirmed] = useState(false);
  const schedule = initialSchedule();
  const initialTime = (value: string) =>
    value ? formatDateTimeLocalInput(value, occurrence?.timezone ?? "UTC") : "";
  const defaultValues: AdminEventOccurrenceFormInput = occurrence
    ? {
        eventTemplateVersionId: occurrence.eventTemplateVersionId,
        title: occurrence.title,
        slug: occurrence.slug,
        deliveryMode: occurrence.deliveryMode,
        registrationMode: occurrence.registrationMode,
        approvalMode: occurrence.approvalMode,
        timezone: occurrence.timezone,
        startsAt: initialTime(occurrence.startsAt),
        endsAt: initialTime(occurrence.endsAt),
        registrationOpensAt: initialTime(occurrence.registrationOpensAt),
        registrationClosesAt: initialTime(occurrence.registrationClosesAt),
        coordinatorLockAt: initialTime(occurrence.coordinatorLockAt),
        capacity: occurrence.capacity,
        venueName: occurrence.venueName,
        venueAddress: occurrence.venueAddress,
        virtualJoinUrl: occurrence.virtualJoinUrl,
        domains: occurrence.domains,
      }
    : {
        eventTemplateVersionId:
          publishedVersions[0]?.eventTemplateVersionId ?? "",
        title: "",
        slug: "",
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
  const autoSlug = useRef(!occurrence);
  const form = useForm({
    defaultValues,
    validators: { onSubmit: adminEventOccurrenceFormSchema },
    onSubmit: async ({ value }) => {
      const parsed = adminEventOccurrenceFormSchema.safeParse(value);
      if (!parsed.success) return;
      setError(null);
      if (occurrence?.status === "published" && !regionsConfirmed) {
        setError(
          "Review and confirm the event's active regional coverage before rescheduling.",
        );
        return;
      }
      const result = occurrence
        ? occurrence.status === "published"
          ? await rescheduleAdminEventOccurrence({
              data: {
                eventOccurrenceId: occurrence.id,
                occurrence: parsed.data,
                registrationWindowPolicy,
                regionsConfirmed: true,
              },
            })
          : await updateAdminEventOccurrence({
              data: {
                eventOccurrenceId: occurrence.id,
                occurrence: parsed.data,
              },
            })
        : await createAdminEventOccurrence({ data: parsed.data });
      if (result.status !== "ready") {
        setError(
          result.status === "conflict" && result.reason === "slug_in_use"
            ? "That friendly URL is already used by another event instance. Choose a unique value."
            : result.status === "conflict" &&
                result.reason === "registration_window_policy_invalid"
              ? "The selected registration-window policy is not valid for the current deadlines and review state."
              : result.status === "conflict" &&
                  result.reason === "regions_not_confirmed"
                ? "Regional coverage changed or is incomplete. Review and confirm every active region before rescheduling."
                : result.status === "conflict"
                  ? "The occurrence could not be saved with this configuration."
                  : "The occurrence could not be saved.",
        );
        return;
      }
      await onSaved();
    },
  });

  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <AppDialog
          title={
            occurrence?.status === "published"
              ? "Reschedule event occurrence"
              : occurrence
                ? "Edit event occurrence"
                : "Schedule event occurrence"
          }
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
                {occurrence
                  ? occurrence.status === "published"
                    ? "Reschedule this published instance without rewriting its prior registration decisions or locked review rounds."
                    : "Update this event instance without changing its pinned template version."
                  : "The occurrence will stay draft until its schedule, owners, presenters and registration policy pass publication checks."}
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
                    disabled={Boolean(occurrence)}
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
                      const value = event.currentTarget.value;
                      field.handleChange(value);
                      if (autoSlug.current)
                        form.setFieldValue("slug", createFriendlySlug(value));
                    }}
                    error={firstFormError(field.state.meta.errors)}
                    required
                  />
                )}
              </form.Field>
              <form.Field name="slug">
                {(field) => (
                  <MantineTextInput
                    label="Friendly URL"
                    description="Used in the public event URL. It must be unique."
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      autoSlug.current = false;
                      field.handleChange(event.currentTarget.value);
                    }}
                    error={firstFormError(field.state.meta.errors)}
                    required
                  />
                )}
              </form.Field>
              <div className={classes.threeColumnGrid}>
                <form.Field name="deliveryMode">
                  {(field) => (
                    <MantineNativeSelect
                      label="Delivery"
                      data={[
                        { value: "in_person", label: "In person" },
                        { value: "virtual", label: "Virtual" },
                      ]}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => {
                        const value = event.currentTarget
                          .value as typeof field.state.value;
                        field.handleChange(value);
                        if (value === "in_person")
                          form.setFieldValue("virtualJoinUrl", "");
                        else {
                          form.setFieldValue("venueName", "");
                          form.setFieldValue("venueAddress", "");
                        }
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
                      disabled={occurrence?.status === "published"}
                      onBlur={field.handleBlur}
                      onChange={(event) => {
                        const value = event.currentTarget
                          .value as typeof field.state.value;
                        field.handleChange(value);
                        if (value !== "required_restricted")
                          form.setFieldValue("domains", "");
                        if (value === "open_entry")
                          form.setFieldValue("approvalMode", "automatic");
                      }}
                      error={firstFormError(field.state.meta.errors)}
                      required
                    />
                  )}
                </form.Field>
                <form.Subscribe
                  selector={(state) => state.values.registrationMode}
                >
                  {(registrationMode) => (
                    <form.Field name="approvalMode">
                      {(field) => (
                        <MantineNativeSelect
                          label="Approval"
                          data={[
                            { value: "automatic", label: "Automatic" },
                            { value: "manual", label: "Manual" },
                          ]}
                          value={field.state.value}
                          disabled={
                            registrationMode === "open_entry" ||
                            occurrence?.status === "published"
                          }
                          onBlur={field.handleBlur}
                          onChange={(event) => {
                            field.handleChange(
                              event.currentTarget
                                .value as typeof field.state.value,
                            );
                          }}
                          error={firstFormError(field.state.meta.errors)}
                          required
                        />
                      )}
                    </form.Field>
                  )}
                </form.Subscribe>
              </div>
              <div className={classes.twoColumnGrid}>
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
              </div>
              <div className={classes.twoColumnGrid}>
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
              </div>
              <form.Subscribe selector={(state) => state.values.deliveryMode}>
                {(deliveryMode) =>
                  deliveryMode === "in_person" ? (
                    <>
                      <form.Field name="venueName">
                        {(field) => (
                          <MantineTextInput
                            label="Venue name"
                            description="Required for in-person delivery."
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
                    </>
                  ) : (
                    <form.Field name="virtualJoinUrl">
                      {(field) => (
                        <MantineTextInput
                          label="Protected virtual meeting URL"
                          description="Required for virtual delivery; never shown publicly."
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
                  )
                }
              </form.Subscribe>
              <form.Subscribe
                selector={(state) => state.values.registrationMode}
              >
                {(registrationMode) =>
                  registrationMode === "required_restricted" ? (
                    <form.Field name="domains">
                      {(field) => (
                        <MantineTextInput
                          component="textarea"
                          label="Permitted email domains"
                          description="Separate domains with commas or new lines."
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
                  ) : null
                }
              </form.Subscribe>
              <Text fw={700} size="sm">
                Registration timetable
              </Text>
              {occurrence?.status === "published" ? (
                <Stack gap="sm">
                  <MantineNativeSelect
                    label="Registration-window policy"
                    value={registrationWindowPolicy}
                    data={[
                      {
                        value: "keep",
                        label: "Keep existing registration deadlines",
                      },
                      {
                        value: "replace_future",
                        label: "Replace still-future deadlines",
                      },
                      {
                        value: "reopen",
                        label: "Reopen registration with new review rounds",
                      },
                    ]}
                    onChange={(event) => {
                      setRegistrationWindowPolicy(
                        event.currentTarget
                          .value as typeof registrationWindowPolicy,
                      );
                    }}
                  />
                  <Text size="xs" c="dimmed">
                    Moving the event dates never reopens registration by itself.
                  </Text>
                  <MantineCheckbox
                    checked={regionsConfirmed}
                    onChange={setRegionsConfirmed}
                    label="I have reviewed the active regions and confirmed that each still has coordinator coverage"
                  />
                </Stack>
              ) : null}
              <div className={classes.scheduleGrid}>
                {(
                  [
                    ["registrationOpensAt", "Registration opens"],
                    ["registrationClosesAt", "Registration closes"],
                    ["coordinatorLockAt", "Coordinator cut-off"],
                  ] as const
                ).map(([name, label]) => (
                  <form.Field name={name} key={name}>
                    {(field) => (
                      <MantineTextInput
                        type="datetime-local"
                        label={label}
                        value={field.state.value}
                        disabled={
                          occurrence?.status === "published" &&
                          registrationWindowPolicy === "keep"
                        }
                        onBlur={field.handleBlur}
                        onChange={(event) => {
                          field.handleChange(event.currentTarget.value);
                        }}
                        error={firstFormError(field.state.meta.errors)}
                      />
                    )}
                  </form.Field>
                ))}
              </div>
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
                  {occurrence?.status === "published"
                    ? "Confirm reschedule"
                    : occurrence
                      ? "Save changes"
                      : "Create draft occurrence"}
                </Button>
              </Group>
            </Stack>
          </form>
        </AppDialog>
      )}
    </form.Subscribe>
  );
}
