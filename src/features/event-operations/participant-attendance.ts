import type {
  EventAttendanceState,
  EventOperationsWorkspace,
} from "./event-operations.schema";

export interface ParticipantSessionAttendance {
  sessionId: string;
  sessionTitle: string;
  state: EventAttendanceState;
}

export function indexEventAttendanceByParticipant(
  sessions: ReadonlyArray<EventOperationsWorkspace["sessions"][number]>,
): Map<string, Array<ParticipantSessionAttendance>> {
  const byParticipant = new Map<string, Array<ParticipantSessionAttendance>>();

  for (const session of sessions) {
    for (const attendance of session.attendance) {
      const participantSessions =
        byParticipant.get(attendance.eventParticipationId) ?? [];
      participantSessions.push({
        sessionId: session.id,
        sessionTitle: session.title,
        state: attendance.state,
      });
      byParticipant.set(attendance.eventParticipationId, participantSessions);
    }
  }

  return byParticipant;
}
