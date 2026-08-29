import type { AdminLearnerEvent } from "./admin.schema";

export function readableEventValue(value: string): string {
  const text = value.replaceAll("_", " ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

export function eventProgressColor(state: string): string {
  if (["completed", "up_to_date", "selected", "attended"].includes(state))
    return "green";
  if (["cancelled", "withdrawn", "not_selected", "absent"].includes(state))
    return "red";
  if (["waitlisted", "coordinator_approved"].includes(state)) return "orange";
  if (["locked", "not_started", "not_recorded"].includes(state)) return "gray";
  return "blue";
}

export function learnerEventState(event: AdminLearnerEvent): string {
  if (event.progress) return readableEventValue(event.progress.state);
  if (event.participation?.completedAt) return "Completed";
  if (event.participation?.checkedInAt) return "Checked in";
  if (event.registration) return readableEventValue(event.registration.status);
  return event.participation ? "Participating" : "No participation";
}
