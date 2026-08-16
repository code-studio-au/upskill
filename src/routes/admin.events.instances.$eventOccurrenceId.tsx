import {
  createFileRoute,
  notFound,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { lazy, Suspense } from "react";
import { AdminAccessDenied } from "#/features/admin/AdminAccessDenied";
import {
  adminEventOccurrenceOperationsParamsSchema,
  type AdminEventOccurrenceOperations,
} from "#/features/admin-event/admin-event-operations.schema";
import { Badge } from "#/features/shared/Badge";
import { AppDialog } from "#/features/shared/AppDialog";
import { ConfirmationDialog } from "#/features/shared/ConfirmationDialog";
import { MantineCheckbox } from "#/features/shared/MantineCheckbox";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { PageTabs } from "#/features/shared/PageTabs";
import { formatLocalDateTime } from "#/features/shared/local-date";
import { LoadingSpinner } from "#/features/shared/LoadingSpinner";
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
  addAdminEventRegistration,
  getAdminEventOccurrenceOperations,
  lockAdminEventRegion,
  recordAdminEventAttendance,
  transitionAdminEventOccurrence,
} from "#/server/functions/admin-event-operations";
import { z } from "#/validation/zod";
import classes from "./admin.events.instances.$eventOccurrenceId.module.css";

const searchSchema = z.object({
  view: z.catch(
    z.enum([
      "overview",
      "registrations",
      "staffing",
      "activity",
      "configuration",
    ]),
    "overview",
  ),
});

const AdminEventRegistrationTable = lazy(async () => {
  const module =
    await import("#/features/admin-event/AdminEventRegistrationTable");
  return { default: module.AdminEventRegistrationTable };
});

const AdminEventOccurrenceEditor = lazy(async () => {
  const module =
    await import("#/features/admin-event/AdminEventOccurrenceEditor");
  return { default: module.AdminEventOccurrenceEditor };
});

const AdminEventActivityTable = lazy(async () => {
  const module = await import("#/features/admin-event/AdminEventActivityTable");
  return { default: module.AdminEventActivityTable };
});

export const Route = createFileRoute(
  "/admin/events/instances/$eventOccurrenceId",
)({
  validateSearch: searchSchema,
  ssr: false,
  loader: async ({ params }) => {
    const parsed = adminEventOccurrenceOperationsParamsSchema.safeParse(params);
    if (!parsed.success) throw notFound();
    const result = await getAdminEventOccurrenceOperations({
      data: parsed.data,
    });
    if (result.status === "unauthenticated")
      throw redirect({
        to: "/login",
        search: {
          redirect: `/admin/events/instances/${encodeURIComponent(parsed.data.eventOccurrenceId)}`,
        },
      });
    if (result.status === "not-found") throw notFound();
    return result;
  },
  component: EventInstanceOperationsPage,
});

