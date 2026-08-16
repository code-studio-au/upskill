import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import { Badge } from "#/features/shared/Badge";
import { useForm } from "@tanstack/react-form";
import {
  lazy,
  Suspense,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { MantineCheckbox } from "#/features/shared/MantineCheckbox";
import { MantineTextInput } from "#/features/shared/MantineTextInput";
import { firstFormError } from "#/features/shared/form-errors";
import { createFriendlySlug } from "#/features/shared/friendly-slug";
import { EventLocalDateTimeInput } from "./EventLocalDateTimeInput";
import { createEventTimezoneOptions } from "./event-timezones";
import { EventTimezoneAutocomplete } from "./EventTimezoneAutocomplete";
import {
  adminEventOccurrenceFormSchema,
  type AdminEventOccurrenceFormInput,
  type AdminEventOccurrenceRegionalCoverageInput,
  type AdminEventOccurrenceRegionalCoverageOptions,
  type AdminEventWorkspace,
} from "./admin-event.schema";
import {
  createAdminEventOccurrence,
  rescheduleAdminEventOccurrence,
  updateAdminEventOccurrence,
} from "#/server/functions/admin-event";
import classes from "./AdminEventOccurrenceEditor.module.css";

const AdminEventRegionalCoverageEditor = lazy(async () => {
  const module = await import("./AdminEventRegionalCoverageEditor");
  return { default: module.AdminEventRegionalCoverageEditor };
});

const defaultTimezone =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "Australia/Sydney";

function initialSchedule() {
  const futureInstant = new Date();
  futureInstant.setDate(futureInstant.getDate() + 7);
  const part = (value: number) => String(value).padStart(2, "0");
  const localDate = `${String(futureInstant.getFullYear())}-${part(futureInstant.getMonth() + 1)}-${part(futureInstant.getDate())}`;
  return {
    startsAt: `${localDate}T09:00`,
    endsAt: `${localDate}T10:00`,
  };
}

function EditorSection({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <Paper withBorder radius="lg" p={{ base: "md", sm: "lg" }}>
      <Stack gap="lg">
        <div className={classes.sectionHeader}>
          <span className={classes.sectionNumber} aria-hidden="true">
            {number}
          </span>
          <Title order={2}>{title}</Title>
        </div>
        {children}
      </Stack>
    </Paper>
  );
}

export function AdminEventOccurrenceEditor({
  publishedVersions,
  occurrence,
  regionalCoverage,
  onCancel,
  onSaved,
}: {
  publishedVersions: AdminEventWorkspace["publishedVersions"];
  occurrence?: AdminEventWorkspace["occurrences"][number];
  regionalCoverage?: AdminEventOccurrenceRegionalCoverageOptions;
  onCancel: () => void;
  onSaved: (eventOccurrenceId: string) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [registrationWindowPolicy, setRegistrationWindowPolicy] = useState<
    "keep" | "replace_future" | "reopen"
  >("keep");
  const [regionsConfirmed, setRegionsConfirmed] = useState(false);
  const [regionalCoverageInput, setRegionalCoverageInput] =
    useState<AdminEventOccurrenceRegionalCoverageInput>({
      regions:
        regionalCoverage?.currentRegions.map((region) => ({
          regionId: region.regionId,
          coordinatorIds: region.coordinatorIds,
        })) ?? [],
      retirements: [],
    });
  const schedule = initialSchedule();
  const initialTime = (value: string) => value.slice(0, 16);
  const defaultValues: AdminEventOccurrenceFormInput = occurrence
    ? {
        eventTemplateVersionId: occurrence.eventTemplateVersionId,
        title: occurrence.title,
        slug: occurrence.slug,
        deliveryMode: occurrence.deliveryMode,
        registrationMode: occurrence.registrationMode,
        approvalMode: occurrence.approvalMode,
        timezone: occurrence.timezone,
        startsAt: initialTime(occurrence.localStartsAt),
        endsAt: initialTime(occurrence.localEndsAt),
        registrationOpensAt: initialTime(occurrence.localRegistrationOpensAt),
        registrationClosesAt: initialTime(occurrence.localRegistrationClosesAt),
        coordinatorLockAt: initialTime(occurrence.localCoordinatorLockAt),
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
  const isPublished = occurrence?.status === "published";
  const pageTitle = isPublished
    ? "Reschedule event"
    : occurrence
      ? "Edit event"
      : "Schedule new event";
  const submitLabel = isPublished
    ? "Confirm reschedule"
    : occurrence
      ? "Save changes"
      : "Create draft event";
  const timezoneOptions = useMemo(
    () => createEventTimezoneOptions(occurrence?.timezone ?? defaultTimezone),
    [occurrence?.timezone],
  );
  const form = useForm({
    defaultValues,
    validators: { onSubmit: adminEventOccurrenceFormSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      if (
        occurrence?.status === "published" &&
        (!regionsConfirmed || !regionalCoverage)
      ) {
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
                occurrence: value,
                registrationWindowPolicy,
                regionsConfirmed: true,
                regionalCoverage: regionalCoverageInput,
              },
            })
          : await updateAdminEventOccurrence({
              data: {
                eventOccurrenceId: occurrence.id,
                occurrence: value,
              },
            })
        : await createAdminEventOccurrence({ data: value });
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
      if (result.data.eventOccurrenceId)
        await onSaved(result.data.eventOccurrenceId);
    },
  });

  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Stack gap="lg" className={classes.editor}>
          <div className={classes.pageHeader}>
            <div className={classes.headerCopy}>
              <Button
                variant="subtle"
                px={0}
                disabled={isSubmitting}
                onClick={onCancel}
              >
                Back to scheduled events
              </Button>
              <Text c="indigo.7" fw={700}>
                Events
              </Text>
              <Group gap="sm" align="center">
                <Title order={1}>{pageTitle}</Title>
                <Badge color={isPublished ? "green" : "gray"} variant="light">
                  {isPublished ? "Published" : "Draft"}
                </Badge>
              </Group>
            </div>
          </div>

          <form
            className={classes.form}
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            {error ? (
              <Alert color="red" role="alert">
                {error}
              </Alert>
            ) : null}

            <EditorSection number={1} title="Template and event details">
              <div className={classes.detailsGrid}>
                <div className={classes.fullWidth}>
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
                </div>
                <form.Field name="title">
                  {(field) => (
                    <MantineTextInput
                      label="Event title"
                      placeholder="For example, Clinical workshop · Sydney"
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
              </div>
            </EditorSection>

            <EditorSection number={2} title="Dates and capacity">
              <div className={classes.dateCapacityGrid}>
                <div className={classes.dateRangeGrid}>
                  <form.Field name="startsAt">
                    {(field) => (
                      <EventLocalDateTimeInput
                        label="Starts"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(value) => {
                          field.handleChange(value);
                        }}
                        error={firstFormError(field.state.meta.errors)}
                        required
                      />
                    )}
                  </form.Field>
                  <form.Field name="endsAt">
                    {(field) => (
                      <EventLocalDateTimeInput
                        label="Ends"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(value) => {
                          field.handleChange(value);
                        }}
                        error={firstFormError(field.state.meta.errors)}
                        required
                      />
                    )}
                  </form.Field>
                </div>
                <div className={classes.scheduleSettings}>
                  <form.Field name="timezone">
                    {(field) => (
                      <EventTimezoneAutocomplete
                        options={timezoneOptions}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={field.handleChange}
                        error={firstFormError(field.state.meta.errors)}
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
              </div>
            </EditorSection>

            <EditorSection number={3} title="Delivery">
              <div className={classes.deliveryGrid}>
                <form.Field name="deliveryMode">
                  {(field) => (
                    <MantineNativeSelect
                      label="Delivery method"
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
                <form.Subscribe selector={(state) => state.values.deliveryMode}>
                  {(deliveryMode) =>
                    deliveryMode === "in_person" ? (
                      <div className={classes.locationFields}>
                        <form.Field name="venueName">
                          {(field) => (
                            <MantineTextInput
                              label="Venue name"
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
                      </div>
                    ) : (
                      <div className={classes.deliveryDetails}>
                        <form.Field name="virtualJoinUrl">
                          {(field) => (
                            <MantineTextInput
                              label="Protected virtual meeting URL"
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
                    )
                  }
                </form.Subscribe>
              </div>
            </EditorSection>

            <EditorSection number={4} title="Registration">
              <Stack gap="lg">
                <div className={classes.twoColumnGrid}>
                  <form.Field name="registrationMode">
                    {(field) => (
                      <MantineNativeSelect
                        label="Registration access"
                        data={[
                          { value: "open_entry", label: "Open entry" },
                          {
                            value: "required_unrestricted",
                            label: "Registration required · unrestricted",
                          },
                          {
                            value: "required_restricted",
                            label: "Registration required · restricted",
                          },
                        ]}
                        value={field.state.value}
                        disabled={isPublished}
                        onBlur={field.handleBlur}
                        onChange={(event) => {
                          const value = event.currentTarget
                            .value as typeof field.state.value;
                          field.handleChange(value);
                          if (value !== "required_restricted")
                            form.setFieldValue("domains", "");
                          if (value === "open_entry") {
                            form.setFieldValue("approvalMode", "automatic");
                            form.setFieldValue("registrationOpensAt", "");
                            form.setFieldValue("registrationClosesAt", "");
                            form.setFieldValue("coordinatorLockAt", "");
                          }
                        }}
                        error={firstFormError(field.state.meta.errors)}
                        required
                      />
                    )}
                  </form.Field>
                  <form.Subscribe
                    selector={(state) => state.values.registrationMode}
                  >
                    {(registrationMode) =>
                      registrationMode === "open_entry" ? null : (
                        <form.Field name="approvalMode">
                          {(field) => (
                            <MantineNativeSelect
                              label="Registration approval"
                              data={[
                                { value: "automatic", label: "Automatic" },
                                { value: "manual", label: "Manual" },
                              ]}
                              value={field.state.value}
                              disabled={isPublished}
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
                      )
                    }
                  </form.Subscribe>
                </div>
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
                {occurrence?.status === "published" ? (
                  <Stack gap="md" className={classes.reschedulePolicy}>
                    <Text fw={700}>Reschedule policy</Text>
                    <form.Subscribe
                      selector={(state) => state.values.registrationMode}
                    >
                      {(registrationMode) =>
                        registrationMode === "open_entry" ? null : (
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
                                label:
                                  "Reopen registration with new review rounds",
                              },
                            ]}
                            onChange={(event) => {
                              setRegistrationWindowPolicy(
                                event.currentTarget
                                  .value as typeof registrationWindowPolicy,
                              );
                            }}
                          />
                        )
                      }
                    </form.Subscribe>
                    {regionalCoverage ? (
                      <Suspense
                        fallback={<Text size="sm">Loading regions…</Text>}
                      >
                        <AdminEventRegionalCoverageEditor
                          options={regionalCoverage}
                          value={regionalCoverageInput}
                          onChange={(value) => {
                            setRegionalCoverageInput(value);
                            setRegionsConfirmed(false);
                          }}
                        />
                      </Suspense>
                    ) : (
                      <Alert color="red">
                        Regional coverage could not be loaded. Close this dialog
                        and reopen the event instance.
                      </Alert>
                    )}
                    <MantineCheckbox
                      checked={regionsConfirmed}
                      onChange={setRegionsConfirmed}
                      label="I have reviewed the active regions and confirmed that each still has coordinator coverage"
                    />
                  </Stack>
                ) : null}
                <form.Subscribe
                  selector={(state) => state.values.registrationMode}
                >
                  {(registrationMode) =>
                    registrationMode === "open_entry" ? null : (
                      <div className={classes.registrationTimeline}>
                        <Text fw={700}>Registration timetable</Text>
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
                                <EventLocalDateTimeInput
                                  label={label}
                                  value={field.state.value}
                                  disabled={
                                    isPublished &&
                                    registrationWindowPolicy === "keep"
                                  }
                                  onBlur={field.handleBlur}
                                  onChange={(value) => {
                                    field.handleChange(value);
                                  }}
                                  error={firstFormError(
                                    field.state.meta.errors,
                                  )}
                                />
                              )}
                            </form.Field>
                          ))}
                        </div>
                      </div>
                    )
                  }
                </form.Subscribe>
              </Stack>
            </EditorSection>

            <div className={classes.actionBar}>
              <Group gap="sm" className={classes.actions}>
                <Button
                  type="button"
                  variant="default"
                  disabled={isSubmitting}
                  onClick={onCancel}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={isSubmitting}>
                  {submitLabel}
                </Button>
              </Group>
            </div>
          </form>
        </Stack>
      )}
    </form.Subscribe>
  );
}
