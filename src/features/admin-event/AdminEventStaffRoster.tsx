import { useForm } from "@tanstack/react-form";
import { useEffect, useState } from "react";
import {
  adminEventStaffEligibilityGrantSchema,
  type AdminEventCoordinatorCoverageImpact,
  type AdminEventStaffEligibilityGrantInput,
  type AdminEventWorkspace,
} from "./admin-event.schema";
import { firstFormError } from "#/features/shared/form-errors";
import { LightweightAutocomplete } from "#/features/shared/LightweightAutocomplete";
import { formatLocalDateTime } from "#/features/shared/local-date";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import {
  Alert,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "#/features/shared/mantine";
import {
  grantAdminEventStaffEligibility,
  revokeAdminEventStaffEligibility,
  searchAdminEventStaffCandidates,
} from "#/server/functions/admin-event";
import classes from "./AdminEventStaffRoster.module.css";

const eligibilityDefaults: AdminEventStaffEligibilityGrantInput = {
  email: "",
  responsibility: "presenter",
  regionId: null,
};

export function AdminEventStaffRoster({
  coordinators,
  presenters,
  regions,
  onChanged,
}: {
  coordinators: AdminEventWorkspace["coordinators"];
  presenters: AdminEventWorkspace["presenters"];
  regions: AdminEventWorkspace["regions"];
  onChanged: () => Promise<void>;
}) {
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coverageImpact, setCoverageImpact] = useState<
    Array<AdminEventCoordinatorCoverageImpact>
  >([]);
  const [emailQuery, setEmailQuery] = useState("");
  const [responsibility, setResponsibility] = useState<
    "presenter" | "coordinator"
  >("presenter");
  const [regionId, setRegionId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<
    Array<{ id: string; name: string; email: string }>
  >([]);
  const [searching, setSearching] = useState(false);
  const form = useForm({
    defaultValues: eligibilityDefaults,
    validators: { onSubmit: adminEventStaffEligibilityGrantSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      setMessage(null);
      const result = await grantAdminEventStaffEligibility({
        data: value,
      });
      if (result.status === "not-found") {
        setError("The user or selected active region could not be found.");
        return;
      }
      if (result.status !== "ready") {
        setError("Staff eligibility could not be added.");
        return;
      }
      setMessage(
        `${value.responsibility === "presenter" ? "Presenter" : "Coordinator"} added to the eligible roster.`,
      );
      form.reset();
      setEmailQuery("");
      setResponsibility("presenter");
      setRegionId(null);
      setSuggestions([]);
      await onChanged();
    },
  });

  useEffect(() => {
    const query = emailQuery.trim();
    if (
      query.length < 2 ||
      (responsibility === "coordinator" && regionId === null)
    )
      return;
    let active = true;
    const timeout = window.setTimeout(() => {
      setSearching(true);
      void searchAdminEventStaffCandidates({
        data: { q: query, responsibility, regionId },
      })
        .then((result) => {
          if (active)
            setSuggestions(result.status === "ready" ? result.data : []);
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [emailQuery, regionId, responsibility]);

  async function revoke(eligibilityId: string) {
    setRevokingId(eligibilityId);
    setError(null);
    setMessage(null);
    setCoverageImpact([]);
    try {
      const result = await revokeAdminEventStaffEligibility({
        data: { eligibilityId },
      });
      if (
        result.status === "conflict" &&
        result.reason === "coordinator_coverage_required"
      ) {
        setCoverageImpact(result.coordinatorCoverage ?? []);
        return;
      }
      if (result.status !== "ready") {
        setError("Staff eligibility could not be removed.");
        return;
      }
      setMessage(
        "Eligibility removed from future selection. Historical assignments remain recorded.",
      );
      await onChanged();
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <Stack gap="lg">
      <Title order={2}>Eligible event staff</Title>
      {message ? (
        <Alert color="green" role="status">
          {message}
        </Alert>
      ) : null}
      {error ? (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      ) : null}
      {coverageImpact.length ? (
        <Alert
          color="red"
          role="alert"
          title="Replacement coordinator required"
        >
          <Stack gap="sm">
            <Text size="sm">
              This person is the only active coordinator for the following
              operational Event Instance regions. Add another eligible
              coordinator to each region before removing this eligibility.
            </Text>
            {coverageImpact.map((impact) => (
              <Paper
                withBorder
                radius="md"
                p="sm"
                key={impact.eventOccurrenceRegionId}
              >
                <Group justify="space-between" align="center" wrap="wrap">
                  <div>
                    <Text fw={700}>{impact.occurrenceTitle}</Text>
                    <Text c="dimmed" size="sm">
                      {impact.regionName} · {impact.regionCode} ·{" "}
                      {formatLocalDateTime(impact.occurrenceStartsAt, {
                        timeZone: impact.occurrenceTimezone,
                      })}
                    </Text>
                  </div>
                  <Button
                    component="a"
                    href={`/admin/events/instances/${encodeURIComponent(impact.eventOccurrenceId)}?view=configuration`}
                    variant="light"
                  >
                    Configure coordinators
                  </Button>
                </Group>
              </Paper>
            ))}
          </Stack>
        </Alert>
      ) : null}
      <Paper withBorder radius="lg" p="md">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <Stack gap="md">
            <div className={classes.formGrid}>
              <form.Field name="email">
                {(field) => (
                  <LightweightAutocomplete
                    className={classes.emailField}
                    label="User email"
                    placeholder="Search by name or email"
                    maxLength={320}
                    options={suggestions.map((suggestion) => ({
                      value: suggestion.email,
                      label: suggestion.name,
                      description: suggestion.email,
                    }))}
                    limit={10}
                    loading={searching}
                    value={field.state.value}
                    error={firstFormError(field.state.meta.errors)}
                    onBlur={() => {
                      field.handleBlur();
                    }}
                    onChange={(value) => {
                      field.handleChange(value);
                      setEmailQuery(value);
                      if (value.trim().length < 2) {
                        setSuggestions([]);
                        setSearching(false);
                      }
                    }}
                  />
                )}
              </form.Field>
              <form.Field name="responsibility">
                {(field) => (
                  <MantineNativeSelect
                    label="Responsibility"
                    value={field.state.value}
                    data={[
                      { value: "presenter", label: "Presenter" },
                      { value: "coordinator", label: "Coordinator" },
                    ]}
                    onBlur={() => {
                      field.handleBlur();
                    }}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      if (value !== "presenter" && value !== "coordinator")
                        return;
                      field.handleChange(value);
                      form.setFieldValue("regionId", null);
                      setResponsibility(value);
                      setRegionId(null);
                      setSuggestions([]);
                      setSearching(false);
                    }}
                  />
                )}
              </form.Field>
              <form.Subscribe selector={(state) => state.values.responsibility}>
                {(responsibility) =>
                  responsibility === "coordinator" ? (
                    <form.Field name="regionId">
                      {(field) => (
                        <MantineNativeSelect
                          label="Region"
                          value={field.state.value ?? ""}
                          error={firstFormError(field.state.meta.errors)}
                          data={[
                            {
                              value: "",
                              label: "Select a region",
                              disabled: true,
                            },
                            ...regions
                              .filter(
                                (region) =>
                                  region.kind === "operational" &&
                                  region.status === "active",
                              )
                              .map((region) => ({
                                value: region.id,
                                label: `${region.parentName ? `${region.parentName} — ` : ""}${region.name} · ${region.code}`,
                              })),
                          ]}
                          onChange={(event) => {
                            const value = event.currentTarget.value || null;
                            field.handleChange(value);
                            setRegionId(value);
                            setSuggestions([]);
                            setSearching(false);
                          }}
                        />
                      )}
                    </form.Field>
                  ) : null
                }
              </form.Subscribe>
              <form.Subscribe
                selector={(state) =>
                  [state.canSubmit, state.isSubmitting] as const
                }
              >
                {([canSubmit, isSubmitting]) => (
                  <Button
                    className={classes.submit}
                    type="submit"
                    loading={isSubmitting}
                    disabled={!canSubmit}
                  >
                    Add eligible staff member
                  </Button>
                )}
              </form.Subscribe>
            </div>
          </Stack>
        </form>
      </Paper>

      <StaffList
        title="Presenters"
        empty="No eligible presenters."
        entries={presenters.map((presenter) => ({
          ...presenter,
          detail: presenter.email,
        }))}
        revokingId={revokingId}
        onRevoke={revoke}
      />
      <StaffList
        title="Regional coordinators"
        empty="No eligible regional coordinators."
        entries={coordinators.map((coordinator) => ({
          ...coordinator,
          detail: `${coordinator.email} · ${coordinator.regionName}`,
        }))}
        revokingId={revokingId}
        onRevoke={revoke}
      />
    </Stack>
  );
}

function StaffList({
  title,
  empty,
  entries,
  revokingId,
  onRevoke,
}: {
  title: string;
  empty: string;
  entries: Array<{
    eligibilityId: string;
    id: string;
    name: string;
    detail: string;
  }>;
  revokingId: string | null;
  onRevoke: (eligibilityId: string) => Promise<void>;
}) {
  return (
    <section>
      <Stack gap="xs">
        <Title order={3}>{title}</Title>
        {entries.length ? (
          entries.map((entry) => (
            <Paper
              component="article"
              withBorder
              radius="md"
              p="md"
              key={entry.eligibilityId}
            >
              <Group justify="space-between" align="center" wrap="wrap">
                <div>
                  <Text fw={700}>{entry.name}</Text>
                  <Text c="dimmed" size="sm">
                    {entry.detail}
                  </Text>
                </div>
                <Button
                  color="red"
                  variant="subtle"
                  loading={revokingId === entry.eligibilityId}
                  onClick={() => void onRevoke(entry.eligibilityId)}
                >
                  Remove eligibility
                </Button>
              </Group>
            </Paper>
          ))
        ) : (
          <Alert>{empty}</Alert>
        )}
      </Stack>
    </section>
  );
}