function EventInstanceOperationsPage() {
  const result = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [lifecycleTarget, setLifecycleTarget] = useState<
    "cancelled" | "completed" | "archived" | null
  >(null);
  const [priorities, setPriorities] = useState<Record<string, string>>({});
  const action = useCallback(
    async (
      id: string,
      operation: () => Promise<{ status: string; reason?: string }>,
    ) => {
      setProcessingId(id);
      setError(null);
      try {
        const outcome = await operation();
        if (outcome.status !== "ready") {
          const messages: Record<string, string> = {
            region_locked:
              "This regional list is locked and can no longer be changed.",
            capacity_full:
              "No places remain. Waitlist or remove another confirmed participant first.",
            invalid_transition:
              "That decision is not available from the current registration state.",
            final_decision_locked:
              "This registration has attendance evidence, so its final decision can no longer be changed here.",
            domain_override_required:
              "This learner does not match the restricted domains. Confirm the explicit override to continue.",
            duplicate_registration:
              "This learner already has a registration for this event.",
            registration_unavailable:
              "Registrations cannot be added to this event in its current state.",
          };
          setError(
            messages[outcome.reason ?? ""] ??
              "The event operation could not be completed.",
          );
          return;
        }
        await router.invalidate();
      } finally {
        setProcessingId(null);
      }
    },
    [router],
  );
  if (result.status === "forbidden") return <AdminAccessDenied />;
  const workspace = result.data;
  const registrationMutationsAvailable =
    workspace.occurrence.status === "published";

  if (search.view === "configuration")
    return (
      <Suspense fallback={<LoadingSpinner label="Loading event editor" />}>
        <AdminEventOccurrenceEditor
          publishedVersions={[
            {
              eventTemplateId: workspace.occurrence.eventTemplateId,
              eventTemplateVersionId:
                workspace.occurrence.eventTemplateVersionId,
              title: workspace.occurrence.templateTitle,
              version: workspace.occurrence.templateVersion,
            },
          ]}
          occurrence={{
            ...workspace.occurrence,
            eventTemplateTitle: workspace.occurrence.templateTitle,
            templateVersion: workspace.occurrence.templateVersion,
            registrationOpensAt: workspace.occurrence.registrationOpensAt ?? "",
            registrationClosesAt:
              workspace.occurrence.registrationClosesAt ?? "",
            coordinatorLockAt: workspace.occurrence.coordinatorLockAt ?? "",
            localRegistrationOpensAt:
              workspace.occurrence.localRegistrationOpensAt ?? "",
            localRegistrationClosesAt:
              workspace.occurrence.localRegistrationClosesAt ?? "",
            localCoordinatorLockAt:
              workspace.occurrence.localCoordinatorLockAt ?? "",
          }}
          regionalCoverage={{
            availableRegions: workspace.availableRegions,
            availableCoordinators: workspace.availableCoordinators,
            availableUsers: workspace.availableUsers,
            currentRegions: workspace.regions.map((region) => ({
              regionId: region.regionId,
              name: region.name,
              code: region.code,
              coordinatorIds: region.coordinators.map(
                (coordinator) => coordinator.id,
              ),
              selectedCount: region.selectedCount,
              affectedActiveCount: region.affectedActiveCount,
            })),
          }}
          onCancel={() => {
            void navigate({ search: { view: "overview" }, replace: true });
          }}
          onSaved={async () => {
            await router.invalidate();
            await navigate({ search: { view: "overview" }, replace: true });
          }}
        />
      </Suspense>
    );

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="end" wrap="wrap">
        <div>
          <Text c="indigo.7" fw={700}>
            Event instance
          </Text>
          <Title order={1}>{workspace.occurrence.title}</Title>
          <Text c="dimmed" mt="xs">
            {workspace.occurrence.templateTitle} · Version{" "}
            {workspace.occurrence.templateVersion}
          </Text>
        </div>
        <Group gap="sm">
          {workspace.occurrence.status === "draft" ||
          registrationMutationsAvailable ? (
            <Button
              variant="light"
              onClick={() => {
                void navigate({
                  search: { view: "configuration" },
                });
              }}
            >
              Edit schedule & policy
            </Button>
          ) : null}
          {registrationMutationsAvailable &&
          workspace.occurrence.registrationMode !== "open_entry" ? (
            <Button
              onClick={() => {
                setAddOpen(true);
              }}
            >
              Add learner
            </Button>
          ) : null}
        </Group>
      </Group>

      {error ? <Alert color="red">{error}</Alert> : null}

      <div className={classes.metrics}>
        {[
          ["Registrations", workspace.metrics.total],
          ["Awaiting review", workspace.metrics.submitted],
          ["Candidates", workspace.metrics.candidates],
          ["Places remaining", workspace.metrics.remainingCapacity],
        ].map(([label, value]) => (
          <Paper withBorder radius="lg" p="md" key={label}>
            <Text c="dimmed" size="sm">
              {label}
            </Text>
            <Text className={classes.metricValue}>{value}</Text>
          </Paper>
        ))}
      </div>

      <PageTabs
        label="Event instance workspace"
        value={search.view}
        tabs={[
          { value: "overview", label: "Overview" },
          {
            value: "registrations",
            label: `Registrations (${String(workspace.metrics.total)})`,
          },
          { value: "staffing", label: "Sessions & staff" },
          { value: "activity", label: "Activity" },
        ]}
        onChange={(view) => void navigate({ search: { view } })}
      />

      {search.view === "overview" ? (
        <Stack gap="lg">
          <div className={classes.cards}>
            <Paper withBorder radius="lg" p="md">
              <Stack gap="sm">
                <Title order={2}>Schedule</Title>
                <Text>
                  {formatLocalDateTime(workspace.occurrence.startsAt, {
                    timeZone: workspace.occurrence.timezone,
                  })}
                </Text>
                <Text c="dimmed">
                  to{" "}
                  {formatLocalDateTime(workspace.occurrence.endsAt, {
                    timeZone: workspace.occurrence.timezone,
                  })}
                </Text>
                <Text size="sm">{workspace.occurrence.timezone}</Text>
              </Stack>
            </Paper>
            <Paper withBorder radius="lg" p="md">
              <Stack gap="sm">
                <Title order={2}>Registration policy</Title>
                <Text>
                  {workspace.occurrence.registrationMode.replaceAll("_", " ")}
                </Text>
                <Text c="dimmed">
                  {workspace.occurrence.approvalMode} approval · capacity{" "}
                  {workspace.occurrence.confirmedCount}/
                  {workspace.occurrence.capacity}
                </Text>
                {workspace.occurrence.registrationClosesAt ? (
                  <Text size="sm">
                    Closes{" "}
                    {formatLocalDateTime(
                      workspace.occurrence.registrationClosesAt,
                      { timeZone: workspace.occurrence.timezone },
                    )}
                  </Text>
                ) : null}
              </Stack>
            </Paper>
            {workspace.regions.map((region) => (
              <Paper withBorder radius="lg" p="md" key={region.id}>
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Title order={3}>{region.name}</Title>
                    <Badge
                      color={region.effectivelyLocked ? "gray" : "blue"}
                      variant="light"
                    >
                      {region.effectivelyLocked ? "Locked" : "Review open"}
                    </Badge>
                  </Group>
                  <Text size="sm">
                    {region.registrationCount} registrations
                  </Text>
                  <Text c="dimmed" size="sm">
                    {region.coordinators
                      .map((person) => person.name)
                      .join(", ") || "No coordinators assigned"}
                  </Text>
                  {registrationMutationsAvailable &&
                  !region.effectivelyLocked ? (
                    <Button
                      variant="light"
                      loading={processingId === `lock-${region.id}`}
                      onClick={() =>
                        void action(`lock-${region.id}`, () =>
                          lockAdminEventRegion({
                            data: {
                              eventOccurrenceId: workspace.occurrence.id,
                              eventOccurrenceRegionId: region.id,
                            },
                          }),
                        )
                      }
                    >
                      Lock regional list
                    </Button>
                  ) : null}
                </Stack>
              </Paper>
            ))}
          </div>
          <Paper withBorder radius="lg" p="md">
            <Stack gap="sm">
              <Title order={2}>Instance lifecycle</Title>
              <Text c="dimmed" size="sm">
                Complete delivery, cancel the event for every active
                participant, or archive a finished instance from active
                operations.
              </Text>
              <Group gap="sm">
                {workspace.occurrence.status === "published" ? (
                  <>
                    <Button
                      variant="light"
                      onClick={() => {
                        setLifecycleTarget("completed");
                      }}
                    >
                      Mark completed
                    </Button>
                    <Button
                      variant="subtle"
                      color="red"
                      onClick={() => {
                        setLifecycleTarget("cancelled");
                      }}
                    >
                      Cancel instance
                    </Button>
                  </>
                ) : null}
                {workspace.occurrence.status === "completed" ||
                workspace.occurrence.status === "cancelled" ? (
                  <Button
                    variant="light"
                    onClick={() => {
                      setLifecycleTarget("archived");
                    }}
                  >
                    Archive instance
                  </Button>
                ) : null}
              </Group>
            </Stack>
          </Paper>
          {workspace.reschedules.length ? (
            <Paper withBorder radius="lg" p="md">
              <Stack gap="xs">
                <Title order={2}>Reschedule history</Title>
                {workspace.reschedules.map((reschedule) => (
                  <Text size="sm" key={reschedule.id}>
                    {formatLocalDateTime(reschedule.createdAt, {
                      timeZone: workspace.occurrence.timezone,
                    })}
                    : {reschedule.registrationWindowPolicy.replaceAll("_", " ")}{" "}
                    ·{" "}
                    {formatLocalDateTime(reschedule.previousStartsAt, {
                      timeZone: workspace.occurrence.timezone,
                    })}{" "}
                    →{" "}
                    {formatLocalDateTime(reschedule.nextStartsAt, {
                      timeZone: workspace.occurrence.timezone,
                    })}{" "}
                    · {reschedule.actorName} · {reschedule.regionCount} regions
                    · {reschedule.coordinatorCount} coordinators
                  </Text>
                ))}
              </Stack>
            </Paper>
          ) : null}
        </Stack>
      ) : null}

      {search.view === "registrations" ? (
        workspace.registrations.length ? (
          <Suspense fallback={<LoadingSpinner label="Loading registrations" />}>
            <AdminEventRegistrationTable
              workspace={workspace}
              priorities={priorities}
              processingId={processingId}
              mutationsAvailable={registrationMutationsAvailable}
              setPriorities={setPriorities}
              action={action}
            />
          </Suspense>
        ) : (
          <Alert title="No registrations">
            Learner registrations will appear here for regional review and final
            selection.
          </Alert>
        )
      ) : null}

      {search.view === "staffing" ? (
        <div className={classes.cards}>
          <Paper withBorder radius="lg" p="md">
            <Stack gap="sm">
              <Title order={2}>Instance administrators</Title>
              {workspace.administrators.map((person) => (
                <div key={person.id}>
                  <Text fw={600}>{person.name}</Text>
                  <Text c="dimmed" size="sm">
                    {person.email}
                  </Text>
                </div>
              ))}
            </Stack>
          </Paper>
          {workspace.sessions.map((session) => (
            <Paper withBorder radius="lg" p="md" key={session.id}>
              <Stack gap="md">
                <Title order={3}>{session.title}</Title>
                <Text size="sm">
                  {formatLocalDateTime(session.startsAt, {
                    timeZone: workspace.occurrence.timezone,
                  })}
                </Text>
                <Text c="dimmed" size="sm">
                  Presenters:{" "}
                  {session.presenters.map((person) => person.name).join(", ") ||
                    "None assigned"}
                </Text>
                {session.attendance.length ? (
                  <Stack gap="sm">
                    <Text fw={700}>Attendance</Text>
                    {session.attendance.map((participant) => (
                      <Group
                        key={participant.eventParticipationId}
                        justify="space-between"
                        align="end"
                        wrap="wrap"
                      >
                        <div>
                          <Text fw={600}>{participant.name}</Text>
                          <Text c="dimmed" size="sm">
                            {participant.email}
                          </Text>
                        </div>
                        <MantineNativeSelect
                          aria-label={`Attendance for ${participant.name}`}
                          value={participant.state}
                          disabled={
                            processingId ===
                            `attendance-${session.id}-${participant.eventParticipationId}`
                          }
                          data={[
                            { value: "not_recorded", label: "Not recorded" },
                            { value: "checked_in", label: "Checked in" },
                            { value: "attended", label: "Attended" },
                            { value: "absent", label: "Absent" },
                          ]}
                          onChange={(event) => {
                            const state = event.currentTarget.value as
                              | "not_recorded"
                              | "checked_in"
                              | "attended"
                              | "absent";
                            void action(
                              `attendance-${session.id}-${participant.eventParticipationId}`,
                              () =>
                                recordAdminEventAttendance({
                                  data: {
                                    eventOccurrenceId: workspace.occurrence.id,
                                    eventSessionId: session.id,
                                    eventParticipationId:
                                      participant.eventParticipationId,
                                    state,
                                  },
                                }),
                            );
                          }}
                        />
                      </Group>
                    ))}
                  </Stack>
                ) : (
                  <Alert title="No confirmed participants">
                    Attendance becomes available after a learner is confirmed.
                  </Alert>
                )}
              </Stack>
            </Paper>
          ))}
        </div>
      ) : null}

      {search.view === "activity" ? (
        workspace.activity.length ? (
          <Suspense fallback={<LoadingSpinner label="Loading activity" />}>
            <AdminEventActivityTable
              activity={workspace.activity}
              timezone={workspace.occurrence.timezone}
            />
          </Suspense>
        ) : (
          <Alert title="No activity yet">
            Registration decisions will appear here as a retained operational
            history.
          </Alert>
        )
      ) : null}

      {addOpen ? (
        <AddLearnerDialog
          workspace={workspace}
          processing={processingId === "add-learner"}
          onClose={() => {
            setAddOpen(false);
          }}
          onAdd={(data) =>
            action("add-learner", async () => {
              const outcome = await addAdminEventRegistration({
                data: { eventOccurrenceId: workspace.occurrence.id, ...data },
              });
              if (outcome.status === "ready") setAddOpen(false);
              return outcome;
            })
          }
        />
      ) : null}
      {lifecycleTarget ? (
        <ConfirmationDialog
          title={`${lifecycleTarget === "cancelled" ? "Cancel" : lifecycleTarget === "completed" ? "Complete" : "Archive"} event instance?`}
          description={
            lifecycleTarget === "cancelled"
              ? "All active registrations will be retained as cancelled and confirmed capacity will be released."
              : lifecycleTarget === "completed"
                ? "The instance will move out of active delivery while participant and attendance history remains available."
                : "The finished instance will be removed from active operations while all history remains retained."
          }
          confirmLabel={
            lifecycleTarget === "cancelled"
              ? "Cancel instance"
              : lifecycleTarget === "completed"
                ? "Mark completed"
                : "Archive instance"
          }
          confirmColor={lifecycleTarget === "cancelled" ? "red" : "blue"}
          pending={processingId === "lifecycle"}
          onCancel={() => {
            setLifecycleTarget(null);
          }}
          onConfirm={() => {
            void action("lifecycle", async () => {
              const outcome = await transitionAdminEventOccurrence({
                data: {
                  eventOccurrenceId: workspace.occurrence.id,
                  target: lifecycleTarget,
                },
              });
              if (outcome.status === "ready") setLifecycleTarget(null);
              return outcome;
            });
          }}
        />
      ) : null}
    </Stack>
  );
}

