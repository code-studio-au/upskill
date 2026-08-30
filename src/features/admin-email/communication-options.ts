export const courseCommunicationAudiences = [
  { value: "affected_learner", label: "Affected learner" },
  { value: "active_enrollees", label: "Active enrolled learners" },
] as const;

const eventCommunicationAudiences = [
  { value: "affected_learner", label: "Affected learner" },
  { value: "confirmed_participants", label: "Confirmed participants" },
  { value: "presenters", label: "Presenters" },
  { value: "coordinators", label: "Regional coordinators" },
  { value: "administrators", label: "Event administrators" },
] as const;

const affectedLearnerOnlyEventTriggers = new Set([
  "event_completed",
  "section_release",
]);

export function eventCommunicationAudiencesForTrigger(trigger: string) {
  return affectedLearnerOnlyEventTriggers.has(trigger)
    ? eventCommunicationAudiences.filter(
        (audience) => audience.value === "affected_learner",
      )
    : eventCommunicationAudiences;
}

export const courseCommunicationTriggers = [
  { value: "enrollment_created", label: "Enrolment created" },
  { value: "enrollment_completed", label: "Course completed" },
  { value: "course_incomplete", label: "Course remains incomplete" },
  { value: "enrollment_expiring", label: "Enrolment expiry" },
] as const;

export const eventCommunicationTriggers = [
  { value: "registration_submitted", label: "Registration submitted" },
  { value: "registration_selected", label: "Registration confirmed" },
  { value: "event_start", label: "Event start" },
  { value: "event_end", label: "Event end" },
  { value: "session_start", label: "Session start" },
  { value: "section_release", label: "Section release" },
  { value: "event_completed", label: "Event completed" },
] as const;

export function formatCommunicationTiming(
  trigger: string,
  offsetAmount: number,
  offsetUnit: string,
): string {
  const triggerLabel = [
    ...courseCommunicationTriggers,
    ...eventCommunicationTriggers,
  ].find((option) => option.value === trigger)?.label;
  const anchor = (triggerLabel ?? trigger.replaceAll("_", " ")).toLowerCase();
  if (offsetAmount === 0) return `At ${anchor}`;
  const amount = Math.abs(offsetAmount);
  const unit = amount === 1 ? offsetUnit : `${offsetUnit}s`;
  return `${String(amount)} ${unit} ${offsetAmount < 0 ? "before" : "after"} ${anchor}`;
}
