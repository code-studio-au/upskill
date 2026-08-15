import { Badge } from "#/features/shared/Badge";
import { Text } from "#/features/shared/mantine";
import type { EventAttendanceState } from "./event-operations.schema";
import type { ParticipantSessionAttendance } from "./participant-attendance";
import classes from "./EventOperations.module.css";

const attendanceLabels: Record<EventAttendanceState, string> = {
  not_recorded: "Not recorded",
  checked_in: "Checked in",
  attended: "Attended",
  absent: "Absent",
};

export function ParticipantAttendanceSummary({
  attendance,
}: {
  attendance: ReadonlyArray<ParticipantSessionAttendance>;
}) {
  if (attendance.length === 0)
    return (
      <Badge color="gray" variant="light">
        No records
      </Badge>
    );
  const attended = attendance.filter(
    (record) => record.state === "attended",
  ).length;
  const summaryColor =
    attended === attendance.length
      ? "green"
      : attendance.some((record) => record.state === "absent")
        ? "red"
        : attendance.some((record) => record.state === "checked_in")
          ? "blue"
          : "gray";

  return (
    <details className={classes.progressDetails}>
      <summary>
        <Badge color={summaryColor} variant="light">
          {attended}/{attendance.length} attended
        </Badge>
      </summary>
      <ul className={classes.progressItemList}>
        {attendance.map((record) => (
          <li key={record.sessionId}>
            <Text size="xs">
              {record.sessionTitle}: {attendanceLabels[record.state]}
            </Text>
          </li>
        ))}
      </ul>
    </details>
  );
}
