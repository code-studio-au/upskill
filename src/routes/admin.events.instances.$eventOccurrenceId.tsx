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
import { MantineTextInput } from "#/features/shared/MantineTextInput";
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
  createAdminEventLateInvitation,
  getAdminEventOccurrenceOperations,
  lockAdminEventRegion,
  recordAdminEventAttendance,
  revokeAdminEventLateInvitation,
  rotateAdminEventGuestAccess,
  setAdminEventGuestAttendanceMode,
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
      "communications",
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

const AdminCommunicationPlanEditor = lazy(async () => {
  const module =
    await import("#/features/admin-email/AdminCommunicationPlanEditor");
  return { default: module.AdminCommunicationPlanEditor };
});

function DetailList({
  items,
}: {
  items: Array<readonly [string, string | number] | null>;
}) {
  return (
    <dl className={classes.detailList}>
      {items.map((item) =>
        item ? (
          <div key={item[0]}>
            <dt>{item[0]}</dt>
            <dd>{item[1]}</dd>
          </div>
        ) : null,
      )}
    </dl>
  );
}

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
  const [success, setSuccess] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [lifecycleTarget, setLifecycleTarget] = useState<
    "cancelled" | "completed" | "archived" | null
  >(null);
  const [priorities, setPriorities] = useState<Record<string, string>>({});
  const action = useCallback(
    async (
      id: string,
      operation: () => Promise<{ status: string; reason?: string }>,
      successMessage?: string,
    ) => {
      setProcessingId(id);
      setError(null);
      setSuccess(null);
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
            finalized_reassignment_confirmation_required:
              "Confirm the region change because this registration already has a final decision.",
            locked_destination_reassignment_confirmation_required:
              "Confirm the exceptional move because the destination regional list is locked.",
            region_mismatch_resolved:
              "The learner profile and registration region now match.",
            domain_override_required:
              "This learner does not match the restricted domains. Confirm the explicit override to continue.",
            duplicate_registration:
              "This learner already has a registration for this event.",
            registration_unavailable:
              "Late invitations cannot be sent for this event in its current state.",
            account_already_active:
              "This learner has already completed account setup.",
          };
          setError(
            messages[outcome.reason ?? ""] ??
              "The event operation could not be completed.",
          );
          return;
        }
        await router.invalidate();
        if (successMessage) setSuccess(successMessage);
      } finally {
        setProcessingId(null);
      }
    },
    [router],
  );
  if (result.status === "forbidden") return <AdminAccessDenied />;
  const workspace = result.data;
  const occurrence = workspace.occurrence;
  const registrationMutationsAvailable = occurrence.status === "published";
  const lateInvitationsAvailable = Boolean(
    registrationMutationsAvailable &&
    occurrence.registrationClosesAt &&
    new Date(occurrence.registrationClosesAt) <= new Date() &&
    new Date(occurrence.startsAt) > new Date() &&
    occurrence.registrationMode !== "open_entry" &&
    occurrence.registrationMode !== "paid_entry",
  );
  if (search.view === "configuration")
    return (
      <Suspense fallback={<LoadingSpinner label="Loading event editor" />}>
        <AdminEventOccurrenceEditor
          publishedVersions={[
            {
              eventTemplateId: occurrence.eventTemplateId,
              eventTemplateVersionId: occurrence.eventTemplateVersionId,
              title: occurrence.templateTitle,
              version: occurrence.templateVersion,
            },
          ]}
          occurrence={{
            ...occurrence,
            eventTemplateTitle: occurrence.templateTitle,
            templateVersion: occurrence.templateVersion,
            registrationOpensAt: occurrence.registrationOpensAt ?? "",
            registrationClosesAt: occurrence.registrationClosesAt ?? "",
            coordinatorLockAt: occurrence.coordinatorLockAt ?? "",
            localRegistrationOpensAt: occurrence.localRegistrationOpensAt ?? "",
            localRegistrationClosesAt:
              occurrence.localRegistrationClosesAt ?? "",
            localCoordinatorLockAt: occurrence.localCoordinatorLockAt ?? "",
            regions: workspace.regions.map((region) => region.name).join(", "),
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
      <div className={classes.pageHeader}>
        <div className={classes.headerIdentity}>
          <Text c="indigo.7" fw={700}>
            Scheduled event
          </Text>
          <Group gap="sm" align="center">
            <Title order={1}>{occurrence.title}</Title>
            <Badge
              color={occurrence.status === "cancelled" ? "red" : "blue"}
              variant="light"
            >
              {occurrence.status}
            </Badge>
          </Group>
          <Text c="dimmed" size="sm">
            {formatLocalDateTime(occurrence.startsAt, {
              timeZone: occurrence.timezone,
            })}
            {" · "}
            {occurrence.deliveryMode === "in_person" ? "In person" : "Virtual"}
            {" · "}
            {occurrence.templateTitle} · v{occurrence.templateVersion}
          </Text>
        </div>
        <Group gap="sm" className={classes.headerActions}>
          <a
            href={`/event-operations/${encodeURIComponent(occurrence.id)}?view=progress`}
          >
            Participant progress
          </a>
          {occurrence.status === "draft" || registrationMutationsAvailable ? (
            <Button
              variant="light"
              onClick={() => {
                void navigate({
                  search: { view: "configuration" },
                });
              }}
            >
              Edit event
            </Button>
          ) : null}
          {lateInvitationsAvailable ? (
            <Button
              onClick={() => {
                setAddOpen(true);
              }}
            >
              Invite learner
            </Button>
          ) : null}
        </Group>
      </div>

      {error ? <Alert color="red">{error}</Alert> : null}
      {success ? <Alert color="green">{success}</Alert> : null}

      {search.view === "overview" || search.view === "registrations" ? (
        <Paper withBorder radius="lg" className={classes.metrics}>
          {[
            ["Registrations", workspace.metrics.total],
            ["Awaiting review", workspace.metrics.submitted],
            ["Candidates", workspace.metrics.candidates],
            ["Places remaining", workspace.metrics.remainingCapacity],
          ].map(([label, value]) => (
            <div className={classes.metric} key={label}>
              <Text c="dimmed" size="xs">
                {label}
              </Text>
              <Text className={classes.metricValue}>{value}</Text>
            </div>
          ))}
        </Paper>
      ) : null}

      <PageTabs
        className={classes.workspaceTabs}
        label="Event instance workspace"
        value={search.view}
        tabs={[
          { value: "overview", label: "Overview" },
          {
            value: "registrations",
            label: `Registrations (${String(workspace.metrics.total)})`,
          },
          { value: "staffing", label: "Sessions & attendance" },
          { value: "activity", label: "History" },
          { value: "communications", label: "Communications" },
        ]}
        onChange={(view) => void navigate({ search: { view } })}
      />

      {search.view === "overview" ? (
        <Stack gap="lg">
          <div className={classes.overviewGrid}>
            <Paper withBorder radius="lg" p="md">
              <Stack gap="sm">
                <Title order={2}>Event details</Title>
                <DetailList
                  items={[
                    [
                      "Starts",
                      formatLocalDateTime(occurrence.startsAt, {
                        timeZone: occurrence.timezone,
                      }),
                    ],
                    [
                      "Ends",
                      formatLocalDateTime(occurrence.endsAt, {
                        timeZone: occurrence.timezone,
                      }),
                    ],
                    ["Timezone", occurrence.timezone],
                    [
                      "Delivery",
                      occurrence.deliveryMode === "in_person"
                        ? occurrence.venueName || "In person"
                        : "Virtual",
                    ],
                  ]}
                />
              </Stack>
            </Paper>

            <Paper withBorder radius="lg" p="md">
              <Stack gap="sm">
                <Title order={2}>Registration</Title>
                <DetailList
                  items={[
                    [
                      "Access",
                      occurrence.registrationMode
                        .replaceAll("_", " ")
                        .replace(/^./, (value) => value.toUpperCase()),
                    ],
                    [
                      "Approval",
                      occurrence.approvalMode === "manual"
                        ? "Manual"
                        : "Automatic",
                    ],
                    [
                      "Confirmed",
                      `${String(occurrence.confirmedCount)} of ${String(occurrence.capacity)}`,
                    ],
                    occurrence.registrationClosesAt
                      ? [
                          "Registration closes",
                          formatLocalDateTime(occurrence.registrationClosesAt, {
                            timeZone: occurrence.timezone,
                          }),
                        ]
                      : null,
                  ]}
                />
              </Stack>
            </Paper>

            {workspace.guestAccess ? (
              <Paper
                withBorder
                radius="lg"
                p="md"
                className={classes.fullWidthCard}
              >
                <div className={classes.guestAccessLayout}>
                  <div>
                    <Title order={2}>Guest access</Title>
                    <Text className={classes.guestLink} mt="xs">
                      /event-access/{workspace.guestAccess.publicReference}
                    </Text>
                  </div>
                  <MantineNativeSelect
                    label="Self check-in records"
                    value={occurrence.openEntryAttendanceMode}
                    disabled={processingId === "guest-attendance-mode"}
                    data={[
                      {
                        value: "checked_in",
                        label: "Checked in · staff confirm attendance",
                      },
                      {
                        value: "attended",
                        label: "Attended automatically",
                      },
                    ]}
                    onChange={(event) => {
                      const mode = event.currentTarget.value as
                        "checked_in" | "attended";
                      void action("guest-attendance-mode", () =>
                        setAdminEventGuestAttendanceMode({
                          data: {
                            eventOccurrenceId: occurrence.id,
                            mode,
                          },
                        }),
                      );
                    }}
                  />
                  <Group gap="sm" className={classes.guestActions}>
                    <Button
                      variant="light"
                      onClick={() => {
                        const url = new URL(
                          "/event-access/" +
                            (workspace.guestAccess?.publicReference ?? ""),
                          window.location.origin,
                        ).toString();
                        void navigator.clipboard.writeText(url).then(() => {
                          setSuccess("Guest access link copied.");
                        });
                      }}
                    >
                      Copy link
                    </Button>
                    <Button
                      variant="subtle"
                      loading={processingId === "rotate-guest-access"}
                      onClick={() =>
                        void action(
                          "rotate-guest-access",
                          () =>
                            rotateAdminEventGuestAccess({
                              data: {
                                eventOccurrenceId: occurrence.id,
                              },
                            }),
                          "Guest access link replaced. The previous link no longer works.",
                        )
                      }
                    >
                      Replace link
                    </Button>
                  </Group>
                </div>
              </Paper>
            ) : null}
          </div>

          {workspace.regions.length ? (
            <section>
              <Group justify="space-between" align="center" mb={4}>
                <Title order={2}>Regional review</Title>
                <Badge variant="light">
                  {workspace.regions.length} regions
                </Badge>
              </Group>
              <div className={classes.regionGrid}>
                {workspace.regions.map((region) => (
                  <Paper withBorder radius="lg" p="md" key={region.id}>
                    <Stack gap="sm">
                      <Group justify="space-between" align="start">
                        <Title order={3} size="h4">
                          {region.name}
                        </Title>
                        <Badge
                          color={region.effectivelyLocked ? "gray" : "blue"}
                          variant="light"
                        >
                          {region.effectivelyLocked ? "Locked" : "Open"}
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
                          size="compact-sm"
                          variant="light"
                          loading={processingId === "lock-" + region.id}
                          onClick={() =>
                            void action("lock-" + region.id, () =>
                              lockAdminEventRegion({
                                data: {
                                  eventOccurrenceId: occurrence.id,
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
            </section>
          ) : null}

          <details className={classes.managementPanel}>
            <summary>Event lifecycle</summary>
            <Group gap="sm" className={classes.managementActions}>
              {occurrence.status === "published" ? (
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
                    Cancel event
                  </Button>
                </>
              ) : null}
              {occurrence.status === "completed" ||
              occurrence.status === "cancelled" ? (
                <Button
                  variant="light"
                  onClick={() => {
                    setLifecycleTarget("archived");
                  }}
                >
                  Archive event
                </Button>
              ) : null}
            </Group>
          </details>

          {workspace.reschedules.length ? (
            <details className={classes.managementPanel}>
              <summary>
                Reschedule history ({workspace.reschedules.length})
              </summary>
              <Stack gap="xs" className={classes.historyList}>
                {workspace.reschedules.map((reschedule) => (
                  <Text size="sm" key={reschedule.id}>
                    {formatLocalDateTime(reschedule.createdAt, {
                      timeZone: occurrence.timezone,
                    })}
                    : {reschedule.registrationWindowPolicy.replaceAll("_", " ")}{" "}
                    ·{" "}
                    {formatLocalDateTime(reschedule.previousStartsAt, {
                      timeZone: occurrence.timezone,
                    })}{" "}
                    →{" "}
                    {formatLocalDateTime(reschedule.nextStartsAt, {
                      timeZone: occurrence.timezone,
                    })}{" "}
                    · {reschedule.actorName}
                  </Text>
                ))}
              </Stack>
            </details>
          ) : null}
        </Stack>
      ) : null}
      {search.view === "registrations" ? (
        <Stack gap="lg">
          {workspace.invitations.length ? (
            <Paper withBorder radius="lg" p="md">
              <Stack gap="md">
                <Group justify="space-between">
                  <Title order={2}>Late registration invitations</Title>
                  <Badge variant="light">{workspace.invitations.length}</Badge>
                </Group>
                {workspace.invitations.map((invitation) => (
                  <Group
                    key={invitation.id}
                    justify="space-between"
                    align="start"
                    wrap="wrap"
                  >
                    <div>
                      <Text fw={600}>{invitation.name}</Text>
                      <Text c="dimmed" size="sm">
                        {invitation.email}
                        {invitation.regionName
                          ? ` · ${invitation.regionName}`
                          : ""}
                      </Text>
                      <Text c="dimmed" size="xs">
                        Expires{" "}
                        {formatLocalDateTime(invitation.expiresAt, {
                          timeZone: occurrence.timezone,
                        })}
                      </Text>
                    </div>
                    <Group gap="sm">
                      <Badge
                        color={
                          invitation.status === "pending"
                            ? "blue"
                            : invitation.status === "accepted"
                              ? "green"
                              : "gray"
                        }
                        variant="light"
                      >
                        {invitation.status}
                      </Badge>
                      {invitation.status === "pending" ? (
                        <Button
                          size="compact-sm"
                          variant="subtle"
                          color="red"
                          loading={
                            processingId === `revoke-invite-${invitation.id}`
                          }
                          onClick={() =>
                            void action(
                              `revoke-invite-${invitation.id}`,
                              () =>
                                revokeAdminEventLateInvitation({
                                  data: {
                                    eventOccurrenceId: occurrence.id,
                                    invitationId: invitation.id,
                                  },
                                }),
                              "Invitation revoked.",
                            )
                          }
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </Group>
                  </Group>
                ))}
              </Stack>
            </Paper>
          ) : null}
          {workspace.registrations.length ? (
            <Suspense
              fallback={<LoadingSpinner label="Loading registrations" />}
            >
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
            <Alert title="No registrations" />
          )}
        </Stack>
      ) : null}

      {search.view === "staffing" ? (
        <Stack gap="lg">
          <Paper withBorder radius="lg" p="md">
            <div className={classes.teamBar}>
              <Text fw={700}>Event administrators</Text>
              <div className={classes.peopleList}>
                {workspace.administrators.map((person) => (
                  <div className={classes.person} key={person.id}>
                    <Text fw={600} size="sm">
                      {person.name}
                    </Text>
                    <Text c="dimmed" size="xs">
                      {person.email}
                    </Text>
                  </div>
                ))}
              </div>
            </div>
          </Paper>
          <div className={classes.sessionGrid}>
            {workspace.sessions.map((session) => (
              <Paper withBorder radius="lg" p="md" key={session.id}>
                <Stack gap="md">
                  <div>
                    <Title order={3} size="h4">
                      {session.title}
                    </Title>
                    <Text size="sm" mt="xs">
                      {formatLocalDateTime(session.startsAt, {
                        timeZone: occurrence.timezone,
                      })}
                    </Text>
                    <Text c="dimmed" size="sm">
                      {session.presenters
                        .map((person) => person.name)
                        .join(", ") || "No presenters assigned"}
                    </Text>
                  </div>
                  {session.attendance.length ? (
                    <div className={classes.attendanceList}>
                      {session.attendance.map((participant) => (
                        <div
                          className={classes.attendanceRow}
                          key={participant.eventParticipationId}
                        >
                          <div className={classes.attendeeIdentity}>
                            <Text fw={600} size="sm">
                              {participant.name}
                            </Text>
                            <Text c="dimmed" size="xs">
                              {participant.email}
                            </Text>
                            {participant.mode === "open_entry" ? (
                              <Badge color="gray" variant="light">
                                Guest
                              </Badge>
                            ) : null}
                          </div>
                          <MantineNativeSelect
                            aria-label={"Attendance for " + participant.name}
                            value={participant.state}
                            disabled={
                              processingId ===
                              "attendance-" +
                                session.id +
                                "-" +
                                participant.eventParticipationId
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
                                "attendance-" +
                                  session.id +
                                  "-" +
                                  participant.eventParticipationId,
                                () =>
                                  recordAdminEventAttendance({
                                    data: {
                                      eventOccurrenceId: occurrence.id,
                                      eventSessionId: session.id,
                                      eventParticipationId:
                                        participant.eventParticipationId,
                                      state,
                                    },
                                  }),
                              );
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Text c="dimmed" size="sm">
                      No confirmed participants
                    </Text>
                  )}
                </Stack>
              </Paper>
            ))}
          </div>
        </Stack>
      ) : null}
      {search.view === "activity" ? (
        workspace.activity.length ? (
          <Stack gap="md">
            <Title order={2}>Registration history</Title>
            <Suspense fallback={<LoadingSpinner label="Loading history" />}>
              <AdminEventActivityTable
                activity={workspace.activity}
                timezone={occurrence.timezone}
              />
            </Suspense>
          </Stack>
        ) : (
          <Alert title="No registration history yet" />
        )
      ) : null}

      {search.view === "communications" ? (
        <Suspense fallback={<LoadingSpinner label="Loading communications" />}>
          <AdminCommunicationPlanEditor
            scope={{
              kind: "event_occurrence",
              eventOccurrenceId: occurrence.id,
            }}
          />
        </Suspense>
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
              const outcome = await createAdminEventLateInvitation({
                data: { eventOccurrenceId: occurrence.id, ...data },
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
                  eventOccurrenceId: occurrence.id,
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
    name: string;
    email: string;
    eventOccurrenceRegionId: string | null;
    overrideDomainRestriction: boolean;
    expiresInDays: number;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [regionId, setRegionId] = useState("");
  const [override, setOverride] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState("7");
  return (
    <AppDialog title="Invite learner to event" onClose={onClose}>
      <Stack gap="md">
        <MantineTextInput
          label="Learner email"
          required
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.currentTarget.value);
          }}
        />
        <MantineTextInput
          label="Learner name"
          value={name}
          onChange={(event) => {
            setName(event.currentTarget.value);
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
        <MantineNativeSelect
          label="Invitation expires"
          value={expiresInDays}
          data={[
            { value: "1", label: "In 1 day" },
            { value: "3", label: "In 3 days" },
            { value: "7", label: "In 7 days" },
            { value: "14", label: "In 14 days" },
            { value: "30", label: "In 30 days" },
          ]}
          onChange={(event) => {
            setExpiresInDays(event.currentTarget.value);
          }}
        />
        <Group justify="end">
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={processing}
            disabled={
              !name || !email || (workspace.regions.length > 0 && !regionId)
            }
            onClick={() =>
              void onAdd({
                name,
                email,
                eventOccurrenceRegionId: regionId || null,
                overrideDomainRestriction: override,
                expiresInDays: Number(expiresInDays),
              })
            }
          >
            Send invitation
          </Button>
        </Group>
      </Stack>
    </AppDialog>
  );
}