function AddLearnerDialog({
  workspace,
  processing,
  onClose,
  onAdd,
}: {
  workspace: AdminEventOccurrenceOperations;
  processing: boolean;
  onClose: () => void;
  onAdd: (data: {
    userId: string;
    eventOccurrenceRegionId: string | null;
    overrideDomainRestriction: boolean;
  }) => Promise<void>;
}) {
  const [userId, setUserId] = useState("");
  const [regionId, setRegionId] = useState("");
  const [override, setOverride] = useState(false);
  return (
    <AppDialog title="Add learner to event" onClose={onClose}>
      <Stack gap="md">
        <MantineNativeSelect
          label="Learner"
          required
          value={userId}
          data={[
            { value: "", label: "Select a learner", disabled: true },
            ...workspace.availableUsers.map((user) => ({
              value: user.id,
              label: `${user.name} — ${user.email}`,
            })),
          ]}
          onChange={(event) => {
            setUserId(event.currentTarget.value);
          }}
        />
        {workspace.regions.length ? (
          <MantineNativeSelect
            label="Region"
            required
            value={regionId}
            data={[
              { value: "", label: "Select a region", disabled: true },
              ...workspace.regions.map((region) => ({
                value: region.id,
                label: region.name,
              })),
            ]}
            onChange={(event) => {
              setRegionId(event.currentTarget.value);
            }}
          />
        ) : null}
        {workspace.occurrence.registrationMode === "required_restricted" ? (
          <MantineCheckbox
            label="Override the email-domain restriction for this learner"
            checked={override}
            onChange={setOverride}
          />
        ) : null}
        <Group justify="end">
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={processing}
            disabled={!userId || (workspace.regions.length > 0 && !regionId)}
            onClick={() =>
              void onAdd({
                userId,
                eventOccurrenceRegionId: regionId || null,
                overrideDomainRestriction: override,
              })
            }
          >
            Add registration
          </Button>
        </Group>
      </Stack>
    </AppDialog>
  );
}
