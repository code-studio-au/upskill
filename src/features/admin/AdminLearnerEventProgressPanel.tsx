import type {
  AdminLearnerEvent,
  AdminLearnerEventHistoryItem,
} from "./admin.schema";
import { Badge } from "#/features/shared/Badge";
import { formatLocalDateTime } from "#/features/shared/local-date";
import { Group, Paper, Stack, Text, Title } from "#/features/shared/mantine";
import classes from "./AdminLearnerEventHistory.module.css";
import {
  eventProgressColor,
  learnerEventState,
  readableEventValue,
} from "./admin-learner-event-display";

export type AdminLearnerEventProgressView = "overview" | "details" | "history";

function FactGrid({ facts }: { facts: Array<[string, string]> }) {
  return (
    <div className={classes.facts}>
      {facts.map(([label, value]) => (
        <div className={classes.fact} key={label}>
          <Text c="dimmed" size="xs" fw={700}>
            {label}
          </Text>
          <Text size="sm">{value}</Text>
        </div>
      ))}
    </div>
  );
}

function historyDescription(item: AdminLearnerEventHistoryItem): string {
  if (item.kind === "registration") {
    const transition = item.fromStatus
      ? `${readableEventValue(item.fromStatus)} to ${readableEventValue(item.toStatus)}`
      : `Registered as ${readableEventValue(item.toStatus)}`;
    const regionChange =
      item.fromRegionName !== item.toRegionName
        ? ` · ${item.fromRegionName ?? "No region"} to ${item.toRegionName ?? "No region"}`
        : "";
    return `${transition}${regionChange}`;
  }
  if (item.kind === "region_decision") {
    const region = [item.reportingRegionGroupName, item.reportingRegionName]
      .filter(Boolean)
      .join(" / ");
    return `${readableEventValue(item.resolution)}${region ? ` · ${region}` : ""}`;
  }
  return `${item.sessionTitle} · ${readableEventValue(item.state)} (${readableEventValue(item.source)})`;
}

function OverallEventProgress({ event }: { event: AdminLearnerEvent }) {
  const progress = event.progress;
  const timezone = event.occurrence.timezone;
  const activityStartedAt =
    event.participation?.createdAt ?? event.registration?.submittedAt ?? null;
  return (
    <section aria-labelledby="event-completion-heading">
      <Paper withBorder radius="lg" p={{ base: "lg", sm: "xl" }}>
        <Stack gap="lg">
          <Group justify="space-between" align="flex-start">
            <Title order={2} id="event-completion-heading">
              Overall event completion
            </Title>
            <Badge
              color={eventProgressColor(
                event.progress?.state ?? event.registration?.status ?? "",
              )}
              variant="light"
            >
              {learnerEventState(event)}
            </Badge>
          </Group>
          <FactGrid
            facts={[
              [
                "Participation started",
                activityStartedAt
                  ? formatLocalDateTime(activityStartedAt, {
                      timeZone: timezone,
                    })
                  : "Not started",
              ],
              [
                "Requirements",
                progress
                  ? `${String(progress.completedAvailableItems)} of ${String(progress.availableItems)} complete`
                  : "No progress available",
              ],
              [
                "Completed",
                event.participation?.completedAt
                  ? formatLocalDateTime(event.participation.completedAt, {
                      timeZone: timezone,
                    })
                  : "Not completed",
              ],
            ]}
          />
        </Stack>
      </Paper>
    </section>
  );
}

