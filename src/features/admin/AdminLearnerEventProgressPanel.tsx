import type {
  AdminLearnerEvent,
  AdminLearnerEventHistoryItem,
} from "./admin.schema";
import { Badge } from "#/features/shared/Badge";
import { formatLocalDateTime } from "#/features/shared/local-date";
import { Group, Paper, Stack, Text, Title } from "#/features/shared/mantine";
import classes from "./AdminLearnerEventHistory.module.css";

export type AdminLearnerEventProgressView =
  "overview" | "attendance" | "progress" | "history";

function readable(value: string): string {
  const text = value.replaceAll("_", " ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function statusColor(state: string): string {
  if (["completed", "up_to_date", "selected", "attended"].includes(state))
    return "green";
  if (["cancelled", "withdrawn", "not_selected", "absent"].includes(state))
    return "red";
  if (["waitlisted", "coordinator_approved"].includes(state)) return "orange";
  if (["locked", "not_started", "not_recorded"].includes(state)) return "gray";
  return "blue";
}

function eventState(event: AdminLearnerEvent): string {
  if (event.progress) return readable(event.progress.state);
  if (event.registration) return readable(event.registration.status);
  return event.participation ? "Participating" : "No participation";
}

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

function EvidenceRows({
  rows,
}: {
  rows: Array<{
    id: string;
    title: string;
    description: string;
    detail?: string | undefined;
    state: string;
  }>;
}) {
  return (
    <div className={classes.rowList}>
      {rows.map((row) => (
        <div className={classes.supportRow} key={row.id}>
          <div>
            <Text fw={700}>{row.title}</Text>
            <Text c="dimmed" size="sm">
              {row.description}
            </Text>
            {row.detail ? (
              <Text c="dimmed" size="xs">
                {row.detail}
              </Text>
            ) : null}
          </div>
          <Badge color={statusColor(row.state)}>{readable(row.state)}</Badge>
        </div>
      ))}
    </div>
  );
}

function historyDescription(item: AdminLearnerEventHistoryItem): string {
  if (item.kind === "registration") {
    const transition = item.fromStatus
      ? `${readable(item.fromStatus)} to ${readable(item.toStatus)}`
      : `Registered as ${readable(item.toStatus)}`;
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
    return `${readable(item.resolution)}${region ? ` · ${region}` : ""}`;
  }
  return `${item.sessionTitle} · ${readable(item.state)} (${readable(item.source)})`;
}

function EventOverview({ event }: { event: AdminLearnerEvent }) {
  const timezone = event.occurrence.timezone;
  const registrationRegion = event.registration?.registrationRegion;
  const reportingRegion = event.registration?.reportingRegionSnapshot;
  return (
    <div className={classes.detailsBody}>
      <section aria-labelledby="event-overview-heading">
        <Paper withBorder radius="lg" p={{ base: "lg", sm: "xl" }}>
          <Stack gap="lg">
            <Group justify="space-between" align="flex-start">
              <Title order={2} id="event-overview-heading">
                Overall event participation
              </Title>
              <Badge
                color={statusColor(
                  event.progress?.state ?? event.registration?.status ?? "",
                )}
              >
                {eventState(event)}
              </Badge>
            </Group>
            <FactGrid
              facts={[
                [
                  "Schedule",
                  `${formatLocalDateTime(event.occurrence.startsAt, { timeZone: timezone })} – ${formatLocalDateTime(event.occurrence.endsAt, { timeZone: timezone })}`,
                ],
                ["Timezone", timezone],
                ["Delivery", readable(event.occurrence.deliveryMode)],
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
                  ["Source", readable(event.registration.source)],
                  [
                    "Eligibility",
                    readable(event.registration.eligibilitySource),
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
                  Participation and completion
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
                  [
                    "Participant name snapshot",
                    event.participation.nameSnapshot,
                  ],
                  [
                    "Participant email snapshot",
                    event.participation.emailSnapshot,
                  ],
                  ["Mode", readable(event.participation.mode)],
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

function EventAttendance({ event }: { event: AdminLearnerEvent }) {
  return (
    <section aria-labelledby="event-attendance-heading">
      <Stack gap="md">
        <Title order={2} id="event-attendance-heading">
          Session attendance
        </Title>
        {event.sessions.length ? (
          <EvidenceRows
            rows={event.sessions.map((session) => ({
              id: session.id,
              title: session.title,
              description: formatLocalDateTime(session.startsAt, {
                timeZone: event.occurrence.timezone,
              }),
              detail: session.attendance.recordedAt
                ? `Recorded by ${session.attendance.recordedByName ?? "System"}${session.attendance.source ? ` · ${readable(session.attendance.source)}` : ""}`
                : undefined,
              state: session.attendance.state,
            }))}
          />
        ) : (
          <Paper withBorder radius="lg" p="xl">
            <Text>This event has no attendance sessions.</Text>
          </Paper>
        )}
      </Stack>
    </section>
  );
}

function EventProgress({ event }: { event: AdminLearnerEvent }) {
  const progress = event.progress;
  return (
    <section aria-labelledby="event-progress-heading">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <Title order={2} id="event-progress-heading">
            Section progress
          </Title>
          {progress ? (
            <Text c="dimmed" size="sm">
              {progress.completedAvailableItems} of {progress.availableItems}{" "}
              available requirements complete
            </Text>
          ) : null}
        </Group>
        {progress ? (
          <EvidenceRows
            rows={progress.sections.map((section) => ({
              id: section.id,
              title: section.title,
              description: `${readable(section.phase)} · ${String(section.completedItems)} of ${String(section.totalItems)} requirements complete`,
              state: section.state,
            }))}
          />
        ) : (
          <Paper withBorder radius="lg" p="xl">
            <Text>No participation progress has been recorded.</Text>
          </Paper>
        )}
      </Stack>
    </section>
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
  if (view === "overview") return <EventOverview event={event} />;
  if (view === "attendance") return <EventAttendance event={event} />;
  if (view === "progress") return <EventProgress event={event} />;
  return <EventHistory event={event} />;
}
