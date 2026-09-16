import { Badge } from "#/features/shared/Badge";
import { formatLocalDateTime } from "#/features/shared/local-date";
import { Group, Paper, Text, Title } from "#/features/shared/mantine";
import type { AdminEventOccurrenceOperations } from "./admin-event-operations.schema";
import classes from "./AdminEventAttendanceStaffingSummary.module.css";

type Staffing = Pick<
  AdminEventOccurrenceOperations,
  "administrators" | "sessions"
>;

export function AdminEventAttendanceStaffingSummary({
  administrators,
  sessions,
  timezone,
}: Staffing & { timezone: string }) {
  return (
    <section
      className={classes.root}
      aria-labelledby="staffing-coverage-heading"
    >
      <div className={classes.heading}>
        <div>
          <Title order={2} id="staffing-coverage-heading">
            Staffing coverage
          </Title>
          <Text c="dimmed" size="sm">
            People assigned to operate sessions and review attendance.
          </Text>
        </div>
        <Badge variant="light">
          {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
        </Badge>
      </div>
      <div className={classes.grid}>
        <Paper withBorder radius="lg" p="md" className={classes.card}>
          <Group justify="space-between" align="start" wrap="wrap">
            <Title order={3} size="h4">
              Event administrators
            </Title>
            <Badge color="gray" variant="light">
              {administrators.length} assigned
            </Badge>
          </Group>
          <Text c="dimmed" size="sm">
            Can review evidence and make authoritative attendance corrections.
          </Text>
          <div className={classes.peopleList}>
            {administrators.map((person) => (
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
        </Paper>
        {sessions.map((session) => (
          <Paper
            withBorder
            radius="lg"
            p="md"
            key={session.id}
            className={classes.card}
          >
            <Group justify="space-between" align="start" wrap="wrap">
              <Title order={3} size="h4">
                {session.title}
              </Title>
              <Badge
                color={session.presenters.length ? "green" : "orange"}
                variant="light"
              >
                {session.presenters.length
                  ? "Presenter covered"
                  : "Presenter needed"}
              </Badge>
            </Group>
            <div className={classes.sessionSchedule}>
              <Text size="sm">
                {formatLocalDateTime(session.startsAt, { timeZone: timezone })}
              </Text>
              <Text c="dimmed" size="sm">
                Ends{" "}
                {formatLocalDateTime(session.endsAt, { timeZone: timezone })}
              </Text>
            </div>
            <Text c="dimmed" size="xs" fw={700} className={classes.roleLabel}>
              Presenters
            </Text>
            <Text size="sm" fw={600}>
              {session.presenters.map((person) => person.name).join(", ") ||
                "No presenters assigned"}
            </Text>
          </Paper>
        ))}
      </div>
    </section>
  );
}