function EventSectionProgress({ event }: { event: AdminLearnerEvent }) {
  const progress = event.progress;
  const attendanceBySessionId = new Map(
    event.sessions.map((session) => [session.id, session]),
  );
  return (
    <section aria-labelledby="event-section-progress-heading">
      <Stack gap="md">
        <Title order={2} id="event-section-progress-heading">
          Section progress
        </Title>
        {progress ? (
          <div className={classes.sectionList}>
            {progress.sections.map((section) => (
              <Paper
                withBorder
                radius="lg"
                p={{ base: "lg", sm: "xl" }}
                key={section.id}
              >
                <Stack gap="md">
                  <Group justify="space-between" align="flex-start">
                    <div>
                      <Title order={3}>{section.title}</Title>
                      {section.description ? (
                        <Text c="dimmed" size="sm">
                          {section.description}
                        </Text>
                      ) : null}
                    </div>
                    <Badge
                      color={eventProgressColor(section.state)}
                      variant="light"
                    >
                      {readableEventValue(section.state)}
                    </Badge>
                  </Group>
                  <Text size="sm" c="dimmed">
                    {section.completedItems} of {section.totalItems}{" "}
                    requirements complete
                  </Text>
                  <Stack gap="xs" className={classes.taskList}>
                    {section.items.map((item) => {
                      const session = item.eventSessionId
                        ? attendanceBySessionId.get(item.eventSessionId)
                        : undefined;
                      return (
                        <div
                          className={classes.task}
                          key={item.id}
                          role="group"
                          aria-label={`Task: ${item.title}`}
                        >
                          <Group
                            justify="space-between"
                            align="flex-start"
                            wrap="wrap"
                          >
                            <div>
                              <Text fw={600}>{item.title}</Text>
                              <Text size="xs" c="dimmed">
                                {readableEventValue(item.kind)} ·{" "}
                                {item.required ? "Required" : "Optional"}
                              </Text>
                            </div>
                            <Badge
                              color={eventProgressColor(item.state)}
                              variant="light"
                            >
                              {readableEventValue(item.state)}
                            </Badge>
                          </Group>
                          {session ? (
                            <div className={classes.attendanceEvidence}>
                              <Text fw={600} size="sm">
                                Attendance
                              </Text>
                              <Badge
                                color={eventProgressColor(
                                  session.attendance.state,
                                )}
                                variant="light"
                              >
                                {readableEventValue(session.attendance.state)}
                              </Badge>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </Stack>
                </Stack>
              </Paper>
            ))}
          </div>
        ) : (
          <Paper withBorder radius="lg" p="xl">
            <Text>
              No participation progress is available for this registration.
            </Text>
          </Paper>
        )}
      </Stack>
    </section>
  );
}

function EventProgressOverview({ event }: { event: AdminLearnerEvent }) {
  return (
    <div className={classes.detailsBody}>
      <OverallEventProgress event={event} />
      <EventSectionProgress event={event} />
    </div>
  );
}

function EventDetails({ event }: { event: AdminLearnerEvent }) {
  const timezone = event.occurrence.timezone;
  const registrationRegion = event.registration?.registrationRegion;
  const reportingRegion = event.registration?.reportingRegionSnapshot;
  return (
    <div className={classes.detailsBody}>
      <section aria-labelledby="event-details-heading">
        <Paper withBorder radius="lg" p={{ base: "lg", sm: "xl" }}>
          <Stack gap="lg">
            <Title order={2} id="event-details-heading">
              Event details
            </Title>
            <FactGrid
              facts={[
                [
                  "Schedule",
                  `${formatLocalDateTime(event.occurrence.startsAt, { timeZone: timezone })} – ${formatLocalDateTime(event.occurrence.endsAt, { timeZone: timezone })}`,
                ],
                ["Timezone", timezone],
                ["Delivery", readableEventValue(event.occurrence.deliveryMode)],
                [
                  "Template snapshot",
                  `${event.occurrence.eventTemplateTitle} · Published V${String(event.occurrence.eventTemplateVersion)}`,
                ],
                [
                  "Registration region",
                  registrationRegion
                    ? `${registrationRegion.name} (${registrationRegion.code})`
                    : "Not assigned",
                ],
                [
                  "Reporting region snapshot",
                  reportingRegion
                    ? [reportingRegion.groupName, reportingRegion.name]
                        .filter(Boolean)
                        .join(" / ") || "No region"
                    : "No confirmed snapshot",
                ],
              ]}
            />
          </Stack>
        </Paper>
      </section>

      {event.registration ? (
        <section aria-labelledby="event-registration-heading">
          <Paper withBorder radius="lg" p={{ base: "lg", sm: "xl" }}>
            <Stack gap="lg">
              <Title order={2} id="event-registration-heading">
                Registration evidence
              </Title>
              <FactGrid
                facts={[
                  ["Name snapshot", event.registration.nameSnapshot],
                  ["Email snapshot", event.registration.emailSnapshot],
                  ["Source", readableEventValue(event.registration.source)],
                  [
                    "Eligibility",
                    readableEventValue(event.registration.eligibilitySource),
                  ],
                  [
                    "Submitted",
                    formatLocalDateTime(event.registration.submittedAt, {
                      timeZone: timezone,
                    }),
                  ],
                  [
                    "Coordinator decision",
                    event.registration.coordinatorDecidedAt
                      ? formatLocalDateTime(
                          event.registration.coordinatorDecidedAt,
                          { timeZone: timezone },
                        )
                      : "Not recorded",
                  ],
                  [
                    "Final decision",
                    event.registration.finalDecidedAt
                      ? formatLocalDateTime(event.registration.finalDecidedAt, {
                          timeZone: timezone,
                        })
                      : "Not recorded",
                  ],
                  [
                    "Locked in",
                    event.registration.lockedInAt
                      ? formatLocalDateTime(event.registration.lockedInAt, {
                          timeZone: timezone,
                        })
                      : "Not locked in",
                  ],
                ]}
              />
            </Stack>
          </Paper>
        </section>
      ) : (
        <Paper withBorder radius="lg" p="xl">
          <Text>
            This learner joined through open entry, so there is no registration
            record.
          </Text>
        </Paper>
      )}

      {event.participation ? (
        <section aria-labelledby="event-participation-heading">
          <Paper withBorder radius="lg" p={{ base: "lg", sm: "xl" }}>
            <Stack gap="lg">
              <Group justify="space-between" align="flex-start">
                <Title order={2} id="event-participation-heading">
                  Participation evidence
                </Title>
                <Badge color={event.certificate.eligible ? "green" : "gray"}>
                  {event.certificate.eligible
                    ? "Certificate eligible"
                    : event.certificate.offered
                      ? "Certificate not yet eligible"
                      : "No certificate offered"}
                </Badge>
              </Group>
              <FactGrid
                facts={[
                  ["Name snapshot", event.participation.nameSnapshot],
                  ["Email snapshot", event.participation.emailSnapshot],
                  ["Mode", readableEventValue(event.participation.mode)],
                  [
                    "Participation created",
                    formatLocalDateTime(event.participation.createdAt, {
                      timeZone: timezone,
                    }),
                  ],
                  [
                    "Checked in",
                    event.participation.checkedInAt
                      ? formatLocalDateTime(event.participation.checkedInAt, {
                          timeZone: timezone,
                        })
                      : "Not checked in",
                  ],
                  [
                    "Completed",
                    event.participation.completedAt
                      ? formatLocalDateTime(event.participation.completedAt, {
                          timeZone: timezone,
                        })
                      : "Not completed",
                  ],
                ]}
              />
            </Stack>
          </Paper>
        </section>
      ) : (
        <Paper withBorder radius="lg" p="xl">
          <Text>No participation record exists for this registration.</Text>
        </Paper>
      )}
    </div>
  );
}

function EventHistory({ event }: { event: AdminLearnerEvent }) {
  return (
    <section aria-labelledby="event-history-heading">
      <Stack gap="md">
        <Title order={2} id="event-history-heading">
          Registration and attendance history
        </Title>
        {event.history.length ? (
          <ol className={classes.historyList}>
            {event.history.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <Paper withBorder radius="md" p="md">
                  <Text size="sm" fw={600}>
                    {historyDescription(item)}
                  </Text>
                  <Text c="dimmed" size="xs">
                    {formatLocalDateTime(item.occurredAt, {
                      timeZone: event.occurrence.timezone,
                    })}
                    {item.actorName ? ` · ${item.actorName}` : " · System"}
                  </Text>
                </Paper>
              </li>
            ))}
          </ol>
        ) : (
          <Paper withBorder radius="lg" p="xl">
            <Text>
              No registration transitions or attendance corrections are
              recorded.
            </Text>
          </Paper>
        )}
      </Stack>
    </section>
  );
}

export function AdminLearnerEventProgressPanel({
  event,
  view,
}: {
  event: AdminLearnerEvent;
  view: AdminLearnerEventProgressView;
}) {
  if (view === "overview") return <EventProgressOverview event={event} />;
  if (view === "details") return <EventDetails event={event} />;
  return <EventHistory event={event} />;
}
