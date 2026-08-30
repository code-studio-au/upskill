import type { LearnerEvent } from "./learner.schema";

const historicalStatuses = new Set<
  NonNullable<LearnerEvent["registrationStatus"]>
>(["coordinator_declined", "not_selected", "withdrawn", "cancelled"]);

export interface LearnerEventGroups {
  registrations: Array<LearnerEvent>;
  history: Array<LearnerEvent>;
  available: Array<LearnerEvent>;
}

export function groupLearnerEvents(
  events: ReadonlyArray<LearnerEvent>,
): LearnerEventGroups {
  const groups: LearnerEventGroups = {
    registrations: [],
    history: [],
    available: [],
  };
  for (const event of events) {
    if (event.completedAt) {
      groups.history.push(event);
      continue;
    }
    if (event.participationMode === "open_entry") {
      groups.registrations.push(event);
      continue;
    }
    if (event.registrationStatus === null) {
      if (event.registrationUnavailableReason !== "closed")
        groups.available.push(event);
      continue;
    }
    if (historicalStatuses.has(event.registrationStatus))
      groups.history.push(event);
    else groups.registrations.push(event);
  }
  return groups;
}
