import type {
  EventParticipantProgress,
  EventProgressFilter,
} from "./event-operations.schema";

export function filterEventParticipantProgress(
  participants: ReadonlyArray<EventParticipantProgress>,
  filters: EventProgressFilter,
): Array<EventParticipantProgress> {
  const query = filters.q.toLocaleLowerCase("en-AU");
  return participants.filter(
    (participant) =>
      (filters.state === "all" || participant.state === filters.state) &&
      (!query ||
        participant.name.toLocaleLowerCase("en-AU").includes(query) ||
        participant.email.toLocaleLowerCase("en-AU").includes(query) ||
        participant.regionName?.toLocaleLowerCase("en-AU").includes(query)),
  );
}
