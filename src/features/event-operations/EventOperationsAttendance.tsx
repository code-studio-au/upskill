import { formatLocalDateTime } from "#/features/shared/local-date";
import { MantineNativeSelect } from "#/features/shared/MantineNativeSelect";
import { Alert, Paper, Stack, Text, Title } from "#/features/shared/mantine";
import { recordEventOperationsAttendance } from "#/server/functions/event-operations";
import classes from "./EventOperations.module.css";
import type { EventOperationsWorkspace } from "./event-operations.schema";
import type { EventOperationsAction } from "./EventOperationsOverview";

export function EventOperationsAttendance({
  workspace,
  processingId,
  action,
}: {
  workspace: EventOperationsWorkspace;
  processingId: string | null;
  action: EventOperationsAction;
}) {
  return (
    <div className={classes.sessionList}>
      {workspace.sessions.map((session) => (
        <Paper withBorder radius="lg" p="md" key={session.id}>
          <Stack gap="md">
            <div>
              <Title order={2}>{session.title}</Title>
              <Text c="dimmed" size="sm" mt={4}>
                {formatLocalDateTime(session.startsAt, {
                  timeZone: workspace.occurrence.timezone,
                })}
              </Text>
            </div>
            {session.attendance.length ? (
              session.attendance.map((participant) => (
                <div
                  className={classes.attendanceRow}
                  key={participant.eventParticipationId}
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
                      !session.canRecordAttendance ||
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
                        "not_recorded" | "checked_in" | "attended" | "absent";
                      void action(
                        `attendance-${session.id}-${participant.eventParticipationId}`,
                        () =>
                          recordEventOperationsAttendance({
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
                </div>
              ))
            ) : (
              <Alert title="No participants in scope">
                Confirmed participants available to your assignment will appear
                here.
              </Alert>
            )}
          </Stack>
        </Paper>
      ))}
    </div>
  );
}
